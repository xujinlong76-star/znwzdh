'use client'

import React, { useState } from 'react'
import {
  type SharpenerOptions,
  computeCasKernel,
} from '@/lib/video-webgpu-sharpener'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Sparkles, Sliders, CheckCircle2, Cpu } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoShaderFilterProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: SharpenerOptions
  onOptionsChange: (options: SharpenerOptions) => void
}

export function VideoShaderFilterDialog({
  open,
  onOpenChange,
  options,
  onOptionsChange,
}: VideoShaderFilterProps) {
  const [intensity, setIntensity] = useState(options.intensity)
  const kernel = computeCasKernel(intensity)

  const handleApply = () => {
    onOptionsChange({
      ...options,
      intensity,
      enabled: intensity > 0,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            <span>WebGPU 画质超清与代码锐化着色器</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <p className="text-muted-foreground leading-relaxed">
            基于对标 NVIDIA RTX Video Super Resolution 的对比度自适应锐化 (CAS) 卷积核算法，在浏览器本地 GPU / Canvas 实时消除等宽终端字体抗锯齿模糊。
          </p>

          {/* Intensity Slider */}
          <div className="p-3 rounded-lg border bg-card space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground">锐化增强强度</span>
              <span className="font-mono text-emerald-400 font-bold text-sm">
                {(intensity * 100).toFixed(0)}%
              </span>
            </div>

            <input aria-label="滤镜强度"
              type="range"
              min="0"
              max="2.0"
              step="0.1"
              value={intensity}
              onChange={e => setIntensity(parseFloat(e.target.value))}
              className="w-full accent-primary cursor-pointer"
            />

            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>0% (原画)</span>
              <span>100% (标准推荐)</span>
              <span>200% (极限清晰)</span>
            </div>
          </div>

          {/* 3x3 Convolution Kernel Matrix Visualization */}
          <div className="p-3 rounded-lg border bg-zinc-950 font-mono text-[11px] text-zinc-300 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-zinc-500">
              <span>3x3 CAS 动态卷积算子</span>
              <span className="flex items-center gap-1 text-emerald-400">
                <Cpu className="w-3 h-3" /> GPU Compute Ready
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 text-center py-1">
              {kernel.flat().map((val, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "p-1 rounded bg-zinc-900 border border-zinc-800 text-[10px]",
                    val > 0 ? "text-emerald-400 font-bold" : val < 0 ? "text-red-400" : "text-zinc-600"
                  )}
                >
                  {val.toFixed(2)}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" onClick={handleApply}>
              应用画质增强
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
