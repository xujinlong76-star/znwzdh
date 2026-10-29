/**
 * 富化结果字段级审核（AI-4c）——纯逻辑层。
 *
 * 中枢的富化把标题/描述/标签/类目/图标一次给出，但每一项的可信度不同：
 * 模型写的标题可能更通顺，也可能把品牌名"改对"成错的；页面没有 description
 * 时拿到的是空占位；图标可能指向第三方图标服务，按规范不能落库。
 * 审核界面据此逐项展示来源、允许逐项勾选，本模块负责：
 *   - 把 `fields` 翻译成可渲染的行（含「为什么不可用」）；
 *   - 默认勾选：有值才勾，missing 一律不勾（空值不是最新信息）；
 *   - 按勾选构造**精确**的建站载荷，保证「审的是什么，落的就是什么」。
 *
 * 注意：建站走普通 `POST /api/sites`，不再带 `enrich:true`——二次富化会
 * 重新调用模型，拿到的值可能和审核时看到的不一样，那等于审核失效。
 */
import type { EnrichFieldSource, HubEnrichmentFields } from './navhub-api'

export const ENRICH_REVIEW_FIELDS = [
  { key: 'title', label: '标题', hint: '站点名称；建站必填' },
  { key: 'description', label: '描述', hint: '简介文案' },
  { key: 'category', label: '类目建议', hint: '仅作参考，实际挂载由下方类目选择器决定' },
  { key: 'tags', label: '标签', hint: '最多 8 个，重复项会被合并' },
  { key: 'icon', label: '图标', hint: '指向第三方图标服务的地址不落库' },
] as const

export type EnrichReviewKey = (typeof ENRICH_REVIEW_FIELDS)[number]['key']

// 编译期对齐：中枢多/少一个字段，这里先炸，而不是审核界面静默漏一行
type _KeysMatch = EnrichReviewKey extends keyof HubEnrichmentFields
  ? keyof HubEnrichmentFields extends EnrichReviewKey
    ? true
    : never
  : never
const _keysMatch: _KeysMatch = true
void _keysMatch

/** 与 packages/core/deterministic-favicon.ts 的黑名单保持一致（web 侧不能 runtime 依赖 core） */
const THIRD_PARTY_ICON_HOSTS = ['icon.horse', 'favicon.cc', 'yandex.st', 'favicon.yandex.net']
const THIRD_PARTY_ICON_PATHS = ['https://www.google.com/s2/favicons', 'https://icons.duckduckgo.com/ip3/']

export function sanitizeReviewIconUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed)
    const host = u.hostname.toLowerCase()
    if (THIRD_PARTY_ICON_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`))) return null
    if (THIRD_PARTY_ICON_PATHS.some((p) => u.href.startsWith(p))) return null
  } catch {
    return null
  }
  return trimmed
}

export interface EnrichReviewRow {
  key: EnrichReviewKey
  label: string
  hint: string
  source: EnrichFieldSource
  value: string | string[] | null
  available: boolean
  /** 不可用时的原因（直接展示给运营） */
  reason: string | null
}

function valueOf(fields: HubEnrichmentFields, key: EnrichReviewKey): string | string[] | null {
  const field = fields[key]
  if (Array.isArray(field.value)) return field.value.map((v) => String(v).trim()).filter(Boolean)
  if (typeof field.value !== 'string') return field.value
  return field.value.trim()
}

export function buildEnrichReviewRows(fields: HubEnrichmentFields): EnrichReviewRow[] {
  return ENRICH_REVIEW_FIELDS.map((meta) => {
    const field = fields[meta.key]
    const value = valueOf(fields, meta.key)
    let available = true
    let reason: string | null = null

    if (field.source === 'missing') {
      available = false
      reason = field.note ?? '没有拿到内容'
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        available = false
        reason = field.note ?? '没有可用的值'
      }
    } else if (!value) {
      available = false
      reason = field.note ?? '没有可用的值'
    }

    if (meta.key === 'icon' && available && typeof value === 'string' && !sanitizeReviewIconUrl(value)) {
      // 值本身拿到了，但指向第三方图标服务：不是 missing，也不是可落库的值
      available = false
      reason = '第三方图标服务地址，按规范不落库'
    }

    return {
      key: meta.key,
      label: meta.label,
      hint: meta.hint,
      source: field.source,
      value,
      available,
      reason,
    }
  })
}

export type EnrichSelection = Partial<Record<EnrichReviewKey, boolean>>

/** 默认勾选：只有「有值且可落库」的字段才勾 */
export function defaultEnrichSelection(rows: readonly EnrichReviewRow[]): EnrichSelection {
  const selection: EnrichSelection = {}
  for (const row of rows) selection[row.key] = row.available
  return selection
}

export interface ReviewedSiteInput {
  url: string
  fields: HubEnrichmentFields
  selected: EnrichSelection
  categoryId: string
  /** 人工改写的标题；非空时优先于富化标题 */
  titleOverride?: string
}

export interface ReviewedSiteDraftInput {
  url: string
  title: string
  categoryId: string
  description?: string
  tags?: string[]
  iconKey?: string
}

export type BuildDraftResult =
  | { ok: true; draft: ReviewedSiteDraftInput; notes: string[] }
  | { ok: false; error: string }

/**
 * 把勾选结果落成建站载荷。
 *
 * 失败只有两种：没有标题（必填）或没有选类目（REST 必填）。
 * 其余字段「勾了但没值」按未勾处理，并把原因放进 notes——不阻断建站，
 * 但也不假装写入成功。
 */
export function buildReviewedSiteDraft(input: ReviewedSiteInput): BuildDraftResult {
  const notes: string[] = []
  const url = input.url.trim()
  if (!url) return { ok: false, error: '缺少站点地址' }

  const override = (input.titleOverride ?? '').trim()
  const titleField = input.fields.title
  let title = override
  if (!title && input.selected.title && titleField.source !== 'missing') {
    title = titleField.value.trim()
  }
  if (!title) {
    return { ok: false, error: '标题是必填项：请勾选富化标题，或手动填写标题' }
  }

  const categoryId = input.categoryId.trim()
  if (!categoryId) return { ok: false, error: '请选择站点要挂载的类目（站点只能挂叶子类目）' }

  const draft: ReviewedSiteDraftInput = { url, title, categoryId }

  if (input.selected.description) {
    const value = input.fields.description.value.trim()
    if (input.fields.description.source === 'missing' || !value) {
      notes.push('描述没有被采用：富化没有拿到描述')
    } else {
      draft.description = value
    }
  }

  if (input.selected.tags) {
    const raw = input.fields.tags.value
    if (input.fields.tags.source === 'missing' || raw.length === 0) {
      notes.push('标签没有被采用：富化没有给出标签')
    } else {
      const seen = new Set<string>()
      const tags: string[] = []
      for (const tag of raw) {
        const t = String(tag).trim()
        if (!t || seen.has(t)) continue
        seen.add(t)
        tags.push(t)
        if (tags.length >= 8) break
      }
      if (tags.length > 0) draft.tags = tags
    }
  }

  if (input.selected.icon) {
    const icon = sanitizeReviewIconUrl(input.fields.icon.value)
    if (icon) {
      draft.iconKey = icon
    } else {
      notes.push('图标没有被采用：地址缺失或属于第三方图标服务')
    }
  }

  // category 勾选不直接产生载荷：类目 id 由操作者选定，富化建议只是默认值。
  // 但若勾了而富化根本没给建议，说明勾选没有实际作用，如实提示。
  if (input.selected.category && input.fields.category.source === 'missing') {
    notes.push('类目建议没有被采用：富化没有给出类目建议')
  }

  return { ok: true, draft, notes }
}

export interface CategoryLite {
  id: string
  title: string
  titleEn?: string | null
  parentId?: string | null
}

/** 叶子类目 = 没有作为任何类目的 parent 出现过（站点只能挂叶子） */
export function leafCategories<T extends CategoryLite>(categories: readonly T[]): T[] {
  const parentIds = new Set(categories.map((c) => c.parentId).filter((id): id is string => Boolean(id)))
  return categories.filter((c) => !parentIds.has(c.id))
}

/**
 * 类目建议名的解析结果：
 *   unique     —— 站内恰好有同名（或英文名相同）的叶子类目，预选它；
 *   ambiguous  —— 多个同名，交给操作者选；
 *   none       —— 没有匹配，保持未选并提示。
 */
export type SuggestedCategoryMatch =
  | { kind: 'unique'; id: string; title: string }
  | { kind: 'ambiguous'; ids: string[] }
  | { kind: 'none' }

export function matchSuggestedCategory(
  suggestion: string,
  categories: readonly CategoryLite[],
): SuggestedCategoryMatch {
  const needle = suggestion.trim().toLowerCase()
  if (!needle) return { kind: 'none' }
  const leaves = leafCategories(categories)
  const hits = leaves.filter(
    (c) =>
      c.title.trim().toLowerCase() === needle ||
      (typeof c.titleEn === 'string' && c.titleEn.trim().toLowerCase() === needle),
  )
  if (hits.length === 1) return { kind: 'unique', id: hits[0]!.id, title: hits[0]!.title }
  if (hits.length > 1) return { kind: 'ambiguous', ids: hits.map((c) => c.id) }
  return { kind: 'none' }
}

export const SOURCE_BADGE: Record<EnrichFieldSource, { label: string; className: string }> = {
  llm: { label: '模型归纳', className: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30' },
  scraped: { label: '页面抓取', className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30' },
  heuristic: { label: '规则推测', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30' },
  missing: { label: '未获取', className: 'bg-muted text-muted-foreground border-border' },
}
