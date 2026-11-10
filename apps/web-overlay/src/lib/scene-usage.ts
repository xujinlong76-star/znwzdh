/**
 * AI 找站场景包的本地使用习惯（纯客户端，不回传服务端）。
 *
 * 首页场景区一次只展示一页（SCENE_PAGE_SIZE 个），「换一批」按页轮换；
 * 用户点开过的场景包计数只存浏览器 localStorage，下次打开时把他常用的
 * 排到前面并打「常用」标记。没有任何记录（冷启动）时就是默认精选顺序。
 * 所有行为数据只留在本机浏览器，服务端不接收、不统计。
 */

export const SCENE_USAGE_STORAGE_KEY = 'navhub.aiFinder.sceneUsage.v1'

/** 场景区一页展示几个：与首页首屏版式协调，24 个场景正好 4 页轮换 */
export const SCENE_PAGE_SIZE = 6

/** sceneId -> 点开次数 */
export type SceneUsage = Record<string, number>

interface SceneLike {
  id: string
}

function defaultStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** 解析存储里的原始值：坏数据一律当作无记录，不让本地脏数据把首页搞崩 */
export function parseSceneUsage(raw: string | null): SceneUsage {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const usage: SceneUsage = {}
    for (const [id, count] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
        usage[id] = Math.floor(count)
      }
    }
    return usage
  } catch {
    return {}
  }
}

export function loadSceneUsage(storage: Storage | null = defaultStorage()): SceneUsage {
  if (!storage) return {}
  try {
    return parseSceneUsage(storage.getItem(SCENE_USAGE_STORAGE_KEY))
  } catch {
    return {}
  }
}

/** 记一次点开：计数 +1 并落盘，返回更新后的计数表（落盘失败也不影响本次返回） */
export function recordSceneUse(id: string, storage: Storage | null = defaultStorage()): SceneUsage {
  const usage = loadSceneUsage(storage)
  usage[id] = (usage[id] ?? 0) + 1
  if (storage) {
    try {
      storage.setItem(SCENE_USAGE_STORAGE_KEY, JSON.stringify(usage))
    } catch {
      // 隐私模式/配额满时写不进去就算了，推荐退化为默认顺序，不报错
    }
  }
  return usage
}

/**
 * 按使用次数重排：点得多的排前面，次数相同（包括都没点过）保持默认精选顺序。
 * 不修改入参数组；计数表里有、列表里没有的 id 直接忽略。
 */
export function orderScenesByUsage<T extends SceneLike>(scenes: readonly T[], usage: SceneUsage): T[] {
  return scenes
    .map((scene, index) => ({ scene, index, count: usage[scene.id] ?? 0 }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map((entry) => entry.scene)
}

/** 从已排序列表里取一页：offset 环绕取模，末页不足时从头补齐，保证每页都满 SCENE_PAGE_SIZE 个（总数够时） */
export function scenePage<T>(ordered: readonly T[], offset: number, size: number = SCENE_PAGE_SIZE): T[] {
  const total = ordered.length
  if (total === 0 || size <= 0) return []
  if (total <= size) return [...ordered]
  const start = ((offset % total) + total) % total
  return Array.from({ length: size }, (_, i) => ordered[(start + i) % total] as T)
}

/** 「换一批」的下一页偏移：整页步进，24 个场景分 4 页时 0→6→12→18→0，相邻两页完全不重叠 */
export function nextSceneOffset(offset: number, total: number, size: number = SCENE_PAGE_SIZE): number {
  if (total <= size || size <= 0) return 0
  return (offset + size) % total
}
