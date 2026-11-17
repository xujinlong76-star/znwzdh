'use client'

/**
 * 已安装插件管家中心 (/marketplace/installed)
 *
 * 核心功能：
 * 1. 全形态分类聚合：支持按全部、主题、搜索引擎包、网址包、工作台预设分类速览；
 * 2. 多主题一键切换器：直观列出已安装主题，即时水合/激活切换或一键恢复默认系统主题；
 * 3. 搜索引擎直达总览：展示已注册的 !前缀（!gh, !npm, !mdn 等）及目标搜索端点；
 * 4. 插件平滑升级与卸载：版本比对、一键升级、带来源清理的安全卸载。
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { failureDescription } from '@/lib/failure-guidance'
import { safeWindowOpen } from '@/lib/safe-url'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import {
  fetchInstalledPlugins,
  uninstallPlugin,
  installPlugin,
  disablePlugin,
  enablePlugin,
  fetchPluginDetail,
  type HubPluginInstalledItem,
} from '@/lib/navhub-api'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { MarketplaceLoadError } from '@/components/marketplace-load-error'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { getIdentity } from '@/lib/identity'
import {
  getActiveTheme,
  isThemeSuspended,
  setActiveTheme,
  resetTheme,
  type ActiveThemeConfig,
} from '@/lib/plugins/theme-runtime'
import {
  getAllSearchEngines,
  registerSearchPackEngines,
  unregisterSearchPackEngines,
  type InstalledSearchEngine,
} from '@/lib/plugins/search-pack-runtime'
import { comparePluginVersions } from '@/lib/plugins/plugin-manifest'
import {
  ArrowLeft,
  Boxes,
  Check,
  ExternalLink,
  FolderKanban,
  LayoutDashboard,
  Loader2,
  PackageCheck,
  Palette,
  Pause,
  Play,
  RefreshCw,
  Search,
  Store,
  Trash2,
} from 'lucide-react'

type KindTab = 'all' | 'theme' | 'search-pack' | 'site-pack' | 'workspace-preset' | 'bundle'

export default function InstalledPluginsPage() {
  const [items, setItems] = useState<HubPluginInstalledItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<KindTab>('all')
  const [activeThemeState, setActiveThemeState] = useState<ActiveThemeConfig | null>(null)
  const [themeSuspended, setThemeSuspended] = useState(false)
  const [searchEngines, setSearchEngines] = useState<InstalledSearchEngine[]>([])
  const [upgradingSlug, setUpgradingSlug] = useState<string | null>(null)
  const [uninstallingSlug, setUninstallingSlug] = useState<string | null>(null)
  const [togglingSlug, setTogglingSlug] = useState<string | null>(null)
  // K2：主题「启用」与升级/停用同款 *Slug 守卫，防重复点击
  const [activatingThemeSlug, setActivatingThemeSlug] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  // K6：横幅常驻到用户关闭；失败时附带重试回调，横幅内给「重试」按钮
  const [actionRetry, setActionRetry] = useState<(() => void) | null>(null)

  /** 横幅写入：成功/失败都常驻（不自动消失），失败可附重试回调。 */
  const showActionMessage = (message: string, retry?: () => void) => {
    setActionMessage(message)
    setActionRetry(retry ? () => retry : null)
  }

  const dismissActionMessage = () => {
    setActionMessage(null)
    setActionRetry(null)
  }
  // 加载失败 ≠ 没装插件：fetchInstalledPlugins 失败时回落空列表并触发
  // onDegraded（L93 旧注释的说法已过期）；渲染用 notice && items.length === 0
  // 走失败态（带重试），不用空态断言。loadData 同理：失败时不拿空兜底覆盖
  // 已有列表（操作后重载失败也不清空）。
  const [notice, setNotice] = useState<DegradeNotice | null>(null)

  // 整页失败态（首载失败且无列表可保留）：分类栏的「全部 (0)」是假零，随失败态一起隐藏。
  const loadFailed = notice !== null && items.length === 0

  const loadData = useCallback(async () => {
    setLoading(true)
    setNotice(null)
    try {
      const identity = getIdentity()
      let failed = false
      const res = await fetchInstalledPlugins(identity, (err) => {
        failed = true
        setNotice(describeDegrade(err, '已安装插件'))
      })
      // 失败时 res 是空兜底：不写进 state（已有列表保留、只亮横幅；首载失败
      // 则 items 仍为空、由 loadFailed 失败态接管，绝不渲染成「尚未安装」）。
      if (!failed) {
        setItems(res.items)
        setActiveThemeState(getActiveTheme())
        setThemeSuspended(isThemeSuspended())
        setSearchEngines(getAllSearchEngines())
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()

    const onThemeChange = () => {
      setActiveThemeState(getActiveTheme())
      setThemeSuspended(isThemeSuspended())
    }
    const onSearchChange = () => setSearchEngines(getAllSearchEngines())
    window.addEventListener('navhub_theme_changed', onThemeChange)
    window.addEventListener('navhub_search_engines_changed', onSearchChange)
    return () => {
      window.removeEventListener('navhub_theme_changed', onThemeChange)
      window.removeEventListener('navhub_search_engines_changed', onSearchChange)
    }
  }, [loadData])

  const handleActivateTheme = async (item: HubPluginInstalledItem) => {
    if (activatingThemeSlug === item.slug) return
    setActivatingThemeSlug(item.slug)
    try {
      const detail = await fetchPluginDetail(item.slug)
      if (!detail?.plugin?.manifest?.payload) {
        showActionMessage(
          '无法激活主题：未能加载清单配置，请稍后重试。',
          () => void handleActivateTheme(item),
        )
        return
      }
      const payload = detail.plugin.manifest.payload
      setActiveTheme({
        slug: item.slug,
        name: item.name,
        tokens: payload.tokens,
        accent: payload.accent,
      })
      setActiveThemeState(getActiveTheme())
      setThemeSuspended(isThemeSuspended())
      // 深色模式下主题只保存不注入：别谎称已启用，明说暂停、回浅色自动恢复
      showActionMessage(
        isThemeSuspended()
          ? `已保存主题「${item.name}」，深色模式下暂停，回到浅色自动恢复`
          : `已成功启用主题「${item.name}」`
      )
    } catch (err) {
      showActionMessage(`主题应用失败：${failureDescription(err)}`, () => void handleActivateTheme(item))
    } finally {
      setActivatingThemeSlug(null)
    }
  }

  const handleResetTheme = () => {
    resetTheme()
    setActiveThemeState(null)
    setThemeSuspended(false)
    showActionMessage('已恢复系统默认主题')
  }

  const handleUpgrade = async (item: HubPluginInstalledItem) => {
    setUpgradingSlug(item.slug)
    try {
      const wasActiveTheme = item.kind === 'theme' && activeThemeState?.slug === item.slug
      await installPlugin(item.slug)

      // 已停用的插件只升版本、不恢复运行效果：升级不能悄悄替用户重新启用。
      if (item.disabled) {
        showActionMessage(`插件已升级至最新版本（仍处于停用状态）`)
        await loadData()
        return
      }

      // 正在生效的主题升级后要立即把新 token 应用到运行时，
      // 否则服务端已是新版本、页面仍停留在旧配色，形成「升级了但没生效」。
      if (wasActiveTheme) {
        const detail = await fetchPluginDetail(item.slug)
        const payload = detail?.plugin?.manifest?.payload
        if (payload) {
          setActiveTheme({
            slug: item.slug,
            name: detail?.plugin?.name || item.name,
            tokens: payload.tokens,
            accent: payload.accent,
          })
          setActiveThemeState(getActiveTheme())
          setThemeSuspended(isThemeSuspended())
        }
      }

      // 搜索引擎包升级：前缀 / 检索 URL 可能变化，重新注册运行时直达
      if (item.kind === 'search-pack') {
        const detail = await fetchPluginDetail(item.slug)
        const engines = detail?.plugin?.manifest?.payload?.engines
        if (engines) registerSearchPackEngines(item.slug, engines)
      }

      showActionMessage(`插件已成功升级至最新版本`)
      await loadData()
    } catch (err) {
      showActionMessage(`升级失败：${failureDescription(err)}`, () => void handleUpgrade(item))
    } finally {
      setUpgradingSlug(null)
    }
  }

  const handleUninstall = async (item: HubPluginInstalledItem) => {
    const removeSites = item.kind === 'site-pack'
    const message = removeSites
      ? `确定要卸载插件「${item.name}」吗？\n\n该插件导入的站点会一并软删除（可在回收站恢复）。`
      : `确定要卸载插件「${item.name}」吗？`
    if (!confirm(message)) return
    setUninstallingSlug(item.slug)
    try {
      await uninstallPlugin(item.slug, undefined, removeSites)
      if (item.kind === 'theme' && activeThemeState?.slug === item.slug) {
        resetTheme()
      }
      if (item.kind === 'search-pack') {
        unregisterSearchPackEngines(item.slug)
      }
      showActionMessage(`已成功卸载插件「${item.name}」，关联站点与分类已同步清理`)
      await loadData()
    } catch (err) {
      showActionMessage(`卸载失败：${failureDescription(err)}`, () => void handleUninstall(item))
    } finally {
      setUninstallingSlug(null)
    }
  }

  /**
   * 禁用开关（D 批）：只停运行效果，不删数据、不降版本、不必卸载。
   * 按 kind 如实区分：主题回落默认、搜索引擎注销注册（与卸载同机制）；
   * 网址包/工作台已导入的站点与看板保留原处（已是公共收录或用户数据，
   * 单用户禁用不能替别人删数据），禁用只停后续效果。
   */
  const handleDisable = async (item: HubPluginInstalledItem) => {
    setTogglingSlug(item.slug)
    try {
      await disablePlugin(item.slug)
      if (item.kind === 'theme' && activeThemeState?.slug === item.slug) {
        resetTheme()
      }
      if (item.kind === 'search-pack') {
        unregisterSearchPackEngines(item.slug)
      }
      // K15：停用成功走 toast + 5 秒内「撤销」一键重新启用，不再只留横幅
      toast.success(`已停用「${item.name}」`, {
        duration: 5000,
        action: { label: '撤销', onClick: () => void handleEnable(item) },
      })
      await loadData()
    } catch (err) {
      showActionMessage(`停用失败：${failureDescription(err)}`, () => void handleDisable(item))
    } finally {
      setTogglingSlug(null)
    }
  }

  /** 启用已停用的插件（D 批）：与禁用对称；主题激活仍是显式动作（调色板里点启用）。 */
  const handleEnable = async (item: HubPluginInstalledItem) => {
    setTogglingSlug(item.slug)
    try {
      await enablePlugin(item.slug)
      // 搜索引擎包重新启用：按当前清单重新注册运行时直达
      if (item.kind === 'search-pack') {
        const detail = await fetchPluginDetail(item.slug)
        const engines = detail?.plugin?.manifest?.payload?.engines
        if (engines) registerSearchPackEngines(item.slug, engines)
      }
      showActionMessage(`已重新启用「${item.name}」`)
      await loadData()
    } catch (err) {
      showActionMessage(`启用失败：${failureDescription(err)}`, () => void handleEnable(item))
    } finally {
      setTogglingSlug(null)
    }
  }

  const hasUpdate = (item: HubPluginInstalledItem) =>
    Boolean(
      item.version &&
        item.installedVersion &&
        comparePluginVersions(item.version, item.installedVersion) > 0,
    )

  const updateCount = items.filter(hasUpdate).length

  // 有更新的插件置顶，其余保持后端顺序；不能用字符串不等判断版本，
  // 否则服务端回滚或预发布版本会被误标为「可升级」。
  const filteredItems = items
    .filter((item) => activeTab === 'all' || item.kind === activeTab)
    .sort((a, b) => Number(hasUpdate(b)) - Number(hasUpdate(a)))

  const themeItems = items.filter((i) => i.kind === 'theme')

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 space-y-6">
        {/* 顶部展板 */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero p-4 sm:p-7 shadow-xs">
          <div className="flex items-center gap-2 mb-3">
            <Link
              href="/marketplace"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回市场</span>
            </Link>
            <span className="text-border">/</span>
            <span className="text-xs text-primary font-medium flex items-center gap-1">
              <PackageCheck className="w-3.5 h-3.5" />
              已安装管家
            </span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                已安装插件管家
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-2xl">
                管理当前设备与账号已安装的所有扩展。支持多套主题一键切换、快捷前缀直达语法速查、待更新插件平滑升级与彻底清理。
              </p>
              {updateCount > 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-2">
                  有 {updateCount} 个插件可升级，已置顶显示。
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                <Link href="/marketplace">
                  <Store className="w-3.5 h-3.5" />
                  浏览插件市场
                </Link>
              </Button>
            </div>
          </div>
        </div>

        {/* 提示消息（K6/K9）：常驻到用户关闭；失败时横幅内给「重试」；读屏可收 */}
        {actionMessage && (
          <div
            role="status"
            className="p-3 text-sm rounded-lg border border-primary/30 bg-primary/10 text-primary flex items-center justify-between gap-3 animate-in fade-in"
          >
            <span>{actionMessage}</span>
            <span className="flex items-center gap-2 shrink-0">
              {actionRetry && (
                <button
                  onClick={() => {
                    const retry = actionRetry
                    dismissActionMessage()
                    retry()
                  }}
                  className="text-xs font-medium underline underline-offset-2 hover:opacity-80"
                >
                  重试
                </button>
              )}
              <button
                onClick={dismissActionMessage}
                className="text-xs opacity-70 hover:opacity-100"
              >
                关闭
              </button>
            </span>
          </div>
        )}

        {/* 刷新失败但本地已有列表时：保留旧列表，只在顶部给失败提示（带重试） */}
        {notice && items.length > 0 && (
          <HubDegradedNotice notice={notice} onRetry={() => void loadData()} />
        )}

        {/* 主题快速切换中心（仅当安装了主题插件时展示） */}
        {themeItems.length > 0 && (
          <div className="p-5 rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xs space-y-4 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Palette className="w-4 h-4 text-primary" />
                <h2 className="text-base font-semibold text-foreground">主题调色板与外观切换器</h2>
              </div>
              {activeThemeState && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleResetTheme}
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                >
                  恢复系统默认主题
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {themeItems.map((theme) => {
                const isActive = activeThemeState?.slug === theme.slug
                return (
                  <div
                    key={theme.slug}
                    className={`p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                      isActive
                        ? 'border-primary bg-primary/10 shadow-xs'
                        : 'border-border/60 bg-background/50 hover:border-border'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold truncate text-foreground">
                          {theme.name}
                        </span>
                        {isActive && !themeSuspended && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-primary text-primary-foreground leading-none">
                            生效中
                          </span>
                        )}
                        {isActive && themeSuspended && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-muted text-muted-foreground leading-none">
                            深色模式已暂停
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {theme.description}
                      </p>
                    </div>
                    {isActive ? (
                      <span className="shrink-0 text-primary p-1">
                        <Check className="w-4 h-4" />
                      </span>
                    ) : theme.disabled ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={togglingSlug === theme.slug}
                        onClick={() => void handleEnable(theme)}
                        className="h-7 text-xs shrink-0"
                        title="插件已停用，先恢复启用再切换主题"
                      >
                        {togglingSlug === theme.slug && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                        )}
                        重新启用
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={activatingThemeSlug === theme.slug}
                        onClick={() => void handleActivateTheme(theme)}
                        className="h-7 text-xs shrink-0"
                      >
                        {activatingThemeSlug === theme.slug && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                        )}
                        启用
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 搜索引擎快捷前缀速查看板 */}
        {searchEngines.length > 0 && (
          <div className="p-5 rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xs space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-primary" />
                <h2 className="text-base font-semibold text-foreground">已启用的主搜索框快捷直达引擎</h2>
              </div>
              <span className="text-xs text-muted-foreground">在搜索框输入对应前缀秒级直达</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {searchEngines.map((eng) => (
                <button
                  type="button"
                  key={eng.prefix}
                  onClick={() => safeWindowOpen(eng.searchUrl.replace('{q}', ''))}
                  className="p-2.5 rounded-lg border border-border/60 bg-background/60 hover:bg-muted/70 hover:border-primary/40 cursor-pointer transition-all flex flex-col gap-1 group text-left"
                  title={`${eng.description ?? eng.name} (点击直达)`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      {eng.prefix}
                    </span>
                    <ExternalLink className="w-3 h-3 text-muted-foreground opacity-40 group-hover:opacity-100" />
                  </div>
                  <span className="text-xs font-medium text-foreground truncate mt-1">
                    {eng.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 分类标签栏：整页失败态时「全部 (0)」是假零，随失败态一起隐藏 */}
        {!loadFailed && (
          <div className="flex items-center gap-1.5 border-b border-border/60 pb-2 overflow-x-auto no-scrollbar touch-pan-x">
          {(
            [
              { key: 'all', label: `全部 (${items.length})` },
              { key: 'site-pack', label: '网址包', icon: FolderKanban },
              { key: 'theme', label: '主题', icon: Palette },
              { key: 'search-pack', label: '搜索引擎包', icon: Search },
              { key: 'bundle', label: '组合包', icon: Boxes },
              { key: 'workspace-preset', label: '工作台', icon: LayoutDashboard },
            ] as const
          ).map((tab) => {
            const isSelected = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {'icon' in tab && <tab.icon className="w-3.5 h-3.5" />}
                {tab.label}
              </button>
            )
          })}
          </div>
        )}

        {/* 已安装列表渲染 */}
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-3" />
            正在加载已安装插件清单…
          </div>
        ) : notice && items.length === 0 ? (
          <MarketplaceLoadError
            title="已安装插件加载失败"
            notice={notice}
            detail="未能加载已安装插件，可能是网络或中枢服务问题；重试后仍失败请稍后再来。"
            onRetry={() => void loadData()}
          />
        ) : filteredItems.length === 0 ? (
          <div className="py-14 text-center border border-dashed border-border/70 rounded-2xl space-y-3">
            <PackageCheck className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {activeTab === 'all'
                ? '你尚未安装任何插件，前往市场一键开启'
                : '当前分类下没有已安装的插件'}
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/marketplace">探索插件市场</Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map((item) => {
              const itemHasUpdate = hasUpdate(item)
              const isUpgrading = upgradingSlug === item.slug
              const isUninstalling = uninstallingSlug === item.slug
              const isToggling = togglingSlug === item.slug

              return (
                <div
                  key={item.id}
                  className="p-4 rounded-xl border border-border/70 bg-card/80 backdrop-blur-xs flex flex-col justify-between shadow-xs hover:border-border transition-all space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {item.icon ? (
                          <span className="text-2xl shrink-0">{item.icon}</span>
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0">
                            {item.name.slice(0, 1)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <Link
                            href={`/marketplace/${encodeURIComponent(item.slug)}`}
                            className="text-sm font-semibold text-foreground hover:text-primary transition-colors truncate block"
                          >
                            {item.name}
                          </Link>
                          <span className="text-[11px] text-muted-foreground">
                            已安装 v{item.installedVersion}
                            {itemHasUpdate && (
                              <span className="ml-1.5 text-amber-700 dark:text-amber-400 font-medium">
                                · 最新 v{item.version}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded uppercase font-mono font-bold bg-muted text-muted-foreground shrink-0">
                        {item.kind}
                      </span>
                    </div>
                    {item.disabled && (
                      <p className="text-[11px] text-muted-foreground">
                        <span className="px-1.5 py-0.5 rounded bg-muted font-medium">
                          已停用
                        </span>
                        <span className="ml-1.5">运行效果已停止，数据与版本保留</span>
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {item.description}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {itemHasUpdate && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isUpgrading}
                          onClick={() => void handleUpgrade(item)}
                          className="h-7 text-xs gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                        >
                          <RefreshCw className={`w-3 h-3 ${isUpgrading ? 'animate-spin' : ''}`} />
                          升级至 v{item.version}
                        </Button>
                      )}
                      <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                        <Link href={`/marketplace/${encodeURIComponent(item.slug)}`}>
                          查看详情
                        </Link>
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isToggling}
                      onClick={() =>
                        void (item.disabled ? handleEnable(item) : handleDisable(item))
                      }
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                      title={item.disabled ? '重新启用此插件' : '停用此插件（不卸载）'}
                      aria-label={`${item.disabled ? '重新启用插件' : '停用插件'} ${item.name}`}
                    >
                      {isToggling ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : item.disabled ? (
                        <Play className="w-3.5 h-3.5" />
                      ) : (
                        <Pause className="w-3.5 h-3.5" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isUninstalling}
                      onClick={() => void handleUninstall(item)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive-text hover:bg-destructive/15"
                      title="卸载此插件"
                      aria-label={`卸载插件 ${item.name}`}
                    >
                      {isUninstalling ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Container>
  )
}
