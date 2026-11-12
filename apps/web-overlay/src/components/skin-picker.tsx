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
import { isThemeIconUrl } from '@/lib/theme-icon'
import { useToast } from '@/components/ui/use-toast'

/**
 * 主题 icon 可能是 emoji，也可能是图片 URL（种子/市场数据两种都出现过）。
 * URL（http/https、/-开头路径、data:image）渲染 <img>，其余当文字渲染；
 * 直接把 URL 当文本画出来会露出一串链接，既难看也占不下菜单行。
 * 判定逻辑在 lib/theme-icon.ts（纯函数，node 测试直接 import）；
 * 这里 re-export 供旧调用方用。
 */
export { isThemeIconUrl } from '@/lib/theme-icon'

export function SkinPicker({ className }: { className?: string }) {
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [themes, setThemes] = React.useState<HubPluginItem[]>([])
  const [installed, setInstalled] = React.useState<Set<string>>(new Set())
  // 已装列表是否可信：取已装列表那路降级时，fetchInstalledPlugins 回的是
  // 空回退——空集不可信，不能拿它把已装皮肤标成「未安装，点击安装并启用」。
  const [installedUnknown, setInstalledUnknown] = React.useState(false)
  const [active, setActive] = React.useState<ActiveThemeConfig | null>(null)
  const [suspended, setSuspended] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [applying, setApplying] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  // 图标 URL 已死（onError）：按 slug 记，坏掉的改画 🎨，不留破图框
  const [brokenIcons, setBrokenIcons] = React.useState<Set<string>>(new Set())
  // 菜单可能在应用中途被关掉：失败只画在菜单里就会丢，关了就 toast 补发
  const openRef = React.useRef(false)
  React.useEffect(() => {
    openRef.current = open
  }, [open])

  const syncActive = React.useCallback(() => {
    setActive(getActiveTheme())
    setSuspended(isThemeSuspended())
  }, [])

  const load = React.useCallback(async () => {
    if (loaded || loading) return
    setLoading(true)
    setLoadFailed(false)
    setInstalledUnknown(false)
    // 降级回调只在当次请求里记本地旗标：setLoadFailed 是异步 state，
    // await 之后读不到本次是否降级；只看 state 会把降级空回退当成功、
    // 置 loaded(true)，之后重开菜单再也不重试。
    let listDegraded = false
    let installedDegraded = false
    try {
      const [list, installedRes] = await Promise.all([
        fetchPlugins({ kind: 'theme', limit: 50 }, () => {
          listDegraded = true
          setLoadFailed(true)
        }),
        fetchInstalledPlugins(undefined, () => {
          installedDegraded = true
          setLoadFailed(true)
        }),
      ])
      setThemes(list.items.filter((item) => item.kind === 'theme' && item.status === 'published'))
      if (installedDegraded) {
        // 已装列表是降级空回退：不拿空集覆盖 installed（会误标未安装），
        // 只立 unknown 旗标，渲染时对这批主题说「安装状态未知」。
        setInstalledUnknown(true)
      } else {
        setInstalled(new Set(installedRes.items.filter((item) => item.kind === 'theme').map((item) => item.slug)))
      }
      // 只有两路都真正成功才算 loaded：降级那次不缓存成功态，
      // 下次打开菜单重新拉取（菜单里也有「重试」入口）。
      if (!listDegraded && !installedDegraded) {
        setLoaded(true)
      } else {
        setLoadFailed(true)
      }
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

  // 应用失败时菜单若已关（用户中途关了菜单），错误只画在菜单里就会丢：
  // 关了就 toast 补发，失败永远可见。
  const notifyFailureIfMenuClosed = React.useCallback(
    (message: string) => {
      if (!openRef.current) {
        toast({ title: '皮肤应用失败', description: message, variant: 'destructive' })
      }
    },
    [toast],
  )

  const choose = async (slug: string) => {
    setError(null)
    if (!slug) {
      try {
        resetTheme()
      } catch (err) {
        const message = `恢复系统默认失败：${err instanceof Error ? err.message : String(err)}`
        setError(message)
        notifyFailureIfMenuClosed(message)
        return
      }
      syncActive()
      toast({ title: '已恢复系统默认皮肤', description: '跟随明暗模式，不套用主题色板。' })
      // 立即生效的操作直接关菜单；需要走网络的分支见下：成功才关，
      // 失败留着菜单，让错误文案可见。
      setOpen(false)
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
        notifyFailureIfMenuClosed('无法启用皮肤：未能加载清单配置')
        return
      }
      const target = themes.find((t: HubPluginItem) => t.slug === slug)
      const name = target?.name ?? detail.plugin.name
      setActiveTheme({
        slug,
        name,
        tokens: payload.tokens,
        accent: payload.accent,
      })
      syncActive()
      toast({ title: '皮肤已应用', description: `已启用「${name}」。` })
      setOpen(false)
    } catch (err) {
      const message = `皮肤应用失败：${err instanceof Error ? err.message : String(err)}`
      setError(message)
      notifyFailureIfMenuClosed(message)
    } finally {
      // 成功与失败都要清掉 applying：失败时不清会把全部菜单项
      // 永久 disabled，错误文案在、按钮全死，用户只能关菜单重进。
      setApplying(null)
    }
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next: boolean) => {
        setOpen(next)
        if (next) void load()
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={applying !== null}
          className={`h-8.5 w-8.5 rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground ${className || ''}`}
          title={`皮肤：当前为${active?.name ?? '系统默认'}${suspended ? '（深色模式下暂停，回到浅色自动恢复）' : ''}（点击切换）`}
          aria-label={`皮肤切换：当前为${active?.name ?? '系统默认'}`}
        >
          <Palette className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          皮肤（成套主题，{themes.length > 0 ? `${themes.length} 套` : loaded ? '暂无皮肤' : '从插件市场读取'}）
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(event) => {
            // 阻止 Radix 默认的点选即关菜单：应用中的反馈（正在应用…/错误）
            // 都画在菜单里，关了就看不见；choose 成功后自己关菜单。
            event.preventDefault()
            void choose('')
          }}
          disabled={applying !== null}
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
        {loadFailed && !loading && (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              void load()
            }}
            className="cursor-pointer text-xs text-primary"
          >
            ↻ 重试加载皮肤列表
          </DropdownMenuItem>
        )}
        {themes.map((theme: HubPluginItem) => {
          const isActive = active?.slug === theme.slug
          const isInstalled = installed.has(theme.slug)
          return (
            <DropdownMenuItem
              key={theme.slug}
              onSelect={(event) => {
                // 同默认项：点选不关菜单，正在应用…留在菜单里可见，
                // 成功后 choose 自己关菜单，失败则留着菜单显示错误。
                event.preventDefault()
                void choose(theme.slug)
              }}
              disabled={applying !== null}
              className="flex cursor-pointer items-center gap-2 py-2"
              aria-current={isActive || undefined}
            >
              {isThemeIconUrl(theme.icon) && !brokenIcons.has(theme.slug) ? (
                <img
                  src={theme.icon}
                  alt=""
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 rounded object-cover"
                  onError={() =>
                    setBrokenIcons((prev) => {
                      if (prev.has(theme.slug)) return prev
                      const next = new Set(prev)
                      next.add(theme.slug)
                      return next
                    })
                  }
                />
              ) : (
                <span className="shrink-0 text-base leading-none" aria-hidden>
                  {isThemeIconUrl(theme.icon) ? '🎨' : (theme.icon ?? '🎨')}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {theme.name}
                  {isActive ? ' · 当前' : ''}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {applying === theme.slug
                    ? '正在应用…'
                    : installedUnknown
                      ? '安装状态未知'
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
          <DropdownMenuItem disabled className="text-xs text-destructive-text">
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
