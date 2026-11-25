'use client'

/**
 * 「外观与阅读」紧凑聚合浮层（P1-4 顶栏瘦身融合）：
 * 将原桌面顶栏右侧平铺的 5 个显示/无障碍开关（字号 AA / 高对比度 / 深浅主题 / 长辈模式 / 卡片密度）
 * 收口为 1 个清爽浮层按钮，顶栏右侧立减 3 个独立图标；
 * 移动端 <sm 仍保留独立一键 AA 字号按钮在外（A13 长辈刚需），浮层内同样提供全部开关与完整外观/向导入口。
 */
import { useState } from 'react'
import { Palette, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ModeToggle } from '@/components/mode-toggle'
import { FontSizeToggle } from '@/components/font-size-toggle'
import { HighContrastToggle } from '@/components/high-contrast-toggle'
import { ElderModeToggle } from '@/components/elder-mode-toggle'
import { DensityToggle } from '@/components/density-toggle'

export interface AppearanceQuickPopoverProps {
  onOpenAppearanceGuide?: () => void
}

export function AppearanceQuickPopover({
  onOpenAppearanceGuide,
}: AppearanceQuickPopoverProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          title="外观与阅读设置（深浅主题 / 字号 / 高对比 / 长辈模式 / 密度）"
          aria-label="打开外观与阅读设置"
        >
          <Palette className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        collisionPadding={8}
        className="w-[min(18rem,calc(100vw-1rem))] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
      >
        <div className="mb-2.5 flex items-center justify-between border-b border-border/60 pb-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Palette className="h-3.5 w-3.5 text-primary" />
            <span>外观与阅读</span>
          </div>
          <span className="text-[11px] text-muted-foreground">即时生效</span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5">
            <div>
              <p className="text-xs font-medium text-foreground">字号大小</p>
              <p className="text-[11px] text-muted-foreground">标准 / 大字 / 特大</p>
            </div>
            <FontSizeToggle />
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5">
            <div>
              <p className="text-xs font-medium text-foreground">高对比度</p>
              <p className="text-[11px] text-muted-foreground">增强边框与文字清晰度</p>
            </div>
            <HighContrastToggle />
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5">
            <div>
              <p className="text-xs font-medium text-foreground">深色 / 浅色</p>
              <p className="text-[11px] text-muted-foreground">切换界面色彩主题</p>
            </div>
            <ModeToggle />
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5">
            <div>
              <p className="text-xs font-medium text-foreground">长辈关怀 & 卡片密度</p>
              <p className="text-[11px] text-muted-foreground">一键放大或调整排布疏密</p>
            </div>
            <div className="flex items-center gap-1">
              <ElderModeToggle />
              <DensityToggle />
            </div>
          </div>
        </div>

        {onOpenAppearanceGuide ? (
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onOpenAppearanceGuide()
            }}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>皮肤、壁纸、新手向导与 DIY 排版</span>
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
