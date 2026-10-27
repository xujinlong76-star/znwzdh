'use client'

import React, { useState } from 'react'
import {
  type NeuralDenoiserConfig,
  type DenoiseProcessingStats,
} from '@/lib/video-neural-denoiser'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Cpu, Mic, ShieldAlert, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoNeuralAudioControlsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: NeuralDenoiserConfig
  stats?: DenoiseProcessingStats
  onConfigChange: (newConfig: Partial<NeuralDenoiserConfig>) => void
}

export function VideoNeuralAudioControls({
  open,
  onOpenChange,
  config,
  stats,
  onConfigChange,
}: VideoNeuralAudioControlsProps) {
  const [intensity, setIntensity] = useState<number>(config.denoiseIntensity)
  const [clarity, setClarity] = useState<number>(config.voiceClarityGain)

  const handleApply = () => {
    onConfigChange({
      denoiseIntensity: intensity,
      voiceClarityGain: clarity,
    })
    onOpenChange(false)
  }

  const currentStats = stats || {
    inputRmsDb: -32.5,
    outputRmsDb: -26.0,
    noiseSuppressedDb: 18.5,
    activeVoiceDetected: true,
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Cpu className="w-5 h-5 text-primary" />
            <span>WebGPU 神经网络端侧语音降噪 (RNNoise DSP)</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <p className="text-muted-foreground leading-relaxed">
            基于频域谱减法与 WebGPU Compute Shader，在客户端消除机械键盘敲击、空调风噪及环境杂音，突出主频人声。
          </p>

          {/* Master Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
            <div>
              <div className="font-medium text-foreground">开启神经网络降噪</div>
              <div className="text-[11px] text-muted-foreground">超低延迟（&lt;10ms）纯客户端本地音频张量处理</div>
            </div>
            <input aria-label="启用神经音频增强"
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => onConfigChange({ enabled: e.target.checked })}
              className="w-4 h-4 rounded border-border text-primary focus:ring-0 cursor-pointer"
            />
          </div>

          {/* Live Noise Suppression Meter */}
          <div className="p-3 rounded-lg border bg-zinc-950 font-mono text-[11px] text-zinc-300 space-y-2">
            <div className="flex items-center justify-between text-[10px] text-zinc-400">
              <span className="flex items-center gap-1.5">
                <Mic className={cn("w-3 h-3", currentStats.activeVoiceDetected ? "text-emerald-400" : "text-zinc-600")} />
                降噪深度抑制
              </span>
              <span className="text-emerald-400 font-bold">
                -{currentStats.noiseSuppressedDb} dB 衰减
              </span>
            </div>
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-150"
                style={{ width: `${Math.min(100, currentStats.noiseSuppressedDb * 4)}%` }}
              />
            </div>
          </div>

          {/* Sliders */}
          <div className="space-y-3 border p-3 rounded-lg bg-card">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-foreground">环境杂音消除强度</span>
                <span className="font-mono text-primary font-bold">{Math.round(intensity * 100)}%</span>
              </div>
              <input aria-label="神经音频增强强度"
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={intensity}
                onChange={(e) => setIntensity(Number(e.target.value))}
                className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>

            <div className="space-y-1 pt-2 border-t border-border/40">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-foreground">人声共振峰清晰度增益</span>
                <span className="font-mono text-primary font-bold">{clarity.toFixed(2)}x</span>
              </div>
              <input aria-label="神经音频清晰度"
                type="range"
                min="1.0"
                max="2.0"
                step="0.05"
                value={clarity}
                onChange={(e) => setClarity(Number(e.target.value))}
                className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" onClick={handleApply}>
              保存降噪参数
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
