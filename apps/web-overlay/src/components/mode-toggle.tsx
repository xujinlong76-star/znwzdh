'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/registry/new-york/ui/button'

export function ModeToggle() {
  // 必须用 resolvedTheme 而不是 theme：defaultTheme="system" 时 theme 是 'system'，
  // 系统深色下首次点击会 setTheme('dark')——目标主题和当前一样，看起来就是「点了没反应」
  const { resolvedTheme, setTheme } = useTheme()

  const isDark = resolvedTheme === 'dark'
  const label = isDark ? '切换为浅色主题' : '切换为深色主题'

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={label}
      aria-label={label}
      className="relative h-11 w-11 rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">切换主题</span>
    </Button>
  )
}
