import type { VideoTranscriptItem } from '@/types/navigation'

/**
 * Converts HH:MM:SS.mmm or MM:SS.mmm timestamp to seconds.
 */
export function parseVttTimestamp(ts: string): number {
  const clean = ts.trim().replace(',', '.')
  const parts = clean.split(':')
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0
    const mins = parseFloat(parts[1]) || 0
    const secs = parseFloat(parts[2]) || 0
    return hours * 3600 + mins * 60 + secs
  }
  if (parts.length === 2) {
    const mins = parseFloat(parts[0]) || 0
    const secs = parseFloat(parts[1]) || 0
    return mins * 60 + secs
  }
  return 0
}

/**
 * Parses WebVTT string into structured bilingual / timestamped transcript cues.
 */
export function parseWebVTT(content: string): VideoTranscriptItem[] {
  const cues: VideoTranscriptItem[] = []
  if (!content) return cues

  // Normalize line endings
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()
    if (!line || line.startsWith('WEBVTT') || line.startsWith('NOTE')) {
      i++
      continue
    }

    // Check if line is timestamp cue: 00:01.000 --> 00:04.000
    const match = line.match(/((?:\d{1,2}:)?\d{2}:\d{2}(?:[.,]\d{3})?)\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}(?:[.,]\d{3})?)/)
    if (match) {
      const startSec = parseVttTimestamp(match[1])
      const endSec = parseVttTimestamp(match[2])
      i++

      // Collect payload lines
      const textLines: string[] = []
      while (i < lines.length && lines[i].trim() !== '') {
        // Strip inline formatting tags (e.g. <b>, <c>, <00:01.000>)
        const cleanLine = lines[i].replace(/<[^>]+>/g, '').trim()
        if (cleanLine) textLines.push(cleanLine)
        i++
      }

      if (textLines.length > 0) {
        // If 2 lines, first line could be original, second line translation (or vice versa)
        const text = textLines[0]
        const translation = textLines.length > 1 ? textLines.slice(1).join(' ') : undefined
        cues.push({
          id: `cue-${cues.length + 1}-${Math.floor(startSec * 1000)}`,
          startSec,
          endSec,
          text,
          translation,
        })
      }
    } else {
      i++
    }
  }

  return cues
}

/**
 * Parses SRT subtitle string into structured transcript cues.
 */
export function parseSRT(content: string): VideoTranscriptItem[] {
  const cues: VideoTranscriptItem[] = []
  if (!content) return cues

  const blocks = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n\n')

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue

    // line 0: index (e.g. 1)
    // line 1: 00:00:01,000 --> 00:00:04,000
    let timeLineIdx = -1
    for (let j = 0; j < lines.length; j++) {
      if (lines[j].includes('-->')) {
        timeLineIdx = j
        break
      }
    }

    if (timeLineIdx >= 0) {
      const timeLine = lines[timeLineIdx]
      const match = timeLine.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/)
      if (match) {
        const startSec = parseVttTimestamp(match[1])
        const endSec = parseVttTimestamp(match[2])
        const textLines = lines.slice(timeLineIdx + 1).map(l => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean)
        if (textLines.length > 0) {
          cues.push({
            id: `srt-${cues.length + 1}-${Math.floor(startSec * 1000)}`,
            startSec,
            endSec,
            text: textLines[0],
            translation: textLines.length > 1 ? textLines.slice(1).join(' ') : undefined,
          })
        }
      }
    }
  }

  return cues
}

/**
 * Finds the currently active transcript cue based on current playhead seconds.
 */
export function findActiveTranscriptItem(
  items: VideoTranscriptItem[],
  currentSec: number
): VideoTranscriptItem | null {
  if (!items || items.length === 0) return null
  return (
    items.find(item => currentSec >= item.startSec && currentSec < item.endSec) ||
    null
  )
}

/**
 * Searches across transcript text and translation.
 */
export function searchTranscript(
  items: VideoTranscriptItem[],
  query: string
): Array<{ item: VideoTranscriptItem; index: number }> {
  if (!query || !query.trim()) return []
  const q = query.trim().toLowerCase()
  const results: Array<{ item: VideoTranscriptItem; index: number }> = []

  items.forEach((item, index) => {
    if (
      item.text.toLowerCase().includes(q) ||
      (item.translation && item.translation.toLowerCase().includes(q))
    ) {
      results.push({ item, index })
    }
  })

  return results
}

/**
 * Exports full transcript as formatted Markdown study notes.
 */
export function exportTranscriptAsMarkdown(
  items: VideoTranscriptItem[],
  title: string
): string {
  let md = `# ${title} · 逐字文字稿与学习笔记\n\n`
  md += `*生成时间: ${new Date().toLocaleString()}*\n\n---\n\n`

  for (const item of items) {
    const m = Math.floor(item.startSec / 60)
    const s = Math.floor(item.startSec % 60)
    const timeFormatted = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`

    md += `**[${timeFormatted}]** ${item.text}\n`
    if (item.translation) {
      md += `> ${item.translation}\n`
    }
    md += '\n'
  }

  return md
}
