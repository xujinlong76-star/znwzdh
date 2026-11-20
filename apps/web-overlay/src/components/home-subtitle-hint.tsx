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
  const [isFirstVisit, setIsFirstVisit] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      setDismissed(window.localStorage.getItem(DISMISSED_KEY) === '1')
      const visited = window.localStorage.getItem(VISITED_KEY) === '1'
      setIsFirstVisit(!visited)
      if (!visited) {
        window.localStorage.setItem(VISITED_KEY, '1')
      }
    } catch {
      // 存储受限时默认不展示（不打扰），搜索聚焦仍可触发
      setDismissed(false)
      setIsFirstVisit(false)
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
  }, [])

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

  return (
    <div
      role="note"
      aria-label="副标题提示"
      className="mb-2 flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground"
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
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
