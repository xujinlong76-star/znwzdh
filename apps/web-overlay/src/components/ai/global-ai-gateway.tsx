'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import {
  COPILOT_OPEN_EVENT,
  isCopilotDrawerReady,
  normalizeCopilotOpenDetail,
  stashCopilotOpen,
  type CopilotOpenDetail,
} from '@/lib/ai-entry'

const AiCopilotDrawer = dynamic(
  () => import('@/components/ai/ai-copilot-drawer').then((m) => m.AiCopilotDrawer),
  { ssr: false },
)

/**
 * AI Copilot 首屏网守（P1-3）。
 *
 * 抽屉自身要常驻监听 Cmd/Ctrl+J 与 open-ai-copilot，才能在任意页面唤起。
 * 首屏只挂网守；第一次呼出才加载实现。抽屉是 dynamic 懒加载，第一次唤起时
 * 它可能还没挂载——所以网关不再「原样再派发一次」（旧实现 `new Event(...)`
 * 会把 Spotlight 带来的 query 丢掉），而是把意图寄存进 @/lib/ai-entry，
 * 抽屉挂载后自己取走。
 */
export function GlobalAiGateway() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const open = (detail: CopilotOpenDetail) => {
      // 抽屉已在监听：原事件会被它直接收到，网关再插手就是处理两次
      if (isCopilotDrawerReady()) return
      stashCopilotOpen(detail)
      setMounted(true)
    }
    const onEvent = (e: Event) => open(normalizeCopilotOpenDetail((e as CustomEvent).detail))
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        open({ source: 'keyboard' })
      }
    }
    window.addEventListener(COPILOT_OPEN_EVENT, onEvent)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener(COPILOT_OPEN_EVENT, onEvent)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return mounted ? <AiCopilotDrawer /> : null
}
