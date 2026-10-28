/**
 * 分面标注编辑的纯函数（/admin/facets 的站点卡片 → 编辑弹窗）。
 *
 * 为什么要把这些逻辑从页面里抽出来：
 *  - `PUT /api/sites/:id/facets` 是**整份重写**（存储层先 DELETE 再 INSERT），
 *    编辑器少提交一个维度就等于静默抹掉它。草稿必须携带站点的全部维度，
 *    包括不在受控词表里的历史值；
 *  - 单选维度（pricing.multiselect === false）点击语义是「替换/取消」，
 *    多选是「增删一个值」——两套语义混在 JSX 里最容易写出只增不减的 bug；
 *  - 中枢 400 的字段级原因有两种形态（zod 的 `detail[].path[]` 与自定义
 *    `issues[].path`），页面只负责渲染，解析放在这里可以单独回归。
 */

export interface FacetVocabularyOption {
  value: string
  label: string
  labelEn?: string
  description?: string
}

export interface FacetVocabulary {
  key: string
  label: string
  labelEn?: string
  description?: string
  multiselect?: boolean
  options: FacetVocabularyOption[]
}

/** 提交形状：`{ pricing: ["free"], platform: ["web", "ios"] }` */
export type FacetDraft = Record<string, string[]>

/** 与 services/siteConfigService 的 FieldIssue 同形（{path, message}），便于同一套字段级渲染 */
export interface FieldIssue {
  path: string
  message: string
}

function normalizeValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/**
 * 归一化成可比较的草稿：小写键/值、去重、丢弃空值、键与值都排序。
 *
 * 排序是为了 `sameFacets` 可以逐字比较 —— 服务端读回的顺序与编辑器的点击
 * 顺序本来就不该影响「有没有改动」的判断。
 */
export function canonicalFacets(raw: Record<string, readonly string[]> | null | undefined): FacetDraft {
  const collected: FacetDraft = {}
  for (const [rawKey, rawValues] of Object.entries(raw ?? {})) {
    const key = normalizeValue(rawKey)
    if (!key) continue
    const values = (Array.isArray(rawValues) ? rawValues : [])
      .map((value) => normalizeValue(value))
      .filter(Boolean)
    if (values.length === 0) continue
    collected[key] = [...new Set(values)].sort()
  }
  const out: FacetDraft = {}
  for (const key of Object.keys(collected).sort()) out[key] = collected[key]
  return out
}

/**
 * 点选一个候选值。
 *
 * - 单选维度：点未选中的值 = 用它替换当前值；点已选中的值 = 取消该维度；
 * - 多选维度：已选则移除，未选则追加。
 *
 * 空数组不会留在草稿里：它既不是合法的「已标注」，也会在提交时产生
 * 「删掉又插入 0 条」的无意义事务。
 */
export function toggleFacetValue(
  draft: FacetDraft,
  definition: Pick<FacetVocabulary, 'key' | 'multiselect'>,
  value: string,
): FacetDraft {
  const key = normalizeValue(definition.key)
  const normalized = normalizeValue(value)
  if (!key || !normalized) return draft

  const current = draft[key] ?? []
  let next: string[]
  if (definition.multiselect === false) {
    next = current.length === 1 && current[0] === normalized ? [] : [normalized]
  } else {
    next = current.includes(normalized)
      ? current.filter((item) => item !== normalized)
      : [...current, normalized].sort()
  }

  const out: FacetDraft = { ...draft }
  if (next.length === 0) delete out[key]
  else out[key] = next
  return canonicalFacets(out)
}

/** 移除单个值（历史值 chip 的 × 走这里），移除后维度为空则整键删除 */
export function removeFacetValue(draft: FacetDraft, key: string, value: string): FacetDraft {
  const normalizedKey = normalizeValue(key)
  const normalizedValue = normalizeValue(value)
  if (!normalizedKey || !normalizedValue) return draft
  const current = draft[normalizedKey]
  if (!current) return draft
  const next = current.filter((item) => item !== normalizedValue)
  const out: FacetDraft = { ...draft }
  if (next.length === 0) delete out[normalizedKey]
  else out[normalizedKey] = next
  return canonicalFacets(out)
}

/** 是否与初始标注一致（决定「保存」按钮是否可点） */
export function sameFacets(
  left: Record<string, readonly string[]> | null | undefined,
  right: Record<string, readonly string[]> | null | undefined,
): boolean {
  return JSON.stringify(canonicalFacets(left)) === JSON.stringify(canonicalFacets(right))
}

/**
 * 草稿里不在受控词表中的值。
 *
 * 这些值**必须**继续显示且可删：站点可能带着旧版自由值（例如 scene 由
 * workspaces 平滑注入的历史数据）。如果编辑器只渲染词表里的候选值，
 * 管理员点一次保存就会把它们整份抹掉，而且界面上完全看不出来。
 *
 * 返回结构按维度分组，值排序；`options` 为空的维度（词表里没有该键）
 * 会以整组历史值返回，由页面单独渲染。
 */
export function uncontrolledValues(
  draft: FacetDraft,
  definitions: FacetVocabulary[],
): Array<{ key: string; values: string[] }> {
  const known = new Map<string, Set<string>>()
  for (const definition of definitions) {
    known.set(
      normalizeValue(definition.key),
      new Set(definition.options.map((option) => normalizeValue(option.value))),
    )
  }
  const out: Array<{ key: string; values: string[] }> = []
  for (const key of Object.keys(canonicalFacets(draft)).sort()) {
    const allowed = known.get(key)
    const values = (draft[key] ?? []).filter((value) => !allowed || !allowed.has(normalizeValue(value)))
    if (values.length > 0) out.push({ key, values: [...values].sort() })
  }
  return out
}

/** 维度显示名：词表里没有该键时退回键名，避免出现空标签 */
export function facetLabel(definitions: FacetVocabulary[], key: string): string {
  const normalizedKey = normalizeValue(key)
  return definitions.find((definition) => normalizeValue(definition.key) === normalizedKey)?.label ?? key
}

/** 候选值显示名：历史值不在词表里时退回原值 */
export function facetOptionLabel(definitions: FacetVocabulary[], key: string, value: string): string {
  const normalizedKey = normalizeValue(key)
  const normalizedValue = normalizeValue(value)
  const definition = definitions.find((item) => normalizeValue(item.key) === normalizedKey)
  return definition?.options.find((option) => normalizeValue(option.value) === normalizedValue)?.label ?? value
}

/** 一次 400 最多展示这么多条字段级原因：再多也不是人能逐条处理的量 */
const MAX_FIELD_ISSUES = 6

/**
 * 从请求错误里取字段级原因。三种载体都认：
 *  - hubSend 的 zod 400：错误对象带 `payload.detail = [{ path: string[], message }]`
 *  - 自定义 400（如 /api/site）：`payload.issues = [{ path, message }]`
 *  - 调用方直接把 `issues` 挂在 error 上（SiteSettingsError）
 *
 * 取不到结构化原因时返回空数组，页面回退到整句错误消息 —— 绝不能
 * 把「没解析出来」渲染成「没有错误」。
 */
export function fieldIssuesOf(error: unknown): FieldIssue[] {
  if (!error || typeof error !== 'object') return []
  const carrier = error as { issues?: unknown; payload?: unknown }
  const payload =
    carrier.payload && typeof carrier.payload === 'object'
      ? (carrier.payload as Record<string, unknown>)
      : null
  const candidate = [payload?.detail, payload?.issues, carrier.issues].find(
    (value): value is unknown[] => Array.isArray(value) && value.length > 0,
  )
  if (!candidate) return []

  const issues: FieldIssue[] = []
  for (const entry of candidate) {
    if (!entry || typeof entry !== 'object') continue
    const message = (entry as { message?: unknown }).message
    if (typeof message !== 'string' || !message.trim()) continue
    const rawPath = (entry as { path?: unknown }).path
    const path = Array.isArray(rawPath)
      ? rawPath.map(String).filter(Boolean).join('.')
      : typeof rawPath === 'string'
        ? rawPath
        : ''
    issues.push({ path, message: message.trim() })
    if (issues.length >= MAX_FIELD_ISSUES) break
  }
  return issues
}
