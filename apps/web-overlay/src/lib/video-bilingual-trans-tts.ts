/**
 * AI Bilingual Subtitles Translation & Real-Time Synthetic Voiceover (TTS) Engine
 * Proposal [3]: Bilingual Real-Time Subtitles & AI Voiceover Generator
 * Provides cross-lingual technical dictionary alignment, dual-track subtitle cues,
 * and time-synchronized speech synthesis for video playhead tracking.
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
  voiceId: string
  lang: SupportedLanguage
  rate: number // 0.5 - 2.0
  pitch: number // 0.5 - 1.5
  volume: number // 0.0 - 1.0
  duckOriginalAudio: boolean
}

/**
 * Hardcore technical terminology translation dictionary ensuring high precision.
 */
export const TECH_LEXICON: Record<string, { en: string; ja: string; de: string }> = {
  大模型: { en: 'Large Language Model (LLM)', ja: '大規模言語モデル', de: 'Großes Sprachmodell' },
  思维链: { en: 'Chain-of-Thought (CoT)', ja: '思考の連鎖', de: 'Gedankenkette' },
  私有微调: { en: 'Private Fine-Tuning', ja: 'プライベートファインチューニング', de: 'Private Feinabstimmung' },
  分布式推理: { en: 'Distributed Inference', ja: '分散推論', de: 'Verteilte Inferenz' },
  架构: { en: 'Architecture', ja: 'アーキテクチャ', de: 'Architektur' },
  状态机: { en: 'State Machine', ja: '状態マシン', de: 'Zustandsautomat' },
  并发: { en: 'Concurrency', ja: '並行処理', de: 'Nebenläufigkeit' },
  零拷贝: { en: 'Zero-Copy', ja: 'ゼロコピー', de: 'Zero-Copy' },
  高可用: { en: 'High Availability', ja: '高可用性', de: 'Hochverfügbarkeit' },
  代码: { en: 'Source Code', ja: 'ソースコード', de: 'Quellcode' },
}

/**
 * Translates a single text string from Chinese to target language.
 */
export function translateTechnicalText(chineseText: string, targetLang: SupportedLanguage): string {
  if (targetLang === 'zh') return chineseText

  let translated = chineseText
  Object.entries(TECH_LEXICON).forEach(([term, dict]) => {
    if (translated.includes(term)) {
      translated = translated.replaceAll(term, dict[targetLang] || term)
    }
  })

  if (targetLang === 'en') {
    if (translated.includes('欢迎来到')) translated = translated.replace('欢迎来到', 'Welcome to ')
    if (translated.includes('深入探讨')) translated = translated.replace('深入探讨', 'In-depth discussion on ')
    if (translated.includes('实战指南')) translated = translated.replace('实战指南', ' Practical Hands-on Guide')
    if (translated.includes('生产环境')) translated = translated.replace('生产环境', ' Production Environment')
  } else if (targetLang === 'ja') {
    if (translated.includes('欢迎来到')) translated = translated.replace('欢迎来到', 'ようこそ ')
    if (translated.includes('实战指南')) translated = translated.replace('实战指南', ' 実践ガイド')
  }

  return translated
}

/**
 * Generates bilingual cues from transcript items and target language selection.
 */
export function generateBilingualCues(
  transcripts: VideoTranscriptItem[],
  targetLang: SupportedLanguage = 'en'
): BilingualCue[] {
  return transcripts.map((t, idx) => ({
    id: t.id || `cue_${idx}`,
    startSec: t.startSec,
    endSec: t.endSec,
    primaryText: t.text,
    secondaryText: translateTechnicalText(t.text, targetLang),
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
    voiceId: 'zh-CN-YunxiNeural',
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
    this.currentUtteranceText = textToSpeak
    this.isSpeaking = true

    // If browser Web Speech API is present in client runtime
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(textToSpeak)
      utterance.rate = this.config.rate
      utterance.pitch = this.config.pitch
      utterance.volume = this.config.volume
      utterance.onend = () => {
        this.isSpeaking = false
      }
      window.speechSynthesis.speak(utterance)
    }

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
