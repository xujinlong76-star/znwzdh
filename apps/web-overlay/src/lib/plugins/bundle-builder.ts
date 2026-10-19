/**
 * 组合包（bundle）作者拼装助手 —— 发布向导「成员选择器」专用纯函数。
 *
 * 与核心 `plugin-manifest` 的 F4 契约保持一致：
 *   - 成员仅限 site-pack / search-pack / theme 三类；
 *   - 不支持嵌套组合包，也不支持 workspace-preset；
 *   - 数量上限 `PLUGIN_LIMITS.maxBundleItems`，slug 去重，禁止自引用。
 *
 * 这里只做「输入编排」层面的即时反馈；最终仍以 `/api/plugins/validate`
 * 的服务端预检为准（同一份核心校验逻辑，双保险）。
 */
import { PLUGIN_LIMITS } from './plugin-manifest'

export const BUNDLE_MEMBER_KINDS = ['site-pack', 'search-pack', 'theme'] as const
export type BundleMemberKind = (typeof BUNDLE_MEMBER_KINDS)[number]

/** 成员类型的中文展示名（选择器徽标 / 筛选条共用） */
export const BUNDLE_KIND_LABELS: Record<BundleMemberKind, string> = {
  'site-pack': '网址包',
  'search-pack': '搜索引擎包',
  theme: '主题',
}

export function isBundleMemberKind(kind: unknown): kind is BundleMemberKind {
  return typeof kind === 'string' && (BUNDLE_MEMBER_KINDS as readonly string[]).includes(kind)
}

export interface BundleSelectionItem {
  slug: string
  kind: BundleMemberKind
}

/** 候选成员的最小字段集（`HubPluginItem` 结构子集） */
export interface BundleCandidateLike {
  slug: string
  kind: string
  name?: string | null
  description?: string | null
  installCount?: number
  starCount?: number
  ratingAvg?: number | null
}

export interface BundleCandidate {
  slug: string
  kind: BundleMemberKind
  name?: string | null
  description?: string | null
  installCount?: number
  starCount?: number
  ratingAvg?: number | null
}

/** 判断候选能否加入成员列表；返回 null 表示可加入，否则为拒绝原因 */
export function bundleMemberRejectReason(
  current: BundleSelectionItem[],
  candidate: { slug: string; kind: string },
  opts: { selfSlug?: string | null } = {},
): string | null {
  if (!isBundleMemberKind(candidate.kind)) {
    return '组合包成员仅限「网址包 / 搜索引擎包 / 主题」，不支持嵌套组合包与工作台预设'
  }
  if (opts.selfSlug && candidate.slug === opts.selfSlug) {
    return '组合包不能引用自身'
  }
  if (current.some((item) => item.slug === candidate.slug)) {
    return '该插件已在成员列表中'
  }
  if (current.length >= PLUGIN_LIMITS.maxBundleItems) {
    return `成员数量已达上限（最多 ${PLUGIN_LIMITS.maxBundleItems} 个）`
  }
  return null
}

/** 切换候选选中状态：已选则移除；未选则校验后加入。返回新列表与可能的拒绝原因。 */
export function toggleBundleMember(
  current: BundleSelectionItem[],
  candidate: { slug: string; kind: string },
  opts: { selfSlug?: string | null } = {},
): { items: BundleSelectionItem[]; error: string | null } {
  if (current.some((item) => item.slug === candidate.slug)) {
    return { items: current.filter((item) => item.slug !== candidate.slug), error: null }
  }
  const error = bundleMemberRejectReason(current, candidate, opts)
  if (error) return { items: current, error }
  return {
    items: [...current, { slug: candidate.slug, kind: candidate.kind as BundleMemberKind }],
    error: null,
  }
}

/** 合并多批候选（按类型分批拉取后使用）：去重、剔除非法类型，按安装量降序、名称升序 */
export function mergeBundleCandidates(groups: BundleCandidateLike[][]): BundleCandidate[] {
  const bySlug = new Map<string, BundleCandidate>()
  for (const group of groups) {
    for (const raw of group) {
      const slug = typeof raw?.slug === 'string' ? raw.slug.trim() : ''
      if (!slug || !isBundleMemberKind(raw?.kind) || bySlug.has(slug)) continue
      bySlug.set(slug, {
        slug,
        kind: raw.kind,
        name: typeof raw.name === 'string' ? raw.name : null,
        description: typeof raw.description === 'string' ? raw.description : null,
        installCount: typeof raw.installCount === 'number' ? raw.installCount : 0,
        starCount: typeof raw.starCount === 'number' ? raw.starCount : 0,
        ratingAvg: typeof raw.ratingAvg === 'number' ? raw.ratingAvg : null,
      })
    }
  }
  return [...bySlug.values()].sort(
    (a, b) =>
      (b.installCount ?? 0) - (a.installCount ?? 0) ||
      (a.name ?? a.slug).localeCompare(b.name ?? b.slug, 'zh-Hans-CN'),
  )
}

/** 按关键词与类型过滤候选（关键词命中名称 / slug / 描述，忽略大小写） */
export function filterBundleCandidates(
  candidates: BundleCandidate[],
  opts: { query?: string; kind?: BundleMemberKind | 'all' } = {},
): BundleCandidate[] {
  const query = (opts.query ?? '').trim().toLowerCase()
  return candidates.filter((candidate) => {
    if (opts.kind && opts.kind !== 'all' && candidate.kind !== opts.kind) return false
    if (!query) return true
    const haystack = `${candidate.name ?? ''} ${candidate.slug} ${candidate.description ?? ''}`.toLowerCase()
    return haystack.includes(query)
  })
}

/** 从 payload JSON 文本解析成员列表（非法 / 重复 / 超限条目丢弃并计入 dropped，供 UI 提示） */
export function parseBundleSelection(payloadJson: string): {
  items: BundleSelectionItem[]
  dropped: number
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(payloadJson)
  } catch {
    return { items: [], dropped: 0 }
  }
  const rawItems =
    parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : []
  const items: BundleSelectionItem[] = []
  let dropped = 0
  for (const raw of rawItems) {
    const record = raw && typeof raw === 'object' ? (raw as { slug?: unknown; kind?: unknown }) : null
    const slug = record && typeof record.slug === 'string' ? record.slug.trim() : ''
    const kind = record?.kind
    if (
      !slug ||
      !isBundleMemberKind(kind) ||
      items.some((item) => item.slug === slug) ||
      items.length >= PLUGIN_LIMITS.maxBundleItems
    ) {
      dropped += 1
      continue
    }
    items.push({ slug, kind })
  }
  return { items, dropped }
}

/** 生成组合包 payload JSON 文本（保留选择顺序，两空格缩进） */
export function bundlePayloadJson(items: BundleSelectionItem[]): string {
  return JSON.stringify({ items }, null, 2)
}
