/**
 * Real-Time Subtitle Cues & Synthetic Voiceover (TTS) Engine
 * Proposal [3]: Bilingual Real-Time Subtitles & AI Voiceover Generator
 * Provides subtitle cues and time-synchronized speech synthesis for video
 * playhead tracking. There is no translation here: the old 10-word
 * dictionary lookup that filled `secondaryText` was fake translation, so
 * both cue tracks carry the original text and TTS reads the original aloud.
 */

import type { VideoTranscriptItem } from '@/types/navigation'

export type SupportedLanguage = 'zh' | 'en' | 'ja' | 'de'

export interface BilingualCue {
  id: string
  startSec: number
  endSec: number
  primaryText: string
  secondaryText: string
  speakerName?: string
  phoneticGuide?: string
}

export interface TTSVoiceConfig {
  lang: SupportedLanguage
  rate: number // 0.5 - 2.0
  pitch: number // 0.5 - 1.5
  volume: number // 0.0 - 1.0
  duckOriginalAudio: boolean
}

/**
 * Generates cues from transcript items. No translation is performed:
 * `secondaryText` carries the original text, same as `primaryText`,
 * so TTS reads the original aloud.
 */
export function generateBilingualCues(
  transcripts: VideoTranscriptItem[]
): BilingualCue[] {
  return transcripts.map((t, idx) => ({
    id: t.id || `cue_${idx}`,
    startSec: t.startSec,
    endSec: t.endSec,
    primaryText: t.text,
    secondaryText: t.text,
    speakerName: 'AI 讲师',
  }))
}

/**
 * Finds the currently active bilingual cue based on player's current playback second.
 */
export function getActiveBilingualCue(cues: BilingualCue[], currentSec: number): BilingualCue | null {
  return cues.find(c => currentSec >= c.startSec && currentSec < c.endSec) || null
}

/**
 * Synthetic TTS Speech Controller.
 */
export class SyntheticTTSController {
  private config: TTSVoiceConfig = {
    lang: 'zh',
    rate: 1.0,
    pitch: 1.0,
    volume: 0.9,
    duckOriginalAudio: true,
  }

  private isSpeaking: boolean = false
  private currentUtteranceText: string | null = null

  getConfig(): TTSVoiceConfig {
    return { ...this.config }
  }

  updateConfig(partial: Partial<TTSVoiceConfig>): void {
    this.config = { ...this.config, ...partial }
  }

  speakCue(cue: BilingualCue, useSecondaryLang: boolean = false): { success: boolean; text: string } {
    const textToSpeak = useSecondaryLang ? cue.secondaryText : cue.primaryText

    // 无 speechSynthesis 时诚实返回失败：之前无条件返回 success:true 且先置
    // isSpeaking=true，是假成功。注意先判再置状态，不成功不置 isSpeaking。
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return { success: false, text: textToSpeak }
    }

    this.currentUtteranceText = textToSpeak
    this.isSpeaking = true

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(textToSpeak)
    utterance.rate = this.config.rate
    utterance.pitch = this.config.pitch
    utterance.volume = this.config.volume
    utterance.onend = () => {
      this.isSpeaking = false
    }
    window.speechSynthesis.speak(utterance)

    return { success: true, text: textToSpeak }
  }

  stop(): void {
    this.isSpeaking = false
    this.currentUtteranceText = null
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  }

  getSpeakingStatus(): { isSpeaking: boolean; currentText: string | null } {
    return { isSpeaking: this.isSpeaking, currentText: this.currentUtteranceText }
  }
}
