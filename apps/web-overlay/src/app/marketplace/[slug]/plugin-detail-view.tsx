'use client'

/**
 * 插件详情与交互式安装页 (Plugin Detail & Live Preview Page)
 *
 * 遵循 docs/PLUGIN-MARKET-DESIGN-2026-10-19.md：
 * 1. 深度展现插件内容明细（分类、站点、看板组件配置、主题色彩盘）；
 * 2. 具备一键安装、卸载、星标、违规举报与下载原始声明式 JSON 清单能力；
 * 3. 对主题插件提供客户端零刷新即时试用。
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
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
  type HubPluginAuditReport
} from '@/lib/navhub-api'
import { pluginKindLabel, PLUGIN_MANIFEST_FILE_SUFFIX, comparePluginVersions } from '@/lib/plugins/plugin-manifest'
import { resolveInstallAction } from '@/lib/plugins/install-state'
import type { DetailTab } from './detail-shared'

const DETAIL_TABS: DetailTab[] = ['preview', 'diff', 'impact', 'raw', 'history', 'reviews']
import { DetailTabPanels } from './detail-tab-panels'
import { DetailModals } from './detail-modals'
import { PluginUrlAuditBadge } from '@/components/plugins/plugin-url-audit-badge'
import { PluginSimilar } from '@/components/plugins/plugin-similar'

import { getIdentity } from '@/lib/identity'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { startThemeTryout, cancelThemeTryout, isThemeInTryout, getActiveTheme } from '@/lib/plugins/theme-runtime'
import { copyText } from '@/lib/clipboard'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft,
  GitFork,
  Palette,
  Star,
  Download,
  Check,
  Flag,
  FileJson,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  Info,
  RotateCcw,
  Share2,
  History,
  MessageSquare,
  Award,
  AlertTriangle,
  Upload
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'



export default function PluginDetailView({
  slug,
  initialPlugin = null,
  initialSummary = null,
}: {
  slug: string
  initialPlugin?: HubPluginItem | null
  initialSummary?: unknown
}) {
  const [plugin, setPlugin] = useState<HubPluginItem | null>(initialPlugin)
  const [summary, setSummary] = useState<any>(initialSummary)
  const [loading, setLoading] = useState(!initialPlugin)
  /**
   * 服务端首屏不携带 identity（身份在 localStorage），installed/starred 一定是
   * 「未安装」的初始值。必须等客户端带身份静默刷新完成后再做安装相关的自动决策，
   * 否则分享深链会在已安装用户刷新页面时重新弹出安装确认。
   */
  const [detailSynced, setDetailSynced] = useState(!initialPlugin)
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
  const shareCopy = useCopyFeedback()
  const rawCopy = useCopyFeedback()
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

  // 主题免安装试用状态
  const [inTryout, setInTryout] = useState(false)
  // 值由 loadDetail 异步回填；拆分后仅剩写入方（读取方随 hero 区迁出后已无人消费）
  const [, setIsThemeApplied] = useState(false)
  const [studioModalOpen, setStudioModalOpen] = useState(false)
  const [studioInitialManifest, setStudioInitialManifest] = useState<any>(undefined)

  const handleRemix = () => {
    if (!plugin?.manifest) return
    const remixManifest = {
      ...plugin.manifest,
      slug: `${plugin.slug}-remix`,
      name: `${plugin.name} (Remix)`,
      version: '1.0.0',
      forkedFrom: plugin.slug,
    }
    setStudioInitialManifest(remixManifest)
    setStudioModalOpen(true)
  }

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
  // 避免星标等后续状态刷新触发重弹打扰）。
  // 必须等 detailSynced：SSR 首屏没有 identity，直接看 installed 会把已安装
  // 用户误判成未安装，刷新后重新弹窗并遮住「已安装」按钮。
  const deepLinkHandled = useRef(false)
  useEffect(() => {
    if (!detailSynced || loading || !plugin || deepLinkHandled.current) return
    deepLinkHandled.current = true
    const action = resolveInstallAction(plugin.installedVersion, plugin.version)
    if (action === 'install' && new URLSearchParams(window.location.search).get('install') === '1') {
      setModalMode('install')
      setInstallModalOpen(true)
    }
  }, [detailSynced, loading, plugin])

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
    shareCopy.reportCopy(result)
    if (result.ok) {
      toast.success('分享链接已复制', { description: '对方打开即可一键进入安装确认' })
    } else {
      toast.error('复制失败', { description: result.reason })
    }
  }, [shareCopy, slug])

  const loadDetail = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
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

        // 只有真正拿到身份态数据才算同步完成：刷新失败时 installed 仍是 SSR
        // 的「未安装」占位，若此时放行深链会再次误弹安装确认。
        setDetailSynced(true)
      } else if (!opts?.silent) {
        setPlugin(null)
      }
    } catch {
      // 静默刷新失败时保留 SSR 首屏数据，降级提示已由 notice 承担
      if (!opts?.silent) setPlugin(null)
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    // SSR 已带首屏数据时静默刷新：补齐 identity 相关的 installed/starred 状态，
    // 但不让整页退回骨架屏。
    void loadDetail(initialPlugin ? { silent: true } : undefined)
  }, [loadDetail, initialPlugin])

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
    rawCopy.reportCopy(res)
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
                山羊胡管理员审核确认安全后将恢复上架。
              </p>
            </div>
          </div>
        )}

        {/* 待审核状态提示（作者/管理员视角可见） */}
        {plugin.status === 'pending' && (
          <div className="p-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200 flex items-start gap-3">
            <Info className="w-5 h-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div className="text-xs sm:text-sm">
              <h4 className="font-bold flex items-center gap-2">
                <span>⏳ 该插件当前处于【待审核】状态</span>
                <Badge variant="outline" className="text-[10px] bg-amber-500/20 text-amber-800 dark:text-amber-200 border-amber-500/30">
                  作者与管理员可见
                </Badge>
              </h4>
              <p className="text-xs mt-1 text-amber-800/90 dark:text-amber-200/90 leading-relaxed">
                插件清单已提交至中枢审核队列，目前仅您本人与管理员可见。审核通过后将面向全网公开展示并建立语义检索索引。
              </p>
            </div>
          </div>
        )}

        {/* 插件头部 Hero 卡片 */}
        <div className="relative overflow-hidden rounded-3xl border border-border/80 glass-surface market-hero p-4 sm:p-8 space-y-5 sm:space-y-6 shadow-xs">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
            <div className="space-y-3 max-w-2xl min-w-0 flex-1">
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
                {/* 只有网址/组合包有 URL 可体检；无历史记录时组件自己返回 null */}
                {(plugin.kind === 'site-pack' || plugin.kind === 'bundle') && (
                  <PluginUrlAuditBadge slug={plugin.slug} />
                )}
                {plugin.license && (
                  <span className="text-xs text-muted-foreground font-mono">
                    协议: {plugin.license}
                  </span>
                )}
                {plugin.forkedFromSlug && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <GitFork className="w-3.5 h-3.5 text-violet-500" />
                    <span>衍生自</span>
                    <Link
                      href={`/marketplace/${encodeURIComponent(plugin.forkedFromSlug)}`}
                      className="text-primary hover:underline font-medium"
                    >
                      {plugin.forkedFromSlug}
                    </Link>
                  </span>
                )}
                {plugin.remixCount ? (
                  <span className="text-xs text-muted-foreground flex items-center gap-1 font-mono">
                    <GitFork className="w-3 h-3 text-muted-foreground" />
                    <span>{plugin.remixCount} 衍生</span>
                  </span>
                ) : null}
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
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 sm:justify-end">
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
                  onClick={handleRemix}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-border/70 bg-background/70 hover:bg-muted text-foreground transition-all"
                  title="以此插件为蓝本进行二次创作与定制"
                >
                  <GitFork className="w-4 h-4 text-violet-500" />
                  <span>衍生创作</span>
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
                  aria-label={
                    shareCopy.copyFeedback.state === 'copied'
                      ? '分享链接已复制'
                      : shareCopy.copyFeedback.state === 'failed'
                        ? '分享链接复制失败'
                        : '复制带安装引导的分享链接'
                  }
                  title={
                    shareCopy.copyFeedback.state === 'failed'
                      ? `复制失败：${shareCopy.copyFeedback.reason}`
                      : '复制带安装引导的分享链接（自动生成站内短链）'
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-border/70 bg-background/70 hover:bg-muted text-foreground transition-all"
                >
                  <Share2 className="w-4 h-4 text-primary" />
                  <span>
                    {shareCopy.copyFeedback.state === 'copied'
                      ? '已复制'
                      : shareCopy.copyFeedback.state === 'failed'
                        ? '复制失败'
                        : '分享'}
                  </span>
                  <span role="status" className="sr-only">
                    {shareCopy.copyFeedback.reason ?? ''}
                  </span>
                </button>

                {plugin.isOwner && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setStudioModalOpen(true)}
                      className="h-[34px] gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/5"
                    >
                      <Sparkles className="w-4 h-4" />
                      AI 工坊升级
                    </Button>
                    <Button asChild size="sm" variant="outline" className="h-[34px] gap-1.5 text-xs">
                      <Link href={`/marketplace/publish?from=${encodeURIComponent(plugin.slug)}`}>
                        <Upload className="w-4 h-4 text-primary" />
                        手动发版本
                      </Link>
                    </Button>
                  </>
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
            className="flex items-center gap-2 border-b border-border/60 pb-2 overflow-x-auto no-scrollbar touch-pan-x"
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
        <DetailTabPanels
          activeTab={activeTab}
          plugin={plugin!}
          summary={summary}
          bundleTotals={bundleTotals}
          payload={payload}
          rawCopy={rawCopy}
          handleCopyRaw={handleCopyRaw}
        />
        </div>

        {/* 相似插件（语义近邻；语义未就绪时不渲染） */}
        <PluginSimilar slug={plugin.slug} />

        <DetailModals
          plugin={plugin!}
          identity={identity}
          loading={loading}
          manifest={manifest}
          modalMode={modalMode}
          installModalOpen={installModalOpen}
          setInstallModalOpen={setInstallModalOpen}
          reportModalOpen={reportModalOpen}
          setReportModalOpen={setReportModalOpen}
          badgeModalOpen={badgeModalOpen}
          setBadgeModalOpen={setBadgeModalOpen}
          badgeMetric={badgeMetric}
          setBadgeMetric={setBadgeMetric}
          auditModalOpen={auditModalOpen}
          setAuditModalOpen={setAuditModalOpen}
          auditReport={auditReport}
          studioModalOpen={studioModalOpen}
          setStudioModalOpen={setStudioModalOpen}
          loadDetail={() => void loadDetail()}
        />

        {/* 底部导航 */}
        <Footer />
      </div>
    </Container>
  )
}
