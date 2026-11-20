'use client'

/**
 * 用户中心顶部快捷外观切换器（浅色 / 深色 / 跟随系统）。
 *
 * 走站点统一的 next-themes，避免在 /me 页面还要退回首页切深浅模式；
 * 使用 useSyncExternalStore 判断客户端水合完成，避免 SSR 闪烁与 set-state-in-effect 告警。
 */
import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

const THEME_MODES = [
  { id: 'light', label: '浅色', icon: Sun },
  { id: 'dark', label: '深色', icon: Moon },
  { id: 'system', label: '自动', icon: Monitor },
] as const

const emptySubscribe = () => () => {}

export function ThemeQuickToggle() {
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )

  const current = mounted ? (theme ?? 'system') : 'system'

  return (
    <div
      role="group"
      aria-label="切换界面外观"
      className="inline-flex h-8 w-full items-center rounded-lg border border-border-strong bg-background/80 p-0.5 sm:w-auto"
    >
      {THEME_MODES.map(({ id, label, icon: Icon }) => {
        const active = mounted && current === id
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => setTheme(id)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:flex-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              active
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
