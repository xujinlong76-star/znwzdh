'use client'

/**
 * 字号切换（标准 / 大字 / 特大）：给年长与视力弱用户的大字模式入口，
 * 与主题、密度切换并排在工具栏。选择存本机 localStorage 并即时改
 * <html> font-size；刷新后的首屏值由 layout 的水合前脚本负责，
 * 两边共用 lib/font-size 的同一份档位表，不存在第二份真相。
 */

import React from 'react'
import { ALargeSmall, CaseSensitive, Type } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/registry/new-york/ui/dropdown-menu'
import {
  FONT_SIZE_LABEL,
  FONT_SIZE_STORAGE_KEY,
  applyFontSizeLevel,
  loadFontSizeLevel,
  type FontSizeLevel,
} from '@/lib/font-size'

const ITEMS: Array<{ id: FontSizeLevel; desc: string; icon: React.ReactNode }> = [
  { id: 'standard', desc: '16px · 默认排版', icon: <Type className="h-4 w-4" /> },
  { id: 'large', desc: '18px · 看得更清楚', icon: <ALargeSmall className="h-4 w-4 text-primary" /> },
  { id: 'xlarge', desc: '20px · 给视力弱与年长用户', icon: <CaseSensitive className="h-4 w-4 text-indigo-500" /> },
]

export function FontSizeToggle({ className }: { className?: string }) {
  const [level, setLevel] = React.useState<FontSizeLevel>('standard')

  React.useEffect(() => {
    setLevel(loadFontSizeLevel(window.localStorage))
  }, [])

  const choose = (next: FontSizeLevel) => {
    setLevel(next)
    applyFontSizeLevel(next, document.documentElement)
    try {
      window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, next)
    } catch {
      /* 写不进本机存储时本次会话内仍生效 */
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`h-8.5 w-8.5 rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground ${className || ''}`}
          title={`当前字号：${FONT_SIZE_LABEL[level]}（点击切换）`}
          aria-label={`字号切换：当前为${FONT_SIZE_LABEL[level]}`}
        >
          <ALargeSmall className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground">字号大小</DropdownMenuLabel>
        {ITEMS.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onClick={() => choose(item.id)}
            className="flex cursor-pointer items-start gap-2 py-2"
            aria-current={level === item.id || undefined}
          >
            <span className="mt-0.5 shrink-0">{item.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                {FONT_SIZE_LABEL[item.id]}
                {level === item.id ? ' · 当前' : ''}
              </span>
              <span className="block text-xs text-muted-foreground">{item.desc}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
