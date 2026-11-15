/**
 * ⌘K 面板里的「我的场景」匹配（纯函数）。
 *
 * 命中规则：查询含「场景/scene」列出全部场景；否则按场景名子串匹配
 * （搜「工作」出现「工作」场景）。空查询 / 单字查询不匹配。
 * 执行不在这里：search-palette 按 sceneId 分发到共用的切换执行。
 */
import type { UserScene } from './user-scenes'

export interface ScenePaletteItem {
  key: string
  sceneId: string
  title: string
  description: string
  isActive: boolean
}

const SCENE_CATCH_ALL = ['场景', 'scene', '我的场景', '切换场景']

export function matchScenePaletteActions(
  query: string,
  scenes: Pick<UserScene, 'id' | 'name' | 'pinnedSiteIds' | 'theme'>[],
  activeSceneId: string | null,
): ScenePaletteItem[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const catchAll = SCENE_CATCH_ALL.some((k) => q.includes(k.toLowerCase()))
  const matched = catchAll
    ? scenes
    : scenes.filter((s) => s.name.toLowerCase().includes(q))
  return matched.map((s) => ({
    key: s.id,
    sceneId: s.id,
    title: `切换到场景「${s.name}」`,
    description: `置顶 ${s.pinnedSiteIds.length} 个站点 · ${s.theme.skinName ?? '系统默认皮肤'}${s.theme.mode === 'dark' ? ' · 深色' : s.theme.mode === 'light' ? ' · 浅色' : ''}`,
    isActive: s.id === activeSceneId,
  }))
}
