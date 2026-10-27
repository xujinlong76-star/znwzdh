'use client'

import React, { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Languages, Volume2, Mic, Play, Square, Sparkles, Sliders } from 'lucide-react'
import {
  type SupportedLanguage,
  type TTSVoiceConfig,
  SyntheticTTSController,
  generateBilingualCues,
} from '@/lib/video-bilingual-trans-tts'
import type { VideoTranscriptItem } from '@/types/navigation'

interface VideoBilingualTtsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transcripts?: VideoTranscriptItem[]
}

const ttsController = new SyntheticTTSController()

export function VideoBilingualTtsDialog({
  open,
  onOpenChange,
  transcripts = [],
}: VideoBilingualTtsDialogProps) {
  const [targetLang, setTargetLang] = useState<SupportedLanguage>('en')
  const [config, setConfig] = useState<TTSVoiceConfig>(() => ttsController.getConfig())
  const [isTestingSpeech, setIsTestingSpeech] = useState<boolean>(false)

  const cues = generateBilingualCues(
    transcripts.length > 0
      ? transcripts
      : [
          { id: 't1', startSec: 0, endSec: 30, text: '欢迎来到本期 DeepSeek-R1 全栈实战指南。' },
          { id: 't2', startSec: 30, endSec: 90, text: '我们将从思维链原理解析，一直讲到生产环境分布式推理加速。' },
        ],
    targetLang
  )

  const handleTestTTS = () => {
    if (isTestingSpeech) {
      ttsController.stop()
      setIsTestingSpeech(false)
      return
    }

    setIsTestingSpeech(true)
    ttsController.updateConfig(config)
    ttsController.speakCue(cues[0], targetLang !== 'zh')
    setTimeout(() => setIsTestingSpeech(false), 3000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="shrink-0 pb-3 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2.5 text-base font-bold">
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
              <Languages className="w-5 h-5" />
            </div>
            <div>
              <span>AI 多语言双语同传与即时语音重译 (TTS)</span>
              <p className="text-[11px] font-normal text-muted-foreground mt-0.5">
                计算机技术术语对齐 · 双轨字幕同步 · 声音合成旁白增强
              </p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pt-3 pr-1 text-xs">
          {/* Target Language Selection */}
          <div className="p-3 rounded-lg border border-border/60 bg-muted/20 space-y-2">
            <label className="font-semibold text-foreground flex items-center gap-1.5">
              <Languages className="w-3.5 h-3.5 text-cyan-400" />
              <span>目标互译语言 (Target Translation Language)</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTargetLang('en')}
                className={`py-2 px-3 rounded-md border text-center font-medium transition-colors ${
                  targetLang === 'en'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    : 'bg-background border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                中英双语对照 (English)
              </button>
              <button
                type="button"
                onClick={() => setTargetLang('ja')}
                className={`py-2 px-3 rounded-md border text-center font-medium transition-colors ${
                  targetLang === 'ja'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    : 'bg-background border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                中日双语对照 (日本語)
              </button>
              <button
                type="button"
                onClick={() => setTargetLang('de')}
                className={`py-2 px-3 rounded-md border text-center font-medium transition-colors ${
                  targetLang === 'de'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    : 'bg-background border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                中德双语对照 (Deutsch)
              </button>
            </div>
          </div>

          {/* Voiceover TTS Tuning */}
          <div className="p-3 rounded-lg border border-border/60 bg-muted/20 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-primary" />
                <span>AI 语音旁白重译音色参数</span>
              </span>
              <Button
                size="sm"
                variant={isTestingSpeech ? 'destructive' : 'outline'}
                onClick={handleTestTTS}
                className="h-7 text-xs gap-1.5 font-medium"
              >
                {isTestingSpeech ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                <span>{isTestingSpeech ? '停止试听' : '试听旁白语音'}</span>
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>语速 (Rate):</span>
                  <span className="font-mono">{config.rate}x</span>
                </div>
                <input aria-label="语音语速"
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.1"
                  value={config.rate}
                  onChange={e => setConfig({ ...config, rate: parseFloat(e.target.value) })}
                  className="w-full accent-cyan-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>音调 (Pitch):</span>
                  <span className="font-mono">{config.pitch}</span>
                </div>
                <input aria-label="语音音调"
                  type="range"
                  min="0.8"
                  max="1.3"
                  step="0.05"
                  value={config.pitch}
                  onChange={e => setConfig({ ...config, pitch: parseFloat(e.target.value) })}
                  className="w-full accent-cyan-500"
                />
              </div>
            </div>
          </div>

          {/* Live Bilingual Cues Preview */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted-foreground">
              实时双语字幕流预览 ({cues.length} 条)
            </div>
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {cues.map((cue, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-md bg-background border border-border/60 hover:border-cyan-500/40 transition-colors"
                >
                  <p className="font-medium text-foreground">{cue.primaryText}</p>
                  <p className="text-[11px] text-cyan-400/90 font-sans mt-0.5">{cue.secondaryText}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
