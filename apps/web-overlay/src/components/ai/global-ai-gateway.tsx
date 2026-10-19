'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'

const AiCopilotDrawer = dynamic(
  () => import('@/components/ai/ai-copilot-drawer').then((m) => m.AiCopilotDrawer),
  { ssr: false },
)

/**
 * AI Copilot 首屏网守（P1-3）。
 *
 * 抽屉自身要常驻监听 Cmd/Ctrl+J 与 open-ai-copilot，才能在任意页面唤起。
 * 首屏只挂网守；第一次呼出才加载实现，随后把这次意图重新派发给已挂载的抽屉。
 * 这样不需要改动抽屉内部的 open 状态，也不影响它之后的快捷键/事件处理。
 */
export function GlobalAiGateway() {
  const [mounted, setMounted] = useState(false)
  const [pendingOpen, setPendingOpen] = useState(false)

  useEffect(() => {
    if (mounted) return
    const open = () => {
      setPendingOpen(true)
      setMounted(true)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        open()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('open-ai-copilot', open)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('open-ai-copilot', open)
    }
  }, [mounted])

  useEffect(() => {
    if (!mounted || !pendingOpen) return
    // 子组件的 effect 先于父组件执行：此时抽屉的 open-ai-copilot 监听器已经挂好
    window.dispatchEvent(new Event('open-ai-copilot'))
    setPendingOpen(false)
  }, [mounted, pendingOpen])

  return mounted ? <AiCopilotDrawer /> : null
}
