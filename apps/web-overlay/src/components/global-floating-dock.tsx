'use client'
/**
 * 全站统一的右下角浮坞（2026-11-21）。
 *
 * ## 为什么收口
 *
 * 重构前右下角有两套彼此独立的悬浮实现：
 *   - 小猫挂件（public/xiaomaomao/xiaomaomao.js，自带 fixed 定位）
 *   - ScrollToTop（fixed bottom-8 right-8，z-50）
 * 两者各自算位置，互相不知道对方存在——挂件展开时正好盖住回顶按钮，
 * 且都贴着页面右下角与页脚版权打架。
 *
 * 现在统一为一个垂直浮坞：挂件在上、回顶在下，共享同一套安全区与 z 轴，
 * 间距固定 gap-2，永不互相遮挡。
 *
 * ## 底部安全区契约
 *
 * 浮坞距底用 `max(16px, env(safe-area-inset-bottom))`——iOS 刘海屏底部
 * 有 home indicator 遮挡区，写死 16px 会让按钮压在它上面点不到。
 * 同时全站主容器统一 pb-24（见 layout），保证滚到底时页脚版权永远高于浮坞。
 */
import { useCallback, useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { preferredScrollBehavior } from '@/lib/motion'

/** 滚动超过这个距离才显示回顶按钮 */
export const SCROLL_TOP_VISIBLE_AFTER = 1200

export interface GlobalFloatingDockProps {
  /** 挂件槽位：由 layout 传入已渲染好的小猫挂件（保持其既有脚本逻辑不动） */
  children?: React.ReactNode
}

/**
 * 浮坞外壳。
 *
 * z-40 而非 z-50：弹窗/抽屉（冲突裁决、命令面板等）用 z-50，
 * 浮坞不该压在它们上面。
 */
export function GlobalFloatingDock({ children }: GlobalFloatingDockProps) {
  const [showTop, setShowTop] = useState(false)

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > SCROLL_TOP_VISIBLE_AFTER)
    // 首帧也判一次：从别处带滚动位置返回时不该漏显
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: preferredScrollBehavior() })
  }, [])

  return (
    <div
      data-testid="global-floating-dock"
      // 移动端抬高至底部导航栏（~64px）之上，防止「回到顶部」与小猫挂件压住「我的」Tab；桌面端沿用安全区底距
      className="pointer-events-none fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] right-3 z-40 flex flex-col items-end gap-2 md:bottom-[max(16px,env(safe-area-inset-bottom))] md:right-4"
    >
      {/* 挂件槽位：pointer-events-auto 让挂件可点，外壳本身不拦事件 */}
      {children ? <div className="pointer-events-auto">{children}</div> : null}

      {showTop ? (
        <button
          type="button"
          onClick={scrollToTop}
          aria-label="回到顶部"
          title="回到顶部"
          className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-background/85 text-foreground/80 shadow-sm backdrop-blur transition-all hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
