'use client'

/**
 * 皮肤选择器：多套成套皮肤一键换，不必进插件市场逐个安装页点。
 *
 * 种子库已有 14 套完整主题（apps/api/src/seed-data/themes*，20 项色板变量
 * 全覆盖），此前日常入口只有设置页的「已安装主题」下拉与已安装管家页——
 * 没装过的皮肤在工具栏根本够不着。本选择器直接读市场主题列表
 *（GET /api/plugins?kind=theme），未安装的点选即「安装并启用」（与
 * 插件安装弹窗同一条 installPlugin 管道，主题装完自动激活），已安装
 * 的直接启用；切换与设置页、管家页共用 lib/plugins/theme-runtime
 * 的同一套函数，不另立真相。
 *
 * 深色模式下主题只保存不注入（theme-runtime 的 B12 守卫）：暂停时明说，
 * 不谎称正在使用。取不到列表时明说并给去市场的链接，不画空菜单。
 */

import React from 'react'
import Link from 'next/link'
import { Check, Palette } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/registry/new-york/ui/dropdown-menu'
import {
  fetchInstalledPlugins,
  fetchPluginDetail,
  fetchPlugins,
  installPlugin,
  type HubPluginItem,
} from '@/lib/navhub-api'
import {
  getActiveTheme,
  isThemeSuspended,
  resetTheme,
  setActiveTheme,
  type ActiveThemeConfig,
} from '@/lib/plugins/theme-runtime'

export function SkinPicker({ className }: { className?: string }) {
  const [themes, setThemes] = React.useState<HubPluginItem[]>([])
  const [installed, setInstalled] = React.useState<Set<string>>(new Set())
  const [active, setActive] = React.useState<ActiveThemeConfig | null>(null)
  const [suspended, setSuspended] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [applying, setApplying] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const syncActive = React.useCallback(() => {
    setActive(getActiveTheme())
    setSuspended(isThemeSuspended())
  }, [])

  const load = React.useCallback(async () => {
    if (loaded || loading) return
    setLoading(true)
    setLoadFailed(false)
    try {
      const [list, installedRes] = await Promise.all([
        fetchPlugins({ kind: 'theme', limit: 50 }, () => setLoadFailed(true)),
        fetchInstalledPlugins(undefined, () => setLoadFailed(true)),
      ])
      setThemes(list.items.filter((item) => item.kind === 'theme' && item.status === 'published'))
      setInstalled(new Set(installedRes.items.filter((item) => item.kind === 'theme').map((item) => item.slug)))
      setLoaded(true)
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [loaded, loading])

  React.useEffect(() => {
    syncActive()
    const onThemeChange = () => syncActive()
    window.addEventListener('navhub_theme_changed', onThemeChange)
    return () => window.removeEventListener('navhub_theme_changed', onThemeChange)
  }, [syncActive])

  const choose = async (slug: string) => {
    setError(null)
    if (!slug) {
      resetTheme()
      syncActive()
      return
    }
    setApplying(slug)
    try {
      if (!installed.has(slug)) {
        await installPlugin(slug)
        setInstalled((prev: Set<string>) => new Set(prev).add(slug))
      }
      const detail = await fetchPluginDetail(slug)
      const payload = detail?.plugin?.manifest?.payload
      if (!payload) {
        setError('无法启用皮肤：未能加载清单配置')
        return
      }
      const target = themes.find((t: HubPluginItem) => t.slug === slug)
      setActiveTheme({
        slug,
        name: target?.name ?? detail.plugin.name,
        tokens: payload.tokens,
        accent: payload.accent,
      })
      syncActive()
    } catch (err) {
      setError(`皮肤应用失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setApplying(null)
    }
  }

  return (
    <DropdownMenu
      onOpenChange={(open: boolean) => {
        if (open) void load()
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`h-8.5 w-8.5 rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground ${className || ''}`}
          title={`皮肤：当前为${active?.name ?? '系统默认'}${suspended ? '（深色模式下暂停，回到浅色自动恢复）' : ''}（点击切换）`}
          aria-label={`皮肤切换：当前为${active?.name ?? '系统默认'}`}
        >
          <Palette className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          皮肤（成套主题，{themes.length > 0 ? `${themes.length} 套` : '从插件市场读取'}）
        </DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => void choose('')}
          className="flex cursor-pointer items-center gap-2 py-2"
          aria-current={!active || undefined}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              系统默认{!active ? ' · 当前' : ''}
            </span>
            <span className="block text-xs text-muted-foreground">跟随明暗模式，不套用主题色板</span>
          </span>
          {!active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {loading && (
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            正在加载皮肤列表…
          </DropdownMenuItem>
        )}
        {loadFailed && themes.length === 0 && (
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            皮肤列表暂时取不到（中枢未连接），稍后再试。
          </DropdownMenuItem>
        )}
        {themes.map((theme: HubPluginItem) => {
          const isActive = active?.slug === theme.slug
          const isInstalled = installed.has(theme.slug)
          return (
            <DropdownMenuItem
              key={theme.slug}
              onClick={() => void choose(theme.slug)}
              disabled={applying !== null}
              className="flex cursor-pointer items-center gap-2 py-2"
              aria-current={isActive || undefined}
            >
              <span className="shrink-0 text-base leading-none" aria-hidden>
                {theme.icon ?? '🎨'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {theme.name}
                  {isActive ? ' · 当前' : ''}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {applying === theme.slug
                    ? '正在应用…'
                    : isInstalled
                      ? '已安装，点击启用'
                      : '未安装，点击安装并启用'}
                  {isActive && suspended ? '（深色模式下暂停）' : ''}
                </span>
              </span>
              {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
            </DropdownMenuItem>
          )
        })}
        {error && (
          <DropdownMenuItem disabled className="text-xs text-destructive">
            {error}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer text-xs text-muted-foreground">
          <Link href="/marketplace?kind=theme">去插件市场查看全部皮肤 →</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
