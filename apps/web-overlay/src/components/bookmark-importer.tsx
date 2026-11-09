'use client'

/**
 * `/import` 智能书签工作台。
 *
 * 架构约束（与 lib/import-workbench.ts 配套）：
 * - 一套解析器吃透 HTML / Markdown / OneTab / JSON / 纯粘贴，解析、脱敏、去重、归类都在本地；
 * - 不再把「导入个人收藏」踢去 /favorites，两个目标在同一张 Staging Table 里分流；
 * - 公共库投稿优先走管理员批量直入（/api/hub/sites/batch）；匿名被网关拒绝时
 *   自动回退到对公众开放的投稿审核接口（/api/hub/submissions），并如实报出限流与剩余条数。
 * - 所有计数从数据派生，2xx 但读不出条数一律记「未确认」，绝不冒充成功。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/registry/new-york/ui/button'
import { Card, CardContent } from '@/registry/new-york/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Upload, FileUp, CheckCircle, ArrowLeft, Loader2, Sparkles, AlertCircle,
  Bookmark, Globe, ArrowRight, ShieldCheck, Lock, X, Download, Layers, Tag,
} from 'lucide-react'
import Link from 'next/link'
import { useFavorites } from '@/hooks/useFavorites'
import {
  generateBookmarkId,
  parseUniversalBookmarks,
  type ParsedUniversalItem,
} from '@/lib/favorites-export-import'
import {
  addLocalFolder,
  LOCAL_FOLDERS_STORAGE_KEY,
  parseLocalFolders,
  serializeLocalFolders,
  type LocalFolder,
} from '@/lib/favorites-folders'
import {
  CATEGORY_HINTS,
  applyMode,
  buildSampleBookmarks,
  buildStagingItems,
  platformShortcut,
  type CategoryNode,
  type Confidence,
  type ImportMode,
  type StagingItem,
  type StagingStatus,
} from '@/lib/import-workbench'

/** 「暂不分类」在 select 里的值：提交时直接省略 categoryId */
const UNCLASSIFIED = ''

export interface BookmarkImporterProps {
  /** 由服务端从实时导航树派生的规范化 URL 指纹 */
  publicIndex: string[]
  /** 公共库里的真实 URL，用于生成「已收录」示例 */
  publicSampleUrls: string[]
  /** 公共库站点总数（实时派生，禁止写死） */
  publicSiteCount: number
  categories: CategoryNode[]
  /** 中枢取数失败时为 false：UI 必须明说「去重未生效」 */
  indexReady: boolean
}

type InputTab = 'file' | 'paste'
type StatusFilter = 'all' | StagingStatus

interface ParseMeta {
  format: string
  skipped: number
  duplicates: number
  folders: number
  dedupeUnavailable: boolean
}

interface ImportResult {
  success: number
  failed: number
  duplicate: number
  degraded: number
  /** 服务端返回 2xx 但正文读不出条数：既不能算成功也不能算失败 */
  unconfirmed: number
  privateImported: number
  privateSkippedInvalid: number
  privateError: string | null
  /** 匿名回退到投稿审核后的台账 */
  reviewSubmitted: number
  reviewDuplicate: number
  reviewRateLimited: number
  reviewSkippedNoCategory: number
  reviewFailed: number
  usedReviewFallback: boolean
  remaining: StagingItem[]
}

const MODE_META: Array<{ key: ImportMode; label: string; hint: string; icon: typeof Layers }> = [
  { key: 'split', label: '双轨智能分流', hint: '一次解析，私有收藏与公共投稿同页勾选', icon: Layers },
  { key: 'private', label: '仅个人收藏夹', hint: '全部留在本地，隐私链接也一并保留', icon: Bookmark },
  { key: 'public', label: '仅贡献公共库', hint: '只提交公开且未收录的优质站点', icon: Globe },
]

const STATUS_META: Record<StagingStatus, { label: string; className: string }> = {
  ready: { label: '可投稿', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25' },
  duplicate: { label: '公共库已收录', className: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25' },
  private: { label: '隐私内网已拦截', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25' },
}

const CONFIDENCE_META: Record<Confidence, string> = {
  high: '高置信', medium: '中置信', low: '低置信', none: '待归类',
}

export function BookmarkImporter({
  publicIndex,
  publicSampleUrls,
  publicSiteCount,
  categories,
  indexReady,
}: BookmarkImporterProps) {
  const favorites = useFavorites()
  const [mode, setMode] = useState<ImportMode>('split')
  const [inputTab, setInputTab] = useState<InputTab>('file')
  const [pasteText, setPasteText] = useState('')
  const [rawItems, setRawItems] = useState<ParsedUniversalItem[]>([])
  const [items, setItems] = useState<StagingItem[]>([])
  const [parseMeta, setParseMeta] = useState<ParseMeta | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [bulkCategory, setBulkCategory] = useState<string>(UNCLASSIFIED)
  const [bulkTag, setBulkTag] = useState('')
  /** 200+ 个叶子分类只在被点开的那一行挂载 option，避免 N 行 × M 选项的 DOM 爆炸 */
  const [expandedCategoryRow, setExpandedCategoryRow] = useState<string | null>(null)
  const [platform, setPlatform] = useState<{ keys: string; hint: string } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isAiClassifying, setIsAiClassifying] = useState(false)
  const [aiClassifiedCount, setAiClassifiedCount] = useState(0)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setPlatform(platformShortcut(navigator.platform || navigator.userAgent))
  }, [])

  /** 叶子分类才可挂载；一级根提交上去会被中枢静默降级成「未分类」 */
  const leafCategories = useMemo(
    () => categories
      .filter((c) => c.parentId && c.slug && c.enabled !== false)
      .map((c) => ({ slug: c.slug, label: c.title })),
    [categories],
  )

  const categoryOptions = useMemo(() => {
    const seen = new Set(leafCategories.map((c) => c.slug))
    const extras = CATEGORY_HINTS.filter((h) => !seen.has(h.slug)).map((h) => ({
      slug: h.slug,
      label: `${h.icon} ${h.title}`,
    }))
    return [{ slug: UNCLASSIFIED, label: '暂不分类（导入后再归类）' }, ...leafCategories, ...extras]
  }, [leafCategories])

  /** slug → 中枢 id：投稿审核接口收的是 categoryId，不认 slug */
  const categoryIdBySlug = useMemo(
    () => new Map(categories.map((c) => [c.slug, c.id])),
    [categories],
  )

  const stage = useCallback((parsed: ParsedUniversalItem[], meta: Omit<ParseMeta, 'duplicates' | 'dedupeUnavailable'>) => {
    const result = buildStagingItems(parsed, indexReady ? publicIndex : null, categories, mode)
    setItems(result.items)
    setParseMeta({
      ...meta,
      duplicates: result.skippedDuplicates,
      dedupeUnavailable: result.dedupeUnavailable,
    })
    setImportResult(null)
  }, [categories, indexReady, mode, publicIndex])

  const ingest = useCallback((text: string, filename: string, replace: boolean) => {
    if (!text.trim()) return
    setIsParsing(true)
    setError(null)
    setImportResult(null)
    try {
      const parsed = parseUniversalBookmarks(text, 5000)
      if (!parsed.ok || parsed.items.length === 0) {
        setError(`未能从「${filename}」解析出有效书签：${parsed.error ?? '内容为空'}。支持 HTML 书签、Markdown、OneTab / 纯 URL 列表与 JSON 备份。`)
        return
      }
      const merged = replace ? parsed.items : [...rawItems, ...parsed.items]
      const byHref = new Map<string, ParsedUniversalItem>()
      for (const item of merged) if (!byHref.has(item.href)) byHref.set(item.href, item)
      const next = Array.from(byHref.values())
      setRawItems(next)
      stage(next, {
        format: parsed.format,
        skipped: parsed.skippedCount,
        folders: parsed.detectedFolders.length,
      })
      setStatusFilter('all')
    } catch (err) {
      setError('解析文件失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsParsing(false)
    }
  }, [rawItems, stage])

  const readFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => /\.(html?|md|json|txt)$/i.test(f.name))
    if (list.length === 0) {
      setError('仅支持 .html / .htm / .md / .json / .txt 四种书签文件。')
      return
    }
    let replace = true
    for (const file of list) {
      const text = await file.text()
      ingest(text, file.name, replace)
      replace = false
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [ingest])

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files?.length) void readFiles(e.dataTransfer.files)
  }, [readFiles])

  const loadSample = useCallback(() => {
    const html = buildSampleBookmarks(publicSampleUrls, publicIndex)
    ingest(html, '示例书签包.html', true)
    setInputTab('file')
  }, [ingest, publicIndex, publicSampleUrls])

  const resetAll = useCallback(() => {
    setRawItems([])
    setItems([])
    setParseMeta(null)
    setImportResult(null)
    setError(null)
    setStatusFilter('all')
    setBulkTag('')
  }, [])

  const changeMode = (next: ImportMode) => {
    setMode(next)
    setItems((prev) => applyMode(prev, next))
    setImportResult(null)
  }

  // 模式是硬约束，不只是「预设勾选」：只导入个人收藏时不许再勾公共投稿，反之亦然
  const togglePrivate = (id: string) => {
    if (mode === 'public') return
    setItems((prev) => prev.map((b) => (b.id === id ? { ...b, toPrivate: !b.toPrivate } : b)))
  }

  const togglePublic = (id: string) => {
    if (mode === 'private') return
    setItems((prev) => prev.map((b) => (b.id === id && !b.publicLocked ? { ...b, toPublic: !b.toPublic } : b)))
  }

  const setAllPrivate = (checked: boolean) => {
    if (mode === 'public') return
    setItems((prev) => prev.map((b) => ({ ...b, toPrivate: checked })))
  }

  const setAllPublic = (checked: boolean) => {
    if (mode === 'private') return
    setItems((prev) => prev.map((b) => (b.publicLocked ? b : { ...b, toPublic: checked })))
  }

  const patchItem = (id: string, patch: Partial<StagingItem>) =>
    setItems((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))

  const applyBulk = () => {
    setItems((prev) => prev.map((b) => {
      if (!b.toPrivate && !b.toPublic) return b
      const tag = bulkTag.trim().replace(/^#/, '').slice(0, 24)
      return {
        ...b,
        ...(bulkCategory !== UNCLASSIFIED ? { suggestedCategorySlug: bulkCategory } : {}),
        ...(tag ? { tags: Array.from(new Set([...b.tags, tag])).slice(0, 8) } : {}),
      }
    }))
    setBulkTag('')
  }

  const counts = useMemo(() => {
    const byStatus = { ready: 0, duplicate: 0, private: 0 } as Record<StagingStatus, number>
    for (const item of items) byStatus[item.status]++
    return {
      byStatus,
      privateSelected: items.filter((b) => b.toPrivate).length,
      publicSelected: items.filter((b) => b.toPublic && !b.publicLocked).length,
    }
  }, [items])

  const visibleItems = useMemo(
    () => statusFilter === 'all' ? items : items.filter((b) => b.status === statusFilter),
    [items, statusFilter],
  )

  /** 未展开的行只渲染当前值这一个 option，select 仍显示正确的中文标签 */
  const rowCategoryOptions = (item: StagingItem) =>
    expandedCategoryRow === item.id
      ? categoryOptions
      : [{ slug: item.suggestedCategorySlug, label: categoryOptions.find((o) => o.slug === item.suggestedCategorySlug)?.label ?? '暂不分类（导入后再归类）' }]

  /** AI 批量归类：失败只保留已完成部分，绝不把失败说成成功 */
  const handleAiBatchClassify = async () => {
    if (items.length === 0 || isAiClassifying) return
    setIsAiClassifying(true)
    setError(null)
    let updatedTotal = 0
    try {
      const validCats = categoryOptions.filter((c) => Boolean(c.slug))
      const chunkSize = 30
      const targets = items.filter((b) => b.toPrivate || b.toPublic)
      const listToProcess = targets.length > 0 ? targets : items
      for (let i = 0; i < listToProcess.length; i += chunkSize) {
        const chunk = listToProcess.slice(i, i + chunkSize)
        const res = await fetch('/api/hub/sites/batch-classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: chunk.map((b) => ({ id: b.id, title: b.title, url: b.url, folder: b.folder })),
            categories: validCats,
          }),
        })
        if (!res.ok) continue
        // 响应体不是 JSON 时按「这一批没有可用结果」处理：单批失败不该中断
        // 整个导入流程，后面还有几十批要跑，且用户已看到进度条。
        const data = await res.json().catch(() => {
          /* 响应体不是 JSON：按「本批无可用结果」处理，不中断整个导入/审核流程 */
          return null
        })
        if (data && Array.isArray(data.results)) {
          const map = new Map<string, { categorySlug?: string; description?: string; tags?: string[] }>()
          for (const r of data.results) {
            if (r && typeof r.id === 'string') { map.set(r.id, r); updatedTotal++ }
          }
          setItems((prev) => prev.map((item) => {
            const hit = map.get(item.id)
            if (!hit) return item
            return {
              ...item,
              suggestedCategorySlug: hit.categorySlug || item.suggestedCategorySlug,
              description: hit.description || item.description,
              tags: Array.isArray(hit.tags) && hit.tags.length > 0 ? hit.tags : item.tags,
            }
          }))
        }
      }
      setAiClassifiedCount(updatedTotal)
    } catch {
      setError('AI 批量归类请求超时或繁忙，已保留已完成的分类建议。')
    } finally {
      setIsAiClassifying(false)
    }
  }

  /** 个人收藏写入：同步、无需登录；同时把原文件夹层级落到本地夹子表 */
  const writePrivate = (targets: StagingItem[]) => {
    const now = Date.now()
    let folders: LocalFolder[] = []
    try { folders = parseLocalFolders(window.localStorage.getItem(LOCAL_FOLDERS_STORAGE_KEY)) } catch { /* 隐私模式 */ }
    const folderIdByName = new Map(folders.map((f) => [f.name, f.id]))
    for (const name of Array.from(new Set(targets.map((b) => b.folder).filter((n): n is string => Boolean(n))))) {
      if (folderIdByName.has(name)) continue
      const added = addLocalFolder(folders, name, now)
      if (added.ok) { folders = added.folders; folderIdByName.set(name, added.folder.id) }
    }
    try { window.localStorage.setItem(LOCAL_FOLDERS_STORAGE_KEY, serializeLocalFolders(folders)) } catch { /* 分组能力降级 */ }

    const payload = JSON.stringify({
      version: 1,
      items: targets.map((b) => ({
        siteId: generateBookmarkId(b.url),
        title: b.title,
        href: b.url,
        ...(b.description ? { description: b.description.slice(0, 300) } : {}),
        ...(b.tags.length > 0 ? { tags: b.tags } : {}),
        ...(b.folder && folderIdByName.has(b.folder) ? { folderId: folderIdByName.get(b.folder) } : {}),
        createdAt: now,
      })),
    })
    return favorites.importJson(payload)
  }

  /** 匿名回退：逐条走投稿审核接口（服务端 5 次/小时限流），剩余条目如实报出 */
  const submitViaReview = async (pending: StagingItem[]) => {
    const out = {
      reviewSubmitted: 0, reviewDuplicate: 0, reviewRateLimited: 0,
      reviewSkippedNoCategory: 0, reviewFailed: 0, remaining: [] as StagingItem[],
    }
    let rateLimited = false
    for (const b of pending) {
      if (rateLimited) { out.remaining.push(b); continue }
      const categoryId = categoryIdBySlug.get(b.suggestedCategorySlug)
      if (!categoryId) { out.reviewSkippedNoCategory++; out.remaining.push(b); continue }
      try {
        const res = await fetch('/api/hub/submissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: b.title.slice(0, 120),
            url: b.url,
            description: (b.description ?? '').slice(0, 500),
            categoryId,
            submitterNote: '由 /import 智能书签工作台批量投稿',
          }),
        })
        if (res.status === 409) { out.reviewDuplicate++; continue }
        if (res.status === 429) { rateLimited = true; out.reviewRateLimited++; out.remaining.push(b); continue }
        // 非 JSON 响应走「本次提交失败」分支并计入 out.reviewFailed，
        // 由调用方统一汇报，不在这里抛断整批审核。
        const data = await res.json().catch(() => {
          /* 响应体不是 JSON：按「本批无可用结果」处理，不中断整个导入/审核流程 */
          return null
        })
        if (res.ok && data?.success !== false) { out.reviewSubmitted++; continue }
        out.reviewFailed++
        out.remaining.push(b)
      } catch {
        out.reviewFailed++
        out.remaining.push(b)
      }
    }
    return out
  }

  const handleImport = async () => {
    const toImport = items.filter((b) => b.toPublic && !b.publicLocked)
    const toPrivate = items.filter((b) => b.toPrivate)
    if (toImport.length === 0 && toPrivate.length === 0) return

    setIsImporting(true)
    setError(null)

    let successCount = 0
    let failedCount = 0
    let duplicateCount = 0
    let degradedCount = 0
    let unconfirmedCount = 0
    let usedReviewFallback = false
    let review = {
      reviewSubmitted: 0, reviewDuplicate: 0, reviewRateLimited: 0,
      reviewSkippedNoCategory: 0, reviewFailed: 0, remaining: [] as StagingItem[],
    }

    // 公共库：优先批量直入（管理员可用）；被网关拒绝则整批改走投稿审核
    const chunkSize = 50
    let fallbackFrom = -1
    for (let i = 0; i < toImport.length; i += chunkSize) {
      const chunk = toImport.slice(i, i + chunkSize)
      try {
        const res = await fetch('/api/hub/sites/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sites: chunk.map((b) => ({
              url: b.url,
              title: b.title,
              ...(b.description ? { description: b.description } : {}),
              ...(b.tags.length > 0 ? { tags: b.tags } : {}),
              // 中枢对 id 与 slug 都认；没建议出来就整个字段省略，让它走「未分类」
              ...(b.suggestedCategorySlug ? { categoryId: b.suggestedCategorySlug } : {}),
              source: 'bookmark-import',
            })),
          }),
        })
        if (res.status === 401 || res.status === 403) {
          usedReviewFallback = true
          fallbackFrom = i
          break
        }
        if (res.ok) {
          const data = await res.json().catch(() => {
            return null
          })
          if (data && typeof data.created === 'number') {
            successCount += data.created
            duplicateCount += data.duplicates ?? 0
            // 传了类目但没挂上（类目不存在 / 是一级根）的条数
            degradedCount += data.categoryDegraded ?? 0
          } else {
            // 2xx 但读不出条数（代理回了异常页 / 字段缺失）：记成「未确认」
            unconfirmedCount += chunk.length
          }
        } else {
          failedCount += chunk.length
        }
      } catch {
        failedCount += chunk.length
      }
    }

    if (usedReviewFallback) {
      const remaining = toImport.slice(Math.max(fallbackFrom, 0))
      failedCount = 0
      review = await submitViaReview(remaining)
    }

    // 个人收藏：无论公共库结果如何都照常写入，且绝不跨页跳转
    const privateResult = toPrivate.length > 0
      ? writePrivate(toPrivate)
      : { ok: true, imported: 0, skippedInvalid: 0, error: undefined }

    setImportResult({
      success: successCount,
      failed: failedCount,
      duplicate: duplicateCount,
      degraded: degradedCount,
      unconfirmed: unconfirmedCount,
      privateImported: privateResult.ok ? privateResult.imported : 0,
      privateSkippedInvalid: privateResult.skippedInvalid,
      privateError: privateResult.ok ? null : (privateResult.error ?? '本地存储不可用'),
      ...review,
      usedReviewFallback,
    })
    setIsImporting(false)
  }

  const downloadRemaining = () => {
    if (!importResult?.remaining.length) return
    const blob = new Blob([JSON.stringify({
      version: 1,
      note: '待投稿清单：登录或等待限流窗口后，可回到 /import 粘贴本清单继续提交',
      items: importResult.remaining.map((b) => ({
        title: b.title, url: b.url, tags: b.tags,
        categorySlug: b.suggestedCategorySlug, folder: b.folder,
      })),
    }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `navhub-待投稿清单-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const shortcut = platform ?? platformShortcut('')

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-8 space-y-5 sm:space-y-6">
      {/* Hero：胶囊内联，右侧改为微缩解析流向，消除三行堆叠的头重脚轻 */}
      <section className="relative overflow-hidden rounded-2xl border border-border/80 p-4 sm:p-7 glass-surface subtle-mesh shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div className="min-w-0 space-y-2.5">
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm" className="h-7 px-2.5 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-background/80 border border-border/50 gap-1.5">
                <Link href="/"><ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /><span>返回主页</span></Link>
              </Button>
              <span className="text-xs text-muted-foreground">/ 智能书签导入</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2.5">
              <Upload className="w-6 h-6 text-indigo-500 shrink-0" aria-hidden="true" />
              <span>浏览器书签一键智能导入</span>
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl leading-relaxed">
              一次解析 HTML 书签、Markdown、OneTab 与 JSON，纯前端完成隐私脱敏、公共库去重与启发式归类，再决定哪些进私有收藏、哪些贡献公共导航库。
            </p>
            <div className="inline-flex flex-wrap items-center gap-2 pt-0.5" aria-label="能力标签">
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />纯前端本地解析
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-medium">启发式自动归类</span>
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-muted/60 text-muted-foreground border border-border/50 font-medium">
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />零外泄隐私保护
              </span>
            </div>
          </div>
          <div className="hidden lg:flex shrink-0 items-center gap-1.5 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 text-[11px] text-muted-foreground" aria-label="解析流程示意">
            <span className="font-mono">解析</span><ArrowRight className="w-3 h-3" aria-hidden="true" />
            <span className="font-mono">脱敏</span><ArrowRight className="w-3 h-3" aria-hidden="true" />
            <span className="font-mono">去重</span><ArrowRight className="w-3 h-3" aria-hidden="true" />
            <span className="font-mono">分流</span>
          </div>
        </div>
      </section>

      {/* 双目标模式：单一 Segmented Switcher，彻底移除强制跳往 /favorites 的中断式设计 */}
      <section aria-labelledby="mode-heading" className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="mode-heading" className="text-sm font-bold text-foreground">选择导入目标</h2>
          <Link href="/favorites" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors">
            查看我的收藏夹 <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        </div>
        <div role="tablist" aria-label="导入目标模式" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {MODE_META.map(({ key, label, hint, icon: Icon }) => {
            const active = mode === key
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => changeMode(key)}
                className={`text-left rounded-xl border p-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  active ? 'border-primary/50 bg-primary/5 shadow-xs' : 'border-border/70 bg-background/40 hover:border-primary/30'
                }`}
              >
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />{label}
                </span>
                <span className="block text-[11px] text-muted-foreground leading-relaxed mt-1">{hint}</span>
              </button>
            )
          })}
        </div>
      </section>

      <Card className="glass-surface rounded-2xl border-border/80 shadow-xs overflow-hidden">
        <CardContent className="p-4 sm:p-6 space-y-4 sm:space-y-5">
          {/* 多格式输入：文件 + 直接粘贴，隐藏原生 input 用 sr-only + label 关联 */}
          <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
            <div role="tablist" aria-label="输入方式" className="inline-flex rounded-lg bg-muted/60 p-0.5">
              {([['file', '文件上传'], ['paste', '直接粘贴文本 / URL']] as const).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={inputTab === key}
                  onClick={() => setInputTab(key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    inputTab === key ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                  }`}>{label}</button>
              ))}
            </div>
            {items.length > 0 && (
              <button type="button" onClick={resetAll} aria-label="清空当前解析结果"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-1">
                <X className="w-3.5 h-3.5" aria-hidden="true" />清空
              </button>
            )}
          </div>

          {inputTab === 'file' ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              className={`rounded-2xl border-2 border-dashed p-4 sm:p-6 transition-all ${isDragging ? 'border-primary bg-primary/10' : 'border-border/80 bg-muted/20'}`}
            >
              <input
                ref={fileInputRef}
                id="bookmark-file-input"
                type="file"
                accept=".html,.htm,.md,.json,.txt"
                multiple
                aria-labelledby="dropzone-title"
                onChange={(e) => { if (e.target.files?.length) void readFiles(e.target.files) }}
                className="sr-only peer"
              />
              <label htmlFor="bookmark-file-input" id="dropzone-title"
                className="flex flex-col items-center gap-2 text-center cursor-pointer rounded-xl p-2 peer-focus-visible:ring-2 peer-focus-visible:ring-primary">
                <span className="w-11 h-11 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/20 border border-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <FileUp className="w-5 h-5" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold text-foreground">点击选择或拖拽书签文件至此</span>
                <span className="text-xs text-muted-foreground">支持 .html / .md / .json / .txt（OneTab），可一次拖入多个文件累加解析</span>
              </label>
              <div className="mt-3 pt-3 border-t border-border/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  <kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono text-xs">{shortcut.keys}</kbd>{' '}
                  {shortcut.hint}
                </p>
                <Button type="button" size="sm" variant="outline" onClick={loadSample}
                  className="h-8 text-xs gap-1.5 rounded-lg shrink-0 border-primary/40 text-primary hover:bg-primary/10">
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />加载示例书签体验解析
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <label htmlFor="bookmark-paste" className="text-xs font-semibold text-foreground">
                粘贴书签文本 / URL 列表
              </label>
              <textarea
                id="bookmark-paste"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={7}
                placeholder={'支持：\nhttps://example.com | 站点标题\n- [标题](https://example.com)\n或者直接粘贴 bookmarks.html 内容'}
                className="w-full rounded-xl border border-border/70 bg-background/60 p-3 text-xs font-mono outline-none focus:ring-2 focus:ring-primary resize-y"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" onClick={() => ingest(pasteText, '粘贴内容', true)} disabled={!pasteText.trim()}
                  className="h-8 text-xs gap-1.5 rounded-lg"><Layers className="w-3.5 h-3.5" aria-hidden="true" />解析粘贴内容</Button>
                <Button type="button" size="sm" variant="outline" onClick={loadSample}
                  className="h-8 text-xs gap-1.5 rounded-lg"><Sparkles className="w-3.5 h-3.5" aria-hidden="true" />加载示例书签</Button>
              </div>
            </div>
          )}

          {isParsing && (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground" role="status">
              <Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden="true" />正在本地解析、脱敏与去重...
            </div>
          )}

          {error && (
            <div role="alert" className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" /><span>{error}</span>
            </div>
          )}

          {!indexReady && (
            <div role="status" className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs">
              公共库索引暂不可用，「已收录」去重本次未生效；个人收藏导入与隐私拦截不受影响。
            </div>
          )}

          {/* 结果台账：成功 / 失败 / 未确认 / 限流剩余分开报，绝不把假成功说成导入完成 */}
          {importResult && (
            <div className={`p-4 rounded-xl text-xs space-y-2 ${
              importResult.failed + importResult.unconfirmed + importResult.reviewFailed > 0 || importResult.privateError
                ? 'bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300'
                : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
            }`} role="status">
              <div className="flex items-center gap-2 font-bold text-sm">
                {importResult.failed + importResult.unconfirmed > 0 ? <AlertCircle className="w-4 h-4" aria-hidden="true" /> : <CheckCircle className="w-4 h-4" aria-hidden="true" />}
                <span>{importResult.failed + importResult.unconfirmed > 0 ? '导入结束，但有内容没确认收录' : '导入完成！'}</span>
              </div>
              <p>
                个人收藏写入 {importResult.privateImported} 条
                {importResult.privateSkippedInvalid > 0 ? `，格式不合法跳过 ${importResult.privateSkippedInvalid} 条` : ''}
                {importResult.privateError ? `（失败：${importResult.privateError}）` : ''}；
                {importResult.usedReviewFallback
                  ? `公共库投稿审核：成功 ${importResult.reviewSubmitted} 条、已存在 ${importResult.reviewDuplicate} 条`
                  : `公共库成功收录 ${importResult.success} 个站点`}
                {importResult.duplicate > 0 ? `，已存在跳过 ${importResult.duplicate} 个` : ''}
                {importResult.failed > 0 ? `，失败 ${importResult.failed} 个` : ''}
                {importResult.unconfirmed > 0 ? `，${importResult.unconfirmed} 个未能确认（服务端返回异常，可重新导入这批）` : ''}
                {importResult.degraded > 0 ? `；其中 ${importResult.degraded} 个所选分类不存在或是一级分类，已落到「未分类」` : ''}。
              </p>
              {importResult.usedReviewFallback && (
                <p className="leading-relaxed">
                  当前为匿名访客，批量直入接口需要管理员授权，已自动改走公开投稿审核队列。
                  {importResult.reviewRateLimited > 0 ? ` 投稿接口触发限流，本次剩余 ${importResult.remaining.length} 条未提交。` : ''}
                  {importResult.reviewSkippedNoCategory > 0 ? ` 另有 ${importResult.reviewSkippedNoCategory} 条缺少可挂载分类，请在预览表批量改绑后重试。` : ''}
                  {importResult.reviewFailed > 0 ? ` ${importResult.reviewFailed} 条投稿失败。` : ''}
                </p>
              )}
              {importResult.remaining.length > 0 && (
                <Button type="button" size="sm" variant="outline" onClick={downloadRemaining}
                  className="h-8 text-xs gap-1.5 rounded-lg">
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />导出 {importResult.remaining.length} 条待投稿清单
                </Button>
              )}
            </div>
          )}

          {/* Staging Table */}
          {items.length > 0 && (
            <div className="space-y-3.5 pt-4 border-t border-border/60">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-foreground">解析出 {items.length} 个书签</span>
                    <Badge variant="secondary" className="font-mono bg-muted/80 px-2 py-0.5 rounded-full">个人收藏 {counts.privateSelected}</Badge>
                    <Badge variant="secondary" className="font-mono bg-muted/80 px-2 py-0.5 rounded-full">公共投稿 {counts.publicSelected}</Badge>
                    {aiClassifiedCount > 0 && <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">✨ AI 补全 {aiClassifiedCount} 条</Badge>}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    格式 {parseMeta?.format ?? '—'} · 公共库索引 {indexReady ? publicSiteCount : '不可用'} 站 · 识别文件夹 {parseMeta?.folders ?? 0} 个 · 批内重复丢弃 {parseMeta?.duplicates ?? 0} 条
                    {parseMeta?.skipped ? ` · 解析跳过 ${parseMeta.skipped} 条` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 rounded-lg" disabled={isAiClassifying || isImporting} onClick={handleAiBatchClassify}>
                    {isAiClassifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />}
                    <span>{isAiClassifying ? 'AI 正在归类...' : '✨ AI 智能归类'}</span>
                  </Button>
                  <Button size="sm" className="h-8 text-xs gap-1.5 rounded-lg shadow-xs"
                    disabled={counts.privateSelected + counts.publicSelected === 0 || isImporting} onClick={handleImport}>
                    {isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Upload className="w-3.5 h-3.5" aria-hidden="true" />}
                    <span>
                      {isImporting
                        ? '正在导入...'
                        : mode === 'private'
                          ? `导入个人收藏夹（${counts.privateSelected} 条）`
                          : mode === 'public'
                            ? `提交公共导航库（${counts.publicSelected} 条）`
                            : `一键分流导入（私有 ${counts.privateSelected} / 公共 ${counts.publicSelected}）`}
                    </span>
                  </Button>
                </div>
              </div>

              {/* 状态过滤 + 批量操作 */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-background/40 p-2.5">
                <div className="inline-flex flex-wrap gap-1" role="group" aria-label="按状态筛选">
                  {([['all', `全部 ${items.length}`], ['ready', `可投稿 ${counts.byStatus.ready}`], ['duplicate', `已收录 ${counts.byStatus.duplicate}`], ['private', `隐私拦截 ${counts.byStatus.private}`]] as const).map(([key, label]) => (
                    <button key={key} type="button" aria-pressed={statusFilter === key} onClick={() => setStatusFilter(key)}
                      className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        statusFilter === key ? 'bg-primary text-primary-foreground' : 'bg-muted/70 text-muted-foreground hover:text-foreground'
                      }`}>{label}</button>
                  ))}
                </div>
                <span className="hidden sm:inline h-4 w-px bg-border" aria-hidden="true" />
                {mode !== 'public' && (
                  <>
                    <button type="button" onClick={() => setAllPrivate(true)} className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">全选私有</button>
                    <button type="button" onClick={() => setAllPrivate(false)} className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">清空私有</button>
                  </>
                )}
                {mode !== 'private' && (
                  <button type="button" onClick={() => setAllPublic(true)} className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">全选可投稿</button>
                )}
                <select aria-label="批量改绑分类" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)}
                  className="h-7 bg-background border border-border/70 rounded-md px-2 text-[11px] outline-none focus:ring-1 focus:ring-primary max-w-[10rem]">
                  {categoryOptions.map((opt) => <option key={opt.slug || '__unclassified__'} value={opt.slug}>{opt.label}</option>)}
                </select>
                <label className="sr-only" htmlFor="bulk-tag">批量补充标签</label>
                <input id="bulk-tag" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} placeholder="#标签"
                  className="h-7 w-20 bg-background border border-border/70 rounded-md px-2 text-[11px] outline-none focus:ring-1 focus:ring-primary" />
                <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 rounded-md" onClick={applyBulk}>
                  <Tag className="w-3 h-3" aria-hidden="true" />批量应用
                </Button>
              </div>

              <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-border/80 divide-y divide-border/50 text-xs bg-background/50" role="table" aria-label="书签解析预览">
                {visibleItems.length === 0 && (
                  <p className="p-6 text-center text-muted-foreground">当前筛选下没有条目</p>
                )}
                {visibleItems.map((b) => (
                  <div key={b.id} role="row"
                    className="[content-visibility:auto] [contain-intrinsic-size:auto_88px] flex flex-col sm:flex-row sm:items-center gap-2.5 p-3 hover:bg-muted/40 transition-colors">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <input aria-label={`将「${b.title}」存入个人收藏`} type="checkbox" checked={b.toPrivate}
                        disabled={mode === 'public'} onChange={() => togglePrivate(b.id)}
                        className="rounded border-border text-primary focus:ring-primary h-4 w-4 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-foreground truncate max-w-[16rem]">{b.title}</span>
                          <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${STATUS_META[b.status].className}`}>
                            {b.status === 'private' && <Lock className="w-2.5 h-2.5" aria-hidden="true" />}{STATUS_META[b.status].label}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground border border-border/50">{CONFIDENCE_META[b.confidence]}</span>
                          {b.folder && <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded truncate max-w-[8rem]">{b.folder}</span>}
                        </div>
                        <p className="text-[11px] text-muted-foreground/80 truncate font-mono" title={b.originalUrl}>{b.url}</p>
                        {(b.privacyReason || b.tags.length > 0) && (
                          <p className="text-[10px] text-muted-foreground leading-snug">
                            {b.privacyReason ? `${b.privacyReason}，仅限个人收藏` : ''}
                            {b.tags.length > 0 ? ` · ${b.tags.map((t) => `#${t}`).join(' ')}` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pl-6 sm:pl-0 shrink-0">
                      <select aria-label={`为「${b.title}」选择分类`} value={b.suggestedCategorySlug}
                        onPointerDown={() => setExpandedCategoryRow(b.id)}
                        onFocus={() => setExpandedCategoryRow(b.id)}
                        onBlur={() => setExpandedCategoryRow((cur) => (cur === b.id ? null : cur))}
                        onChange={(e) => { patchItem(b.id, { suggestedCategorySlug: e.target.value }); setExpandedCategoryRow(null) }}
                        className="max-w-[11rem] bg-background border border-border/70 rounded-lg px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-primary">
                        {rowCategoryOptions(b).map((opt) => <option key={opt.slug || '__unclassified__'} value={opt.slug}>{opt.label}</option>)}
                      </select>
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <input aria-label={`将「${b.title}」提交至公共导航库`} type="checkbox" checked={b.toPublic}
                          disabled={b.publicLocked || mode === 'private'} onChange={() => togglePublic(b.id)}
                          className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5 disabled:opacity-40" />
                        投稿
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
