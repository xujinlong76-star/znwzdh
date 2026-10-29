import { NextResponse } from 'next/server'
import { sweepVideoHealth } from '@/lib/video-deadlink-sweeper'
import { requireCronSecret } from '@/lib/cron-auth'
import { recordSweepRun } from '@/lib/video-harvest-metrics'
import { mutateVideoLibrary, readVideoLibrary } from '@/lib/video-library-store'
import type { NavigationData, NavigationSubItem, VideoConfig } from '@/types/navigation'

export const runtime = 'nodejs'

/**
 * 视频库路径。
 *
 * 历史实现写的是 `'data/navigation.json'` —— 全站其它 6 个视频路由都是
 * `src/navsphere/content/videos.json`。后果：巡检读到的是站点导航（里面没有
 * videoConfig），`totalScanned` 恒为 0，能力完全空转；一旦条件成立还会把
 * 整站导航覆盖成视频数据（中枢对 navigation.json 走的是 writeNavigationData）。
 */
const VIDEOS_FILE_PATH = 'src/navsphere/content/videos.json'

/** 单条条目需要回写的健康字段（其余字段一律以最新读到的数据为准） */
type HealthPatch = Partial<Pick<VideoConfig, 'healthStatus' | 'lastVerifiedAt' | 'failStreak'>>

function walkItems(
  data: NavigationData,
  visit: (item: NavigationSubItem, container: 'top' | 'sub') => void,
): void {
  for (const cat of data.navigationItems ?? []) {
    for (const item of cat.items ?? []) visit(item, 'top')
    for (const sub of cat.subCategories ?? []) {
      for (const item of sub.items ?? []) visit(item, 'sub')
    }
  }
}

function collectIds(data: NavigationData): Set<string> {
  const ids = new Set<string>()
  walkItems(data, (item) => ids.add(item.id))
  return ids
}

/**
 * 收集本轮**真正探测过**的条目的健康字段。
 *
 * 判据是 `lastVerifiedAt >= since`：`sweepVideoHealth` 对每个探测过的条目
 * （healthy / dead / unverified 三种状态）都会写这个时间戳，未探测到的条目
 * 保持原值。用时间戳而不是「状态是否变化」，是因为健康的条目状态可能本来就是
 * healthy —— 只看状态差异会漏掉它们的验证时间。
 */
function collectPatches(data: NavigationData, since: number): Map<string, HealthPatch> {
  const patches = new Map<string, HealthPatch>()
  walkItems(data, (item) => {
    const config = item.videoConfig
    if (!config) return
    if (typeof config.lastVerifiedAt !== 'number' || config.lastVerifiedAt < since) return
    patches.set(item.id, {
      healthStatus: config.healthStatus,
      lastVerifiedAt: config.lastVerifiedAt,
      failStreak: config.failStreak,
    })
  })
  return patches
}

/**
 * 把健康补丁与删除集合应用到**最新**数据上。
 *
 * 为什么不能直接写 `updatedData`：那是一份基于「探测开始时读到的快照」算出来的
 * 整包文档。巡检要跑几十秒，期间采集可能已经写入新条目；整包覆盖会把它们抹掉。
 * 这里只改三个健康字段 + 删除确认失效的条目，其余字段以最新读到的为准。
 */
function applyPatches(
  latest: NavigationData,
  patches: Map<string, HealthPatch>,
  prunedIds: Set<string>,
): { next: NavigationData; applied: number; removed: number } {
  let applied = 0
  let removed = 0

  const mapItems = (items?: NavigationSubItem[]): NavigationSubItem[] | undefined => {
    if (!items) return items
    const out: NavigationSubItem[] = []
    for (const item of items) {
      if (prunedIds.has(item.id)) {
        removed++
        continue
      }
      const patch = patches.get(item.id)
      if (!patch || !item.videoConfig) {
        out.push(item)
        continue
      }
      applied++
      out.push({
        ...item,
        videoConfig: {
          ...item.videoConfig,
          ...(patch.healthStatus !== undefined ? { healthStatus: patch.healthStatus } : {}),
          ...(patch.lastVerifiedAt !== undefined ? { lastVerifiedAt: patch.lastVerifiedAt } : {}),
          ...(patch.failStreak !== undefined ? { failStreak: patch.failStreak } : {}),
        },
      })
    }
    return out
  }

  const navigationItems = (latest.navigationItems ?? []).map((cat) => {
    const items = mapItems(cat.items)
    const subCategories = cat.subCategories?.map((sub) => {
      const subItems = mapItems(sub.items)
      return subItems === sub.items ? sub : { ...sub, items: subItems }
    })
    return { ...cat, ...(items ? { items } : {}), ...(subCategories ? { subCategories } : {}) }
  })

  return { next: { ...latest, navigationItems }, applied, removed }
}

export async function GET(request: Request) {
  return handleHealthSweep(request)
}

export async function POST(request: Request) {
  return handleHealthSweep(request)
}

async function handleHealthSweep(request: Request) {
  const auth = requireCronSecret(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { searchParams } = new URL(request.url)
  const dryRun = searchParams.get('dryRun') === 'true'
  const maxItemsToCheck = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 30
  const timeoutMs = searchParams.get('timeout') ? parseInt(searchParams.get('timeout')!, 10) : 3500
  /**
   * 自动删除默认关闭。
   *
   * 探活失败分三态（healthy / dead / unverified），只有「确认不存在」才进删除候选；
   * 超时与限流属不可判定。即使确认失效，也先进报告由人工/下一轮复核，不做单次即删。
   */
  const autoPrune = searchParams.get('autoPrune') === 'true'

  try {
    const snapshot = await readVideoLibrary()
    if (!Array.isArray(snapshot.navigationItems)) {
      return NextResponse.json({ error: 'Failed to read video library' }, { status: 500 })
    }

    // 探测起点：用于区分「本轮验证过」与「历史验证过」
    const sweepStartedAt = Date.now()
    const { report, updatedData } = await sweepVideoHealth(snapshot, {
      maxItemsToCheck,
      timeoutMs,
      autoPrune,
    })

    // 探测结果 → 健康补丁；autoPrune 时再算出被删掉的 id 集合
    const patches = collectPatches(snapshot, sweepStartedAt)
    const prunedIds = new Set<string>()
    if (autoPrune && (report.prunedCount ?? 0) > 0) {
      const before = collectIds(snapshot)
      const after = collectIds(updatedData)
      for (const id of before) if (!after.has(id)) prunedIds.add(id)
    }

    /**
     * 落盘条件：有状态变化才写。
     *
     * 只探测到「全是 healthy」时不写库 —— 那只会把 6MB 文档整包重写一遍，
     * 换来的仅是一批 lastVerifiedAt 时间戳。需要这些时间戳的场景（排查死链）
     * 应显式带 `?force=1` 触发。
     */
    const force = searchParams.get('force') === '1'
    const shouldPersist = force || report.brokenCount > 0 || (report.unverifiedCount ?? 0) > 0 || prunedIds.size > 0

    let persisted = false
    let applied = 0
    if (!dryRun && shouldPersist && (patches.size > 0 || prunedIds.size > 0)) {
      // 走统一写入入口：带 ifVersion，冲突时重读重放（只重放字段合并，不重跑探测）
      const outcome = await mutateVideoLibrary<{ applied: number; removed: number }>(
        (latest) => {
          const result = applyPatches(latest, patches, prunedIds)
          return {
            next: result.next,
            result: { applied: result.applied, removed: result.removed },
            // 补丁与最新数据完全对不上（条目已被并发删除）时不写
            skip: result.applied === 0 && result.removed === 0,
          }
        },
        `chore(video): health sweep — ${report.healthyCount} healthy / ${report.brokenCount} dead / ${report.unverifiedCount ?? 0} unverified`,
      )
      // skip 也返回 ok:true（补丁与最新数据完全对不上时），所以 persisted 要看实际改动数
      persisted = outcome.ok && (outcome.result.applied > 0 || outcome.result.removed > 0)
      applied = outcome.ok ? outcome.result.applied : 0
    }

    return NextResponse.json({
      success: true,
      report,
      dryRun,
      persisted,
      applied,
    }, { status: 200 })
  } catch (error: any) {
    recordSweepRun({ ok: false, error: error?.message || 'health sweep failed' })
    return NextResponse.json({
      error: error?.message || 'Video health sweep execution failed',
      retryable: true,
    }, { status: 500 })
  }
}
