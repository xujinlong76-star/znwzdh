'use client'

/**
 * 高对比开关：加深文字与边框，服务弱视与年长用户，与字号切换并排在工具栏。
 * 状态只存本机 localStorage（lib/high-contrast，W2 同步新建：存储键
 * navhub.highContrast.v1、事件 navhub:high-contrast-changed、开启落
 * <html data-high-contrast>）；首访无手动值时按 prefers-contrast: more
 * 自动开启，手动值优先——该判定在 lib 层（loadHighContrast），本组件
 * 只读它返回的初值。
 *
 * 关闭态 title 逐字用任务书约定「高对比：加深文字与边框，关闭后恢复」，
 * 不走 LABEL.off 与 LABEL.hint 拼接：W2 的 LABEL.hint 是外观弹窗行副文案
 * 的长版（「加深文字与边框，弱光下也看得清；……手动切换后以你的选择为准」），
 * 与任务书短串不一致；W6 的 e2e（e2e/high-contrast.spec.ts）按任务书逐字
 * 断言关闭态 title。两处文案统一（改 LABEL.hint 或改任务书口径）由协调方
 * 裁决，在此之前本组件先满足任务书 + 契约测试，不擅自改 W2 的 lib。
 *
 * 系统 forced-colors 已激活时系统已接管对比度，本开关禁用并注明
 * 「系统已开启高对比」；只首帧判断一次会在用户中途开系统高对比时失
 * 同步，故监听 matchMedia('(forced-colors: active)') 的 change 事件。
 */

import React from 'react'
import { Contrast } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  HIGH_CONTRAST_LABEL,
  loadHighContrast,
  setHighContrast,
} from '@/lib/high-contrast'

export function HighContrastToggle({ className }: { className?: string }) {
  const [on, setOn] = React.useState(false)
  const [systemForced, setSystemForced] = React.useState(false)

  React.useEffect(() => {
    setOn(loadHighContrast(window.localStorage))
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ on?: boolean }>).detail
      if (typeof detail?.on === 'boolean') setOn(detail.on)
    }
    window.addEventListener('navhub:high-contrast-changed', sync)
    return () => window.removeEventListener('navhub:high-contrast-changed', sync)
  }, [])

  React.useEffect(() => {
    const mq = window.matchMedia('(forced-colors: active)')
    const update = () => setSystemForced(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const toggle = () => {
    setOn(setHighContrast(!on, window.localStorage))
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      disabled={systemForced}
      aria-pressed={on}
      className={`h-11 w-11 rounded-lg transition-colors hover:bg-muted/60 ${
        on ? 'bg-primary/10 text-primary hover:text-primary' : 'text-muted-foreground hover:text-foreground'
      } ${className || ''}`}
      title={
        systemForced
          ? '系统已开启高对比'
          : on
            ? HIGH_CONTRAST_LABEL.on
            : '高对比：加深文字与边框，关闭后恢复'
      }
      aria-label={
        systemForced
          ? '系统已开启高对比'
          : on
            ? HIGH_CONTRAST_LABEL.on
            : HIGH_CONTRAST_LABEL.off
      }
    >
      <Contrast className="h-4 w-4" />
    </Button>
  )
}
