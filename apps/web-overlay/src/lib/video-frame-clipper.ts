export interface VideoStudyNote {
  id: string
  videoId: string
  videoTitle: string
  timeSec: number
  imageDataUrl?: string
  ocrText?: string
  codeSnippet?: string
  userNote?: string
  createdAt: string
}

const NOTES_STORAGE_KEY = 'devops_video_study_notes_v1'

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) return (globalThis as any).localStorage
  return null
}

/**
 * Captures the current frame of an HTMLVideoElement into a PNG DataURL.
 */
export function captureVideoElementFrame(video: HTMLVideoElement): {
  dataUrl: string
  width: number
  height: number
} | null {
  try {
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      return null
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/png')
    return {
      dataUrl,
      width: canvas.width,
      height: canvas.height,
    }
  } catch {
    return null
  }
}

/**
 * Heuristically extracts code commands and configuration blocks from raw OCR text.
 */
export function extractCodeFromOCR(ocrRaw: string): { codeSnippet?: string; plainText: string } {
  if (!ocrRaw) return { plainText: '' }

  const lines = ocrRaw.split('\n').map(l => l.trim()).filter(Boolean)
  const codeLines: string[] = []
  const textLines: string[] = []

  const commandPrefixes = [
    '$ ', '# ', 'curl ', 'git ', 'docker ', 'kubectl ', 'pnpm ', 'npm ', 'yarn ',
    'import ', 'export ', 'const ', 'function ', 'class ', 'def ', 'package ',
    'apiVersion:', 'kind:', 'metadata:', 'spec:', 'services:',
  ]

  for (const line of lines) {
    const isCode = commandPrefixes.some(prefix => line.toLowerCase().startsWith(prefix.toLowerCase())) ||
      line.includes('=>') || line.includes('();') || line.includes('{') || line.includes('}')
    if (isCode) {
      codeLines.push(line)
    } else {
      textLines.push(line)
    }
  }

  return {
    codeSnippet: codeLines.length > 0 ? codeLines.join('\n') : undefined,
    plainText: textLines.join('\n'),
  }
}

/**
 * Saves a study note into persistent storage.
 */
export function saveStudyNote(note: VideoStudyNote): void {
  const storage = getStorage()
  if (!storage) return

  try {
    const raw = storage.getItem(NOTES_STORAGE_KEY)
    const list: VideoStudyNote[] = raw ? JSON.parse(raw) : []
    const idx = list.findIndex(n => n.id === note.id)
    if (idx >= 0) {
      list[idx] = note
    } else {
      list.unshift(note)
    }
    // Limit to 100 notes
    if (list.length > 100) list.length = 100
    storage.setItem(NOTES_STORAGE_KEY, JSON.stringify(list))
  } catch {
    // Ignore storage quota
  }
}

/**
 * Retrieves all notes, optionally filtered by videoId.
 */
export function listStudyNotes(videoId?: string): VideoStudyNote[] {
  const storage = getStorage()
  if (!storage) return []

  try {
    const raw = storage.getItem(NOTES_STORAGE_KEY)
    if (!raw) return []
    const list: VideoStudyNote[] = JSON.parse(raw)
    if (videoId) {
      return list.filter(n => n.videoId === videoId)
    }
    return list
  } catch {
    return []
  }
}

/**
 * Deletes a note by ID.
 */
export function deleteStudyNote(noteId: string): void {
  const storage = getStorage()
  if (!storage) return

  try {
    const raw = storage.getItem(NOTES_STORAGE_KEY)
    if (!raw) return
    const list: VideoStudyNote[] = JSON.parse(raw)
    const filtered = list.filter(n => n.id !== noteId)
    storage.setItem(NOTES_STORAGE_KEY, JSON.stringify(filtered))
  } catch {
    // Ignore
  }
}

/**
 * Exports notes collection as formatted Markdown.
 */
export function exportNotesAsMarkdown(notes: VideoStudyNote[], videoTitle: string): string {
  let md = `# ${videoTitle} · 视频学习笔记与代码快照\n\n`
  md += `*生成时间: ${new Date().toLocaleString()} | 包含 ${notes.length} 条笔记*\n\n---\n\n`

  for (const n of notes) {
    const m = Math.floor(n.timeSec / 60)
    const s = Math.floor(n.timeSec % 60)
    const timeFormatted = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`

    md += `### ⏱️ [${timeFormatted}] ${n.userNote || '时间戳快照'}\n\n`
    if (n.ocrText) {
      md += `> 画面提取文本: ${n.ocrText}\n\n`
    }
    if (n.codeSnippet) {
      md += '```text\n' + n.codeSnippet + '\n```\n\n'
    }
    if (n.imageDataUrl) {
      md += `![快照](${n.imageDataUrl.slice(0, 100)}...)\n\n`
    }
  }

  return md
}
