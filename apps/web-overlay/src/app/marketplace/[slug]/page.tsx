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
import {
  fetchPluginDetail,
  starPlugin,
  unstarPlugin,
  type HubPluginItem,
} from '@/lib/navhub-api'
import {
  pluginKindLabel,
  PLUGIN_MANIFEST_FILE_SUFFIX,
  comparePluginVersions,
} from '@/lib/plugins/plugin-manifest'
import { resolveInstallAction } from '@/lib/plugins/install-state'
import { PluginInstallModal } from '@/components/plugins/plugin-install-modal'
import { PluginReportModal } from '@/components/plugins/plugin-report-modal'
import { PluginDiffView } from '@/components/plugins/plugin-diff-view'
import { getIdentity } from '@/lib/identity'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { useModularLayout } from '@/lib/modular/use-modular-layout'
import { setActiveTheme, resetTheme, getActiveTheme } from '@/lib/plugins/theme-runtime'
import { copyText } from '@/lib/clipboard'
import { Badge } from '@/components/ui/badge'
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
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

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

  // 星标状态
  const [starred, setStarred] = useState(false)
  const [starCount, setStarCount] = useState(0)
  const [starLoading, setStarLoading] = useState(false)

  // 选项卡切换
  const [activeTab, setActiveTab] = useState<'preview' | 'diff' | 'impact' | 'raw'>('preview')

  // 工作台预设注入钩子
  const { installWidgetPreset } = useModularLayout()

  // 主题试用状态
  const [isThemeApplied, setIsThemeApplied] = useState(false)

  // D1 更新链路：解析「安装 / 更新 / 已安装」动作（已安装版本 < 市场版本 → 可更新）
  const installAction = plugin ? resolveInstallAction(plugin.installedVersion, plugin.version) : 'install'

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
    const link = `${window.location.origin}/marketplace/${encodeURIComponent(slug)}?install=1`
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

  const handleToggleThemeLive = () => {
    if (!plugin || plugin.kind !== 'theme') return
    if (isThemeApplied) {
      resetTheme()
      setIsThemeApplied(false)
      toast.info('已恢复系统默认主题')
    } else {
      const payload = plugin.manifest.payload
      setActiveTheme({
        slug: plugin.slug,
        name: plugin.name,
        tokens: payload.tokens,
        accent: payload.accent,
      })
      setIsThemeApplied(true)
      toast.success(`已实时应用「${plugin.name}」主题！`)
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
                    plugin.kind === 'theme' && 'text-violet-600 dark:text-violet-400 bg-violet-500/5'
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
                    作者: <strong className="text-foreground font-medium">{plugin.author}</strong>
                  </span>
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleStarToggle}
                  disabled={starLoading}
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
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-border/70 bg-background/70 hover:bg-muted text-foreground transition-all"
                  title="复制带安装引导的分享链接（?install=1）"
                >
                  <Share2 className="w-4 h-4 text-primary" />
                  <span>分享</span>
                </button>
              </div>

              {/* 安装 / 更新 / 卸载主要按钮 */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                {plugin.installed ? (
                  installAction === 'update' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setModalMode('upgrade')
                          setInstallModalOpen(true)
                        }}
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 active:scale-95 transition-all shadow-sm"
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
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 active:scale-95 transition-all shadow-sm"
                  >
                    <Download className="w-4 h-4" />
                    <span>立即安装该插件</span>
                  </button>
                )}
              </div>

              {/* 主题插件独享：零刷新实时试用 */}
              {plugin.kind === 'theme' && (
                <button
                  type="button"
                  onClick={handleToggleThemeLive}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-violet-500/30 bg-violet-500/5 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 transition-all"
                >
                  <Palette className="w-3.5 h-3.5" />
                  <span>{isThemeApplied ? '恢复原主题' : '实时预览试用'}</span>
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
                  onClick={() => setActiveTab('diff')}
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
          <div className="flex items-center gap-2 border-b border-border/60 pb-2">
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-medium transition-all',
                activeTab === 'preview'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              内容明细与预览
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('diff')}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-medium transition-all inline-flex items-center gap-1.5',
                activeTab === 'diff'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              <span>版本差异对比</span>
              {installAction === 'update' && (
                <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-amber-500 text-white font-bold">
                  新
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('impact')}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-medium transition-all',
                activeTab === 'impact'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              影响评估与指标
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('raw')}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-medium transition-all',
                activeTab === 'raw'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              清单源码 (JSON)
            </button>
          </div>

          {/* 选项卡 1：内容明细与预览 */}
          {activeTab === 'preview' && (
            <div className="space-y-6">
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
            </div>
          )}

          {/* 选项卡：版本变更对比 */}
          {activeTab === 'diff' && (
            <div className="rounded-3xl border border-border/80 glass-surface p-6 sm:p-8 space-y-4 shadow-xs">
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
            <div className="rounded-2xl border border-border/70 bg-card/60 p-6 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">安装影响评估</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
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
              </div>

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
            <div className="relative rounded-2xl border border-border/70 bg-card/60 p-4 space-y-2">
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
        </div>

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

        {/* 底部导航 */}
        <Footer />
      </div>
    </Container>
  )
}
