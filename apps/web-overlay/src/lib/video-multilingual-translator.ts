import type { VideoTranscriptItem } from '@/types/navigation'

export interface BilingualTranscriptLine {
  id: string
  startSec: number
  endSec: number
  originalText: string
  translatedText: string
  highlightWords?: string[]
}

/**
 * Builds bilingual lines from transcript items that already carry a real
 * translation (e.g. pasted/uploaded subtitles with a `translation` field).
 * There is no machine translation here: the previous implementation faked it
 * with a 6-word glossary plus [EN]/[JA]/[ES] prefixes, so lines without a
 * real translation are dropped instead of being "translated" by decoration.
 */
export function buildBilingualTranscripts(
  transcripts: VideoTranscriptItem[]
): BilingualTranscriptLine[] {
  return transcripts
    .filter((t) => typeof t.translation === 'string' && t.translation.trim().length > 0)
    .map((t) => ({
      id: t.id,
      startSec: t.startSec,
      endSec: t.endSec,
      originalText: t.text,
      translatedText: t.translation as string,
    }))
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
