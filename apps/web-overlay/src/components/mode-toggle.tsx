'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/registry/new-york/ui/button'

export function ModeToggle() {
  // 必须用 resolvedTheme 而不是 theme：defaultTheme="system" 时 theme 是 'system'，
  // 系统深色下首次点击会 setTheme('dark')——目标主题和当前一样，看起来就是「点了没反应」
  const { resolvedTheme, setTheme } = useTheme()

  const isDark = resolvedTheme === 'dark'
  const toggleLabel = isDark ? '切换到浅色模式' : '切换到深色模式'

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="h-9 w-9 rounded-full touch-manipulation select-none active:scale-90 transition-all duration-150 hover:bg-accent/80 cursor-pointer"
      title={toggleLabel}
      aria-label={toggleLabel}
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 text-amber-500 transition-all duration-300 dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 text-sky-400 transition-all duration-300 dark:rotate-0 dark:scale-100" />
      <span className="sr-only">切换主题</span>
    </Button>
  )
}
