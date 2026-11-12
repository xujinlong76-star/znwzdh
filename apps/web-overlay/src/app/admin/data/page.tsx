'use client'

/**
 * 管理端：数据管理首页（DEV_BACKLOG A9）。
 *
 * 存在的理由：侧栏「数据管理」长期指向一个不存在的页面（/admin/data 下
 * 只有 restore/ 子页），William 点一下就是 404——自己的控制台有个死菜单。
 *
 * 本页只做「家底总览 + 各入口可达」，不复制其它页面的功能：
 *   1. 存储状态：站点库（dashboard 总览）与视频库（/api/videos）的真实
 *      计数，对照仓库基线（323 站 / 6007 条视频）判断「灌了没有」——
 *      这正是 A1 的「半空站」陷阱：全新部署漏了整包导入时，前台看着正常、
 *      中枢却是空的，本页是唯一能一眼看出来的地方。
 *   2. 冷启动基线导入标记：A1 的种子基线检查每次都会把结论写成
 *      baseline-import.json 文档（导入了没有、多少条、什么时候），本页
 *      读它展示「导入标记卡」——与上面的实时计数互相印证：一边是
 *      「当时导入的结论」，一边是「现在库里的实数」。老部署从没写过
 *      这份标记时如实显示「暂无基线导入记录」，不报错、不假装。
 *   3. 备份导出：冷备包（/api/export/backup.json，含未发布站点，仅管理员）
 *      与书签 HTML（公开口径）各一个真入口。
 *   4. 导入与恢复：冷备恢复（整库导入）、站点管理（逐条增改）、视频管理。
 *
 * 诚实规则：任一计数取不到时，那张卡只说「暂时读不到」，绝不拿 0 或
 * 缓存旧值充数；基线只用于「低于/达到」的比较，超基线是正常的（管理员
 * 自己加站），不报假警。
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileJson,
  Film,
  Globe,
  Info,
  Loader2,
  RefreshCw,
  Rocket,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { hubGet } from '@/lib/navhub-api'
import { describeDegrade } from '@/lib/degrade'
import {
  BASELINE_SITES,
  BASELINE_VIDEOS,
  parseBaselineMarker,
  seedStatus,
  type BaselineMarker,
  type BaselineStatus,
  type SeedStatus,
} from '@/lib/data-management'

/** GET /api/admin/dashboard/overview 的展示用子集（其余字段本页不用，不全量建模） */
interface DashboardOverview {
  overview: {
    totalSites: number
    activeSites: number
    brokenSites: number
    pendingSites: number
    categories: number
  }
  storage: {
    dbSizeBytes: number | null
  }
}

/** GET /api/videos?limit=1：只要总数与来源，条目本身不拉 */
interface VideosSummary {
  source: 'kv' | 'db'
  total: number
}

/** 冷备包的最小形状：hubGet 会把它解析成对象，导出时再序列化回去 */
interface ColdBackupDoc {
  categories: unknown[]
  sites: unknown[]
}

function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

const STATUS_COPY: Record<SeedStatus, { label: string; className: string }> = {
  seeded: { label: '已灌入', className: 'text-emerald-700 dark:text-emerald-500' },
  'below-baseline': { label: '低于基线', className: 'text-amber-700 dark:text-amber-500' },
  empty: { label: '未灌入', className: 'text-destructive-text' },
}

function SeedBadge({ status }: { status: SeedStatus }) {
  const copy = STATUS_COPY[status]
  const Icon = status === 'seeded' ? CheckCircle2 : AlertTriangle
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${copy.className}`}>
      <Icon className="h-4 w-4" aria-hidden />
      {copy.label}
    </span>
  )
}

const BASELINE_STATUS_META: Record<BaselineStatus, { label: string; className: string }> = {
  imported: {
    label: '已自动导入',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  skipped_existing: {
    label: '已有数据，已跳过（正常）',
    className: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-400',
  },
  missing_file: {
    label: '基线文件缺失',
    className: 'bg-red-500/10 text-red-700 dark:text-red-400',
  },
  failed: { label: '导入失败', className: 'bg-red-500/10 text-red-700 dark:text-red-400' },
  disabled: {
    label: '基线导入已关闭',
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
}

function BaselineBadge({ status }: { status: BaselineStatus }) {
  const meta = BASELINE_STATUS_META[status]
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  )
}

function formatBaselineTime(at: string): string {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString('zh-CN')
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
}

export default function DataManagementPage() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [videos, setVideos] = useState<VideosSummary | null>(null)
  const [videosError, setVideosError] = useState<string | null>(null)
  const [baseline, setBaseline] = useState<BaselineMarker | null>(null)
  const [baselineMissing, setBaselineMissing] = useState(false)
  const [baselineError, setBaselineError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  /**
   * 三路取数各自 try/catch：站点库读不到不该连累视频库也显示失败，
   * 基线标记读不到也只坏标记卡自己——它们是三个独立的事实源
   * （关系表 vs KV 视频文档 vs KV 标记文档）。
   */
  const load = useCallback(async () => {
    setLoading(true)
    setOverviewError(null)
    setVideosError(null)
    setBaselineError(null)
    const [overviewResult, videosResult, baselineResult] = await Promise.allSettled([
      hubGet<DashboardOverview>('/api/admin/dashboard/overview'),
      hubGet<VideosSummary>('/api/videos?limit=1'),
      hubGet<unknown>('/api/storage?path=baseline-import.json'),
    ])
    if (overviewResult.status === 'fulfilled') {
      setOverview(overviewResult.value)
    } else {
      setOverview(null)
      setOverviewError(describeDegrade(overviewResult.reason).message)
    }
    if (videosResult.status === 'fulfilled') {
      setVideos(videosResult.value)
    } else {
      setVideos(null)
      setVideosError(describeDegrade(videosResult.reason).message)
    }
    if (baselineResult.status === 'fulfilled') {
      const parsed = parseBaselineMarker(baselineResult.value)
      if (parsed.kind === 'present') {
        setBaseline(parsed.marker)
        setBaselineMissing(false)
      } else if (parsed.kind === 'missing') {
        setBaseline(null)
        setBaselineMissing(true)
      } else {
        setBaseline(null)
        setBaselineMissing(false)
        setBaselineError('返回结构不符合预期')
      }
    } else {
      setBaseline(null)
      setBaselineMissing(false)
      setBaselineError(describeDegrade(baselineResult.reason).message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 冷备导出：不能用普通 <a href>——/api/export/backup.json 是 admin
   * 作用域，浏览器直接点链接带不上 localStorage 里的 API token。
   * 走 hubGet（自带 token）拿到解析后的包，再拼成文件下载；
   * 重新序列化后的包与服务端吐出的字节未必相同，但结构与内容一致，
   * 恢复端点照常认（validateNavHubBackup 只校验结构）。
   */
  const exportColdBackup = useCallback(async () => {
    setExportBusy(true)
    setExportError(null)
    try {
      const doc = await hubGet<ColdBackupDoc>('/api/export/backup.json')
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `navhub-backup-${formatDate(new Date())}.nhbak.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(describeDegrade(err).message)
    } finally {
      setExportBusy(false)
    }
  }, [])

  const sitesStatus: SeedStatus | null = overview
    ? seedStatus(overview.overview.totalSites, BASELINE_SITES)
    : null
  const videosStatus: SeedStatus | null = videos
    ? seedStatus(videos.total, BASELINE_VIDEOS)
    : null

  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-muted-foreground" aria-hidden />
          <h1 className="text-xl font-semibold">数据管理</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          中枢数据的家底：站点库与视频库是否灌入、备份导出、导入与恢复的入口都在这里。
        </p>
      </header>

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">存储状态</h2>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          {loading ? '读取中…' : '刷新'}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" aria-hidden />
                站点库
              </span>
              {loading ? (
                <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  读取中…
                </span>
              ) : sitesStatus ? (
                <SeedBadge status={sitesStatus} />
              ) : null}
            </CardTitle>
            <CardDescription>
              中枢站点数对照仓库基线 {BASELINE_SITES} 站
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="中枢站点" value={overview.overview.totalSites} />
                  <Stat label="在用" value={overview.overview.activeSites} />
                  <Stat label="损坏" value={overview.overview.brokenSites} />
                  <Stat label="待审" value={overview.overview.pendingSites} />
                  <Stat label="分类" value={overview.overview.categories} />
                  <Stat label="库大小" value={formatBytes(overview.storage.dbSizeBytes)} />
                </div>
                {sitesStatus === 'empty' && (
                  <p className="text-sm text-destructive-text" role="alert">
                    中枢站点是 0：部署时漏了整包导入。前台目录看着正常，但 AI 找站与走中枢的功能都没有数据。
                    用下面的「冷备恢复」补一份，或重新导入整包。
                  </p>
                )}
                {sitesStatus === 'below-baseline' && (
                  <p className="text-sm text-amber-700 dark:text-amber-500" role="alert">
                    中枢只有 {overview.overview.totalSites} 站，少于仓库基线 {BASELINE_SITES} 站：
                    可能是部署时漏了整包导入，也可能被删过。请核对后再决定是否恢复。
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground" role="status">
                {overviewError ? `站点库暂时读不到：${overviewError}` : '正在读取站点库…'}
              </p>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/navigation">站点管理</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Film className="h-4 w-4 text-muted-foreground" aria-hidden />
                视频库
              </span>
              {loading ? (
                <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  读取中…
                </span>
              ) : videosStatus ? (
                <SeedBadge status={videosStatus} />
              ) : null}
            </CardTitle>
            <CardDescription>
              KV 文档 kv:videos，对照仓库基线 {BASELINE_VIDEOS} 条
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {videos ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="视频条目" value={videos.total} />
                  <Stat label="数据来源" value={videos.source === 'db' ? '关系表' : 'KV 文档'} />
                </div>
                {videosStatus === 'empty' && (
                  <p className="text-sm text-destructive-text" role="alert">
                    视频库是空的：部署时漏了视频整包导入，视频相关功能没有数据。
                    用「冷备恢复」从备份包补齐。
                  </p>
                )}
                {videosStatus === 'below-baseline' && (
                  <p className="text-sm text-amber-700 dark:text-amber-500" role="alert">
                    视频只有 {videos.total} 条，少于仓库基线 {BASELINE_VIDEOS} 条：
                    可能是部署时漏了整包导入，也可能被删过。请核对后再决定是否恢复。
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground" role="status">
                {videosError ? `视频库暂时读不到：${videosError}` : '正在读取视频库…'}
              </p>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/videos">视频管理</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="h-4 w-4 text-muted-foreground" aria-hidden />
            冷启动基线导入
          </CardTitle>
          <CardDescription>
            种子基线检查写下的导入结论（baseline-import.json）：当时导入了没有、多少条
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="inline-flex items-center gap-1 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              读取中…
            </p>
          ) : baselineMissing ? (
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                暂无基线导入记录。这台中枢要么是基线功能上线前就已部署的老库（数据靠别的方式进入，属正常），
                要么种子步骤还没跑过。新部署首次启动后这里会出现导入结论。
              </span>
            </p>
          ) : baselineError ? (
            <p className="text-sm text-muted-foreground" role="status">
              基线导入记录暂时读不到：{baselineError}
            </p>
          ) : baseline ? (
            <>
              <p className="text-xs text-muted-foreground">
                最近一次种子检查：{formatBaselineTime(baseline.at)}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    { title: '导航数据', part: baseline.navigation, unit: '站' },
                    { title: '视频库', part: baseline.videos, unit: '条' },
                  ] as const
                ).map(({ title, part, unit }) => (
                  <div key={title} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{title}</span>
                      <BaselineBadge status={part.status} />
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {part.status === 'skipped_existing' ? (
                        <>
                          库内现有 {part.count ?? '—'} {unit}，基线未覆盖
                        </>
                      ) : (
                        <>
                          库内 {part.count ?? '—'} {unit}
                          {part.fileCount !== null && <> · 基线文件 {part.fileCount} {unit}</>}
                          {part.categories !== null && <> · 类目 {part.categories} 个</>}
                        </>
                      )}
                    </p>
                    {part.error && (
                      <p className="mt-1 text-xs text-destructive-text">{part.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="h-4 w-4 text-muted-foreground" aria-hidden />
            备份导出
          </CardTitle>
          <CardDescription>
            两种包的区别只在「含不含未发布数据」，不是新旧之分
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void exportColdBackup()} disabled={exportBusy}>
              {exportBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <FileJson className="mr-2 h-4 w-4" aria-hidden />
              )}
              {exportBusy ? '导出中…' : '导出冷备包（.nhbak.json）'}
            </Button>
            <Button variant="outline" asChild>
              <a href="/api/hub/export/bookmarks.html">导出书签 HTML</a>
            </Button>
          </div>
          {exportError && (
            <p className="text-sm text-destructive-text" role="alert">
              冷备导出失败：{exportError}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            冷备包含未发布（待审/已归档/已停用）的站点，恢复时才能原样回来，仅管理员可下载；
            书签 HTML 只含公开站点，任何浏览器都能导入。恢复之前，先在这里留一份冷备。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-muted-foreground" aria-hidden />
            导入与恢复
          </CardTitle>
          <CardDescription>整库写操作都在这里，逐条改动走各自的管理页</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild>
              <Link href="/admin/data/restore">冷备恢复（从备份包导入整库）</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/admin/navigation">站点管理（逐条添加 / 编辑）</Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            整包目录导入（navigation.json）在部署时走 PUT /api/storage；本页不直接提供上传入口——
            整包写库是高风险操作，请走冷备恢复的三步确认流程（预演 → 勾选确认 → 执行）。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
