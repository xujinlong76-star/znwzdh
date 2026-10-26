'use client'

/**
 * 数据主权 4.0：云端资产全景清点 / 导出全部个人数据 / 从 JSON 备份导入恢复 / 按域精细化清理 / 注销并删除全部云端数据。
 *
 * 所有动作均走 BFF `/api/me/*`（会话签名身份），不接受客户端自报 userId。
 * 解决三大痛点：
 *  1. 过去「只能导出 JSON，不能导入恢复」：新增 `/api/me/import` 备份文件上传与粘贴还原；
 *  2. 过去「想清部分数据只能整号删除」：新增 `/api/me/prune` 分域精细化清理（搜索历史/行为画像/金库/CRDT/AI配置）；
 *  3. 过去「自检说原文已留档，但界面里没有任何地方能看到它」：新增 <QuarantineZone />，
 *     本机隔离副本在这里列出、展开对照、下载、并回收藏或显式删除。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Footer } from '@/components/footer'
import { useToast } from '@/components/ui/use-toast'
import { useFavorites } from '@/hooks/useFavorites'
import { probeClientSession } from '@/lib/client-session'
import { CenterPageHeader } from '@/components/user-center/center-page-header'
import { AnonymousHint } from '@/components/user-center/anonymous-hint'
import dynamic from 'next/dynamic'

// 隔离区只在「本机收藏/设置出现过坏数据」时才有用，对多数访问者是死重：
// 按需加载（首屏预算只降不升的硬约束，T6/T14 拆分的第一块）。
const QuarantineZone = dynamic(
  () => import('@/components/user-center/quarantine-zone').then((m) => m.QuarantineZone),
  { ssr: false, loading: () => <div className="h-24 animate-pulse rounded-2xl border border-border/70 bg-card/50" aria-busy="true" /> },
)

// 书签导入是低频操作：按钮与解析器一起按需加载（T2/T16，不占数据页首屏预算）
const ImportResumeBanner = dynamic(
  () => import('@/components/user-center/import-resume-banner').then((m) => m.ImportResumeBanner),
  { ssr: false },
)

const BookmarkImportButton = dynamic(
  () => import('@/components/user-center/bookmark-import-button').then((m) => m.BookmarkImportButton),
  { ssr: false },
)
import { SectionState } from '@/components/user-center/section-state'
import {
  AlertTriangle,
  Bookmark,
  Bot,
  CheckCircle2,
  Database,
  Download,
  Eraser,
  FolderHeart,
  Heart,
  History,
  Loader2,
  ShieldCheck,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react'

type ViewState = 'loading' | 'anonymous' | 'ready' | 'deleted' | 'error'

type PruneDomain = 'search_history' | 'events_profile' | 'vault' | 'crdt' | 'llm_config'

const PRUNE_OPTIONS: ReadonlyArray<{
  id: PruneDomain
  label: string
  description: string
}> = [
  {
    id: 'search_history',
    label: '仅清空云端搜索历史',
    description: '清除全部云端搜索词记录，保留收藏夹与个人设置',
  },
  {
    id: 'events_profile',
    label: '仅重置行为事件与个性化画像',
    description: '清除近 180 天点击/浏览遥测与画像标签，搜索恢复默认排序',
  },
  {
    id: 'vault',
    label: '仅清除零知识 E2EE 金库密文',
    description: '删除云端加密备份密文包，不影响本机已保存的明文收藏',
  },
  {
    id: 'crdt',
    label: '仅清除 CRDT 跨端排版同步日志',
    description: '重置云端多端协同排版操作日志，保留本机 DIY 布局',
  },
  {
    id: 'llm_config',
    label: '仅清除个人 AI 模型密钥配置',
    description: '删除云端加密存储的个人 API Key，回退使用系统默认模型',
  },
]

interface DataOverviewSummary {
  counts: {
    favorites: number
    folders: number
    searches: number
    activePluginInstalls: number
    pluginStars: number
    recentEvents: number
  }
  vault: { exists: boolean; version: number | null }
  llmConfig: { exists: boolean }
}

export default function MeDataPage() {
  const { toast } = useToast()
  const favorites = useFavorites()
  const [state, setState] = useState<ViewState>('loading')
  const [summary, setSummary] = useState<DataOverviewSummary | null>(null)
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)

  // 备份导入恢复状态
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importJsonText, setImportJsonText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{
    foldersImported: number
    favoritesImported: number
    favoritesSkipped: number
    /** 其中因「站点已不在中枢」而恢复不了的条数 */
    favoritesSkippedMissingSite: number
    searchesImported: number
    /** 本次窗口里账户已存在、自动跳过的条数（解释「0 条导入」到底为什么） */
    searchesSkippedDuplicate: number
    /** 备份里有、但本次没导的历史条数（逐条写入，单次有上限） */
    searchesTruncated: number
    historyImportCap: number
    settingsRestored: boolean
    settingsError: string | null
    /** 备份文件在导出那一刻就已经不完整 */
    backupHistoryTruncated: boolean
    historyExportLimit: number
    /** 服务端给的续导起点；null = 备份里的历史已全部导完 */
    nextHistoryOffset: number | null
    /** 插件星标/评价重放计数（T2 导入导出对称化） */
    starsImported: number
    starsSkippedDuplicate: number
    starsSkippedMissing: number
    reviewsImported: number
    reviewsSkippedNotInstalled: number
    reviewsSkippedMissing: number
    reviewsSkippedInvalid: number
  } | null>(null)
  // 续导要把同一份备份再发一次，所以原文得留在内存里（不进 state 免得触发重渲染）。
  // T2 起同时落一份到 sessionStorage（会话级）：刷新页面不再丢续导进度，
  // 关标签页即清，不留长期明文备份。
  const lastBackupRef = useRef<Record<string, unknown> | null>(null)
  const RESUME_KEY = 'navhub.import.resume.v1'
  const [resumeInfo, setResumeInfo] = useState<{ remaining: number; offset: number } | null>(null)

  const persistResume = useCallback((payload: Record<string, unknown>, remaining: number, offset: number) => {
    lastBackupRef.current = payload
    try {
      if (remaining > 0) {
        window.sessionStorage.setItem(RESUME_KEY, JSON.stringify({ payload, remaining, offset }))
        setResumeInfo({ remaining, offset })
      } else {
        window.sessionStorage.removeItem(RESUME_KEY)
        setResumeInfo(null)
      }
    } catch {
      // sessionStorage 不可写（隐私模式）：退回内存续导，刷新即丢——老行为
      setResumeInfo(remaining > 0 ? { remaining, offset } : null)
    }
  }, [])

  // 刷新后恢复续导上下文（只在登录态就绪时提示，避免匿名访客看到无意义入口）
  useEffect(() => {
    if (state !== 'ready') return
    // 读 sessionStorage 放微任务：effect 同步段不触碰 setState（set-state-in-effect）
    void Promise.resolve().then(() => {
      try {
        const raw = window.sessionStorage.getItem(RESUME_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw) as { payload?: Record<string, unknown>; remaining?: number; offset?: number }
        if (parsed?.payload && typeof parsed.remaining === 'number' && parsed.remaining > 0) {
          lastBackupRef.current = parsed.payload
          setResumeInfo({ remaining: parsed.remaining, offset: Number(parsed.offset ?? 0) })
        }
      } catch {
        // 坏数据直接清掉，不让一次解析失败卡住导入区
        try { window.sessionStorage.removeItem(RESUME_KEY) } catch { /* 忽略 */ }
      }
    })
  }, [state])

  // 按域精细化清理状态
  const [confirmPruneDomain, setConfirmPruneDomain] = useState<PruneDomain | null>(null)
  const [pruningDomain, setPruningDomain] = useState<PruneDomain | null>(null)

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/me', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as DataOverviewSummary
      if (data && data.counts) setSummary(data)
    } catch {
      // 概览统计属于增强信息，失败不阻塞导出与删除主流程
    }
  }, [])

  // 会话探测失败 ≠ 匿名：非 2xx / 解析失败 / 网络异常一律落 error（可重试），
  // 只有"服务端明确返回无 user"才是 anonymous。
  const loadSession = useCallback(async () => {
    setState('loading')
    const probe = await probeClientSession()
    if (probe.kind !== 'ok') {
      setState('error')
      return
    }
    if (probe.session.user?.id) {
      setState('ready')
      void loadSummary()
    } else {
      setState('anonymous')
    }
  }, [loadSummary])

  useEffect(() => {
    // 取数放微任务：effect 同步段不触碰 setState（set-state-in-effect）
    void Promise.resolve().then(loadSession)
  }, [loadSession])

  const handleExport = useCallback(async () => {
    setExporting(true)
    setError(null)
    try {
      const res = await fetch('/api/me/export', { cache: 'no-store' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || '导出失败')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `navhub-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: '导出已开始下载', description: 'JSON 内不含 LLM 明文密钥与金库密文。' })
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }, [toast])

  const submitImport = useCallback(
    async (payload: Record<string, unknown>, offset: number) => {
      setImporting(true)
      setError(null)
      setImportResult(null)
      try {
        const res = await fetch('/api/me/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(offset > 0 ? { ...payload, searchHistoryOffset: offset } : payload),
          cache: 'no-store',
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          foldersImported?: number
          favoritesImported?: number
          favoritesSkipped?: number
          favoritesSkippedMissingSite?: number
          searchesImported?: number
          searchesSkippedDuplicate?: number
          searchesTruncated?: number
          historyImportCap?: number
          settingsRestored?: boolean
          settingsError?: string | null
          backupHistoryTruncated?: boolean
          historyExportLimit?: number
          nextHistoryOffset?: number | null
          starsImported?: number
          starsSkippedDuplicate?: number
          starsSkippedMissing?: number
          reviewsImported?: number
          reviewsSkippedNotInstalled?: number
          reviewsSkippedMissing?: number
          reviewsSkippedInvalid?: number
          error?: string
        }
        if (!res.ok || !data.ok) {
          throw new Error(data.error || '导入恢复失败')
        }
        const result = {
          foldersImported: Number(data.foldersImported ?? 0),
          favoritesImported: Number(data.favoritesImported ?? 0),
          favoritesSkipped: Number(data.favoritesSkipped ?? 0),
          favoritesSkippedMissingSite: Number(data.favoritesSkippedMissingSite ?? 0),
          searchesImported: Number(data.searchesImported ?? 0),
          searchesSkippedDuplicate: Number(data.searchesSkippedDuplicate ?? 0),
          searchesTruncated: Number(data.searchesTruncated ?? 0),
          historyImportCap: Number(data.historyImportCap ?? 200),
          settingsRestored: Boolean(data.settingsRestored),
          settingsError: typeof data.settingsError === 'string' ? data.settingsError : null,
          backupHistoryTruncated: Boolean(data.backupHistoryTruncated),
          historyExportLimit: Number(data.historyExportLimit ?? 5000),
          nextHistoryOffset:
            typeof data.nextHistoryOffset === 'number' && Number.isFinite(data.nextHistoryOffset)
              ? data.nextHistoryOffset
              : null,
          starsImported: Number(data.starsImported ?? 0),
          starsSkippedDuplicate: Number(data.starsSkippedDuplicate ?? 0),
          starsSkippedMissing: Number(data.starsSkippedMissing ?? 0),
          reviewsImported: Number(data.reviewsImported ?? 0),
          reviewsSkippedNotInstalled: Number(data.reviewsSkippedNotInstalled ?? 0),
          reviewsSkippedMissing: Number(data.reviewsSkippedMissing ?? 0),
          reviewsSkippedInvalid: Number(data.reviewsSkippedInvalid ?? 0),
        }
        setImportResult(result)
        // 续导上下文按结果刷新：导完即清，没导完则更新剩余数与起点（sessionStorage 兜刷新）
        persistResume(payload, result.searchesTruncated, result.nextHistoryOffset ?? 0)
        setImportJsonText('')
        // 恢复类操作最怕「其实没恢复全但看着像成功」：只要有任何跳过/截断就不许再报「成功」
        const lost =
          result.favoritesSkippedMissingSite + result.searchesTruncated + (result.settingsError ? 1 : 0)
        toast({
          title: lost > 0 ? '备份已导入，但有内容没能恢复' : '云端备份已导入',
          description:
            `新增收藏 ${result.favoritesImported} 条、收藏夹 ${result.foldersImported} 个、搜索历史 ${result.searchesImported} 条` +
            (result.starsImported + result.reviewsImported > 0
              ? `、插件星标 ${result.starsImported} 个、评价 ${result.reviewsImported} 条`
              : '') +
            (result.favoritesSkippedMissingSite > 0
              ? `；${result.favoritesSkippedMissingSite} 条收藏对应的站点已不在中枢，未能恢复`
              : '') +
            (result.searchesTruncated > 0
              ? `；${result.searchesTruncated} 条历史超出单次 ${result.historyImportCap} 条上限，点结果里的「继续导入剩余」接着导`
              : '') +
            (result.settingsError ? `；偏好设置未能恢复：${result.settingsError}` : '') +
            (result.backupHistoryTruncated
              ? `；提醒：这份备份在导出时历史就已截断（上限 ${result.historyExportLimit} 条），更早的记录不在文件里`
              : ''),
          variant: lost > 0 ? 'destructive' : 'default',
        })
        void loadSummary()
      } catch (err) {
        setError(err instanceof Error ? err.message : '备份导入失败')
      } finally {
        setImporting(false)
      }
    },
    [loadSummary, persistResume, toast],
  )

  const handleImportBackup = useCallback(
    async (rawText: string) => {
      const trimmed = rawText.trim()
      if (!trimmed || importing) return
      let parsedPayload: unknown
      try {
        parsedPayload = JSON.parse(trimmed)
      } catch {
        setImportResult(null)
        setError('备份文件不是合法的 JSON 格式，请检查文件内容')
        return
      }
      if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
        setImportResult(null)
        setError('备份文件顶层不是对象，无法识别为山羊胡导出的备份 JSON')
        return
      }
      lastBackupRef.current = parsedPayload as Record<string, unknown>
      await submitImport(parsedPayload as Record<string, unknown>, 0)
    },
    [importing, submitImport],
  )

  const handlePruneDomain = useCallback(
    async (domain: PruneDomain) => {
      if (confirmPruneDomain !== domain) {
        setConfirmPruneDomain(domain)
        return
      }
      setPruningDomain(domain)
      setError(null)
      try {
        const res = await fetch('/api/me/prune', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domains: [domain] }),
          cache: 'no-store',
        })
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
        if (!res.ok || !data.ok) {
          throw new Error(data.error || '清理失败')
        }
        setConfirmPruneDomain(null)
        toast({ title: '所选数据域已成功清理', description: '你的收藏夹与其余账户数据完好无损。' })
        void loadSummary()
      } catch (err) {
        setError(err instanceof Error ? err.message : '按域清理失败')
      } finally {
        setPruningDomain(null)
      }
    },
    [confirmPruneDomain, loadSummary, toast],
  )

  const handleDelete = useCallback(async () => {
    if (confirmText.trim().toUpperCase() !== 'DELETE') return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch('/api/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || '删除失败')
      // 云端已清空：本机收藏缓存一并清掉，避免下次同步又把旧数据推回云端
      favorites.clear()
      setState('deleted')
      toast({ title: '云端数据已删除', description: '登录账号保留，重新登录后是空账号。' })
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }, [confirmText, favorites, toast])

  return (
    <Container as="main" id="main-content" className="space-y-6 pt-3 pb-8 sm:pt-4 sm:pb-10">
      <CenterPageHeader
        title="数据与隐私"
        icon={ShieldCheck}
        back={{ href: '/me', label: '用户中心' }}
        description="你的收藏、搜索历史、画像、LLM 配置与金库元信息都归你所有：支持随时导出、从备份一键导入还原、按域精细化清理或彻底注销。"
      />

      {/* 本机隔离区：巡检承诺「原文已整份留档、可在这里对照找回」，这一节就是那个出口。
          放在登录态判断之外 —— 匿名访客的坏数据同样只在本机，登录后云端也帮不上。 */}
      <QuarantineZone />

      {state === 'loading' && <SectionState variant="loading" rows={1} rowClassName="h-32" loadingLabel="正在确认登录状态" />}

      {state === 'error' && (
        <SectionState
          variant="error"
          title="登录状态暂时无法确认"
          description="这通常是网络或会话服务抖动，不代表你的账号有问题。稍后重试即可，数据没有任何变动。"
          onRetry={() => void loadSession()}
        />
      )}

      {state === 'anonymous' && (
        <AnonymousHint
          title="需要登录后管理云端数据"
          description="匿名数据只保存在本机浏览器；登录后可导出、导入恢复与按域清理云端数据，也能把本机匿名数据合并到账号。"
          callbackUrl="/me/data"
        />
      )}

      {state === 'deleted' && (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 sm:p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold">云端数据已删除</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                收藏、历史、画像、LLM 配置、金库元信息与插件安装记录均已清除，登录账号本身保留。
              </p>
              <Button asChild variant="outline" size="sm" className="mt-3 w-full text-xs sm:w-auto">
                <Link href="/me">返回用户中心</Link>
              </Button>
            </div>
          </div>
        </section>
      )}

      {state === 'ready' && (
        <>
          {error && (
            <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive" role="alert">
              {error}
            </section>
          )}

          {/* 云端数据资产全景清点 */}
          {summary && (
            <section
              aria-label="云端个人数据资产清点"
              className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Database className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  当前云端数据资产清点
                </h2>
                <span className="text-[11px] text-muted-foreground">实时统计当前账号名下存量</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                {(
                  [
                    { label: '云端收藏', value: summary.counts.favorites, icon: Heart, chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
                    { label: '收藏夹分组', value: summary.counts.folders, icon: FolderHeart, chip: 'bg-orange-500/10 text-orange-700 dark:text-orange-300' },
                    { label: '搜索历史', value: summary.counts.searches, icon: History, chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
                    { label: '近 30 天事件', value: summary.counts.recentEvents, icon: Zap, chip: 'bg-primary/10 text-primary' },
                    { label: 'E2EE 金库', value: summary.vault.exists ? `v${summary.vault.version ?? 1}` : '未创建', icon: ShieldCheck, chip: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
                    { label: '个人 AI 配置', value: summary.llmConfig.exists ? '已配置' : '跟随系统', icon: Bot, chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
                  ] as const
                ).map(({ label, value, icon: Icon, chip }) => (
                  <div key={label} className="rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 transition-colors hover:border-primary/40">
                    <span className={`mb-1.5 flex h-6 w-6 items-center justify-center rounded-md ${chip}`}>
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Download className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                导出我的数据
              </h2>
              <span className="text-[11px] text-muted-foreground">JSON 与书签 HTML 两种格式</span>
            </div>
            <p className="mt-3 max-w-prose text-xs leading-relaxed text-muted-foreground">
              包含收藏与文件夹、搜索历史、画像、设置、插件安装记录、金库版本信息。LLM 配置只保留模型与地址，
              不含密钥；金库只导出加密后的元信息。
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Button size="sm" className="w-full text-xs sm:w-auto" disabled={exporting} onClick={() => void handleExport()}>
                {exporting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
                下载 JSON
              </Button>
              {/* M9 互操作：书签 HTML 是 Chrome/Firefox/Safari/Edge 都能直接导入的标准格式 */}
              <Button asChild size="sm" variant="outline" className="w-full text-xs sm:w-auto">
                <a href="/api/me/export/bookmarks.html">
                  <Bookmark className="mr-2 h-3.5 w-3.5" />
                  导出浏览器书签（HTML）
                </a>
              </Button>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              书签文件可直接导入 Chrome / Firefox / Safari / Edge，分组按收藏夹还原。
            </p>
          </section>

          {/* 从导出的 JSON 备份一键导入恢复 */}
          <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Upload className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                从 JSON 备份导入与恢复
              </h2>
              <span className="text-[11px] text-muted-foreground">幂等合并，不覆盖已有收藏</span>
            </div>
            <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted-foreground">
              选择或粘贴通过上方「下载 JSON」导出的 <code className="font-mono">navhub-export-*.json</code> 文件，即可合并恢复收藏夹分组、收藏站点、搜索历史与个人偏好设置：已存在的内容不会被覆盖，
              搜索历史受中枢逐条写入限制，单次最多恢复一部分，剩余条数会在结果里说明并提供「继续导入剩余」按钮。
            </p>

            {importResult && (
              <div
                className={
                  importResult.favoritesSkippedMissingSite + importResult.searchesTruncated > 0
                    ? 'mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200'
                    : 'mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300'
                }
              >
                <p className="font-semibold">
                  {importResult.favoritesSkippedMissingSite + importResult.searchesTruncated > 0
                    ? '备份导入完成，但以下数据没能恢复：'
                    : '备份导入恢复完成：'}
                </p>
                <p className="mt-0.5 text-[11px]">
                  新增收藏夹 {importResult.foldersImported} 个 · 新增收藏 {importResult.favoritesImported} 条（已存在跳过{' '}
                  {importResult.favoritesSkipped - importResult.favoritesSkippedMissingSite} 条）· 导入搜索历史{' '}
                  {importResult.searchesImported} 条
                  {importResult.favoritesSkippedMissingSite > 0
                    ? ` · ${importResult.favoritesSkippedMissingSite} 条收藏的站点已不在中枢，无法恢复`
                    : ''}
                  {importResult.searchesSkippedDuplicate > 0
                    ? ` · 其中 ${importResult.searchesSkippedDuplicate} 条账户里已有，未重复写入`
                    : ''}
                  {importResult.searchesTruncated > 0
                    ? ` · ${importResult.searchesTruncated} 条历史超出单次 ${importResult.historyImportCap} 条上限，用下方「继续导入剩余」接着导`
                    : ''}
                  {importResult.starsImported + importResult.starsSkippedDuplicate + importResult.starsSkippedMissing > 0
                    ? ` · 插件星标恢复 ${importResult.starsImported} 个（已标过跳过 ${importResult.starsSkippedDuplicate}、插件已不存在 ${importResult.starsSkippedMissing}）`
                    : ''}
                  {importResult.reviewsImported + importResult.reviewsSkippedNotInstalled + importResult.reviewsSkippedMissing + importResult.reviewsSkippedInvalid > 0
                    ? ` · 插件评价恢复 ${importResult.reviewsImported} 条（未安装该插件跳过 ${importResult.reviewsSkippedNotInstalled}、插件不存在 ${importResult.reviewsSkippedMissing}、内容无效 ${importResult.reviewsSkippedInvalid}）`
                    : ''}
                  {importResult.settingsError
                    ? ` · 偏好设置未能恢复：${importResult.settingsError}`
                    : importResult.settingsRestored
                      ? ' · 已同步恢复个人偏好设置'
                      : ''}
                  {importResult.backupHistoryTruncated
                    ? ` · 注意：这份备份导出时历史就已截断（上限 ${importResult.historyExportLimit} 条），更早的记录不在文件里`
                    : ''}
                </p>
                {importResult.nextHistoryOffset !== null && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 text-xs"
                    disabled={importing}
                    onClick={() => void submitImport(lastBackupRef.current!, importResult.nextHistoryOffset!)}
                  >
                    {importing ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-3.5 w-3.5" />
                    )}
                    继续导入剩余 {importResult.searchesTruncated} 条搜索历史
                  </Button>
                )}
              </div>
            )}

            {resumeInfo && (
              <ImportResumeBanner
                remaining={resumeInfo.remaining}
                busy={importing}
                onResume={() => void submitImport(lastBackupRef.current!, resumeInfo.offset)}
              />
            )}

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                aria-label="选择备份 JSON 文件"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = () => {
                    if (typeof reader.result === 'string') {
                      void handleImportBackup(reader.result)
                    }
                  }
                  reader.readAsText(file)
                  e.target.value = ''
                }}
              />
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs sm:w-auto"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
              >
                {importing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
                选择备份 JSON 文件恢复
              </Button>
              <BookmarkImportButton favorites={favorites} />
              <Input
                aria-label="粘贴备份 JSON 内容"
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
                placeholder="或在此粘贴 navhub-export JSON 文本…"
                className="h-9 flex-1 text-xs"
              />
              {importJsonText.trim() && (
                <Button
                  size="sm"
                  className="w-full text-xs sm:w-auto"
                  disabled={importing}
                  onClick={() => void handleImportBackup(importJsonText)}
                >
                  立即还原
                </Button>
              )}
            </div>
          </section>

          {/* 按域精细化清理（解决只能全删的痛点） */}
          <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Eraser className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                按数据域精细化清理
              </h2>
              <span className="text-[11px] text-muted-foreground">只清理指定模块，绝不误删收藏夹</span>
            </div>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {PRUNE_OPTIONS.map((item) => {
                const isConfirming = confirmPruneDomain === item.id
                const isBusy = pruningDomain === item.id
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/50 p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">{item.label}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{item.description}</p>
                    </div>
                    <Button
                      size="sm"
                      variant={isConfirming ? 'destructive' : 'outline'}
                      className="h-7 shrink-0 text-[11px]"
                      disabled={isBusy}
                      onClick={() => void handlePruneDomain(item.id)}
                    >
                      {isBusy ? '清理中…' : isConfirming ? '确认清理' : '清理'}
                    </Button>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <h2 className="text-sm font-semibold">数据说明</h2>
            </div>
            <ul className="mt-3 list-inside list-disc space-y-1.5 text-xs leading-relaxed text-muted-foreground marker:text-muted-foreground/60">
              <li className="break-words">收藏与文件夹：全量删除后不可恢复，本机收藏缓存也会清空。</li>
              <li className="break-words">搜索历史与行为事件：画像会随之清空，之后按新行为重新积累。</li>
              <li className="break-words">LLM 配置：个人模型密钥（加密存储）一并删除，系统回退到全局配置。</li>
              <li className="break-words">插件安装与星标：安装记录清除，已安装的插件页面不受影响。</li>
              <li className="break-words">登录账号保留：NextAuth 会话仍然有效，重新登录后是空账号。</li>
            </ul>
          </section>

          <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                删除全部云端数据
              </h2>
              <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                不可逆
              </span>
            </div>
            <p className="mt-3 max-w-prose text-xs leading-relaxed text-muted-foreground">
              这是不可逆操作。输入 <span className="font-mono font-semibold text-destructive">DELETE</span> 解锁按钮。
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="输入 DELETE"
                className="h-9 w-full text-xs sm:w-44"
                aria-label="删除确认"
              />
              <Button
                variant="destructive"
                size="sm"
                className="w-full text-xs sm:w-auto"
                disabled={deleting || confirmText.trim().toUpperCase() !== 'DELETE'}
                onClick={() => void handleDelete()}
              >
                {deleting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-2 h-3.5 w-3.5" />}
                永久删除
              </Button>
            </div>
          </section>
        </>
      )}

      <Footer />
    </Container>
  )
}
