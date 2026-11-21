'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

/**
 * 首屏副标题提示（首屏瘦身）：
 * 主内容区不再渲染大号 H1 标题块（品牌 h1 已移到左侧边栏），副标题只在两种
 * 场景下以单行轻量条出现，且可关闭：
 *   - 首次访问（本机未记录到访过）
 *   - 搜索框聚焦（输入中需要一点上下文提示）
 * 关闭后写入本机，不再出现（首次访问与搜索聚焦均不再触发）。
 * 搜索聚焦通过 document focusin/focusout 监听识别：聚焦元素为 placeholder
 * 或 aria-label 含「搜索」的输入框时即视为搜索聚焦（不改顶栏搜索组件）。
 */
const DISMISSED_KEY = 'navhub:subtitle-hint-dismissed'
const VISITED_KEY = 'navhub:visited'

function isSearchInput(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  if (tag !== 'input' && tag !== 'textarea') return false
  const placeholder = el.getAttribute('placeholder') ?? ''
  const ariaLabel = el.getAttribute('aria-label') ?? ''
  return placeholder.includes('搜索') || ariaLabel.includes('搜索')
}

export function HomeSubtitleHint({ tagline }: { tagline?: string }) {
  const [mounted, setMounted] = useState(false)
  const [dismissed, setDismissed] = useState(true)
  // 首次访问只判定一次（懒初始化，渲染时读本机）：StrictMode 会两次调用 effect，
  // 若在 effect 里先写 visited 再重读，第二次会误判为「非首次」导致提示不出现。
  // 这里在首帧渲染时就定下 isFirstVisit，effect 只负责把 visited 落盘（供下次访问用），
  // 不再重读重算。SSR 时 window 不存在，返回 false（反正 mounted 前不渲染，无水合差）。
  const [isFirstVisit] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(VISITED_KEY) !== '1'
    } catch {
      return false
    }
  })
  const [searchFocused, setSearchFocused] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      setDismissed(window.localStorage.getItem(DISMISSED_KEY) === '1')
      // 首次访问落盘（供下次访问判定用）；本次的 isFirstVisit 已由懒初始化定下，不重读
      if (isFirstVisit) {
        window.localStorage.setItem(VISITED_KEY, '1')
      }
    } catch {
      // 存储受限时默认不展示（不打扰），搜索聚焦仍可触发
      setDismissed(false)
    }

    const onFocusIn = (e: FocusEvent) => {
      setSearchFocused(isSearchInput(e.target as Element | null))
    }
    const onFocusOut = () => {
      setSearchFocused(false)
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    // 若挂载时搜索框已聚焦（如 / 快捷键刚呼出），补一次初始判定
    setSearchFocused(isSearchInput(document.activeElement))
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [isFirstVisit])

  const dismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // 存储受限时仅本次隐藏
    }
  }

  if (!mounted || dismissed) return null
  if (!isFirstVisit && !searchFocused) return null

  /* 2026-11-21 首屏优化：原样式是「带边框 + 底色 + px-2.5 py-1.5」的卡片
     （实测占 28–32px，视觉上像一个可交互区块）。但内容只有一句话，且恰好出现在
     **最该看清站点卡片的两个时刻**（首次访问、搜索聚焦）。
     改为无边框无底色的纯文本行，高度压到约 20px，关闭按钮悬停才显形：
     平时它只是一行浅灰说明，不再和真正的卡片抢视觉重量。 */
  return (
    <div
      role="note"
      aria-label="副标题提示"
      className="group/hint mb-1.5 flex items-center gap-2 px-0.5 text-xs leading-5 text-muted-foreground/80"
    >
      <span className="min-w-0 flex-1 truncate">
        {searchFocused
          ? '输入关键词快速找站，支持拼音与语义；按 / 呼出超级搜索，按 Esc 收起。'
          : (tagline || 'AI 原生智能网址导航与研发效率中枢')}
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="关闭副标题提示"
        className="inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 group-hover/hint:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
