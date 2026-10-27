'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  AudioStemMixerController,
  type StemVolumeSettings,
  type StemMetersDb,
} from '@/lib/video-audio-stem-separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Sliders, Volume2, VolumeX, Radio, Sparkles, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoAudioStemMixerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VideoAudioStemMixerDialog({
  open,
  onOpenChange,
}: VideoAudioStemMixerDialogProps) {
  const mixerRef = useRef<AudioStemMixerController>(new AudioStemMixerController())
  const [settings, setSettings] = useState<StemVolumeSettings>(() => mixerRef.current.getSettings())
  const [meters, setMeters] = useState<StemMetersDb>({
    voiceDb: -18.2,
    musicDb: -26.4,
    percussionDb: -34.0,
    masterDb: -14.8,
  })

  useEffect(() => {
    const unsub = mixerRef.current.subscribe(setSettings)
    // Simulate live audio meter pulsation
    const timer = setInterval(() => {
      if (!open) return
      setMeters({
        voiceDb: Math.round((-14 - Math.random() * 8) * 10) / 10,
        musicDb: Math.round((-22 - Math.random() * 10) * 10) / 10,
        percussionDb: Math.round((-30 - Math.random() * 12) * 10) / 10,
        masterDb: Math.round((-12 - Math.random() * 6) * 10) / 10,
      })
    }, 200)
    return () => {
      unsub()
      clearInterval(timer)
    }
  }, [open])

  const renderMeterBar = (db: number) => {
    // Map -60dB -> 0%, 0dB -> 100%
    const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100))
    const isClip = db > -3
    return (
      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden flex items-center">
        <div
          className={cn(
            'h-full transition-all duration-150',
            isClip ? 'bg-rose-500' : 'bg-emerald-500'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sliders className="w-5 h-5 text-primary" />
            <span>多轨音频解耦与人声/伴奏独立混音台 (HPSS DSP)</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <p className="text-muted-foreground leading-relaxed">
            基于谐波-打击乐分离（HPSS）算法将音频拆分为人声、伴奏与敲击杂音三轨，可单独压低背景音乐推高导师讲解声。
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-lg border border-border/50 bg-card">
            {/* 1. Voice Stem */}
            <div className="space-y-2 text-center p-2 rounded-md bg-muted/40 border border-border/40">
              <div className="flex items-center justify-between font-semibold">
                <span>🎤 导师人声</span>
                <span className="font-mono text-[11px] text-primary">
                  {Math.round(settings.voiceGain * 100)}%
                </span>
              </div>
              {renderMeterBar(settings.voiceMuted ? -60 : meters.voiceDb)}
              <input aria-label="人声增益"
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={settings.voiceGain}
                onChange={e => mixerRef.current.setGain('voice', parseFloat(e.target.value))}
                className="w-full accent-primary h-1 bg-muted rounded cursor-pointer"
              />
              <div className="flex justify-center gap-1.5 pt-1">
                <Button
                  size="sm"
                  variant={settings.voiceMuted ? 'destructive' : 'outline'}
                  className="h-6 text-[10px] px-1.5"
                  onClick={() => mixerRef.current.toggleMute('voice')}
                >
                  {settings.voiceMuted ? '已静音' : '静音'}
                </Button>
                <Button
                  size="sm"
                  variant={settings.soloStem === 'voice' ? 'default' : 'outline'}
                  className="h-6 text-[10px] px-1.5"
                  onClick={() => mixerRef.current.setSolo('voice')}
                >
                  独奏
                </Button>
              </div>
            </div>

            {/* 2. Music Stem */}
            <div className="space-y-2 text-center p-2 rounded-md bg-muted/40 border border-border/40">
              <div className="flex items-center justify-between font-semibold">
                <span>🎵 背景旋律</span>
                <span className="font-mono text-[11px] text-primary">
                  {Math.round(settings.musicGain * 100)}%
                </span>
              </div>
              {renderMeterBar(settings.musicMuted ? -60 : meters.musicDb)}
              <input aria-label="伴奏增益"
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={settings.musicGain}
                onChange={e => mixerRef.current.setGain('music', parseFloat(e.target.value))}
                className="w-full accent-primary h-1 bg-muted rounded cursor-pointer"
              />
              <div className="flex justify-center gap-1.5 pt-1">
                <Button
                  size="sm"
                  variant={settings.musicMuted ? 'destructive' : 'outline'}
                  className="h-6 text-[10px] px-1.5"
                  onClick={() => mixerRef.current.toggleMute('music')}
                >
                  {settings.musicMuted ? '已静音' : '静音'}
                </Button>
                <Button
                  size="sm"
                  variant={settings.soloStem === 'music' ? 'default' : 'outline'}
                  className="h-6 text-[10px] px-1.5"
                  onClick={() => mixerRef.current.setSolo('music')}
                >
                  独奏
                </Button>
              </div>
            </div>

            {/* 3. Percussion / Ambient */}
            <div className="space-y-2 text-center p-2 rounded-md bg-muted/40 border border-border/40">
              <div className="flex items-center justify-between font-semibold">
                <span>⌨️ 打击与杂音</span>
                <span className="font-mono text-[11px] text-primary">
                  {Math.round(settings.percussionGain * 100)}%
                </span>
              </div>
              {renderMeterBar(settings.percussionMuted ? -60 : meters.percussionDb)}
              <input aria-label="打击乐增益"
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={settings.percussionGain}
                onChange={e => mixerRef.current.setGain('percussion', parseFloat(e.target.value))}
                className="w-full accent-primary h-1 bg-muted rounded cursor-pointer"
              />
              <div className="flex justify-center gap-1.5 pt-1">
                <Button
                  size="sm"
                  variant={settings.percussionMuted ? 'destructive' : 'outline'}
                  className="h-6 text-[10px] px-1.5"
                  onClick={() => mixerRef.current.toggleMute('percussion')}
                >
                  {settings.percussionMuted ? '已静音' : '静音'}
                </Button>
                <Button
                  size="sm"
                  variant={settings.soloStem === 'percussion' ? 'default' : 'outline'}
                  className="h-6 text-[10px] px-1.5"
                  onClick={() => mixerRef.current.setSolo('percussion')}
                >
                  独奏
                </Button>
              </div>
            </div>
          </div>

          {/* Master Bus Controls */}
          <div className="p-3 rounded-lg border border-border/50 bg-muted/20 flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="font-semibold text-foreground">总输出增益 (Master Bus)</p>
              <p className="text-[11px] text-muted-foreground font-mono">
                当前电平: {meters.masterDb} dBFS
              </p>
            </div>
            <div className="flex items-center gap-3">
              <input aria-label="总音量增益"
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                value={settings.masterGain}
                onChange={e => mixerRef.current.setGain('master', parseFloat(e.target.value))}
                className="w-32 accent-primary h-1 bg-muted rounded cursor-pointer"
              />
              <span className="font-mono font-bold w-12 text-right">
                {Math.round(settings.masterGain * 100)}%
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                mixerRef.current.updateSettings({
                  voiceGain: 1.0,
                  musicGain: 0.7,
                  percussionGain: 0.4,
                  masterGain: 1.0,
                  voiceMuted: false,
                  musicMuted: false,
                  percussionMuted: false,
                  soloStem: null,
                })
              }}
            >
              重置预设
            </Button>
            <Button size="sm" onClick={() => onOpenChange(false)}>
              确定应用
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
