'use client'

/**
 * 长辈模式开关：一键适老（特大字 + 宽松间距 + 44px 触控目标 + 隐藏连胜条），
 * 与字号、密度切换并排在工具栏。状态只存本机 localStorage
 *（lib/elder-mode），关闭后恢复之前的字号；开着期间手动改过的字号会保留。
 */

import React from 'react'
import { Accessibility } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  ELDER_MODE_LABEL,
  loadElderMode,
  setElderMode,
} from '@/lib/elder-mode'

export function ElderModeToggle({ className }: { className?: string }) {
  const [on, setOn] = React.useState(false)

  React.useEffect(() => {
    setOn(loadElderMode(window.localStorage))
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ on?: boolean }>).detail
      if (typeof detail?.on === 'boolean') setOn(detail.on)
    }
    window.addEventListener('navhub:elder-mode-changed', sync)
    return () => window.removeEventListener('navhub:elder-mode-changed', sync)
  }, [])

  const toggle = () => {
    setOn(setElderMode(!on, window.localStorage))
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-pressed={on}
      className={`h-11 w-11 rounded-lg transition-colors hover:bg-muted/60 ${
        on ? 'bg-primary/10 text-primary hover:text-primary' : 'text-muted-foreground hover:text-foreground'
      } ${className || ''}`}
      title={on ? ELDER_MODE_LABEL.on : `${ELDER_MODE_LABEL.off}：${ELDER_MODE_LABEL.hint}`}
      aria-label={on ? ELDER_MODE_LABEL.on : ELDER_MODE_LABEL.off}
    >
      <Accessibility className="h-4 w-4" />
    </Button>
  )
}
