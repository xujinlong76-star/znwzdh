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

export type CaptionFormat = 'srt' | 'vtt' | 'unknown'

export interface CaptionParseError {
  /** 1-based line number in the pasted/uploaded text. */
  line: number
  message: string
}

export interface CaptionParseResult {
  format: CaptionFormat
  cues: VideoTranscriptItem[]
  /** Every cue-shaped block that could not be parsed, with its line number. Empty means clean. */
  errors: CaptionParseError[]
}

const VTT_TIMESTAMP_RE =
  /((?:\d{1,2}:)?\d{2}:\d{2}(?:[.,]\d{3})?)\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}(?:[.,]\d{3})?)/
const SRT_TIMESTAMP_RE =
  /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/

/**
 * Detects SRT vs WebVTT from content alone. VTT is recognised by the WEBVTT
 * header or by bare ` --> ` cue lines; SRT by a numeric index line followed
 * by an `HH:MM:SS,mmm --> ...` line. Anything else is 'unknown'.
 */
export function detectCaptionFormat(content: string): CaptionFormat {
  if (!content || !content.trim()) return 'unknown'
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const firstLine = text.split('\n').find(l => l.trim() !== '')?.trim() ?? ''
  if (firstLine.startsWith('WEBVTT')) return 'vtt'
  if (/^\d+\s*\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(text)) return 'srt'
  if (text.includes('-->')) return 'vtt'
  return 'unknown'
}

function stripCueTags(line: string): string {
  return line.replace(/<[^>]+>/g, '').trim()
}

/**
 * Parses pasted/uploaded SRT or WebVTT text into cues, reporting every
 * malformed cue with its 1-based line number instead of silently dropping
 * it. Valid cues are still returned alongside the errors so the caller can
 * show "imported N cues, M lines need fixing" and let the user fix and retry.
 */
export function parseCaptions(content: string): CaptionParseResult {
  if (!content || !content.trim()) {
    return {
      format: 'unknown',
      cues: [],
      errors: [{ line: 1, message: '字幕内容为空：请粘贴 SRT 或 WebVTT 文本，或上传 .srt / .vtt 文件' }],
    }
  }

  const format = detectCaptionFormat(content)
  if (format === 'unknown') {
    return {
      format,
      cues: [],
      errors: [
        {
          line: 1,
          message: '无法识别字幕格式：需要 SRT（带序号与 00:00:01,000 --> 00:00:04,000 时间行）或 WebVTT（WEBVTT 开头）',
        },
      ],
    }
  }

  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  return format === 'srt' ? parseCaptionsSrt(lines) : parseCaptionsVtt(lines)
}

function parseCaptionsVtt(lines: string[]): CaptionParseResult {
  const cues: VideoTranscriptItem[] = []
  const errors: CaptionParseError[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()
    const lineNo = i + 1
    if (!line || line.startsWith('WEBVTT') || line.startsWith('NOTE')) {
      i++
      continue
    }

    if (line.includes('-->')) {
      const match = line.match(VTT_TIMESTAMP_RE)
      if (!match) {
        errors.push({ line: lineNo, message: `时间戳格式不对，应为「00:01.000 --> 00:04.000」或「00:00:01.000 --> 00:00:04.000」：${line}` })
        i++
        while (i < lines.length && lines[i].trim() !== '') i++
        continue
      }
      const startSec = parseVttTimestamp(match[1])
      const endSec = parseVttTimestamp(match[2])
      i++
      const textLines: string[] = []
      while (i < lines.length && lines[i].trim() !== '') {
        const clean = stripCueTags(lines[i])
        if (clean) textLines.push(clean)
        i++
      }
      if (textLines.length === 0) {
        errors.push({ line: lineNo, message: '这条字幕没有文本内容' })
      } else if (endSec <= startSec) {
        errors.push({ line: lineNo, message: '结束时间不晚于开始时间，请检查时间戳顺序' })
      } else {
        cues.push({
          id: `cue-${cues.length + 1}-${Math.floor(startSec * 1000)}`,
          startSec,
          endSec,
          text: textLines[0],
          translation: textLines.length > 1 ? textLines.slice(1).join(' ') : undefined,
        })
      }
      continue
    }

    // A cue identifier line (or stray text) before a timestamp line: skip it;
    // a lone non-empty line with no timestamp anywhere is not a cue.
    i++
  }

  return { format: 'vtt', cues, errors }
}

function parseCaptionsSrt(lines: string[]): CaptionParseResult {
  const cues: VideoTranscriptItem[] = []
  const errors: CaptionParseError[] = []
  let i = 0

  while (i < lines.length) {
    // Skip blank lines between blocks.
    while (i < lines.length && lines[i].trim() === '') i++
    if (i >= lines.length) break

    const blockStart = i
    const blockStartLine = blockStart + 1
    const block: string[] = []
    while (i < lines.length && lines[i].trim() !== '') {
      block.push(lines[i])
      i++
    }

    // line 0: index, then the timestamp line, then text lines.
    let timeIdx = -1
    for (let j = 0; j < block.length; j++) {
      if (block[j].includes('-->')) {
        timeIdx = j
        break
      }
    }

    if (timeIdx < 0) {
      errors.push({
        line: blockStartLine,
        message: '这一段缺少时间戳行，应为「00:00:01,000 --> 00:00:04,000」',
      })
      continue
    }

    const timeLine = block[timeIdx]
    const match = timeLine.match(SRT_TIMESTAMP_RE)
    if (!match) {
      errors.push({
        line: blockStartLine + timeIdx,
        message: `时间戳格式不对，应为「00:00:01,000 --> 00:00:04,000」：${timeLine.trim()}`,
      })
      continue
    }

    const startSec = parseVttTimestamp(match[1])
    const endSec = parseVttTimestamp(match[2])
    const textLines = block
      .slice(timeIdx + 1)
      .map(l => stripCueTags(l))
      .filter(Boolean)
    if (textLines.length === 0) {
      errors.push({ line: blockStartLine + timeIdx, message: '这条字幕没有文本内容' })
    } else if (endSec <= startSec) {
      errors.push({ line: blockStartLine + timeIdx, message: '结束时间不晚于开始时间，请检查时间戳顺序' })
    } else {
      cues.push({
        id: `srt-${cues.length + 1}-${Math.floor(startSec * 1000)}`,
        startSec,
        endSec,
        text: textLines[0],
        translation: textLines.length > 1 ? textLines.slice(1).join(' ') : undefined,
      })
    }
  }

  return { format: 'srt', cues, errors }
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
