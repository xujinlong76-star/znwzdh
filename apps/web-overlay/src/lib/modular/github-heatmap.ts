/**
 * GitHub 提交热力小卡的取数与算分逻辑（纯函数，可单测）。
 *
 * 为什么单独拆出来：这个小组件以前**整块是假的** —— 用 `Math.sin` 伪随机造出提交数，
 * 默认用户名写死 `torvalds`，而且注册表没有 configSchema，用户在界面上根本没法改用户名。
 * 于是每张卡片都在用真数字的排版展示编造的贡献记录。
 *
 * 现在走 GitHub 公开事件 API 拿真实 PushEvent 提交数；拿不到就明说拿不到，
 * 模拟矩阵只在用户显式点「预览模拟布局」时出现，并且带上常驻的「模拟数据」标记。
 *
 * API 边界（决定了文案必须怎么写）：
 *  - `/users/{u}/events/public` 只给**最近 90 天、最多 300 条**事件，不是完整贡献日历；
 *  - 单个 PushEvent 的 `payload.commits` 最多 20 条，长推送会被截断；
 *  - 未登录调用按 IP 限流 60 次/小时。
 * 所以读数只能宣称「可见事件里的提交数」，不能宣称年度总贡献。
 */

/** 一格：日期（本地 YYYY-MM-DD）、提交数、色阶 0-4、是否属于未来（本周尾巴） */
export interface HeatmapCell {
  date: string
  count: number
  level: number
  future?: boolean
}

export interface HeatmapData {
  /** 列 = 周（行 0 是周日），行数固定 7 */
  weeks: HeatmapCell[][]
  totalCommits: number
  activeDays: number
  currentStreak: number
  longestStreak: number
  maxDaily: number
  /** 窗口内可见的第一天 / 最后一天（本地日期字符串） */
  coveredFrom: string | null
  coveredTo: string | null
  source: 'live' | 'demo'
  /** 事件流被 300 条 / 90 天上限截断：窗口里的数字只是可见部分 */
  truncated: boolean
}

export const HEATMAP_WEEKS = 13
const EVENTS_PER_PAGE = 100
const EVENTS_MAX_PAGES = 3
/** 300 条事件正好吃掉 API 的分页上限；达到即认为被截断 */
const EVENT_PAGE_LIMIT = EVENTS_PER_PAGE * EVENTS_MAX_PAGES

export function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function addDays(d: Date, delta: number): Date {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  next.setDate(next.getDate() + delta)
  return next
}

/**
 * 把公开事件里的 PushEvent 汇总成「本地日期 -> 提交数」。
 *
 * 脏输入（缺字段、commits 不是数组、时间戳不可解析）逐条忽略，不让整个卡片崩：
 * 这个 API 的 payload 形状按事件类型变化，任何一条都不可信。
 */
export function aggregatePushCommits(events: readonly unknown[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue
    const ev = raw as { type?: unknown; created_at?: unknown; payload?: unknown }
    if (ev.type !== "PushEvent") continue
    const ts = typeof ev.created_at === "string" ? Date.parse(ev.created_at) : Number.NaN
    if (!Number.isFinite(ts)) continue
    const commits = (ev.payload as { commits?: unknown } | undefined)?.commits
    const n = Array.isArray(commits) ? commits.length : 0
    if (n <= 0) continue
    const key = localDateKey(new Date(ts))
    counts.set(key, (counts.get(key) ?? 0) + n)
  }
  return counts
}

/** 四分位阈值（严格递增）：色阶按**这份数据自己的分布**分档，不写死 1/4/8/12 */
export function levelThresholds(counts: readonly number[]): [number, number, number] {
  const sorted = counts.filter((c) => c > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return [1, 2, 3]
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
  const t1 = Math.max(1, at(0.25))
  const t2 = Math.max(t1 + 1, at(0.5))
  const t3 = Math.max(t2 + 1, at(0.75))
  return [t1, t2, t3]
}

export function levelFor(count: number, thresholds: readonly [number, number, number]): number {
  if (count <= 0) return 0
  if (count <= thresholds[0]) return 1
  if (count <= thresholds[1]) return 2
  if (count <= thresholds[2]) return 3
  return 4
}

/**
 * 由「日期 -> 提交数」铺出 weeks 列 × 7 行的矩阵。
 *
 * 列按周日对齐（与 GitHub 网页一致）；今天所在列里晚于今天的格子标 future，
 * 组件把它们画成占位格而不是「0 次提交」—— 未来不存在提交，把不存在的日子
 * 计入空档会让「连续打卡」莫名其妙断掉。
 */
export function buildHeatmap(
  counts: ReadonlyMap<string, number>,
  opts: { weeks?: number; now?: Date; source?: 'live' | 'demo'; truncated?: boolean } = {},
): HeatmapData {
  const weeks = Math.max(1, Math.floor(opts.weeks ?? HEATMAP_WEEKS))
  const today = opts.now ?? new Date()
  const anchor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const start = addDays(anchor, -(anchor.getDay() + (weeks - 1) * 7))
  const thresholds = levelThresholds([...counts.values()])

  const cells: HeatmapCell[][] = []
  let totalCommits = 0
  let activeDays = 0
  let maxDaily = 0
  let coveredFrom: string | null = null
  let coveredTo: string | null = null

  for (let w = 0; w < weeks; w++) {
    const col: HeatmapCell[] = []
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d)
      const key = localDateKey(date)
      const future = date.getTime() > anchor.getTime()
      const count = future ? 0 : counts.get(key) ?? 0
      if (!future) {
        if (coveredFrom === null) coveredFrom = key
        coveredTo = key
        totalCommits += count
        if (count > 0) activeDays++
        if (count > maxDaily) maxDaily = count
      }
      col.push({ date: key, count, level: levelFor(count, thresholds), future })
    }
    cells.push(col)
  }

  // 逐日序列（旧 -> 新，跳过未来格）用于算 streak
  const flat = cells.flat().filter((c) => !c.future)
  let longestStreak = 0
  let run = 0
  for (const cell of flat) {
    if (cell.count > 0) {
      run++
      if (run > longestStreak) longestStreak = run
    } else run = 0
  }
  // 今天还没过完，0 次不算断签；从最近一个有活动的日子往回数
  let currentStreak = 0
  for (let i = flat.length - 1; i >= 0; i--) {
    const cell = flat[i]
    if (cell.count > 0) {
      currentStreak++
      continue
    }
    const isToday = i === flat.length - 1
    if (isToday) continue
    break
  }

  return {
    weeks: cells,
    totalCommits,
    activeDays,
    currentStreak,
    longestStreak,
    maxDaily,
    coveredFrom,
    coveredTo,
    source: opts.source ?? "live",
    truncated: opts.truncated === true,
  }
}

/** 确定性伪随机（仅用于「预览模拟布局」，绝不允许冒充真实数据） */
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

export function simulateCounts(
  username: string,
  opts: { weeks?: number; now?: Date; offset?: number } = {},
): Map<string, number> {
  const weeks = Math.max(1, Math.floor(opts.weeks ?? HEATMAP_WEEKS))
  const today = opts.now ?? new Date()
  const anchor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const start = addDays(anchor, -(anchor.getDay() + (weeks - 1) * 7))
  const offset = opts.offset ?? 0
  let hash = 0
  for (let i = 0; i < username.length; i++) hash = (hash << 5) - hash + username.charCodeAt(i)

  const counts = new Map<string, number>()
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i)
    if (date.getTime() > anchor.getTime()) continue
    const r = seededRandom(Math.abs(hash) + i * 17 + offset)
    if (r <= 0.4) continue
    const count = r > 0.88 ? Math.floor(r * 15) + 6 : r > 0.72 ? Math.floor(r * 8) + 4 : r > 0.55 ? Math.floor(r * 4) + 2 : 1
    counts.set(localDateKey(date), count)
  }
  return counts
}

export type FetchEventsResult =
  | { ok: true; counts: Map<string, number>; eventCount: number; truncated: boolean; fetchedAt: number }
  | { ok: false; reason: "invalid_user" | "not_found" | "rate_limited" | "queued" | "network" | "http"; status?: number }

/** 用户名合法性：1-39 位字母数字与连字符，不以连字符开头/结尾、不出现连续连字符 */
export function isValidGithubUsername(username: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(username)
}

/**
 * 拉公开事件并汇总。整体不抛错：组件需要区分「取不到」的各种原因才能诚实显示。
 *
 * 分页拉到 300 条即停（API 硬上限）。truncated 的判定：拿满 300 条**且**最早一条仍在
 * 窗口内 —— 说明确实有事件被挤出窗口，卡片上的数字只是可见部分。
 */
export async function fetchPublicPushEvents(
  username: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal; now?: Date } = {},
): Promise<FetchEventsResult> {
  const trimmed = username.trim()
  if (!isValidGithubUsername(trimmed)) return { ok: false, reason: "invalid_user" }
  const doFetch = opts.fetchImpl ?? fetch
  const collected: unknown[] = []
  for (let page = 1; page <= EVENTS_MAX_PAGES; page++) {
    const url =
      `https://api.github.com/users/${encodeURIComponent(trimmed)}/events/public` +
      `?per_page=${EVENTS_PER_PAGE}&page=${page}`
    let res: Response
    try {
      res = await doFetch(url, {
        headers: { Accept: "application/vnd.github+json" },
        signal: opts.signal,
        cache: "no-store",
      })
    } catch {
      return { ok: false, reason: "network" }
    }
    if (res.status === 404) return { ok: false, reason: "not_found" }
    if (res.status === 403 || res.status === 429) return { ok: false, reason: "rate_limited" }
    // 202 = GitHub 正在生成事件数据，本次没有内容可读
    if (res.status === 202) return { ok: false, reason: "queued" }
    if (!res.ok) return { ok: false, reason: "http", status: res.status }
    let batch: unknown
    try {
      batch = await res.json()
    } catch {
      return { ok: false, reason: "http", status: res.status }
    }
    if (!Array.isArray(batch)) return { ok: false, reason: "http" }
    collected.push(...batch)
    if (batch.length < EVENTS_PER_PAGE) break
  }
  const now = opts.now ?? new Date()
  const windowStart = addDays(now, -90).getTime()
  const oldestTs = collected.reduce<number | null>((acc, raw) => {
    const ts = Date.parse(String((raw as { created_at?: unknown })?.created_at ?? ""))
    if (!Number.isFinite(ts)) return acc
    return acc === null ? ts : Math.min(acc, ts)
  }, null)
  const truncated = collected.length >= EVENT_PAGE_LIMIT && oldestTs !== null && oldestTs > windowStart
  return {
    ok: true,
    counts: aggregatePushCommits(collected),
    eventCount: collected.length,
    truncated,
    fetchedAt: now.getTime(),
  }
}
