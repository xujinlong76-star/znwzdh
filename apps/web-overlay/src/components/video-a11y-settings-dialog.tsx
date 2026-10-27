'use client'

import React, { useState } from 'react'
import {
  type ColorVisionMode,
  type A11ySightGuardSettings,
  announceToScreenReader,
} from '@/lib/video-a11y-sight-guard'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import {
  Eye,
  Type,
  Volume2,
  Check,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoA11ySettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: A11ySightGuardSettings
  onSettingsChange: (settings: A11ySightGuardSettings) => void
}

const CVD_MODES: Array<{ id: ColorVisionMode; label: string; desc: string }> = [
  { id: 'normal', label: '默认色彩', desc: '标准 RGB 真实色彩渲染' },
  { id: 'protanopia', label: '红色盲矫正 (Protanopia)', desc: '提升红色通道对比度，增强红/绿区分度' },
  { id: 'deuteranopia', label: '绿色盲矫正 (Deuteranopia)', desc: '调节黄/蓝对比光谱，突出关键终端语法' },
  { id: 'tritanopia', label: '蓝色盲矫正 (Tritanopia)', desc: '强化蓝/绿及青色波长，防止信息混淆' },
  { id: 'high-contrast', label: '超高对比度模式', desc: '提拉明暗边界与代码边缘发光度' },
  { id: 'monochrome', label: '纯净单色护眼模式', desc: '去除彩色疲劳，沉浸于黑白代码架构' },
]

export function VideoA11ySettingsDialog({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
}: VideoA11ySettingsDialogProps) {
  const [localSettings, setLocalSettings] = useState<A11ySightGuardSettings>(settings)

  const handleModeChange = (mode: ColorVisionMode) => {
    const updated = { ...localSettings, colorMode: mode }
    setLocalSettings(updated)
    onSettingsChange(updated)
    announceToScreenReader(`已切换无障碍色彩模式为：${mode}`)
  }

  const handleTestScreenReader = () => {
    announceToScreenReader('无障碍朗读播报功能正常运行，当前播放器已准备就绪。')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Eye className="w-5 h-5 text-primary" />
            <span>无障碍视力守护与全键盘辅助 (a11y)</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <p className="text-muted-foreground leading-relaxed">
            遵循 W3C WCAG 2.2 辅助技术规范，提供色盲色弱实时矩阵滤镜、字号重排与屏幕朗读无障碍播报。
          </p>

          {/* Color modes list */}
          <div className="space-y-1.5">
            <div className="font-medium text-foreground">视力增强与色盲滤镜</div>
            <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto pr-1">
              {CVD_MODES.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleModeChange(item.id)}
                  className={cn(
                    "flex items-center justify-between p-2.5 rounded-lg border text-left transition-all",
                    localSettings.colorMode === item.id
                      ? "border-primary bg-primary/10 text-foreground font-medium"
                      : "border-border/50 hover:bg-accent/40 text-muted-foreground"
                  )}
                >
                  <div>
                    <div className="text-xs text-foreground font-medium">{item.label}</div>
                    <div className="text-[10px] text-muted-foreground">{item.desc}</div>
                  </div>
                  {localSettings.colorMode === item.id && (
                    <Check className="w-4 h-4 text-primary shrink-0 ml-2" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Screen Reader Voice Announcement test */}
          <div className="p-3 rounded-lg border bg-muted/30 flex items-center justify-between">
            <div>
              <div className="font-medium text-foreground">屏幕阅读器 (Screen Reader) 播报测试</div>
              <div className="text-[10px] text-muted-foreground">通过 ARIA Live 通报章节、倍速与弹幕</div>
            </div>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" onClick={handleTestScreenReader}>
              <Volume2 className="w-3.5 h-3.5" /> 测试播报
            </Button>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" onClick={() => onOpenChange(false)}>
              确定
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
