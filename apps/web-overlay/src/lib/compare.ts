/**
 * 跨站对照：纯逻辑（Batch 4 Phase 1 第 2 项）。
 *
 * 本文件不碰 React / DOM / 网络，只做可单元测试的纯函数：
 *   - 对照 URL（siteIds 解析、2–4 校验、/compare 跳转链接）；
 *   - 接口返回归一化（REST 实际返回扁平格子；`cells` 包裹形态也兼容，
 *     以防接口形态漂移——两端以 `packages/core/src/site-comparison.ts`
 *     的扁平 shape 为准）；
 *   - 差异判定（只比“值”，不比 verified 标记；不设 winner）；
 *   - 分流结论（结构化生成 + 引用白名单校验：结论只能引用对照表内的 siteId）；
 *   - 结论本机保存（localStorage 新键 `navhub.compare.notes.v1`；
 *     评审判定 13：禁止把结论塞进某站的 `note`，不走服务端）；
 *   - 详情页同类候选 pick-state 切换（第 3 项复用）。
 *
 * 渲染层在 `components/compare-view.tsx`；接线守卫见
 * `test/compare-page-guard.test.ts`。
 */

/** 对照表的七个维度（设计 §3.1 六维 + P2-2 价格数值格，顺序即表内行顺序）。 */
export const COMPARE_DIMENSIONS = [
  { key: 'pricing', label: '计费方式' },
  { key: 'price', label: '价格（数值）' },
  { key: 'platform', label: '支持平台' },
  { key: 'form', label: '形态' },
  { key: 'maintenance', label: '是否还在维护' },
  { key: 'note', label: '我的备注' },
  { key: 'migration', label: '迁移成本' },
] as const

export type CompareDimensionKey = (typeof COMPARE_DIMENSIONS)[number]['key']

export const COMPARE_DIMENSION_LABELS: Record<CompareDimensionKey, string> =
  Object.fromEntries(COMPARE_DIMENSIONS.map((d) => [d.key, d.label])) as Record<
    CompareDimensionKey,
    string
  >

export const MIN_COMPARE_SITES = 2
export const MAX_COMPARE_SITES = 4

/** 分流结论可保存的本机键（评审判定 13：新键，不复用任何收藏/备注键）。 */
export const COMPARE_NOTES_KEY = 'navhub.compare.notes.v1'

/** 对照表里的一个格子：值 + 来源 + 是否已验证 + 来源数据的核实时间（毫秒戳）。 */
export interface ComparisonCell {
  value: string | string[] | null
  source: string
  verified: boolean
  verifiedAt: number | null
  lastCheckedAt?: number | null
  /** 仅 price 格：90–180 天未核实的“可能过期”标记。 */
  stale?: boolean
  /** 仅 price 格：官方定价页 URL（有它前端才启用“从官方定价页抓取”）。 */
  sourceUrl?: string | null
  /** 仅 price 格：编辑表单回填用的原始记录字段。 */
  amountMinor?: number
  currency?: string
  period?: string
  freeTierLimit?: string | null
}

/** 一站的对照行：扁平七格（REST 实际形态，见 CompareResponse 生成类型）。 */
export interface ComparisonItem {
  siteId: string
  title: string
  url: string
  pricing: ComparisonCell
  price: ComparisonCell
  platform: ComparisonCell
  form: ComparisonCell
  maintenance: ComparisonCell
  note: ComparisonCell
  migration: ComparisonCell
}

export function isCompareDimensionKey(key: string): key is CompareDimensionKey {
  return (COMPARE_DIMENSIONS as readonly { key: string }[]).some((d) => d.key === key)
}

/**
 * 解析 `?siteIds=a,b,c`：逗号切分、trim、去重、去空。
 * 顺序保留用户勾选顺序（接口按此顺序回表，前端按此顺序列站）。
 */
export function parseCompareSiteIds(raw: string | null | undefined): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  for (const part of raw.split(',')) {
    const id = part.trim()
    if (id && !seen.has(id)) seen.add(id)
  }
  return [...seen]
}

export type CompareSiteIdsValidation =
  | { ok: true; siteIds: string[] }
  | { ok: false; error: string }

/**
 * 数量校验：2–4 个（Batch 4 Phase 2 P2-6 恢复设计 §1.3 的“2–4”：Phase 1
 * 评审判定 1 以“2–3”作废“2–4”，P2-6 以四站对照需求推翻该判定——4 列只在
 * xl（1280px+）展开、每卡仍有足够宽度，2–4 列并排可读，故上限回到 4）。
 */
export function validateCompareSiteIds(ids: readonly string[]): CompareSiteIdsValidation {
  const siteIds = parseCompareSiteIds(ids.join(','))
  if (siteIds.length < MIN_COMPARE_SITES) {
    return { ok: false, error: `请勾选 2–4 个已收藏站点进行对比（当前只有 ${siteIds.length} 个）。` }
  }
  if (siteIds.length > MAX_COMPARE_SITES) {
    return { ok: false, error: '一次最多对比 4 个站点，请先取消多余的勾选。' }
  }
  return { ok: true, siteIds }
}

/** 对照页跳转链接（选中态是页内 state，切页即丢，必须走 URL 传参）。 */
export function buildCompareHref(siteIds: readonly string[]): string {
  const validated = validateCompareSiteIds(siteIds)
  if (!validated.ok) throw new Error(validated.error)
  return '/compare?siteIds=' + validated.siteIds.map(encodeURIComponent).join(',')
}

/** 把格子值归一成可比字符串：null 保持 null（未验证），数组排序后连接。 */
export function normalizeCellValue(cell: ComparisonCell | null | undefined): string | null {
  if (!cell) return null
  const { value } = cell
  if (value == null) return null
  if (Array.isArray(value)) {
    const parts = value.map((v) => String(v).trim()).filter(Boolean)
    if (parts.length === 0) return null
    return [...parts].sort().join('、')
  }
  const text = String(value).trim()
  return text ? text : null
}

/** 两格“值不同”即差异（只比值，不比 verified；不标谁赢、无 winner）。 */
export function compareCellsDiffer(
  a: ComparisonCell | null | undefined,
  b: ComparisonCell | null | undefined,
): boolean {
  return normalizeCellValue(a) !== normalizeCellValue(b)
}

/** 某一维在各站之间是否存在差异（任一对值不同即整行高亮）。 */
export function compareRowDiffers(items: readonly ComparisonItem[], key: CompareDimensionKey): boolean {
  for (let i = 1; i < items.length; i++) {
    if (compareCellsDiffer(items[0]?.[key], items[i]?.[key])) return true
  }
  return false
}

/**
 * 格子展示值：按“值是否存在”分流——值非空即显示原值（`'未标注'`、`'免费'`
 * 等），未验证只在副行体现（`CellValue` 副行 `verified === false → ' · 未验证'`）；
 * 只有值为空时才显示“未验证”。
 * 防御：`unknown` 是分面的“尚未核实标注”标记，绝不能原样渲染英文
 * （服务端已映射为“未标注”，这里再兜底一次）。
 */
export function formatCellValue(cell: ComparisonCell | null | undefined): string {
  const normalized = normalizeCellValue(cell)
  if (!normalized) return '未验证'
  if (normalized === 'unknown') return '未标注'
  return normalized
}

/** 来源数据的核实日期（毫秒戳 → `2026/11/14`），缺失返回 null（不编造日期）。 */
export function formatVerifiedDate(verifiedAt: number | null | undefined): string | null {
  if (verifiedAt == null || !Number.isFinite(verifiedAt)) return null
  const date = new Date(verifiedAt)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
}

/**
 * 归一化一站的对照行：接受 REST 扁平形态；也接受 `cells: { pricing, … }`
 * 包裹形态（任务冻结 shape 的写法）。优先级（二选一，写死在这里）：
 * `record.cells` 为对象时整体采用它，扁平字段被忽略——即使 `cells` 缺
 * 某个键也不回退到扁平值，缺键落“未验证”格，不抛错、不编造。
 */
export function normalizeComparisonItem(raw: unknown): ComparisonItem | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const siteId = typeof record.siteId === 'string' ? record.siteId.trim() : ''
  if (!siteId) return null
  const cellsSource =
    record.cells && typeof record.cells === 'object'
      ? (record.cells as Record<string, unknown>)
      : record
  const cell = (key: CompareDimensionKey): ComparisonCell => {
    const rawCell = cellsSource[key]
    if (!rawCell || typeof rawCell !== 'object') {
      return { value: null, source: '', verified: false, verifiedAt: null }
    }
    const c = rawCell as Record<string, unknown>
    const value =
      c.value == null
        ? null
        : Array.isArray(c.value)
          ? c.value.map((v) => String(v))
          : String(c.value)
    return {
      value,
      source: typeof c.source === 'string' ? c.source : '',
      verified: c.verified === true,
      verifiedAt: typeof c.verifiedAt === 'number' ? c.verifiedAt : null,
      lastCheckedAt: typeof c.lastCheckedAt === 'number' ? c.lastCheckedAt : null,
      stale: c.stale === true ? true : undefined,
      sourceUrl: typeof c.sourceUrl === 'string' ? c.sourceUrl : null,
      amountMinor: typeof c.amountMinor === 'number' ? c.amountMinor : undefined,
      currency: typeof c.currency === 'string' ? c.currency : undefined,
      period: typeof c.period === 'string' ? c.period : undefined,
      freeTierLimit: typeof c.freeTierLimit === 'string' ? c.freeTierLimit : null,
    }
  }
  return {
    siteId,
    title: typeof record.title === 'string' ? record.title : siteId,
    url: typeof record.url === 'string' ? record.url : '',
    pricing: cell('pricing'),
    price: cell('price'),
    platform: cell('platform'),
    form: cell('form'),
    maintenance: cell('maintenance'),
    note: cell('note'),
    migration: cell('migration'),
  }
}

/** 归一化整份接口返回：`{ ok, items }`，非数组/空数组一律返回 []（不渲染空表）。 */
export function normalizeComparisonItems(raw: unknown): ComparisonItem[] {
  if (!raw || typeof raw !== 'object') return []
  const items = (raw as Record<string, unknown>).items
  if (!Array.isArray(items)) return []
  const out: ComparisonItem[] = []
  for (const item of items) {
    const normalized = normalizeComparisonItem(item)
    if (normalized) out.push(normalized)
  }
  return out
}

/* ------------------------------ 分流结论 ------------------------------ */

/** 分流场景：只做按场景分流的一句话，不排名、不打总分。 */
export const COMPARE_SCENARIOS = [
  { key: 'budget', label: '预算敏感' },
  { key: 'stability', label: '要稳定少折腾' },
  { key: 'migration', label: '迁移成本优先' },
] as const

export type CompareScenarioKey = (typeof COMPARE_SCENARIOS)[number]['key']

export function isCompareScenarioKey(key: string): key is CompareScenarioKey {
  return (COMPARE_SCENARIOS as readonly { key: string }[]).some((s) => s.key === key)
}

export interface CompareConclusionInput {
  /** 场景键 */
  scenario: string
  /** 被选中的站点 id（必须在 siteIds 白名单内） */
  siteId: string
  /** 分流依据的维度键（须为 6 维之一，至少 1 个） */
  basisKeys: readonly string[]
  /**
   * 被选站点在上述依据维度上的格子，与去重/过滤后的 basisKeys 位置对齐
   * （调用方只传合法维度时与 basisKeys 原序一致）。严格规则 (a)：任一
   * 依据格未验证（缺格、`verified === false` 或值为空）即拒绝生成结论。
   */
  basisCells: readonly (ComparisonCell | null | undefined)[]
  /** 对照表内的站点 id 白名单 */
  siteIds: readonly string[]
  /** 对照表内的站点标题（只用于拼句，不接受白名单外标题） */
  siteTitles: Readonly<Record<string, string>>
}

export type CompareConclusionResult =
  | { ok: true; text: string }
  | { ok: false; error: string }

/**
 * 生成分流结论句，并校验引用白名单：
 * 结论只能引用对照表内的 siteIds 与 6 个维度，引用白名单外的 id/维度
 * 一律拒绝保存（复用 /ask 的引用白名单思路）。另加严格规则 (a)：任一
 * 依据格未验证（缺格、`verified === false` 或值为空）即拒绝生成，
 * 提示换依据或先补数据——未验证的格子不能当分流依据。
 */
export function buildCompareConclusion(input: CompareConclusionInput): CompareConclusionResult {
  if (!isCompareScenarioKey(input.scenario)) {
    return { ok: false, error: '请选择一个分流场景。' }
  }
  if (!input.siteIds.includes(input.siteId)) {
    return { ok: false, error: '结论只能引用对照表内的站点。' }
  }
  const title = (input.siteTitles[input.siteId] ?? '').trim()
  if (!title) {
    return { ok: false, error: '结论只能引用对照表内的站点。' }
  }
  const basis = [...new Set(input.basisKeys.filter(isCompareDimensionKey))]
  if (basis.length === 0) {
    return { ok: false, error: '请至少勾选一个作为分流依据的格子。' }
  }
  const basisCells = input.basisCells ?? []
  for (let i = 0; i < basis.length; i++) {
    const basisCell = basisCells[i]
    if (!basisCell || basisCell.verified !== true || normalizeCellValue(basisCell) === null) {
      return { ok: false, error: '依据格子中有未验证项，请换依据或先补数据。' }
    }
  }
  const scenario = COMPARE_SCENARIOS.find((s) => s.key === input.scenario)!
  const basisLabels = basis.map((key) => COMPARE_DIMENSION_LABELS[key])
  return {
    ok: true,
    text: `${scenario.label}选「${title}」（依据：${basisLabels.join('、')}）`,
  }
}

/* --------------------------- 结论本机保存 --------------------------- */

export interface SavedCompareNote {
  id: string
  createdAt: number
  siteIds: string[]
  siteTitles: Record<string, string>
  scenario: CompareScenarioKey
  siteId: string
  basisKeys: CompareDimensionKey[]
  text: string
}

/** 与 localStorage 同形的最小存储面：便于 node 测试注入内存实现。 */
export interface CompareNotesStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultCompareNotesStore(): CompareNotesStore | null {
  try {
    const store = (globalThis as { localStorage?: CompareNotesStore }).localStorage
    return store ?? null
  } catch {
    return null
  }
}

function isSavedCompareNote(value: unknown): value is SavedCompareNote {
  if (!value || typeof value !== 'object') return false
  const note = value as Record<string, unknown>
  return (
    typeof note.id === 'string' &&
    typeof note.createdAt === 'number' &&
    Array.isArray(note.siteIds) &&
    typeof note.text === 'string' &&
    typeof note.siteId === 'string' &&
    isCompareScenarioKey(String(note.scenario ?? ''))
  )
}

/** 读出已保存的对照结论（解析失败/结构不对一律返回 []，不抛错）。 */
export function readCompareNotes(store?: CompareNotesStore | null): SavedCompareNote[] {
  const storage = store ?? defaultCompareNotesStore()
  if (!storage) return []
  try {
    const raw = storage.getItem(COMPARE_NOTES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSavedCompareNote)
  } catch {
    return []
  }
}

export type SaveCompareNoteResult =
  | { ok: true; notes: SavedCompareNote[]; note: SavedCompareNote }
  | { ok: false; error: string }

/**
 * 保存一条对照结论到本机：先过引用白名单（结论只能引用对照表内的 siteId），
 * 再写 localStorage；写不进去如实报错。保存后调用方用返回的 notes 直接渲染，
 * “保存即真实可见”。
 */
export function saveCompareNote(
  input: CompareConclusionInput,
  store?: CompareNotesStore | null,
): SaveCompareNoteResult {
  const conclusion = buildCompareConclusion(input)
  if (!conclusion.ok) return { ok: false, error: conclusion.error }
  const storage = store ?? defaultCompareNotesStore()
  if (!storage) return { ok: false, error: '本机存储不可用，结论没有保存。' }
  const note: SavedCompareNote = {
    id: `cmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    siteIds: [...input.siteIds],
    siteTitles: { ...input.siteTitles },
    scenario: input.scenario as CompareScenarioKey,
    siteId: input.siteId,
    basisKeys: [...new Set(input.basisKeys.filter(isCompareDimensionKey))],
    text: conclusion.text,
  }
  const notes = [note, ...readCompareNotes(storage)]
  try {
    storage.setItem(COMPARE_NOTES_KEY, JSON.stringify(notes))
  } catch {
    return { ok: false, error: '本机存储写不进去，结论没有保存。' }
  }
  return { ok: true, notes, note }
}

/** 删除一条已保存的对照结论（不存在的 id 直接返回当前列表，不报错）。 */
export function deleteCompareNote(
  id: string,
  store?: CompareNotesStore | null,
): SavedCompareNote[] {
  const storage = store ?? defaultCompareNotesStore()
  if (!storage) return []
  const notes = readCompareNotes(storage).filter((note) => note.id !== id)
  try {
    storage.setItem(COMPARE_NOTES_KEY, JSON.stringify(notes))
  } catch {
    return readCompareNotes(storage)
  }
  return notes
}

/* ------------------------- 刷新验证（P2-1） ------------------------- */

/** robots.txt 禁抓站点的本机记忆键：置灰是本机记忆 + 服务端每次都重判。 */
export const COMPARE_VERIFY_ROBOTS_KEY = 'navhub.verify.robots-disallowed.v1'

export type VerifyOutcomeKind = 'ok' | 'dead' | 'blocked' | 'unverified' | 'server-error'

/** GET /api/sites/:id/verify 的状态体（只取前端轮询要用的字段）。 */
export interface VerifyStatusResult {
  status: 'idle' | 'pending' | 'done' | 'robots_disallowed'
  outcome: { kind: VerifyOutcomeKind; status?: number; reason?: string } | null
  robots_disallowed: boolean
  lastCheckedAt: number | null
  finishedAt: number | null
}

/** 读出本机记住的 robots 禁抓站点 id（解析失败一律返回 []，不抛错）。 */
export function readRobotsDisallowedSiteIds(store?: CompareNotesStore | null): string[] {
  const storage = store ?? defaultCompareNotesStore()
  if (!storage) return []
  try {
    const raw = storage.getItem(COMPARE_VERIFY_ROBOTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  } catch {
    return []
  }
}

/** 某站是否在本机 robots 禁抓记忆里（按钮置灰的本地依据）。 */
export function isRobotsDisallowedSite(siteId: string, store?: CompareNotesStore | null): boolean {
  return readRobotsDisallowedSiteIds(store).includes(siteId.trim())
}

/** 把某站记进本机 robots 禁抓记忆，返回更新后的 id 列表（写不进返回原列表）。 */
export function rememberRobotsDisallowedSiteId(
  siteId: string,
  store?: CompareNotesStore | null,
): string[] {
  const id = siteId.trim()
  if (!id) return readRobotsDisallowedSiteIds(store)
  const storage = store ?? defaultCompareNotesStore()
  const ids = readRobotsDisallowedSiteIds(storage)
  if (ids.includes(id)) return ids
  const next = [...ids, id]
  try {
    storage?.setItem(COMPARE_VERIFY_ROBOTS_KEY, JSON.stringify(next))
  } catch {
    return ids
  }
  return next
}

/** 探活结论 → 人话：blocked/unverified/server-error 一律是“未验证”，绝不写“已停更”。 */
export function verifyOutcomeMessage(kind: VerifyOutcomeKind | null | undefined): string {
  switch (kind) {
    case 'ok':
      return '验证完成：可达。'
    case 'dead':
      return '验证完成：页面已不存在（不可达）。'
    case 'blocked':
      return '本次验证未能确认可用性：目标站拒绝了探活，已标为“未验证”，未写入任何假值。'
    case 'server-error':
      return '本次验证未能确认可用性：目标站服务端暂时不可用，已标为“未验证”，未写入任何假值。'
    default:
      return '本次验证未能确认可用性，已标为“未验证”，未写入任何假值。'
  }
}

/* ------------------------- 价格数值（P2-2） ------------------------- */

/** 价格抓取 robots.txt 禁抓站点的本机记忆键（与 verify 的键分开）。 */
export const COMPARE_PRICE_ROBOTS_KEY = 'navhub.price.robots-disallowed.v1'

/** 读出本机记住的价格抓取 robots 禁抓站点 id（解析失败一律返回 []，不抛错）。 */
export function readPriceRobotsDisallowedSiteIds(store?: CompareNotesStore | null): string[] {
  const storage = store ?? defaultCompareNotesStore()
  if (!storage) return []
  try {
    const raw = storage.getItem(COMPARE_PRICE_ROBOTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  } catch {
    return []
  }
}

/** 某站是否在本机价格抓取 robots 禁抓记忆里（抓取按钮置灰的本地依据）。 */
export function isPriceRobotsDisallowedSite(siteId: string, store?: CompareNotesStore | null): boolean {
  return readPriceRobotsDisallowedSiteIds(store).includes(siteId.trim())
}

/** 把某站记进本机价格抓取 robots 禁抓记忆，返回更新后的 id 列表（写不进返回原列表）。 */
export function rememberPriceRobotsDisallowedSiteId(
  siteId: string,
  store?: CompareNotesStore | null,
): string[] {
  const id = siteId.trim()
  if (!id) return readPriceRobotsDisallowedSiteIds(store)
  const storage = store ?? defaultCompareNotesStore()
  const ids = readPriceRobotsDisallowedSiteIds(storage)
  if (ids.includes(id)) return ids
  const next = [...ids, id]
  try {
    storage?.setItem(COMPARE_PRICE_ROBOTS_KEY, JSON.stringify(next))
  } catch {
    return ids
  }
  return next
}

/** 价格表单的货币下拉（与服务端 PRICE_CURRENCIES 同源）。 */
export const PRICE_CURRENCIES = [
  { value: 'CNY', label: '人民币 CNY ¥' },
  { value: 'USD', label: '美元 USD $' },
  { value: 'EUR', label: '欧元 EUR €' },
  { value: 'GBP', label: '英镑 GBP £' },
  { value: 'JPY', label: '日元 JPY ¥' },
  { value: 'HKD', label: '港币 HKD HK$' },
  { value: 'AUD', label: '澳元 AUD A$' },
  { value: 'CAD', label: '加元 CAD C$' },
  { value: 'SGD', label: '新元 SGD S$' },
  { value: 'KRW', label: '韩元 KRW ₩' },
] as const

/** 价格表单的周期下拉（与服务端 PRICE_PERIODS 同源）。 */
export const PRICE_PERIODS = [
  { value: 'month', label: '按月 /月' },
  { value: 'year', label: '按年 /年' },
  { value: 'once', label: '一次性 /次' },
  { value: 'usage', label: '按量 /用量' },
] as const

export type PriceCurrencyValue = (typeof PRICE_CURRENCIES)[number]['value']
export type PricePeriodValue = (typeof PRICE_PERIODS)[number]['value']

/** 抓取返回的一条价格候选（与服务端 PriceScrapeCandidate 同形）。
 * amount 是原文金额（本位，如 19.9）：裸 ¥ 候选 currency 为空时 amountMinor
 * 算不出来（CNY ×100、JPY ×1），前端凭 amount + 用户选定的货币再算 minor；
 * confirmToken 是服务端签发的一次性确认凭证（不可确认的候选为 null），
 * 确认时随 POST /price 带上，服务端核对通过才写 official_scrape。 */
export interface PriceScrapeCandidate {
  text: string
  amount: number | null
  amountMinor: number | null
  currency: string | null
  period: string | null
  confirmToken: string | null
}

/**
 * 表单金额（本位，如 19.9）→ 最小货币单位整数（分/美分）。
 * JPY/KRW 无小数位：金额即本位，不乘 100。非法/非正返回 null（表单拦截，不提交）。
 */
export function priceAmountToMinor(amountText: string, currency: string): number | null {
  const amount = Number(String(amountText).trim())
  if (!Number.isFinite(amount) || amount <= 0) return null
  const minor = currency === 'JPY' || currency === 'KRW' ? Math.round(amount) : Math.round(amount * 100)
  if (minor < 1 || minor > 999_999_999) return null
  return minor
}

/** 最小货币单位整数 → 表单金额（本位字符串，如 1990 → '19.9'；JPY/KRW 不除 100）。 */
export function priceMinorToAmount(amountMinor: number, currency: string): string {
  if (currency === 'JPY' || currency === 'KRW') return String(amountMinor)
  const major = amountMinor / 100
  return Number.isInteger(major) ? String(major) : major.toFixed(2).replace(/0$/, '')
}

/* ------------------------- 详情页候选 pick-state ------------------------- */

/** 同类候选卡片的最小形态（相关区 HubSite 与平替关系边归一后共用）。 */
export interface CompareCandidate {
  id: string
  title: string
  url: string
}

/**
 * 合并多路同类候选（第 3 项）：服务端相关区 + 共享标签 `/similar` +
 * `alternative` 关系边。按传入顺序去重，排除本站自己，空 id 跳过。
 * KNN 版相似（`/api/rank/similar`）不在候选来源里。
 */
export function mergeCompareCandidates<T extends CompareCandidate>(
  currentId: string,
  ...lists: readonly (readonly T[])[]
): T[] {
  const seen = new Set<string>([currentId.trim()])
  const out: T[] = []
  for (const list of lists) {
    for (const candidate of list) {
      const id = candidate.id.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      // 原样保留候选对象（HubSite 的 description/iconKey 等字段相关区卡片还要用）
      out.push(candidate)
    }
  }
  return out
}

export type ToggleComparePickResult =
  | { picked: string[]; blocked: false }
  | { picked: string[]; blocked: true; message: string }

/**
 * 详情页同类候选的点选切换（第 3 项复用；收藏夹批量模式“点卡片=切换选中”的
 * 纯函数版）：同一张卡点两次 = 取消；`maxPicks` 是除已含成员（如本站）外
 * 还能再选的上限，超限不加入并返回提示（调用方展示，不静默吞掉）。
 */
export function toggleComparePick(
  picked: readonly string[],
  candidateId: string,
  maxPicks: number,
): ToggleComparePickResult {
  const id = candidateId.trim()
  if (!id) return { picked: [...picked], blocked: false }
  if (picked.includes(id)) {
    return { picked: picked.filter((item) => item !== id), blocked: false }
  }
  if (picked.length >= maxPicks) {
    return {
      picked: [...picked],
      blocked: true,
      message: `一次最多对比 ${maxPicks + 1} 个站点（含本站），请先取消一个再选。`,
    }
  }
  return { picked: [...picked, id], blocked: false }
}
