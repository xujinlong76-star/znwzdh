/**
 * 场景工作台过滤（纯函数，可单测）。
 *
 * 从 `navigation-content.tsx` 的 useMemo 里抽出：原来这段匹配逻辑内联在
 * 组件中，无法在没有 DOM 的情况下验证「AI 工作台到底该显示哪些站点」。
 * 抽成纯函数后，关键词表即契约，改动有测试兜底。
 */
import type { WorkspaceId } from '@/components/workspace-filter'

export type { WorkspaceId }

/**
 * 匹配逻辑只需要这四个字段的最小结构约束——不强求完整的 NavigationSubItem，
 * 纯函数与测试夹具都可以用最小数据形状（结构兼容即可）。
 */
export interface WorkspaceMatchable {
  title: string
  description?: string
  tags?: string[]
  workspaces?: string[]
}

/** 每个工作台的关键词表（命中标题/描述/标签即算匹配） */
export const WORKSPACE_KEYWORDS: Record<Exclude<WorkspaceId, 'all'>, string[]> = {
  ai: ['ai', '智能', 'gpt', '模型', 'claude', 'chat'],
  dev: ['代码', '开发', 'api', '部署', '容器', 'github', 'npm', 'docker'],
  design: ['设计', '图', 'ui', 'icon', '画', 'figma', 'unsplash'],
  efficiency: ['笔记', '协作', '工具', '文档', 'notion'],
}

/** 单个站点是否属于某个工作台 */
export function matchesWorkspace(item: WorkspaceMatchable, workspace: WorkspaceId): boolean {
  if (workspace === 'all') return true
  // 站点显式声明了工作台归属时优先（作者意图 > 关键词猜测）
  if (item.workspaces?.includes(workspace)) return true
  const text = `${item.title} ${item.description || ''} ${(item.tags || []).join(' ')}`.toLowerCase()
  return WORKSPACE_KEYWORDS[workspace].some((kw) => text.includes(kw))
}

/**
 * 按工作台过滤整棵导航树：保留命中项的二级分类，
 * 直接项与二级分类都空的分类整体移除（不再显示空壳）。
 */
export function filterNavigationByWorkspace<T extends { items?: WorkspaceMatchable[]; subCategories?: Array<{ items?: WorkspaceMatchable[] }> }>(
  items: T[],
  workspace: WorkspaceId,
): T[] {
  if (workspace === 'all') return items

  return items
    .map((category) => {
      const directItems = (category.items || []).filter((item) => matchesWorkspace(item, workspace))
      const subCats = (category.subCategories || [])
        .map((sub) => ({
          ...sub,
          items: (sub.items || []).filter((item) => matchesWorkspace(item, workspace)),
        }))
        .filter((sub) => (sub.items || []).length > 0)

      if (directItems.length === 0 && subCats.length === 0) return null
      return {
        ...category,
        items: directItems,
        subCategories: subCats,
      }
    })
    .filter(Boolean) as T[]
}
