"use client"

/**
 * Tooltip 统一事实源（覆盖 apps/web 上游底座的同名文件）。
 *
 * 2026-11-09 修复两处实测缺陷：
 *
 * A. 视口越界：最右侧卡片的 align="center" / max-w-[280px] 气泡在 1440px 视口下
 *    落到 left=1422 / right=1702，溢出 262px。根因不是碰撞算法算错——Popper 已按
 *    视口算出 translate(1134px)，但 Content 原先 inline 渲染在带 `transform` 的卡片
 *    祖先内，position:fixed 被降级为相对该祖先定位，叠加网格左边距 288px 后正好 1422。
 *    → Portal 到 body + avoidCollisions + collisionPadding=12 + max-width 兜底。
 *
 * B. 驻留粘连：hover 后把鼠标移开，data-state 仍是 delayed-open 且浮层常驻。
 *    → Root 改受控包装，Trigger 上显式接 pointerleave / blur 强制关闭，
 *      不再只依赖 Radix 内部的隐式关闭路径。
 */
import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

/** 把「立即关闭」能力传给 Trigger，作为 pointerleave / blur 的兜底。 */
const TooltipCloseContext = React.createContext<() => void>(() => {})

type TooltipRootProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>

const Tooltip = ({ open: controlledOpen, onOpenChange, children, ...props }: TooltipRootProps) => {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange]
  )
  const forceClose = React.useCallback(() => handleOpenChange(false), [handleOpenChange])

  return (
    <TooltipCloseContext.Provider value={forceClose}>
      <TooltipPrimitive.Root
        open={open}
        onOpenChange={handleOpenChange}
        disableHoverableContent
        {...props}
      >
        {children}
      </TooltipPrimitive.Root>
    </TooltipCloseContext.Provider>
  )
}
Tooltip.displayName = "Tooltip"

type TooltipTriggerProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>

const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Trigger>,
  TooltipTriggerProps
>(({ onPointerLeave, onBlur, ...props }, ref) => {
  const forceClose = React.useContext(TooltipCloseContext)
  return (
    <TooltipPrimitive.Trigger
      ref={ref}
      onPointerLeave={(e) => {
        onPointerLeave?.(e)
        if (!e.defaultPrevented) forceClose()
      }}
      onBlur={(e) => {
        onBlur?.(e)
        if (!e.defaultPrevented) forceClose()
      }}
      {...props}
    />
  )
})
TooltipTrigger.displayName = TooltipPrimitive.Trigger.displayName

type TooltipContentProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(({ className, sideOffset = 4, collisionPadding = 12, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      avoidCollisions
      collisionPadding={collisionPadding}
      collisionBoundary={
        typeof document === "undefined" ? undefined : document.documentElement
      }
      sticky="partial"
      className={cn(
        "z-50 overflow-visible rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-600",
        "max-w-[min(280px,calc(100vw-24px))]",
        "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    >
      <TooltipPrimitive.Arrow
        className="fill-gray-100"
        width={14}
        height={12}
      />
      {props.children}
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
