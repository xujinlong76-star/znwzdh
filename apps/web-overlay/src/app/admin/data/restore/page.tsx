'use client'

/**
 * 管理端：冷备恢复。
 *
 * 存在的理由：`POST /api/backup/restore` 上线至今**没有前端入口**，
 * 恢复只能手工 curl。后果不只是「不方便」——一个没人从界面上走过的功能，
 * 它的预演文案、错误提示、耗时表现都没人验证过（本轮就是靠压测才发现
 * 5 万条会超过代理超时）。
 *
 * 交互刻意分成三步，而不是「选文件 → 直接恢复」：
 *   1. 本地解析：立刻告诉用户「这个包里有几个分类、几个站点」，解析失败当场报；
 *   2. 预演（服务端 dryRun）：算出真正会新增多少、跳过多少（重复/非法 URL）；
 *   3. 执行：必须先勾选确认，才能点。恢复是整库写操作，不能一步到位。
 *
 * 为什么不自动在选文件后跑预演：预演也是一次完整校验（要读全库 URL 集合），
 * 用户可能只是想看看包里是什么。给一个显式按钮更符合预期，也避免误触。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, DatabaseBackup, FileJson, Loader2, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/registry/new-york/ui/checkbox'
import { hubGet, hubSend } from '@/lib/navhub-api'
import { describeDegrade } from '@/lib/degrade'

/** 冷备包最小结构（够判断「这是不是一个 NavHub 备份」即可，完整校验在服务端） */
interface ParsedBackup {
  version?: string
  generator?: string
  exportedAt?: number
  categories: unknown[]
  sites: unknown[]
}

interface DryRunResult {
  wouldRestore: { categories: number; sites: number }
  skipped: { duplicateCategories: number; invalidUrls: number; duplicateUrls: number }
  sample: { categories: string[]; sites: string[] }
  message: string
}

interface RestoreResult {
  message: string
  restored: { categories: number; sites: number }
  durationMs?: number
  reindexQueued?: boolean
}

/** POST /api/backup/restore/async 的 202 响应 */
interface AsyncAccepted {
  jobId: string
  accepted: { categories: number; sites: number }
  skipped: DryRunResult['skipped']
  statusUrl: string
  retryAfterMs?: number
  message: string
}

/**
 * 无事可做时端点返回 200（不是 202 + 一个 0/0 的任务）。
 * 依据 RFC 9110 §15.3.3：工作已经完成或根本没有工作时，应当返回 200/201。
 */
interface NothingToDo {
  nothingToDo: true
  skipped: DryRunResult['skipped']
  message: string
}

/** 与服务端 jobs.status 对齐（是 `done`，不是 `completed`） */
type JobStatus = 'pending' | 'running' | 'retrying' | 'done' | 'failed' | 'cancelled'

/** 前端持有的任务视图：比服务端多存了「当初计划写多少」，失败时才能说清进度 */
interface JobState {
  jobId: string
  categories: number
  sites: number
  status: JobStatus
  progress: { done: number; total: number }
  error: string | null
  retryable: boolean
  startedAt: number
  finishedAt: number | null
}

/** 后台恢复任务的进度快照（GET /api/backup/restore/status/:jobId） */
interface JobStatusPayload {
  jobId: string
  status: JobStatus
  progress: { done: number; total: number }
  startedAt: number
  finishedAt: number | null
  /** 服务端建议的下次轮询间隔（未终态才给）；用于让轮询节奏由服务端指挥 */
  retryAfterMs?: number | null
  error: string | null
  retryable: boolean
}

/**
 * 站点数超过这个阈值就改走后台任务。
 *
 * 依据是实测：同步端点在 SQLite 上 1 万条约 7.4 秒，5 万条上限外推约 37 秒，
 * 超过 BFF 代理的 30 秒读超时——那次失败最恶劣（504 但数据其实已落库，
 * 用户以为失败、实际已改）。5000 条约 4 秒，留足余量。
 */
const ASYNC_THRESHOLD = 5000

/** 进度轮询间隔。任务每 2000 条上报一次，1.5 秒足够跟上且不刷爆日志。 */
const POLL_INTERVAL_MS = 1500

/** 轮询上限：服务端给的建议值、以及出错退避的上限（避免长任务把间隔拉到几分钟） */
const POLL_MAX_INTERVAL_MS = 5000

/**
 * 盯一个任务最多盯多久。超过就转后台——长任务不该把标签页钉死。
 * 注意这不代表任务失败：任务在服务端，用户回来还能接着看。
 */
const POLL_DEADLINE_MS = 10 * 60_000

const TERMINAL_STATUS: ReadonlySet<JobStatus> = new Set<JobStatus>(['done', 'failed', 'cancelled'])

const STATUS_TEXT: Record<JobStatus, string> = {
  pending: '排队中（等待任务执行器认领）',
  running: '执行中',
  retrying: '等待重试',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

/**
 * 把 jobId 存进 sessionStorage，让「关掉页面再回来」还能接着看同一个任务的进度。
 *
 * 用 sessionStorage 而非 localStorage：恢复进度属于这一次操作，跨标签页/跨天
 * 复用同一份记录只会让人误会「上次那个任务还在跑」。任务本身在服务端，
 * 丢掉这条记录不影响执行，只影响能不能在界面上接着看。
 */
const JOB_STORAGE_KEY = 'navhub.restore.job.v1'
const JOB_TTL_MS = 24 * 60 * 60 * 1000

/** 服务端只回错误类别（不回原始报错，避免泄漏备份里的具体值） */
const REASON_TEXT: Record<string, string> = {
  duplicate_key: '备份里有重复的主键（同一分类或站点出现了多次）',
  foreign_key: '备份引用了不存在的关联对象',
  not_null: '备份里有条目缺少必填字段',
  schema: '备份结构与当前数据库版本不匹配',
  unknown: '未知错误，请查看服务端日志',
}

function reasonText(reason: unknown): string {
  if (typeof reason !== 'string') return REASON_TEXT.unknown
  return REASON_TEXT[reason] ?? `未知错误（${reason}）`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

interface PersistedJob {
  jobId: string
  categories: number
  sites: number
  startedAt: number
}

/** sessionStorage 在隐私模式/服务端渲染下都可能不可用——静默失败，不打断恢复 */
function persistJob(job: JobState): void {
  try {
    const payload: PersistedJob = {
      jobId: job.jobId,
      categories: job.categories,
      sites: job.sites,
      startedAt: job.startedAt,
    }
    sessionStorage.setItem(JOB_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* 存不下只影响「刷新后继续看」，不影响任务本身 */
  }
}

function clearPersistedJob(): void {
  try {
    sessionStorage.removeItem(JOB_STORAGE_KEY)
  } catch {
    /* 同上 */
  }
}

function readPersistedJob(): PersistedJob | null {
  try {
    const raw = sessionStorage.getItem(JOB_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedJob>
    if (typeof parsed.jobId !== 'string' || !parsed.jobId) return null
    const startedAt = typeof parsed.startedAt === 'number' ? parsed.startedAt : 0
    // 超过 TTL 的记录多半指向早已被清理的任务，留着只会换来一个 404
    if (!startedAt || Date.now() - startedAt > JOB_TTL_MS) {
      clearPersistedJob()
      return null
    }
    return {
      jobId: parsed.jobId,
      categories: Number(parsed.categories ?? 0),
      sites: Number(parsed.sites ?? 0),
      startedAt,
    }
  } catch {
    return null
  }
}

type Busy = 'preview' | 'restore' | null

export default function RestoreBackupPage() {
  const [fileName, setFileName] = useState<string>('')
  const [fileBytes, setFileBytes] = useState<number>(0)
  const [backup, setBackup] = useState<ParsedBackup | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [preview, setPreview] = useState<DryRunResult | null>(null)
  const [result, setResult] = useState<RestoreResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * 错误发生在哪一步，决定标题怎么说。
   *
   * 原来只有一句「恢复失败，已整体回滚」——但预演失败与异步提交失败时**一条都没写**，
   * 说「已回滚」会让人以为数据被改过又撤销，反而去查库里有没有脏数据。
   */
  const [errorKind, setErrorKind] = useState<'preview' | 'submit' | 'sync' | null>(null)
  const [failureReason, setFailureReason] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  /** 后台恢复任务（仅站点数 > ASYNC_THRESHOLD 时产生） */
  const [job, setJob] = useState<JobState | null>(null)
  /** 是否正在盯着这个任务。「继续在后台跑」把它关掉，任务本身不受影响 */
  const [watching, setWatching] = useState(false)
  /** 轮询失败与任务失败是两件事：前者是「看不到进度」，后者是「恢复死了」 */
  const [pollError, setPollError] = useState<string | null>(null)
  /** 自动转后台时的说明（手动转后台不需要这句话，用户知道自己点了什么） */
  const [pollNotice, setPollNotice] = useState<string | null>(null)
  /** 取消请求在途：按钮置灰，避免连点发出多个取消 */
  const [cancelling, setCancelling] = useState(false)

  const resetDownstream = useCallback(() => {
    setPreview(null)
    setResult(null)
    setError(null)
    setErrorKind(null)
    setFailureReason(null)
    setConfirmed(false)
    setJob(null)
    setWatching(false)
    setPollError(null)
    setPollNotice(null)
  }, [])

  const handleFile = useCallback(
    async (file: File | undefined) => {
      resetDownstream()
      setBackup(null)
      setParseError(null)
      setFileName('')
      setFileBytes(0)
      if (!file) return

      setFileName(file.name)
      setFileBytes(file.size)
      try {
        const text = await file.text()
        const parsed = JSON.parse(text) as Record<string, unknown>
        if (!parsed || typeof parsed !== 'object') throw new Error('不是有效的 JSON 对象')
        if (!Array.isArray(parsed.categories) || !Array.isArray(parsed.sites)) {
          // 与服务端同一条判据：缺数组就是错的包，别让它走到预演
          throw new Error('缺少 categories 或 sites 数组，可能不是 NavHub 冷备包')
        }
        setBackup({
          version: typeof parsed.version === 'string' ? parsed.version : undefined,
          generator: typeof parsed.generator === 'string' ? parsed.generator : undefined,
          exportedAt: typeof parsed.exportedAt === 'number' ? parsed.exportedAt : undefined,
          categories: parsed.categories as unknown[],
          sites: parsed.sites as unknown[],
        })
      } catch (err) {
        setParseError(err instanceof Error ? err.message : '文件读取失败')
      }
    },
    [resetDownstream],
  )

  const runPreview = useCallback(async () => {
    if (!backup) return
    setBusy('preview')
    setError(null)
    setErrorKind(null)
    setFailureReason(null)
    setResult(null)
    try {
      const data = await hubSend<DryRunResult>('/api/backup/restore?dryRun=true', 'POST', backup)
      setPreview(data)
    } catch (err) {
      setErrorKind('preview')
      setError(describeDegrade(err).message)
    } finally {
      setBusy(null)
    }
  }, [backup])

  const runRestore = useCallback(async () => {
    if (!backup || !preview || !confirmed) return
    setBusy('restore')
    setError(null)
    setErrorKind(null)
    setFailureReason(null)
    setPollError(null)
    setResult(null)
    setJob(null)

    /**
     * 大包走后台任务。判据是**预演算出的站点数**而不是备份包里的原始条数：
     * 一个 2 万条的包里可能 1.9 万条都是已存在的重复 URL，实际写入只有 1000 条，
     * 那种情况走同步反而更快、也不会超时。
     */
    if (preview.wouldRestore.sites > ASYNC_THRESHOLD) {
      try {
        const data = await hubSend<AsyncAccepted | NothingToDo>('/api/backup/restore/async', 'POST', backup)
        /**
         * 无事可做：端点返回 200 而不是建一个 0/0 的任务。
         * 这里直接展示服务端的说明，不进入进度卡——否则用户会盯着一个永远不动的进度条。
         */
        if ('nothingToDo' in data && data.nothingToDo) {
          setResult({ message: data.message, restored: { categories: 0, sites: 0 } })
          return
        }
        const accepted = data as AsyncAccepted
        const next: JobState = {
          jobId: accepted.jobId,
          categories: accepted.accepted.categories,
          sites: accepted.accepted.sites,
          status: 'pending',
          progress: { done: 0, total: accepted.accepted.sites },
          error: null,
          retryable: false,
          startedAt: Date.now(),
          finishedAt: null,
        }
        setJob(next)
        persistJob(next)
        setWatching(true)
        setPollNotice(null)
      } catch (err) {
        // 走到这里说明请求内就被拒了（非法包/超限/磁盘/已有任务在跑），一条都没写
        setErrorKind('submit')
        setError(describeDegrade(err).message)
        const payload = (err as { payload?: { reason?: string } })?.payload
        setFailureReason(payload?.reason ? reasonText(payload.reason) : null)
      } finally {
        setBusy(null)
      }
      return
    }

    try {
      const data = await hubSend<RestoreResult>('/api/backup/restore?dryRun=false', 'POST', backup)
      setResult(data)
    } catch (err) {
      // 409 上带的是「类别」而不是原始报错，尽量把它翻成人话
      const message = describeDegrade(err).message
      setErrorKind('sync')
      setError(message)
      const reason = (err as { payload?: { reason?: string } })?.payload?.reason
      setFailureReason(reason ? reasonText(reason) : null)
    } finally {
      setBusy(null)
    }
  }, [backup, preview, confirmed])

  const jobActive = job !== null && !TERMINAL_STATUS.has(job.status)

  /**
   * 请求取消当前任务。
   *
   * 不把状态直接改成 cancelled：服务端只在**分片边界**停下（一个分片是一个事务，
   * 中途喊停没有意义），所以真实停下的时刻要由 status 端点告诉我们。
   * 这里只提示「已提交」，下一轮轮询会把终态带回来。
   */
  const cancelRunningJob = useCallback(async () => {
    if (!job) return
    setCancelling(true)
    setPollError(null)
    try {
      await hubSend(`/api/jobs/${job.jobId}/cancel`, 'POST')
      setPollNotice('取消请求已提交，任务会在当前分片写完时停下；已写入的数据会保留。')
    } catch (err) {
      setPollError(describeDegrade(err).message)
    } finally {
      setCancelling(false)
    }
  }, [job])
  /** 只在「有任务、未终态、且用户在盯着」时轮询；三者任一变化都会让 effect 重新评估 */
  const pollingJobId = job && jobActive && watching ? job.jobId : null

  /**
   * 进度轮询（自调度 setTimeout，不是 setInterval）。
   *
   * 三个刻意的选择：
   *   1. 依赖只用 pollingJobId：状态更新（pending → running → done）不改变 jobId，
   *      effect 不会因为「进度变了」而重建定时器；终态时它变成 null，自然清理。
   *   2. 间隔由服务端指挥（`retryAfterMs`，来自 `Retry-After`），取不到就用 1.5 秒；
   *      出错时翻倍退避——网络抖一下不该立刻再来一次。
   *   3. 有 10 分钟上限：到点自动转后台。长任务不该把标签页钉死，
   *      而「还在盯着」本身没有价值——任务在服务端，回来还能看。
   */
  useEffect(() => {
    if (!pollingJobId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = POLL_INTERVAL_MS
    const deadline = Date.now() + POLL_DEADLINE_MS

    const tick = async () => {
      if (stopped) return
      if (Date.now() > deadline) {
        setWatching(false)
        setPollNotice('已连续轮询 10 分钟仍未结束，已转为后台运行。任务不受影响，回到本页可继续查看进度。')
        return
      }
      try {
        const data = await hubGet<JobStatusPayload>(`/api/backup/restore/status/${pollingJobId}`)
        if (stopped) return
        setPollError(null)
        setJob((prev) =>
          prev && prev.jobId === data.jobId
            ? {
                ...prev,
                status: data.status,
                progress: data.progress,
                error: data.error,
                retryable: data.retryable,
                finishedAt: data.finishedAt,
              }
            : prev,
        )
        // 成功才清记录：失败要留着，刷新后还能看到「上次恢复死在哪一步」
        if (data.status === 'done') clearPersistedJob()
        const suggested = Number(data.retryAfterMs ?? POLL_INTERVAL_MS)
        delay = Number.isFinite(suggested)
          ? Math.min(Math.max(POLL_INTERVAL_MS, suggested), POLL_MAX_INTERVAL_MS)
          : POLL_INTERVAL_MS
      } catch (err) {
        // 轮询失败不代表任务失败——可能只是这一秒网络抖了，退避后继续
        if (stopped) return
        setPollError(describeDegrade(err).message)
        delay = Math.min(delay * 2, POLL_MAX_INTERVAL_MS)
      }
      if (!stopped) timer = setTimeout(() => void tick(), delay)
    }

    void tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [pollingJobId])

  /** 刷新/换标签回来时接上同一个任务（任务在服务端，前端只是重新开始看） */
  useEffect(() => {
    const saved = readPersistedJob()
    if (!saved) return
    setJob({
      jobId: saved.jobId,
      categories: saved.categories,
      sites: saved.sites,
      status: 'pending',
      progress: { done: 0, total: saved.sites },
      error: null,
      retryable: false,
      startedAt: saved.startedAt,
      finishedAt: null,
    })
    setWatching(true)
  }, [])

  const exportedAtText = useMemo(() => {
    if (!backup?.exportedAt) return null
    const date = new Date(backup.exportedAt)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleString('zh-CN')
  }, [backup])

  // 后台任务未结束时禁止开新恢复：两个恢复并发写同一个库，谁赢谁输说不清
  const canPreview = Boolean(backup) && busy === null && !jobActive
  const canRestore = Boolean(backup && preview && confirmed) && busy === null && !jobActive
  const willUseAsync = Boolean(preview && preview.wouldRestore.sites > ASYNC_THRESHOLD)

  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <DatabaseBackup className="h-5 w-5 text-muted-foreground" aria-hidden />
          <h1 className="text-xl font-semibold">恢复冷备</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          从 <code className="rounded bg-muted px-1">.nhbak.json</code> 冷备包恢复分类与站点。
          恢复会写入整库，建议先在「导出」页留一份当前数据的备份。
        </p>
      </header>

      <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3" role="alert">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-amber-700 dark:text-amber-500">这是整库写操作</p>
          <p className="text-muted-foreground">
            已有 URL 会被跳过（不会覆盖），但新增条目会直接落库。5000 条以内走单个事务，
            失败整体回滚；超过 5000 条改走后台任务分批提交，中断时
            <strong>已写入的分片会保留</strong>
            ——重跑会跳过已存在的 URL，可以安全重试。
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · 选择备份文件</CardTitle>
          <CardDescription>本地解析，不会上传；点「预演」才会发给服务端</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="backup-file" className="text-sm font-medium">
              冷备包（JSON）
            </label>
            <input
              id="backup-file"
              type="file"
              accept=".json,application/json"
              disabled={jobActive}
              onChange={(event) => void handleFile(event.target.files?.[0])}
              className="block w-full cursor-pointer rounded-md border border-border bg-background p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          {jobActive && (
            <p className="text-sm text-muted-foreground">
              后台任务执行中，完成后再开始新的恢复（两个恢复同时写同一个库会让结果不可预期）。
            </p>
          )}

          {parseError && (
            <p className="text-sm text-destructive" role="alert">
              解析失败：{parseError}
            </p>
          )}

          {backup && (
            <dl className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">文件</dt>
                <dd className="truncate font-medium" title={fileName}>
                  {fileName}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">大小</dt>
                <dd className="font-medium">{formatBytes(fileBytes)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">分类 / 站点</dt>
                <dd className="font-medium">
                  {backup.categories.length} / {backup.sites.length}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">导出时间</dt>
                <dd className="font-medium">{exportedAtText ?? '未标注'}</dd>
              </div>
            </dl>
          )}

          <Button onClick={() => void runPreview()} disabled={!canPreview}>
            {busy === 'preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <FileJson className="mr-2 h-4 w-4" aria-hidden />}
            {busy === 'preview' ? '预演中…' : '预演（不写库）'}
          </Button>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2 · 预演结果</CardTitle>
            <CardDescription>{preview.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="将新增分类" value={preview.wouldRestore.categories} />
              <Stat label="将新增站点" value={preview.wouldRestore.sites} tone="primary" />
              <Stat label="重复分类" value={preview.skipped.duplicateCategories} muted />
              <Stat label="重复 URL" value={preview.skipped.duplicateUrls} muted />
            </div>

            {preview.skipped.invalidUrls > 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-500">
                另有 {preview.skipped.invalidUrls} 条 URL 非法（不是 http/https），会被跳过。
              </p>
            )}

            {preview.sample.sites.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  查看前 {preview.sample.sites.length} 条样例
                </summary>
                <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
                  {preview.sample.categories.map((title) => (
                    <li key={`cat-${title}`}>分类 · {title}</li>
                  ))}
                  {preview.sample.sites.map((url) => (
                    <li key={url} className="truncate">
                      站点 · {url}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="confirm-restore"
                  checked={confirmed}
                  onCheckedChange={(value: boolean | 'indeterminate') => setConfirmed(value === true)}
                />
                <label htmlFor="confirm-restore" className="text-sm leading-snug">
                  我确认要把 {preview.wouldRestore.sites} 个站点写入当前库，并已导出过现有数据
                </label>
              </div>
              <Button variant="destructive" onClick={() => void runRestore()} disabled={!canRestore}>
                {busy === 'restore' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <DatabaseBackup className="mr-2 h-4 w-4" aria-hidden />
                )}
                {busy === 'restore'
                  ? willUseAsync
                    ? '提交任务…'
                    : '恢复中…'
                  : '执行恢复'}
              </Button>
              {willUseAsync && (
                <p className="text-xs text-muted-foreground">
                  {preview.wouldRestore.sites} 条超过 {ASYNC_THRESHOLD}，将提交后台任务：
                  请求立刻返回，本页显示实时进度；关掉页面也不会中断执行，回到本页可继续查看。
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {job && (
        <JobProgress
          job={job}
          watching={watching}
          pollError={pollError}
          pollNotice={pollNotice}
          cancelling={cancelling}
          canRetry={canRestore}
          onKeepRunning={() => {
            setWatching(false)
            setPollNotice(null)
          }}
          onResume={() => {
            setWatching(true)
            setPollNotice(null)
          }}
          onCancel={() => void cancelRunningJob()}
          onRetry={() => void runRestore()}
        />
      )}

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="space-y-2 pt-6">
            <p className="flex items-center gap-2 text-sm font-medium text-destructive" role="alert">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {errorKind === 'sync'
                ? '恢复失败，已整体回滚'
                : errorKind === 'submit'
                  ? '任务未创建，未写入任何数据'
                  : '预演失败，未写入任何数据'}
            </p>
            <p className="text-sm text-muted-foreground">{error}</p>
            {failureReason && <p className="text-sm text-muted-foreground">原因：{failureReason}</p>}
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="border-emerald-500/40">
          <CardContent className="space-y-3 pt-6">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-500">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {result.message}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="新增分类" value={result.restored.categories} />
              <Stat label="新增站点" value={result.restored.sites} tone="primary" />
              <Stat label="耗时" value={result.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s` : '—'} muted />
            </div>
            {result.reindexQueued && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                语义索引正在后台重建；在此之前，新恢复的站点可通过全文与拼音检索命中。
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  muted,
}: {
  label: string
  value: number | string
  tone?: 'primary'
  muted?: boolean
}) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          tone === 'primary'
            ? 'text-lg font-semibold text-primary'
            : muted
              ? 'text-lg font-semibold text-muted-foreground'
              : 'text-lg font-semibold'
        }
      >
        {value}
      </div>
    </div>
  )
}

/**
 * 后台恢复任务的进度卡。
 *
 * 四处措辞刻意与同步路径不同：
 *   1. 失败时**不说**「已整体回滚」——异步是分片提交，已写入的分片是真实存在的；
 *   2. 取消与失败分开说：取消是用户主动的，不该显示「中断/失败」；
 *   3. 未知终态时说「任务在服务端」而不是「连接已断开」，避免让人重复提交；
 *   4. 进度条在 total 未知时显示不定态，不假装 0%。
 */
function JobProgress({
  job,
  watching,
  pollError,
  pollNotice,
  cancelling,
  canRetry,
  onKeepRunning,
  onResume,
  onCancel,
  onRetry,
}: {
  job: JobState
  watching: boolean
  pollError: string | null
  pollNotice: string | null
  cancelling: boolean
  canRetry: boolean
  onKeepRunning: () => void
  onResume: () => void
  onCancel: () => void
  onRetry: () => void
}) {
  const total = job.progress.total || job.sites
  const done = job.progress.done
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  const isDone = job.status === 'done'
  const isCancelled = job.status === 'cancelled'
  const isFailed = job.status === 'failed'
  const isActive = !isDone && !isFailed && !isCancelled
  const elapsedMs = job.finishedAt && job.startedAt ? job.finishedAt - job.startedAt : null

  return (
    <Card className={isDone ? 'border-emerald-500/40' : isFailed ? 'border-destructive/40' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          3 · 后台恢复
          <span className="font-mono text-xs font-normal text-muted-foreground">
            {job.jobId.slice(0, 8)}
          </span>
        </CardTitle>
        <CardDescription>{STATUS_TEXT[job.status]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="恢复进度"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            aria-valuetext={total > 0 ? `${done} / ${total} 条` : '准备中'}
          >
            <div
              className={isFailed ? 'h-full bg-destructive' : 'h-full bg-primary transition-all'}
              style={{ width: total > 0 ? `${pct}%` : '0%' }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {total > 0 ? (
              <>
                已处理 <span className="font-medium text-foreground">{done}</span> / {total} 条
                （{pct}%）
              </>
            ) : (
              '正在准备恢复计划…'
            )}
          </p>
        </div>

        {pollError && isActive && (
          <p className="text-xs text-amber-700 dark:text-amber-500" role="status">
            进度查询失败：{pollError}。任务仍在服务端执行，稍后自动重试。
          </p>
        )}

        {isActive && !watching && (
          <p className="text-sm text-muted-foreground">
            {pollNotice ?? '已转后台运行，本页不再刷新。任务结束后回到本页仍可查看结果。'}
          </p>
        )}

        {isDone && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-500">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              成功恢复 {job.categories} 个分类与 {done} 个站点
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="新增分类" value={job.categories} />
              <Stat label="新增站点" value={done} tone="primary" />
              <Stat label="耗时" value={elapsedMs ? `${(elapsedMs / 1000).toFixed(1)}s` : '—'} muted />
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              语义索引正在后台重建；在此之前，新恢复的站点可通过全文与拼音检索命中。
            </p>
          </div>
        )}

        {isCancelled && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-500">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              已取消：在已处理 {done} 条时停下
            </p>
            <p className="text-sm text-muted-foreground">
              取消只终止后续分片，<strong>已写入的那部分会保留</strong>。重跑会跳过已存在的 URL，
              可以接着补完，不会产生重复数据。
            </p>
          </div>
        )}

        {isFailed && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium text-destructive" role="alert">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              恢复中断：已处理 {done} 条后失败
            </p>
            {job.error && <p className="text-sm text-muted-foreground">{job.error}</p>}
            <p className="text-sm text-muted-foreground">
              后台恢复是分批提交的，<strong>已写入的那部分会保留</strong>（不会回滚）。重跑会跳过已存在的
              URL，可以直接重试，不会产生重复数据。
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {isActive && watching && (
            <Button variant="outline" size="sm" onClick={onKeepRunning}>
              转到后台，先离开本页
            </Button>
          )}
          {isActive && !watching && (
            <Button variant="outline" size="sm" onClick={onResume}>
              继续查看进度
            </Button>
          )}
          {isActive && (
            /**
             * 取消不弹二次确认：任务可重跑、已写入的也会保留，误触的代价只是重跑一次；
             * 而弹确认框会让「想停就停」这件事变慢，反而鼓励用户直接关页面。
             * 文案里写明「已写入的会保留」，避免用户以为取消等于撤销。
             */
            <Button variant="outline" size="sm" onClick={onCancel} disabled={cancelling}>
              {cancelling ? '取消中…' : '取消任务（已写入的会保留）'}
            </Button>
          )}
          {(isFailed || isCancelled) && job.retryable && canRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              重跑（跳过已存在的 URL）
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
