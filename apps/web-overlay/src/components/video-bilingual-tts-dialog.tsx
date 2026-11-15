'use client'

import React, { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Volume2, Play, Square, Sliders } from 'lucide-react'
import {
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
  const [config, setConfig] = useState<TTSVoiceConfig>(() => ttsController.getConfig())
  const [isTestingSpeech, setIsTestingSpeech] = useState<boolean>(false)

  // 不做翻译：提示只返回字幕原文，TTS 朗读原文。
  // 无字幕时不编试听句：之前这里用两句写死的 DeepSeek-R1 宣传语当试听内容，
  // 与本视频无关，是假文案，已删除。入口本身已在播放页设门（transcriptList
  // 为空时不给开），对话框内无字幕时试听按钮直接禁用。
  const cues = generateBilingualCues(transcripts)

  const handleTestTTS = () => {
    if (isTestingSpeech) {
      ttsController.stop()
      setIsTestingSpeech(false)
      return
    }
    if (cues.length === 0) return

    setIsTestingSpeech(true)
    ttsController.updateConfig(config)
    ttsController.speakCue(cues[0])
    setTimeout(() => setIsTestingSpeech(false), 3000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="shrink-0 pb-3 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2.5 text-base font-bold">
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
              <Volume2 className="w-5 h-5" />
            </div>
            <div>
              <span>AI 语音朗读 (TTS)</span>
              <p className="text-[11px] font-normal text-muted-foreground mt-0.5">
                字幕原文朗读 · 声音合成旁白
              </p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pt-3 pr-1 text-xs">
          {/* Voiceover TTS Tuning */}
          <div className="p-3 rounded-lg border border-border/60 bg-muted/20 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-primary" />
                <span>AI 语音旁白音色参数</span>
              </span>
              <Button
                size="sm"
                variant={isTestingSpeech ? 'destructive' : 'outline'}
                onClick={handleTestTTS}
                disabled={cues.length === 0}
                title={cues.length === 0 ? '暂无字幕可试听，可先导入字幕' : undefined}
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

          {/* Live Cues Preview */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted-foreground">
              实时字幕流预览 ({cues.length} 条)
            </div>
            {cues.length === 0 && (
              <p className="text-[11px] text-muted-foreground">暂无字幕可试听，可先导入字幕。</p>
            )}
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {cues.map((cue, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-md bg-background border border-border/60 hover:border-cyan-500/40 transition-colors"
                >
                  <p className="font-medium text-foreground">{cue.primaryText}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
