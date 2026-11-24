'use client'

/**
 * 横向滚动渐隐容器（HorizontalScrollFade）：
 * 统一封装首页各横向胶囊条（极速置顶栏、二级分类栏、快捷专题条、
 * 分类筛选标签行）的溢出体验，替代各处手写的「overflow-x-auto + 生硬裁剪」。
 *
 * - 动态检测 scrollLeft：只在仍可滚动的一侧渲染平滑边缘渐隐遮罩
 *  （CSS mask-image 线性渐变），两侧都到底时不加遮罩；
 * - 鼠标滚轮纵向滚动转为横向滚动（仅当该方向还能滚时才接管，
 *   到头后放行给页面，避免滚轮被“吃掉”）；
 * - 可选的左右轻箭头按钮（默认开；触屏窄屏下隐藏，靠滑动 + 渐隐提示）。
 *
 * 注意：遮罩画在滚动容器自身上（mask-image），箭头按钮是外层
 * relative 包装的兄弟节点，不会被遮罩一并渐隐。
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { preferredScrollBehavior } from '@/lib/motion'

/** 渐隐遮罩的纯函数：两侧可滚状态 → mask-image 值（无可滚侧时 'none'）。 */
export function computeScrollFadeMask(
  canScrollLeft: boolean,
  canScrollRight: boolean,
  fadeWidth = 32,
): string {
  if (!canScrollLeft && !canScrollRight) return 'none'
  const f = `${fadeWidth}px`
  if (canScrollLeft && canScrollRight) {
    return `linear-gradient(to right, transparent 0, #000 ${f}, #000 calc(100% - ${f}), transparent 100%)`
  }
  if (canScrollLeft) {
    return `linear-gradient(to right, transparent 0, #000 ${f}, #000 100%)`
  }
  return `linear-gradient(to right, #000 0, #000 calc(100% - ${f}), transparent 100%)`
}

export interface HorizontalScrollFadeProps {
  /** 滚动内容（胶囊/芯片列表）；可空，空时只渲染空滚动容器 */
  children?: ReactNode
  /** 外层 relative 包装的类名 */
  className?: string
  /** 内层滚动容器的类名（调用方放 flex/gap/间距等排版类） */
  scrollClassName?: string
  /** 外层包装的 aria-label（无障碍名称由调用方按语义给） */
  ariaLabel?: string
  /** 是否渲染左右轻箭头（默认 true；细胶囊行可关掉，只留渐隐 + 滚轮） */
  showArrows?: boolean
  /** 渐隐带宽（px），默认 32 */
  fadeWidth?: number
  /** 箭头每次滚动距离（px），默认 240 */
  scrollStep?: number
  /** 左箭头无障碍文案，默认「向左滚动」 */
  prevAriaLabel?: string
  /** 右箭头无障碍文案，默认「向右滚动」 */
  nextAriaLabel?: string
  /** 外层 relative 包装的 id（可选；如 tablist 步骤 0 的面板锚点），默认不设 */
  id?: string
  /** 内层滚动容器的 role（如 tablist），默认不设；由调用方按语义给 */
  role?: string
  /** 内层滚动容器的键盘处理（如 tablist 的 ←/→ 漫游），默认不设 */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
}

export const HorizontalScrollFade = forwardRef<HTMLDivElement, HorizontalScrollFadeProps>(
  function HorizontalScrollFade(
    {
      children,
      className,
      scrollClassName,
      ariaLabel,
      id,
      showArrows = true,
      fadeWidth = 32,
      scrollStep = 240,
      prevAriaLabel = '向左滚动',
      nextAriaLabel = '向右滚动',
      role,
      onKeyDown,
    },
    ref,
  ) {
    const innerRef = useRef<HTMLDivElement>(null)
    const [canScrollLeft, setCanScrollLeft] = useState(false)
    const [canScrollRight, setCanScrollRight] = useState(false)

    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        innerRef.current = node
        if (typeof ref === 'function') {
          ref(node)
        } else if (ref) {
          ;(ref as MutableRefObject<HTMLDivElement | null>).current = node
        }
      },
      [ref],
    )

    const checkBounds = useCallback(() => {
      const el = innerRef.current
      if (!el) return
      const left = el.scrollLeft > 4
      const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 4
      setCanScrollLeft((prev) => (prev === left ? prev : left))
      setCanScrollRight((prev) => (prev === right ? prev : right))
    }, [])

    useEffect(() => {
      const el = innerRef.current
      if (!el) return
      checkBounds()
      el.addEventListener('scroll', checkBounds, { passive: true })
      window.addEventListener('resize', checkBounds)
      const ro = new ResizeObserver(checkBounds)
      ro.observe(el)
      return () => {
        el.removeEventListener('scroll', checkBounds)
        window.removeEventListener('resize', checkBounds)
        ro.disconnect()
      }
    }, [checkBounds, children])

    // 纵向滚轮转横向：只在该方向还能滚时接管并 preventDefault，
    // 到头后放行，页面滚动不受影响；横向滚轮/触控板横滑走原生。
    useEffect(() => {
      const el = innerRef.current
      if (!el) return
      const onWheel = (e: WheelEvent) => {
        if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
        const canLeft = el.scrollLeft > 0
        const canRight = el.scrollLeft < el.scrollWidth - el.clientWidth - 1
        if (e.deltaY > 0 && !canRight) return
        if (e.deltaY < 0 && !canLeft) return
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
      el.addEventListener('wheel', onWheel, { passive: false })
      return () => el.removeEventListener('wheel', onWheel)
    }, [])

    const scrollByStep = useCallback(
      (direction: 'left' | 'right') => {
        const el = innerRef.current
        if (!el) return
        el.scrollBy({
          left: direction === 'left' ? -scrollStep : scrollStep,
          behavior: preferredScrollBehavior(),
        })
      },
      [scrollStep],
    )

    const mask = computeScrollFadeMask(canScrollLeft, canScrollRight, fadeWidth)
    const maskStyle: CSSProperties =
      mask === 'none' ? {} : { maskImage: mask, WebkitMaskImage: mask }

    /* overflow-hidden 不是「再来一层裁切」，而是必须的：本组件被放在 flex/grid
       父容器里时，根节点自身 overflow 仍是 visible，内部滚动容器虽然
       overflow-x:auto，但它的**滚动内容**（shrink-0 的胶囊）仍会经由根节点
       把视觉溢出泄漏到文档流 —— 1024px 实测 documentElement.scrollWidth
       1069 > clientWidth 1024，二分法定位到「AI 找站|场景」胶囊。
       在根节点补 overflow-hidden 后溢出被本组件吸收，文档不再被顶宽。 */
    return (
      /* 2026-11-21 修复横向溢出：根节点原先只有 relative，没有限宽。
         在 flex / grid 容器里（子分类轨、速览坞、分类筛选行都是），
         内部 shrink-0 的胶囊会把根节点撑到内容总宽——overflow-x-auto
         因此永远不触发，整个文档被顶出横向滚动（768px 实测 940>768）。
         min-w-0 让 flex 子项允许收缩到容器宽，overflow 才真正生效；
         w-full 兜住块级父容器下的同等场景。 */
      <div id={id} className={cn('relative w-full min-w-0 overflow-hidden', className)} aria-label={ariaLabel}>
        {showArrows && canScrollLeft ? (
          <button
            type="button"
            onClick={() => scrollByStep('left')}
            className="absolute left-0 top-1/2 z-10 hidden sm:flex items-center justify-center h-7 w-7 -translate-y-1/2 rounded-full bg-background/95 border border-border shadow-xs text-muted-foreground hover:text-foreground transition-all"
            aria-label={prevAriaLabel}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : null}

        <div
          ref={setRefs}
          /* 上游（github/main）新增：role/aria-label/onKeyDown 透传到内层滚动容器，
             供 tablist 语义与 ←/→ 漫游使用；保留。
             本分支新增：pl-0.5 pr-7 给两侧绝对定位的箭头留呼吸位，
             避免箭头压住第一个/最后一个胶囊的文字。两者不冲突，共存。 */
          role={role}
          aria-label={role ? ariaLabel : undefined}
          onKeyDown={onKeyDown}
          className={cn('overflow-x-auto no-scrollbar pl-0.5 pr-7', scrollClassName)}
          style={maskStyle}
        >
          {children}
        </div>

        {showArrows && canScrollRight ? (
          <button
            type="button"
            onClick={() => scrollByStep('right')}
            className="absolute right-0 top-1/2 z-10 hidden sm:flex items-center justify-center h-7 w-7 -translate-y-1/2 rounded-full bg-background/95 border border-border shadow-xs text-muted-foreground hover:text-foreground transition-all"
            aria-label={nextAriaLabel}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    )
  },
)
