'use client'

import React, { useState, useEffect } from 'react'
import {
  createVoiceCommander,
  type VoiceCommandIntent,
} from '@/lib/video-voice-commander'
import { Mic, MicOff, Sparkles } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { cn } from '@/lib/utils'

interface VideoVoiceIndicatorProps {
  onCommand: (intent: VoiceCommandIntent) => void
  className?: string
}

export function VideoVoiceIndicator({
  onCommand,
  className,
}: VideoVoiceIndicatorProps) {
  const [isListening, setIsListening] = useState(false)
  const [lastIntentText, setLastIntentText] = useState<string | null>(null)
  const [commander] = useState(() => createVoiceCommander())

  useEffect(() => {
    const unsubscribe = commander.onIntent((intent) => {
      setLastIntentText(`识别指令: ${intent.rawText}`)
      onCommand(intent)
      const timer = setTimeout(() => setLastIntentText(null), 3000)
      return () => clearTimeout(timer)
    })
    return () => unsubscribe()
  }, [commander, onCommand])

  const toggleListening = () => {
    if (isListening) {
      commander.stop()
      setIsListening(false)
    } else {
      const ok = commander.start()
      setIsListening(ok)
    }
  }

  return (
    <div className={cn("relative flex items-center", className)}>
      <Button
        size="icon"
        variant={isListening ? "default" : "ghost"}
        onClick={toggleListening}
        className={cn(
          "relative transition-all",
          isListening && "bg-red-500 hover:bg-red-600 text-white animate-pulse"
        )}
        title={isListening ? "正在聆听语音指令 (点击关闭)" : "开启双手解放语音助手 (如'暂停'、'快退10秒')"}
      >
        {isListening ? (
          <Mic className="w-4 h-4 animate-bounce" />
        ) : (
          <MicOff className="w-4 h-4 text-muted-foreground" />
        )}
      </Button>

      {/* Floating Recognized Intent Toast */}
      {lastIntentText && (
        <div className="absolute top-12 right-0 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="px-2.5 py-1.5 rounded-lg bg-zinc-950/90 text-zinc-100 text-[11px] font-medium border border-zinc-700 shadow-xl backdrop-blur flex items-center gap-1.5 whitespace-nowrap">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{lastIntentText}</span>
          </div>
        </div>
      )}
    </div>
  )
}
