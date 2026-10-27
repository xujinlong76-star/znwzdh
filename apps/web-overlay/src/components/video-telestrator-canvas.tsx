'use client'

import React, { useRef, useState, useEffect, useCallback } from 'react'
import {
  type TelestratorStroke,
  type TelestratorTool,
  type Point2D,
  smoothStrokePoints,
  getStrokeDisplayOpacity,
  TelestratorManager,
} from '@/lib/video-telestrator'
import {
  PenTool,
  Highlighter,
  ArrowUpRight,
  Square,
  Undo2,
  Redo2,
  Trash2,
  X,
  Palette,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { cn } from '@/lib/utils'

interface VideoTelestratorCanvasProps {
  videoId: string
  currentSec: number
  isActive: boolean
  onClose: () => void
}

const COLOR_PALETTE = [
  { label: 'Cyan', hex: '#38bdf8' },
  { label: 'Amber', hex: '#fbbf24' },
  { label: 'Emerald', hex: '#34d399' },
  { label: 'Rose', hex: '#fb7185' },
  { label: 'Violet', hex: '#a78bfa' },
]

export function VideoTelestratorCanvas({
  videoId,
  currentSec,
  isActive,
  onClose,
}: VideoTelestratorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const managerRef = useRef<TelestratorManager>(new TelestratorManager(videoId))
  const [selectedTool, setSelectedTool] = useState<TelestratorTool>('pen')
  const [currentColor, setCurrentColor] = useState<string>('#38bdf8')
  const [lineWidth, setLineWidth] = useState<number>(3)
  const [isDrawing, setIsDrawing] = useState<boolean>(false)
  const [currentPoints, setCurrentPoints] = useState<Point2D[]>([])

  // Re-sync manager if video changes
  useEffect(() => {
    managerRef.current = new TelestratorManager(videoId)
  }, [videoId])

  // Redraw canvas whenever current time or drawing state updates
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const activeStrokes = managerRef.current.getActiveStrokes(currentSec)

    // Draw saved active strokes
    for (const stroke of activeStrokes) {
      const opacity = getStrokeDisplayOpacity(stroke, currentSec)
      if (opacity <= 0.01) continue

      ctx.save()
      ctx.globalAlpha = opacity
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.lineWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      if (stroke.points.length > 1) {
        ctx.beginPath()
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
        }
        ctx.stroke()
      }
      ctx.restore()
    }

    // Draw stroke currently being drawn by user
    if (currentPoints.length > 1) {
      ctx.save()
      ctx.globalAlpha = selectedTool === 'highlighter' ? 0.45 : 0.95
      ctx.strokeStyle = currentColor
      ctx.lineWidth = selectedTool === 'highlighter' ? lineWidth * 3 : lineWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      ctx.beginPath()
      ctx.moveTo(currentPoints[0].x, currentPoints[0].y)
      for (let i = 1; i < currentPoints.length; i++) {
        ctx.lineTo(currentPoints[i].x, currentPoints[i].y)
      }
      ctx.stroke()
      ctx.restore()
    }
  }, [currentSec, currentPoints, selectedTool, currentColor, lineWidth])

  useEffect(() => {
    redraw()
  }, [redraw])

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isActive) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setIsDrawing(true)
    setCurrentPoints([{ x, y }])
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setCurrentPoints(prev => [...prev, { x, y }])
  }

  const handlePointerUp = () => {
    if (!isDrawing) return
    setIsDrawing(false)

    if (currentPoints.length > 1) {
      const smoothed = smoothStrokePoints(currentPoints)
      const newStroke: TelestratorStroke = {
        id: `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        tool: selectedTool,
        color: currentColor,
        lineWidth: selectedTool === 'highlighter' ? lineWidth * 3 : lineWidth,
        opacity: selectedTool === 'highlighter' ? 0.45 : 0.95,
        points: smoothed,
        timeSec: currentSec,
        durationSec: 6.0, // Stays visible for 6 seconds
      }
      managerRef.current.addStroke(newStroke)
    }
    setCurrentPoints([])
  }

  if (!isActive) return null

  return (
    <div className="absolute inset-0 z-40 pointer-events-auto select-none">
      {/* Interactive Drawing Canvas */}
      <canvas
        ref={canvasRef}
        width={960}
        height={540}
        className="w-full h-full cursor-crosshair touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />

      {/* Floating Toolbar */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 p-1.5 rounded-xl bg-zinc-950/85 backdrop-blur border border-zinc-800 text-zinc-200 shadow-2xl">
        <Button
          size="icon"
          variant="ghost"
          className={cn("h-8 w-8", selectedTool === 'pen' && "bg-white/20 text-white")}
          onClick={() => setSelectedTool('pen')}
          title="平滑自由画笔"
        >
          <PenTool className="w-4 h-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className={cn("h-8 w-8", selectedTool === 'highlighter' && "bg-white/20 text-white")}
          onClick={() => setSelectedTool('highlighter')}
          title="荧光半透明标记笔"
        >
          <Highlighter className="w-4 h-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className={cn("h-8 w-8", selectedTool === 'arrow' && "bg-white/20 text-white")}
          onClick={() => setSelectedTool('arrow')}
          title="标注箭头"
        >
          <ArrowUpRight className="w-4 h-4" />
        </Button>

        <div className="w-px h-5 bg-zinc-800 mx-0.5" />

        {/* Color Palette */}
        <div className="flex items-center gap-1">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c.hex}
              onClick={() => setCurrentColor(c.hex)}
              className={cn(
                "w-5 h-5 rounded-full transition-transform",
                currentColor === c.hex ? "scale-125 ring-2 ring-white/60" : "hover:scale-110"
              )}
              style={{ backgroundColor: c.hex }}
              title={c.label}
            />
          ))}
        </div>

        <div className="w-px h-5 bg-zinc-800 mx-0.5" />

        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => {
            managerRef.current.undo()
            redraw()
          }}
          title="撤销"
        >
          <Undo2 className="w-4 h-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => {
            managerRef.current.redo()
            redraw()
          }}
          title="重做"
        >
          <Redo2 className="w-4 h-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-red-400 hover:text-red-300"
          onClick={() => {
            managerRef.current.clear()
            redraw()
          }}
          title="清空白板"
        >
          <Trash2 className="w-4 h-4" />
        </Button>

        <div className="w-px h-5 bg-zinc-800 mx-0.5" />

        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-zinc-400 hover:text-white"
          onClick={onClose}
          title="退出涂鸦画板"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
