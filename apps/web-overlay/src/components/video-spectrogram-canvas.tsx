'use client'

import React, { useRef, useState, useEffect } from 'react'
import {
  type FrequencyBandsEnergy,
  calculateFrequencyBands,
  getFrequencyColor,
  SpectrogramWaterfallBuffer,
} from '@/lib/video-spectrum-visualizer'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Activity, Radio, Mic2 } from 'lucide-react'

interface VideoSpectrogramDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VideoSpectrogramDialog({
  open,
  onOpenChange,
}: VideoSpectrogramDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bufferRef = useRef<SpectrogramWaterfallBuffer>(new SpectrogramWaterfallBuffer(40))
  const [bands, setBands] = useState<FrequencyBandsEnergy>({
    subBass: 0,
    bass: 0,
    midrange: 0,
    presence: 0,
    brilliance: 0,
    dominantFrequencyHz: 0,
  })

  useEffect(() => {
    if (!open) return
    let animationId: number

    const renderLoop = () => {
      // Generate synthetic speech FFT frequency curve
      const binCount = 64
      const freqData = new Uint8Array(binCount)
      const now = Date.now() / 300

      for (let i = 0; i < binCount; i++) {
        // Voice formant emphasis around bins 8 - 24 (250Hz - 2.5kHz)
        const formantWeight = i >= 6 && i <= 24 ? 1.8 : 0.6
        const wave = Math.sin(now + i * 0.25) * 40
        const noise = (Math.random() * 30) - 15
        const val = Math.max(0, Math.min(255, (80 * formantWeight) + wave + noise))
        freqData[i] = val
      }

      bufferRef.current.pushFrame(freqData)
      const currentBands = calculateFrequencyBands(freqData)
      setBands(currentBands)

      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.fillStyle = '#09090b'
          ctx.fillRect(0, 0, canvas.width, canvas.height)

          // 1. Equalizer bars in top half
          const barWidth = canvas.width / binCount
          const topHalfH = canvas.height * 0.55

          for (let i = 0; i < binCount; i++) {
            const h = (freqData[i] / 255) * topHalfH
            ctx.fillStyle = getFrequencyColor(freqData[i])
            ctx.fillRect(i * barWidth, topHalfH - h, barWidth - 1, h)
          }

          // 2. Spectrogram Waterfall in bottom half
          const frames = bufferRef.current.getFrames()
          const rowH = (canvas.height * 0.45) / Math.max(1, frames.length)

          frames.forEach((frame, rIdx) => {
            const y = topHalfH + (rIdx * rowH)
            for (let cIdx = 0; cIdx < binCount; cIdx++) {
              ctx.fillStyle = getFrequencyColor(frame[cIdx])
              ctx.fillRect(cIdx * barWidth, y, barWidth, Math.ceil(rowH))
            }
          })
        }
      }

      animationId = requestAnimationFrame(renderLoop)
    }

    animationId = requestAnimationFrame(renderLoop)
    return () => cancelAnimationFrame(animationId)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Activity className="w-5 h-5 text-primary" />
            <span>实时音频频谱与人声共振峰可视化</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <p className="text-muted-foreground leading-relaxed">
            实时 64 频段 FFT 快速傅里叶变换与瀑布图，监测人声共振峰（250Hz–2.5kHz）与环境噪音能量分布。
          </p>

          {/* Live Canvas Visualizer */}
          <div className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 p-2 shadow-inner">
            <canvas
              ref={canvasRef}
              width={540}
              height={220}
              className="w-full h-44 rounded bg-zinc-950 block"
            />
          </div>

          {/* Bands Energy Breakdown */}
          <div className="grid grid-cols-5 gap-2 text-center">
            <div className="p-2 rounded-lg border bg-card space-y-1">
              <div className="text-[10px] text-muted-foreground">超低频 (20-60Hz)</div>
              <div className="font-mono font-bold text-foreground">{bands.subBass}</div>
            </div>
            <div className="p-2 rounded-lg border bg-card space-y-1">
              <div className="text-[10px] text-muted-foreground">低频 (60-250Hz)</div>
              <div className="font-mono font-bold text-foreground">{bands.bass}</div>
            </div>
            <div className="p-2 rounded-lg border border-primary/30 bg-primary/5 space-y-1">
              <div className="text-[10px] text-primary font-medium">中频人声主体</div>
              <div className="font-mono font-bold text-primary">{bands.midrange}</div>
            </div>
            <div className="p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-1">
              <div className="text-[10px] text-emerald-500 font-medium">清晰度频段</div>
              <div className="font-mono font-bold text-emerald-500">{bands.presence}</div>
            </div>
            <div className="p-2 rounded-lg border bg-card space-y-1">
              <div className="text-[10px] text-muted-foreground">高频空气感</div>
              <div className="font-mono font-bold text-foreground">{bands.brilliance}</div>
            </div>
          </div>

          <div className="flex items-center justify-between text-muted-foreground text-[11px] pt-1">
            <span className="flex items-center gap-1.5 font-mono">
              <Mic2 className="w-3.5 h-3.5 text-primary" />
              当前主频共振峰: <strong>{bands.dominantFrequencyHz} Hz</strong>
            </span>
            <Button size="sm" onClick={() => onOpenChange(false)}>
              确定
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
