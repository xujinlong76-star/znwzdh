/**
 * 跨设备接力卡的纯规则层（Batch 3 第 9 项，C 组）。
 *
 * 职责只有一件：把「本机播放历史 + 云端视频进度 + 最近打开 visits +
 * 追剧 watchlist」四路输入，挑成「一条」接力项 + 剩余条数。
 *
 * 规则（设计 batch3-items-8-12-design.md 第 9 项 §3.1、§3.4、§3.5）：
 *  - 一卡只显示一条：最新的一条未完成进度；超过 1 条时只给剩余条数。
 *  - 视频 ≥95% 视为完成，不显示（沿用 video-playback-storage 的 95% 口径）。
 *  - 两设备同视频取 updatedAt 更晚者（LWW）。
 *  - 未来时间戳（updatedAt > now + 5min，时钟回拨的脏数据）丢弃。
 *  - YouTube 类无秒数的记录只显示「继续观看」，不写「从 xx:xx 继续」。
 *  - 不编造设备名：卡上只写相对时间（如「2 小时前」），没有 deviceLabel
 *    时不猜、不补。
 *
 * 本模块不读存储、不发请求、不碰 CRDT：云端数据的接线是 D 组的工作，
 * 调用方把数据以 props 传进来即可。也不读 `lastOpenedAt`——那是本机-only
 * 的既定语义（见 resurface.ts 文件头），接力卡不碰它。
 */
import { formatRelativeTime } from './format-relative-time'
import { formatDuration } from './video-format'
import type { PlaybackHistoryItem } from './video-playback-storage'

/** 视频 ≥95% 视为看完：卡上消失（记录本身保留，见设计 §3.4）。 */
export const HANDOFF_COMPLETED_PERCENT = 95
/** 未来时间戳容差：updatedAt 超过 now + 5 分钟即视为时钟回拨脏数据，丢弃。 */
export const HANDOFF_FUTURE_SKEW_MS = 5 * 60 * 1000

export interface HandoffVideoProgress {
  videoId: string
  title: string
  author?: string
  cover?: string
  platform: 'bilibili' | 'youtube' | 'other'
  timestampSec: number
  durationSec: number
  progressPercent: number
  /** LWW 键 */
  updatedAt: number
  deviceId: string
  /** 无可靠设备名时不编造：留空，卡上只写相对时间 */
  deviceLabel?: string
}

/** 最近打开（读已有的 /api/me/visits，不新增埋点）。 */
export interface HandoffVisit {
  siteId: string
  title: string
  url: string
  icon?: string
  at: number
}

/** 追剧（读已有的 watchlist 云端数据，不新增写路径）。 */
export interface HandoffWatchlistEntry {
  key: string
  title: string
  playUrl: string
  icon?: string
  /** 看到第几集（0 = 还没开始看） */
  episode: number
  lastProgressAt: number
}

export type HandoffItem =
  | {
      kind: 'video'
      id: string
      title: string
      author?: string
      cover?: string
      platform: HandoffVideoProgress['platform']
      timestampSec: number
      durationSec: number
      progressPercent: number
      updatedAt: number
      /** 有可信秒数时才为 true；YouTube/iframe 类永远 false */
      hasSeek: boolean
    }
  | {
      kind: 'visit'
      id: string
      title: string
      url: string
      icon?: string
      updatedAt: number
    }
  | {
      kind: 'watchlist'
      id: string
      title: string
      playUrl: string
      icon?: string
      episode: number
      updatedAt: number
    }

export interface HandoffInputs {
  /** 本机播放历史（已由调用方从 video-playback-storage 读出并适配） */
  localProgress: HandoffVideoProgress[]
  /** 云端视频进度（D 组接线后传入；未传 = 只有本机数据） */
  cloudProgress?: HandoffVideoProgress[]
  /** 最近打开（D 组接线后传入） */
  visits?: HandoffVisit[]
  /** 追剧清单（D 组接线后传入；调用方先滤掉已完结条目） */
  watchlist?: HandoffWatchlistEntry[]
  now?: number
}

export interface HandoffSelection {
  /** 最新的一条未完成进度；没有时为 null（调用方整块不渲染） */
  current: HandoffItem | null
  /** 除 current 外还剩几条（>0 时卡上给「还有 N 条」进 /me/history） */
  remaining: number
  /** 全部候选（按 updatedAt 降序），供调试与测试 */
  items: HandoffItem[]
}

function isFutureTimestamp(updatedAt: number, now: number): boolean {
  return Number.isFinite(updatedAt) && updatedAt > now + HANDOFF_FUTURE_SKEW_MS
}

function isValidProgress(p: HandoffVideoProgress): boolean {
  return (
    typeof p.videoId === 'string' &&
    p.videoId.length > 0 &&
    typeof p.title === 'string' &&
    p.title.trim().length > 0 &&
    Number.isFinite(p.updatedAt) &&
    Number.isFinite(p.progressPercent)
  )
}

/**
 * 本机播放历史 → 接力进度：`lastWatchedAt` 就是 LWW 键 `updatedAt`；
 * deviceId 复用 CRDT 的 sessionStorage client id，不新建 id。
 */
export function adaptLocalPlayback(
  item: PlaybackHistoryItem,
  deviceId: string,
): HandoffVideoProgress {
  return {
    videoId: item.videoId,
    title: item.title,
    author: item.author,
    cover: item.cover,
    platform: item.platform,
    timestampSec: item.timestampSec,
    durationSec: item.durationSec,
    progressPercent: item.progressPercent,
    updatedAt: item.lastWatchedAt,
    deviceId,
  }
}

/**
 * 两路视频进度按 videoId 做 LWW 合并：同视频取 updatedAt 更晚者；
 * 未来时间戳与 ≥95% 的已完成记录在合并前丢弃。
 */
export function mergeVideoProgress(
  local: HandoffVideoProgress[],
  cloud: HandoffVideoProgress[],
  now = Date.now(),
): HandoffVideoProgress[] {
  const byId = new Map<string, HandoffVideoProgress>()
  for (const p of [...local, ...cloud]) {
    if (!isValidProgress(p)) continue
    if (isFutureTimestamp(p.updatedAt, now)) continue
    if (p.progressPercent >= HANDOFF_COMPLETED_PERCENT) continue
    const prev = byId.get(p.videoId)
    if (!prev || p.updatedAt > prev.updatedAt) byId.set(p.videoId, p)
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

function toVideoItem(p: HandoffVideoProgress): HandoffItem {
  const hasSeek =
    p.platform !== 'youtube' && Number.isFinite(p.timestampSec) && p.timestampSec > 0
  return {
    kind: 'video',
    id: p.videoId,
    title: p.title,
    author: p.author,
    cover: p.cover,
    platform: p.platform,
    timestampSec: hasSeek ? Math.floor(p.timestampSec) : 0,
    durationSec: p.durationSec,
    progressPercent: p.progressPercent,
    updatedAt: p.updatedAt,
    hasSeek,
  }
}

function toVisitItem(v: HandoffVisit): HandoffItem | null {
  if (!v.siteId || !v.title?.trim() || !v.url?.trim()) return null
  if (!Number.isFinite(v.at)) return null
  return { kind: 'visit', id: v.siteId, title: v.title, url: v.url, icon: v.icon, updatedAt: v.at }
}

function toWatchlistItem(w: HandoffWatchlistEntry): HandoffItem | null {
  if (!w.key || !w.title?.trim() || !w.playUrl?.trim()) return null
  if (!Number.isFinite(w.lastProgressAt)) return null
  return {
    kind: 'watchlist',
    id: w.key,
    title: w.title,
    playUrl: w.playUrl,
    icon: w.icon,
    episode: w.episode,
    updatedAt: w.lastProgressAt,
  }
}

/**
 * 四路输入 → 一条接力项 + 剩余条数。
 *
 * 排序口径：所有候选统一按 updatedAt 降序，最新的一条胜出——「最新的一条
 * 未完成进度」，不按类型加权。视频内部已先做 LWW 合并；visits/watchlist
 * 各取全部有效条目参与排序（不是只取最新一条：剩余条数要如实计数）。
 */
export function selectHandoffItems(input: HandoffInputs): HandoffSelection {
  const now = input.now ?? Date.now()
  const items: HandoffItem[] = []

  for (const p of mergeVideoProgress(input.localProgress, input.cloudProgress ?? [], now)) {
    items.push(toVideoItem(p))
  }
  for (const v of input.visits ?? []) {
    if (isFutureTimestamp(v.at, now)) continue
    const item = toVisitItem(v)
    if (item) items.push(item)
  }
  for (const w of input.watchlist ?? []) {
    if (isFutureTimestamp(w.lastProgressAt, now)) continue
    const item = toWatchlistItem(w)
    if (item) items.push(item)
  }

  items.sort((a, b) => b.updatedAt - a.updatedAt)
  return {
    current: items[0] ?? null,
    remaining: Math.max(0, items.length - 1),
    items,
  }
}

/** 主按钮文案：视频有秒数才写「从 xx:xx 继续」，否则只写「继续观看」。 */
export function handoffPrimaryLabel(item: HandoffItem): string {
  if (item.kind === 'video') {
    return item.hasSeek ? `从 ${formatDuration(item.timestampSec)} 继续` : '继续观看'
  }
  if (item.kind === 'visit') return '打开'
  return '看下一集'
}

/** 卡面副行：进度 + 相对时间，不写设备名（没有可靠来源，不编造）。 */
export function handoffDetailLine(item: HandoffItem, now = Date.now()): string {
  const when = formatRelativeTime(item.updatedAt, now)
  if (item.kind === 'video') return `看到 ${item.progressPercent}% · ${when}`
  if (item.kind === 'visit') return `${when}打开过`
  return item.episode > 0 ? `追到第 ${item.episode} 集 · ${when}` : `刚加入追剧 · ${when}`
}

/** 视频主按钮目标：复用已有的 /videos/player?id=…&t=… 章节直达链路。 */
export function handoffVideoHref(item: Extract<HandoffItem, { kind: 'video' }>): string {
  const base = `/videos/player?id=${encodeURIComponent(item.id)}`
  return item.hasSeek ? `${base}&t=${item.timestampSec}` : base
}
