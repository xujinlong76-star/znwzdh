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
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import {
  fetchInstalledPlugins,
  uninstallPlugin,
  installPlugin,
  fetchPluginDetail,
  type HubPluginInstalledItem,
} from '@/lib/navhub-api'
import { getIdentity } from '@/lib/identity'
import {
  getActiveTheme,
  setActiveTheme,
  resetTheme,
  type ActiveThemeConfig,
} from '@/lib/plugins/theme-runtime'
import {
  getAllSearchEngines,
  type InstalledSearchEngine,
} from '@/lib/plugins/search-pack-runtime'
import {
  ArrowLeft,
  Check,
  ExternalLink,
  FolderKanban,
  LayoutDashboard,
  Loader2,
  PackageCheck,
  Palette,
  RefreshCw,
  Search,
  Store,
  Trash2,
} from 'lucide-react'

type KindTab = 'all' | 'theme' | 'search-pack' | 'site-pack' | 'workspace-preset'

export default function InstalledPluginsPage() {
  const [items, setItems] = useState<HubPluginInstalledItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<KindTab>('all')
  const [activeThemeState, setActiveThemeState] = useState<ActiveThemeConfig | null>(null)
  const [searchEngines, setSearchEngines] = useState<InstalledSearchEngine[]>([])
  const [upgradingSlug, setUpgradingSlug] = useState<string | null>(null)
  const [uninstallingSlug, setUninstallingSlug] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const identity = getIdentity()
      const res = await fetchInstalledPlugins(identity)
      setItems(res.items)
      setActiveThemeState(getActiveTheme())
      setSearchEngines(getAllSearchEngines())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()

    const onThemeChange = () => setActiveThemeState(getActiveTheme())
    const onSearchChange = () => setSearchEngines(getAllSearchEngines())
    window.addEventListener('navhub_theme_changed', onThemeChange)
    window.addEventListener('navhub_search_engines_changed', onSearchChange)
    return () => {
      window.removeEventListener('navhub_theme_changed', onThemeChange)
      window.removeEventListener('navhub_search_engines_changed', onSearchChange)
    }
  }, [loadData])

  const handleActivateTheme = async (item: HubPluginInstalledItem) => {
    try {
      const detail = await fetchPluginDetail(item.slug)
      if (!detail?.plugin?.manifest?.payload) {
        setActionMessage(`无法激活主题：未能加载清单配置`)
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
      setActionMessage(`已成功启用主题「${item.name}」`)
      setTimeout(() => setActionMessage(null), 3000)
    } catch (err) {
      setActionMessage(`主题应用失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleResetTheme = () => {
    resetTheme()
    setActiveThemeState(null)
    setActionMessage('已恢复系统默认主题')
    setTimeout(() => setActionMessage(null), 3000)
  }

  const handleUpgrade = async (slug: string) => {
    setUpgradingSlug(slug)
    try {
      await installPlugin(slug)
      setActionMessage(`插件已成功升级至最新版本`)
      await loadData()
      setTimeout(() => setActionMessage(null), 3000)
    } catch (err) {
      setActionMessage(`升级失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUpgradingSlug(null)
    }
  }

  const handleUninstall = async (item: HubPluginInstalledItem) => {
    if (!confirm(`确定要卸载插件「${item.name}」吗？`)) return
    setUninstallingSlug(item.slug)
    try {
      const removeSites = item.kind === 'site-pack'
      await uninstallPlugin(item.slug, { removeSites })
      if (item.kind === 'theme' && activeThemeState?.slug === item.slug) {
        resetTheme()
      }
      setActionMessage(`已成功卸载插件「${item.name}」`)
      await loadData()
      setTimeout(() => setActionMessage(null), 3000)
    } catch (err) {
      setActionMessage(`卸载失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUninstallingSlug(null)
    }
  }

  const filteredItems = items.filter((item) => {
    if (activeTab === 'all') return true
    return item.kind === activeTab
  })

  const themeItems = items.filter((i) => i.kind === 'theme')

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 space-y-6">
        {/* 顶部展板 */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface subtle-mesh p-6 sm:p-7 shadow-xs">
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

        {/* 提示消息 */}
        {actionMessage && (
          <div className="p-3 text-sm rounded-lg border border-primary/30 bg-primary/10 text-primary flex items-center justify-between animate-in fade-in">
            <span>{actionMessage}</span>
            <button
              onClick={() => setActionMessage(null)}
              className="text-xs opacity-70 hover:opacity-100"
            >
              关闭
            </button>
          </div>
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
                        {isActive && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-primary text-primary-foreground leading-none">
                            生效中
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
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleActivateTheme(theme)}
                        className="h-7 text-xs shrink-0"
                      >
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
                  onClick={() => window.open(eng.searchUrl.replace('{q}', ''), '_blank', 'noopener,noreferrer')}
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

        {/* 分类标签栏 */}
        <div className="flex items-center gap-1.5 border-b border-border/60 pb-2">
          {(
            [
              { key: 'all', label: `全部 (${items.length})` },
              { key: 'site-pack', label: '网址包', icon: FolderKanban },
              { key: 'theme', label: '主题', icon: Palette },
              { key: 'search-pack', label: '搜索引擎包', icon: Search },
              { key: 'workspace-preset', label: '工作台', icon: LayoutDashboard },
            ] as const
          ).map((tab) => {
            const isSelected = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {tab.icon && <tab.icon className="w-3.5 h-3.5" />}
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* 已安装列表渲染 */}
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-3" />
            正在加载已安装插件清单…
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-14 text-center border border-dashed border-border/70 rounded-2xl space-y-3">
            <PackageCheck className="w-8 h-8 mx-auto text-muted-foreground/50" />
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
              const hasUpdate = Boolean(item.version && item.installedVersion && item.version !== item.installedVersion)
              const isUpgrading = upgradingSlug === item.slug
              const isUninstalling = uninstallingSlug === item.slug

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
                          </span>
                        </div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded uppercase font-mono font-bold bg-muted text-muted-foreground shrink-0">
                        {item.kind}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {item.description}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {hasUpdate && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isUpgrading}
                          onClick={() => void handleUpgrade(item.slug)}
                          className="h-7 text-xs gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
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
                      disabled={isUninstalling}
                      onClick={() => void handleUninstall(item)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="卸载此插件"
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
