'use client'

import dynamic from 'next/dynamic'

/**
 * 管理台插件市场审核与治理页面 (Admin Plugin Review & Governance Console)
 *
 * 遵循 docs/PLUGIN-MARKET-DESIGN-2026-10-19.md：
 * 1. 状态机闭环：支持管理员对待审插件 approve 上架、reject 驳回并附带理由、delist 违规下架；
 * 2. 状态标签联动：即时呈现 pending 待审计数与举报告警；
 * 3. 审计留痕：所有审核动作均调用 /api/plugins/:slug/review 并落入审计日志。
 */

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import {
  fetchAdminPlugins,
  reviewPlugin,
  fetchPluginTelemetry,
  fetchPluginFunnel,
  fetchPluginGovernance,
  fetchAdminPluginReviews,
  moderatePluginReview,
  setPluginFeatured,
  diffPluginManifestsApi,
  fetchPluginVersions,
  fetchPluginVersionDetail,
  fetchOfficialSeedStatus,
  syncOfficialSeedCatalog,
  type HubPluginItem,
  type HubPluginTelemetryMetrics,
  type HubPluginFunnel,
  type HubPluginGovernanceAlert,
  type HubAdminPluginReview,
  type HubSeedCatalogStatus,
  type HubSeedSyncResult,
} from '@/lib/navhub-api'
import { pluginKindLabel } from '@/lib/plugins/plugin-manifest'
import { pluginDetailHref } from '@/lib/plugins/detail-href'
import { PluginDiffView } from '@/components/plugins/plugin-diff-view'
import { EmptyState } from '@/components/ui/empty-state'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  ArrowLeft,
  Radio,
  ShieldCheck,
  Check,
  X,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Globe,
  LayoutGrid,
  Palette,
  ExternalLink,
  Flag,
  Search,
  PackageCheck,
  RotateCcw,
  FileCode,
  Sparkles,
  Crown,
  Eye,
  MousePointerClick,
  Download,
  Gauge,
  MessageSquareWarning,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const STATUS_TABS = [
  { key: 'pending', label: '待审核' },
  { key: 'published', label: '已上架' },
  { key: 'quarantined', label: '已隔离' },
  { key: 'rejected', label: '已驳回' },
  { key: 'delisted', label: '已下架' },
] as const

/** 预警类的展示口径：chip 文案 + 完整 Tailwind 类（拼类名会在构建时被裁剪，必须写全） */
const GOVERNANCE_KIND_META: Record<HubPluginGovernanceAlert['kind'], { label: string; chip: string }> = {
  pending_sla: {
    label: '待审超 SLA',
    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  },
  reported: {
    label: '插件被举报',
    chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
  },
  review_reported: {
    label: '评价被举报',
    chip: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30',
  },
}

/**
 * 预警按类计数（纯函数，可单测）。
 *
 * 面板头部必须报「哪一类有几条」：只报总数的话，管理员看到「3 条预警」无法
 * 判断是「3 个投稿压了两天没审」还是「3 次举报」——前者要清队列，后者要下架。
 */
export function groupGovernanceAlerts(alerts: HubPluginGovernanceAlert[]) {
  const counts = { pending_sla: 0, reported: 0, review_reported: 0 }
  for (const alert of alerts) {
    if (alert.kind in counts) counts[alert.kind] += 1
  }
  return counts
}

/**
 * 转化率文案（纯函数，可单测）。
 *
 * 分母为 0 时不能报「0.0%」：那是「没采到埋点」，不是「没人转化」。把缺数据渲染成
 * 一个看起来真实的比率，管理员会按它去改市场文案与推荐位——返回 null 让调用方出
 * 「不可用」提示。
 */
export function funnelConversionSummary(funnel: HubPluginFunnel): string | null {
  if (!Number.isFinite(funnel.totals.views) || funnel.totals.views <= 0) return null
  const pct = (v: number) => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%`
  return `浏览→点击 ${pct(funnel.conversion.viewToClick)} · 点击→安装 ${pct(
    funnel.conversion.clickToInstall,
  )} · 浏览→安装 ${pct(funnel.conversion.viewToInstall)}`
}

function FunnelPanel({ funnel }: { funnel: HubPluginFunnel }) {
  const summary = funnelConversionSummary(funnel)
  const last7 = funnel.series.slice(-7)
  const peakViews = Math.max(1, ...last7.map((d) => d.views))
  const cells = [
    { key: 'views', label: '详情页浏览', value: funnel.totals.views, icon: Eye, tone: 'text-sky-600 dark:text-sky-400' },
    { key: 'clicks', label: '安装点击', value: funnel.totals.installClicks, icon: MousePointerClick, tone: 'text-violet-600 dark:text-violet-400' },
    { key: 'installs', label: '安装成功', value: funnel.totals.installs, icon: Download, tone: 'text-emerald-600 dark:text-emerald-400' },
    { key: 'uninstalls', label: '卸载点击', value: funnel.totals.uninstalls, icon: RotateCcw, tone: 'text-muted-foreground' },
  ]
  return (
    <section aria-label="插件市场漏斗" className="rounded-2xl border border-border/80 bg-card/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold text-foreground">近 {funnel.days} 天市场漏斗</h2>
        </div>
        <span className="text-[11px] font-mono text-muted-foreground">
          {summary ?? '浏览埋点为 0，转化率不可用'}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cells.map((cell) => (
          <div key={cell.key} className="rounded-xl border border-border/60 bg-background/40 p-3">
            <div className={`flex items-center gap-1.5 text-[11px] ${cell.tone}`}>
              <cell.icon className="w-3.5 h-3.5" aria-hidden />
              <span>{cell.label}</span>
            </div>
            <div className="text-lg font-bold font-mono text-foreground pt-0.5">{cell.value}</div>
          </div>
        ))}
      </div>

      {last7.some((d) => d.views > 0 || d.installs > 0) && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">近 7 天按日（条长按当日浏览量归一）：</p>
          <div className="space-y-1">
            {last7.map((day) => (
              <div key={day.date} className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                <span className="w-20 shrink-0">{day.date.slice(5)}</span>
                <span className="h-2 rounded-full bg-sky-500/40" style={{ width: `${Math.round((day.views / peakViews) * 40) + 2}%` }} aria-hidden />
                <span className="tabular-nums">浏览 {day.views}</span>
                <span className="tabular-nums">安装 {day.installs}</span>
                {day.reports > 0 && <span className="tabular-nums text-rose-600 dark:text-rose-400">举报 {day.reports}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function GovernancePanel({
  alerts,
  failed,
  generatedAt,
  onFocus,
}: {
  alerts: HubPluginGovernanceAlert[]
  failed: boolean
  generatedAt: number
  onFocus: (alert: HubPluginGovernanceAlert) => void
}) {
  const counts = groupGovernanceAlerts(alerts)
  return (
    <section aria-label="插件治理预警" className="rounded-2xl border border-border/80 bg-card/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <MessageSquareWarning className="w-4 h-4 text-amber-500" aria-hidden />
          <h2 className="text-sm font-semibold text-foreground">治理预警</h2>
          {!failed && alerts.length > 0 && (
            <span className="text-[11px] font-mono text-muted-foreground">
              超 SLA {counts.pending_sla} · 插件举报 {counts.reported} · 评价举报 {counts.review_reported}
            </span>
          )}
        </div>
        <span className="text-[11px] font-mono text-muted-foreground">
          {/* generatedAt===0 是中枢没答上来，不是「没有预警」；两种状态不能共用一个空态 */}
          {failed ? '预警数据本次未取回' : `生成于 ${new Date(generatedAt).toLocaleString('zh-CN')}`}
        </span>
      </div>

      {failed ? (
        <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          预警聚合这次没能从中枢取回。这里显示为空，不代表没有压了两天待审的投稿，也不代表没有累计举报。
        </p>
      ) : alerts.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          当前没有触发阈值的预警：待审投稿均未超过 48 小时，也没有累计 3 次以上的插件或评价举报。
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {alerts.slice(0, 12).map((alert, idx) => {
              const meta = GOVERNANCE_KIND_META[alert.kind] ?? { label: alert.kind, chip: 'bg-muted text-muted-foreground border-border/40' }
              return (
                <li
                  key={`${alert.kind}:${alert.slug}:${idx}`}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2"
                >
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${meta.chip}`}>{meta.label}</span>
                  <span className="text-xs font-medium text-foreground truncate max-w-[240px]">{alert.name}</span>
                  <span className="text-[11px] text-muted-foreground">{alert.detail}</span>
                  <button
                    type="button"
                    onClick={() => onFocus(alert)}
                    className="ml-auto text-[11px] px-2 py-0.5 rounded-md border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                  >
                    在队列中定位
                  </button>
                </li>
              )
            })}
          </ul>
          {alerts.length > 12 && (
            <p className="text-[11px] text-muted-foreground">只列出按严重度排序的前 12 条（本次共 {alerts.length} 条）。</p>
          )}
        </>
      )}
    </section>
  )
}

const PluginTapsModal = dynamic(
  () => import('@/components/plugins/plugin-taps-modal').then((m) => m.PluginTapsModal),
  { ssr: false }
)
export default function AdminPluginsPage() {
  const [plugins, setPlugins] = useState<HubPluginItem[]>([])
  const [telemetry, setTelemetry] = useState<HubPluginTelemetryMetrics | null>(null)
  const [funnel, setFunnel] = useState<HubPluginFunnel | null>(null)
  const [governance, setGovernance] = useState<HubPluginGovernanceAlert[]>([])
  const [adminReviews, setAdminReviews] = useState<HubAdminPluginReview[]>([])
  const [reviewStatus, setReviewStatus] = useState<'visible' | 'hidden'>('visible')
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [rankDrafts, setRankDrafts] = useState<Record<string, number>>({})
  const [pendingCount, setPendingCount] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<DegradeNotice | null>(null)
  // 「没拉到」与「拉到但队列空」是两件事：合并渲染会让管理员以为待审清单被清空了
  const [listFailed, setListFailed] = useState(false)
  // generatedAt === 0 表示这次预警聚合没成功；>0 时它是真实的服务端生成时刻
  const [governanceGeneratedAt, setGovernanceGeneratedAt] = useState(0)
  const [reviewsFailed, setReviewsFailed] = useState(false)
  const [reviewsTotal, setReviewsTotal] = useState(0)
  const [reviewNoteDrafts, setReviewNoteDrafts] = useState<Record<string, string>>({})

  const [activeStatus, setActiveStatus] = useState<string>('pending')
  const [search, setSearch] = useState('')

  // 驳回弹窗
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [rejectPluginItem, setRejectPluginItem] = useState<HubPluginItem | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [tapsModalOpen, setTapsModalOpen] = useState(false)
  const [seedStatus, setSeedStatus] = useState<HubSeedCatalogStatus | null>(null)
  const [syncingSeed, setSyncingSeed] = useState(false)
  const [syncResult, setSyncResult] = useState<HubSeedSyncResult | null>(null)
  const [syncModalOpen, setSyncModalOpen] = useState(false)

  // 清单审查与差异对比弹窗
  const [auditModalOpen, setAuditModalOpen] = useState(false)
  const [auditPluginItem, setAuditPluginItem] = useState<HubPluginItem | null>(null)
  const [auditDiff, setAuditDiff] = useState<any>(null)
  const [auditLoading, setAuditLoading] = useState(false)

  const handleOpenAudit = async (item: HubPluginItem) => {
    setAuditPluginItem(item)
    setAuditModalOpen(true)
    setAuditLoading(true)
    setAuditDiff(null)
    try {
      const history = await fetchPluginVersions(item.slug)
      if (history.versions && history.versions.length > 0) {
        const lastVer = history.versions[0]
        const lastDetail = await fetchPluginVersionDetail(item.slug, lastVer.version)
        if (lastDetail && lastDetail.manifest) {
          const diffRes = await diffPluginManifestsApi(lastDetail.manifest, item.manifest)
          if (diffRes.ok) {
            setAuditDiff(diffRes.diff)
          }
        }
      }
    } catch {
      // 容错降级
    } finally {
      setAuditLoading(false)
    }
  }

  const loadList = useCallback(async () => {
    setLoading(true)
    setNotice(null)
    setListFailed(false)
    try {
      const [res, telem, funnelRes, governanceRes, sStatus] = await Promise.all([
        fetchAdminPlugins(
          {
            status: activeStatus,
            q: search.trim() || undefined,
            limit: 100,
          },
          (err) => setNotice(describeDegrade(err, '管理台插件数据'))
        ),
        fetchPluginTelemetry().catch(() => {
          // 遥测大盘指标加载失败时降级隐藏概览卡片，不阻塞插件列表主体展示
          return null
        }),
        fetchPluginFunnel(30).catch(() => {
          // 漏斗转化指标请求失败时静默降级为 null，不阻塞插件列表与管理操作
          return null
        }),
        // fetchPluginGovernance 内部已 degrade：失败回落到 { alerts: [], generatedAt: 0 }。
        // generatedAt === 0 是「这次没算出来」的唯一可靠信号，不能读成「没有预警」。
        fetchPluginGovernance(),
        fetchOfficialSeedStatus().catch(() => {
          // 种子状态是辅助信息：失败时返回 null，由界面按「未取到」展示，不影响插件列表
          return null
        }),
      ])
      setPlugins(res.items)
      if (telem) setTelemetry(telem)
      if (sStatus) setSeedStatus(sStatus)
      setFunnel(funnelRes)
      setGovernance(governanceRes.alerts)
      setGovernanceGeneratedAt(governanceRes.generatedAt)
      if (res.pending !== undefined) {
        setPendingCount(res.pending)
      }
    } catch {
      // 主列表请求失败：置空但记下 failed，EmptyState 不能说「所有插件已处理完毕」
      setPlugins([])
      setListFailed(true)
    } finally {
      setLoading(false)
    }
  }, [activeStatus, search])

  useEffect(() => {
    void loadList()
  }, [loadList])

  /**
   * 评价治理队列（/api/admin/plugin-reviews）。
   *
   * 这块数据以前只有 import、从没被调用：治理预警里的「评价被举报 N 次」在管理台
   * 没有可处置的入口，只能直接改库。degrade 的回落值 `{items:[],total:0}` 与
   * 「真的没有评价」同形，所以用 onDegraded 单独记 failed，不复用主列表的 notice。
   */
  const loadReviews = useCallback(async () => {
    setReviewsLoading(true)
    setReviewsFailed(false)
    try {
      const res = await fetchAdminPluginReviews({ status: reviewStatus, limit: 20 }, () =>
        setReviewsFailed(true),
      )
      setAdminReviews(res.items)
      setReviewsTotal(res.total)
    } catch {
      setAdminReviews([])
      setReviewsFailed(true)
    } finally {
      setReviewsLoading(false)
    }
  }, [reviewStatus])

  useEffect(() => {
    void loadReviews()
  }, [loadReviews])

  /** 编辑精选开关 + 位次（市场首页「编辑精选」栏的唯一数据源） */
  const handleToggleFeatured = async (plugin: HubPluginItem) => {
    const next = !plugin.featured
    const rank = Number.isFinite(rankDrafts[plugin.slug]) ? rankDrafts[plugin.slug] : plugin.featuredRank ?? 0
    setActionLoading(true)
    try {
      await setPluginFeatured(plugin.slug, next, rank)
      setPlugins((prev) =>
        prev.map((p) => (p.slug === plugin.slug ? { ...p, featured: next, featuredRank: rank } : p)),
      )
      toast.success(next ? `已把「${plugin.name}」加入编辑精选` : `已把「${plugin.name}」移出编辑精选`)
    } catch (err) {
      toast.error('精选设置失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionLoading(false)
    }
  }

  /** 隐藏/恢复评价：隐藏后即时退出公开列表与评分统计 */
  const handleModerateReview = async (review: HubAdminPluginReview, action: 'hide' | 'restore') => {
    if (action === 'hide' && !confirm(`确定要隐藏「${review.pluginName}」的这条评价吗？隐藏后不再计入公开评分与评价列表。`)) {
      return
    }
    const note = reviewNoteDrafts[review.id]?.trim()
    setActionLoading(true)
    try {
      await moderatePluginReview(review.id, action, note || undefined)
      toast.success(action === 'hide' ? '评价已隐藏' : '评价已恢复公开')
      setReviewNoteDrafts((prev) => {
        if (!(review.id in prev)) return prev
        const next = { ...prev }
        delete next[review.id]
        return next
      })
      void loadReviews()
      // 隐藏的评价会立刻改变插件的评分与举报计数，主列表要跟着刷新
      void loadList()
    } catch (err) {
      toast.error('评价处置失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionLoading(false)
    }
  }

  // 通过审核 (上架)
  const handleApprove = async (plugin: HubPluginItem) => {
    setActionLoading(true)
    try {
      await reviewPlugin(plugin.slug, 'approve')
      toast.success(`已通过审核并上架「${plugin.name}」！`)
      void loadList()
    } catch (err) {
      toast.error('操作失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionLoading(false)
    }
  }

  const handleSyncOfficialCatalog = async () => {
    setSyncingSeed(true)
    try {
      const res = await syncOfficialSeedCatalog()
      setSyncResult(res)
      setSyncModalOpen(true)
      toast.success(`官方资源同步完成：新增 ${res.summary.added} 个，更新 ${res.summary.updated} 个`)
      void loadList()
    } catch (err) {
      toast.error('同步官方资源库失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSyncingSeed(false)
    }
  }

  // 下架
  const handleDelist = async (plugin: HubPluginItem) => {
    if (!confirm(`确定要下架插件「${plugin.name}」吗？下架后市场公开列表将不再展示。`)) {
      return
    }
    setActionLoading(true)
    try {
      await reviewPlugin(plugin.slug, 'delist')
      toast.success(`已下架「${plugin.name}」`)
      void loadList()
    } catch (err) {
      toast.error('下架失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionLoading(false)
    }
  }

  // 提交驳回
  const handleConfirmReject = async () => {
    if (!rejectPluginItem) return
    setActionLoading(true)
    try {
      await reviewPlugin(rejectPluginItem.slug, 'reject', rejectNote.trim() || '未达到上架标准')
      toast.success(`已驳回「${rejectPluginItem.name}」`)
      setRejectModalOpen(false)
      setRejectNote('')
      setRejectPluginItem(null)
      void loadList()
    } catch (err) {
      toast.error('驳回失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionLoading(false)
    }
  }

  const renderKindIcon = (k: string) => {
    switch (k) {
      case 'site-pack':
        return <Globe className="w-3.5 h-3.5 text-sky-500" />
      case 'workspace-preset':
        return <LayoutGrid className="w-3.5 h-3.5 text-emerald-500" />
      case 'theme':
        return <Palette className="w-3.5 h-3.5 text-violet-500" />
      default:
        return null
    }
  }

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 space-y-6">
        {/* 顶部返回导航 */}
        <div className="flex items-center justify-between">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回管理后台</span>
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={syncingSeed}
              onClick={handleSyncOfficialCatalog}
              className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-700 transition-colors px-2.5 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30"
              title="一键将代码库最新官方插件库同步至本站（增量无损）"
            >
              {syncingSeed ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>同步官方资源库</span>
              {seedStatus?.hasAvailableUpdates && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setTapsModalOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 transition-colors px-2.5 py-1 rounded-md bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Taps 订阅源管理</span>
            </button>
            <Link
              href="/marketplace"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <span>访问插件市场前端</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* 官方资源库状态与热同步面板 */}
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-2xs">
          <div className="flex items-start gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">山羊胡官方插件资源库</span>
                <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30">
                  v{seedStatus?.catalogVersion ?? '2026.10'}
                </Badge>
                {seedStatus?.hasAvailableUpdates ? (
                  <Badge className="text-[10px] bg-amber-500 text-white">发现新资源</Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">已就绪</Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                代码库内置收录 {seedStatus?.totalCatalog ?? 64} 个官方精选插件（当前已就绪 {seedStatus?.upToDateCount ?? 0} 个）。
                一键无损同步将自动导入新增包并升级已有包，绝不破坏用户的自建站点与配置。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            <button
              type="button"
              disabled={syncingSeed}
              onClick={handleSyncOfficialCatalog}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 text-white hover:bg-amber-700 transition-colors font-medium shadow-xs disabled:opacity-50"
            >
              {syncingSeed ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span>{syncingSeed ? '正在同步...' : '立即无损同步'}</span>
            </button>
          </div>
        </div>

        {/* 头部面板 */}
        <div className="rounded-3xl border border-border/80 glass-surface p-4 sm:p-8 space-y-4 shadow-xs">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary text-xs font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>管理面 · 扩展生态治理</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">
              插件市场审核管理
            </h1>
            <p className="text-xs text-muted-foreground leading-relaxed">
              统一管理社区投稿与本地导入的插件。审核上架、驳回存疑项目或响应社区违规举报。
            </p>
          </div>

          {/* 状态 Tab 切换栏 */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
            {STATUS_TABS.map((tab) => {
              const isActive = activeStatus === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveStatus(tab.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted border border-border/40'
                  )}
                >
                  <span>{tab.label}</span>
                  {tab.key === 'pending' && pendingCount > 0 && (
                    <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500 text-white font-bold">
                      {pendingCount}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* 生态遥测与大盘指标 */}
        {telemetry && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-border/80 bg-card/60 p-4 space-y-1">
                <div className="text-xs text-muted-foreground flex items-center justify-between">
                  <span>总收录插件</span>
                  <span className="text-[11px] px-1.5 py-0.2 rounded-md bg-muted/60 text-muted-foreground font-mono">
                    {telemetry.publishedCount} 已上架
                  </span>
                </div>
                <div className="text-2xl font-bold font-mono text-foreground">
                  {telemetry.totalPlugins}
                </div>
                <div className="text-[11px] text-muted-foreground pt-0.5">
                  待审: <strong className="text-amber-500 font-medium">{telemetry.pendingCount}</strong> · 驳回/下架: {telemetry.rejectedCount + telemetry.delistedCount}
                </div>
              </div>

              <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 space-y-1">
                <div className="text-xs text-sky-600 dark:text-sky-400 flex items-center justify-between">
                  <span>累计安装总量</span>
                  <span className="text-[11px] px-1.5 py-0.2 rounded-md bg-sky-500/10 font-mono font-medium">
                    {telemetry.activeInstalls} 活跃
                  </span>
                </div>
                <div className="text-2xl font-bold font-mono text-foreground">
                  {telemetry.totalInstalls}
                </div>
                <div className="text-[11px] text-muted-foreground pt-0.5">
                  活跃留存率: {telemetry.totalInstalls > 0 ? Math.round((telemetry.activeInstalls / telemetry.totalInstalls) * 100) : 100}%
                </div>
              </div>

              <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-1">
                <div className="text-xs text-violet-600 dark:text-violet-400 flex items-center justify-between">
                  <span>类型构成分布</span>
                  <span className="text-[11px] font-mono">5 大类别</span>
                </div>
                <div className="text-xs font-medium text-foreground flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
                  <span>包: <strong className="font-mono">{telemetry.kindDistribution.sitePack}</strong></span>
                  <span>·</span>
                  <span>看板: <strong className="font-mono">{telemetry.kindDistribution.workspacePreset}</strong></span>
                  <span>·</span>
                  <span>主题: <strong className="font-mono">{telemetry.kindDistribution.theme}</strong></span>
                  <span>·</span>
                  <span>搜索: <strong className="font-mono">{telemetry.kindDistribution.searchPack ?? 0}</strong></span>
                  <span>·</span>
                  <span>组合: <strong className="font-mono">{telemetry.kindDistribution.bundle ?? 0}</strong></span>
                </div>
                <div className="text-[11px] text-muted-foreground pt-1">
                  覆盖网址、个人工作台、视觉主题、搜索直达与组合包
                </div>
              </div>

              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-1">
                <div className="text-xs text-amber-600 dark:text-amber-400 flex items-center justify-between">
                  <span>社区星标与合规</span>
                  <span className="text-[11px] font-mono font-medium">
                    ⭐ {telemetry.totalStars}
                  </span>
                </div>
                <div className="text-2xl font-bold font-mono text-foreground">
                  {telemetry.totalReports}
                </div>
                <div className="text-[11px] text-muted-foreground pt-0.5">
                  社区违规举报次数（需核查）
                </div>
              </div>
            </div>

            {/* TOP 热门插件排行横条 */}
            {telemetry.topInstalled && telemetry.topInstalled.length > 0 && (
              <div className="rounded-xl border border-border/60 bg-muted/20 px-3.5 py-2 flex flex-wrap items-center gap-3 text-xs">
                <span className="font-semibold text-foreground shrink-0">🔥 热门安装榜：</span>
                <div className="flex flex-wrap items-center gap-2">
                  {telemetry.topInstalled.map((p, idx) => (
                    <Link
                      key={p.slug}
                      href={`/marketplace/${encodeURIComponent(p.slug)}`}
                      target="_blank"
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-background/80 hover:bg-background border border-border/40 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <span className="font-mono text-primary font-bold">#{idx + 1}</span>
                      <span>{p.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">({p.installCount}次)</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 市场漏斗：浏览 → 安装点击 → 安装成功（近 30 天埋点） */}
        {funnel && <FunnelPanel funnel={funnel} />}

        {/* 治理预警：待审超 SLA / 插件被举报 / 评价被举报 */}
        <GovernancePanel
          alerts={governance}
          failed={governanceGeneratedAt === 0}
          generatedAt={governanceGeneratedAt}
          onFocus={(alert) => {
            const tab = STATUS_TABS.find((t) => t.key === alert.status)
            if (tab) setActiveStatus(tab.key)
            setSearch(alert.slug)
          }}
        />

        {/* 降级提示 */}
        {notice && <HubDegradedNotice notice={notice} onRetry={loadList} />}

        {/* 列表渲染 */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-20 rounded-2xl border border-border/40 bg-muted/20 animate-pulse"
              />
            ))}
          </div>
        ) : plugins.length > 0 ? (
          <div className="space-y-3">
            {plugins.map((item) => (
              <div
                key={item.slug}
                className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:border-border hover:bg-card"
              >
                <div className="space-y-1.5 max-w-xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="p-1 rounded-md bg-muted/60 border border-border/40">
                      {renderKindIcon(item.kind)}
                    </span>
                    <Badge variant="outline" className="text-[11px] font-medium">
                      {pluginKindLabel(item.kind)}
                    </Badge>
                    <span className="font-semibold text-sm text-foreground">
                      {item.name}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">
                      v{item.version}
                    </span>
                    {item.status === 'quarantined' && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive border border-destructive/30">
                        <AlertTriangle className="w-3 h-3" />
                        <span>已隔离熔断</span>
                      </span>
                    )}
                    {item.reportCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/30">
                        <Flag className="w-3 h-3" />
                        <span>举报 {item.reportCount}</span>
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {item.description || '暂无描述'}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/80">
                    <span>
                      作者: <strong className="text-foreground">{item.author || '匿名'}</strong>
                    </span>
                    <span>·</span>
                    <span>安装量: {item.installCount || 0}</span>
                    <span>·</span>
                    <span>星标: {item.starCount || 0}</span>
                    <span>·</span>
                    <span>提交时间: {new Date(item.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                </div>

                {/* 审核操作动作栏 */}
                <div className="flex flex-wrap items-center gap-2 self-end sm:self-center shrink-0 w-full sm:w-auto justify-end">
                  <Link
                    href={pluginDetailHref(item.slug, item.status)}
                    target="_blank"
                    className="px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground font-medium rounded-lg hover:bg-muted/60 border border-border/60 transition-colors inline-flex items-center gap-1"
                  >
                    <span>预览详情</span>
                    <ExternalLink className="w-3 h-3" />
                  </Link>

                  {item.status === 'pending' && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleOpenAudit(item)}
                        className="px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg border border-primary/30 transition-colors inline-flex items-center gap-1"
                      >
                        <FileCode className="w-3.5 h-3.5" />
                        <span>审查差异</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectPluginItem(item)
                          setRejectNote('')
                          setRejectModalOpen(true)
                        }}
                        disabled={actionLoading}
                        className="px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 rounded-lg border border-destructive/30 transition-colors"
                      >
                        驳回
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApprove(item)}
                        disabled={actionLoading}
                        className="inline-flex items-center gap-1 px-3.5 py-1.5 text-xs font-medium text-primary-foreground bg-primary hover:opacity-90 rounded-lg transition-all shadow-2xs"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>通过并上架</span>
                      </button>
                    </>
                  )}

                  {item.status === 'published' && (
                    <div className="inline-flex items-center gap-1">
                      <label className="sr-only" htmlFor={`featured-rank-${item.slug}`}>
                        「{item.name}」的精选位次
                      </label>
                      <input
                        id={`featured-rank-${item.slug}`}
                        type="number"
                        min={0}
                        max={9999}
                        value={rankDrafts[item.slug] ?? item.featuredRank ?? 0}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          setRankDrafts((prev) => ({ ...prev, [item.slug]: Number.isFinite(v) ? v : 0 }))
                        }}
                        disabled={!item.featured || actionLoading}
                        title={item.featured ? '位次越大越靠前（同分按发布时间）' : '设为精选后可编辑位次'}
                        className="w-16 px-1.5 py-1 text-[11px] font-mono rounded-lg border border-border/60 bg-background text-foreground disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-primary/40"
                      />
                      <button
                        type="button"
                        onClick={() => handleToggleFeatured(item)}
                        disabled={actionLoading}
                        className={cn(
                          'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                          item.featured
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
                            : 'border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/60',
                        )}
                      >
                        <Crown className="w-3.5 h-3.5" aria-hidden />
                        <span>{item.featured ? '取消精选' : '设为精选'}</span>
                      </button>
                    </div>
                  )}

                  {item.status === 'published' && (
                    <button
                      type="button"
                      onClick={() => handleDelist(item)}
                      disabled={actionLoading}
                      className="px-3 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded-lg border border-amber-500/30 transition-colors"
                    >
                      下架
                    </button>
                  )}

                  {(item.status === 'rejected' || item.status === 'delisted' || item.status === 'quarantined') && (
                    <button
                      type="button"
                      onClick={() => handleApprove(item)}
                      disabled={actionLoading}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 rounded-lg border border-emerald-500/30 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>{item.status === 'quarantined' ? '审核解封并上架' : '重新上架'}</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : listFailed ? (
          <div
            role="status"
            className="rounded-2xl border border-amber-500/40 bg-amber-500/5 px-4 py-5 text-xs text-amber-700 dark:text-amber-400 space-y-2"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
              <span className="font-medium">
                插件队列这次没能从中枢取回（连接失败或返回异常）。这里显示为空，不代表待审插件已被处理完或数据被删除。
              </span>
            </div>
            <button
              type="button"
              onClick={() => void loadList()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-500/40 bg-background/70 hover:bg-background font-medium text-foreground transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden />
              <span>重新加载队列</span>
            </button>
          </div>
        ) : (
          <EmptyState
            icon={PackageCheck}
            title={`暂无「${STATUS_TABS.find((t) => t.key === activeStatus)?.label}」的插件`}
            description="当前队列为空，所有插件已处理完毕。"
          />
        )}

        {/* 评价治理：隐藏/恢复公开评价（被举报评价的唯一处置入口） */}
        <section aria-label="评价治理" className="rounded-2xl border border-border/80 bg-card/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <MessageSquareWarning className="w-4 h-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold text-foreground">评价治理</h2>
              <div className="inline-flex items-center gap-1 rounded-lg border border-border/60 p-0.5">
                {(['visible', 'hidden'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setReviewStatus(tab)}
                    aria-pressed={reviewStatus === tab}
                    className={cn(
                      'px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors',
                      reviewStatus === tab ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {tab === 'visible' ? '展示中' : '已隐藏'}
                  </button>
                ))}
              </div>
              {!reviewsFailed && (
                <span className="text-[11px] font-mono text-muted-foreground">共 {reviewsTotal} 条</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => void loadReviews()}
              disabled={reviewsLoading}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <RotateCcw className="w-3 h-3" aria-hidden />
              <span>刷新</span>
            </button>
          </div>

          {reviewsLoading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-14 rounded-xl border border-border/40 bg-muted/20 animate-pulse" />
              ))}
            </div>
          ) : reviewsFailed ? (
            <p role="status" className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
              评价列表这次没能从中枢取回。这里显示为空，不代表评价被清空，也不代表没有待处理举报。
            </p>
          ) : adminReviews.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {reviewStatus === 'visible'
                ? '当前没有展示中的评价。'
                : '当前没有被隐藏的评价——社区举报可以在这里处置，也可以直接在下方的插件列表里查看举报数。'}
            </p>
          ) : (
            <ul className="space-y-2">
              {adminReviews.map((review) => (
                <li key={review.id} className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <Link
                      href={pluginDetailHref(review.pluginSlug)}
                      target="_blank"
                      className="font-medium text-foreground hover:text-primary hover:underline underline-offset-2"
                    >
                      {review.pluginName}
                    </Link>
                    <span className="font-mono text-muted-foreground">★ {review.rating}/5</span>
                    {(review.reportCount ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1 font-bold px-1.5 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30">
                        <Flag className="w-3 h-3" aria-hidden />
                        <span>举报 {review.reportCount}</span>
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      v{review.installedVersion} · {new Date(review.createdAt).toLocaleString('zh-CN')}
                    </span>
                    {review.status === 'hidden' && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        处置于 {review.moderatedAt ? new Date(review.moderatedAt).toLocaleString('zh-CN') : '未知时间'}
                      </span>
                    )}
                  </div>
                  {(review.title || review.content) && (
                    <p className="text-xs text-foreground leading-relaxed line-clamp-3">
                      {review.title && <strong className="mr-1">{review.title}</strong>}
                      <span className="text-muted-foreground">{review.content}</span>
                    </p>
                  )}
                  {review.status === 'hidden' && review.moderationNote && (
                    <p className="text-[11px] text-muted-foreground">隐藏理由：{review.moderationNote}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {review.status !== 'hidden' && (
                      <input
                        aria-label={`隐藏「${review.pluginName}」这条评价的理由`}
                        value={reviewNoteDrafts[review.id] ?? ''}
                        onChange={(e) => setReviewNoteDrafts((prev) => ({ ...prev, [review.id]: e.target.value }))}
                        placeholder="隐藏理由（可选，留痕用）"
                        maxLength={200}
                        className="flex-1 min-w-[180px] px-2 py-1 text-[11px] rounded-md border border-border/60 bg-background text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:ring-2 focus:ring-primary/40"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => handleModerateReview(review, review.status === 'hidden' ? 'restore' : 'hide')}
                      disabled={actionLoading}
                      className={cn(
                        'px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors',
                        review.status === 'hidden'
                          ? 'border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10'
                          : 'border-destructive/30 text-destructive hover:bg-destructive/10',
                      )}
                    >
                      {review.status === 'hidden' ? '恢复公开' : '隐藏评价'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 驳回理由输入弹窗 */}
        <Dialog open={rejectModalOpen} onOpenChange={setRejectModalOpen}>
          <DialogContent className="max-w-md p-6">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-foreground">
                驳回插件「{rejectPluginItem?.name}」
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground pt-1">
                请向作者说明驳回原因（如：格式错误、包含死链、类目不合理等）。
              </DialogDescription>
            </DialogHeader>

            <div className="py-3 space-y-1.5">
              <label htmlFor="admin-reject-note" className="text-xs font-medium text-foreground block">
                驳回备注（可选，最多 500 字）：
              </label>
              <textarea
                id="admin-reject-note"
                aria-label="驳回备注"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="请填写驳回原因以指导作者修改…"
                rows={4}
                className="w-full text-xs rounded-lg border border-border/80 bg-background p-2.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:ring-2 focus:ring-primary/40 resize-none"
                maxLength={500}
              />
            </div>

            <DialogFooter className="flex sm:justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectModalOpen(false)}
                disabled={actionLoading}
                className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg border border-border/60 hover:bg-muted/60 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                disabled={actionLoading}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-destructive text-destructive-foreground hover:opacity-90 transition-all"
              >
                {actionLoading ? '提交中…' : '确认驳回'}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 清单与差异审查弹窗 */}
        <Dialog open={auditModalOpen} onOpenChange={setAuditModalOpen}>
          <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-base flex items-center gap-2">
                <FileCode className="w-4 h-4 text-primary" />
                <span>审查待上架插件：{auditPluginItem?.name}</span>
                <span className="text-xs font-mono text-muted-foreground px-2 py-0.5 rounded bg-muted">
                  v{auditPluginItem?.version}
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                比对该插件与此前已发布版本清单的增量差异，审查是否存在安全隐患或越权变更。
              </DialogDescription>
            </DialogHeader>

            {auditPluginItem && (
              <div className="space-y-4 py-2">
                {/* 概览指标 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="rounded-lg bg-muted/40 p-2.5 border border-border/50">
                    <span className="text-muted-foreground block text-[11px]">类型</span>
                    <span className="font-semibold">{pluginKindLabel(auditPluginItem.kind)}</span>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-2.5 border border-border/50">
                    <span className="text-muted-foreground block text-[11px]">提交作者</span>
                    <span className="font-semibold truncate block">{auditPluginItem.author || '匿名'}</span>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-2.5 border border-border/50">
                    <span className="text-muted-foreground block text-[11px]">唯一标识</span>
                    <span className="font-mono text-[11px] truncate block">{auditPluginItem.slug}</span>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-2.5 border border-border/50">
                    <span className="text-muted-foreground block text-[11px]">包含资源</span>
                    <span className="font-semibold">
                      {auditPluginItem.manifest?.payload?.sites?.length
                        ? `${auditPluginItem.manifest.payload.sites.length} 个站点`
                        : auditPluginItem.manifest?.payload?.layout
                          ? '工作台布局'
                          : auditPluginItem.manifest?.payload?.tokens
                            ? '主题色彩盘'
                            : '声明配置'}
                    </span>
                  </div>
                </div>

                {/* 差异对比区 */}
                <div>
                  <h4 className="text-xs font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    <span>与上一版本变更对比：</span>
                  </h4>
                  {auditLoading ? (
                    <div className="rounded-xl border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
                      正在比对历史版本快照...
                    </div>
                  ) : auditDiff ? (
                    <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                      <PluginDiffView diff={auditDiff} />
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground bg-muted/10">
                      该插件暂无已发布的历史版本（首次提交或首发版本），无需比对历史增量。
                    </div>
                  )}
                </div>

                {/* 完整清单 JSON */}
                <div>
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer font-medium hover:text-foreground">
                      查看待审完整清单 JSON
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-background p-3 text-[11px] font-mono text-foreground border border-border/50">
                      {JSON.stringify(auditPluginItem.manifest, null, 2)}
                    </pre>
                  </details>
                </div>
              </div>
            )}

            <DialogFooter className="flex flex-col sm:flex-row sm:justify-between items-stretch sm:items-center gap-2 pt-2 border-t border-border/60">
              <button
                type="button"
                onClick={() => setAuditModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg border border-border/60 hover:bg-muted/60 transition-colors"
              >
                关闭
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAuditModalOpen(false)
                    if (auditPluginItem) {
                      setRejectPluginItem(auditPluginItem)
                      setRejectNote('')
                      setRejectModalOpen(true)
                    }
                  }}
                  disabled={actionLoading}
                  className="px-3.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 rounded-lg border border-destructive/30 transition-colors"
                >
                  驳回
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (auditPluginItem) {
                      setAuditModalOpen(false)
                      handleApprove(auditPluginItem)
                    }
                  }}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1 px-4 py-1.5 text-xs font-medium text-primary-foreground bg-primary hover:opacity-90 rounded-lg transition-all shadow-2xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>通过并立即上架</span>
                </button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 官方资源同步结果弹窗 */}
        <Dialog open={syncModalOpen} onOpenChange={setSyncModalOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Sparkles className="w-5 h-5 text-amber-500" />
                <span>官方插件资源同步完成</span>
              </DialogTitle>
              <DialogDescription className="text-xs">
                山羊胡已完成与代码库最新官方资源目录的增量同步。
              </DialogDescription>
            </DialogHeader>

            {syncResult && (
              <div className="space-y-3 py-2 text-xs">
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="p-2.5 rounded-xl bg-muted/40 border border-border/50">
                    <div className="text-lg font-bold text-foreground">{syncResult.summary.total}</div>
                    <div className="text-[10px] text-muted-foreground">总目录数</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                    <div className="text-lg font-bold">{syncResult.summary.added}</div>
                    <div className="text-[10px]">新增入库</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-600 dark:text-sky-400">
                    <div className="text-lg font-bold">{syncResult.summary.updated}</div>
                    <div className="text-[10px]">版本升级</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-muted/40 border border-border/50 text-muted-foreground">
                    <div className="text-lg font-bold">{syncResult.summary.upToDate}</div>
                    <div className="text-[10px]">已是最新</div>
                  </div>
                </div>

                {syncResult.details.length > 0 && (
                  <div className="max-h-48 overflow-y-auto rounded-xl border border-border/60 bg-muted/20 p-2 space-y-1.5 font-mono text-[11px]">
                    {syncResult.details.map((d, i) => (
                      <div key={i} className="flex items-center justify-between py-0.5 px-1">
                        <span className="truncate max-w-[200px] text-foreground">{d.slug}</span>
                        <span className={
                          d.action === 'added' ? 'text-emerald-500 font-bold' :
                          d.action === 'updated' ? 'text-sky-500 font-bold' :
                          'text-muted-foreground'
                        }>
                          {d.action === 'added' ? `+ 新增 v${d.version}` :
                           d.action === 'updated' ? `↑ 升级 v${d.version}` :
                           '• 已是最新'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <button
                type="button"
                onClick={() => setSyncModalOpen(false)}
                className="px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
              >
                知道了
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 底部导航 */}
        <Footer />
        <PluginTapsModal
          open={tapsModalOpen}
          onOpenChange={setTapsModalOpen}
          onSynced={() => void loadList()}
        />
      </div>
    </Container>
  )
}
