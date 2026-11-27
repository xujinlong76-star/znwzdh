'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { spotlightModalHotkeyMatches, topSearchHotkeyMatches, useSpotlightShortcutMode } from '@/lib/user-preferences'

const SpotlightModal = dynamic(
  () => import('@/components/search/spotlight-modal').then((m) => m.SpotlightModal),
  { ssr: false },
)

/**
 * 冷启动聚焦兜底（2026-11-26）：[data-search-input] 出现时立即聚焦，最多等 5 秒。
 *
 * 为什么不能只靠派发 navhub:focus-search：该事件在全仓的唯一监听者就是
 * SearchPalette 自身（search-palette.tsx）——面板 chunk 还没加载完、组件尚未挂载时，
 * 事件根本没有人收，1ae83668 的「派发事件让面板挂载」在真正冷启动的那一拍是空操作
 * （面板挂载后 input 必然已在 DOM，网守早走了直接聚焦分支，事件派不上用场）。
 * 面板是 dynamic(ssr:false) 且在顶栏里常渲染，chunk 加载已在进行中——这里只需等
 * input 出现再聚焦，不用、也不应再触发一次挂载。
 */
function focusSearchInputWhenReady() {
  const tryFocus = () => {
    const input = document.querySelector<HTMLInputElement>('[data-search-input]')
    if (!input) return false
    input.focus()
    input.select()
    return true
  }
  if (tryFocus()) return
  const observer = new MutationObserver(() => {
    if (tryFocus()) observer.disconnect()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  window.setTimeout(() => observer.disconnect(), 5000)
}

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
          // （navigation-toolbar 的 loading 占位是 div，不是 button）。此时直接派发挂载事件，
          // 面板 mount 后由 autoFocus 接管输入框——否则引导卡承诺的「⌘K 随时搜索」
          // 在第一次按下时静默失灵（/ 键走另一条常驻监听，所以此前没被发现）。
          // 2026-11-26 订正：光派发事件不够——事件的唯一监听者就是面板自身，
          // 面板未挂载时无人收听。必须同时等 input 出现再聚焦（focusSearchInputWhenReady）。
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('navhub:focus-search'))
          focusSearchInputWhenReady()
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
