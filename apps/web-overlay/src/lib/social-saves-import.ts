/**
 * 社交平台收藏本地导入解析器（纯函数层，无 React / 无 DOM 依赖，可在 node 里直接单测）。
 *
 * 痛点一句话：收藏散在 X / Reddit / GitHub Stars / Hacker News / Instagram /
 * TikTok 各平台的「已保存」里，找的时候不知道在哪——导入后统一进 znwzdh
 * 自己的网址库，可搜可整理。
 *
 * 硬约束：
 * - 不登录、不调任何平台 API、不花钱：只解析用户自己从平台导出的文件
 *   （或粘贴的链接文本）。本模块从不联网。
 * - 每个承诺的格式都有真实数据源：只支持下面写明的、公开可查的导出结构；
 *   拿不准的格式（例如 TikTok 结构化导出）不编造解析规则，直接报「不支持」
 *   并给出改法，跳过该子项。
 * - 去重口径与书签导入一致：fingerprintUrl（SSOT），批内重复进
 *   droppedDuplicates，交给去重报告判 intra-file-dup。
 *
 * 已验证的导出结构（只认这些，别的形状一律进 failures，不静默丢）：
 * - X/Twitter：数据归档里的 tweet.js / like.js（window.YTD.*.partN = [...] 包裹
 *   的 JSON 数组；tweet 嵌套 entities.urls / hashtags，like 嵌套 expandedUrl）。
 * - Reddit：通用 JSON 数组（{url|permalink, title, subreddit}）、CSV
 *   （含 url + title 列）、纯链接文本（含 reddit 帖子链接本身）。
 * - GitHub Stars：JSON 数组（{html_url, full_name, description, language,
 *   topics}，即 starred 仓库的常见导出形状）、CSV（含 html_url/url 列）。
 * - Hacker News：favorites 页另存的 HTML（外链标题 + item?id= 评论页链接均
 *   认作收藏项）、通用 JSON 数组、纯链接文本。
 * - Instagram：数据下载里的 saved_posts.json / liked_posts.json 形状
 *   （{title, string_list_data: [{href, timestamp}]}）。
 * - TikTok：只支持通用 JSON 数组 / CSV / 纯链接粘贴；结构化导出格式未
 *   核实，一律报不支持并指引改粘贴链接。
 */

import { fingerprintUrl } from './import-workbench'
import { generateBookmarkId, sanitizeBookmarkUrl, type ParsedUniversalItem } from './favorites-export-import'
import { stripHtmlTags } from './html-text'

export type SocialPlatformId = 'x' | 'reddit' | 'github' | 'hackernews' | 'instagram' | 'tiktok'

export interface SocialPlatformMeta {
  id: SocialPlatformId
  /** 界面上的中文名 */
  label: string
  /** 导入后落的文件夹名 */
  folder: string
  /** 告诉用户去哪里拿导出文件（不登录本应用，只在平台侧自取） */
  howTo: string
  /** 该平台支持的文件后缀提示 */
  acceptHint: string
}

export const SOCIAL_PLATFORMS: SocialPlatformMeta[] = [
  {
    id: 'x',
    label: 'X / Twitter',
    folder: 'X / Twitter',
    howTo: '在 X 设置里下载数据归档，解压后取 data 文件夹下的 tweet.js（推文）或 like.js（喜欢）。',
    acceptHint: '.js / .json',
  },
  {
    id: 'reddit',
    label: 'Reddit',
    folder: 'Reddit',
    howTo: 'Reddit 账号设置里申请数据导出，或把已保存帖子存成 JSON 数组 / CSV（含 url、title 列）。',
    acceptHint: '.json / .csv / .txt',
  },
  {
    id: 'github',
    label: 'GitHub Stars',
    folder: 'GitHub Stars',
    howTo: '把 Star 列表存成 JSON 数组（每项含 html_url、full_name、description、language），或 CSV（含 html_url 列）。',
    acceptHint: '.json / .csv',
  },
  {
    id: 'hackernews',
    label: 'Hacker News',
    folder: 'Hacker News',
    howTo: '打开 HN 的 favorites / saved 页，浏览器另存为 HTML；或把收藏存成 JSON 数组 / 链接文本。',
    acceptHint: '.html / .json / .txt',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    folder: 'Instagram',
    howTo: '在 Instagram 设置里下载数据，取 saved_posts.json（已保存）或 liked_posts.json（点赞）。',
    acceptHint: '.json',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    folder: 'TikTok',
    howTo: '暂不支持 TikTok 的结构化导出文件：请直接粘贴视频链接（每行一个），或提供 JSON 数组 / CSV。',
    acceptHint: '.json / .csv / .txt（仅链接）',
  },
]

export const SOCIAL_PLATFORM_BY_ID: Record<SocialPlatformId, SocialPlatformMeta> = Object.fromEntries(
  SOCIAL_PLATFORMS.map((p) => [p.id, p]),
) as Record<SocialPlatformId, SocialPlatformMeta>

/** 解析失败的一行：行号 + 原因 + 原文节选，用户照着就能改 */
export interface SocialFailure {
  /** JSON 数组里是第几项（1 起），纯文本里是第几行（1 起） */
  line: number
  reason: string
  excerpt?: string
}

export interface SocialParseResult {
  ok: boolean
  platform: SocialPlatformId
  format: 'ytd-js' | 'json' | 'csv' | 'html' | 'text'
  items: ParsedUniversalItem[]
  /** 批内重复（按 fingerprintUrl），交给去重报告判 intra-file-dup */
  droppedDuplicates: ParsedUniversalItem[]
  /** 无法解析成收藏的行：逐行点名，不静默丢 */
  failures: SocialFailure[]
  skippedCount: number
  truncated?: boolean
  totalMatched?: number
  error?: string
}

const MAX_TITLE = 200
const MAX_DESC = 300

function cleanTitle(text: string, fallback: string): string {
  const t = text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  return (t || fallback).slice(0, MAX_TITLE)
}

function pushItem(
  acc: { items: ParsedUniversalItem[]; dropped: ParsedUniversalItem[]; seen: Set<string> },
  raw: { href: string; title: string; folder: string; tags?: string[]; description?: string; createdAt?: number },
): void {
  const href = sanitizeBookmarkUrl(raw.href)
  const fp = fingerprintUrl(href)
  if (!href || !fp) return
  const item: ParsedUniversalItem = {
    siteId: generateBookmarkId(href),
    title: cleanTitle(raw.title, href),
    href,
    folderName: raw.folder,
    tags: (raw.tags ?? []).map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean).slice(0, 8),
    description: raw.description ? raw.description.slice(0, MAX_DESC) : undefined,
    createdAt: raw.createdAt ?? Date.now(),
  }
  if (acc.seen.has(fp)) {
    acc.dropped.push(item)
    return
  }
  acc.seen.add(fp)
  acc.items.push(item)
}

/** X 归档的 window.YTD.xxx.partN = [...] 包裹：只剥外壳，不 eval */
function unwrapYtd(content: string): unknown | null {
  const match = content.match(/window\.YTD\.[a-zA-Z0-9_]+\.part\d+\s*=\s*(\[[\s\S]*\])\s*;?\s*$/)
  if (!match) return null
  try {
    return JSON.parse(match[1]!)
  } catch {
    return null
  }
}

function tryJson(content: string): unknown | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

/** 最小 CSV 解析：支持双引号转义与逗号分隔，首行为表头 */
export function parseCsvRows(content: string): Array<Record<string, string>> {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { quoted = false }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n') {
      row.push(field); field = ''; rows.push(row); row = []
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''))
  if (nonEmpty.length < 2) return []
  const headers = nonEmpty[0]!.map((h) => h.trim().toLowerCase())
  return nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim() })
    return obj
  })
}

function csvUrlColumns(row: Record<string, string>): string {
  for (const key of ['html_url', 'url', 'link', 'href', 'permalink']) {
    if (row[key]) return row[key]
  }
  return ''
}

/* ------------------------------------------------------------------ *
 * 各平台解析器：输入已判定的结构，输出统一的 ParsedUniversalItem       *
 * ------------------------------------------------------------------ */

function parseXTweets(list: unknown[], meta: SocialPlatformMeta): SocialParseResult {
  const acc = { items: [] as ParsedUniversalItem[], dropped: [] as ParsedUniversalItem[], seen: new Set<string>() }
  const failures: SocialFailure[] = []
  let skipped = 0
  list.forEach((entry, i) => {
    const line = i + 1
    const obj = (entry as { tweet?: Record<string, unknown>; like?: Record<string, unknown> }) ?? {}
    const tweet = (obj.tweet ?? obj.like ?? obj) as Record<string, unknown>
    const text = String(tweet.full_text ?? tweet.fullText ?? tweet.text ?? '')
    const entities = (tweet.entities ?? {}) as { urls?: Array<{ expanded_url?: string; url?: string }>; hashtags?: Array<{ text?: string }> }
    const expanded = entities.urls?.map((u) => u.expanded_url ?? u.url ?? '').filter(Boolean) ?? []
    const likeUrl = typeof tweet.expandedUrl === 'string' ? tweet.expandedUrl : ''
    const fromText = text.match(/https?:\/\/\S+/g) ?? []
    const urls = [...new Set([...expanded, likeUrl, ...fromText].filter(Boolean))]
    const hashtags = (entities.hashtags ?? []).map((h) => h.text ?? '').filter(Boolean)
    if (urls.length === 0) {
      failures.push({ line, reason: '该推文没有附带链接（纯文字推文无法作为网址收藏导入）', excerpt: text.slice(0, 60) || '(空推文)' })
      skipped++
      return
    }
    const createdAt = typeof tweet.created_at === 'string' ? Date.parse(tweet.created_at) : undefined
    for (const url of urls) {
      pushItem(acc, {
        href: url,
        title: text,
        folder: meta.folder,
        tags: ['x', ...hashtags],
        createdAt: Number.isNaN(createdAt) ? undefined : createdAt,
      })
    }
  })
  return finish(meta, 'ytd-js', acc, failures, skipped, list.length)
}

function parseRedditList(list: unknown[], meta: SocialPlatformMeta): SocialParseResult {
  const acc = { items: [] as ParsedUniversalItem[], dropped: [] as ParsedUniversalItem[], seen: new Set<string>() }
  const failures: SocialFailure[] = []
  let skipped = 0
  list.forEach((entry, i) => {
    const line = i + 1
    const r = (entry ?? {}) as Record<string, unknown>
    const rawUrl = String(r.url ?? r.permalink ?? r.link ?? '')
    const href = rawUrl.startsWith('/')
      ? `https://www.reddit.com${rawUrl}`
      : rawUrl
    const title = String(r.title ?? r.name ?? href)
    const sub = String(r.subreddit ?? r.subreddit_name_prefixed ?? '').replace(/^r\//, '')
    if (!href || !/^https?:\/\//i.test(href)) {
      failures.push({ line, reason: '缺少 url / permalink 字段，无法确定收藏地址', excerpt: title.slice(0, 60) })
      skipped++
      return
    }
    pushItem(acc, {
      href,
      title,
      folder: meta.folder,
      tags: sub ? ['reddit', sub] : ['reddit'],
      description: typeof r.selftext === 'string' ? r.selftext : undefined,
    })
  })
  return finish(meta, 'json', acc, failures, skipped, list.length)
}

function parseGithubList(list: unknown[], meta: SocialPlatformMeta): SocialParseResult {
  const acc = { items: [] as ParsedUniversalItem[], dropped: [] as ParsedUniversalItem[], seen: new Set<string>() }
  const failures: SocialFailure[] = []
  let skipped = 0
  list.forEach((entry, i) => {
    const line = i + 1
    const r = (entry ?? {}) as Record<string, unknown>
    const href = String(r.html_url ?? r.url ?? r.link ?? '')
    const fullName = String(r.full_name ?? r.name ?? href)
    if (!href || !/^https?:\/\//i.test(href)) {
      failures.push({ line, reason: '缺少 html_url 字段，无法确定仓库地址', excerpt: fullName.slice(0, 60) })
      skipped++
      return
    }
    const topics = Array.isArray(r.topics) ? r.topics.map(String) : []
    const language = typeof r.language === 'string' ? r.language : ''
    pushItem(acc, {
      href,
      title: fullName,
      folder: meta.folder,
      tags: ['github', language, ...topics].filter(Boolean),
      description: typeof r.description === 'string' ? r.description : undefined,
    })
  })
  return finish(meta, 'json', acc, failures, skipped, list.length)
}

function parseHnHtml(content: string, meta: SocialPlatformMeta): SocialParseResult {
  const acc = { items: [] as ParsedUniversalItem[], dropped: [] as ParsedUniversalItem[], seen: new Set<string>() }
  const failures: SocialFailure[] = []
  const anchors = [...content.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
  let skipped = 0
  for (const m of anchors) {
    const rawHref = (m[1] ?? '').trim()
    // HN 标题里的内联标签用状态机剥（CodeQL #138）：单次正则 replace 会把
    // 嵌套标签拼接复活、引号内的 `>` 会提前截断，见 ./html-text。
    const title = stripHtmlTags(m[2] ?? '')
    if (!rawHref || !title) { skipped++; continue }
    // HN 站内导航（投票、用户页、提交页）不是收藏
    if (/^(vote|user\?|submit|newcomments|threads|ask|show|jobs|front|newest|active|noob)/i.test(rawHref)) continue
    if (/^item\?id=\d+$/i.test(rawHref)) {
      pushItem(acc, { href: `https://news.ycombinator.com/${rawHref}`, title, folder: meta.folder, tags: ['hackernews'] })
      continue
    }
    if (!/^https?:\/\//i.test(rawHref)) { skipped++; continue }
    pushItem(acc, { href: rawHref, title, folder: meta.folder, tags: ['hackernews'] })
  }
  return finish(meta, 'html', acc, failures, skipped, anchors.length)
}

function parseInstagramList(list: unknown[], meta: SocialPlatformMeta): SocialParseResult {
  const acc = { items: [] as ParsedUniversalItem[], dropped: [] as ParsedUniversalItem[], seen: new Set<string>() }
  const failures: SocialFailure[] = []
  let skipped = 0
  list.forEach((entry, i) => {
    const line = i + 1
    const r = (entry ?? {}) as Record<string, unknown>
    const title = String(r.title ?? '')
    const stringList = (r.string_list_data ?? []) as Array<{ href?: string; timestamp?: number; value?: string }>
    if (!Array.isArray(stringList) || stringList.length === 0) {
      failures.push({ line, reason: '缺少 string_list_data（不是 saved_posts.json / liked_posts.json 的形状）', excerpt: title.slice(0, 60) || '(无标题)' })
      skipped++
      return
    }
    for (const s of stringList) {
      const href = String(s.href ?? s.value ?? '')
      if (!href) { skipped++; continue }
      pushItem(acc, {
        href,
        title: title || href,
        folder: meta.folder,
        tags: ['instagram'],
        createdAt: typeof s.timestamp === 'number' ? s.timestamp * 1000 : undefined,
      })
    }
  })
  return finish(meta, 'json', acc, failures, skipped, list.length)
}

/** 通用 JSON 数组：每项含 url + 可选 title（Reddit / GitHub / HN / TikTok 共用兜底） */
function parseGenericJsonList(list: unknown[], meta: SocialPlatformMeta): SocialParseResult {
  const acc = { items: [] as ParsedUniversalItem[], dropped: [] as ParsedUniversalItem[], seen: new Set<string>() }
  const failures: SocialFailure[] = []
  let skipped = 0
  list.forEach((entry, i) => {
    const line = i + 1
    const r = (entry ?? {}) as Record<string, unknown>
    const href = String(r.url ?? r.html_url ?? r.permalink ?? r.link ?? r.href ?? '')
    if (!href || !/^https?:\/\//i.test(href)) {
      failures.push({ line, reason: '缺少 url 字段，无法确定收藏地址', excerpt: String(r.title ?? '').slice(0, 60) || '(无标题)' })
      skipped++
      return
    }
    pushItem(acc, {
      href,
      title: String(r.title ?? r.name ?? href),
      folder: meta.folder,
      tags: [meta.id],
      description: typeof r.description === 'string' ? r.description : undefined,
    })
  })
  return finish(meta, 'json', acc, failures, skipped, list.length)
}

function parseCsv(content: string, meta: SocialPlatformMeta): SocialParseResult {
  const rows = parseCsvRows(content)
  const acc = { items: [] as ParsedUniversalItem[], dropped: [] as ParsedUniversalItem[], seen: new Set<string>() }
  const failures: SocialFailure[] = []
  let skipped = 0
  rows.forEach((row, i) => {
    const line = i + 2 // 表头占第 1 行
    const href = csvUrlColumns(row)
    if (!href || !/^https?:\/\//i.test(href)) {
      failures.push({ line, reason: '该行没有可识别的 url / html_url 列', excerpt: Object.values(row).join(' ').slice(0, 60) || '(空行)' })
      skipped++
      return
    }
    const sub = (row.subreddit ?? '').replace(/^r\//, '')
    const language = row.language ?? ''
    pushItem(acc, {
      href,
      title: row.title ?? row.name ?? href,
      folder: meta.folder,
      tags: [meta.id, sub, language].filter(Boolean),
      description: row.description || undefined,
    })
  })
  return finish(meta, 'csv', acc, failures, skipped, rows.length)
}

/** 纯链接文本：每行一个 URL（可带标题），逐行报错、不整批失败 */
function parseTextLines(content: string, meta: SocialPlatformMeta): SocialParseResult {
  const acc = { items: [] as ParsedUniversalItem[], dropped: [] as ParsedUniversalItem[], seen: new Set<string>() }
  const failures: SocialFailure[] = []
  let skipped = 0
  const lines = content.split(/\r?\n/)
  lines.forEach((rawLine, i) => {
    const line = rawLine.trim()
    if (!line) return
    const m = line.match(/(https?:\/\/[^\s|]+)/i)
    if (!m) {
      failures.push({ line: i + 1, reason: '该行没有可识别的 http(s) 链接', excerpt: line.slice(0, 60) })
      skipped++
      return
    }
    const rest = line.replace(m[1]!, '').replace(/^\s*[|\-–—]\s*/, '').trim()
    pushItem(acc, { href: m[1]!, title: rest || m[1]!, folder: meta.folder, tags: [meta.id] })
  })
  return finish(meta, 'text', acc, failures, skipped, lines.filter((l) => l.trim()).length)
}

function finish(
  meta: SocialPlatformMeta,
  format: SocialParseResult['format'],
  acc: { items: ParsedUniversalItem[]; dropped: ParsedUniversalItem[]; seen: Set<string> },
  failures: SocialFailure[],
  skipped: number,
  totalMatched: number,
): SocialParseResult {
  return {
    ok: acc.items.length > 0,
    platform: meta.id,
    format,
    items: acc.items,
    droppedDuplicates: acc.dropped,
    failures,
    skippedCount: skipped,
    totalMatched,
    error: acc.items.length === 0 ? '没有解析出有效收藏链接' : undefined,
  }
}

/* ------------------------------------------------------------------ *
 * 平台判定 + 总入口                                                    *
 * ------------------------------------------------------------------ */

/**
 * 按文件名与内容信号判定平台；拿不准返回 null（调用方让用户手动选，
 * 不猜一个错平台去解析）。
 */
export function detectSocialPlatform(content: string, filename = ''): SocialPlatformId | null {
  const name = filename.toLowerCase()
  const head = content.slice(0, 2000)
  if (/tweet\.js|like\.js/.test(name) || /window\.YTD\.(tweet|like)\.part\d+/.test(head)) return 'x'
  if (/saved_posts\.json|liked_posts\.json/.test(name) || /"string_list_data"/.test(head)) return 'instagram'
  if (/hacker|news\.ycombinator\.com/.test(name) || /news\.ycombinator\.com/.test(head)) return 'hackernews'
  if (/"html_url"/.test(head) && /"full_name"/.test(head)) return 'github'
  if (/"subreddit"/.test(head)) return 'reddit'
  if (/tiktok\.com/.test(head) && !/https?:\/\/\S*reddit\.com/.test(head)) return 'tiktok'
  return null
}

export function parseSocialSaves(
  content: string,
  opts: { platform?: SocialPlatformId | 'auto'; filename?: string; limit?: number } = {},
): SocialParseResult {
  const trimmed = content.trim()
  const platformId = opts.platform && opts.platform !== 'auto'
    ? opts.platform
    : detectSocialPlatform(content, opts.filename ?? '')
  if (!platformId) {
    return {
      ok: false,
      platform: 'x',
      format: 'text',
      items: [],
      droppedDuplicates: [],
      failures: [{ line: 1, reason: '无法从文件名或内容判断是哪个平台的导出，请手动选择平台后重试' }],
      skippedCount: 0,
      error: '无法识别平台：请手动选择 X / Reddit / GitHub Stars / Hacker News / Instagram / TikTok 后重试。',
    }
  }
  const meta = SOCIAL_PLATFORM_BY_ID[platformId]
  if (!trimmed) {
    return {
      ok: false, platform: platformId, format: 'text', items: [], droppedDuplicates: [],
      failures: [], skippedCount: 0, error: '内容为空，请重新选择文件或粘贴内容。',
    }
  }

  // TikTok：结构化导出未核实，只走通用解析；结构化 JSON 进来会自然落到
  // 「缺少 url 字段」的逐行失败里，不编造解析规则。
  const ytd = unwrapYtd(content)
  if (ytd !== null) {
    if (!Array.isArray(ytd)) {
      return { ok: false, platform: platformId, format: 'ytd-js', items: [], droppedDuplicates: [], failures: [], skippedCount: 0, error: 'X 归档文件结构异常：window.YTD 包裹的不是数组。' }
    }
    if (platformId !== 'x') {
      return { ok: false, platform: platformId, format: 'ytd-js', items: [], droppedDuplicates: [], failures: [], skippedCount: 0, error: '这是 X 的归档文件（window.YTD），与所选平台不符，请把平台改成 X / Twitter。' }
    }
    return limitResult(parseXTweets(ytd, meta), opts.limit)
  }

  const json = tryJson(content)
  if (json !== null) {
    const list = Array.isArray(json)
      ? json
      : Array.isArray((json as Record<string, unknown>).items)
        ? (json as { items: unknown[] }).items
        : Array.isArray((json as Record<string, unknown>).saved_posts)
          ? (json as { saved_posts: unknown[] }).saved_posts
          : null
    if (list === null) {
      return { ok: false, platform: platformId, format: 'json', items: [], droppedDuplicates: [], failures: [], skippedCount: 0, error: 'JSON 顶层不是数组，也没有 items / saved_posts 数组，无法解析。' }
    }
    switch (platformId) {
      case 'x': return limitResult(parseXTweets(list, meta), opts.limit)
      case 'reddit': return limitResult(parseRedditList(list, meta), opts.limit)
      case 'github': return limitResult(parseGithubList(list, meta), opts.limit)
      case 'instagram': return limitResult(parseInstagramList(list, meta), opts.limit)
      case 'hackernews':
      case 'tiktok': return limitResult(parseGenericJsonList(list, meta), opts.limit)
    }
  }

  if (/<a\s+[^>]*href=/i.test(trimmed) || /<!DOCTYPE/i.test(trimmed)) {
    if (platformId !== 'hackernews') {
      return { ok: false, platform: platformId, format: 'html', items: [], droppedDuplicates: [], failures: [], skippedCount: 0, error: 'HTML 收藏页只支持 Hacker News 的 favorites 页，其他平台请提供 JSON / CSV 导出。' }
    }
    return limitResult(parseHnHtml(content, meta), opts.limit)
  }

  const csvRows = parseCsvRows(content)
  // 只有表头含 url 类列名才算 CSV：否则「每行一个链接」的纯文本会被误判
  // （两行文本恰好构成“表头 + 一行”），坏行就再也报不出来。
  const csvHeaders = content.split(/\r?\n/)[0]!.toLowerCase()
  const looksCsv = csvRows.length > 0 && ['url', 'html_url', 'link', 'href', 'permalink'].some((c) => csvHeaders.includes(c))
  if (looksCsv) {
    return limitResult(parseCsv(content, meta), opts.limit)
  }

  return limitResult(parseTextLines(content, meta), opts.limit)
}

function limitResult(result: SocialParseResult, limit = 5000): SocialParseResult {
  if (result.items.length <= limit) return result
  return { ...result, items: result.items.slice(0, limit), truncated: true }
}
