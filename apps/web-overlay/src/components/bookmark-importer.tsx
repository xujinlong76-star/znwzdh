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
import { snapshotAndRemoveLocal, useFavorites, type LocalFavorite } from '@/hooks/useFavorites'
import {
  generateBookmarkId,
  parseUniversalBookmarks,
  triggerFileDownload,
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
  fingerprintUrl,
  platformShortcut,
  type CategoryNode,
  type Confidence,
  type ImportMode,
  type StagingItem,
  type StagingStatus,
} from '@/lib/import-workbench'
import {
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_ITEMS,
  IMPORT_MAX_PASTE_CHARS,
  IMPORT_PREVIEW_PAGE_SIZE,
  IMPORT_PRIVATE_CHUNK_SIZE,
  IMPORT_WIZARD_RESUME_KEY,
  activeVariantForKept,
  applyOverride,
  buildDedupReport,
  buildLocalFingerprintIndex,
  collectSkippedItems,
  freezeExecutionPlan,
  isAllSkippedSummary,
  type DedupReport,
  type DedupVerdict,
  type DedupVerdictItem,
  type ExecutionPlan,
} from '@/lib/import-dedup-report'
import {
  UNDO_WINDOW_MS,
  newUndoBatchId,
  newUndoId,
  pushGlobalUndo,
} from '@/lib/undo-stack'
import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_BY_ID,
  parseSocialSaves,
  type SocialFailure,
  type SocialPlatformId,
} from '@/lib/social-saves-import'

/** 社交导入失败行下载文件名（与失败行同一份内容，可改后重新导入） */
const SOCIAL_FAILURES_FILENAME = 'social-import-failures.txt'

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
  truncated: boolean
  totalMatched?: number
}

/** 单个失败文件的点名条（多文件其中一个失败时成功文件保留） */
interface FileError {
  name: string
  reason: string
}

type WizardStep = 1 | 2 | 3 | 4

const WIZARD_STEPS: Array<{ step: WizardStep; title: string; hint: string }> = [
  { step: 1, title: '选择来源', hint: '文件 / 粘贴 / 示例' },
  { step: 2, title: '解析预览', hint: '解析结果一览' },
  { step: 3, title: '去重与选择', hint: '去重报告与改判' },
  { step: 4, title: '确认与导入', hint: '冻结清单后执行' },
]

const VERDICT_META: Record<DedupVerdict, { label: string; className: string }> = {
  new: { label: '新增', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25' },
  'exists-local': { label: '已在收藏夹', className: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/25' },
  'exists-public': { label: '已在公共库', className: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/25' },
  'intra-file-dup': { label: '文件内重复', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25' },
  'title-conflict': { label: '标题冲突', className: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/25' },
  'folder-conflict': { label: '文件夹冲突', className: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/25' },
  'private-blocked': { label: '隐私拦截', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25' },
  invalid: { label: '无效', className: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/25' },
}

interface ImportResult {
  success: number
  failed: number
  duplicate: number
  degraded: number
  /** 服务端返回 2xx 但正文读不出条数：既不能算成功也不能算失败 */
  unconfirmed: number
  privateImported: number
  privateUpdated: number
  privateAlreadyExisted: number
  privateSkippedInvalid: number
  privateError: string | null
  /** 本次新增的 siteId（撤销用）；公共库部分不可撤销，不进这里 */
  addedSiteIds: string[]
  /** 取消导入时为 true：汇总文案写“已取消，未导入”，不说“导入完成” */
  cancelled: boolean
  cancelledCount: number
  /** 执行失败 / 取消后未执行的私有条目（可重试 / 下载，报告行） */
  remainingPrivate: DedupVerdictItem[]
  /** 执行失败 / 取消后未提交的公共条目（可重试，报告行） */
  remainingPublic: DedupVerdictItem[]
  /** 执行计划快照（汇总数字与 Step 4 确认文案同源） */
  plan: ExecutionPlan | null
  /** 汇总“跳过”数：totalParsed - totalSelected，从冻结 plan / 报告派生，
   *  不许再拿 writePrivate 的 alreadyExisted（正常流程里它恒为 0） */
  skippedCount: number
  /** 跳过清单（已存在 / 重复 / 无效 / 用户取消勾选），汇总页给示例用 */
  skippedItems: DedupVerdictItem[]
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
  ready: { label: '可投稿', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25' },
  duplicate: { label: '公共库已收录', className: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/25' },
  private: { label: '隐私内网已拦截', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25' },
}

const CONFIDENCE_META: Record<Confidence, string> = {
  high: '高置信', medium: '中置信', low: '低置信', none: '待归类',
}

/**
 * 把 Staging Table 的勾选同步回 DedupReport（同一份报告是数字的唯一来源，
 * 表格只是它的视图；改判走 applyOverride，勾选走这里）。
 * 按条目 id 对应：表格行 id 就是报告里保留条的 id（stage 里对齐过）；
 * 同一指纹的保留条与 dup 条各有独立 id，绝不能再按指纹查——后出现的 dup
 * 会覆盖保留条，行徽标错显、勾选还把两者同时置选中。
 * 行勾选作用在“生效条目”上（有 dup 被改判选中时是 dup，否则是保留条），
 * 同一指纹的另一条同时清零：同一 URL 同时只能有一条生效。
 */
function syncReportSelection(report: DedupReport, items: StagingItem[]): DedupReport {
  const groups = { ...report.groups } as Record<DedupVerdict, DedupReport['groups']['new']>
  for (const key of Object.keys(groups) as DedupVerdict[]) {
    groups[key] = groups[key].map((item) => ({ ...item }))
  }
  const all = (Object.values(groups) as DedupVerdictItem[][]).flat()
  const byId = new Map(all.map((item) => [item.id, item]))
  for (const row of items) {
    const kept = byId.get(row.id)
    if (!kept) continue
    const active = activeVariantForKept(report, kept.id) ?? kept
    const activeCopy = byId.get(active.id)
    if (!activeCopy) continue
    activeCopy.selectedPrivate = row.toPrivate
    activeCopy.selectedPublic = row.toPublic
    // 同一指纹的另一条同时清零：行勾选只代表“这条 URL 选没选”，不许两条同时生效
    for (const other of all) {
      if (other.fingerprint !== kept.fingerprint || other.id === active.id) continue
      other.selectedPrivate = false
      other.selectedPublic = false
    }
  }
  return { ...report, groups }
}

/**
 * 把报告的选中态与生效条目同步回表格行（改判 / 模式切换 / 勾选后调用）。
 * 行勾选跟生效条目走；行标题/文件夹也跟生效条目走——改判“改用这一条”后，
 * 行上显示的就是将要导入的那条的标题/文件夹，而不是保留条的旧值。
 * 标签/描述不跟报告走：它们是表格侧的编辑态（AI 归类/批量改标签只改行）。
 */
function syncStagingFromReport(report: DedupReport, items: StagingItem[]): StagingItem[] {
  return items.map((row) => {
    const active = activeVariantForKept(report, row.id)
    if (!active) return row
    return {
      ...row,
      toPrivate: active.selectedPrivate,
      toPublic: active.selectedPublic,
      title: active.title,
      folder: active.folder,
    }
  })
}

/** 切模式 / 追文件时保留已有改判：按条目 id + 指纹重放（指纹对不上就跳过，
 *  防止追加文件后位置 id 漂移、把旧改判错 apply 到新条目上） */
function collectPreservedOverrides(report: DedupReport | null): Array<{ id: string; fingerprint: string; override: 'keep-existing' | 'use-imported' | 'move-folder' }> {
  if (!report) return []
  return (Object.values(report.groups) as DedupVerdictItem[][])
    .flat()
    .filter((item): item is DedupVerdictItem & { override: 'keep-existing' | 'use-imported' | 'move-folder' } => item.override != null)
    .map((item) => ({ id: item.id, fingerprint: item.fingerprint, override: item.override }))
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
  /** 第 3 批第 1 项：社交收藏归集——来源切换（浏览器书签 / 社交平台导出） */
  const [sourceKind, setSourceKind] = useState<'browser' | 'social'>('browser')
  const [socialPlatform, setSocialPlatform] = useState<SocialPlatformId | 'auto'>('auto')
  /** 社交解析失败的行：逐行点名，可下载后改完重试 */
  const [socialFailures, setSocialFailures] = useState<SocialFailure[]>([])
  const [pasteText, setPasteText] = useState('')
  const [rawItems, setRawItems] = useState<ParsedUniversalItem[]>([])
  /** 解析层按指纹丢掉的批内重复条目（标题/文件夹原样保留）：报告要拿它们
   *  判 intra-file-dup，state 与 rawItems 同步累加/清空 */
  const [droppedDuplicates, setDroppedDuplicates] = useState<ParsedUniversalItem[]>([])
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

  /* ---- 第 2 批第 11 项：4 步向导状态（状态机：不可跳步前进、可任意回退） ---- */
  const [step, setStep] = useState<WizardStep>(1)
  const [dedupReport, setDedupReport] = useState<DedupReport | null>(null)
  const [fileErrors, setFileErrors] = useState<FileError[]>([])
  const [selectedFileNames, setSelectedFileNames] = useState<string[]>([])
  const [previewSearch, setPreviewSearch] = useState('')
  const [previewPage, setPreviewPage] = useState(1)
  const [verdictFilter, setVerdictFilter] = useState<DedupVerdict | 'all'>('all')
  const [folderFilter, setFolderFilter] = useState<string>('all')
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<{ privateDone: number; privateTotal: number; publicDone: number; publicTotal: number; label: string } | null>(null)
  const cancelRequestedRef = useRef(false)
  const [resumeNotice, setResumeNotice] = useState<string | null>(null)
  /** 汇总页持久撤销：8 秒 toast 过期后仍可用，删同一批 addedSiteIds（进回收站 30 天） */
  const [importUndo, setImportUndo] = useState<{ label: string; count: number; updatedCount: number; run: () => Promise<{ ok: boolean; message?: string }> } | null>(null)
  const [undoDone, setUndoDone] = useState(false)
  /** 撤销完成后的文案：只有更新、没有新增时不许写“新增条目已进回收站” */
  const [undoDoneText, setUndoDoneText] = useState<string | null>(null)
  const restoredRef = useRef(false)

  useEffect(() => {
    setPlatform(platformShortcut(navigator.platform || navigator.userAgent))
  }, [])

  const stageRef = useRef<typeof stage | null>(null)

  /* sessionStorage 快照：只存指纹/标题/URL 级快照恢复到 Step 3，不存文件原文 */
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    try {
      const raw = window.sessionStorage.getItem(IMPORT_WIZARD_RESUME_KEY)
      if (!raw) return
      const snap = JSON.parse(raw) as { version?: number; mode?: ImportMode; items?: Array<{ title: string; url: string; folder?: string; tags?: string[]; description?: string }> }
      if (!snap || snap.version !== 1 || !Array.isArray(snap.items) || snap.items.length === 0) return
      const parsed: ParsedUniversalItem[] = snap.items.map((it) => ({
        siteId: generateBookmarkId(it.url),
        title: it.title,
        href: it.url,
        folderName: it.folder,
        tags: it.tags,
        description: it.description,
        createdAt: Date.now(),
      }))
      const snapMode: ImportMode = snap.mode ?? 'split'
      setMode(snapMode)
      setRawItems(parsed)
      stageRef.current?.(parsed, { format: 'html', skipped: 0, folders: 0, truncated: false }, snapMode)
      setStep(3)
      setResumeNotice('已从快照恢复到第 3 步（去重与选择）。文件原文未保存，如需换文件请回到第 1 步重新选择。')
    } catch { /* 快照损坏就当没有，正常从第 1 步开始 */ }
    // 只在挂载时恢复一次
  }, [])

  useEffect(() => {
    if (!dedupReport || step < 2) return
    try {
      const kept = (Object.values(dedupReport.groups) as DedupVerdictItem[][])
        .flat()
        .filter((item) => item.verdict !== 'intra-file-dup' && item.verdict !== 'invalid')
      window.sessionStorage.setItem(IMPORT_WIZARD_RESUME_KEY, JSON.stringify({
        version: 1,
        mode,
        items: kept.map((item) => ({ title: item.title, url: item.url, folder: item.folder, tags: item.tags, description: item.description })),
      }))
    } catch { /* sessionStorage 写不进就跳过，不拦导入 */ }
  }, [dedupReport, step, mode])

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

  /** 本地收藏指纹对照表（文件夹名由 folderId 反查本地夹子表；读不到就留空） */
  const localFingerprintIndex = useCallback(() => {
    let folders: LocalFolder[] = []
    try { folders = parseLocalFolders(window.localStorage.getItem(LOCAL_FOLDERS_STORAGE_KEY)) } catch { /* 隐私模式 */ }
    const nameById = new Map(folders.map((f) => [f.id, f.name]))
    return buildLocalFingerprintIndex(
      favorites.items.map((f) => ({
        siteId: f.siteId,
        title: f.title,
        href: f.href,
        folderName: f.folderId ? nameById.get(f.folderId) : undefined,
      })),
    )
  }, [favorites.items])

  const stage = useCallback((
    parsed: ParsedUniversalItem[],
    meta: Omit<ParseMeta, 'duplicates' | 'dedupeUnavailable'>,
    modeOverride?: ImportMode,
    dropped?: ParsedUniversalItem[],
    preserveOverrides?: Array<{ id: string; fingerprint: string; override: 'keep-existing' | 'use-imported' | 'move-folder' }>,
  ) => {
    const effectiveMode = modeOverride ?? mode
    // 去重报告是数字的唯一来源：解析器只做“语法去重”（items 是去重后产物），
    // 被丢的重复条在 droppedDuplicates 里——报告要对“原始命中清单”
    // （items + droppedDuplicates）建，否则单文件内的重复永远判不出来，
    // intra-file-dup 只对多文件累加可达，同一屏还会出现“批内重复丢弃 0 条”
    // 与“解析跳过 1 条”自相矛盾的双口径。
    const combined = [...parsed, ...(dropped ?? [])]
    let report = buildDedupReport(combined, localFingerprintIndex(), {
      mode: effectiveMode,
      publicIndex: indexReady ? publicIndex : null,
      truncated: meta.truncated,
      totalMatched: meta.totalMatched,
    })
    // 切模式 / 追文件时保留已有改判：报告按新模式重建后，把旧 override
    // 按条目 id 逐条重放（指纹对不上就跳过，防位置 id 漂移错 apply）
    if (preserveOverrides) {
      const all = (Object.values(report.groups) as DedupVerdictItem[][]).flat()
      for (const { id, fingerprint, override } of preserveOverrides) {
        const target = all.find((item) => item.id === id)
        if (target && target.fingerprint === fingerprint) {
          report = applyOverride(report, id, override)
        }
      }
    }
    const kept = Object.values(report.groups)
      .flat()
      .filter((item) => item.verdict !== 'intra-file-dup' && item.verdict !== 'invalid')
      .sort((a, b) => a.sourceIndex - b.sourceIndex)
      .map((item) => combined[item.sourceIndex]!)
    const result = buildStagingItems(kept, indexReady ? publicIndex : null, categories, effectiveMode)
    // 表格行与报告项按条目 id 对应：行 id 就是保留条的报告 id（dedup-N）。
    // 绝不能再按指纹查 verdict——同一指纹的保留条与 dup 条共用一个键，
    // 后出现的 dup 会覆盖保留条（行默认不勾选、徽标错显、执行计两次）。
    // 这里的 keptByFp 只做一次性“行 → 保留条”的对齐（保留条指纹唯一，
    // 不会覆盖），对齐完就按 id 走。
    const keptByFp = new Map(
      Object.values(report.groups)
        .flat()
        .filter((item) => item.verdict !== 'intra-file-dup' && item.verdict !== 'invalid')
        .map((item) => [item.fingerprint, item]),
    )
    const staged = syncStagingFromReport(report, result.items.map((item) => {
      const verdict = keptByFp.get(fingerprintUrl(item.url))
      if (!verdict) return item
      return { ...item, id: verdict.id, toPrivate: verdict.selectedPrivate, toPublic: verdict.selectedPublic }
    }))
    setDedupReport(report)
    setItems(staged)
    setParseMeta({
      ...meta,
      duplicates: report.skippedDuplicates,
      dedupeUnavailable: report.dedupeUnavailable,
    })
    setImportResult(null)
  }, [categories, indexReady, localFingerprintIndex, mode, publicIndex])

  // 恢复快照用：stage 在 resume effect 之后才声明，ref 在这里才赋值
  stageRef.current = stage

  const ingest = useCallback((text: string, filename: string, replace: boolean): boolean => {
    if (!text.trim()) {
      setError(`「${filename}」是空文件，请重新选择。`)
      return false
    }
    setIsParsing(true)
    setError(null)
    setImportResult(null)
    try {
      // 社交来源：走社交导出解析器（本地解析，不登录、不调平台 API）；
      // 解析产物与浏览器书签同一形状，下面的合并 / 去重 / 归类流程共用。
      let parsed: {
        ok: boolean
        format: string
        items: ParsedUniversalItem[]
        detectedFolders: string[]
        skippedCount: number
        droppedDuplicates?: ParsedUniversalItem[]
        error?: string
        truncated?: boolean
        totalMatched?: number
      }
      if (sourceKind === 'social') {
        const social = parseSocialSaves(text, { platform: socialPlatform, filename, limit: IMPORT_MAX_ITEMS })
        setSocialFailures(social.failures)
        if (!social.ok || social.items.length === 0) {
          const first = social.failures[0]
          setError(
            `未能从「${filename}」解析出社交收藏：${social.error ?? '没有有效链接'}。` +
            (first ? `例如第 ${first.line} 行：${first.reason}。` : '') +
            '请确认平台选对、文件是该平台的导出格式，失败行可下载后修改重试。',
          )
          return false
        }
        parsed = {
          ok: true,
          format: `social-${social.platform} (${social.format})`,
          items: social.items,
          detectedFolders: Array.from(new Set(social.items.map((i) => i.folderName).filter((f): f is string => Boolean(f)))),
          skippedCount: social.skippedCount,
          droppedDuplicates: social.droppedDuplicates,
          truncated: social.truncated,
          totalMatched: social.totalMatched,
        }
      } else {
        parsed = parseUniversalBookmarks(text, IMPORT_MAX_ITEMS)
      }
      if (!parsed.ok || parsed.items.length === 0) {
        // 三种空态文案各不相同：空文件 / 无法识别 / 0 条有效链接
        const errText = parsed.error ?? '内容为空'
        if (errText.includes('内容为空')) {
          setError(`「${filename}」是空文件，请重新选择。`)
        } else if (!/https?:\/\//.test(text)) {
          setError(`「${filename}」里没有可识别的 http(s) 链接。请确认文件里有网页地址，或点“加载示例书签”看看格式。`)
        } else {
          setError(`未能从「${filename}」解析出有效书签：${errText}。支持 HTML 书签、Markdown、OneTab / 纯 URL 列表与 JSON 备份。`)
        }
        return false
      }
      // 多文件累加：这里不做 href 去重，批内重复交给去重报告（intra-file-dup）；
      // 解析层丢掉的重复条（droppedDuplicates）与已有改判一起带上，追加文件
      // 不丢 Step 3 已做的改判（换文件 replace 时从头来，不保留）
      const merged = replace ? parsed.items : [...rawItems, ...parsed.items]
      const mergedDropped = replace
        ? (parsed.droppedDuplicates ?? [])
        : [...droppedDuplicates, ...(parsed.droppedDuplicates ?? [])]
      setRawItems(merged)
      setDroppedDuplicates(mergedDropped)
      stage(merged, {
        format: parsed.format,
        skipped: parsed.skippedCount,
        folders: parsed.detectedFolders.length,
        truncated: parsed.truncated ?? false,
        totalMatched: parsed.totalMatched,
      }, undefined, mergedDropped, replace ? undefined : collectPreservedOverrides(dedupReport))
      setStatusFilter('all')
      setPreviewPage(1)
      return true
    } catch (err) {
      setError('解析文件失败: ' + (err instanceof Error ? err.message : String(err)))
      return false
    } finally {
      setIsParsing(false)
    }
  }, [rawItems, droppedDuplicates, dedupReport, stage, sourceKind, socialPlatform])

  const readFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files)
    const errors: FileError[] = []
    const valid: File[] = []
    for (const file of list) {
      // 超限硬拦：读文件前查 size，超 10 MB 不读文件
      // 社交导出多 .js（X 归档）与 .csv（Reddit / GitHub），浏览器书签只认四种
      const allowed = sourceKind === 'social' ? /\.(html?|md|json|txt|csv|js)$/i : /\.(html?|md|json|txt)$/i
      const allowedLabel = sourceKind === 'social' ? '.html / .md / .json / .txt / .csv / .js' : '.html / .md / .json / .txt'
      if (!allowed.test(file.name)) {
        errors.push({ name: file.name, reason: `不支持的文件类型，仅支持 ${allowedLabel}` })
      } else if (file.size > IMPORT_MAX_FILE_BYTES) {
        errors.push({ name: file.name, reason: `文件超过 10 MB 上限（${(file.size / 1048576).toFixed(1)} MB），未读取` })
      } else {
        valid.push(file)
      }
    }
    if (valid.length === 0) {
      setFileErrors(errors)
      setError(errors.length > 0 ? '没有可解析的文件，请重新选择。' : `仅支持 ${sourceKind === 'social' ? '.html / .md / .json / .txt / .csv / .js 六种社交导出文件' : '.html / .htm / .md / .json / .txt 四种书签文件'}。`)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setFileErrors(errors)
    setSelectedFileNames((prev) => [...prev, ...valid.map((f) => f.name)])
    let replace = true
    let anyOk = false
    const failed: FileError[] = []
    for (const file of valid) {
      const text = await file.text()
      const ok = ingest(text, file.name, replace)
      if (ok) {
        anyOk = true
        replace = false
      } else {
        failed.push({ name: file.name, reason: sourceKind === 'social' ? '解析失败，未解析出有效社交收藏' : '解析失败，未解析出有效书签' })
      }
    }
    // 多文件其中一个失败：成功文件保留，失败文件 amber 条逐个点名
    if (failed.length > 0) setFileErrors((prev) => [...prev, ...failed])
    if (anyOk) {
      setError(null)
      setStep(2)
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
    if (ingest(html, '示例书签包.html', true)) setStep(2)
    setInputTab('file')
  }, [ingest, publicIndex, publicSampleUrls])

  const resetAll = useCallback(() => {
    setRawItems([])
    setDroppedDuplicates([])
    setItems([])
    setParseMeta(null)
    setImportResult(null)
    setError(null)
    setSocialFailures([])
    setStatusFilter('all')
    setBulkTag('')
    setDedupReport(null)
    setFileErrors([])
    setSelectedFileNames([])
    setPreviewSearch('')
    setPreviewPage(1)
    setVerdictFilter('all')
    setFolderFilter('all')
    setProgress(null)
    setImportUndo(null)
    setUndoDone(false)
    setUndoDoneText(null)
    setResumeNotice(null)
    cancelRequestedRef.current = false
    try { window.sessionStorage.removeItem(IMPORT_WIZARD_RESUME_KEY) } catch { /* 隐私模式 */ }
    setStep(1)
  }, [])

  const changeMode = (next: ImportMode) => {
    setMode(next)
    setItems((prev) => applyMode(prev, next))
    setImportResult(null)
    // 模式是默认勾选的来源：换模式后按新模式重建去重报告（选择默认值随之变），
    // 但 Step 3 已做的逐条改判要保留——重建后按 id + 指纹逐条重放，不提示重置
    if (rawItems.length > 0 && parseMeta) {
      stage(rawItems, {
        format: parseMeta.format,
        skipped: parseMeta.skipped,
        folders: parseMeta.folders,
        truncated: parseMeta.truncated,
        totalMatched: parseMeta.totalMatched,
      }, next, droppedDuplicates, collectPreservedOverrides(dedupReport))
    }
  }

  // 切收藏来源时清社交失败与错误（原写在来源 tab onClick 内；抽成函数
  // 供点击与键盘漫游共用，行为不变）。
  const switchSourceKind = (key: 'browser' | 'social') => {
    setSourceKind(key)
    setSocialFailures([])
    setError(null)
  }

  // A-2：标准 ARIA Tabs 键盘交互（通用版）。照抄 plugin-detail-view.tsx:143-170
  // 骨架 + A-1 的 disabled 跳过（全量列表保下标映射，步进跳 disabled；
  // 三组 tab 当前均无 disabled，step() 是防后人加）。无 .click()、无 URL 同步。
  // 三组 tablist（导入目标 / 收藏来源 / 输入方式）共用同一 helper，区别只在
  // 顺序常量与选择函数；keys 顺序须与 DOM 里的 tab 顺序一致。
  const handleTabListKeyDown = <K extends string,>(
    event: React.KeyboardEvent<HTMLDivElement>,
    keys: readonly K[],
    select: (key: K) => void,
  ) => {
    const target = event.target as HTMLElement
    if (target.getAttribute('role') !== 'tab') return
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    )
    const index = tabs.indexOf(target as HTMLButtonElement)
    if (index < 0) return

    const enabled = tabs.map((t) => !t.disabled)
    if (!enabled.some(Boolean)) return
    const step = (from: number, dir: 1 | -1): number => {
      let i = from
      for (let n = 0; n < tabs.length; n++) {
        i = (i + dir + tabs.length) % tabs.length
        if (enabled[i]) return i
      }
      return from
    }
    const firstEnabled = enabled.findIndex(Boolean)
    const lastEnabled = enabled.lastIndexOf(true)

    let next = index
    if (event.key === 'ArrowRight') next = step(index, 1)
    else if (event.key === 'ArrowLeft') next = step(index, -1)
    else if (event.key === 'Home') next = firstEnabled
    else if (event.key === 'End') next = lastEnabled
    else return

    event.preventDefault()
    select(keys[next])
    tabs[next]?.focus()
  }

  /** 勾选是报告的视图：改 items 的同时把同一份选择同步回 DedupReport，
   *  再把生效条目（改判后的标题/文件夹）同步回行，避免行显示与将要导入的不一致 */
  const applyItemSelection = (next: StagingItem[]) => {
    if (!dedupReport) {
      setItems(next)
      return
    }
    const synced = syncReportSelection(dedupReport, next)
    setDedupReport(synced)
    setItems(syncStagingFromReport(synced, next))
  }

  // 模式是硬约束，不只是「预设勾选」：只导入个人收藏时不许再勾公共投稿，反之亦然
  const togglePrivate = (id: string) => {
    if (mode === 'public') return
    applyItemSelection(items.map((b) => (b.id === id ? { ...b, toPrivate: !b.toPrivate } : b)))
  }

  const togglePublic = (id: string) => {
    if (mode === 'private') return
    applyItemSelection(items.map((b) => (b.id === id && !b.publicLocked ? { ...b, toPublic: !b.toPublic } : b)))
  }

  const setAllPrivate = (checked: boolean) => {
    if (mode === 'public') return
    applyItemSelection(items.map((b) => ({ ...b, toPrivate: checked })))
  }

  const setAllPublic = (checked: boolean) => {
    if (mode === 'private') return
    applyItemSelection(items.map((b) => (b.publicLocked ? b : { ...b, toPublic: checked })))
  }

  /** 逐条改判（标题/文件夹冲突、已存在、文件内重复互换） */
  const handleOverride = (id: string, override: 'keep-existing' | 'use-imported' | 'move-folder') => {
    if (!dedupReport) return
    const next = applyOverride(dedupReport, id, override)
    setDedupReport(next)
    // 表格行与报告项按条目 id 对应（行 id 就是保留条的报告 id）；同步时
    // 勾选与标题/文件夹都跟生效条目走（改用 dup 后行上就是 dup 的标题）
    setItems((prev) => syncStagingFromReport(next, prev))
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

  /** 报告按条目 id 查 verdict（表格行徽标与改判按钮的来源）：行 id 就是
   *  保留条的报告 id；按指纹查会让后出现的 dup 覆盖保留条 */
  const reportItemById = useMemo(() => {
    if (!dedupReport) return new Map<string, DedupVerdictItem>()
    return new Map(
      (Object.values(dedupReport.groups) as DedupVerdictItem[][])
        .flat()
        .map((item) => [item.id, item]),
    )
  }, [dedupReport])

  const folderNames = useMemo(
    () => Array.from(new Set(items.map((b) => b.folder ?? '未分组'))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [items],
  )

  /** 预览过滤：搜索（标题/URL/文件夹子串）+ verdict 分组 + 文件夹 + 状态，四者叠加 */
  const filteredItems = useMemo(() => {
    const q = previewSearch.trim().toLowerCase()
    return items.filter((b) => {
      if (q && !(b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q) || (b.folder ?? '').toLowerCase().includes(q))) return false
      if (verdictFilter !== 'all') {
        const verdict = reportItemById.get(b.id)?.verdict
        if (verdict !== verdictFilter) return false
      }
      if (folderFilter !== 'all' && (b.folder ?? '未分组') !== folderFilter) return false
      if (statusFilter !== 'all' && b.status !== statusFilter) return false
      return true
    })
  }, [items, previewSearch, verdictFilter, folderFilter, statusFilter, reportItemById])

  /** 分页每页 50 条：总数、页数、当前页范围全部由同一份 items 派生 */
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / IMPORT_PREVIEW_PAGE_SIZE))
  const safePage = Math.min(previewPage, pageCount)
  const pageItems = useMemo(
    () => filteredItems.slice((safePage - 1) * IMPORT_PREVIEW_PAGE_SIZE, safePage * IMPORT_PREVIEW_PAGE_SIZE),
    [filteredItems, safePage],
  )

  /** 全选/反选作用域永远是当前过滤结果（不是整批），文案写清条数 */
  const selectFilteredPrivate = (checked: boolean) => {
    if (mode === 'public') return
    const ids = new Set(filteredItems.map((b) => b.id))
    applyItemSelection(items.map((b) => (ids.has(b.id) ? { ...b, toPrivate: checked } : b)))
  }
  const selectFilteredPublic = (checked: boolean) => {
    if (mode === 'private') return
    const ids = new Set(filteredItems.map((b) => b.id))
    applyItemSelection(items.map((b) => (ids.has(b.id) && !b.publicLocked ? { ...b, toPublic: checked } : b)))
  }
  const invertFiltered = () => {
    const ids = new Set(filteredItems.map((b) => b.id))
    applyItemSelection(items.map((b) => {
      if (!ids.has(b.id)) return b
      return {
        ...b,
        toPrivate: mode === 'public' ? b.toPrivate : !b.toPrivate,
        toPublic: mode === 'private' || b.publicLocked ? b.toPublic : !b.toPublic,
      }
    }))
  }

  const visibleItems = pageItems

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

  /**
   * 个人收藏写入：每 100 条一次 importJson（总协调人决策 3），chunk 间
   * requestAnimationFrame 让出主线程更新进度；取消只在 chunk 边界生效，
   * 已写入的不回滚。返回实际新增/更新/跳过数与 addedSiteIds（撤销用），
   * 以及改判更新过的旧值快照（只放内存，供同一条撤销恢复标题/文件夹）。
   */
  const writePrivate = async (
    targets: Array<Pick<StagingItem, 'title' | 'url' | 'folder' | 'tags' | 'description'>>,
    opts: { onProgress: (done: number, total: number) => void; shouldCancel: () => boolean },
  ) => {
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

    // 改判更新的旧值快照：执行前按指纹找回已存条目（标题/文件夹/标签原值）
    const updatedSnapshot = new Map<string, LocalFavorite>()
    for (const target of targets) {
      const fp = fingerprintUrl(target.url)
      const existing = favorites.items.find((f) => fingerprintUrl(f.href) === fp)
      if (existing && !updatedSnapshot.has(existing.siteId)) updatedSnapshot.set(existing.siteId, { ...existing })
    }

    let imported = 0
    let updated = 0
    let alreadyExisted = 0
    let skippedInvalid = 0
    const addedSiteIds: string[] = []
    let processed = 0
    let cancelled = false
    let error: string | null = null
    for (let start = 0; start < targets.length; start += IMPORT_PRIVATE_CHUNK_SIZE) {
      if (opts.shouldCancel()) { cancelled = true; break }
      const chunk = targets.slice(start, start + IMPORT_PRIVATE_CHUNK_SIZE)
      const payload = JSON.stringify({
        version: 1,
        items: chunk.map((b) => ({
          siteId: generateBookmarkId(b.url),
          title: b.title,
          href: b.url,
          ...(b.description ? { description: b.description.slice(0, 300) } : {}),
          ...(b.tags.length > 0 ? { tags: b.tags } : {}),
          ...(b.folder && folderIdByName.has(b.folder) ? { folderId: folderIdByName.get(b.folder) } : {}),
          createdAt: now,
        })),
      })
      const result = favorites.importJson(payload)
      if (!result.ok) {
        error = result.error ?? '本地存储不可用'
        break
      }
      imported += result.imported
      updated += result.updated
      alreadyExisted += result.alreadyExisted
      skippedInvalid += result.skippedInvalid
      addedSiteIds.push(...result.addedSiteIds)
      processed += chunk.length
      opts.onProgress(processed, targets.length)
      // 让出主线程，进度条才有机会刷新
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return { ok: error === null, imported, updated, alreadyExisted, skippedInvalid, addedSiteIds, processed, cancelled, error, updatedSnapshot }
  }

  /** 匿名回退：逐条走投稿审核接口（服务端 5 次/小时限流），剩余条目如实报出 */
  const submitViaReview = async (pending: StagingItem[]) => {
    const out = {
      reviewSubmitted: 0, reviewDuplicate: 0, reviewRateLimited: 0,
      reviewSkippedNoCategory: 0, reviewFailed: 0, remaining: [] as StagingItem[],
      cancelled: false,
      /** 因取消未执行的条数（只计取消，不含失败/限流/缺分类——汇总“已取消”不许再拿失败充数） */
      cancelledCount: 0,
    }
    let rateLimited = false
    for (const b of pending) {
      // 取消只在条目边界生效：进行中的一次 fetch 不中断，剩余记为“已取消，未导入”
      if (cancelRequestedRef.current) { out.cancelled = true; out.cancelledCount++; out.remaining.push(b); continue }
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

  /**
   * 执行冻结清单：只读 executionPlan，执行中不再重算——预览数 = 执行数。
   * 两段进度（个人 a/b 条、公共 c/d 批）；取消只在 chunk/条目边界生效，
   * 不回滚已写入，剩余记为“已取消，未导入”。
   */
  const executeImport = async (
    plan: ExecutionPlan,
    skipped?: { skippedCount: number; skippedItems: DedupVerdictItem[] },
  ) => {
    // Staging 行是标签/描述/分类建议的最新来源；报告行是标题/文件夹改判的来源
    const stagingByFp = new Map(items.map((b) => [fingerprintUrl(b.url), b]))
    const enrich = (v: DedupVerdictItem): DedupVerdictItem => {
      const st = stagingByFp.get(v.fingerprint)
      return st ? { ...v, tags: st.tags, description: st.description } : v
    }
    const toPrivate = plan.privateItems.map(enrich)
    // 公共投稿同样以报告行为准：改判“改用这一条”后，投稿标题是 dup 的，
    // 不能拿保留条那行的旧标题去投（文件夹不进投稿体，保留行上的值；
    // 直接展开 folder: v.folder 会把可选属性写成必填，StagingItem 收不下）
    const toImport = plan.publicItems
      .map((v) => {
        const st = stagingByFp.get(v.fingerprint)
        return st ? { ...st, title: v.title } : undefined
      })
      .filter((b): b is StagingItem => Boolean(b))
    if (toImport.length === 0 && toPrivate.length === 0) return

    setIsImporting(true)
    setError(null)
    cancelRequestedRef.current = false
    const publicBatches = Math.max(1, Math.ceil(toImport.length / 50))
    setProgress({ privateDone: 0, privateTotal: toPrivate.length, publicDone: 0, publicTotal: publicBatches, label: '正在提交公共库…' })

    let successCount = 0
    let failedCount = 0
    let duplicateCount = 0
    let degradedCount = 0
    let unconfirmedCount = 0
    let usedReviewFallback = false
    let cancelled = false
    /** 因取消未执行的公共库条数（只计取消，不含失败/限流——汇总“已取消”不许拿失败充数） */
    let publicCancelledCount = 0
    let publicRemaining: StagingItem[] = []
    let review = {
      reviewSubmitted: 0, reviewDuplicate: 0, reviewRateLimited: 0,
      reviewSkippedNoCategory: 0, reviewFailed: 0, remaining: [] as StagingItem[],
      cancelled: false, cancelledCount: 0,
    }

    // 公共库：优先批量直入（管理员可用）；被网关拒绝则整批改走投稿审核
    const chunkSize = 50
    let fallbackFrom = -1
    for (let i = 0; i < toImport.length; i += chunkSize) {
      if (cancelRequestedRef.current) {
        cancelled = true
        publicCancelledCount = toImport.length - i
        publicRemaining = toImport.slice(i)
        break
      }
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
          publicRemaining.push(...chunk)
        }
      } catch {
        failedCount += chunk.length
        publicRemaining.push(...chunk)
      }
      setProgress((prev) => prev ? { ...prev, publicDone: Math.floor(i / chunkSize) + 1, label: '正在提交公共库…' } : prev)
    }

    if (usedReviewFallback && !cancelRequestedRef.current) {
      const remaining = toImport.slice(Math.max(fallbackFrom, 0))
      failedCount = 0
      review = await submitViaReview(remaining)
      if (review.cancelled) cancelled = true
      publicCancelledCount = review.cancelledCount
      publicRemaining = [...publicRemaining, ...review.remaining]
    } else if (usedReviewFallback) {
      cancelled = true
      publicCancelledCount = toImport.length - Math.max(fallbackFrom, 0)
      publicRemaining = toImport.slice(Math.max(fallbackFrom, 0))
    }

    // 个人收藏：无论公共库结果如何都照常写入，且绝不跨页跳转
    setProgress((prev) => prev ? { ...prev, label: '正在写入个人收藏…' } : prev)
    const privateResult = toPrivate.length > 0
      ? await writePrivate(toPrivate, {
        onProgress: (done, total) => setProgress((prev) => prev ? { ...prev, privateDone: done, privateTotal: total } : prev),
        shouldCancel: () => cancelRequestedRef.current,
      })
      : { ok: true, imported: 0, updated: 0, alreadyExisted: 0, skippedInvalid: 0, addedSiteIds: [] as string[], processed: 0, cancelled: false, error: null as string | null, updatedSnapshot: new Map<string, LocalFavorite>() }
    if (privateResult.cancelled) cancelled = true
    const remainingPrivate = privateResult.error !== null || privateResult.cancelled
      ? toPrivate.slice(privateResult.processed)
      : []
    const remainingPublicPlan = plan.publicItems.filter((v) => publicRemaining.some((b) => fingerprintUrl(b.url) === v.fingerprint))

    // 撤销衔接（第 1 批全局撤销）：8 秒 toast 一键撤销 + 汇总页持久按钮，
    // 两条路径删同一批 addedSiteIds（进 30 天回收站）；改判更新的旧值
    // 进同一条撤销快照（只放内存）；公共库部分明确不可撤销。
    // 无论 privateResult.ok 与否，已写入的前缀 chunk 都可撤销：ok=false 只说明
    // 停在某个 chunk（quota / 存储不可用），之前 chunk 的 addedSiteIds 与
    // 更新快照真实存在——按 ok 清零会让已写入的前缀失去撤销入口。
    const addedCount = privateResult.addedSiteIds.length
    const updatedCount = privateResult.updated
    if (addedCount > 0 || updatedCount > 0) {
      const addedSiteIds = [...privateResult.addedSiteIds]
      const updatedSnapshot = privateResult.updatedSnapshot
      const batchId = newUndoBatchId()
      let undone = false
      const undoRun = async (): Promise<{ ok: boolean; message?: string }> => {
        if (undone) return { ok: true, message: '本次导入已撤销' }
        undone = true
        if (addedSiteIds.length > 0) {
          const removed = snapshotAndRemoveLocal(addedSiteIds, 'batch')
          if (!removed) return { ok: false, message: '本机存储不可用，撤销未完成' }
        }
        if (updatedSnapshot.size > 0) {
          const restore = favorites.importJson(JSON.stringify({ version: 1, items: [...updatedSnapshot.values()] }))
          if (!restore.ok) return { ok: false, message: '新增条目已删除，但旧标题/文件夹恢复失败' }
        }
        return { ok: true }
      }
      const now = Date.now()
      pushGlobalUndo({
        id: newUndoId(),
        batchId,
        kind: 'favorite.import-batch',
        // 只有更新、没有新增时不许写“已导入 0 条收藏”
        label: addedCount > 0 && updatedCount > 0
          ? `已导入 ${addedCount} 条收藏、更新 ${updatedCount} 条`
          : addedCount > 0
            ? `已导入 ${addedCount} 条收藏`
            : `已更新 ${updatedCount} 条收藏`,
        createdAt: now,
        expiresAt: now + UNDO_WINDOW_MS,
        count: Math.max(addedCount + updatedCount, 1),
        trashRef: addedCount > 0 ? { batchId, count: addedCount } : undefined,
        undo: undoRun,
      })
      setImportUndo({
        label: addedCount > 0
          ? `删除本次导入的 ${addedCount} 条（可在回收站找回 30 天）${updatedCount > 0 ? `，并恢复 ${updatedCount} 条的原标题/文件夹` : ''}`
          : `恢复本次更新的 ${updatedCount} 条收藏的原标题/文件夹`,
        count: addedCount,
        updatedCount,
        run: undoRun,
      })
    }

    setImportResult({
      success: successCount,
      failed: failedCount,
      duplicate: duplicateCount,
      degraded: degradedCount,
      unconfirmed: unconfirmedCount,
      // 首 chunk 成功计数要保留：persist 在某个 chunk 失败时 writePrivate 已
      // 停在该 chunk，之前 chunk 的 imported / updated / alreadyExisted 是
      // 真实写入数——按 ok 清零会把已写入的前缀也报成 0
      privateImported: privateResult.imported,
      privateUpdated: privateResult.updated,
      privateAlreadyExisted: privateResult.alreadyExisted,
      privateSkippedInvalid: privateResult.skippedInvalid,
      privateError: privateResult.ok ? null : (privateResult.error ?? '本地存储不可用'),
      addedSiteIds: privateResult.addedSiteIds,
      remainingPrivate,
      remainingPublic: remainingPublicPlan,
      plan,
      skippedCount: skipped?.skippedCount ?? 0,
      skippedItems: skipped?.skippedItems ?? [],
      ...review,
      // review 自带的 cancelled / remaining / cancelledCount 是公共库侧的分账，
      // 会被下面算好的总账覆盖：汇总只认这一份
      cancelled,
      cancelledCount: (cancelled ? toPrivate.length - privateResult.processed : 0) + publicCancelledCount,
      remaining: publicRemaining,
      usedReviewFallback,
    })
    setProgress(null)
    setIsImporting(false)
  }

  /** Step 4 确认导入：先冻结清单，再执行（冻结后选择不可再改） */
  const handleImport = async () => {
    if (!dedupReport || isImporting) return
    const plan = freezeExecutionPlan(dedupReport)
    const skippedItems = collectSkippedItems(dedupReport)
    const skipped = { skippedCount: skippedItems.length, skippedItems }
    if (plan.totalSelected === 0) {
      // 全跳过：没有可执行的条目，直接出汇总（不说“导入完成”，说“没有新增内容”）
      setImportResult({
        success: 0,
        failed: 0,
        duplicate: 0,
        degraded: 0,
        unconfirmed: 0,
        privateImported: 0,
        privateUpdated: 0,
        privateAlreadyExisted: 0,
        privateSkippedInvalid: 0,
        privateError: null,
        addedSiteIds: [],
        cancelled: false,
        cancelledCount: 0,
        remainingPrivate: [],
        remainingPublic: [],
        plan,
        skippedCount: skipped.skippedCount,
        skippedItems: skipped.skippedItems,
        reviewSubmitted: 0,
        reviewDuplicate: 0,
        reviewRateLimited: 0,
        reviewSkippedNoCategory: 0,
        reviewFailed: 0,
        usedReviewFallback: false,
        remaining: [],
      })
      return
    }
    await executeImport(plan, skipped)
  }

  /** 汇总页“重试剩余”：只重试未写入/未提交的 chunk，不重导已写入的 */
  const retryRemaining = async () => {
    if (!importResult || isImporting) return
    const plan: ExecutionPlan = {
      privateItems: importResult.remainingPrivate,
      publicItems: importResult.remainingPublic,
      folderMoves: [],
      titleOverrides: [],
      updatedItems: [],
      totalSelected: importResult.remainingPrivate.length + importResult.remainingPublic.length,
      privateCount: importResult.remainingPrivate.length,
      publicCount: importResult.remainingPublic.length,
    }
    await executeImport(plan, {
      // 重试只重试剩余：跳过清单是首轮的，不随重试重算
      skippedCount: importResult.skippedCount,
      skippedItems: importResult.skippedItems,
    })
  }

  /** 取消导入：停在 chunk 边界，不回滚已写入（文案写清） */
  const cancelImport = () => {
    cancelRequestedRef.current = true
  }

  /** 汇总页持久撤销：8 秒 toast 过期后仍可用，删同一批 addedSiteIds */
  const undoImportFromSummary = async () => {
    if (!importUndo) return
    const result = await importUndo.run()
    if (result.ok) {
      setUndoDone(true)
      setUndoDoneText(
        importUndo.count > 0
          ? `已撤销本次导入，新增条目已进回收站（30 天内可找回）。${importUndo.updatedCount > 0 ? '更新的条目已恢复原标题/文件夹。' : ''}`
          : '已撤销本次导入，更新的条目已恢复原标题/文件夹。',
      )
      setImportUndo(null)
    } else {
      setError(result.message ?? '撤销失败')
    }
  }

  const downloadRemaining = () => {
    const hasPublic = (importResult?.remaining.length ?? 0) > 0
    const hasPrivate = (importResult?.remainingPrivate.length ?? 0) > 0
    if (!hasPublic && !hasPrivate) return
    const blob = new Blob([JSON.stringify({
      version: 1,
      note: '待投稿清单：登录或等待限流窗口后，可回到 /import 粘贴本清单继续提交；未写入个人收藏的条目也在其中',
      items: [
        ...(importResult?.remaining ?? []).map((b) => ({
          title: b.title, url: b.url, tags: b.tags,
          categorySlug: b.suggestedCategorySlug, folder: b.folder,
        })),
        ...(importResult?.remainingPrivate ?? []).map((b) => ({
          title: b.title, url: b.url, tags: b.tags, folder: b.folder,
        })),
      ],
    }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `navhub-待投稿清单-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  /** 按文件夹分组折叠：当前页的条目按文件夹分组，组头可折叠、全选本组 */
  const pageGroups = useMemo(() => {
    const groups: Array<{ folder: string; items: StagingItem[] }> = []
    const byFolder = new Map<string, StagingItem[]>()
    for (const item of pageItems) {
      const folder = item.folder ?? '未分组'
      const list = byFolder.get(folder)
      if (list) list.push(item)
      else byFolder.set(folder, [item])
    }
    for (const [folder, groupItems] of byFolder) groups.push({ folder, items: groupItems })
    return groups
  }, [pageItems])

  /** Step 4 确认文案的数字：与执行冻结同一份报告派生（同源，不另算） */
  const confirmPlan = useMemo(
    () => (dedupReport ? freezeExecutionPlan(dedupReport) : null),
    [dedupReport],
  )

  /** 汇总“跳过”明细：已存在 / 文件内重复 / 无效 / 用户未选，分开点名。
   *  执行中才发现的已存在（writePrivate 的 alreadyExisted，并发改动才有）
   *  也并进“已存在”，保证 新增 + 更新 + 跳过 与冻结清单对得上 */
  const skippedBreakdown = useMemo(() => {
    if (!importResult) return ''
    const byKind = { existed: 0, dup: 0, invalid: 0, unselected: 0 }
    for (const item of importResult.skippedItems) {
      if (item.verdict === 'exists-local' || item.verdict === 'title-conflict' || item.verdict === 'folder-conflict') byKind.existed++
      else if (item.verdict === 'intra-file-dup') byKind.dup++
      else if (item.verdict === 'invalid') byKind.invalid++
      else byKind.unselected++
    }
    byKind.existed += importResult.privateAlreadyExisted
    const parts: string[] = []
    if (byKind.existed > 0) parts.push(`已存在 ${byKind.existed} 条`)
    if (byKind.dup > 0) parts.push(`文件内重复 ${byKind.dup} 条`)
    if (byKind.invalid > 0) parts.push(`无效 ${byKind.invalid} 条`)
    if (byKind.unselected > 0) parts.push(`未选 ${byKind.unselected} 条`)
    return parts.join('、')
  }, [importResult])

  /** 汇总“新增示例”只计真正新增：plan.privateItems 里含改判更新条，不能全算“新增” */
  const summaryAddedItems = useMemo(() => {
    if (!importResult?.plan) return []
    const updatedIds = new Set(importResult.plan.updatedItems.map((item) => item.id))
    return importResult.plan.privateItems.filter((item) => !updatedIds.has(item.id))
  }, [importResult])

  /** 逐条改判按钮（Step 3 行内）：标题/文件夹冲突、已存在、文件内重复互换。
   *  行按条目 id 对到保留条；文件内重复的 dup 条没有自己的行，改判入口挂
   *  在保留条这一行下面——每条 dup 列出自己的标题/文件夹，可逐条改用。
   *  （旧代码是按指纹查 verdict，dup 会覆盖保留条，行上错显“文件内重复”；
   *  现在保留条只显自己的 verdict，dup 另起一块。） */
  const renderOverride = (b: StagingItem) => {
    if (step !== 3) return null
    const v = reportItemById.get(b.id)
    if (!v) return null
    const btn = (label: string, active: boolean, onClick: () => void, ariaLabel: string) => (
      <button key={label} type="button" aria-label={ariaLabel} aria-pressed={active} onClick={onClick}
        className={`px-2 py-0.5 rounded border text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          active ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border/70 hover:text-foreground'
        }`}>{label}</button>
    )
    // 同一指纹的 dup 条（keptById 指向本行保留条）：没有自己的行，改判入口在这里
    const dupItems = dedupReport
      ? (Object.values(dedupReport.groups) as DedupVerdictItem[][])
        .flat()
        .filter((item) => item.verdict === 'intra-file-dup' && item.keptById === v.id)
      : []
    const dupBlock = dupItems.length > 0 ? (
      <div className="flex flex-wrap items-center gap-1.5 pt-1" role="group" aria-label={`「${b.title}」文件内重复改判`}>
        <span className="text-[10px] text-muted-foreground">文件内重复：默认保留第一条</span>
        {dupItems.map((dup) => (
          <span key={dup.id} className="inline-flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">另一条「{dup.title}」{dup.folder ? `（${dup.folder}）` : ''}</span>
            {btn('保留第一条', !dup.selectedPrivate && !dup.selectedPublic, () => handleOverride(dup.id, 'keep-existing'), `保留文件内第一条「${v.title}」`)}
            {btn('改用这一条', dup.selectedPrivate || dup.selectedPublic, () => handleOverride(dup.id, 'use-imported'), `改用这一条「${dup.title}」的标题/文件夹`)}
          </span>
        ))}
      </div>
    ) : null
    if (v.verdict === 'title-conflict') {
      return (
        <>
          <div className="flex flex-wrap items-center gap-1.5 pt-1" role="group" aria-label={`「${b.title}」标题冲突改判`}>
            <span className="text-[10px] text-muted-foreground">标题冲突：已存「{v.existingTitle}」vs 导入「{v.title}」</span>
            {btn('保留已存标题', v.override !== 'use-imported', () => handleOverride(v.id, 'keep-existing'), `保留已存标题「${v.existingTitle ?? ''}」`)}
            {btn('采用导入标题', v.override === 'use-imported', () => handleOverride(v.id, 'use-imported'), '采用导入标题并更新已存条目')}
          </div>
          {dupBlock}
        </>
      )
    }
    if (v.verdict === 'folder-conflict') {
      return (
        <>
          <div className="flex flex-wrap items-center gap-1.5 pt-1" role="group" aria-label={`「${b.title}」文件夹冲突改判`}>
            <span className="text-[10px] text-muted-foreground">文件夹冲突：已存「{v.existingFolder ?? '未分组'}」vs 导入「{v.folder ?? '未分组'}」</span>
            {btn('保留原文件夹', v.override !== 'move-folder', () => handleOverride(v.id, 'keep-existing'), '保留已存条目的文件夹')}
            {btn('移到新文件夹', v.override === 'move-folder', () => handleOverride(v.id, 'move-folder'), '把已存条目移到导入文件夹')}
          </div>
          {dupBlock}
        </>
      )
    }
    if (v.verdict === 'exists-local') {
      return (
        <>
          <div className="flex flex-wrap items-center gap-1.5 pt-1" role="group" aria-label={`「${b.title}」已存在改判`}>
            <span className="text-[10px] text-muted-foreground">已在收藏夹：默认跳过</span>
            {btn('跳过', !v.selectedPrivate, () => handleOverride(v.id, 'keep-existing'), '跳过这条，不重复导入')}
            {btn('更新已存条目', v.selectedPrivate, () => handleOverride(v.id, 'use-imported'), '用导入的标题/标签/文件夹更新已存条目')}
          </div>
          {dupBlock}
        </>
      )
    }
    return dupBlock
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
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />纯前端本地解析
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-500/20 font-medium">启发式自动归类</span>
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

      {/* 步骤条：不可点击跳步前进，只能点已完成的步骤回退；当前步 aria-current="step" */}
      <nav aria-label="导入向导步骤" className="rounded-2xl border border-border/80 bg-background/60 px-3 py-3 sm:px-5">
        <ol className="hidden sm:flex items-center gap-0">
          {WIZARD_STEPS.map(({ step: s, title, hint }, i) => {
            const done = s < step
            const current = s === step
            const canBack = done
            const inner = (
              <>
                <span className={`w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold shrink-0 ${
                  current ? 'bg-primary text-primary-foreground border-primary' : done ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40' : 'bg-muted/60 text-muted-foreground border-border/70'
                }`}>{done ? '✓' : s}</span>
                <span className="min-w-0">
                  <span className={`block text-xs font-semibold truncate ${current ? 'text-foreground' : 'text-muted-foreground'}`}>{title}</span>
                  <span className="block text-[10px] text-muted-foreground truncate">{hint}</span>
                </span>
              </>
            )
            return (
              <li key={s} className={`flex items-center gap-2 ${i < WIZARD_STEPS.length - 1 ? 'flex-1' : ''}`} aria-current={current ? 'step' : undefined}>
                {canBack ? (
                  <button type="button" onClick={() => setStep(s)} className="flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`回到第 ${s} 步：${title}`}>{inner}</button>
                ) : (
                  <span className={`flex items-center gap-2 rounded-lg px-1 py-0.5 ${current ? '' : 'opacity-70'}`} aria-disabled={!current}>{inner}</span>
                )}
                {i < WIZARD_STEPS.length - 1 && <span className={`h-px flex-1 mx-2 ${done ? 'bg-emerald-500/50' : 'bg-border'}`} aria-hidden="true" />}
              </li>
            )
          })}
        </ol>
        <div className="sm:hidden text-xs font-semibold text-foreground" aria-current="step">
          第 {step} / 4 步 · {WIZARD_STEPS[step - 1]!.title}
          <span className="block h-1 rounded bg-muted mt-1.5 overflow-hidden"><span className="block h-full bg-primary transition-all" style={{ width: `${(step / 4) * 100}%` }} /></span>
        </div>
      </nav>

      {step === 1 && (<>
      {/* 双目标模式：单一 Segmented Switcher，彻底移除强制跳往 /favorites 的中断式设计 */}
      <section aria-labelledby="mode-heading" className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="mode-heading" className="text-sm font-bold text-foreground">选择导入目标</h2>
          <Link href="/favorites" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors">
            查看我的收藏夹 <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        </div>
        <div
          role="tablist"
          aria-label="导入目标模式"
          className="grid grid-cols-1 sm:grid-cols-3 gap-2"
          onKeyDown={(e) => handleTabListKeyDown(e, MODE_META.map((m) => m.key), changeMode)}
        >
          {MODE_META.map(({ key, label, hint, icon: Icon }) => {
            const active = mode === key
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
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

      {/* 第 3 批第 1 项：社交收藏归集——来源切换。社交是「本地导入式归集」：
          只认用户自己从平台导出的文件/粘贴，不登录、不调平台 API、不联网抓取。 */}
      <section aria-labelledby="source-heading" className="space-y-2.5">
        <h2 id="source-heading" className="text-sm font-bold text-foreground">选择收藏来源</h2>
        <div
          role="tablist"
          aria-label="收藏来源"
          className="grid grid-cols-1 sm:grid-cols-2 gap-2"
          onKeyDown={(e) => handleTabListKeyDown(e, ['browser', 'social'] as const, switchSourceKind)}
        >
          {([
            { key: 'browser', label: '浏览器书签', hint: 'Chrome / Edge / Safari 等导出的 HTML、Markdown、OneTab、JSON' },
            { key: 'social', label: '社交平台收藏', hint: 'X、Reddit、GitHub Stars、Hacker News、Instagram、TikTok 的导出文件或链接粘贴' },
          ] as const).map(({ key, label, hint }) => {
            const active = sourceKind === key
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={`bookmark-source-tab-${key}`}
                aria-controls={key === 'social' && sourceKind === 'social' ? 'bookmark-source-tabpanel-social' : undefined}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => switchSourceKind(key)}
                className={`min-h-[44px] text-left rounded-xl border p-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  active ? 'border-primary/50 bg-primary/5 shadow-xs' : 'border-border/70 bg-background/40 hover:border-primary/30'
                }`}
              >
                <span className={`text-xs font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>{label}</span>
                <span className="block text-[11px] text-muted-foreground leading-relaxed mt-1">{hint}</span>
              </button>
            )
          })}
        </div>
        {sourceKind === 'social' && (
          <div
            role="tabpanel"
            id="bookmark-source-tabpanel-social"
            aria-labelledby="bookmark-source-tab-social"
            className="space-y-2"
          >
            <label htmlFor="social-platform" className="text-xs font-semibold text-foreground">平台（自动识别失败时请手动选）</label>
            <select
              id="social-platform"
              value={socialPlatform}
              onChange={(e) => setSocialPlatform(e.target.value as SocialPlatformId | 'auto')}
              className="w-full sm:w-auto min-h-[44px] rounded-xl border border-border/70 bg-background px-3 text-xs font-medium outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="auto">自动识别（按文件名与内容判断）</option>
              {SOCIAL_PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}（{p.acceptHint}）</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {socialPlatform === 'auto'
                ? '自动识别看文件名与内容：tweet.js / like.js → X，saved_posts.json → Instagram，含 news.ycombinator.com → Hacker News，含 html_url + full_name → GitHub Stars，含 subreddit → Reddit。认不出时会请你手动选，不猜。'
                : SOCIAL_PLATFORM_BY_ID[socialPlatform].howTo}
            </p>
            {items.length === 0 && (
              <div className="p-3 rounded-xl bg-muted/40 border border-border/60 text-[11px] text-muted-foreground leading-relaxed space-y-1" role="status">
                <p className="font-semibold text-foreground text-xs">还没有导入过社交收藏</p>
                {SOCIAL_PLATFORMS.map((p) => (
                  <p key={p.id}>· {p.label}：{p.howTo}支持 {p.acceptHint}。</p>
                ))}
                <p>导入后统一进你的网址库：自动按链接去重（与已有收藏按规范化 URL 比对）、自动归类与打标签建议，导入完成给一份去重报告（新增 / 重复 / 失败各多少）。TikTok 结构化导出暂不支持，请粘贴视频链接。导入全程在本地完成，不登录任何平台。</p>
              </div>
            )}
          </div>
        )}
      </section>
      </>)}

      <Card className="glass-surface rounded-2xl border-border/80 shadow-xs overflow-hidden">
        <CardContent className="p-4 sm:p-6 space-y-4 sm:space-y-5">
          {step === 1 && (<>
          {/* 多格式输入：文件 + 直接粘贴，隐藏原生 input 用 sr-only + label 关联 */}
          <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
            <div
              role="tablist"
              aria-label="输入方式"
              className="inline-flex rounded-lg bg-muted/60 p-0.5"
              onKeyDown={(e) => handleTabListKeyDown(e, ['file', 'paste'] as const, setInputTab)}
            >
              {([['file', '文件上传'], ['paste', '直接粘贴文本 / URL']] as const).map(([key, label]) => (
                <button key={key} type="button" role="tab" id={`bookmark-input-tab-${key}`} aria-controls={`bookmark-input-tabpanel-${key}`} aria-selected={inputTab === key}
                  tabIndex={inputTab === key ? 0 : -1}
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
              role="tabpanel"
              id="bookmark-input-tabpanel-file"
              aria-labelledby="bookmark-input-tab-file"
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              className={`rounded-2xl border-2 border-dashed p-4 sm:p-6 transition-all ${isDragging ? 'border-primary bg-primary/10' : 'border-border/80 bg-muted/20'}`}
            >
              <input
                ref={fileInputRef}
                id="bookmark-file-input"
                type="file"
                accept={sourceKind === 'social' ? '.html,.htm,.md,.json,.txt,.csv,.js' : '.html,.htm,.md,.json,.txt'}
                multiple
                aria-labelledby="dropzone-title"
                onChange={(e) => { if (e.target.files?.length) void readFiles(e.target.files) }}
                className="sr-only peer"
              />
              <label htmlFor="bookmark-file-input" id="dropzone-title"
                className="flex flex-col items-center gap-2 text-center cursor-pointer rounded-xl p-2 peer-focus-visible:ring-2 peer-focus-visible:ring-primary">
                <span className="w-11 h-11 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/20 border border-indigo-500/20 flex items-center justify-center text-indigo-700 dark:text-indigo-400">
                  <FileUp className="w-5 h-5" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold text-foreground">{sourceKind === 'social' ? '点击选择或拖拽社交导出文件至此' : '点击选择或拖拽书签文件至此'}</span>
                <span className="text-xs text-muted-foreground">{sourceKind === 'social' ? '支持 .html / .md / .json / .txt / .csv / .js（X 归档 .js、Reddit/GitHub 的 .csv），可一次拖入多个文件累加解析' : '支持 .html / .md / .json / .txt（OneTab），可一次拖入多个文件累加解析'}</span>
                {selectedFileNames.length > 0 && (
                  <span className="text-xs text-muted-foreground">已选文件：{selectedFileNames.join('、')}</span>
                )}
              </label>
              <div className="mt-3 pt-3 border-t border-border/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                {sourceKind === 'social' ? (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {socialPlatform === 'auto' ? '先选平台（或留空自动识别），再拖入该平台的导出文件。' : SOCIAL_PLATFORM_BY_ID[socialPlatform].howTo}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    <kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono text-xs">{shortcut.keys}</kbd>{' '}
                    {shortcut.hint}
                  </p>
                )}
                {sourceKind === 'browser' && (
                  <Button type="button" size="sm" variant="outline" onClick={loadSample}
                    className="h-8 text-xs gap-1.5 rounded-lg shrink-0 border-primary/40 text-primary hover:bg-primary/10">
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />加载示例书签体验解析
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5" role="tabpanel" id="bookmark-input-tabpanel-paste" aria-labelledby="bookmark-input-tab-paste">
              <label htmlFor="bookmark-paste" className="text-xs font-semibold text-foreground">
                {sourceKind === 'social' ? '粘贴社交收藏文本 / URL 列表' : '粘贴书签文本 / URL 列表'}
              </label>
              <textarea
                id="bookmark-paste"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={7}
                placeholder={sourceKind === 'social'
                  ? '支持：\nhttps://www.tiktok.com/@someone/video/123\nhttps://github.com/vercel/next.js\n或直接粘贴 JSON 数组 / CSV 导出内容'
                  : '支持：\nhttps://example.com | 站点标题\n- [标题](https://example.com)\n或者直接粘贴 bookmarks.html 内容'}
                className="w-full rounded-xl border border-border/70 bg-background/60 p-3 text-xs font-mono outline-none focus:ring-2 focus:ring-primary resize-y"
              />
              {pasteText.length > IMPORT_MAX_PASTE_CHARS && (
                <p className="text-[11px] text-red-600 dark:text-red-400">粘贴内容超过 10 MB 上限，请改用文件导入。</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" onClick={() => {
                  if (pasteText.length > IMPORT_MAX_PASTE_CHARS) { setError('粘贴内容超过 10 MB 上限，请改用文件导入。'); return }
                  if (ingest(pasteText, '粘贴内容', true)) setStep(2)
                }} disabled={!pasteText.trim() || pasteText.length > IMPORT_MAX_PASTE_CHARS}
                  className="h-8 text-xs gap-1.5 rounded-lg"><Layers className="w-3.5 h-3.5" aria-hidden="true" />解析粘贴内容</Button>
                {sourceKind === 'browser' && (
                  <Button type="button" size="sm" variant="outline" onClick={loadSample}
                    className="h-8 text-xs gap-1.5 rounded-lg"><Sparkles className="w-3.5 h-3.5" aria-hidden="true" />加载示例书签</Button>
                )}
              </div>
            </div>
          )}
          </>)}

          {isParsing && (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground" role="status">
              <Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden="true" />正在本地解析、脱敏与去重...
            </div>
          )}

          {error && (
            <div role="alert" className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" /><span>{error}</span>
            </div>
          )}

          {resumeNotice && (
            <div role="status" className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/25 text-sky-700 dark:text-sky-300 text-xs">
              {resumeNotice}
            </div>
          )}

          {/* 多文件其中一个失败：成功文件保留，失败文件逐个点名 */}
          {fileErrors.length > 0 && (
            <div role="status" className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs space-y-1">
              {fileErrors.map((f, i) => (
                <p key={`${f.name}-${i}`}>「{f.name}」：{f.reason}</p>
              ))}
            </div>
          )}

          {/* 社交导入失败行：逐行点名（行号 + 原因 + 原文），可下载后修改重试；
              成功解析的条目不受影响，继续走去重与导入流程 */}
          {socialFailures.length > 0 && (
            <div role="status" className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs space-y-2">
              <p className="font-semibold">有 {socialFailures.length} 行未能解析成收藏（已解析成功的条目不受影响）：</p>
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {socialFailures.slice(0, 20).map((f, i) => (
                  <li key={`${f.line}-${i}`}>第 {f.line} 行：{f.reason}{f.excerpt ? `（${f.excerpt}）` : ''}</li>
                ))}
                {socialFailures.length > 20 && <li>……其余 {socialFailures.length - 20} 行见下载文件。</li>}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button" size="sm" variant="outline"
                  onClick={() => triggerFileDownload(
                    socialFailures.map((f) => `第 ${f.line} 行：${f.reason}${f.excerpt ? `（${f.excerpt}）` : ''}`).join('\n'),
                    SOCIAL_FAILURES_FILENAME,
                    'text/plain;charset=utf-8',
                  )}
                  className="min-h-[44px] text-xs gap-1.5 rounded-lg"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />下载失败行（{SOCIAL_FAILURES_FILENAME}）
                </Button>
                <span className="self-center">改好后重新选择文件或粘贴导入即可重试。</span>
              </div>
            </div>
          )}

          {/* 超限诚实文案：totalMatched 是真实命中总数，拿不到就写“可能还有更多” */}
          {parseMeta?.truncated && (
            <div role="status" className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs">
              {parseMeta.totalMatched !== undefined
                ? `文件共约 ${parseMeta.totalMatched} 条链接，仅处理前 ${IMPORT_MAX_ITEMS} 条，剩余未解析。`
                : `已达 ${IMPORT_MAX_ITEMS} 条上限，文件可能还有更多。`}
            </div>
          )}

          {!indexReady && (
            <div role="status" className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs">
              公共库索引暂不可用，「已收录」去重本次未生效；个人收藏导入与隐私拦截不受影响。
            </div>
          )}

          {/* Step 4：确认与导入 —— 数字全部来自冻结清单 / 同一份 DedupReport，不另算 */}
          {step === 4 && !importResult && !isImporting && confirmPlan && (
            <div className="p-4 rounded-xl border border-border/80 bg-background/50 text-xs space-y-3" role="status">
              <p className="font-bold text-sm text-foreground">确认导入</p>
              <p className="leading-relaxed text-muted-foreground">
                将导入个人收藏 {confirmPlan.privateCount} 条、投稿公共库 {confirmPlan.publicCount} 条
                {confirmPlan.updatedItems.length > 0 ? `，其中 ${confirmPlan.updatedItems.length} 条为更新已存条目` : ''}
                {dedupReport ? `，${dedupReport.totalParsed - confirmPlan.totalSelected} 条将被跳过（已存在 / 重复 / 无效）` : ''}。
                执行开始后不可再改选择；取消只停在 chunk 边界，不回滚已写入。
              </p>
              {confirmPlan.totalSelected === 0 && dedupReport && (
                <p className="leading-relaxed font-semibold text-foreground">
                  没有新增内容：{dedupReport.totalParsed} 条均已存在。确认后直接出全跳过汇总，不执行导入。
                </p>
              )}
              {confirmPlan.folderMoves.length > 0 && (
                <p className="leading-relaxed text-muted-foreground">其中 {confirmPlan.folderMoves.length} 条将把已存条目移到新文件夹。</p>
              )}
              {confirmPlan.titleOverrides.length > 0 && (
                <p className="leading-relaxed text-muted-foreground">其中 {confirmPlan.titleOverrides.length} 条将采用导入标题更新已存条目。</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={handleImport} className="h-9 text-xs gap-1.5 rounded-lg w-full sm:w-auto">
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  {confirmPlan.totalSelected === 0 ? '查看汇总（没有新增内容）' : `确认导入（私有 ${confirmPlan.privateCount} / 公共 ${confirmPlan.publicCount}）`}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setStep(3)} className="h-9 text-xs rounded-lg w-full sm:w-auto">返回修改选择</Button>
              </div>
            </div>
          )}

          {/* 执行进度：两段进度（个人 a/b 条、公共 c/d 批），不做假进度条 */}
          {step === 4 && isImporting && progress && (
            <div className="p-4 rounded-xl border border-border/80 bg-background/50 text-xs space-y-3" role="status">
              <p className="font-bold text-sm text-foreground flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden="true" />{progress.label}
              </p>
              <div className="space-y-1">
                <p>个人收藏 {progress.privateDone}/{progress.privateTotal} 条</p>
                <span className="block h-1.5 rounded bg-muted overflow-hidden"><span className="block h-full bg-primary transition-all" style={{ width: `${progress.privateTotal > 0 ? (progress.privateDone / progress.privateTotal) * 100 : 0}%` }} /></span>
              </div>
              <div className="space-y-1">
                <p>公共库 {progress.publicDone}/{progress.publicTotal} 批</p>
                <span className="block h-1.5 rounded bg-muted overflow-hidden"><span className="block h-full bg-primary transition-all" style={{ width: `${progress.publicTotal > 0 ? (progress.publicDone / progress.publicTotal) * 100 : 0}%` }} /></span>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={cancelImport} className="h-9 text-xs rounded-lg w-full sm:w-auto">
                取消导入（停在当前 chunk 边界，已写入的不回滚）
              </Button>
            </div>
          )}

          {/* 汇总页：成功 / 失败 / 未确认 / 已取消分开报，绝不把假成功说成导入完成 */}
          {step === 4 && importResult && (
            <div className={`p-4 rounded-xl text-xs space-y-3 ${
              importResult.failed + importResult.unconfirmed + importResult.reviewFailed > 0 || importResult.privateError || importResult.cancelled
                ? 'bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300'
                : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
            }`} role="status">
              <div className="flex items-center gap-2 font-bold text-sm">
                {importResult.failed + importResult.unconfirmed > 0 || importResult.cancelled ? <AlertCircle className="w-4 h-4" aria-hidden="true" /> : <CheckCircle className="w-4 h-4" aria-hidden="true" />}
                <span>{importResult.cancelled
                  ? '导入已取消'
                  : importResult.plan && isAllSkippedSummary(importResult.plan, importResult.privateImported) && importResult.privateUpdated === 0 && importResult.success === 0 && importResult.reviewSubmitted === 0 && importResult.skippedCount > 0
                    ? `没有新增内容：${importResult.skippedCount} 条均已存在`
                    : importResult.failed + importResult.unconfirmed > 0
                      ? '导入结束，但有内容没确认收录'
                      : '导入完成！'}</span>
              </div>
              <p className="leading-relaxed">
                个人收藏新增 {importResult.privateImported} 条、更新 {importResult.privateUpdated} 条、跳过 {importResult.skippedCount + importResult.privateAlreadyExisted} 条{skippedBreakdown ? `（${skippedBreakdown}）` : ''}
                {importResult.privateSkippedInvalid > 0 ? `，格式不合法跳过 ${importResult.privateSkippedInvalid} 条` : ''}
                {importResult.privateError ? `（失败：${importResult.privateError}）` : ''}；
                {importResult.usedReviewFallback
                  ? `公共库投稿审核：成功 ${importResult.reviewSubmitted} 条、已存在 ${importResult.reviewDuplicate} 条`
                  : `公共库成功收录 ${importResult.success} 个站点`}
                {importResult.duplicate > 0 ? `，已存在跳过 ${importResult.duplicate} 个` : ''}
                {importResult.failed > 0 ? `，失败 ${importResult.failed} 个` : ''}
                {importResult.unconfirmed > 0 ? `，${importResult.unconfirmed} 个未能确认（服务端返回异常，可重新导入这批）` : ''}
                {importResult.degraded > 0 ? `；其中 ${importResult.degraded} 个所选分类不存在或是一级分类，已落到「未分类」` : ''}。
                {importResult.cancelled ? ` 已取消，未导入 ${importResult.cancelledCount} 条（已写入的不回滚）。` : ''}
              </p>
              <p className="leading-relaxed">
                个人收藏 {importResult.addedSiteIds.length} 条可撤销；公共库 {importResult.success + importResult.reviewSubmitted} 条已提交，不可撤销。
              </p>
              {importResult.usedReviewFallback && (
                <p className="leading-relaxed">
                  当前为匿名访客，批量直入接口需要管理员授权，已自动改走公开投稿审核队列。
                  {importResult.reviewRateLimited > 0 ? ` 投稿接口触发限流，本次剩余 ${importResult.remaining.length} 条未提交。` : ''}
                  {importResult.reviewSkippedNoCategory > 0 ? ` 另有 ${importResult.reviewSkippedNoCategory} 条缺少可挂载分类，请在预览表批量改绑后重试。` : ''}
                  {importResult.reviewFailed > 0 ? ` ${importResult.reviewFailed} 条投稿失败。` : ''}
                </p>
              )}
              {/* 每组 3 条示例 + 查看全部（清单来自冻结清单与逐条执行结果的 join） */}
              {importResult.plan && (
                <div className="space-y-2">
                  <details className="rounded-lg border border-border/60 bg-background/40 p-2">
                    <summary className="cursor-pointer font-semibold">个人收藏新增示例（{summaryAddedItems.length} 条）</summary>
                    <ul className="mt-1.5 space-y-1">
                      {summaryAddedItems.slice(0, 3).map((b) => (
                        <li key={b.id} className="truncate">{b.title} · <span className="font-mono">{b.url}</span></li>
                      ))}
                      {summaryAddedItems.length > 3 && (
                        <li className="text-muted-foreground">…其余 {summaryAddedItems.length - 3} 条见“查看导入结果”</li>
                      )}
                    </ul>
                  </details>
                  {importResult.plan.updatedItems.length > 0 && (
                    <details className="rounded-lg border border-border/60 bg-background/40 p-2">
                      <summary className="cursor-pointer font-semibold">个人收藏更新示例（{importResult.plan.updatedItems.length} 条）</summary>
                      <ul className="mt-1.5 space-y-1">
                        {importResult.plan.updatedItems.slice(0, 3).map((b) => (
                          <li key={b.id} className="truncate">{b.title} · <span className="font-mono">{b.url}</span> — 已更新已存条目</li>
                        ))}
                        {importResult.plan.updatedItems.length > 3 && (
                          <li className="text-muted-foreground">…其余 {importResult.plan.updatedItems.length - 3} 条</li>
                        )}
                      </ul>
                    </details>
                  )}
                  {importResult.skippedItems.length > 0 && (
                    <details className="rounded-lg border border-border/60 bg-background/40 p-2">
                      <summary className="cursor-pointer font-semibold">跳过示例（{importResult.skippedItems.length} 条）</summary>
                      <ul className="mt-1.5 space-y-1">
                        {importResult.skippedItems.slice(0, 3).map((b) => (
                          <li key={b.id} className="truncate">{b.title} · <span className="font-mono">{b.url}</span> — {b.reason}</li>
                        ))}
                        {importResult.skippedItems.length > 3 && (
                          <li className="text-muted-foreground">…其余 {importResult.skippedItems.length - 3} 条</li>
                        )}
                      </ul>
                    </details>
                  )}
                  <details className="rounded-lg border border-border/60 bg-background/40 p-2">
                    <summary className="cursor-pointer font-semibold">公共库投稿示例（{importResult.plan.publicItems.length} 条）</summary>
                    <ul className="mt-1.5 space-y-1">
                      {importResult.plan.publicItems.slice(0, 3).map((b) => (
                        <li key={b.id} className="truncate">{b.title} · <span className="font-mono">{b.url}</span></li>
                      ))}
                      {importResult.plan.publicItems.length > 3 && (
                        <li className="text-muted-foreground">…其余 {importResult.plan.publicItems.length - 3} 条</li>
                      )}
                    </ul>
                  </details>
                </div>
              )}
              {/* 失败 / 未确认 / 已取消逐条原因 + 重试 / 下载 */}
              {(importResult.remaining.length > 0 || importResult.remainingPrivate.length > 0) && (
                <div className="space-y-2">
                  <p className="font-semibold">未完成条目（逐条原因）：</p>
                  <ul className="space-y-1 max-h-40 overflow-y-auto">
                    {importResult.remaining.map((b) => (
                      <li key={`pub-${b.id}`} className="truncate">{b.title} · <span className="font-mono">{b.url}</span> — 本次未成功提交，可重试</li>
                    ))}
                    {importResult.remainingPrivate.map((b) => (
                      <li key={`pri-${b.id}`} className="truncate">{b.title} · <span className="font-mono">{b.url}</span> — {importResult.cancelled ? '已取消，未导入' : '未写入个人收藏'}，可重试</li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={retryRemaining} disabled={isImporting} className="h-8 text-xs gap-1.5 rounded-lg">重试剩余</Button>
                    <Button type="button" size="sm" variant="outline" onClick={downloadRemaining} className="h-8 text-xs gap-1.5 rounded-lg">
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />下载剩余清单
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild size="sm" className="h-9 text-xs gap-1.5 rounded-lg w-full sm:w-auto">
                  <Link href="/favorites">查看导入结果</Link>
                </Button>
                {importUndo && !undoDone && (
                  <Button type="button" size="sm" variant="outline" onClick={undoImportFromSummary} className="h-9 text-xs rounded-lg w-full sm:w-auto">
                    撤销本次导入
                  </Button>
                )}
                {undoDone && undoDoneText && (
                  <span className="inline-flex items-center text-xs font-semibold">{undoDoneText}</span>
                )}
                <Button type="button" size="sm" variant="outline" onClick={resetAll} className="h-9 text-xs rounded-lg w-full sm:w-auto">再导一份</Button>
              </div>
              {importUndo && (
                <p className="text-[11px] leading-relaxed opacity-80">{importUndo.label}</p>
              )}
            </div>
          )}

          {/* Staging Table：Step 2 只读预览，Step 3 可勾选/改判 */}
          {(step === 2 || step === 3) && items.length > 0 && (
            <div className="space-y-3.5 pt-4 border-t border-border/60">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-foreground">解析出 {items.length} 个书签</span>
                    <Badge variant="secondary" className="font-mono bg-muted/80 px-2 py-0.5 rounded-full">个人收藏 {counts.privateSelected}</Badge>
                    <Badge variant="secondary" className="font-mono bg-muted/80 px-2 py-0.5 rounded-full">公共投稿 {counts.publicSelected}</Badge>
                    {aiClassifiedCount > 0 && <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">✨ AI 补全 {aiClassifiedCount} 条</Badge>}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    格式 {parseMeta?.format ?? '—'} · 公共库索引 {indexReady ? publicSiteCount : '不可用'} 站 · 识别文件夹 {parseMeta?.folders ?? 0} 个 · 批内重复丢弃 {parseMeta?.duplicates ?? 0} 条
                    {parseMeta?.skipped ? ` · 解析跳过 ${parseMeta.skipped} 条` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 rounded-lg" disabled={step === 2 || isAiClassifying || isImporting} onClick={handleAiBatchClassify}>
                    {isAiClassifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />}
                    <span>{isAiClassifying ? 'AI 正在归类...' : '✨ AI 智能归类'}</span>
                  </Button>
                  {step === 3 && (
                    <Button size="sm" className="h-8 text-xs gap-1.5 rounded-lg shadow-xs"
                      disabled={isImporting} onClick={() => setStep(4)}>
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>
                        {counts.privateSelected + counts.publicSelected === 0
                          ? '下一步：查看全跳过汇总（没有新增内容）'
                          : mode === 'private'
                            ? `下一步：确认导入个人收藏夹（${counts.privateSelected} 条）`
                            : mode === 'public'
                              ? `下一步：确认提交公共导航库（${counts.publicSelected} 条）`
                              : `下一步：确认分流导入（私有 ${counts.privateSelected} / 公共 ${counts.publicSelected}）`}
                      </span>
                    </Button>
                  )}
                </div>
              </div>

              {/* 去重报告（Step 3）：数字全部来自 DedupReport.counts，点分组即过滤表格 */}
              {step === 3 && dedupReport && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="按去重分组筛选">
                    {(Object.keys(VERDICT_META) as DedupVerdict[]).map((v) => {
                      const count = dedupReport.counts[v]
                      if (count === 0) return null
                      return (
                        <button key={v} type="button" aria-pressed={verdictFilter === v}
                          onClick={() => { setVerdictFilter(verdictFilter === v ? 'all' : v); setPreviewPage(1) }}
                          className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border ${VERDICT_META[v].className} ${verdictFilter === v ? 'ring-2 ring-primary' : ''}`}>
                          {VERDICT_META[v].label} {count}
                        </button>
                      )
                    })}
                    {dedupReport.dedupeUnavailable && (
                      <span className="inline-flex items-center text-[11px] px-2 py-1 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/25">
                        公共库去重未生效，「已收录」分组可能漏判
                      </span>
                    )}
                  </div>
                  {verdictFilter !== 'all' && (
                    <div className="rounded-xl border border-border/70 bg-background/40 p-2.5 text-[11px] space-y-1">
                      <p className="font-semibold text-foreground">{VERDICT_META[verdictFilter].label}示例（前 3 条）：</p>
                      {dedupReport.groups[verdictFilter].slice(0, 3).map((item) => (
                        <p key={item.id} className="truncate text-muted-foreground">{item.title} · <span className="font-mono">{item.url}</span> — {item.reason}</p>
                      ))}
                      <button type="button" onClick={() => setVerdictFilter('all')} className="text-primary underline-offset-2 hover:underline">查看全部（清除分组筛选）</button>
                    </div>
                  )}
                </div>
              )}

              {/* 预览搜索 + 文件夹分组筛选 + 当前筛选全选/反选 */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  aria-label="搜索标题、URL 或文件夹"
                  value={previewSearch}
                  onChange={(e) => { setPreviewSearch(e.target.value); setPreviewPage(1) }}
                  placeholder="搜索标题 / URL / 文件夹…"
                  className="h-8 flex-1 min-w-[12rem] bg-background border border-border/70 rounded-lg px-2.5 text-xs outline-none focus:ring-2 focus:ring-primary"
                />
                <select aria-label="按文件夹分组筛选" value={folderFilter} onChange={(e) => { setFolderFilter(e.target.value); setPreviewPage(1) }}
                  className="h-8 bg-background border border-border/70 rounded-lg px-2 text-xs outline-none focus:ring-1 focus:ring-primary max-w-[12rem]">
                  <option value="all">全部文件夹</option>
                  {folderNames.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                {step === 3 && (
                  <>
                    <button type="button" onClick={() => selectFilteredPrivate(true)} className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
                      全选当前筛选的 {filteredItems.length} 条（私有）
                    </button>
                    <button type="button" onClick={() => selectFilteredPublic(true)} className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
                      全选当前筛选的 {filteredItems.length} 条（投稿）
                    </button>
                    <button type="button" onClick={invertFiltered} className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">反选当前筛选</button>
                  </>
                )}
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
                {step === 3 && (<>
                <span className="hidden sm:inline h-4 w-px bg-border" aria-hidden="true" />
                {mode !== 'public' && (
                  <>
                    <button type="button" onClick={() => setAllPrivate(true)} className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">全选全部 {items.length} 条（私有）</button>
                    <button type="button" onClick={() => setAllPrivate(false)} className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">清空私有</button>
                  </>
                )}
                {mode !== 'private' && (
                  <button type="button" onClick={() => setAllPublic(true)} className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">全选全部 {items.length} 条（可投稿）</button>
                )}
                </>)}
                {step === 3 && (<>
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
                </>)}
              </div>

              <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-border/80 divide-y divide-border/50 text-xs bg-background/50" role="table" aria-label="书签解析预览">
                {visibleItems.length === 0 && (
                  <p className="p-6 text-center text-muted-foreground">当前筛选下没有条目</p>
                )}
                {pageGroups.map((group) => (
                  <div key={group.folder}>
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-muted/50 text-xs">
                      <button type="button" aria-expanded={!collapsedFolders.has(group.folder)}
                        onClick={() => setCollapsedFolders((prev) => { const next = new Set(prev); if (next.has(group.folder)) next.delete(group.folder); else next.add(group.folder); return next })}
                        className="font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-1">
                        {collapsedFolders.has(group.folder) ? '▸' : '▾'} {group.folder}（{group.items.length} 条）
                      </button>
                      {step === 3 && mode !== 'public' && (
                        <button type="button" onClick={() => { const ids = new Set(group.items.map((b) => b.id)); applyItemSelection(items.map((b) => (ids.has(b.id) ? { ...b, toPrivate: true } : b))) }} className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">全选本组私有</button>
                      )}
                    </div>
                    {!collapsedFolders.has(group.folder) && group.items.map((b) => (
                  <div key={b.id} role="row"
                    className="[content-visibility:auto] [contain-intrinsic-size:auto_88px] flex flex-col sm:flex-row sm:items-center gap-2.5 p-3 hover:bg-muted/40 transition-colors">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <input aria-label={`将「${b.title}」存入个人收藏`} type="checkbox" checked={b.toPrivate}
                        disabled={step === 2 || mode === 'public'} onChange={() => togglePrivate(b.id)}
                        className="rounded border-border text-primary focus:ring-primary h-4 w-4 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-foreground truncate max-w-[16rem]">{b.title}</span>
                          <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${STATUS_META[b.status].className}`}>
                            {b.status === 'private' && <Lock className="w-2.5 h-2.5" aria-hidden="true" />}{STATUS_META[b.status].label}
                          </span>
                          {(() => { const v = reportItemById.get(b.id); return v ? (<span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${VERDICT_META[v.verdict].className}`}>{VERDICT_META[v.verdict].label}</span>) : null })()}
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground border border-border/50">{CONFIDENCE_META[b.confidence]}</span>
                          {b.folder && <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded truncate max-w-[8rem]">{b.folder}</span>}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate font-mono" title={b.originalUrl}>{b.url}</p>
                        {(b.privacyReason || b.tags.length > 0) && (
                          <p className="text-[10px] text-muted-foreground leading-snug">
                            {b.privacyReason ? `${b.privacyReason}，仅限个人收藏` : ''}
                            {b.tags.length > 0 ? ` · ${b.tags.map((t) => `#${t}`).join(' ')}` : ''}
                          </p>
                        )}
                        {renderOverride(b)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pl-6 sm:pl-0 shrink-0">
                      <select aria-label={`为「${b.title}」选择分类`} value={b.suggestedCategorySlug} disabled={step === 2}
                        onPointerDown={() => setExpandedCategoryRow(b.id)}
                        onFocus={() => setExpandedCategoryRow(b.id)}
                        onBlur={() => setExpandedCategoryRow((cur) => (cur === b.id ? null : cur))}
                        onChange={(e) => { patchItem(b.id, { suggestedCategorySlug: e.target.value }); setExpandedCategoryRow(null) }}
                        className="max-w-[11rem] bg-background border border-border/70 rounded-lg px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-primary">
                        {rowCategoryOptions(b).map((opt) => <option key={opt.slug || '__unclassified__'} value={opt.slug}>{opt.label}</option>)}
                      </select>
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <input aria-label={`将「${b.title}」提交至公共导航库`} type="checkbox" checked={b.toPublic}
                          disabled={step === 2 || b.publicLocked || mode === 'private'} onChange={() => togglePublic(b.id)}
                          className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5 disabled:opacity-40" />
                        投稿
                      </label>
                    </div>
                  </div>
                    ))}
                  </div>
                ))}
              </div>
              {/* 分页：每页 50 条固定；总数、页数、当前页范围由同一份 items 派生 */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
                <span>第 {safePage} / {pageCount} 页 · 显示 {filteredItems.length === 0 ? 0 : (safePage - 1) * IMPORT_PREVIEW_PAGE_SIZE + 1}–{Math.min(safePage * IMPORT_PREVIEW_PAGE_SIZE, filteredItems.length)} 条（共 {filteredItems.length} 条，每页 50 条）</span>
                <span className="inline-flex gap-1">
                  <button type="button" disabled={safePage <= 1} onClick={() => setPreviewPage(safePage - 1)} className="px-2 py-1 rounded border border-border/70 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">上一页</button>
                  <button type="button" disabled={safePage >= pageCount} onClick={() => setPreviewPage(safePage + 1)} className="px-2 py-1 rounded border border-border/70 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">下一页</button>
                </span>
              </div>
            </div>
          )}

          {/* 向导导航：不可跳步前进，可任意回退；执行开始后上一步禁用 */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60">
            <span>
              {step > 1 && !isImporting && !importResult && (
                <Button type="button" size="sm" variant="outline" onClick={() => setStep((step - 1) as WizardStep)} className="h-9 text-xs rounded-lg">上一步</Button>
              )}
            </span>
            <span className="flex flex-wrap gap-2">
              {step === 1 && (
                <Button type="button" size="sm" disabled={items.length === 0} onClick={() => setStep(2)} className="h-9 text-xs rounded-lg w-full sm:w-auto">下一步：解析预览</Button>
              )}
              {step === 2 && (
                <Button type="button" size="sm" disabled={items.length === 0} onClick={() => setStep(3)} className="h-9 text-xs rounded-lg w-full sm:w-auto">下一步：去重与选择</Button>
              )}
              {step === 3 && (
                <Button type="button" size="sm" onClick={() => setStep(4)} className="h-9 text-xs rounded-lg w-full sm:w-auto">
                  {counts.privateSelected + counts.publicSelected === 0 ? '下一步：查看全跳过汇总' : '下一步：确认与导入'}
                </Button>
              )}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
