/**
 * 视频库的统一写入入口：**读-改-写 + 乐观并发 + 冲突重放**。
 *
 * 为什么必须收口：videos.json 有四处写入（PUT /api/videos、单条增删改、
 * webhook 采集、自主采集）。它们此前都是「读整份 → 改内存 → 覆盖写」，
 * 存储层虽然已经支持 `ifVersion`（见 storage-adapter），但四处调用**一次都没传**，
 * 于是并发下是 last-write-wins：两个采集任务同时跑，后写的那份会把先写的条目
 * 静默抹掉——没有任何报错，只有「内容莫名其妙少了」。
 *
 * 这里的语义：
 *   1. 每轮重试都**重新读**最新数据（不是复用第一次的快照）；
 *   2. 用 `getStorageVersion` 拿到当前版本，写入时带 `ifVersion`；
 *   3. 版本冲突（409）不是错误，而是「有人比我快」——重放一次即可；
 *   4. 适配器不支持版本（github / sqlite 返回 null）时自动降级为无版本写入，
 *      与改造前行为一致，不会因为拿不到版本就写不进去。
 */
import { commitFile, getFileContent, getStorageVersion, readStorageFresh } from './github'
import { evaluateVideoShrink, isVersionConflict, isVideoShrinkBlock, VIDEO_SHRINK_KEEP_RATIO } from './video-write-guard'
import type { NavigationData, NavigationSubItem } from '@/types/navigation'

export const VIDEOS_FILE_PATH = 'src/navsphere/content/videos.json'

/** 替换/回滚记录独立存放：不再受 videos.json 里 `slice(0, 100)` 的硬截断约束 */
export const REPLACEMENTS_FILE_PATH = 'src/navsphere/content/video-replacements.json'

/** 一轮 mutate 的产出：写回的新数据 + 想返回给调用方的结果 */
export interface MutationPlan<T> {
  next: NavigationData
  result: T
  /** true = 这次不需要写（例如去重命中），直接返回 result */
  skip?: boolean
}

export type MutateOutcome<T> =
  | { ok: true; result: T; attempts: number }
  | { ok: false; conflict: true; attempts: number }

export { isVersionConflict } from './video-write-guard'

/** 计算视频库全库条目总数（包含直接条目与子分类条目） */
export function countVideoLibraryItems(data: NavigationData): number {
  return (data.navigationItems ?? []).reduce((acc, cat) => {
    const direct = cat.items?.length || 0
    const sub = (cat.subCategories || []).reduce((sAcc, sub) => sAcc + (sub.items?.length || 0), 0)
    return acc + direct + sub
  }, 0)
}

/** 读取视频库，并把结构收敛成「一定存在 navigationItems 数组」 */
export async function readVideoLibrary(options: { fresh?: boolean } = {}): Promise<NavigationData> {
  let raw: NavigationData | null = null
  if (options.fresh) {
    raw = await readStorageFresh<NavigationData>(VIDEOS_FILE_PATH).catch(() => {
      /* 实时读取失败时回退到默认缓存读取，避免整站崩溃 */
      return null
    })
  }
  if (!raw) {
    raw = ((await getFileContent(VIDEOS_FILE_PATH)) as NavigationData | null | undefined) ?? null
  }
  if (!raw || typeof raw !== 'object') return { navigationItems: [] }
  if (!Array.isArray(raw.navigationItems)) return { ...raw, navigationItems: [] }
  return raw
}

/**
 * 在视频库上执行一次带并发保护的变更。
 *
 * `mutate` 必须是**纯函数式**的：给它一份数据，它返回要写回的新数据。
 * 它会随重试被调用多次，所以不能在里面做副作用（发通知、写日志除外）。
 */
export async function mutateVideoLibrary<T>(
  mutate: (data: NavigationData) => MutationPlan<T> | Promise<MutationPlan<T>>,
  message: string,
  options: {
    token?: string
    maxAttempts?: number
    /**
     * 缩水保护的二阶段确认（与中枢同一套语义，两段都要、数字必须逐字相等）。
     *
     * 为什么本地也要一份判据：这道守卫在中枢，但本地守卫先抛就轮不到中枢说话。
     * 只放开「调用方明确声明了本次条数且与算出来的一致」这一种情形，
     * 传个 confirm=true 就想绕过，等于把守卫变成一个布尔开关。
     */
    confirmLargeDeletion?: boolean
    expectedCount?: number
  } = {},
): Promise<MutateOutcome<T>> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 写前必须读最新（fresh: true）：冲突意味着别人改过，复用旧快照只会再次冲突
    const data = await readVideoLibrary({ fresh: true })
    const version = await getStorageVersion(VIDEOS_FILE_PATH)
    const plan = await mutate(data)
    if (plan.skip) return { ok: true, result: plan.result, attempts: attempt }

    // 防破坏性数据丢失守卫：禁止将拥有丰富视频或分类的库抹平/截断
    const initialCount = countVideoLibraryItems(data)
    const nextCount = countVideoLibraryItems(plan.next)
    const shrinkConfirmed = options.confirmLargeDeletion === true && options.expectedCount === nextCount
    const shrink = evaluateVideoShrink(initialCount, nextCount)
    if (!shrinkConfirmed && shrink) {
      throw new Error(
        `[video-library-store] 变更被安全拦截：条目总数从 ${shrink.existingCount} 骤降至 ${shrink.incomingCount}，` +
          `低于下限 ${shrink.minimumAllowed}（存量的 ${Math.round(VIDEO_SHRINK_KEEP_RATIO * 100)}%），疑似分类或条目被意外抹除！` +
          `确实要这样删除时，带 confirmLargeDeletion=true 且 expectedCount=${nextCount} 重试`,
      )
    }
    const initialCats = data.navigationItems?.length || 0
    const nextCats = plan.next.navigationItems?.length || 0
    if (!shrinkConfirmed && initialCats > 0 && nextCats < initialCats) {
      throw new Error(`[video-library-store] 变更被安全拦截：分类数从 ${initialCats} 减少至 ${nextCats}！`)
    }

    try {
      await commitFile(
        VIDEOS_FILE_PATH,
        JSON.stringify(plan.next, null, 2),
        message,
        options.token,
        1, // 重试交给本函数（按「重读 + 重放」），commitFile 内部重试同一个版本必然失败
        version ?? undefined,
        options.confirmLargeDeletion === true
          ? { confirmLargeDeletion: true, expectedCount: options.expectedCount ?? nextCount }
          : undefined,
      )
      return { ok: true, result: plan.result, attempts: attempt }
    } catch (error) {
      // 缩水拦截（409）不是「有人比我快」：重放同一份内容只会再撞一次，
      // 直接把中枢给的文案抛出去，操作者才能看到「要带哪个 expectedCount」。
      if (isVideoShrinkBlock(error)) throw error
      const conflict = isVersionConflict(error)
      if (conflict && attempt < maxAttempts) continue
      if (conflict) return { ok: false, conflict: true, attempts: attempt }
      throw error
    }
  }

  return { ok: false, conflict: true, attempts: maxAttempts }
}

/** 把新记录并入替换历史（独立文件，容量不再与视频库耦合） */
export async function appendReplacementHistory(
  records: unknown[],
  options: { token?: string } = {},
): Promise<void> {
  if (records.length === 0) return
  for (let attempt = 1; attempt <= 3; attempt++) {
    // 独立历史文件可能还不存在（首次采集 / 刚升级）：读失败一律按「没有记录」处理，
    // 后面会以空数组为基底新建文件。吞掉异常是安全的，因为「读不到」与「空」在这里等价。
    const current = (await getFileContent(REPLACEMENTS_FILE_PATH).catch(() => { /* 见上：缺失即空 */ return null })) as
      | { records?: unknown[] }
      | unknown[]
      | null
    const existing = Array.isArray(current) ? current : Array.isArray(current?.records) ? current.records : []
    const version = await getStorageVersion(REPLACEMENTS_FILE_PATH)
    const merged = { version: 1, records: [...records, ...existing] }
    try {
      await commitFile(
        REPLACEMENTS_FILE_PATH,
        JSON.stringify(merged, null, 2),
        `[Video] Append ${records.length} replacement record(s)`,
        options.token,
        1,
        version ?? undefined,
      )
      return
    } catch (error) {
      if (isVersionConflict(error) && attempt < 3) continue
      throw error
    }
  }
}

/**
 * 读取替换历史：优先独立文件；旧库里的内联 `replacementHistory` 作为回退，
 * 保证升级瞬间管理端不会突然「历史清空」。
 */
export async function readReplacementHistory(): Promise<unknown[]> {
  // 同上：历史文件缺失时返回空数组即可，读异常不代表数据损坏
  const external = (await getFileContent(REPLACEMENTS_FILE_PATH).catch(() => { /* 见上：缺失即空 */ return null })) as
    | { records?: unknown[] }
    | unknown[]
    | null
  const fromFile = Array.isArray(external) ? external : Array.isArray(external?.records) ? external.records : []
  if (fromFile.length > 0) return fromFile

  const data = await readVideoLibrary().catch(() => ({ navigationItems: [] }) as NavigationData)
  const inline = (data as { replacementHistory?: unknown[] }).replacementHistory
  return Array.isArray(inline) ? inline : []
}

/** 从视频库里按 externalId（bvid / videoId）找条目，供采集去重 */
export function findVideoByExternalId(data: NavigationData, externalId: string): NavigationSubItem | null {
  for (const category of data.navigationItems ?? []) {
    for (const item of category.items ?? []) {
      const config = item.videoConfig
      if (!config) continue
      if (config.bvid === externalId || config.videoId === externalId) return item
    }
    for (const sub of category.subCategories ?? []) {
      for (const item of sub.items ?? []) {
        const config = item.videoConfig
        if (!config) continue
        if (config.bvid === externalId || config.videoId === externalId) return item
      }
    }
  }
  return null
}
