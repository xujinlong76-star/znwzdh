/**
 * 24 小时待读分流：新收藏先过一道「决定期」，再进永久库。
 *
 * 状态机（v1，本机私有，不进云端同步）：
 *
 *   新收藏 → inbox（24h）—打开→ read（30 天）→ permanent（永不过期）
 *   inbox 到期未读 → shelved（已移出，可找回）
 *   read 到期未读/未晋升 → shelved（已移出，可找回）
 *   shelved 恢复 → inbox 或 permanent（二选一，默认 permanent）
 *
 * 祖父规则（最重要）：老收藏没有分流字段，缺字段一律视为 permanent，
 * 绝不能把存量收藏扫进 24 小时箱。只有分流上线后新收的才进 inbox。
 *
 * 到期是「移走」不是「删除」：到期项从活跃列表移除（本机 + 云端走现有
 * remove() 墓碑路），同时写进「已移出」区（lib/favorites-shelved），原文完整保留。
 *
 * 「读过」的定义（v1，2026-11-15 扩展）：从待读箱 / /favorites（含主列表
 * 卡片点击）/ ⌘K 点开链接时记一次打开（复用 recordOpened 的调用点模式），
 * inbox → read。注意：在待读筛选视图下点一张 inbox 卡，它会立即变为 read、
 * 从当前视图消失——这是有意的语义（打开 = 读过），不是 bug。文案只能说
 * 「本机没记录到打开」，不能说「你 N 天没看过」（与 lib/resurface 同一诚实口径）。
 *
 * 到期判定严格大于窗口（与 resurface 的 90 天口径一致）：now - triageAt > windowMs；
 * 用毫秒流逝时长，不用日历天。窗口改了，现有待读条目的到期时间跟着变
 * （到期 = triageAt + 窗口现算，不另存 dueAt）。
 *
 * 偏好为什么是独立键：待读分流偏好是 v1 本机-only——服务端
 * settingsPatchSchema（apps/api/src/routes/me.ts）不认识这三个键，
 * PATCH 会被 zod 剥掉；若放进模型，云端回读经 hydrateSettingsFromCloud
 * 整包写回本机时，normalize 又会把缺失的键填成默认值，把用户的选择
 * 悄悄改回默认。所以分流偏好不进 UserSettingsModel，单独存在
 * navhub.triage.settings.v1，云端同步永远碰不到它。哪天服务端接了这三个键，再搬进模型也不迟。
 *
 * 本文件只放纯函数 + 偏好存储读写：`now` 一律由调用方传入
 * （可测、不依赖真实时钟），仿 resurface.ts / daily-focus.ts 体例。
 */

export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000

/** 待读箱窗口默认值（小时） */
export const DEFAULT_TRIAGE_INBOX_HOURS = 24
/** 已读窗口默认值（天） */
export const DEFAULT_TRIAGE_READ_DAYS = 30

export type TriageInboxHours = 12 | 24 | 72 | 168
export type TriageReadDays = 7 | 30 | 90

export const TRIAGE_INBOX_HOUR_OPTIONS = [
  { value: 12, label: '12 小时' },
  { value: 24, label: '24 小时（默认）' },
  { value: 72, label: '3 天' },
  { value: 168, label: '7 天' },
] as const satisfies readonly { value: TriageInboxHours; label: string }[]

export const TRIAGE_READ_DAY_OPTIONS = [
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天（默认）' },
  { value: 90, label: '90 天' },
] as const satisfies readonly { value: TriageReadDays; label: string }[]

const VALID_INBOX_HOURS = new Set<number>(TRIAGE_INBOX_HOUR_OPTIONS.map((o) => o.value))
const VALID_READ_DAYS = new Set<number>(TRIAGE_READ_DAY_OPTIONS.map((o) => o.value))

/** 待读状态：缺字段 = permanent（祖父规则），非法值也一样 */
export type TriageStatus = 'inbox' | 'read' | 'permanent'

export interface TriageSettings {
  /** 关掉后新收藏直接进 permanent，已有待读箱冻结：不结算、不新进 */
  enabled: boolean
  inboxHours: TriageInboxHours
  readDays: TriageReadDays
}

export const DEFAULT_TRIAGE_SETTINGS: TriageSettings = {
  enabled: true,
  inboxHours: DEFAULT_TRIAGE_INBOX_HOURS,
  readDays: DEFAULT_TRIAGE_READ_DAYS,
}

/** 分流偏好的存储键。独立键，不与用户设置模型混在一起（见文件头注释）。 */
export const TRIAGE_SETTINGS_KEY = 'navhub.triage.settings.v1'

export interface TriageableFavoriteLike {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  note?: string
  tags?: string[]
  folderId?: string | null
  createdAt: number
  lastOpenedAt?: number
  triageStatus?: string
  triageAt?: number
}

/** 只做分流状态判定需要的最小形状：状态过滤器（favorites-filter）也用它。 */
export interface TriageStatusLike {
  triageStatus?: string
  triageAt?: number
  createdAt: number
}

/** 归一任意输入的分流偏好：非法档位回落默认，不抛。 */
export function normalizeTriageSettings(raw?: unknown): TriageSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_TRIAGE_SETTINGS }
  }
  const s = raw as Record<string, unknown>
  const inboxNum = Number(s.inboxHours)
  const readNum = Number(s.readDays)
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_TRIAGE_SETTINGS.enabled,
    inboxHours: VALID_INBOX_HOURS.has(inboxNum)
      ? (inboxNum as TriageInboxHours)
      : DEFAULT_TRIAGE_SETTINGS.inboxHours,
    readDays: VALID_READ_DAYS.has(readNum) ? (readNum as TriageReadDays) : DEFAULT_TRIAGE_SETTINGS.readDays,
  }
}

/** 读本机分流偏好（SSR / 存储不可用时返回默认值，不抛）。 */
export function readTriageSettings(): TriageSettings {
  try {
    if (typeof window === 'undefined') return { ...DEFAULT_TRIAGE_SETTINGS }
    const raw = window.localStorage.getItem(TRIAGE_SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_TRIAGE_SETTINGS }
    return normalizeTriageSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_TRIAGE_SETTINGS }
  }
}

/**
 * 写本机分流偏好（只改传了的键，其余保留），并广播变更。
 * 写不进去返回归一后的值但不派事件：调用方据此知道「本次改动没留存」。
 */
export function writeTriageSettings(patch: Partial<TriageSettings>): TriageSettings {
  const next = normalizeTriageSettings({ ...readTriageSettings(), ...patch })
  try {
    if (typeof window === 'undefined') return next
    window.localStorage.setItem(TRIAGE_SETTINGS_KEY, JSON.stringify(next))
    window.dispatchEvent(new CustomEvent('navhub_triage_settings_changed', { detail: next }))
  } catch {
    return next
  }
  return next
}

const VALID_TRIAGE_STATUSES = new Set<string>(['inbox', 'read', 'permanent'])

/**
 * 解析一条收藏的分流状态。
 * 缺字段 / 非法值 / 进入当前状态的时间戳晚于 now（时钟回拨 / 脏数据）
 * 一律视为 permanent——祖父规则：存量收藏与脏数据都不进待读箱。
 */
export function resolveTriageStatus(
  fav: TriageStatusLike,
  now: number = Date.now(),
): TriageStatus {
  if (!fav || typeof fav.triageStatus !== 'string' || !VALID_TRIAGE_STATUSES.has(fav.triageStatus)) {
    return 'permanent'
  }
  if (fav.triageStatus === 'permanent') return 'permanent'
  const enteredAt = triageEnteredAt(fav)
  if (!Number.isFinite(enteredAt) || enteredAt > now) return 'permanent'
  return fav.triageStatus as TriageStatus
}

/** 进入当前状态的毫秒时间戳：triageAt 合法则用它，否则回退 createdAt。 */
export function triageEnteredAt(fav: TriageStatusLike): number {
  if (typeof fav.triageAt === 'number' && Number.isFinite(fav.triageAt)) return fav.triageAt
  return fav.createdAt
}

/** 当前状态的窗口毫秒数：permanent 永不过期，返回 null。 */
export function triageWindowMs(status: TriageStatus, settings: TriageSettings): number | null {
  if (status === 'inbox') return settings.inboxHours * HOUR_MS
  if (status === 'read') return settings.readDays * DAY_MS
  return null
}

/** 到期时刻（毫秒）：permanent 返回 null；到期 = triageAt + 窗口现算，不另存 dueAt。 */
export function triageDueAt(
  fav: TriageStatusLike,
  settings: TriageSettings,
  now: number = Date.now(),
): number | null {
  const status = resolveTriageStatus(fav, now)
  const windowMs = triageWindowMs(status, settings)
  if (windowMs === null) return null
  return triageEnteredAt(fav) + windowMs
}

/** 是否已到期：严格大于窗口——正好 24h 不过期，第 24h+1ms 才过期；permanent 永 false。 */
export function isTriageExpired(
  fav: TriageStatusLike,
  settings: TriageSettings,
  now: number,
): boolean {
  const dueAt = triageDueAt(fav, settings, now)
  if (dueAt === null) return false
  return now > dueAt
}

/** 距到期还剩多少毫秒（已到期为负）：permanent 返回 null。 */
export function triageMsLeft(
  fav: TriageStatusLike,
  settings: TriageSettings,
  now: number = Date.now(),
): number | null {
  const dueAt = triageDueAt(fav, settings, now)
  if (dueAt === null) return null
  return dueAt - now
}

/** 新收进待读箱：打上 inbox 戳与进入时间。 */
export function enterInbox<T extends TriageableFavoriteLike>(fav: T, now: number): T {
  return { ...fav, triageStatus: 'inbox' as const, triageAt: now }
}

/**
 * 记一次「从待读入口打开」：仅 inbox → read（triageAt = now，重新获得完整 read 窗口）。
 * permanent 打开不变；read 再打开不动——先定为不动，避免每次打开都续 30 天。
 * 不变时返回同一引用，调用方据此知道「没有状态跃迁」。
 */
export function markTriageRead<T extends TriageableFavoriteLike>(fav: T, now: number): T {
  if (resolveTriageStatus(fav, now) !== 'inbox') return fav
  return { ...fav, triageStatus: 'read' as const, triageAt: now }
}

/** 晋升到永久库：不可逆向自动降级；晋升后 dueAt 为 null。 */
export function promoteToPermanent<T extends TriageableFavoriteLike>(fav: T): T {
  return { ...fav, triageStatus: 'permanent' as const, triageAt: undefined }
}

/** 待读箱内一键续期：triageAt = now，重新获得完整 24h，仍在 inbox；非 inbox 不动。 */
export function renewInbox<T extends TriageableFavoriteLike>(fav: T, now: number): T {
  if (resolveTriageStatus(fav, now) !== 'inbox') return fav
  return { ...fav, triageAt: now }
}

/**
 * 到期结算（纯函数，now 注入；除调用方写盘外无副作用）。
 *
 * 打开时结算，不靠后台任务：调用方在 useFavorites 初始化读盘后跑一次。
 * 开关关时返回原样（同一引用、expired 为空）：已有待读箱冻结，不结算、不新进。
 * 幂等：再结算一次结果不变（过期项已不在 survivors 里）。
 * survivors 保持原顺序；expired 按到期先后排（dueAt 早的在前）。
 */
export function settleTriage<T extends TriageableFavoriteLike>(
  items: T[],
  settings: TriageSettings,
  now: number,
): { items: T[]; expired: T[] } {
  if (!settings.enabled) return { items, expired: [] }
  const survivors: T[] = []
  const expired: T[] = []
  for (const item of items) {
    if (isTriageExpired(item, settings, now)) expired.push(item)
    else survivors.push(item)
  }
  if (expired.length === 0) return { items, expired: [] }
  expired.sort((a, b) => {
    const dueA = triageDueAt(a, settings, now) ?? 0
    const dueB = triageDueAt(b, settings, now) ?? 0
    if (dueA !== dueB) return dueA - dueB
    return a.siteId < b.siteId ? -1 : a.siteId > b.siteId ? 1 : 0
  })
  return { items: survivors, expired }
}

/**
 * 快到期的待读箱条目：未过期的 inbox，按剩余时间从少到多取前 limit 条。
 * 「快到期」= 剩余时间 ≤ 24 小时：默认 24h 窗口下全部待读都算快到期；
 * 窗口放宽到 168h 时，只有最后 24h 内的才算，避免整箱常年标红。
 */
export function selectInboxDueSoon<T extends TriageableFavoriteLike>(
  items: T[],
  settings: TriageSettings,
  now: number,
  limit: number = 3,
): T[] {
  if (!settings.enabled) return []
  const dueSoon = items.filter((item) => {
    if (resolveTriageStatus(item, now) !== 'inbox') return false
    const msLeft = triageMsLeft(item, settings, now)
    return msLeft !== null && msLeft > 0 && msLeft <= DAY_MS
  })
  dueSoon.sort((a, b) => {
    const leftA = triageMsLeft(a, settings, now) ?? 0
    const leftB = triageMsLeft(b, settings, now) ?? 0
    if (leftA !== leftB) return leftA - leftB
    return a.siteId < b.siteId ? -1 : a.siteId > b.siteId ? 1 : 0
  })
  return dueSoon.slice(0, Math.max(0, limit))
}

/**
 * 剩余时间徽标：只写「还剩 X 小时/天」，过期写「已到期，已移到『已移出』」。
 * permanent（msLeft 为 null）返回空串——永久库不挂倒计时。
 * 措辞铁律：不出现「你忘了 / 你没看」。
 */
export function triageBadgeLabel(msLeft: number | null): string {
  if (msLeft === null) return ''
  if (msLeft <= 0) return '已到期，已移到「已移出」'
  if (msLeft < DAY_MS) return `还剩 ${Math.max(1, Math.ceil(msLeft / HOUR_MS))} 小时`
  return `还剩 ${Math.max(1, Math.floor(msLeft / DAY_MS))} 天`
}

/** 一条收藏的分流说明（诚实口径：只说本机记录与剩余时间）。 */
export function describeTriage(
  fav: TriageStatusLike,
  settings: TriageSettings,
  now: number = Date.now(),
): string {
  const status = resolveTriageStatus(fav, now)
  if (status === 'permanent') return '永久收藏'
  const msLeft = triageMsLeft(fav, settings, now)
  if (msLeft !== null && msLeft <= 0) return '已到期，已移到「已移出」'
  if (status === 'inbox') return `待读箱 · ${triageBadgeLabel(msLeft)}`
  return `已读 · ${triageBadgeLabel(msLeft)}`
}
