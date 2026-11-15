/**
 * 数字直达角标：16×16 kbd 样式小芯片，标在卡片图标右下角。
 *
 * 哑组件：只管画，不管映射。digit 为空时不渲染。
 * aria-hidden="true"（读屏不播报——快捷键说明走卡片主锚点的
 * aria-keyshortcuts 与页面唯一的键盘提示元素）；pointer-events-none
 *（不挡点击）；sm 以下隐藏（无键盘的设备上角标是噪音；用 CSS 断点，
 * 不用 isTouchDevice() 做 JS 判断，避免水合分叉）。
 */
import { cn } from '@/lib/utils'
import type { ReactElement } from 'react'

export function NumberDialBadge({
  digit,
  className,
}: {
  /** 数字键 1~9（坞映射位）或 1~0（自定义快拨位，由调用方决定传什么） */
  digit?: number | string | null
  /** 定位：调用方传 absolute 偏移（如 -bottom-1 -right-1），父级须是 relative */
  className?: string
}): ReactElement | null {
  if (digit === undefined || digit === null || digit === '') return null
  return (
    <kbd
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute hidden h-4 w-4 items-center justify-center rounded border border-border bg-background/95 text-[10px] font-mono font-bold leading-none text-foreground shadow-xs sm:inline-flex',
        className,
      )}
    >
      {digit}
    </kbd>
  )
}
