/**
 * 离线个人数据层「我的常用」v1（2026-11-20 20:00 战略研究 W9 落地）。
 *
 * 一句话：置顶收藏 + 自定义链接 + 本地最近使用 + 场景分组 + JSON 导出/导入，
 * 全部只存浏览器本地；不登录、不联网上传、不新增后端、不新增网络请求。
 *
 * 设计（与既有底座对齐）：
 * - 版本化键 `znw:personal:v1`（localStorage）；坏 JSON 走
 *   `lib/favorites-storage.ts` 的 `{data, corrupt}` 模式：读不出来 ≠ 没有数据，
 *   调用方必须隔离坏数据、不覆盖原数据。
 * - 最近使用不另起存储：读 `lib/offline-recent.ts` 的 IndexedDB `navhub-offline`
 *   快照（50 条），本层只取前 8 条展示 + 提供「关闭记录」开关。
 * - 导出只含收藏 ID、分组、偏好（W5 Tier 0 范围），不含历史/搜索词/计数器。
 * - 本文件是纯逻辑 + 注入式存储适配，不 import 任何组件、不发任何请求，
 *   可直接单测；React 侧见 `hooks/usePersonalData.ts`。
 */

export const PERSONAL_STORAGE_KEY = 'znw:personal:v1'
export const PERSONAL_FORMAT = 'znw-personal-data'
export const PERSONAL_FORMAT_VERSION = 1
/** 置顶上限 24（冻结口径）：超限返回错误提示，不静默丢弃。 */
export const MAX_PINNED_SITES = 24
/** 自定义链接上限 100（存储安全 bound，非产品口径；超限同样报错不丢弃）。 */
export const MAX_CUSTOM_LINKS = 100
/** 本地最近使用上限 8（冻结口径）。 */
export const MAX_RECENT_PERSONAL = 8
/** 场景总数上限 12（4 预置 + 8 自建）。 */
export const MAX_SCENES = 12
/** 每个场景内站点数上限 8（W2 场景包口径 4–8）。 */
export const MAX_SCENE_SITES = 8
/** 「关闭最近记录」开关的存储键（`recordOfflineVisit` 读它）。 */
export const RECENT_PAUSED_KEY = 'znw:personal:recent-paused'
/** offline-recent 的 localStorage 降级键（清除时一起清，不留尾巴）。 */
export const OFFLINE_RECENT_LS_KEY = 'navhub:recent-offline:v1'
/** offline-recent 的访问频次键（清除时一起清）。 */
export const VISIT_COUNTS_KEY = 'navhub_visit_counts_v1'

export type SceneRole = 'main' | 'backup' | 'notice'
export const SCENE_ROLES: readonly SceneRole[] = ['main', 'backup', 'notice']

export interface PinnedSite {
  siteId: string
  title: string
  href: string
  icon?: string | null
}

export interface CustomLink {
  id: string
  name: string
  url: string
  createdAt: number
}

export interface PersonalScene {
  id: string
  name: string
  color: string
  siteIds: string[]
  roles: Record<string, SceneRole>
  goal: string
  builtin: boolean
}

export interface PersonalPrefs {
  recordRecent: boolean
}

export interface PersonalCounters {
  pin: number
  personalClick: number
  exportCount: number
  importCount: number
  clearCount: number
}

export interface PersonalData {
  version: 1
  pinned: PinnedSite[]
  customLinks: CustomLink[]
  scenes: PersonalScene[]
  activeSceneId: string | null
  prefs: PersonalPrefs
  counters: PersonalCounters
  /** 上次导出备份的时间戳（ms，Date.now()）；从未导出过为 null。
   *  设备本地状态，与计数器同口径：导出文件本身不含它，导入不覆盖它。 */
  lastExportAt: number | null
  /** 备份提醒被关闭的时间戳（ms）；关闭后 7 天内不再提醒。 */
  backupReminderDismissedAt: number | null
}

/** 注入式存储：localStorage 的最小子集，便于测试与降级（内存实现）。 */
export interface PersonalStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function defaultPersonalData(): PersonalData {
  return {
    version: 1,
    pinned: [],
    customLinks: [],
    scenes: [],
    activeSceneId: null,
    prefs: { recordRecent: true },
    counters: { pin: 0, personalClick: 0, exportCount: 0, importCount: 0, clearCount: 0 },
    lastExportAt: null,
    backupReminderDismissedAt: null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const u = new URL(value.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function cleanString(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (t.length === 0 || t.length > maxLen) return null
  return t
}

function cleanPinnedSite(value: unknown): PinnedSite | null {
  if (!isRecord(value)) return null
  const siteId = cleanString(value.siteId, 128)
  const title = cleanString(value.title, 120)
  if (!siteId || !title || !isHttpUrl(value.href)) return null
  const icon = typeof value.icon === 'string' && value.icon.trim().length > 0 ? value.icon.trim() : undefined
  return icon ? { siteId, title, href: (value.href as string).trim(), icon } : { siteId, title, href: (value.href as string).trim() }
}

function cleanCustomLink(value: unknown): CustomLink | null {
  if (!isRecord(value)) return null
  const id = cleanString(value.id, 128)
  const name = cleanString(value.name, 40)
  if (!id || !name || !isHttpUrl(value.url)) return null
  const createdAt = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : 0
  return { id, name, url: (value.url as string).trim(), createdAt }
}

function cleanScene(value: unknown): PersonalScene | null {
  if (!isRecord(value)) return null
  const id = cleanString(value.id, 64)
  const name = cleanString(value.name, 24)
  const color = cleanString(value.color, 16)
  const goal = typeof value.goal === 'string' ? value.goal.trim().slice(0, 80) : ''
  if (!id || !name || !color || !Array.isArray(value.siteIds)) return null
  const siteIds = value.siteIds.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, MAX_SCENE_SITES)
  const roles: Record<string, SceneRole> = {}
  if (isRecord(value.roles)) {
    for (const [k, v] of Object.entries(value.roles)) {
      // 已列站点的非法角色值是坏数据：拒绝整条场景，不静默改写
      // （缺失的角色才补默认值，见下）。
      if (siteIds.includes(k)) {
        if (!(SCENE_ROLES as readonly string[]).includes(v as string)) return null
        roles[k] = v as SceneRole
      }
    }
  }
  // 角色缺省补齐：首站主、其余备（公告角色只由预置生成或用户显式指定）
  siteIds.forEach((siteId, i) => {
    if (!roles[siteId]) roles[siteId] = i === 0 ? 'main' : 'backup'
  })
  return { id, name, color, siteIds, roles, goal, builtin: value.builtin === true }
}

/**
 * 结构校验 + 清洗：只认已知字段，未知字段丢弃；任一必填项非法即整体拒绝。
 * 返回清洗后的数据（调用方可直接落盘，不用再信原始输入）。
 */
export function validatePersonalData(value: unknown): { ok: boolean; errors: string[]; data?: PersonalData } {
  const errors: string[] = []
  if (!isRecord(value)) return { ok: false, errors: ['个人数据不是对象'] }
  // 导出文件的 version 在顶层，data 载荷里不带 version：缺失视为 v1，
  // 只有显式写错的版本号才拒绝。
  if (value.version !== undefined && value.version !== 1) {
    errors.push(`不支持的版本号：${String(value.version)}（当前 v1）`)
  }
  if (!Array.isArray(value.pinned)) errors.push('pinned 不是数组')
  if (!Array.isArray(value.customLinks)) errors.push('customLinks 不是数组')
  if (!Array.isArray(value.scenes)) errors.push('scenes 不是数组')
  if (errors.length > 0) return { ok: false, errors }

  const pinned: PinnedSite[] = []
  for (const item of (value.pinned as unknown[])) {
    const cleaned = cleanPinnedSite(item)
    if (!cleaned) errors.push('pinned 含非法条目（siteId/title 缺失或 href 不是 http/https）')
    else pinned.push(cleaned)
  }
  if (pinned.length > MAX_PINNED_SITES) errors.push(`置顶超过上限 ${MAX_PINNED_SITES} 个`)
  const customLinks: CustomLink[] = []
  for (const item of (value.customLinks as unknown[])) {
    const cleaned = cleanCustomLink(item)
    if (!cleaned) errors.push('customLinks 含非法条目（id/name 缺失或 url 不是 http/https）')
    else customLinks.push(cleaned)
  }
  if (customLinks.length > MAX_CUSTOM_LINKS) errors.push(`自定义链接超过上限 ${MAX_CUSTOM_LINKS} 个`)
  const scenes: PersonalScene[] = []
  for (const item of (value.scenes as unknown[])) {
    const cleaned = cleanScene(item)
    if (!cleaned) errors.push('scenes 含非法条目（id/name/color 缺失或 siteIds 不是数组）')
    else scenes.push(cleaned)
  }
  if (scenes.length > MAX_SCENES) errors.push(`场景超过上限 ${MAX_SCENES} 个`)

  let activeSceneId: string | null =
    value.activeSceneId === null || value.activeSceneId === undefined
      ? null
      : typeof value.activeSceneId === 'string'
        ? value.activeSceneId
        : ''
  if (activeSceneId === '') errors.push('activeSceneId 非法')
  // 悬空的 activeSceneId 是可恢复的（场景被删过）：降级为 null，不整文件拒绝
  if (activeSceneId && !scenes.some((s) => s.id === activeSceneId)) activeSceneId = null

  const prefs: PersonalPrefs = {
    recordRecent: isRecord(value.prefs) && value.prefs.recordRecent === false ? false : true,
  }
  const countersRaw = isRecord(value.counters) ? value.counters : {}
  const counters: PersonalCounters = {
    pin: counterValue(countersRaw.pin),
    personalClick: counterValue(countersRaw.personalClick),
    exportCount: counterValue(countersRaw.exportCount),
    importCount: counterValue(countersRaw.importCount),
    clearCount: counterValue(countersRaw.clearCount),
  }
  // 备份时间戳：老数据没有这两个字段（缺失即 null，从未导出/从未关闭）；
  // 非法值只按 null 计，不整文件拒绝（与计数器的容错口径一致）。
  const lastExportAt = cleanTimestamp(value.lastExportAt)
  const backupReminderDismissedAt = cleanTimestamp(value.backupReminderDismissedAt)
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, errors: [], data: { version: 1, pinned, customLinks, scenes, activeSceneId, prefs, counters, lastExportAt, backupReminderDismissedAt } }
}

function counterValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

/** 时间戳清洗：合法的非负有限数才保留，否则 null（不抛错、不拒绝整文件）。 */
function cleanTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

/**
 * 解析本地原始字符串：只有「真的没有数据」才算空；有数据但读不出来
 * 时 `corrupt: true`（与 favorites-storage.ts 同款语义，调用方必须隔离）。
 */
export function parsePersonalData(raw: string | null | undefined): { data: PersonalData; corrupt: boolean } {
  if (raw === null || raw === undefined || raw === '') {
    return { data: defaultPersonalData(), corrupt: false }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { data: defaultPersonalData(), corrupt: true }
  }
  const checked = validatePersonalData(parsed)
  if (!checked.ok || !checked.data) return { data: defaultPersonalData(), corrupt: true }
  return { data: checked.data, corrupt: false }
}

/** 隔离键：`<原键>.corrupt.<时间戳>`，与 favorites-storage.ts 同形状。 */
export function personalCorruptBackupKey(now: number | string): string {
  return `${PERSONAL_STORAGE_KEY}.corrupt.${now}`
}

/* ------------------------------ 置顶收藏 ------------------------------ */

export function addPin(
  data: PersonalData,
  site: PinnedSite,
): { data: PersonalData } | { error: string } {
  const clean = cleanPinnedSite(site)
  if (!clean) return { error: '站点信息不完整，无法固定' }
  if (data.pinned.some((p) => p.siteId === clean.siteId)) return { data }
  if (data.pinned.length >= MAX_PINNED_SITES) {
    return { error: `「我的常用」最多固定 ${MAX_PINNED_SITES} 个站点，先取消一个再固定新的吧` }
  }
  return { data: { ...data, pinned: [...data.pinned, clean] } }
}

export function removePin(data: PersonalData, siteId: string): PersonalData {
  if (!data.pinned.some((p) => p.siteId === siteId)) return data
  return { ...data, pinned: data.pinned.filter((p) => p.siteId !== siteId) }
}

export function movePin(data: PersonalData, siteId: string, toIndex: number): PersonalData {
  const from = data.pinned.findIndex((p) => p.siteId === siteId)
  if (from < 0) return data
  const next = [...data.pinned]
  const [item] = next.splice(from, 1)
  const clamped = Math.max(0, Math.min(toIndex, next.length))
  next.splice(clamped, 0, item!)
  return { ...data, pinned: next }
}

/* ------------------------------ 自定义链接 ------------------------------ */

/**
 * 自定义链接 URL 校验：仅 http/https；裸域名补 https://；其余一律拒绝。
 * 不做任何网络请求、不抓取第三方 favicon（图标见组件层的本地解析 + 字母徽标）。
 */
export function validateCustomLinkUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: '请输入网址' }
  const trimmed = raw.trim()
  // 带 scheme 但不是 http/https（如 javascript:/ftp:）直接拒绝，不给它补前缀蒙混过关
  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    return { ok: false, error: '只支持 http/https 网址' }
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return { ok: false, error: '网址格式不对，请检查后重试' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: '只支持 http/https 网址' }
  }
  if (!url.hostname) return { ok: false, error: '网址缺少域名' }
  return { ok: true, url: url.toString() }
}

function newCustomLinkId(): string {
  try {
    return `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  } catch {
    return `cl-${Math.random().toString(36).slice(2, 10)}`
  }
}

export function addCustomLink(
  data: PersonalData,
  name: string,
  url: string,
  now: number = Date.now(),
): { data: PersonalData } | { error: string } {
  const cleanName = typeof name === 'string' ? name.trim() : ''
  if (cleanName.length === 0) return { error: '请给链接起个名字' }
  if (cleanName.length > 40) return { error: '名字最多 40 个字' }
  const checked = validateCustomLinkUrl(url)
  if (!checked.ok) return { error: checked.error }
  if (data.customLinks.length >= MAX_CUSTOM_LINKS) {
    return { error: `自定义链接最多 ${MAX_CUSTOM_LINKS} 个` }
  }
  const link: CustomLink = { id: newCustomLinkId(), name: cleanName, url: checked.url, createdAt: now }
  return { data: { ...data, customLinks: [...data.customLinks, link] } }
}

export function removeCustomLink(data: PersonalData, id: string): PersonalData {
  if (!data.customLinks.some((l) => l.id === id)) return data
  return { ...data, customLinks: data.customLinks.filter((l) => l.id !== id) }
}

/** 字母徽标：取首个字形（emoji 安全）；空名回退问号。 */
export function letterBadgeFor(name: string): string {
  const first = Array.from(typeof name === 'string' ? name.trim() : '')[0]
  if (!first) return '?'
  return first === first.toLowerCase() ? first.toUpperCase() : first
}

/* ------------------------------ 场景分组 ------------------------------ */

export interface CatalogCategory {
  id: string
  title: string
  subCategories?: Array<{
    id: string
    title: string
    items?: Array<{ id: string; title: string }>
  }>
}

/** 标题含这些词的站是「公告」角色（考试报名/准考证/查分入口）。 */
const NOTICE_TITLE_RE = /考试|报名|准考证|查分|成绩|复核|缴费/

interface PresetDef {
  id: string
  name: string
  color: string
  goal: string
  /** 来源子分类 id（按所列顺序取站，不新增人工编目）。 */
  sourceSubIds: string[]
}

const PRESET_DEFS: readonly PresetDef[] = [
  {
    id: 'work',
    name: '工作',
    color: '#2563eb',
    goal: '打开今天要用的办公站，直达工作现场',
    sourceSubIds: ['reg-online-docs', 'reg-mindmaps-and-boards', 'reg-ai-writing-office'],
  },
  {
    id: 'study',
    name: '学习',
    color: '#059669',
    goal: '打开今天要学的课与资料，学完就走',
    sourceSubIds: ['reg-online-courses', 'reg-programming-learning', 'reg-digital-libraries'],
  },
  {
    id: 'exam',
    name: '考试',
    color: '#d97706',
    goal: '报名、准考证、查分入口一处找齐，不错过时间',
    sourceSubIds: ['reg-exam-prep', 'reg-government-affairs'],
  },
  {
    id: 'daily',
    name: '常用',
    color: '#7c3aed',
    goal: '每天都打开的那几个站，一点就到',
    sourceSubIds: ['reg-chat-assistants', 'reg-online-docs', 'reg-tech-news'],
  },
]

/**
 * 预置场景：直接用现有分类/子分类数据生成，不新增人工编目。
 * 角色：首站「主」、其余「备」，标题含报名/准考证/查分等词的为「公告」。
 * 分类缺失时对应场景为空列表（不编站、不崩）。
 */
export function buildPresetScenes(catalog: readonly CatalogCategory[]): PersonalScene[] {
  const subById = new Map<string, Array<{ id: string; title: string }>>()
  for (const cat of catalog) {
    for (const sub of cat.subCategories ?? []) {
      subById.set(sub.id, (sub.items ?? []).map((i) => ({ id: i.id, title: i.title })))
    }
  }
  return PRESET_DEFS.map((def) => {
    const picked: Array<{ id: string; title: string }> = []
    for (const subId of def.sourceSubIds) {
      for (const item of subById.get(subId) ?? []) {
        if (picked.length >= MAX_SCENE_SITES) break
        if (!picked.some((p) => p.id === item.id)) picked.push(item)
      }
      if (picked.length >= MAX_SCENE_SITES) break
    }
    const siteIds = picked.map((p) => p.id)
    const roles: Record<string, SceneRole> = {}
    picked.forEach((item, i) => {
      roles[item.id] = NOTICE_TITLE_RE.test(item.title) ? 'notice' : i === 0 ? 'main' : 'backup'
    })
    return { id: def.id, name: def.name, color: def.color, siteIds, roles, goal: def.goal, builtin: true }
  })
}

/* ------------------------------ 导出 / 导入 ------------------------------ */

/**
 * 导出：仅含收藏 ID（+ 展示用标题/链接快照）、分组、偏好；
 * 不含历史、搜索词、计数器。带格式名与版本号，供导入校验。
 */
export function exportPersonalData(data: PersonalData): string {
  return JSON.stringify(
    {
      format: PERSONAL_FORMAT,
      version: PERSONAL_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        pinned: data.pinned,
        customLinks: data.customLinks,
        scenes: data.scenes,
        activeSceneId: data.activeSceneId,
        prefs: data.prefs,
      },
    },
    null,
    2,
  )
}

/** 导入：先校验结构，坏文件拒绝并给出原因；绝不把坏数据写进存储。 */
export function parsePersonalImport(raw: string): { ok: true; data: PersonalData } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: '文件不是合法的 JSON，请确认选对了导出的备份文件' }
  }
  if (!isRecord(parsed)) return { ok: false, error: '文件结构不对：顶层不是对象' }
  if (parsed.format !== PERSONAL_FORMAT) {
    return { ok: false, error: '这不是「我的常用」导出的备份文件' }
  }
  if (parsed.version !== PERSONAL_FORMAT_VERSION) {
    return { ok: false, error: `备份版本 v${String(parsed.version)} 不受支持（当前 v${PERSONAL_FORMAT_VERSION}）` }
  }
  const checked = validatePersonalData(parsed.data)
  if (!checked.ok || !checked.data) {
    return { ok: false, error: `备份内容校验失败：${checked.errors.join('；')}` }
  }
  return { ok: true, data: checked.data }
}

/**
 * 导入落盘策略：replace 整替；merge 按 id 并集（last-write-wins 不适用——
 * 本地层无服务端时间源，并集只增不改，删除需用户在界面上显式删）。
 * 两种模式都保留当前本地计数器（测量口径不因一次导入归零）。
 */
export function mergePersonalImport(current: PersonalData, imported: PersonalData, mode: 'replace' | 'merge'): PersonalData {
  if (mode === 'replace') {
    // 备份时间戳是设备本地状态（与计数器同口径）：导入的备份文件里没有它，
    // 整替时保留本地的，不被「没导过备份的文件」清零。
    return { ...imported, counters: current.counters, lastExportAt: current.lastExportAt, backupReminderDismissedAt: current.backupReminderDismissedAt }
  }
  const pinned = [...current.pinned]
  for (const p of imported.pinned) {
    if (!pinned.some((x) => x.siteId === p.siteId)) pinned.push(p)
  }
  const customLinks = [...current.customLinks]
  for (const l of imported.customLinks) {
    if (!customLinks.some((x) => x.id === l.id)) customLinks.push(l)
  }
  const scenes = [...current.scenes]
  for (const s of imported.scenes) {
    if (!scenes.some((x) => x.id === s.id)) scenes.push(s)
  }
  return {
    ...current,
    pinned: pinned.slice(0, MAX_PINNED_SITES),
    customLinks: customLinks.slice(0, MAX_CUSTOM_LINKS),
    scenes: scenes.slice(0, MAX_SCENES),
    activeSceneId: imported.activeSceneId ?? current.activeSceneId,
    prefs: imported.prefs,
    counters: current.counters,
  }
}

/* ------------------------------ 存储适配 ------------------------------ */

export function loadPersonalData(storage: PersonalStorage): { data: PersonalData; corrupt: boolean } {
  let raw: string | null = null
  try {
    raw = storage.getItem(PERSONAL_STORAGE_KEY)
  } catch {
    return { data: defaultPersonalData(), corrupt: false }
  }
  return parsePersonalData(raw)
}

/**
 * 保存：配额超限返回 quota（调用方提示用户清理，而不是静默丢数据）；
 * 其它写失败返回 error。永不抛错。
 */
export function savePersonalData(
  storage: PersonalStorage,
  data: PersonalData,
): { ok: true } | { ok: false; reason: 'quota' | 'error'; message: string } {
  try {
    storage.setItem(PERSONAL_STORAGE_KEY, JSON.stringify(data))
    return { ok: true }
  } catch (err) {
    const name = (err as { name?: string })?.name ?? ''
    const code = (err as { code?: number })?.code
    if (name === 'QuotaExceededError' || code === 22) {
      return { ok: false, reason: 'quota', message: '浏览器本地存储满了：本次改动没存下来，请先导出备份再清理一部分数据' }
    }
    return { ok: false, reason: 'error', message: '本地保存失败，本次改动没存下来' }
  }
}

/** 存储用量（字节）：只算个人数据相关键，不含其它本地数据。 */
export function storageUsageBytes(storage: PersonalStorage): number {
  const encoder = new TextEncoder()
  let total = 0
  for (const key of [PERSONAL_STORAGE_KEY, OFFLINE_RECENT_LS_KEY, VISIT_COUNTS_KEY]) {
    try {
      const raw = storage.getItem(key)
      if (raw) total += encoder.encode(raw).length
    } catch {
      // 读不到的键按 0 计
    }
  }
  return total
}

/**
 * 清除全部个人数据：个人键 + 最近快照（LS 侧）+ 访问频次键 + 记录开关。
 * IndexedDB 侧的快照由调用方另调 `clearOfflineVisits()` 清（本文件不 import
 * offline-recent，避免循环依赖）。
 */
export function clearAllPersonalData(storage: PersonalStorage): void {
  for (const key of [PERSONAL_STORAGE_KEY, OFFLINE_RECENT_LS_KEY, VISIT_COUNTS_KEY, RECENT_PAUSED_KEY]) {
    try {
      storage.removeItem(key)
    } catch {
      // 清不掉的键不阻断流程
    }
  }
}

/** 最近记录是否已暂停（默认开）。storage 省略时读全局 localStorage。 */
export function isRecentRecordingPaused(storage?: PersonalStorage): boolean {
  try {
    const store: PersonalStorage | undefined =
      storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
    if (!store) return false
    return store.getItem(RECENT_PAUSED_KEY) === '1'
  } catch {
    return false
  }
}

export function setRecentRecordingPaused(storage: PersonalStorage, paused: boolean): void {
  try {
    if (paused) storage.setItem(RECENT_PAUSED_KEY, '1')
    else storage.removeItem(RECENT_PAUSED_KEY)
  } catch {
    // 开关写失败不阻断主流程
  }
}

/**
 * 本地计数器（PoC 测量用）：只计次数，不含 URL、标题、时间戳明细。
 * 导出时不带出（见 exportPersonalData）。
 */
export function bumpCounter(data: PersonalData, key: keyof PersonalCounters): PersonalData {
  return { ...data, counters: { ...data.counters, [key]: data.counters[key] + 1 } }
}

/* ------------------------------ 备份提醒 ------------------------------ */

/** 超过这么多天没导出备份，就在命令面板与数据页给一条轻提醒（2026-11-27 命令面板 v2）。 */
export const BACKUP_REMINDER_AFTER_DAYS = 14
/** 关闭提醒后这么多天内不再出现（不是永久关闭：没备份的风险还在）。 */
export const BACKUP_REMINDER_DISMISS_DAYS = 7
export const MS_PER_DAY = 86_400_000

/** 有可备份的内容（置顶/自定义链接/场景任一非空）才提醒；空数据用户不需要备份提醒。 */
export function hasPersonalContent(data: PersonalData): boolean {
  return data.pinned.length > 0 || data.customLinks.length > 0 || data.scenes.length > 0
}

/** 距上次导出多少天（整天数）；从未导出过为 null；未来时间戳（时钟回拨）按 0 天计。 */
export function daysSinceLastExport(lastExportAt: number | null, now: number = Date.now()): number | null {
  if (lastExportAt === null) return null
  return Math.max(0, Math.floor((now - lastExportAt) / MS_PER_DAY))
}

export interface BackupReminderStatus {
  show: boolean
  /** 从未导出过（与 daysOverdue 互斥：从未导出时 daysOverdue 为 null）。 */
  neverExported: boolean
  /** 超过阈值的天数（从未导出时为 null）。 */
  daysOverdue: number | null
}

/**
 * 备份提醒判定（纯函数，可单测）：
 * - 没内容 → 不提醒；
 * - 从未导出过 → 提醒（文案走「尚未导出过备份」）；
 * - 上次导出距今 ≥14 天 → 提醒，附天数；
 * - 关闭后 7 天内 → 不提醒（7 天后若仍未导出会再次出现）。
 */
export function backupReminderStatus(data: PersonalData, now: number = Date.now()): BackupReminderStatus {
  if (!hasPersonalContent(data)) return { show: false, neverExported: false, daysOverdue: null }
  if (
    data.backupReminderDismissedAt !== null &&
    now - data.backupReminderDismissedAt < BACKUP_REMINDER_DISMISS_DAYS * MS_PER_DAY
  ) {
    return { show: false, neverExported: false, daysOverdue: null }
  }
  const days = daysSinceLastExport(data.lastExportAt, now)
  if (days === null) return { show: true, neverExported: true, daysOverdue: null }
  if (days < BACKUP_REMINDER_AFTER_DAYS) return { show: false, neverExported: false, daysOverdue: null }
  return { show: true, neverExported: false, daysOverdue: days }
}
