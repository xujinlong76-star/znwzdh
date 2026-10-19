'use client'

/**
 * 插件详情与交互式安装页 (Plugin Detail & Live Preview Page)
 *
 * 遵循 docs/PLUGIN-MARKET-DESIGN-2026-10-19.md：
 * 1. 深度展现插件内容明细（分类、站点、看板组件配置、主题色彩盘）；
 * 2. 具备一键安装、卸载、星标、违规举报与下载原始声明式 JSON 清单能力；
 * 3. 对主题插件提供客户端零刷新即时试用。
 */

import { useState, useEffect, useCallback, useRef, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import {
  fetchPluginDetail,
  fetchPluginAudit,
  starPlugin,
  unstarPlugin,
  createPluginShortLink,
  trackPluginEvent,
  type HubPluginItem,
  type HubPluginAuditReport,
} from '@/lib/navhub-api'
import {
  pluginKindLabel,
  PLUGIN_MANIFEST_FILE_SUFFIX,
  comparePluginVersions,
} from '@/lib/plugins/plugin-manifest'
import { resolveInstallAction } from '@/lib/plugins/install-state'
import { KIND_ICONS, KIND_TONES } from '@/lib/plugins/kind-meta'
import { PluginInstallModal } from '@/components/plugins/plugin-install-modal'
import { PluginReportModal } from '@/components/plugins/plugin-report-modal'
import { PluginDiffView } from '@/components/plugins/plugin-diff-view'
import { PluginSimilar } from '@/components/plugins/plugin-similar'
import { PluginVersionTimeline } from '@/components/plugins/plugin-version-timeline'
import { PluginReviewSection } from '@/components/plugins/plugin-review-section'
import { getIdentity } from '@/lib/identity'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { useModularLayout } from '@/lib/modular/use-modular-layout'
import {
  startThemeTryout,
  cancelThemeTryout,
  isThemeInTryout,
  setActiveTheme,
  resetTheme,
  getActiveTheme,
} from '@/lib/plugins/theme-runtime'
import { copyText } from '@/lib/clipboard'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ArrowLeft,
  Globe,
  LayoutGrid,
  Palette,
  Star,
  Download,
  Check,
  Flag,
  FileJson,
  Copy,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  Layers,
  Info,
  RotateCcw,
  Share2,
  History,
  MessageSquare,
  Award,
  AlertTriangle,
  Upload,
  Search,
  Boxes,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type DetailTab = 'preview' | 'diff' | 'impact' | 'raw' | 'history' | 'reviews'

const DETAIL_TABS: DetailTab[] = ['preview', 'diff', 'impact', 'raw', 'history', 'reviews']

export default function PluginDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const resolvedParams = use(params)
  const rawSlug = resolvedParams.slug
  const slug = decodeURIComponent(rawSlug)
  const router = useRouter()

  const [plugin, setPlugin] = useState<HubPluginItem | null>(null)
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<DegradeNotice | null>(null)
  const [identity, setIdentity] = useState<string>('')

  useEffect(() => {
    setIdentity(getIdentity())
  }, [])

  // 交互弹窗
  const [installModalOpen, setInstallModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'install' | 'uninstall' | 'upgrade'>('install')
  const [reportModalOpen, setReportModalOpen] = useState(false)
  const [badgeModalOpen, setBadgeModalOpen] = useState(false)
  const [badgeMetric, setBadgeMetric] = useState<'version' | 'installs' | 'stars' | 'rating'>('version')
  const [auditModalOpen, setAuditModalOpen] = useState(false)
  const [auditReport, setAuditReport] = useState<HubPluginAuditReport | null>(null)

  // 星标状态
  const [starred, setStarred] = useState(false)
  const [starCount, setStarCount] = useState(0)
  const [starLoading, setStarLoading] = useState(false)

  // 选项卡切换（支持 ?tab=reviews 等深链，便于分享具体区块）
  const [activeTab, setActiveTab] = useState<DetailTab>('preview')
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    if (requested && (DETAIL_TABS as string[]).includes(requested)) {
      setActiveTab(requested as DetailTab)
    }
  }, [])

  /** 切换选项卡时同步地址栏，复制链接即可回到同一区块。 */
  const selectTab = useCallback((tab: DetailTab) => {
    setActiveTab(tab)
    const url = new URL(window.location.href)
    if (tab === 'preview') url.searchParams.delete('tab')
    else url.searchParams.set('tab', tab)
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    )
  }, [])

  /** 标准 ARIA Tabs 键盘交互：左右方向键循环，Home/End 跳首尾。 */
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.getAttribute('role') !== 'tab') return
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    )
    const index = tabs.indexOf(target as HTMLButtonElement)
    if (index < 0) return

    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return

    event.preventDefault()
    selectTab(DETAIL_TABS[next])
    tabs[next]?.focus()
  }

  // 工作台预设注入钩子
  const { installWidgetPreset } = useModularLayout()

  // 主题免安装试用状态
  const [isThemeApplied, setIsThemeApplied] = useState(false)
  const [inTryout, setInTryout] = useState(false)

  useEffect(() => {
    if (plugin?.kind === 'theme') {
      setInTryout(isThemeInTryout(plugin.slug))
      const onTryoutChange = () => setInTryout(isThemeInTryout(plugin.slug))
      window.addEventListener('navhub_theme_tryout_changed', onTryoutChange)
      return () => window.removeEventListener('navhub_theme_tryout_changed', onTryoutChange)
    }
  }, [plugin?.slug, plugin?.kind])

  // D1 更新链路：解析「安装 / 更新 / 已安装」动作（已安装版本 < 市场版本 → 可更新）
  const installAction = plugin ? resolveInstallAction(plugin.installedVersion, plugin.version) : 'install'

  // F4 组合包：任一成员失效即暂停安装（服务端同样 fail closed；卸载不受影响）
  const bundleBlocked = plugin?.kind === 'bundle' && plugin.bundleReady === false

  // 组合包成员影响汇总（仅统计当前可用成员；失效成员单独在成员清单里标注）
  const bundleTotals =
    plugin?.kind === 'bundle'
      ? (plugin.bundleItems ?? []).reduce(
          (acc, item) => {
            acc.sites += item.summary?.siteCount ?? 0
            acc.categories += item.summary?.categoryCount ?? 0
            acc.engines += item.summary?.engineCount ?? 0
            acc.tokens += item.summary?.themeTokenCount ?? 0
            return acc
          },
          { sites: 0, categories: 0, engines: 0, tokens: 0 },
        )
      : null

  // D4 分享深链：?install=1 落地即弹安装确认（尚未安装时；仅处理一次，
  // 避免星标等后续状态刷新触发重弹打扰）
  const deepLinkHandled = useRef(false)
  useEffect(() => {
    if (loading || !plugin || deepLinkHandled.current) return
    deepLinkHandled.current = true
    const action = resolveInstallAction(plugin.installedVersion, plugin.version)
    if (action === 'install' && new URLSearchParams(window.location.search).get('install') === '1') {
      setModalMode('install')
      setInstallModalOpen(true)
    }
  }, [loading, plugin])

  const handleShareLink = useCallback(async () => {
    // 优先创建站内短链；失败时退回完整深链，分享不因后端故障而不可用
    let path = `/marketplace/${encodeURIComponent(slug)}?install=1`
    try {
      const short = await createPluginShortLink(slug, { install: true })
      if (short.path) path = short.path
    } catch {
      // 保留长链兜底
    }
    trackPluginEvent('plugin_share', slug)
    const link = `${window.location.origin}${path}`
    const result = await copyText(link)
    if (result.ok) {
      toast.success('分享链接已复制', { description: '对方打开即可一键进入安装确认' })
    } else {
      toast.error('复制失败', { description: result.reason })
    }
  }, [slug])

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setNotice(null)
    try {
      const activeIdentity = identity || getIdentity()
      const res = await fetchPluginDetail(slug, activeIdentity, (err) =>
        setNotice(describeDegrade(err, '插件详情'))
      )
      if (res && res.plugin) {
        setPlugin(res.plugin)
        setSummary(res.summary)
        setStarred(Boolean(res.plugin.starred))
        setStarCount(res.plugin.starCount || 0)

        // 检查主题是否已在本地激活
        if (res.plugin.kind === 'theme') {
          const currentTheme = getActiveTheme()
          setIsThemeApplied(currentTheme?.slug === res.plugin.slug)
        }

        // 异步调取全自动安全沙盒体检报告（不阻断主数据渲染）
        fetchPluginAudit(slug)
          .then((auditRes) => {
            if (auditRes?.ok && auditRes.report) {
              setAuditReport(auditRes.report)
            }
          })
          .catch(() => {
            // 体检报告是异步增强信息：失败时维持「暂无报告」，不阻断详情主数据
          })
      } else {
        setPlugin(null)
      }
    } catch {
      // 详情接口异常或 404 时置空，由下游状态渲染 404 或降级横幅
      setPlugin(null)
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  // 漏斗：每个详情页会话只记一次浏览（避免星标/安装后的 loadDetail 重复计数）
  const viewTracked = useRef(false)
  useEffect(() => {
    if (!plugin || viewTracked.current) return
    viewTracked.current = true
    trackPluginEvent('plugin_view', plugin.slug)
  }, [plugin])

  const handleStarToggle = async () => {
    if (!plugin || starLoading) return
    setStarLoading(true)
    const nextStarred = !starred
    setStarred(nextStarred)
    setStarCount((prev) => (nextStarred ? prev + 1 : Math.max(0, prev - 1)))

    try {
      if (nextStarred) {
        const res = await starPlugin(plugin.slug)
        setStarCount(res.starCount)
      } else {
        const res = await unstarPlugin(plugin.slug)
        setStarCount(res.starCount)
      }
    } catch (err) {
      setStarred(!nextStarred)
      setStarCount((prev) => (nextStarred ? Math.max(0, prev - 1) : prev + 1))
      toast.error('星标更新失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setStarLoading(false)
    }
  }

  const handleExportJson = () => {
    if (!plugin?.manifest) return
    const blob = new Blob([JSON.stringify(plugin.manifest, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${plugin.slug}${PLUGIN_MANIFEST_FILE_SUFFIX}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('已导出插件清单 JSON')
  }

  const handleCopyRaw = async () => {
    if (!plugin?.manifest) return
    const res = await copyText(JSON.stringify(plugin.manifest, null, 2))
    if (res.ok) {
      toast.success('已复制插件 JSON 到剪贴板')
    } else {
      toast.error('复制失败', { description: res.reason })
    }
  }

  const handleToggleThemeTryout = () => {
    if (!plugin || plugin.kind !== 'theme') return
    if (inTryout) {
      cancelThemeTryout()
      toast.info('已退出主题试用沙箱')
    } else {
      const payload = plugin.manifest.payload
      startThemeTryout({
        slug: plugin.slug,
        name: plugin.name,
        tokens: payload?.tokens,
        accent: payload?.accent,
      })
      toast.success(`正在免安装沙箱试用「${plugin.name}」主题！`)
    }
  }

  if (loading) {
    return (
      <Container as="main" id="main-content">
        <div className="py-10 space-y-6 animate-pulse">
          <div className="h-4 w-32 bg-muted/60 rounded-md" />
          <div className="h-32 bg-muted/30 rounded-3xl border border-border/40" />
          <div className="h-64 bg-muted/20 rounded-2xl border border-border/30" />
        </div>
      </Container>
    )
  }

  if (!plugin) {
    return (
      <Container as="main" id="main-content">
        <div className="py-16 text-center space-y-4 max-w-md mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-muted/60 border border-border/40 flex items-center justify-center mx-auto text-muted-foreground">
            <Info className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">插件未上架或不存在</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            该插件可能尚未通过管理员审核、已被作者下架，或链接已失效。
          </p>
          <div className="pt-2">
            <Link
              href="/marketplace"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-all"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回插件市场</span>
            </Link>
          </div>
        </div>
      </Container>
    )
  }

  const manifest = plugin.manifest
  const payload = manifest.payload
  const hasUpgrade = Boolean(
    plugin.installed &&
    plugin.installedVersion &&
    comparePluginVersions(plugin.version, plugin.installedVersion) > 0
  )

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 space-y-6">
        {/* 面包屑与顶部返回 */}
        <div className="flex items-center justify-between">
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回插件列表</span>
          </Link>
          <button
            type="button"
            onClick={() => setReportModalOpen(true)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-amber-600 transition-colors px-2 py-1"
          >
            <Flag className="w-3.5 h-3.5" />
            <span>举报违规</span>
          </button>
        </div>

        {/* 降级提示 */}
        {notice && <HubDegradedNotice notice={notice} onRetry={loadDetail} />}

        {/* 自动隔离熔断警告 */}
        {plugin.status === 'quarantined' && (
          <div className="p-4 rounded-2xl border border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm">
              <h4 className="font-bold">⚠️ 该插件已被系统自动隔离体检 (Quarantined)</h4>
              <p className="text-xs mt-1 text-destructive/90 leading-relaxed">
                因累计收到多次社区用户违规举报，系统已自动触发安全熔断机制，暂停普通访客一键安装。
                NavHub 管理员审核确认安全后将恢复上架。
              </p>
            </div>
          </div>
        )}

        {/* 插件头部 Hero 卡片 */}
        <div className="relative overflow-hidden rounded-3xl border border-border/80 glass-surface p-6 sm:p-8 space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-5">
            <div className="space-y-3 max-w-2xl">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    'text-xs font-medium px-2.5 py-0.5 border-border/60',
                    plugin.kind === 'site-pack' && 'text-sky-600 dark:text-sky-400 bg-sky-500/5',
                    plugin.kind === 'workspace-preset' && 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/5',
                    plugin.kind === 'theme' && 'text-violet-600 dark:text-violet-400 bg-violet-500/5',
                    plugin.kind === 'search-pack' && 'text-amber-600 dark:text-amber-400 bg-amber-500/5',
                    plugin.kind === 'bundle' && 'text-amber-600 dark:text-amber-400 bg-amber-500/5'
                  )}
                >
                  {pluginKindLabel(plugin.kind)}
                </Badge>
                <span className="text-xs font-mono text-muted-foreground px-2 py-0.5 rounded-md bg-muted/50 border border-border/30">
                  v{plugin.version}
                </span>
                {plugin.license && (
                  <span className="text-xs text-muted-foreground font-mono">
                    协议: {plugin.license}
                  </span>
                )}
                {plugin.author && (
                  <span className="text-xs text-muted-foreground">
                    作者:{' '}
                    {plugin.ownerKey ? (
                      <Link
                        href={`/marketplace/author/${encodeURIComponent(plugin.ownerKey)}`}
                        className="text-foreground font-medium hover:text-primary hover:underline"
                      >
                        {plugin.author}
                      </Link>
                    ) : (
                      <strong className="text-foreground font-medium">{plugin.author}</strong>
                    )}
                  </span>
                )}
                {plugin.isOwner && (
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/30 bg-primary/5">
                    作者本人
                  </Badge>
                )}
                {plugin.reviewStats && plugin.reviewStats.reviewCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => selectTab('reviews')}
                    className="text-xs text-amber-500 font-semibold flex items-center gap-1 hover:underline cursor-pointer"
                  >
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    <span>{plugin.reviewStats.avgRating.toFixed(1)}</span>
                    <span className="text-muted-foreground font-normal">
                      ({plugin.reviewStats.reviewCount}人评价)
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => selectTab('reviews')}
                    className="text-xs text-muted-foreground/80 hover:text-foreground cursor-pointer flex items-center gap-1"
                  >
                    <Star className="w-3.5 h-3.5 text-muted-foreground/40" />
                    <span>暂无评分 (点击评价)</span>
                  </button>
                )}

                {auditReport && (
                  <button
                    type="button"
                    onClick={() => setAuditModalOpen(true)}
                    className={cn(
                      'inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full border transition-colors cursor-pointer',
                      auditReport.level === 'safe'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                        : auditReport.level === 'low_risk'
                        ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 hover:bg-blue-500/20'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20'
                    )}
                    title="点击查看全自动代码沙盒安全审计报告"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="font-semibold">{auditReport.score}分安全评级</span>
                    {auditReport.verifiedAuthor && (
                      <span className="hidden sm:inline font-medium">· 认证作者</span>
                    )}
                  </button>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                {plugin.name}
              </h1>

              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                {plugin.description || '暂无描述'}
              </p>

              {/* 标签 */}
              {plugin.tags && plugin.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {plugin.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[11px] px-2 py-0.5 rounded-md bg-muted/60 text-muted-foreground border border-border/40"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 主操作动作组 */}
            <div className="flex flex-col sm:items-end gap-3 shrink-0">
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={handleStarToggle}
                  disabled={starLoading}
                  aria-label={starred ? '取消星标' : '点亮星标'}
                  aria-pressed={starred}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all',
                    starred
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                      : 'border-border/70 bg-background/70 hover:bg-muted text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Star className={cn('w-4 h-4', starred && 'fill-current text-amber-500')} />
                  <span>{starred ? '已星标' : '星标'}</span>
                  <span className="font-mono ml-0.5 text-[11px]">{starCount}</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportJson}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-border/70 bg-background/70 hover:bg-muted text-foreground transition-all"
                  title="下载 .navhub-plugin.json 原始清单文件"
                >
                  <FileJson className="w-4 h-4 text-primary" />
                  <span>导出清单</span>
                </button>

                <button
                  type="button"
                  onClick={handleShareLink}
                  aria-label="复制带安装引导的分享链接"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-border/70 bg-background/70 hover:bg-muted text-foreground transition-all"
                  title="复制带安装引导的分享链接（自动生成站内短链）"
                >
                  <Share2 className="w-4 h-4 text-primary" />
                  <span>分享</span>
                </button>

                {plugin.isOwner && (
                  <Button asChild size="sm" variant="outline" className="h-[34px] gap-1.5 text-xs">
                    <Link href={`/marketplace/publish?from=${encodeURIComponent(plugin.slug)}`}>
                      <Upload className="w-4 h-4 text-primary" />
                      发布新版本
                    </Link>
                  </Button>
                )}

                <button
                  type="button"
                  onClick={() => setBadgeModalOpen(true)}
                  aria-label="获取动态 SVG 徽章"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-border/70 bg-background/70 hover:bg-muted text-foreground transition-all"
                  title="获取可在 GitHub README 或个人主页展示的动态 SVG 徽章"
                >
                  <Award className="w-4 h-4 text-primary" />
                  <span>徽章</span>
                </button>
              </div>

              {/* 安装 / 更新 / 卸载主要按钮 */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                {bundleBlocked && !plugin.installed && (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive flex items-start gap-1.5 max-w-xs">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>组合包成员已失效，安装已暂停；可查看下方「影响评估」中的成员明细。</span>
                  </div>
                )}
                {plugin.installed ? (
                  installAction === 'update' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setModalMode('upgrade')
                          setInstallModalOpen(true)
                        }}
                        disabled={bundleBlocked}
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 active:scale-95 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Sparkles className="w-4 h-4 text-amber-300" />
                        <span>平滑升级到 v{plugin.version}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setModalMode('uninstall')
                          setInstallModalOpen(true)
                        }}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground border border-border/60 hover:bg-muted/50 transition-all"
                      >
                        <span>卸载当前版本 (v{plugin.installedVersion})</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setModalMode('uninstall')
                        setInstallModalOpen(true)
                      }}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-all group"
                    >
                      <Check className="w-4 h-4 group-hover:hidden" />
                      <RotateCcw className="w-4 h-4 hidden group-hover:inline-block" />
                      <span className="group-hover:hidden">已安装 (点击管理/卸载)</span>
                      <span className="hidden group-hover:inline-block">卸载该插件</span>
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setModalMode('install')
                      setInstallModalOpen(true)
                    }}
                    disabled={bundleBlocked}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 active:scale-95 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download className="w-4 h-4" />
                    <span>{bundleBlocked ? '组合包暂不可安装' : '立即安装该插件'}</span>
                  </button>
                )}
              </div>

              {/* 主题插件独享：免安装即时沙箱试用 */}
              {plugin.kind === 'theme' && (
                <button
                  type="button"
                  onClick={handleToggleThemeTryout}
                  className={cn(
                    'w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                    inTryout
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
                      : 'border-violet-500/30 bg-violet-500/5 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10'
                  )}
                >
                  <Palette className="w-3.5 h-3.5" />
                  <span>{inTryout ? '正在试用中 (点击退出)' : '免安装沙箱试用'}</span>
                </button>
              )}
            </div>
          </div>

          {/* 新版本可用横幅提示 */}
          {installAction === 'update' && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary shrink-0" />
                <div>
                  <span className="font-semibold text-foreground">检测到新版本可用：</span>
                  <span className="text-muted-foreground ml-1">
                    当前安装版本为 <strong className="font-mono text-foreground">v{plugin.installedVersion}</strong>，插件市场最新版本为{' '}
                    <strong className="font-mono text-primary font-bold">v{plugin.version}</strong>。
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => selectTab('diff')}
                  className="px-3 py-1.5 rounded-lg border border-primary/30 bg-background/80 hover:bg-background text-primary font-medium transition-colors"
                >
                  查看升级差异
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModalMode('upgrade')
                    setInstallModalOpen(true)
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition-all shadow-xs"
                >
                  平滑升级
                </button>
              </div>
            </div>
          )}

          {/* 状态与安全背书 */}
          <div className="pt-4 border-t border-border/50 flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>纯声明式 JSON 架构</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5 text-muted-foreground/70" />
                <span>已累计被安装 {plugin.installCount || 0} 次</span>
              </span>
            </div>
            {plugin.homepage && (
              <a
                href={plugin.homepage}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <span>项目主页 / 源码</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        {/* 详情内容选项卡 */}
        <div className="space-y-4">
          <div
            role="tablist"
            aria-label="插件详情内容"
            onKeyDown={handleTabKeyDown}
            className="flex items-center gap-2 border-b border-border/60 pb-2 overflow-x-auto"
          >
            <button
              type="button"
              role="tab"
              id="plugin-tab-preview"
              aria-selected={activeTab === 'preview'}
              tabIndex={activeTab === 'preview' ? 0 : -1}
              aria-controls="plugin-tabpanel-preview"
              onClick={() => selectTab('preview')}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap shrink-0',
                activeTab === 'preview'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              内容明细与预览
            </button>
            <button
              type="button"
              role="tab"
              id="plugin-tab-diff"
              aria-selected={activeTab === 'diff'}
              tabIndex={activeTab === 'diff' ? 0 : -1}
              aria-controls="plugin-tabpanel-diff"
              onClick={() => selectTab('diff')}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-medium transition-all inline-flex items-center gap-1.5 whitespace-nowrap shrink-0',
                activeTab === 'diff'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              <span>版本差异对比</span>
              {installAction === 'update' && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-500 text-white font-bold">
                  新
                </span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              id="plugin-tab-impact"
              aria-selected={activeTab === 'impact'}
              tabIndex={activeTab === 'impact' ? 0 : -1}
              aria-controls="plugin-tabpanel-impact"
              onClick={() => selectTab('impact')}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap shrink-0',
                activeTab === 'impact'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              影响评估与指标
            </button>
            <button
              type="button"
              role="tab"
              id="plugin-tab-raw"
              aria-selected={activeTab === 'raw'}
              tabIndex={activeTab === 'raw' ? 0 : -1}
              aria-controls="plugin-tabpanel-raw"
              onClick={() => selectTab('raw')}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap shrink-0',
                activeTab === 'raw'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              清单源码 (JSON)
            </button>
            <button
              type="button"
              role="tab"
              id="plugin-tab-history"
              aria-selected={activeTab === 'history'}
              tabIndex={activeTab === 'history' ? 0 : -1}
              aria-controls="plugin-tabpanel-history"
              onClick={() => selectTab('history')}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-medium transition-all inline-flex items-center gap-1.5 whitespace-nowrap shrink-0',
                activeTab === 'history'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              <History className="w-3.5 h-3.5" />
              <span>版本演进</span>
            </button>
            <button
              type="button"
              role="tab"
              id="plugin-tab-reviews"
              aria-selected={activeTab === 'reviews'}
              tabIndex={activeTab === 'reviews' ? 0 : -1}
              aria-controls="plugin-tabpanel-reviews"
              onClick={() => selectTab('reviews')}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-medium transition-all inline-flex items-center gap-1.5 whitespace-nowrap shrink-0',
                activeTab === 'reviews'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>用户评价</span>
              {plugin.reviewStats && plugin.reviewStats.reviewCount > 0 && (
                <span
                  className={cn(
                    'px-1.5 py-0.5 text-[10px] rounded-full font-mono',
                    activeTab === 'reviews'
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {plugin.reviewStats.reviewCount}
                </span>
              )}
            </button>
          </div>

          {/* 选项卡 1：内容明细与预览 */}
          {activeTab === 'preview' && (
            <div
              role="tabpanel"
              id="plugin-tabpanel-preview"
              aria-labelledby="plugin-tab-preview"
              className="space-y-6"
            >
              {/* site-pack 网址包明细展示 */}
              {plugin.kind === 'site-pack' && payload?.sites && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Globe className="w-4 h-4 text-sky-500" />
                      <span>包含站点列表 ({payload.sites.length})</span>
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      包含 {payload.categories?.length ?? 0} 个类目
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {payload.sites.map((site: any, idx: number) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-border/70 bg-card/60 p-3.5 space-y-2 hover:border-border transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-xs text-foreground truncate">
                            {site.title}
                          </span>
                          {site.category && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
                              {site.category}
                            </span>
                          )}
                        </div>
                        <a
                          href={site.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-[11px] text-sky-600 dark:text-sky-400 hover:underline truncate block"
                        >
                          {site.url}
                        </a>
                        {site.description && (
                          <p className="text-[11px] text-muted-foreground line-clamp-2">
                            {site.description}
                          </p>
                        )}
                        {site.tags && site.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {site.tags.map((t: string) => (
                              <span
                                key={t}
                                className="text-[9px] px-1 py-0.5 rounded bg-muted/40 text-muted-foreground"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* workspace-preset 看板预设明细展示 */}
              {plugin.kind === 'workspace-preset' && payload?.boards && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <LayoutGrid className="w-4 h-4 text-emerald-500" />
                    <span>预设看板结构 ({payload.boards.length})</span>
                  </h3>
                  <div className="space-y-4">
                    {payload.boards.map((b: any, bIdx: number) => (
                      <div
                        key={bIdx}
                        className="rounded-2xl border border-border/70 bg-card/60 p-5 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-xs text-foreground">{b.name}</h4>
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {b.widgets?.length ?? 0} 个小组件
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                          {b.widgets?.map((w: any, wIdx: number) => (
                            <div
                              key={wIdx}
                              className="rounded-xl border border-border/50 bg-background/60 p-2.5 text-xs space-y-1"
                            >
                              <div className="flex items-center justify-between text-muted-foreground">
                                <span className="font-medium text-foreground">
                                  {w.title || w.type}
                                </span>
                                <span className="font-mono text-[10px]">{w.type}</span>
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                占用网格：{w.colSpan ?? 4} 列 × {w.rowSpan ?? 1} 行
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* theme 主题调色板展示 */}
              {plugin.kind === 'theme' && payload && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Palette className="w-4 h-4 text-violet-500" />
                      <span>主题色板与变量定义</span>
                    </h3>
                    {payload.accent && (
                      <Badge variant="outline" className="text-xs">
                        强调色系: {payload.accent}
                      </Badge>
                    )}
                  </div>

                  {payload.tokens && Object.keys(payload.tokens).length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {Object.entries(payload.tokens).map(([k, v]) => (
                        <div
                          key={k}
                          className="rounded-xl border border-border/60 bg-card/60 p-3.5 space-y-2 flex items-center justify-between"
                        >
                          <div className="space-y-0.5">
                            <span className="font-mono text-xs text-foreground block">{k}</span>
                            <span className="font-mono text-[10px] text-muted-foreground block">
                              hsl({String(v)})
                            </span>
                          </div>
                          <div
                            className="w-8 h-8 rounded-lg border border-border/80 shadow-2xs shrink-0"
                            style={{ backgroundColor: `hsl(${String(v)})` }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">未覆盖任何自定义色彩变量</p>
                  )}
                </div>
              )}

              {/* search-pack 搜索引擎配置展示 */}
              {plugin.kind === 'search-pack' && payload?.engines && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Search className="w-4 h-4 text-sky-500" />
                      <span>包含的快捷搜索引擎 ({payload.engines.length})</span>
                    </h3>
                    <span className="text-xs text-muted-foreground">在主搜索框键入前缀即可触发</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {payload.engines.map((eng: any) => (
                      <div
                        key={eng.prefix}
                        className="p-4 rounded-xl border border-border/70 bg-card/60 space-y-2 hover:border-border transition-all"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {eng.icon && (
                              <img
                                src={eng.icon}
                                alt={eng.name}
                                className="w-4 h-4 rounded-xs shrink-0 object-contain"
                                onError={(e) => { (e.target as HTMLElement).style.display = 'none' }}
                              />
                            )}
                            <span className="text-sm font-semibold text-foreground truncate">
                              {eng.name}
                            </span>
                          </div>
                          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-primary/10 text-primary shrink-0">
                            {eng.prefix}
                          </span>
                        </div>
                        {eng.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {eng.description}
                          </p>
                        )}
                        <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-2 text-xs">
                          <code className="text-[11px] text-muted-foreground font-mono truncate max-w-[200px]">
                            {eng.searchUrl}
                          </code>
                          <button
                            type="button"
                            onClick={() => window.open(eng.searchUrl.replace('{q}', 'NavHub'), '_blank', 'noopener,noreferrer')}
                            className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0 font-medium"
                          >
                            测试直达 <ExternalLink className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* bundle 组合包成员清单 */}
              {plugin.kind === 'bundle' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Boxes className="w-4 h-4 text-amber-500" />
                      <span>
                        组合包成员 ({summary?.bundleItemCount ?? plugin.bundleItems?.length ?? 0})
                      </span>
                    </h3>
                    <span className="text-xs text-muted-foreground">一次安装，按清单顺序复用市场安装管道</span>
                  </div>

                  {plugin.bundleReady === false && (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2 text-xs text-destructive">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        部分成员当前不可用（下架/隔离/删除或类型变更），组合包已暂停安装；卸载仅解除组合关系，不会级联移除成员。
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(plugin.bundleItems ?? []).map((item) => {
                      const MemberIcon = (KIND_ICONS as Record<string, typeof Boxes>)[item.kind] ?? Boxes
                      const memberTone = (KIND_TONES as Record<string, string>)[item.kind] ?? ''
                      const metric = item.summary
                        ? item.kind === 'site-pack'
                          ? `${item.summary.siteCount ?? 0} 个站点 · ${item.summary.categoryCount ?? 0} 个类目`
                          : item.kind === 'search-pack'
                            ? `${item.summary.engineCount ?? 0} 个搜索引擎`
                            : `${item.summary.themeTokenCount ?? 0} 项主题变量`
                        : null
                      const body = (
                        <>
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              {item.icon ? (
                                <span className="text-lg shrink-0">{item.icon}</span>
                              ) : (
                                <MemberIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                              )}
                              <span className="text-sm font-semibold text-foreground truncate">
                                {item.name ?? item.slug}
                              </span>
                            </div>
                            <Badge variant="outline" className={cn('text-[10px] shrink-0', memberTone)}>
                              {pluginKindLabel(item.kind as Parameters<typeof pluginKindLabel>[0])}
                            </Badge>
                          </div>
                          {item.available ? (
                            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                              <span className="truncate">{metric}</span>
                              <span className="font-mono shrink-0">v{item.version}</span>
                            </div>
                          ) : (
                            <p className="text-[11px] text-destructive flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              <span>{item.reason ?? '当前不可用'}</span>
                            </p>
                          )}
                        </>
                      )
                      return item.available ? (
                        <Link
                          key={item.slug}
                          href={`/marketplace/${encodeURIComponent(item.slug)}`}
                          className="p-4 rounded-xl border border-border/70 bg-card/60 space-y-2 hover:border-primary/40 hover:bg-card transition-all"
                        >
                          {body}
                        </Link>
                      ) : (
                        <div
                          key={item.slug}
                          className="p-4 rounded-xl border border-destructive/30 bg-destructive/5 space-y-2"
                        >
                          {body}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 选项卡：版本变更对比 */}
          {activeTab === 'diff' && (
            <div
              role="tabpanel"
              id="plugin-tabpanel-diff"
              aria-labelledby="plugin-tab-diff"
              className="rounded-3xl border border-border/80 glass-surface p-6 sm:p-8 space-y-4 shadow-xs"
            >
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">版本升级变动明细</h3>
                <p className="text-xs text-muted-foreground">
                  详细比对已安装版本与市场最新版本的站点、分类、小组件及主题样式调整。
                </p>
              </div>
              <PluginDiffView diff={plugin.upgradeDiff} />
            </div>
          )}

          {/* 选项卡 2：影响评估 */}
          {activeTab === 'impact' && (
            <div
              role="tabpanel"
              id="plugin-tabpanel-impact"
              aria-labelledby="plugin-tab-impact"
              className="rounded-2xl border border-border/70 bg-card/60 p-6 space-y-4"
            >
              <h3 className="text-sm font-semibold text-foreground">安装影响评估</h3>
              {plugin.kind === 'bundle' && bundleTotals ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                      <span className="text-xl font-bold text-foreground block font-mono">
                        {summary?.bundleItemCount ?? plugin.bundleItems?.length ?? 0}
                      </span>
                      <span className="text-xs text-muted-foreground">成员插件</span>
                    </div>
                    <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                      <span className="text-xl font-bold text-foreground block font-mono">
                        {bundleTotals.sites}
                      </span>
                      <span className="text-xs text-muted-foreground">新增站点（可用成员）</span>
                    </div>
                    <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                      <span className="text-xl font-bold text-foreground block font-mono">
                        {bundleTotals.engines}
                      </span>
                      <span className="text-xs text-muted-foreground">直达引擎（可用成员）</span>
                    </div>
                    <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                      <span className="text-xl font-bold text-foreground block font-mono">
                        {bundleTotals.tokens}
                      </span>
                      <span className="text-xs text-muted-foreground">主题变量（需手动启用）</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    组合包不包含可执行代码，也不做级联卸载：站点/搜索引擎按等价 URL 去重增量导入；主题类成员仅登记安装，
                    请在「已安装」页显式启用。
                  </p>
                </>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                  <span className="text-xl font-bold text-foreground block font-mono">
                    {summary?.siteCount ?? 0}
                  </span>
                  <span className="text-xs text-muted-foreground">新增站点</span>
                </div>
                <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                  <span className="text-xl font-bold text-foreground block font-mono">
                    {summary?.categoryCount ?? 0}
                  </span>
                  <span className="text-xs text-muted-foreground">新增分类</span>
                </div>
                <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                  <span className="text-xl font-bold text-foreground block font-mono">
                    {summary?.boardCount ?? (plugin.kind === 'workspace-preset' ? 1 : 0)}
                  </span>
                  <span className="text-xs text-muted-foreground">看板数量</span>
                </div>
                <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                  <span className="text-xl font-bold text-foreground block font-mono">
                    {summary?.themeTokenCount ?? (plugin.kind === 'theme' ? Object.keys(payload?.tokens || {}).length : 0)}
                  </span>
                  <span className="text-xs text-muted-foreground">色彩变量</span>
                </div>
                <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                  <span className="text-xl font-bold text-foreground block font-mono">
                    {summary?.engineCount ?? (plugin.kind === 'search-pack' ? (payload?.engines?.length || 0) : 0)}
                  </span>
                  <span className="text-xs text-muted-foreground">直达引擎</span>
                </div>
              </div>
              )}

              {summary?.enginePrefixes && summary.enginePrefixes.length > 0 && (
                <div className="pt-2 space-y-1.5">
                  <h4 className="text-xs font-medium text-foreground">包含的直达前缀：</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.enginePrefixes.map((p: string) => (
                      <span
                        key={p}
                        className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-primary/10 text-primary"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {summary?.hosts && summary.hosts.length > 0 && (
                <div className="pt-2 space-y-1.5">
                  <h4 className="text-xs font-medium text-foreground">主要站点域名：</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.hosts.map((h: string) => (
                      <span
                        key={h}
                        className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-muted/60 text-muted-foreground"
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 选项卡 3：清单源码 */}
          {activeTab === 'raw' && (
            <div
              role="tabpanel"
              id="plugin-tabpanel-raw"
              aria-labelledby="plugin-tab-raw"
              className="relative rounded-2xl border border-border/70 bg-card/60 p-4 space-y-2"
            >
              <div className="flex items-center justify-between pb-2 border-b border-border/50">
                <span className="text-xs font-mono text-muted-foreground">
                  {plugin.slug}{PLUGIN_MANIFEST_FILE_SUFFIX}
                </span>
                <button
                  type="button"
                  onClick={handleCopyRaw}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-border/60 hover:bg-muted text-foreground transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>复制代码</span>
                </button>
              </div>
              <pre className="text-xs font-mono text-foreground/90 overflow-x-auto p-2 leading-relaxed max-h-[500px]">
                {JSON.stringify(plugin.manifest, null, 2)}
              </pre>
            </div>
          )}

          {/* 选项卡 4：版本演进时间轴 */}
          {activeTab === 'history' && (
            <div role="tabpanel" id="plugin-tabpanel-history" aria-labelledby="plugin-tab-history">
              <PluginVersionTimeline slug={plugin.slug} currentVersion={plugin.version} />
            </div>
          )}

          {/* 选项卡 5：真实用户评价 */}
          {activeTab === 'reviews' && (
            <div role="tabpanel" id="plugin-tabpanel-reviews" aria-labelledby="plugin-tab-reviews">
            <PluginReviewSection
              slug={plugin.slug}
              isInstalled={Boolean(plugin.installed)}
              installedVersion={plugin.installedVersion}
              initialReviews={
                plugin.reviewStats
                  ? {
                      slug: plugin.slug,
                      stats: plugin.reviewStats,
                      myReview: plugin.myReview ?? null,
                      items: [],
                      total: plugin.reviewStats.reviewCount,
                      limit: 20,
                      offset: 0,
                    }
                  : null
              }
            />
            </div>
          )}
        </div>

        {/* 相似插件（语义近邻；语义未就绪时不渲染） */}
        <PluginSimilar slug={plugin.slug} />

        {/* 安装 / 卸载确认弹窗 */}
        <PluginInstallModal
          plugin={plugin}
          identity={identity}
          mode={modalMode}
          open={installModalOpen}
          onOpenChange={setInstallModalOpen}
          onSuccess={() => {
            void loadDetail()
          }}
          onApplyPreset={(preset, mode) => {
            installWidgetPreset(preset, mode)
          }}
        />

        {/* 违规举报弹窗 */}
        <PluginReportModal
          slug={plugin.slug}
          pluginName={plugin.name}
          open={reportModalOpen}
          onOpenChange={setReportModalOpen}
        />

        {/* 动态 SVG 徽章获取弹窗 */}
        <Dialog open={badgeModalOpen} onOpenChange={setBadgeModalOpen}>
          <DialogContent className="w-full max-w-lg p-6 space-y-5">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Award className="w-5 h-5 text-primary" />
                  获取开源动态徽章 (Badge)
                </DialogTitle>
                <DialogDescription className="text-xs leading-relaxed">
                  实时展示插件版本、累计安装量或评分。可直接嵌入 GitHub README、个人博客或文档中，支持矢量高清自适应。
                </DialogDescription>
              </DialogHeader>

              {/* 指标切换 */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">指标维度：</span>
                {(
                  [
                    { key: 'version', label: '当前版本' },
                    { key: 'installs', label: '累计安装量' },
                    { key: 'stars', label: '星标计数' },
                    { key: 'rating', label: '综合评分' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setBadgeMetric(tab.key)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      badgeMetric === tab.key
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted/60 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* 实时预览 */}
              <div className="p-4 rounded-xl border border-border/60 bg-muted/20 flex flex-col items-center justify-center gap-2">
                <span className="text-xs text-muted-foreground">实时矢量预览：</span>
                <img
                  src={`/api/plugins/${encodeURIComponent(plugin.slug)}/badge.svg?metric=${badgeMetric}`}
                  alt={`${plugin.name} badge`}
                  className="h-5 object-contain"
                />
              </div>

              {/* 代码片段复制 */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">Markdown 代码</span>
                    <button
                      type="button"
                      onClick={() => {
                        const origin = typeof window !== 'undefined' ? window.location.origin : ''
                        const md = `[![NavHub Plugin](${origin}/api/plugins/${plugin.slug}/badge.svg?metric=${badgeMetric})](${origin}/marketplace/${plugin.slug})`
                        void copyText(md)
                        toast.success('已复制 Markdown 徽章代码')
                      }}
                      className="text-primary hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" /> 复制
                    </button>
                  </div>
                  <pre className="p-2.5 rounded-lg bg-muted text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
                    {`[![NavHub Plugin](https://.../api/plugins/${plugin.slug}/badge.svg?metric=${badgeMetric})](...)`}
                  </pre>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">直接 SVG 地址</span>
                    <button
                      type="button"
                      onClick={() => {
                        const origin = typeof window !== 'undefined' ? window.location.origin : ''
                        void copyText(`${origin}/api/plugins/${plugin.slug}/badge.svg?metric=${badgeMetric}`)
                        toast.success('已复制 SVG 链接')
                      }}
                      className="text-primary hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" /> 复制
                    </button>
                  </div>
                  <pre className="p-2.5 rounded-lg bg-muted text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
                    {`/api/plugins/${plugin.slug}/badge.svg?metric=${badgeMetric}`}
                  </pre>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button size="sm" onClick={() => setBadgeModalOpen(false)}>
                  完成
                </Button>
              </div>
          </DialogContent>
        </Dialog>

        {/* 全自动代码沙盒安全审计弹窗 */}
        <Dialog open={auditModalOpen} onOpenChange={setAuditModalOpen}>
          <DialogContent className="max-w-md p-5 glass-surface border-border/80 shadow-2xl rounded-2xl">
            <DialogHeader className="space-y-1 pb-2 border-b border-border/50">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold">全自动代码沙盒安全体检报告</DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    由 NavHub 全自动静态代码与外链沙盒审计引擎实时生成
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {auditReport ? (
              <div className="py-2 space-y-3">
                <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border/60">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">综合安全评分</div>
                    <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                      {auditReport.score} <span className="text-xs font-normal text-muted-foreground">/ 100 分</span>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs font-semibold px-2.5 py-1',
                      auditReport.level === 'safe'
                        ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                    )}
                  >
                    {auditReport.level === 'safe' ? '安全等级：优良' : '安全等级：提示'}
                  </Badge>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">全链路扫描体检项：</div>
                  {auditReport.checks.map((c, i) => (
                    <div key={i} className="p-2.5 rounded-lg border border-border/40 bg-card/60 text-xs flex items-start gap-2.5">
                      {c.passed ? (
                        <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{c.name}</div>
                        <div className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{c.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="text-[10px] text-muted-foreground/70 text-center pt-1">
                  体检时间：{new Date(auditReport.auditedAt).toLocaleString()} · SHA-256 签名无害化校验
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-muted-foreground">加载安全报告中...</div>
            )}
          </DialogContent>
        </Dialog>

        {/* 底部导航 */}
        <Footer />
      </div>
    </Container>
  )
}
