'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { CanonicalCardDisplayMode } from '@/lib/modular/card-display-modes'

/**
 * 服务端首帧展示模式上下文（Zero-CLS SSR Hydration 桥梁）。
 *
 * `app/page.tsx` 读取 `nav_view_mode` Cookie 并通过 `NavigationContent` 注入此处；
 * 客户端首帧（`mounted === false`）期间，顶栏切换器、分类区块与卡片统一消费此值，
 * 保证 SSR HTML 与客户端首次水合 DOM 100% 一致，杜绝刷新闪烁与水合警告。
 */
const InitialViewModeContext = createContext<CanonicalCardDisplayMode>('standard')

export function InitialViewModeProvider({
  value,
  children,
}: {
  value: CanonicalCardDisplayMode
  children: ReactNode
}) {
  return (
    <InitialViewModeContext.Provider value={value}>
      {children}
    </InitialViewModeContext.Provider>
  )
}

export function useInitialViewMode(): CanonicalCardDisplayMode {
  return useContext(InitialViewModeContext)
}

/**
 * 水合安全的媒体查询 Hook：SSR 与首帧水合始终返回 `false`，挂载后立即对齐并响应视口变化。
 */
export function useMediaQueryMatch(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(query)
    const sync = () => setMatches(media.matches)
    sync()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', sync)
      return () => media.removeEventListener('change', sync)
    }
    media.addListener(sync)
    return () => media.removeListener(sync)
  }, [query])

  return matches
}

/** `< 640px` 手机视口判定（用于 `VIEW_MODE_REGISTRY[*].mobileFallbackId` 自动降级与桌面端自动恢复） */
export function useIsMobileViewport(): boolean {
  return useMediaQueryMatch('(max-width: 639px)')
}

/** `< 768px` 移动端/窄平板视口判定（用于顶栏模式切换面板切换为 Bottom Sheet） */
export function useIsBelowMd(): boolean {
  return useMediaQueryMatch('(max-width: 767px)')
}
