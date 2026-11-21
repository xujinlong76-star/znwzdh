/**
 * 收藏划线批注：用户在收藏的标题 / 简介上划线、写批注，批注与原收藏关联保存。
 *
 * 解决的真实痛点：只存了链接，过两周再看忘了当时为什么存、读到了哪句有用的话。
 *
 * 数据来源只有本地已有的真实内容：
 * - 划线文本（quote）必须是收藏标题或简介的子串，add 时用 sourceText 校验，
 *   不在里面的划线拒绝写入；
 * - 没有简介时只对标题划线；既无标题也无简介的收藏没有可划线文本，UI 明说。
 * 不做跨站抓取正文、不编造正文、不调任何付费或登录服务。
 * 存储沿用 video-caption-store 的 localStorage 模式（本机保存，不同步）。
 */

export const ANNOTATION_STORE_KEY = 'navhub:save-annotations:v1'
/** 批注变化时触发，其他视图（详情页、批注总览）据此刷新。 */
export const ANNOTATION_STORE_EVENT = 'navhub:save-annotations-changed'
/** 单个收藏最多保留的批注条数；总量上限防 localStorage 配额爆炸。 */
export const MAX_ANNOTATIONS_PER_SAVE = 50
export const MAX_ANNOTATIONS_TOTAL = 500
export const MAX_QUOTE_LENGTH = 500
export const MAX_NOTE_LENGTH = 2000

export type AnnotationSource = 'title' | 'description'

export interface SaveAnnotation {
  id: string
  /** 收藏的站点 id（与 /site/[id] 一致）。 */
  siteId: string
  siteTitle: string
  siteUrl?: string
  /** 划出的原文片段，必须是标题或简介的子串。 */
  quote: string
  source: AnnotationSource
  /** 用户写的批注，可为空（纯划线也算一条「当时觉得有用」的标记）。 */
  note: string
  createdAt: number
  updatedAt: number
}

export interface AnnotationSearchHit {
  annotation: SaveAnnotation
  /** 命中的字段。 */
  field: 'quote' | 'note'
  /** 命中词前后各一段上下文（各约 40 字），供 UI 展示，不含整段原文照搬。 */
  context: string
  /** 命中词在 context 里的起止位置，供 UI 高亮。 */
  matchStart: number
  matchEnd: number
}

export interface AnnotationSearchGroup {
  siteId: string
  siteTitle: string
  siteUrl?: string
  hits: AnnotationSearchHit[]
}

type AnnotationStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

const memoryFallback = new Map<string, string>()

function defaultStorage(): AnnotationStorage {
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

function broadcast(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ANNOTATION_STORE_EVENT))
  }
}

function sanitizeAnnotation(raw: unknown): SaveAnnotation | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Partial<SaveAnnotation>
  if (typeof a.id !== 'string' || !a.id) return null
  if (typeof a.siteId !== 'string' || !a.siteId) return null
  if (typeof a.quote !== 'string' || !a.quote.trim()) return null
  if (typeof a.note !== 'string') return null
  return {
    id: a.id,
    siteId: a.siteId,
    siteTitle: typeof a.siteTitle === 'string' ? a.siteTitle : '',
    siteUrl: typeof a.siteUrl === 'string' && a.siteUrl ? a.siteUrl : undefined,
    quote: a.quote.slice(0, MAX_QUOTE_LENGTH),
    source: a.source === 'description' ? 'description' : 'title',
    note: a.note.slice(0, MAX_NOTE_LENGTH),
    createdAt: typeof a.createdAt === 'number' ? a.createdAt : 0,
    updatedAt: typeof a.updatedAt === 'number' ? a.updatedAt : 0,
  }
}

/** 批注存储整体损坏时写入拒绝的错误（人能看懂，且说明未覆盖旧数据）。 */
const CORRUPTED_STORAGE_ERROR = '批注存储已损坏，未覆盖旧数据：请先导出/备份或清空后重试'

/** 读出全部批注；损坏的存储返回空列表，不抛错。注意：损坏时这里只返回 []，
 * 写入前必须先用 isAnnotationStorageCorrupted 检查，否则写回会覆盖损坏的原始数据。 */
export function loadAnnotations(storage: AnnotationStorage = defaultStorage()): SaveAnnotation[] {
  try {
    const raw = storage.getItem(ANNOTATION_STORE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(sanitizeAnnotation).filter((a): a is SaveAnnotation => a !== null)
  } catch {
    return []
  }
}

/**
 * 检测批注存储是否整体损坏：无数据返回 false；JSON 解析失败或解析后不是数组返回 true；
 * 个别条目损坏不算整体损坏（仍由 sanitize 过滤，loadAnnotations 会丢弃坏条目）。
 */
export function isAnnotationStorageCorrupted(storage: AnnotationStorage = defaultStorage()): boolean {
  try {
    const raw = storage.getItem(ANNOTATION_STORE_KEY)
    if (!raw) return false
    const parsed: unknown = JSON.parse(raw)
    return !Array.isArray(parsed)
  } catch {
    return true
  }
}

export function loadAnnotationsForSave(
  siteId: string,
  storage: AnnotationStorage = defaultStorage(),
): SaveAnnotation[] {
  return loadAnnotations(storage)
    .filter((a) => a.siteId === siteId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** 按收藏聚合全部批注，每组按最新批注倒序。 */
export function groupAnnotationsBySave(
  annotations: SaveAnnotation[],
): Array<{ siteId: string; siteTitle: string; siteUrl?: string; items: SaveAnnotation[] }> {
  const groups = new Map<string, { siteId: string; siteTitle: string; siteUrl?: string; items: SaveAnnotation[] }>()
  for (const a of annotations) {
    const g = groups.get(a.siteId) ?? {
      siteId: a.siteId,
      siteTitle: a.siteTitle,
      siteUrl: a.siteUrl,
      items: [],
    }
    g.items.push(a)
    groups.set(a.siteId, g)
  }
  const out = [...groups.values()]
  for (const g of out) {
    // 同一毫秒内建的批注 createdAt 相等：以后插入的排前面（稳定倒序）。
    const order = new Map(g.items.map((item, i) => [item.id, i]))
    g.items.sort((x, y) => y.createdAt - x.createdAt || (order.get(y.id) ?? 0) - (order.get(x.id) ?? 0))
  }
  out.sort(
    (x, y) => Math.max(...y.items.map((i) => i.createdAt)) - Math.max(...x.items.map((i) => i.createdAt)),
  )
  return out
}

export function makeAnnotationId(): string {
  return `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export interface AddAnnotationInput {
  siteId: string
  siteTitle: string
  siteUrl?: string
  quote: string
  source: AnnotationSource
  note: string
  /** 划线来源的原文（标题或简介全文）：quote 必须是它的子串，否则拒绝。 */
  sourceText: string
}

/**
 * 新增一条批注。quote 为空、超长、或不是 sourceText 的子串时拒绝写入，
 * 并返回人能看懂的原因——绝不把用户没划过的文字存成「划线」。
 */
export function addAnnotation(
  input: AddAnnotationInput,
  storage: AnnotationStorage = defaultStorage(),
): { ok: boolean; annotation: SaveAnnotation | null; error?: string } {
  const quote = input.quote.trim()
  const note = input.note.trim()
  if (!input.siteId) return { ok: false, annotation: null, error: '缺少收藏标识，批注未保存' }
  if (!quote) return { ok: false, annotation: null, error: '请先选中一段文字再划线' }
  if (quote.length > MAX_QUOTE_LENGTH) {
    return { ok: false, annotation: null, error: `划线文字过长（最多 ${MAX_QUOTE_LENGTH} 字），请选短一点` }
  }
  if (!input.sourceText || !input.sourceText.includes(quote)) {
    return { ok: false, annotation: null, error: '划线文字不在当前标题或简介里，请重新选中' }
  }
  if (note.length > MAX_NOTE_LENGTH) {
    return { ok: false, annotation: null, error: `批注过长（最多 ${MAX_NOTE_LENGTH} 字）` }
  }
  if (isAnnotationStorageCorrupted(storage)) {
    return { ok: false, annotation: null, error: CORRUPTED_STORAGE_ERROR }
  }
  const all = loadAnnotations(storage)
  if (all.length >= MAX_ANNOTATIONS_TOTAL) {
    return { ok: false, annotation: null, error: `批注已达上限（${MAX_ANNOTATIONS_TOTAL} 条），请先删除旧批注` }
  }
  if (all.filter((a) => a.siteId === input.siteId).length >= MAX_ANNOTATIONS_PER_SAVE) {
    return { ok: false, annotation: null, error: `这个收藏的批注已达上限（${MAX_ANNOTATIONS_PER_SAVE} 条）` }
  }
  const now = Date.now()
  const annotation: SaveAnnotation = {
    id: makeAnnotationId(),
    siteId: input.siteId,
    siteTitle: input.siteTitle,
    siteUrl: input.siteUrl,
    quote,
    source: input.source,
    note,
    createdAt: now,
    updatedAt: now,
  }
  try {
    storage.setItem(ANNOTATION_STORE_KEY, JSON.stringify([...all, annotation]))
  } catch {
    return { ok: false, annotation: null, error: '浏览器存储空间不足，批注未保存：请先删除旧批注再试' }
  }
  broadcast()
  return { ok: true, annotation }
}

/** 只改批注文字（不改划线原文）；空 id 或超长时拒绝。 */
export function updateAnnotationNote(
  id: string,
  note: string,
  storage: AnnotationStorage = defaultStorage(),
): { ok: boolean; error?: string } {
  const trimmed = note.trim()
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: `批注过长（最多 ${MAX_NOTE_LENGTH} 字）` }
  }
  if (isAnnotationStorageCorrupted(storage)) {
    return { ok: false, error: CORRUPTED_STORAGE_ERROR }
  }
  const all = loadAnnotations(storage)
  const idx = all.findIndex((a) => a.id === id)
  if (idx === -1) return { ok: false, error: '这条批注已不存在' }
  all[idx] = { ...all[idx], note: trimmed, updatedAt: Date.now() }
  try {
    storage.setItem(ANNOTATION_STORE_KEY, JSON.stringify(all))
  } catch {
    return { ok: false, error: '浏览器存储空间不足，批注未保存' }
  }
  broadcast()
  return { ok: true }
}

export function deleteAnnotation(
  id: string,
  storage: AnnotationStorage = defaultStorage(),
): boolean {
  // 损坏时拒绝写入：load 会读出 []，直接写回会覆盖损坏的原始数据。
  if (isAnnotationStorageCorrupted(storage)) return false
  const all = loadAnnotations(storage)
  const next = all.filter((a) => a.id !== id)
  if (next.length === all.length) return false
  try {
    storage.setItem(ANNOTATION_STORE_KEY, JSON.stringify(next))
  } catch {
    return false
  }
  broadcast()
  return true
}

/** 取命中词前后约 40 字的上下文，并给出命中在上下文里的位置。 */
export function buildSearchContext(
  text: string,
  query: string,
  radius = 40,
): { context: string; matchStart: number; matchEnd: number } | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const idx = text.toLowerCase().indexOf(q)
  if (idx === -1) return null
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + q.length + radius)
  const prefix = start > 0 ? '…' : ''
  const context = prefix + text.slice(start, end) + (end < text.length ? '…' : '')
  const matchStart = prefix.length + (idx - start)
  return { context, matchStart, matchEnd: matchStart + q.length }
}

/**
 * 批注全文搜索：搜批注文字（划线原文 + 用户批注）能找到原收藏。
 * 空查询返回空数组；按收藏分组，组内命中按创建时间倒序，分组按最新命中倒序。
 */
export function searchAnnotations(
  annotations: SaveAnnotation[],
  query: string,
  options: { maxHitsPerSave?: number; maxGroups?: number } = {},
): AnnotationSearchGroup[] {
  const q = query.trim()
  if (!q) return []
  const maxHitsPerSave = options.maxHitsPerSave ?? 10
  const maxGroups = options.maxGroups ?? 20
  const groups = new Map<string, AnnotationSearchGroup>()
  for (const a of annotations) {
    const quoteCtx = buildSearchContext(a.quote, q)
    const noteCtx = a.note ? buildSearchContext(a.note, q) : null
    // 划线原文优先：同一条批注两处都命中时只留划线那处，避免重复。
    const hit: AnnotationSearchHit | null = quoteCtx
      ? { annotation: a, field: 'quote', ...quoteCtx }
      : noteCtx
        ? { annotation: a, field: 'note', ...noteCtx }
        : null
    if (!hit) continue
    const g = groups.get(a.siteId) ?? { siteId: a.siteId, siteTitle: a.siteTitle, siteUrl: a.siteUrl, hits: [] }
    if (g.hits.length < maxHitsPerSave) g.hits.push(hit)
    groups.set(a.siteId, g)
  }
  const out = [...groups.values()]
  for (const g of out) g.hits.sort((x, y) => y.annotation.createdAt - x.annotation.createdAt)
  out.sort(
    (x, y) =>
      Math.max(...y.hits.map((h) => h.annotation.createdAt)) -
      Math.max(...x.hits.map((h) => h.annotation.createdAt)),
  )
  return out.slice(0, maxGroups)
}

/** 判断一段选区文字来自标题还是简介（标题优先，简介次之；都不含返回 null）。 */
export function resolveQuoteSource(
  quote: string,
  title: string,
  description?: string,
): AnnotationSource | null {
  const q = quote.trim()
  if (!q) return null
  if (title && title.includes(q)) return 'title'
  if (description && description.includes(q)) return 'description'
  return null
}

/**
 * Markdown 导出转义：单遍映射表。反斜杠必须和其它字符在同一遍里转义——
 * 分步 replace 会漏掉它：已有的 `\` 会吃掉后加的转义符，把 `]` 重新变回活
 * 字符（CodeQL #136/#137）。单遍里每个输入字符恰好映射一次，不存在此问题。
 */
const MARKDOWN_TEXT_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '<': '&lt;',
  '>': '&gt;',
  '[': '\\[',
  ']': '\\]',
}

export function escapeMarkdownText(text: string): string {
  return text.replace(/[\\<>\[\]]/g, (ch) => MARKDOWN_TEXT_ESCAPES[ch] ?? ch)
}

function formatAnnotationDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString('zh-CN')
  } catch {
    return ''
  }
}

/** 导出 Markdown：按收藏分组，划线原文用引用块，批注紧跟其后，带原链接。 */
export function exportAnnotationsToMarkdown(annotations: SaveAnnotation[]): string {
  const dateStr = new Date().toISOString().slice(0, 10)
  const groups = groupAnnotationsBySave(annotations)
  const total = annotations.length
  const lines: string[] = [
    '# NavSphere 划线批注',
    '',
    `> 导出日期：${dateStr} | 共 ${total} 条批注，${groups.length} 个收藏`,
    '',
  ]
  if (groups.length === 0) {
    lines.push('暂无批注。')
    lines.push('')
    return lines.join('\n')
  }
  for (const g of groups) {
    const title = g.siteTitle || g.siteId
    // siteUrl 为空时写纯文本标题，不写空链接 ## [标题]()。
    lines.push(g.siteUrl ? `## [${escapeMarkdownText(title)}](${g.siteUrl})` : `## ${escapeMarkdownText(title)}`)
    lines.push('')
    for (const a of g.items) {
      lines.push(`> ${escapeMarkdownText(a.quote)}`)
      lines.push('')
      if (a.note) lines.push(`${escapeMarkdownText(a.note)}`)
      lines.push(`_${formatAnnotationDate(a.createdAt)}${a.source === 'description' ? ' · 划自简介' : ' · 划自标题'}_`)
      lines.push('')
    }
  }
  return lines.join('\n')
}

/** 导出 JSON：结构化备份数据；字段与 SaveAnnotation 一一对应。全仓暂无导入实现，导出的 JSON 用于备份留存。 */
export function exportAnnotationsToJson(annotations: SaveAnnotation[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      version: 1,
      count: annotations.length,
      annotations: [...annotations].sort((a, b) => b.createdAt - a.createdAt),
    },
    null,
    2,
  )
}

export function annotationExportFilename(kind: 'md' | 'json'): string {
  const date = new Date().toISOString().slice(0, 10)
  return kind === 'md' ? `navhub-划线批注-${date}.md` : `navhub-划线批注-${date}.json`
}
