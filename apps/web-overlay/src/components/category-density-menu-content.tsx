'use client'

/**
 * 分类头 📐 菜单内容（Bundle 瘦身第二刀）。
 *
 * 从 category-in-situ-controls.tsx 抽出的 DropdownMenuContent 子树（宽度 4 预设、
 * 高度 4 预设、重置项、5 个密度项，约 7KB 代码）：只在用户打开菜单时经
 * next/dynamic 按需加载，平时不进 `/` 初始 chunk。
 *
 * 纯展示 + 回调 props：不 import useHomeDIY / useModuleWindowSize / useToast
 *（状态写回与 toast 都在父组件的回调里完成），不把 hook 引用链带回异步
 * chunk；类型只用 `import type`（擦除、零运行时成本）。
 */
import { Check } from 'lucide-react'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/registry/new-york/ui/dropdown-menu'
import type { CardDisplayMode } from '@/lib/modular/home-diy-storage'
import {
  CARD_DISPLAY_MODE_OPTIONS,
  normalizeCardDisplayMode,
} from '@/lib/modular/card-display-modes'
import { cn } from '@/lib/utils'

export interface CategoryDensityMenuContentProps {
  categoryId: string
  title: string
  colSpan: number
  heightPx: number | undefined
  isCustomSized: boolean
  currentDensity: CardDisplayMode | undefined
  onSelectWidth: (colSpan: number, label: string) => void
  onSelectHeight: (heightPx: number | undefined, label: string) => void
  onResetSize: () => void
  onSelectDensity: (mode: CardDisplayMode | undefined) => void
}

export default function CategoryDensityMenuContent({
  colSpan,
  heightPx,
  isCustomSized,
  currentDensity,
  onSelectWidth,
  onSelectHeight,
  onResetSize,
  onSelectDensity,
}: CategoryDensityMenuContentProps) {
  return (
    <DropdownMenuContent align="end" className="w-56 p-1.5">
      <DropdownMenuLabel className="text-[11px] text-muted-foreground px-1.5 py-1 flex items-center justify-between">
        <span>↔️ 模块左右宽度 (或拖拽左右边)</span>
        <span className="font-mono text-[10px] text-primary">{colSpan}/12列</span>
      </DropdownMenuLabel>
      <div className="grid grid-cols-4 gap-1 px-1 pb-1.5">
        {[
          { label: '1/3宽', col: 4 },
          { label: '1/2半屏', col: 6 },
          { label: '2/3宽', col: 8 },
          { label: '全宽', col: 12 },
        ].map((preset) => (
          <button
            key={preset.col}
            type="button"
            onClick={() => onSelectWidth(preset.col, preset.label)}
            className={cn(
              "px-1.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer border",
              colSpan === preset.col
                ? "bg-primary text-primary-foreground border-primary font-semibold"
                : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border-border/50"
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <DropdownMenuLabel className="text-[11px] text-muted-foreground px-1.5 py-1 flex items-center justify-between border-t border-border/50 pt-1.5">
        <span>↕️ 模块上下高度 (或拖拽上下边)</span>
        <span className="font-mono text-[10px] text-primary">{heightPx ? `${heightPx}px` : '自适应'}</span>
      </DropdownMenuLabel>
      <div className="grid grid-cols-4 gap-1 px-1 pb-1.5">
        {[
          { label: '紧凑', h: 320 },
          { label: '标准', h: 480 },
          { label: '高窗', h: 680 },
          { label: '自适应', h: undefined },
        ].map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onSelectHeight(preset.h, preset.label)}
            className={cn(
              "px-1.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer border",
              heightPx === preset.h
                ? "bg-primary text-primary-foreground border-primary font-semibold"
                : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border-border/50"
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {isCustomSized && (
        <DropdownMenuItem
          onClick={onResetSize}
          className="text-xs text-amber-700 dark:text-amber-400 font-medium cursor-pointer justify-center mb-1"
        >
          🔄 重置此模块窗口尺寸
        </DropdownMenuItem>
      )}

      <DropdownMenuSeparator className="my-1" />
      <DropdownMenuLabel className="text-[11px] text-muted-foreground px-1.5 py-1">
        类目展示样式覆盖
      </DropdownMenuLabel>
      <DropdownMenuItem
        onClick={() => onSelectDensity(undefined)}
        className={cn("text-xs flex items-center justify-between cursor-pointer", !currentDensity && "font-bold text-primary")}
      >
        <span>默认 (跟随全局)</span>
        {!currentDensity && <Check className="w-3.5 h-3.5 text-primary" />}
      </DropdownMenuItem>
      {CARD_DISPLAY_MODE_OPTIONS.map((opt) => {
        const active = Boolean(currentDensity) && normalizeCardDisplayMode(currentDensity) === opt.id
        return (
          <DropdownMenuItem
            key={opt.id}
            onClick={() => onSelectDensity(opt.id)}
            className={cn("text-xs flex items-center justify-between cursor-pointer", active && "font-bold text-primary")}
          >
            <span>{opt.label} ({opt.enLabel})</span>
            {active && <Check className="w-3.5 h-3.5 text-primary" />}
          </DropdownMenuItem>
        )
      })}
    </DropdownMenuContent>
  )
}
