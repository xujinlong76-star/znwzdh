'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { spotlightHotkeyMatches, useSpotlightShortcutMode } from '@/lib/user-preferences'

const SpotlightModal = dynamic(
  () => import('@/components/search/spotlight-modal').then((m) => m.SpotlightModal),
  { ssr: false },
)

/**
 * Spotlight 首屏网守（P1-3）。
 *
 * Spotlight 自身约 45 KB，并且要常驻监听呼出键才能在任意页面唤起。
 * 首屏只挂这个几十行的网守：第一次快捷键或 open-spotlight 事件才加载实现；
 * 实现挂载后由它自己接管后续快捷键与事件，网守随即卸载监听。
 *
 * 呼出键取用户中心的「搜索快捷键」偏好：写死 ⌘K 会让选了「仅 /」的用户
 * 无论怎么按都呼不出（该设置此前在全仓没有任何消费者）。
 */
export function GlobalSpotlightGateway() {
  const [mounted, setMounted] = useState(false)
  const shortcutMode = useSpotlightShortcutMode()

  useEffect(() => {
    if (mounted) return
    const open = () => setMounted(true)
    const onKeyDown = (e: KeyboardEvent) => {
      if (spotlightHotkeyMatches(e, shortcutMode)) {
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
  }, [mounted, shortcutMode])

  return mounted ? <SpotlightModal initialOpen /> : null
}
