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
 * 例外（U-363，2026-11-26 实测）：小猫挂件是独立脚本自定位，不进本浮坞
 * 的 children 槽位，所以「回顶在下」在移动端几何上放不下——底部导航栏
 * 占 64px、猫底沿在 88px（≤640px）/112px（640–1023px），猫底沿到栏顶
 * 只剩约 24px，塞不进 44px 的回顶按钮；按旧底距（76px）按钮与猫收起后
 * 半露的圆标（.xm-tab）重叠 1152px²、按钮中心点到猫的 IMG，点不到。
 * 因此 <md 时按钮改到猫的上方（错开位置），按猫顶沿分档抬高，见下文
 * BACK_TO_TOP_BOTTOM_GAP_PX 上方的推导；桌面端猫顶沿在 224px、按钮顶沿在 60px，
 * 本就错开，底距不动。
 *
 * ## 底部安全区契约
 *
 * 浮坞距底用 `max(16px, env(safe-area-inset-bottom))`——iOS 刘海屏底部
 * 有 home indicator 遮挡区，写死 16px 会让按钮压在它上面点不到。
 * 滚到底时页脚版权高于浮坞靠两处：footer 自身的底垫（移动端 9rem，
 * 见 footer.tsx——猫带顶沿 128px，底垫须大于它）与小猫滚到底自动收起
 * （见 xiaomaomao.js syncAutoPark，≤1023px 生效）。
 */
import { useCallback, useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { preferredScrollBehavior } from '@/lib/motion'

/** 滚动超过这个距离才显示回顶按钮 */
export const SCROLL_TOP_VISIBLE_AFTER = 1200

/**
 * 回顶按钮距底（U-363 错开位置，分档推导；数值的来源是猫的实测几何，
 * 不是拍脑袋——改猫的尺寸/底距时必须同步重算，见 test/global-floating-dock.test.ts）：
 *
 * - <640px：猫底沿 88px（3.5rem + 32px，见 xiaomaomao.js ≤640 规则）+
 *   猫高 88px（.xm-wrap 88px）= 顶沿 176px；按钮底距 176 + 8px 间隙 = 184px = 11.5rem。
 * - 640–767px：猫底沿 112px（640–1023 规则）+ 猫高 112px = 顶沿 224px；
 *   按钮底距 224 + 8px = 232px = 14.5rem。
 * - ≥768px（md）：桌面端猫顶沿同样 224px，但按钮底距 16px 时顶沿只到 60px，
 *   与猫无重叠，沿用安全区底距，不动。
 *
 * 44px 按钮 + 8px 间隙是底距的组成部分：底距 − 猫顶沿 = 8px，任何一档都一样。
 *
 * 残留：抬高后的按钮与猫的两个瞬态覆盖层同处猫顶沿一带——控件坞（.xm-dock，
 * 猫顶沿 +10px 起）与聊天面板（移动端左右 12px 满宽浮层）。两者只在用户
 * 主动操作猫时出现、几秒闲置后自动收起。按钮在这些态下直接让位（见下
 * CAT_OVERLAY_CLASSES + MutationObserver），而不是比 z 轴：猫 z-60，
 * 浮坞 z-40，硬叠只会让按钮被盖住点不到。
 */
export const BACK_TO_TOP_BOTTOM_GAP_PX = 8

/** 小猫挂件处于覆盖态的 class：聊天面板/游戏开着（xm-open），或控件坞唤出（xm-ctl） */
export const CAT_OVERLAY_CLASSES = ['xm-open', 'xm-ctl'] as const

/** 挂件是否正盖在回顶按钮的位置上（挂件未加载时为 false，按钮按滚动态正常显示） */
function isCatOverlayOpen(): boolean {
  if (typeof document === 'undefined') return false
  const root = document.getElementById('xiaomaomao')
  if (!root) return false
  return CAT_OVERLAY_CLASSES.some((c) => root.classList.contains(c))
}

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
  const [catOverlayOpen, setCatOverlayOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > SCROLL_TOP_VISIBLE_AFTER)
    // 首帧也判一次：从别处带滚动位置返回时不该漏显
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    // 挂件是独立脚本（lazyOnload），挂载时可能还没出现：先守 body 等它，
    // 出现后改守它的 class。卸载时两个 observer 都断开。
    let classObserver: MutationObserver | null = null
    let bodyObserver: MutationObserver | null = null
    const sync = () => setCatOverlayOpen(isCatOverlayOpen())
    const watchRoot = () => {
      const root = document.getElementById('xiaomaomao')
      if (!root) return false
      sync()
      classObserver = new MutationObserver(sync)
      classObserver.observe(root, { attributes: true, attributeFilter: ['class'] })
      return true
    }
    if (!watchRoot()) {
      bodyObserver = new MutationObserver(() => {
        if (watchRoot()) bodyObserver?.disconnect()
      })
      bodyObserver.observe(document.body, { childList: true, subtree: true })
    }
    return () => {
      classObserver?.disconnect()
      bodyObserver?.disconnect()
    }
  }, [])

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: preferredScrollBehavior() })
  }, [])

  return (
    <div
      data-testid="global-floating-dock"
      // U-363 错开位置：<md 时按钮在猫的上方（猫顶沿 + 8px 间隙），分档底距见
      // BACK_TO_TOP_BOTTOM_GAP_PX 上方的推导；md 起按钮在猫下方，底距不动。
      // 注意：bottom-[...] 须写字面量，Tailwind 靠扫描源码生成这些类，勿抽变量。
      className="pointer-events-none fixed bottom-[calc(11.5rem+env(safe-area-inset-bottom,0px))] right-3 z-40 flex flex-col items-end gap-2 sm:bottom-[calc(14.5rem+env(safe-area-inset-bottom,0px))] md:bottom-[max(16px,env(safe-area-inset-bottom))] md:right-4"
    >
      {/* 挂件槽位：pointer-events-auto 让挂件可点，外壳本身不拦事件 */}
      {children ? <div className="pointer-events-auto">{children}</div> : null}

      {showTop && !catOverlayOpen ? (
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
