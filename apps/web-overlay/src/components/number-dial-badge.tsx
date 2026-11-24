/**
 * 数字直达角标：16×16 kbd 样式小芯片。
 * 首屏瘦身后默认位置为卡片右上角（标准卡/富卡）；紧凑行与速览坞胶囊仍用
 * 图标右下角。定位由调用方 className 传 absolute 偏移，父级须是 relative。
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
  inline = false,
}: {
  /** 数字键 1~9（坞映射位）或 1~0（自定义快拨位，由调用方决定传什么） */
  digit?: number | string | null
  /** 定位：非 inline 时调用方传 absolute 偏移（如 -bottom-1 -right-1），父级须是 relative */
  className?: string
  /** 行内小图标模式（书签目录 / 极速胶囊 / 极客清单）使用流内芯片，绝不遮挡 18–24px 图标或压字 */
  inline?: boolean
}): ReactElement | null {
  if (digit === undefined || digit === null || digit === '') return null
  return (
    <kbd
      aria-hidden="true"
      className={cn(
        'pointer-events-none hidden h-4 w-4 items-center justify-center rounded border border-border/90 bg-background text-[10px] font-mono font-bold leading-none text-foreground shadow-xs sm:inline-flex',
        inline
          ? 'relative shrink-0'
          : 'absolute z-20 ring-2 ring-background dark:ring-card',
        className,
      )}
    >
      {digit}
    </kbd>
  )
}
