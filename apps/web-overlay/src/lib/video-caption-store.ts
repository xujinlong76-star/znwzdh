/**
 * 视频字幕可搜：用户导入的字幕持久化与跨视频字幕搜索。
 *
 * 只处理「有字幕」的视频，字幕只有两个真实来源：
 * 1. 视频自带 `videoConfig.transcript`（站内仅少数视频有）；
 * 2. 用户粘贴 / 上传的 SRT / WebVTT 文本，存在浏览器 localStorage。
 * 无字幕的视频不做 ASR、不调转写服务、不编造字幕，只标注「无字幕，不可搜」。
 */

import type { NavigationSubItem, VideoTranscriptItem } from '@/types/navigation'
import { parseCaptions, parseWebVTT } from '@/lib/video-transcript-sync'

export const CAPTION_STORE_KEY = 'navhub:video-captions:v1'
/** 导入字幕变化时触发，其他视图（搜索页、播放器）据此刷新。 */
export const CAPTION_STORE_EVENT = 'navhub:video-captions-changed'
/** 单个视频最多保留的导入字幕条数：localStorage 配额有限，超限只留靠前的条目。 */
export const MAX_IMPORTED_CUES_PER_VIDEO = 2000

export type CaptionSource = 'imported' | 'builtin' | 'description' | 'none'

export interface CaptionEntry {
  videoId: string
  title: string
  platform?: string
  format: 'srt' | 'vtt'
  cues: VideoTranscriptItem[]
  importedAt: number
}

export interface CaptionHit {
  cue: VideoTranscriptItem
  /** 命中的是正文还是译文。 */
  field: 'text' | 'translation'
}

export interface CaptionSearchGroup {
  videoId: string
  title: string
  platform?: string
  /** 该视频的命中条目，按时间点排序。 */
  hits: CaptionHit[]
  /** 最早命中时间点（秒），用于分组排序。 */
  firstHitSec: number
}

export interface ResolvedCaptions {
  cues: VideoTranscriptItem[]
  source: CaptionSource
}

type CaptionStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

const memoryFallback = new Map<string, string>()

function defaultStorage(): CaptionStorage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  if (
    typeof globalThis !== 'undefined' &&
    (globalThis as unknown as { localStorage?: Storage }).localStorage
  ) {
    return (globalThis as unknown as { localStorage: Storage }).localStorage!
  }
  return {
    getItem: (k: string) => memoryFallback.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memoryFallback.set(k, v)
    },
    removeItem: (k: string) => {
      memoryFallback.delete(k)
    },
  }
}

function isValidCue(cue: unknown): cue is VideoTranscriptItem {
  if (!cue || typeof cue !== 'object') return false
  const c = cue as Partial<VideoTranscriptItem>
  return (
    typeof c.startSec === 'number' &&
    typeof c.endSec === 'number' &&
    typeof c.text === 'string' &&
    c.text.trim().length > 0
  )
}

function sanitizeEntry(raw: unknown): CaptionEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Partial<CaptionEntry>
  if (typeof e.videoId !== 'string' || !e.videoId) return null
  if (!Array.isArray(e.cues)) return null
  const cues = e.cues.filter(isValidCue)
  if (cues.length === 0) return null
  return {
    videoId: e.videoId,
    title: typeof e.title === 'string' ? e.title : '',
    platform: typeof e.platform === 'string' ? e.platform : undefined,
    format: e.format === 'srt' ? 'srt' : 'vtt',
    cues,
    importedAt: typeof e.importedAt === 'number' ? e.importedAt : 0,
  }
}

/** 读出全部已导入字幕；损坏的存储返回空列表，不抛错。 */
export function loadCaptionEntries(storage: CaptionStorage = defaultStorage()): CaptionEntry[] {
  try {
    const raw = storage.getItem(CAPTION_STORE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(sanitizeEntry)
      .filter((e): e is CaptionEntry => e !== null)
  } catch {
    return []
  }
}

export function getCaptionEntry(
  videoId: string,
  storage: CaptionStorage = defaultStorage(),
): CaptionEntry | null {
  return loadCaptionEntries(storage).find(e => e.videoId === videoId) ?? null
}

/**
 * 直接保存已解析好的字幕条目（导入对话框已做过解析与逐行校验时用，
 * 避免二次解析）。写入成功后广播变化事件。
 */
export function saveCaptionEntry(
  video: Pick<NavigationSubItem, 'id' | 'title'> & { videoConfig?: { type?: string } },
  cues: VideoTranscriptItem[],
  format: 'srt' | 'vtt',
  storage: CaptionStorage = defaultStorage(),
): { ok: boolean; entry: CaptionEntry | null; error?: string } {
  if (cues.length === 0) {
    return { ok: false, entry: null, error: '没有可保存的字幕条目' }
  }
  const entry: CaptionEntry = {
    videoId: video.id,
    title: video.title,
    platform: video.videoConfig?.type,
    format,
    cues: cues.slice(0, MAX_IMPORTED_CUES_PER_VIDEO),
    importedAt: Date.now(),
  }
  const entries = loadCaptionEntries(storage).filter(e => e.videoId !== video.id)
  entries.push(entry)
  try {
    storage.setItem(CAPTION_STORE_KEY, JSON.stringify(entries))
  } catch {
    return {
      ok: false,
      entry: null,
      error: '浏览器存储空间不足，字幕未保存：请先删除其他视频的导入字幕再试',
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CAPTION_STORE_EVENT))
  }
  return { ok: true, entry }
}

/**
 * 保存一次导入的字幕：先解析（带逐行错误），有错误或零条有效 cue 时不写入，
 * 返回解析结果供调用方展示；解析通过才写入并广播变化事件。
 */
export function importCaptionsForVideo(
  video: Pick<NavigationSubItem, 'id' | 'title'> & { videoConfig?: { type?: string } },
  content: string,
  storage: CaptionStorage = defaultStorage(),
): { ok: boolean; entry: CaptionEntry | null; errors: { line: number; message: string }[]; cueCount: number } {
  const parsed = parseCaptions(content)
  if (parsed.errors.length > 0 || parsed.cues.length === 0) {
    const errors =
      parsed.errors.length > 0
        ? parsed.errors
        : [{ line: 1, message: '没有解析出任何字幕条目，请检查字幕文本是否完整' }]
    return { ok: false, entry: null, errors, cueCount: parsed.cues.length }
  }

  const saved = saveCaptionEntry(video, parsed.cues, parsed.format === 'srt' ? 'srt' : 'vtt', storage)
  if (!saved.ok || !saved.entry) {
    return {
      ok: false,
      entry: null,
      errors: [{ line: 0, message: saved.error ?? '字幕保存失败' }],
      cueCount: parsed.cues.length,
    }
  }
  return { ok: true, entry: saved.entry, errors: [], cueCount: saved.entry.cues.length }
}

export function deleteCaptionEntry(
  videoId: string,
  storage: CaptionStorage = defaultStorage(),
): void {
  const entries = loadCaptionEntries(storage).filter(e => e.videoId !== videoId)
  try {
    storage.setItem(CAPTION_STORE_KEY, JSON.stringify(entries))
  } catch {
    return
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CAPTION_STORE_EVENT))
  }
}

/**
 * 一个视频最终可用的字幕与来源，优先级：用户导入 > 视频自带 > 描述里的 VTT > 无。
 * 自带字幕与描述解析都只用真实数据；没有就返回空与 'none'，绝不编造。
 */
export function resolveVideoCaptions(
  video: NavigationSubItem | null | undefined,
  imported: CaptionEntry | null = null,
): ResolvedCaptions {
  if (!video) return { cues: [], source: 'none' }
  if (imported && imported.cues.length > 0) {
    return { cues: imported.cues, source: 'imported' }
  }
  const builtin = video.videoConfig?.transcript
  if (builtin && builtin.length > 0) {
    return { cues: builtin, source: 'builtin' }
  }
  const fromDescription = parseWebVTT(video.description || '')
  if (fromDescription.length > 0) {
    return { cues: fromDescription, source: 'description' }
  }
  return { cues: [], source: 'none' }
}

/** 字幕状态：有字幕（可搜）还是无字幕（不可搜）。 */
export function getCaptionStatus(resolved: ResolvedCaptions): {
  state: 'has-captions' | 'no-captions'
  cueCount: number
  source: CaptionSource
} {
  return {
    state: resolved.cues.length > 0 ? 'has-captions' : 'no-captions',
    cueCount: resolved.cues.length,
    source: resolved.source,
  }
}

export function formatCaptionTimestamp(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * 把一段字幕文本按查询词切成「命中 / 非命中」片段，供 UI 高亮。
 * 大小写不敏感；中文按子串匹配，不做分词，所以「机器学习」能命中整词。
 */
export function highlightCaptionSegments(
  text: string,
  query: string,
): Array<{ text: string; hit: boolean }> {
  const q = query.trim()
  if (!q) return [{ text, hit: false }]
  const lowerText = text.toLowerCase()
  const lowerQuery = q.toLowerCase()
  const segments: Array<{ text: string; hit: boolean }> = []
  let cursor = 0
  let idx = lowerText.indexOf(lowerQuery, cursor)
  while (idx !== -1) {
    if (idx > cursor) segments.push({ text: text.slice(cursor, idx), hit: false })
    segments.push({ text: text.slice(idx, idx + q.length), hit: true })
    cursor = idx + q.length
    idx = lowerText.indexOf(lowerQuery, cursor)
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false })
  return segments.length > 0 ? segments : [{ text, hit: false }]
}

/**
 * 跨视频字幕搜索：对已导入字幕 + 自带字幕的视频做子串匹配，按视频分组，
 * 每组命中按时间点排序，分组按最早命中时间排序（先出现的先看到）。
 * 空查询返回空数组；无字幕的视频永远不会出现在这里。
 */
export function searchCaptionEntries(
  entries: CaptionEntry[],
  query: string,
  options: { maxHitsPerVideo?: number; maxGroups?: number } = {},
): CaptionSearchGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const maxHitsPerVideo = options.maxHitsPerVideo ?? 5
  const maxGroups = options.maxGroups ?? 10

  const groups: CaptionSearchGroup[] = []
  for (const entry of entries) {
    if (entry.cues.length === 0) continue
    const hits: CaptionHit[] = []
    for (const cue of entry.cues) {
      if (cue.text.toLowerCase().includes(q)) {
        hits.push({ cue, field: 'text' })
      } else if (cue.translation && cue.translation.toLowerCase().includes(q)) {
        hits.push({ cue, field: 'translation' })
      }
      if (hits.length >= maxHitsPerVideo) break
    }
    if (hits.length === 0) continue
    hits.sort((a, b) => a.cue.startSec - b.cue.startSec)
    groups.push({
      videoId: entry.videoId,
      title: entry.title,
      platform: entry.platform,
      hits,
      firstHitSec: hits[0].cue.startSec,
    })
  }

  groups.sort((a, b) => a.firstHitSec - b.firstHitSec)
  return groups.slice(0, maxGroups)
}

/**
 * 从导航数据里收集「自带字幕」的视频条目（与已导入字幕合并后供搜索用）。
 * 只收 `videoConfig.transcript` 非空的真实条目。
 */
export function collectBuiltinCaptionEntries(
  navigationItems: Array<{
    items?: NavigationSubItem[]
    subCategories?: Array<{ items?: NavigationSubItem[]; enabled?: boolean }>
    enabled?: boolean
  }>,
): CaptionEntry[] {
  const entries: CaptionEntry[] = []
  const pushItem = (item: NavigationSubItem) => {
    const transcript = item.videoConfig?.transcript
    if (!transcript || transcript.length === 0) return
    entries.push({
      videoId: item.id,
      title: item.title,
      platform: item.videoConfig?.type,
      format: 'vtt',
      cues: transcript,
      importedAt: 0,
    })
  }
  for (const category of navigationItems || []) {
    if (category.enabled === false) continue
    for (const item of category.items || []) pushItem(item)
    for (const sub of category.subCategories || []) {
      if (sub.enabled === false) continue
      for (const item of sub.items || []) pushItem(item)
    }
  }
  return entries
}

/**
 * 合并自带字幕与已导入字幕：同一视频以用户导入为准（导入会覆盖自带）。
 */
export function mergeCaptionEntries(builtin: CaptionEntry[], imported: CaptionEntry[]): CaptionEntry[] {
  const importedIds = new Set(imported.map(e => e.videoId))
  return [...imported, ...builtin.filter(e => !importedIds.has(e.videoId))]
}
