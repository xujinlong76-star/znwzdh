'use client'

import { AlertTriangle, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import { cn } from '@/lib/utils'

/**
 * DIY 排版工坊的**静息态入口**（2026-11-08 深度扫描 P0-3 的延迟部分）。
 *
 * ## 为什么把它从 HomeDIYToolbar 里拆出来
 *
 * 原实现把整块 `HomeDIYToolbar`（含 DropdownMenu、Dialog、备份弹窗、
 * DIY 预设表……）挂在 `dynamic({ ssr: false })` 上。结果是：用户还没进编辑态，
 * 这一整包就已经在跟首屏抢主线程，移动端实测 DIY 按钮要 **12.5 秒**才可点。
 *
 * 而静息态真正需要的只有「一个按钮 + 一个存储告警条」。拆出来后：
 *   - 本组件是轻量的、可静态导入，随首屏直接渲染，不再等懒加载 chunk；
 *   - 重量级的 HUD 改为**进入编辑态才加载**（见 navigation-content.tsx）。
 *
 * 位置：移动端抬到底部导航（`h-14` + 安全区）之上并靠左——底部右侧那条
 * 竖排区域是浮动快捷导航（`right-4 bottom-16`），挤在一起会互相遮挡。
 */

/**
 * 预热 HUD chunk。
 *
 * `dynamic({ ssr: false })` 只在真正需要时才下载 chunk——这是首屏的收益，
 * 但代价是「点击 → HUD 出现」之间要等一次网络往返 + 解析。
 * 悬停 / 聚焦时提前 `import()` 一次，点下去时通常已经在浏览器缓存里。
 *
 * 这里用动态 `import()` 而不是静态导入：静态导入会把 HUD 及其一整套
 * 下拉菜单 / Dialog / 备份弹窗重新并回本组件的依赖图，等于把刚拆掉的东西又装回去。
 */
let toolbarChunkWarmed = false
function warmToolbarChunk() {
  if (toolbarChunkWarmed || typeof window === 'undefined') return
  toolbarChunkWarmed = true
  void import('@/components/home-diy-toolbar')
}

export function HomeDIYTrigger() {
  const { isEditingLayout, toggleEditingLayout, storageWarning, dismissStorageWarning } = useHomeDIY()

  // 编辑态由 HUD 接管，静息入口必须让位（否则两个浮层会叠在同一位置）
  if (isEditingLayout) return null

  return (
    <>
      {storageWarning && (
        <div
          role="alert"
          className={cn(
            'fixed z-50 pointer-events-auto max-w-[19rem] flex items-start gap-2 rounded-xl',
            'border border-amber-500/40 bg-amber-50/95 dark:bg-amber-950/90 backdrop-blur-md',
            'px-3 py-2 text-[11px] leading-snug text-amber-900 dark:text-amber-100 shadow-lg',
            'left-4 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+4.5rem)] sm:left-auto sm:right-4 sm:bottom-16',
          )}
        >
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="flex-1">{storageWarning}</span>
          <button
            type="button"
            onClick={dismissStorageWarning}
            aria-label="关闭提示"
            className="shrink-0 rounded p-0.5 hover:bg-amber-500/20 transition-colors cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div
        className="fixed z-50 pointer-events-auto left-4 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+0.75rem)] sm:left-auto sm:right-3 sm:bottom-3"
        onMouseEnter={warmToolbarChunk}
        onFocus={warmToolbarChunk}
        onTouchStart={warmToolbarChunk}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={toggleEditingLayout}
          className="h-8 px-2.5 rounded-full text-xs font-semibold gap-1.5 shadow-md hover:shadow-lg bg-background/90 dark:bg-card/90 backdrop-blur-md border border-border/80 text-foreground hover:text-primary transition-all duration-200"
          title="开启 DIY 排版与智能编排工坊 (快捷键: E)"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
          <span>DIY 排版工坊</span>
          <kbd className="hidden sm:inline-block sm:pointer-coarse:hidden text-[10px] px-1 py-0.2 bg-muted rounded font-mono">
            E
          </kbd>
        </Button>
      </div>
    </>
  )
}
