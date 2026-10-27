'use client'

import React, { useState } from 'react'
import {
  type SilenceDetectorConfig,
  type SilenceDetectorState,
} from '@/lib/video-silence-detector'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Zap, VolumeX, Clock, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoSmartSpeedDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: SilenceDetectorConfig
  state: SilenceDetectorState
  onConfigChange: (newConfig: Partial<SilenceDetectorConfig>) => void
}

export function VideoSmartSpeedDialog({
  open,
  onOpenChange,
  config,
  state,
  onConfigChange,
}: VideoSmartSpeedDialogProps) {
  const [threshold, setThreshold] = useState<number>(config.silenceThresholdDb)
  const [skipRate, setSkipRate] = useState<number>(config.skipRate)

  const handleToggle = () => {
    onConfigChange({ enabled: !config.enabled })
  }

  const handleApply = () => {
    onConfigChange({
      silenceThresholdDb: threshold,
      skipRate,
    })
    onOpenChange(false)
  }

  const formatSavedTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60)
    const secs = Math.floor(totalSec % 60)
    if (mins === 0) return `${secs} 秒`
    return `${mins} 分 ${secs} 秒`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Zap className="w-5 h-5 text-amber-500" />
            <span>智能静音跳跃与自适应快进</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <p className="text-muted-foreground leading-relaxed">
            实时分析音频 RMS 响度，检测到讲师停顿、命令编译或静默期时，平滑提速跳跃，恢复语音时无缝回弹正常倍速。
          </p>

          {/* Master Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
            <div>
              <div className="font-medium text-foreground">开启智能静音加速</div>
              <div className="text-[11px] text-muted-foreground">消除沉闷静音，大幅提升高密技术课程学习效率</div>
            </div>
            <input aria-label="启用智能倍速"
              type="checkbox"
              checked={config.enabled}
              onChange={handleToggle}
              className="w-4 h-4 rounded border-border text-amber-500 focus:ring-0 cursor-pointer"
            />
          </div>

          {/* Time Saved Stat */}
          <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <Clock className="w-4 h-4" />
              <span className="font-medium">本次累计节省时间</span>
            </div>
            <span className="font-mono font-bold text-sm text-foreground">
              {formatSavedTime(state.totalTimeSavedSec)}
            </span>
          </div>

          {/* Current Live dB Meter */}
          <div className="space-y-1.5 p-3 rounded-lg border bg-zinc-950 text-zinc-300 font-mono text-[11px]">
            <div className="flex items-center justify-between text-[10px] text-zinc-400">
              <span className="flex items-center gap-1">
                <VolumeX className="w-3 h-3 text-red-400" /> 实时输入响度
              </span>
              <span className={state.isSilent ? "text-amber-400 font-bold" : "text-emerald-400"}>
                {state.currentLoudnessDb.toFixed(1)} dBFS {state.isSilent && " [静音加速中]"}
              </span>
            </div>
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all duration-100",
                  state.isSilent ? "bg-amber-500" : "bg-emerald-500"
                )}
                style={{ width: `${Math.max(2, Math.min(100, (state.currentLoudnessDb + 100)))}%` }}
              />
            </div>
          </div>

          {/* Settings Sliders */}
          <div className="space-y-3 border p-3 rounded-lg bg-card">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-foreground">静音分贝门限值</span>
                <span className="font-mono text-muted-foreground">{threshold} dBFS</span>
              </div>
              <input aria-label="静音跳过阈值（分贝）"
                type="range"
                min="-60"
                max="-25"
                step="1"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <div className="text-[10px] text-muted-foreground">低于此分贝视为无声静止片段（推荐 -42 dBFS）</div>
            </div>

            <div className="space-y-1 pt-2 border-t border-border/40">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-foreground">静音期加速倍率</span>
                <span className="font-mono text-amber-500 font-bold">{skipRate}x</span>
              </div>
              <div className="flex gap-2 pt-1">
                {[2.0, 2.5, 3.0, 3.5].map((rate) => (
                  <Button
                    key={rate}
                    size="sm"
                    variant={skipRate === rate ? 'default' : 'outline'}
                    className="flex-1 h-7 text-xs font-mono"
                    onClick={() => setSkipRate(rate)}
                  >
                    {rate}x
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" onClick={handleApply}>
              保存配置
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
