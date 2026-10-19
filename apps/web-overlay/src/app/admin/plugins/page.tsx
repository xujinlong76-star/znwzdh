'use client'

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
  type HubPluginItem,
  type HubPluginTelemetryMetrics,
  type HubPluginFunnel,
  type HubPluginGovernanceAlert,
  type HubAdminPluginReview,
} from '@/lib/navhub-api'
import { pluginKindLabel } from '@/lib/plugins/plugin-manifest'
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
  ShieldCheck,
  Check,
  X,
  AlertTriangle,
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
  { key: 'rejected', label: '已驳回' },
  { key: 'delisted', label: '已下架' },
] as const

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

  const [activeStatus, setActiveStatus] = useState<string>('pending')
  const [search, setSearch] = useState('')

  // 驳回弹窗
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [rejectPluginItem, setRejectPluginItem] = useState<HubPluginItem | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

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
    try {
      const [res, telem, funnelRes, governanceRes] = await Promise.all([
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
        fetchPluginGovernance().catch(() => {
          // 治理预警请求失败时静默降级为空报警列表，不阻断主列表渲染
          return { alerts: [], generatedAt: 0 }
        }),
      ])
      setPlugins(res.items)
      if (telem) setTelemetry(telem)
      setFunnel(funnelRes)
      setGovernance(governanceRes.alerts)
      if (res.pending !== undefined) {
        setPendingCount(res.pending)
      }
    } catch {
      // 接口异常时降级为空列表，notice 已在回调中提示
      setPlugins([])
    } finally {
      setLoading(false)
    }
  }, [activeStatus, search])

  useEffect(() => {
    void loadList()
  }, [loadList])

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
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <span>访问插件市场前端</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* 头部面板 */}
        <div className="rounded-3xl border border-border/80 glass-surface p-6 sm:p-8 space-y-4 shadow-xs">
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
                  <span className="text-[11px] font-mono">3 大类别</span>
                </div>
                <div className="text-xs font-medium text-foreground flex items-center gap-2 pt-1">
                  <span>包: <strong className="font-mono">{telemetry.kindDistribution.sitePack}</strong></span>
                  <span>·</span>
                  <span>看板: <strong className="font-mono">{telemetry.kindDistribution.workspacePreset}</strong></span>
                  <span>·</span>
                  <span>主题: <strong className="font-mono">{telemetry.kindDistribution.theme}</strong></span>
                </div>
                <div className="text-[11px] text-muted-foreground pt-1">
                  覆盖网址、个人工作台与视觉主题
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

                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground/80">
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
                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <Link
                    href={`/marketplace/${encodeURIComponent(item.slug)}`}
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
                    <button
                      type="button"
                      onClick={() => handleDelist(item)}
                      disabled={actionLoading}
                      className="px-3 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded-lg border border-amber-500/30 transition-colors"
                    >
                      下架
                    </button>
                  )}

                  {(item.status === 'rejected' || item.status === 'delisted') && (
                    <button
                      type="button"
                      onClick={() => handleApprove(item)}
                      disabled={actionLoading}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 rounded-lg border border-emerald-500/30 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>重新上架</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={PackageCheck}
            title={`暂无「${STATUS_TABS.find((t) => t.key === activeStatus)?.label}」的插件`}
            description="当前队列为空，所有插件已处理完毕。"
          />
        )}

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

            <DialogFooter className="flex sm:justify-between items-center gap-2 pt-2 border-t border-border/60">
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

        {/* 底部导航 */}
        <Footer />
      </div>
    </Container>
  )
}
