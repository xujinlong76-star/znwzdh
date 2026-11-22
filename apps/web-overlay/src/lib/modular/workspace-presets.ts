/**
 * 工作台预设：侧栏按角色做类目级渐进式披露（2026-11-22）。
 *
 * ## 边界（SEO 硬边界）
 *
 * 本模块**只影响首页展示层**——侧栏分组的置顶 / 折叠 / 隐藏。
 * 它**不进入 SEO 目录页（/category）**，也**不参与全站检索**：
 * 两者都走独立的数据加载与全量索引，不能因为用户当前工作台而少收录站点。
 */
import type { WorkspaceId } from '@/components/workspace-filter'
export type { WorkspaceId }

/** 生活与娱乐泛类目（默认折叠、非短剧场景隐藏） */
export const LIFESTYLE_CATEGORY_IDS = [
  'reg-entertainment',
  'reg-consumer-life',
  'reg-public-services',
] as const

/** 短剧分类上下文（影音娱乐 / 短剧） */
export const DRAMA_CONTEXT_CATEGORY_IDS = [
  'reg-entertainment',
  'reg-short-drama',
] as const

export interface CategoryGroup {
  id: string
  label: string
  categoryIds: string[]
  collapsible?: boolean
}

/** 侧栏分组小标题：覆盖 navigation.json 的 14 个一级类目，不重不漏 */
export const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    id: 'creation',
    label: '创作与开发',
    categoryIds: [
      'reg-ai-tools',
      'reg-frontend-development',
      'reg-backend-and-cloud',
      'reg-devops-and-security',
      'reg-developer-resources',
      'reg-design-and-creative',
    ],
  },
  {
    id: 'work-growth',
    label: '工作与成长',
    categoryIds: [
      'reg-office-productivity',
      'reg-learning-growth',
      'reg-academic-research',
      'reg-news-and-media',
    ],
  },
  {
    id: 'life-entertainment',
    label: '生活与娱乐',
    collapsible: true,
    categoryIds: [...LIFESTYLE_CATEGORY_IDS],
  },
  { id: 'short-drama', label: '短剧', categoryIds: ['reg-short-drama'] },
]

export interface WorkspacePreset {
  featuredCategoryIds: string[]
  hiddenCategoryIds: string[]
  collapseLifestyleByDefault: boolean
  /** DIY customization 覆盖（基础预设 < customization） */
  customization?: Partial<WorkspacePreset>
}

export const WORKSPACE_PRESETS: Record<WorkspaceId, WorkspacePreset> = {
  all: { featuredCategoryIds: [], hiddenCategoryIds: [], collapseLifestyleByDefault: true },
  ai: {
    featuredCategoryIds: ['reg-ai-tools', 'reg-academic-research'],
    hiddenCategoryIds: [...LIFESTYLE_CATEGORY_IDS, 'reg-short-drama'],
    collapseLifestyleByDefault: true,
  },
  dev: {
    featuredCategoryIds: [
      'reg-frontend-development',
      'reg-backend-and-cloud',
      'reg-devops-and-security',
      'reg-developer-resources',
      'reg-ai-tools',
    ],
    hiddenCategoryIds: [...LIFESTYLE_CATEGORY_IDS],
    collapseLifestyleByDefault: true,
  },
  design: {
    featuredCategoryIds: ['reg-design-and-creative'],
    hiddenCategoryIds: [...LIFESTYLE_CATEGORY_IDS],
    collapseLifestyleByDefault: true,
  },
  efficiency: {
    featuredCategoryIds: ['reg-office-productivity'],
    hiddenCategoryIds: [...LIFESTYLE_CATEGORY_IDS],
    collapseLifestyleByDefault: true,
  },
}

export function resolveWorkspacePreset(workspace: WorkspaceId): WorkspacePreset {
  const base = WORKSPACE_PRESETS[workspace] ?? WORKSPACE_PRESETS.all
  const c = base.customization
  return {
    featuredCategoryIds: c?.featuredCategoryIds ?? base.featuredCategoryIds,
    hiddenCategoryIds: c?.hiddenCategoryIds ?? base.hiddenCategoryIds,
    collapseLifestyleByDefault: c?.collapseLifestyleByDefault ?? base.collapseLifestyleByDefault,
  }
}

export function normalizeWorkspaceId(value: unknown): WorkspaceId {
  const ids: WorkspaceId[] = ['all', 'dev', 'design', 'ai', 'efficiency']
  return typeof value === 'string' && (ids as string[]).includes(value) ? (value as WorkspaceId) : 'all'
}

export const DEFAULT_WORKSPACE_STORAGE_KEY = 'navhub.default-workspace.v1'
export const DRAMA_OPT_IN_STORAGE_KEY = 'navhub.drama-hotlist-optin.v1'

export function readDefaultWorkspace(storage: { getItem(k: string): string | null }): WorkspaceId {
  try {
    return normalizeWorkspaceId(storage.getItem(DEFAULT_WORKSPACE_STORAGE_KEY))
  } catch {
    return 'all'
  }
}

export function writeDefaultWorkspace(
  workspace: WorkspaceId,
  storage: { setItem(k: string, v: string): void },
): void {
  try {
    storage.setItem(DEFAULT_WORKSPACE_STORAGE_KEY, normalizeWorkspaceId(workspace))
  } catch {
    /* 隐私模式写失败静默 */
  }
}

export function readDramaHotlistOptIn(storage: { getItem(k: string): string | null }): boolean {
  try {
    return storage.getItem(DRAMA_OPT_IN_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeDramaHotlistOptIn(
  enabled: boolean,
  storage: { setItem(k: string, v: string): void; removeItem(k: string): void },
): void {
  try {
    if (enabled) storage.setItem(DRAMA_OPT_IN_STORAGE_KEY, '1')
    else storage.removeItem(DRAMA_OPT_IN_STORAGE_KEY)
  } catch {
    /* 隐私模式写失败静默 */
  }
}

export function isLifestyleCategory(id: string): boolean {
  return (LIFESTYLE_CATEGORY_IDS as readonly string[]).includes(id)
}

export function isDramaContextCategory(id: string): boolean {
  return (DRAMA_CONTEXT_CATEGORY_IDS as readonly string[]).includes(id)
}

export function dramaExposureAllowed(input: {
  inDramaCategoryContext: boolean
  diyOptIn: boolean
}): boolean {
  return input.diyOptIn || input.inDramaCategoryContext
}

/** 收集短剧上下文分类及其子类目锚点 id */
export function collectDramaContextSectionIds(
  categories: readonly { id: string; subCategories?: readonly { id: string }[] }[],
): Set<string> {
  const ids = new Set<string>()
  for (const c of categories) {
    if (!isDramaContextCategory(c.id)) continue
    ids.add(c.id)
    for (const sub of c.subCategories ?? []) ids.add(sub.id)
  }
  return ids
}

export interface SidebarGroupsResult {
  groups: CategoryGroup[]
  featuredCategoryIds: string[]
  collapsedGroupIds: string[]
}

/** 侧栏结构裁决：置顶区、分组区、默认折叠区 */
export function resolveSidebarGroups(
  categoryIds: readonly string[],
  workspace: WorkspaceId = 'all',
): SidebarGroupsResult {
  const preset = resolveWorkspacePreset(workspace)
  const hidden = new Set(preset.hiddenCategoryIds)
  const featured = preset.featuredCategoryIds.filter((id) => categoryIds.includes(id) && !hidden.has(id))
  const featuredSet = new Set(featured)
  const visible = categoryIds.filter((id) => !hidden.has(id) && !featuredSet.has(id))
  const grouped = new Set<string>()
  const groups: CategoryGroup[] = []
  const collapsedGroupIds: string[] = []

  for (const g of CATEGORY_GROUPS) {
    const ids = g.categoryIds.filter((id) => visible.includes(id))
    if (ids.length === 0) continue
    ids.forEach((id) => grouped.add(id))
    groups.push({ ...g, categoryIds: ids })
    if (g.collapsible && preset.collapseLifestyleByDefault) collapsedGroupIds.push(g.id)
  }
  // 未分组新类目兜底进「其它」
  const others = visible.filter((id) => !grouped.has(id))
  if (others.length > 0) groups.push({ id: 'other', label: '其它', categoryIds: others })

  return { groups, featuredCategoryIds: featured, collapsedGroupIds }
}

/** 主区首屏类目过滤（隐藏非核心类目） */
export function filterCategoriesForWorkspace<T extends { id: string }>(
  categories: readonly T[],
  workspace: WorkspaceId,
): T[] {
  const hidden = new Set(resolveWorkspacePreset(workspace).hiddenCategoryIds)
  return categories.filter((c) => !hidden.has(c.id))
}

/** SEO 目录页不使用场景过滤——守卫断言此边界存在 */
export const SEO_BOUNDARY_NOTE =
  'WORKSPACE_PRESETS 只影响首页侧栏展示层；SEO 目录与全站检索走独立全量数据。'
