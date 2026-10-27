'use client'

import React, { useState, useEffect } from 'react'
import {
  type RecognizedGestureEvent,
  AirGestureTracker,
} from '@/lib/video-air-gesture-tracker'
import { Button } from '@/registry/new-york/ui/button'
import { Hand, Camera, Eye, Zap, VolumeX, Play, Pause, ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoGestureHudOverlayProps {
  enabled: boolean
  onToggle: () => void
  onAction?: (action: RecognizedGestureEvent['action']) => void
}

export function VideoGestureHudOverlay({
  enabled,
  onToggle,
  onAction,
}: VideoGestureHudOverlayProps) {
  const [lastEvent, setLastEvent] = useState<RecognizedGestureEvent | null>(null)
  const [pulse, setPulse] = useState<boolean>(false)

  const handleSimulateGesture = (
    gesture: RecognizedGestureEvent['gesture'],
    action: RecognizedGestureEvent['action'],
    description: string
  ) => {
    const ev: RecognizedGestureEvent = {
      gesture,
      action,
      description,
      confidence: 0.95,
      timestamp: Date.now(),
    }
    setLastEvent(ev)
    setPulse(true)
    setTimeout(() => setPulse(false), 800)
    if (onAction) onAction(action)
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between p-2 rounded-lg border border-border/50 bg-card">
        <div className="flex items-center gap-2">
          <Hand className={cn('w-4 h-4', enabled ? 'text-primary' : 'text-muted-foreground')} />
          <span className="font-semibold text-foreground">端侧空间手势控制 (Air-Gesture)</span>
        </div>
        <Button
          size="sm"
          variant={enabled ? 'secondary' : 'outline'}
          className="h-7 text-xs px-2.5 gap-1"
          onClick={onToggle}
        >
          <Camera className="w-3 h-3" />
          <span>{enabled ? '已开启手势' : '启用手势'}</span>
        </Button>
      </div>

      {enabled && (
        <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-2.5 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
              <Eye className="w-3.5 h-3.5 text-primary" />
              <span>端侧 21 点手部关键点视觉跟踪运行中 (100% 内存离线，无影像上传)</span>
            </span>
            {lastEvent && (
              <span
                className={cn(
                  'px-2 py-0.5 rounded font-mono font-bold text-[10px] transition-all',
                  pulse ? 'scale-110 bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                )}
              >
                {lastEvent.description}
              </span>
            )}
          </div>

          {/* Quick simulation buttons for testing & accessibility */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2 gap-1"
              onClick={() => handleSimulateGesture('pinch', 'toggle_play', '隔空捏合：播放/暂停')}
            >
              <Play className="w-2.5 h-2.5" /> 捏合 (播放)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2 gap-1"
              onClick={() => handleSimulateGesture('open_palm', 'pause', '张开五指：暂停画面')}
            >
              <Pause className="w-2.5 h-2.5" /> 展开手掌 (暂停)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2 gap-1"
              onClick={() => handleSimulateGesture('swipe_left', 'seek_back', '向左挥掌：快退 10 秒')}
            >
              <ChevronLeft className="w-2.5 h-2.5" /> 左挥 (-10s)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2 gap-1"
              onClick={() => handleSimulateGesture('swipe_right', 'seek_forward', '向右挥掌：快进 10 秒')}
            >
              <ChevronRight className="w-2.5 h-2.5" /> 右挥 (+10s)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2 gap-1"
              onClick={() => handleSimulateGesture('index_point_up', 'toggle_mute', '竖起食指：静音')}
            >
              <VolumeX className="w-2.5 h-2.5" /> 食指竖起 (静音)
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
