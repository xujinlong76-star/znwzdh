'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'

const SpotlightModal = dynamic(
  () => import('@/components/search/spotlight-modal').then((m) => m.SpotlightModal),
  { ssr: false },
)

/**
 * Spotlight 首屏网守（P1-3）。
 *
 * Spotlight 自身约 45 KB，并且要常驻监听 Cmd/Ctrl+K 才能在任意页面唤起。
 * 首屏只挂这个几十行的网守：第一次快捷键或 open-spotlight 事件才加载实现；
 * 实现挂载后由它自己接管后续快捷键与事件，网守随即卸载监听。
 */
export function GlobalSpotlightGateway() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (mounted) return
    const open = () => setMounted(true)
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        open()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('open-spotlight', open)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('open-spotlight', open)
    }
  }, [mounted])

  return mounted ? <SpotlightModal initialOpen /> : null
}
