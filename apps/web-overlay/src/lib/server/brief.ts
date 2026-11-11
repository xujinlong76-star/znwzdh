import { hubGet } from './hub'

/**
 * 每日简报 + 全网热榜的服务端取数（GET /api/brief/today、GET /api/hotlist）。
 *
 * 数据都在中枢：热榜由 hotlist_refresh 任务低频抓取落缓存，简报由
 * daily_brief 任务按天组版落库。这里只是类型化转发，页面不许自己拼
 * 第二份榜单或现算简报。服务端取数不带用户身份——简报的在追提醒段
 * 由客户端岛带身份再取（见 app/brief/brief-watch.tsx）。
 */

export interface HubHotlistItem {
  rank: number
  title: string
  url: string
  hotValue: number | null
  hotLabel: string | null
}

export interface HubHotlistSource {
  id: string
  name: string
  homeUrl: string
  /** ok = 最近一次抓取成功；stale = 抓取失败、下发上次缓存；empty = 还没抓到过 */
  status: 'ok' | 'stale' | 'empty'
  fetchedAt: number | null
  items: HubHotlistItem[]
}

export interface HubHotlist {
  ok: true
  generatedAt: number | null
  sources: HubHotlistSource[]
  uncovered: Array<{ id: string; name: string; homeUrl: string; reason: string }>
}

export interface HubBriefHotPick extends HubHotlistItem {
  source: string
  sourceName: string
  fetchedAt: number
}

export interface HubBriefNewSite {
  id: string
  title: string
  url: string
  description: string | null
  createdAt: number
  addedOn: string
}

export interface HubBriefWatchItem {
  key: string
  title: string
  platformTitle: string
  playUrl: string
  episode: number
  priority: 'high' | 'normal'
}

export interface HubBrief {
  ok: true
  date: string
  isToday: boolean
  generatedAt: number
  opening: string
  openingMode: 'ai' | 'template'
  hotPicks: HubBriefHotPick[]
  /** today = 今天真有新增；recent = 无今日新增、展示最近收录（带日期） */
  newSitesScope: 'today' | 'recent'
  newSites: HubBriefNewSite[]
  watch: { due: HubBriefWatchItem[]; check: HubBriefWatchItem[] } | null
}

export async function loadHotlist(revalidate = 300): Promise<HubHotlist | null> {
  return hubGet<HubHotlist>('/api/hotlist', revalidate)
}

export async function loadBriefToday(revalidate = 300): Promise<HubBrief | null> {
  return hubGet<HubBrief>('/api/brief/today', revalidate)
}

/** 热度数值展示：12345 → 1.2万；源站没给数值时返回 null（不编造） */
export function formatHotValue(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1).replace(/\.0$/, '')}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1).replace(/\.0$/, '')}万`
  return String(value)
}

/** 毫秒戳 → HH:mm（展示「更新于」） */
export function formatClock(ts: number | null): string | null {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
