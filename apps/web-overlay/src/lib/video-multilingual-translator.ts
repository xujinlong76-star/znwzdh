import type { VideoTranscriptItem } from '@/types/navigation'

export type SubtitleLanguage = 'zh' | 'en' | 'ja' | 'es'

export interface BilingualTranscriptLine {
  id: string
  startSec: number
  endSec: number
  originalText: string
  translatedText: string
  language: SubtitleLanguage
  highlightWords?: string[]
}

const TECHNICAL_GLOSSARY: Record<string, Record<SubtitleLanguage, string>> = {
  kubernetes: { zh: 'Kubernetes (K8s 容器编排)', en: 'Kubernetes', ja: 'クーバネティス', es: 'Kubernetes' },
  idempotency: { zh: '幂等性', en: 'Idempotency', ja: '冪等性', es: 'Idempotencia' },
  microservices: { zh: '微服务架构', en: 'Microservices', ja: 'マイクロサービス', es: 'Microservicios' },
  concurrency: { zh: '高并发', en: 'Concurrency', ja: '並行性', es: 'Concurrencia' },
  docker: { zh: 'Docker 容器', en: 'Docker Container', ja: 'Dockerコンテナ', es: 'Contenedor Docker' },
  grpc: { zh: 'gRPC 高性能 RPC', en: 'gRPC', ja: 'gRPC', es: 'gRPC' },
}

/**
 * Translates a single text string using deterministic rule matching and glossary replacement.
 */
export function translateTechnicalText(text: string, targetLang: SubtitleLanguage): string {
  if (targetLang === 'zh') return text

  // Basic phrase replacement for tech terms
  let translated = text
  for (const [key, map] of Object.entries(TECHNICAL_GLOSSARY)) {
    const reg = new RegExp(key, 'gi')
    if (reg.test(translated)) {
      translated = translated.replace(reg, map[targetLang])
    }
  }

  // Language prefix simulation
  if (targetLang === 'en') {
    return `[EN] ${translated.replace(/技术|架构|实战/g, 'Tech Lab')}`
  }
  if (targetLang === 'ja') {
    return `[JA] ${translated.replace(/技术|架构/g, 'アーキテクチャ')}`
  }
  if (targetLang === 'es') {
    return `[ES] ${translated.replace(/技术|架构/g, 'Arquitectura')}`
  }

  return translated
}

/**
 * Converts transcript items into bilingual lines with synchronized translation.
 */
export function buildBilingualTranscripts(
  transcripts: VideoTranscriptItem[],
  targetLang: SubtitleLanguage = 'en'
): BilingualTranscriptLine[] {
  return transcripts.map((t) => {
    const translatedText = t.translation || translateTechnicalText(t.text, targetLang)
    return {
      id: t.id,
      startSec: t.startSec,
      endSec: t.endSec,
      originalText: t.text,
      translatedText,
      language: targetLang,
    }
  })
}

/**
 * Serializes transcript items into standard WebVTT subtitle format.
 */
export function formatToWebVTT(transcripts: VideoTranscriptItem[]): string {
  const formatTime = (sec: number): string => {
    const hrs = Math.floor(sec / 3600).toString().padStart(2, '0')
    const mins = Math.floor((sec % 3600) / 60).toString().padStart(2, '0')
    const secs = (sec % 60).toFixed(3).padStart(6, '0')
    return `${hrs}:${mins}:${secs}`
  }

  const lines = ['WEBVTT', '']
  transcripts.forEach((item, index) => {
    lines.push(String(index + 1))
    lines.push(`${formatTime(item.startSec)} --> ${formatTime(item.endSec)}`)
    lines.push(item.text)
    if (item.translation) {
      lines.push(item.translation)
    }
    lines.push('')
  })

  return lines.join('\n')
}

/**
 * Serializes transcript items into standard SubRip (.srt) subtitle format.
 */
export function formatToSRT(transcripts: VideoTranscriptItem[]): string {
  const formatTime = (sec: number): string => {
    const hrs = Math.floor(sec / 3600).toString().padStart(2, '0')
    const mins = Math.floor((sec % 3600) / 60).toString().padStart(2, '0')
    const wholeSec = Math.floor(sec % 60).toString().padStart(2, '0')
    const ms = Math.floor((sec % 1) * 1000).toString().padStart(3, '0')
    return `${hrs}:${mins}:${wholeSec},${ms}`
  }

  const lines: string[] = []
  transcripts.forEach((item, index) => {
    lines.push(String(index + 1))
    lines.push(`${formatTime(item.startSec)} --> ${formatTime(item.endSec)}`)
    lines.push(item.text)
    if (item.translation) {
      lines.push(item.translation)
    }
    lines.push('')
  })

  return lines.join('\n')
}
