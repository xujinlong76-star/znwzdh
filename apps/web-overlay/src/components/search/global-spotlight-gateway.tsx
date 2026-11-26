'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { spotlightModalHotkeyMatches, topSearchHotkeyMatches, useSpotlightShortcutMode } from '@/lib/user-preferences'

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
export function GlobalSpotlightGateway({
  siteLinkTarget,
}: {
  siteLinkTarget?: string | null
} = {}) {
  const [mounted, setMounted] = useState(false)
  const shortcutMode = useSpotlightShortcutMode()

  useEffect(() => {
    if (mounted) return
    const open = () => setMounted(true)
    const onKeyDown = (e: KeyboardEvent) => {
      // 2026-11-20 搜索快捷键分流（William 点名）：Ctrl/⌘+K 不再开超级搜索弹窗，
      // 改为聚焦顶栏搜索框（data-search-input）；超级搜索弹窗改由 Ctrl/⌘+Shift+K
      // （或 /）触发。顶栏搜索框不存在时（极少数无顶栏的页面）不拦截，让按键落空。
      if (topSearchHotkeyMatches(e)) {
        const input = document.querySelector<HTMLInputElement>('[data-search-input]')
        if (input) {
          e.preventDefault()
          input.focus()
          input.select()
        } else {
          // 冷启动兜底：顶栏搜索框是 ssr:false 的懒挂载组件，首屏 DOM 里只有占位
          // button（navigation-toolbar 的 LazySearchPalette）。此时直接派发挂载事件，
          // 面板 mount 后由 autoFocus 接管输入框——否则引导卡承诺的「⌘K 随时搜索」
          // 在第一次按下时静默失灵（/ 键走另一条常驻监听，所以此前没被发现）。
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('navhub:focus-search'))
        }
        return
      }
      if (spotlightModalHotkeyMatches(e, shortcutMode)) {
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

  return mounted ? <SpotlightModal initialOpen siteLinkTarget={siteLinkTarget} /> : null
}
