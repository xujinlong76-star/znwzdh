'use client'

import { useState, useEffect } from 'react'
import { preferredScrollBehavior } from '@/lib/motion'

export interface NavigableCardItem {
  id: string
  title: string
  href: string
  categoryTitle?: string
  rawItem?: unknown
}

export interface UseKeyboardNavigatorProps {
  enabled?: boolean
  cards: NavigableCardItem[]
  onPeek?: (item: unknown) => void
  linkTarget?: string
}

/**
 * 极客全键盘漫游流 (Keyboard Navigator Hook)
 * 提供类 Vim 的 j/k 漫游与 Enter 访问、Space 速览能力
 */
export function useKeyboardNavigator({
  enabled = true,
  cards,
  onPeek,
  linkTarget = '_blank',
}: UseKeyboardNavigatorProps) {
  const [focusedId, setFocusedId] = useState<string | null>(null)

  // 当前聚焦卡片的索引
  const currentIndex = cards.findIndex((c) => c.id === focusedId)

  // 键盘事件处理
  useEffect(() => {
    if (!enabled || cards.length === 0) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // 避免在输入框、文本域或富文本中拦截
      const activeEl = document.activeElement as HTMLElement | null
      const isInput =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          activeEl.isContentEditable)

      if (isInput) return

      // 若有打开的顶层模态框 (如 role="dialog")，且当前不是该卡片，也不拦截。
      // 必须排除 aria-hidden：抽屉是常驻 DOM 的，关闭态只靠 transform 移出屏外，
      // 不排除的话键盘导航会被永久关掉。
      const hasModal = document.querySelector('[role="dialog"]:not([aria-hidden="true"])')
      if (hasModal) return

      // 1. 下一个 (j / ArrowDown)
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        if (currentIndex === -1 || currentIndex >= cards.length - 1) {
          const next = cards[0]
          if (next) setFocusedId(next.id)
        } else {
          const next = cards[currentIndex + 1]
          if (next) setFocusedId(next.id)
        }
        return
      }

      // 2. 上一个 (k / ArrowUp)
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (currentIndex <= 0) {
          const prev = cards[cards.length - 1]
          if (prev) setFocusedId(prev.id)
        } else {
          const prev = cards[currentIndex - 1]
          if (prev) setFocusedId(prev.id)
        }
        return
      }

      // 3. 打开链接 (Enter)
      if (e.key === 'Enter') {
        if (currentIndex !== -1 && cards[currentIndex]) {
          const target = cards[currentIndex]
          if (target && target.href) {
            e.preventDefault()
            window.open(target.href, linkTarget, 'noopener,noreferrer')
          }
        }
        return
      }

      // 4. 速览 (Space)
      if (e.key === ' ' || e.code === 'Space') {
        if (currentIndex !== -1 && cards[currentIndex]) {
          e.preventDefault()
          const target = cards[currentIndex]
          if (target?.rawItem && onPeek) {
            onPeek(target.rawItem)
          }
        }
        return
      }

      // 5. 退出聚焦 (Escape)
      if (e.key === 'Escape') {
        if (focusedId !== null) {
          e.preventDefault()
          setFocusedId(null)
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, cards, currentIndex, focusedId, onPeek, linkTarget])

  // 当聚焦卡片切换时，平滑滚动至视口
  useEffect(() => {
    if (!focusedId) return
    const el = document.getElementById(`nav-card-${focusedId}`)
    if (el) {
      el.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'nearest' })
    }
  }, [focusedId])

  return {
    focusedId,
    setFocusedId,
    currentIndex,
  }
}
