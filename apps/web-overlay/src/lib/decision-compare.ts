/**
 * P12 对比卡 PoC：用户侧对比篮 + 结构化事实对照表
 * （2026-11-25 周三每日战略研究过门禁方案“同类站并排对比卡”，2 周 PoC 骨架）。
 *
 * 本文件不碰 React / DOM / 网络，只做可单元测试的纯函数：
 *   - 对比篮（localStorage，上限 3、去重、按加入顺序排列）；
 *   - 快照（详情页已有的事实字段 → 篮内条目，不发请求、不调 LLM）；
 *   - 对照行（6 个结构化事实字段，缺失整格“未验证”）；
 *   - “只看不同”过滤（默认开，由调用方传 true）；
 *   - 用户自选在意点（1–3 个，权重由用户当场选，不预设）。
 *
 * 硬约束（方案原文 + 四道门禁）：
 *   - 不输出胜者、不输出总分、不输出百分比排名、不做站间排序；
 *     本模块没有任何 winner / verdict / score / rank 字段与函数。
 *   - `packages/core/src/comparison.ts` 的 winner/verdict 字段一律不用于本站 vs 本站。
 *   - 是否需注册 / 有无广告：本站尚无该字段的数据源，快照里不编造，
 *     对照行恒为“未验证”（等有核实来源后再接线，见下方 NO_SOURCE_ROWS）。
 *   - 对比页一律不带佣金链：本站点链接只用条目原 url，不拼任何追踪参数。
 *   - 价格/免费档只认已有的价格口径：免费档数值只来自价格记录
 *     （`freeTier`，无记录为 null）；无 `source_url` / `verified_at`
 *     的价格一律不渲染为已核实（本 PoC 快照不带价格记录，freeTier 恒为 null）。
 */

import { formatVerifiedDate } from './compare'
import { isBotBlockedHealthRecord } from './probe-policy'

/** 对比篮的本机键（新键，不复用任何收藏/备注/对照结论键）。 */
export const DECISION_COMPARE_BASKET_KEY = 'navhub.decision-compare.basket.v1'

/** 对比篮容量：方案定 2–3 个站。 */
export const MIN_DECISION_COMPARE_SITES = 2
export const MAX_DECISION_COMPARE_SITES = 3

/** 用户自选在意点上限：方案定 1–3 个。 */
export const MAX_DECISION_PRIORITIES = 3

/**
 * 计费方式中文 label（与 `packages/core/src/facets.ts` CONTROLLED_FACETS
 * 的 pricing 选项同源；overlay lib 内无 facets 镜像，故此处只列
 * 对照表要用的 5 个值，改动分面定义时须同步改这里）。
 * `unknown` = 尚未核实标注，快照里按缺失处理（pricingLabel 为 null）。
 */
export const DECISION_PRICING_LABELS: Record<string, string> = {
  free: '完全免费',
  freemium: '免费增值',
  paid: '商业付费',
  open_source: '开源免费',
  unknown: '未标注',
}

/** 适用场景分面中文 label（与 CONTROLLED_FACETS 的 scene 选项同源，见上）。 */
export const DECISION_SCENE_LABELS: Record<string, string> = {
  dev: '开发编程',
  design: '设计创意',
  ai: 'AI 与智能',
  content: '内容创作',
  productivity: '效率办公',
  ops: '运维与云原生',
}

/** 快照输入：详情页 HubSite 的子集（只取对照表要用的事实字段）。 */
export interface DecisionCompareSiteInput {
  id: string
  title: string
  url: string
  facets?: Record<string, string[] | undefined> | null
  health?: {
    ok?: boolean | null
    lastCheckedAt?: number | null
    error?: string | null
  } | null
  tags?: string[] | null
  updatedAt?: number | null
  /** 调用方已有的价格记录免费档上限原文；无记录传 null/不传（PoC 快照恒为 null）。 */
  freeTier?: string | null
}

/** 篮内一条：加入时刻冻结的结构化事实快照（不含任何评分/排名字段）。 */
export interface DecisionCompareEntry {
  siteId: string
  title: string
  url: string
  /** 计费方式中文 label；null = 未标注/未知 → 该格未验证。 */
  pricingLabel: string | null
  /** pricing 分面是否已核实（unknown/缺失为 false）。 */
  pricingVerified: boolean
  /** pricing 分面的来源时间（站点 updatedAt），无则 null。 */
  pricingVerifiedAt: number | null
  /** 免费档上限原文；无价格记录为 null（不猜测、不编造）。 */
  freeTier: string | null
  /** 活链状态：巡检 ok；null = 从未巡检或被风控拦截 → 未验证。 */
  liveState: 'reachable' | 'unreachable' | null
  /** 健康巡检最后时间戳；null = 从未巡检。 */
  lastCheckedAt: number | null
  /** 适用场景标签（scene 分面中文 label；无 scene 分面时退回站点 tags）。 */
  sceneTags: string[]
  /** 场景标签的来源（分面 / 标签），渲染副行用。 */
  sceneSource: '站点分面' | '站点标签'
  /** 快照冻结时间（毫秒戳）。 */
  capturedAt: number
}

function firstFacetValue(
  facets: Record<string, string[] | undefined> | null | undefined,
  key: string,
): string | null {
  const values = facets?.[key] ?? []
  const raw = values.map((v) => String(v).trim().toLowerCase()).filter(Boolean)[0]
  return raw ?? null
}

function facetLabels(
  facets: Record<string, string[] | undefined> | null | undefined,
  key: string,
  labelTable: Record<string, string>,
): string[] {
  const values = facets?.[key] ?? []
  const out: string[] = []
  for (const v of values) {
    const norm = String(v).trim().toLowerCase()
    if (!norm) continue
    const label = labelTable[norm] ?? String(v).trim()
    if (label && !out.includes(label)) out.push(label)
  }
  return out
}

/**
 * 把详情页站点对象冻结为篮内条目。
 * 保守默认（与 site-comparison.ts 的 maintenanceCell 同口径）：
 *   - pricing 为 unknown/缺失 → pricingLabel 为 null（未验证），绝不写成“免费”；
 *   - health.lastCheckedAt 为空 → liveState 为 null（未验证），绝不据 ok 推断；
 *   - 风控拦截（bot-blocked）→ liveState 为 null：ok=false 在这里是“拒绝我们”，
 *     不是“站点已死”，写成已核实的“不可达”会把活站判死。
 */
export function snapshotSiteForDecisionCompare(
  site: DecisionCompareSiteInput,
  now: number = Date.now(),
): DecisionCompareEntry {
  const pricingRaw = firstFacetValue(site.facets, 'pricing')
  const pricingLabel =
    pricingRaw && pricingRaw !== 'unknown' ? (DECISION_PRICING_LABELS[pricingRaw] ?? null) : null
  const lastCheckedAt =
    typeof site.health?.lastCheckedAt === 'number' ? site.health.lastCheckedAt : null
  const botBlocked = isBotBlockedHealthRecord(site.health?.error)
  const liveState: DecisionCompareEntry['liveState'] =
    lastCheckedAt == null || botBlocked
      ? null
      : site.health?.ok === true
        ? 'reachable'
        : 'unreachable'
  const sceneFromFacets = facetLabels(site.facets, 'scene', DECISION_SCENE_LABELS)
  const tags = (site.tags ?? []).map((t) => String(t).trim()).filter(Boolean)
  const useTags = sceneFromFacets.length === 0
  return {
    siteId: site.id.trim(),
    title: site.title.trim(),
    url: site.url.trim(),
    pricingLabel,
    pricingVerified: pricingLabel != null,
    pricingVerifiedAt:
      pricingLabel != null && typeof site.updatedAt === 'number' ? site.updatedAt : null,
    freeTier: site.freeTier?.trim() ? site.freeTier.trim() : null,
    liveState,
    lastCheckedAt,
    sceneTags: useTags ? [...new Set(tags)] : sceneFromFacets,
    sceneSource: useTags ? '站点标签' : '站点分面',
    capturedAt: now,
  }
}

/* ------------------------------ 对比篮 ------------------------------ */

/** 与 localStorage 同形的最小存储面：便于 node 测试注入内存实现。 */
export interface DecisionCompareStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultDecisionCompareStore(): DecisionCompareStore | null {
  try {
    const store = (globalThis as { localStorage?: DecisionCompareStore }).localStorage
    return store ?? null
  } catch {
    return null
  }
}

export function isDecisionCompareEntry(value: unknown): value is DecisionCompareEntry {
  if (!value || typeof value !== 'object') return false
  const e = value as Record<string, unknown>
  return (
    typeof e.siteId === 'string' &&
    e.siteId.trim() !== '' &&
    typeof e.title === 'string' &&
    typeof e.url === 'string' &&
    (e.pricingLabel === null || typeof e.pricingLabel === 'string') &&
    typeof e.pricingVerified === 'boolean' &&
    (e.pricingVerifiedAt === null || typeof e.pricingVerifiedAt === 'number') &&
    (e.freeTier === null || typeof e.freeTier === 'string') &&
    (e.liveState === null || e.liveState === 'reachable' || e.liveState === 'unreachable') &&
    (e.lastCheckedAt === null || typeof e.lastCheckedAt === 'number') &&
    Array.isArray(e.sceneTags) &&
    e.sceneTags.every((t) => typeof t === 'string') &&
    (e.sceneSource === '站点分面' || e.sceneSource === '站点标签') &&
    typeof e.capturedAt === 'number'
  )
}

/**
 * 读出对比篮（解析失败/结构不对的条目一律丢弃，不抛错）。
 * 注意：篮是可随时重加的本地快照，损坏时丢弃即等价于“篮空了”，
 * 与收藏不同——收藏损坏须走隔离备份（见 favorites-storage.ts），
 * 篮不需要那套 ceremony（重加一次即恢复）。
 */
export function readDecisionBasket(store?: DecisionCompareStore | null): DecisionCompareEntry[] {
  const storage = store ?? defaultDecisionCompareStore()
  if (!storage) return []
  try {
    const raw = storage.getItem(DECISION_COMPARE_BASKET_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const out: DecisionCompareEntry[] = []
    for (const item of parsed) {
      if (!isDecisionCompareEntry(item)) continue
      if (seen.has(item.siteId)) continue
      seen.add(item.siteId)
      out.push(item)
    }
    return out.slice(0, MAX_DECISION_COMPARE_SITES)
  } catch {
    return []
  }
}

/** 写回对比篮；写不进去返回 false（调用方如实报错，不静默丢篮）。 */
export function writeDecisionBasket(
  entries: readonly DecisionCompareEntry[],
  store?: DecisionCompareStore | null,
): boolean {
  const storage = store ?? defaultDecisionCompareStore()
  if (!storage) return false
  try {
    storage.setItem(DECISION_COMPARE_BASKET_KEY, JSON.stringify([...entries]))
    return true
  } catch {
    return false
  }
}

export type AddToDecisionBasketResult = {
  entries: DecisionCompareEntry[]
  added: boolean
  blocked: boolean
  message: string | null
}

/**
 * 加站进篮：已在篮中不重复加；满 3 个不加入并返回提示（调用方展示，
 * 不静默吞掉）。顺序 = 加入顺序，对照表按此顺序列站，不排序。
 */
export function addToDecisionBasket(
  entries: readonly DecisionCompareEntry[],
  entry: DecisionCompareEntry,
): AddToDecisionBasketResult {
  if (entries.some((e) => e.siteId === entry.siteId)) {
    return { entries: [...entries], added: false, blocked: false, message: '该站已在对比篮中。' }
  }
  if (entries.length >= MAX_DECISION_COMPARE_SITES) {
    return {
      entries: [...entries],
      added: false,
      blocked: true,
      message: `对比篮最多放 ${MAX_DECISION_COMPARE_SITES} 个站，请先移出一个再加入。`,
    }
  }
  return { entries: [...entries, entry], added: true, blocked: false, message: null }
}

/** 从篮中移出一个站（不在篮中时原样返回）。 */
export function removeFromDecisionBasket(
  entries: readonly DecisionCompareEntry[],
  siteId: string,
): DecisionCompareEntry[] {
  const id = siteId.trim()
  if (!id) return [...entries]
  return entries.filter((e) => e.siteId !== id)
}

/* ------------------------------ 对照行 ------------------------------ */

/** P12 对照表的 6 个结构化事实字段（顺序即表内行顺序）。 */
export const DECISION_COMPARE_FIELDS = [
  { key: 'free', label: '是否免费 / 免费档' },
  { key: 'registration', label: '是否需注册' },
  { key: 'ads', label: '有无广告' },
  { key: 'live', label: '活链状态' },
  { key: 'lastVerified', label: '最后核验时间' },
  { key: 'scene', label: '适用场景标签' },
] as const

export type DecisionCompareFieldKey = (typeof DECISION_COMPARE_FIELDS)[number]['key']

export function isDecisionCompareFieldKey(key: string): key is DecisionCompareFieldKey {
  return (DECISION_COMPARE_FIELDS as readonly { key: string }[]).some((f) => f.key === key)
}

/**
 * 暂无数据源的行：本站尚无“是否需注册 / 有无广告”的核实字段，
 * 对照行恒为未验证——等有核实来源后再接线，PoC 阶段绝不凭推断填值。
 */
export const NO_SOURCE_ROWS: readonly DecisionCompareFieldKey[] = ['registration', 'ads']

/** 对照表里的一个格子：展示文本 + 是否已验证 + 来源 + 核实时间。text 为 null 即“未验证”。 */
export interface DecisionCompareCell {
  text: string | null
  verified: boolean
  source: string
  verifiedAt: number | null
}

/** 对照表的一行：字段 + 每站一格（顺序与 entries 入参一致，不排序）。 */
export interface DecisionCompareRow {
  key: DecisionCompareFieldKey
  label: string
  cells: DecisionCompareCell[]
}

function unverifiedCell(source: string): DecisionCompareCell {
  return { text: null, verified: false, source, verifiedAt: null }
}

/** 按入参顺序组装对照行（调用方负责按篮内加入顺序传入）。不排名、不打分。 */
export function buildDecisionCompareRows(
  entries: readonly DecisionCompareEntry[],
): DecisionCompareRow[] {
  const free: DecisionCompareCell[] = entries.map((e) => {
    if (e.pricingLabel == null) return unverifiedCell('站点分面')
    const text = e.freeTier ? `${e.pricingLabel} · 免费档${e.freeTier}` : e.pricingLabel
    return { text, verified: e.pricingVerified, source: '站点分面', verifiedAt: e.pricingVerifiedAt }
  })
  const registration: DecisionCompareCell[] = entries.map(() => unverifiedCell('暂无该字段'))
  const ads: DecisionCompareCell[] = entries.map(() => unverifiedCell('暂无该字段'))
  const live: DecisionCompareCell[] = entries.map((e) => {
    if (e.liveState == null) return unverifiedCell('健康巡检')
    return {
      text: e.liveState === 'reachable' ? '可达' : '不可达',
      verified: true,
      source: '健康巡检',
      verifiedAt: e.lastCheckedAt,
    }
  })
  const lastVerified: DecisionCompareCell[] = entries.map((e) => {
    const text = formatVerifiedDate(e.lastCheckedAt)
    if (text == null) return unverifiedCell('健康巡检')
    return { text, verified: true, source: '健康巡检', verifiedAt: e.lastCheckedAt }
  })
  const scene: DecisionCompareCell[] = entries.map((e) => {
    if (e.sceneTags.length === 0) return unverifiedCell(e.sceneSource)
    return {
      text: e.sceneTags.join('、'),
      verified: true,
      source: e.sceneSource,
      verifiedAt: null,
    }
  })
  const byKey: Record<DecisionCompareFieldKey, DecisionCompareCell[]> = {
    free,
    registration,
    ads,
    live,
    lastVerified,
    scene,
  }
  return DECISION_COMPARE_FIELDS.map(({ key, label }) => ({ key, label, cells: byKey[key] }))
}

/** 格子展示值：值为空时整格显示“未验证”（调用方据此渲染，不猜值）。 */
export function formatDecisionCellValue(cell: DecisionCompareCell | null | undefined): string {
  const text = cell?.text?.trim()
  return text ? text : '未验证'
}

/** 某一行在各站之间是否存在差异（任一格文本不同即整行算不同；null 也是一种值）。 */
export function decisionRowDiffers(row: DecisionCompareRow): boolean {
  const texts = row.cells.map((c) => c.text?.trim() ?? null)
  for (let i = 1; i < texts.length; i++) {
    if (texts[i] !== texts[0]) return true
  }
  return false
}

/**
 * “只看不同”过滤（默认开：调用方默认传 true）。
 * 只过滤行，不改变站列顺序、不排序。
 */
export function visibleDecisionRows(
  rows: readonly DecisionCompareRow[],
  onlyDifferent: boolean,
): DecisionCompareRow[] {
  if (!onlyDifferent) return [...rows]
  return rows.filter(decisionRowDiffers)
}

/* --------------------------- 用户自选在意点 --------------------------- */

/** 在意点 = 对照表的字段本身（1–3 个）；权重由用户当场选，不预设。 */
export const DECISION_COMPARE_PRIORITIES = DECISION_COMPARE_FIELDS

export type ToggleDecisionPriorityResult =
  | { selected: DecisionCompareFieldKey[]; blocked: false }
  | { selected: DecisionCompareFieldKey[]; blocked: true; message: string }

/**
 * 在意点勾选切换：点两次 = 取消；超 3 个不加入并返回提示。
 * 高亮只影响行的视觉强调，不改变行顺序、不参与任何总分。
 */
export function toggleDecisionPriority(
  selected: readonly DecisionCompareFieldKey[],
  key: string,
): ToggleDecisionPriorityResult {
  if (!isDecisionCompareFieldKey(key)) {
    return { selected: [...selected], blocked: false }
  }
  if (selected.includes(key)) {
    return { selected: selected.filter((item) => item !== key), blocked: false }
  }
  if (selected.length >= MAX_DECISION_PRIORITIES) {
    return {
      selected: [...selected],
      blocked: true,
      message: `一次最多勾选 ${MAX_DECISION_PRIORITIES} 个在意点，请先取消一个再选。`,
    }
  }
  return { selected: [...selected, key], blocked: false }
}

/** 对比页篮模式入口（篮内容走 localStorage，URL 只选模式，不带站 id）。 */
export function buildDecisionCompareHref(): string {
  return '/compare?basket=1'
}
