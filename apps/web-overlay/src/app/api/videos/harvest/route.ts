import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { runVideoHarvestAndRotation } from '@/lib/video-harvester'
import { getFileContent, readStorageFresh } from '@/lib/github'
import { videoTaskQueue } from '@/lib/video-task-queue'
import { videoMetricsSnapshot } from '@/lib/video-harvest-metrics'
import { readDocResilient } from '@/lib/video-doc-read'
import type { NavigationData, NavigationSubItem } from '@/types/navigation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VIDEOS_FILE_PATH = 'src/navsphere/content/videos.json'

export async function GET() {
  try {
    // 概览含各分类的采集策略（keywords / maxItems）与运行期计数，属运营数据
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return NextResponse.json({ success: false, error: authCheck.error, message: authCheck.status === 401 ? '请先登录管理员账号' : '无权执行该操作' }, { status: authCheck.status })
    }

    const rawData = (await getFileContent(VIDEOS_FILE_PATH)) as NavigationData | null | undefined
    if (!rawData || !rawData.navigationItems) {
      return NextResponse.json(
        {
          success: false,
          error: '读取视频库失败：视频数据为空或格式不正确',
          retryable: true,
        },
        { status: 503 },
      )
    }

    const data = rawData
    const categories = data.navigationItems || []

    let totalVideos = 0
    let autoHarvestCategories = 0
    let totalScore = 0
    let scoreCount = 0
    let outdatedCount = 0

    const categoryStats = categories.map(cat => {
      const directItems = cat.items || []
      const subItems = (cat.subCategories || []).flatMap(sub => sub.items || [])
      const items: NavigationSubItem[] = [...directItems, ...subItems]

      totalVideos += items.length
      if (cat.harvestPolicy?.enabled) {
        autoHarvestCategories++
      }

      for (const item of items) {
        const sc = item.videoConfig?.freshnessScore ?? 75
        totalScore += sc
        scoreCount++
        if (sc < 50) {
          outdatedCount++
        }
      }

      return {
        id: cat.id,
        title: cat.title,
        enabled: cat.enabled,
        videoCount: items.length,
        subCategoriesCount: (cat.subCategories || []).length,
        harvestPolicy: cat.harvestPolicy,
        averageScore: items.length > 0
          ? Math.round(items.reduce((sum, it) => sum + (it.videoConfig?.freshnessScore ?? 75), 0) / items.length)
          : 100
      }
    })

    return NextResponse.json({
      totalVideos,
      autoHarvestCategories,
      averageFreshness: scoreCount > 0 ? Math.round(totalScore / scoreCount) : 100,
      outdatedCount,
      historyCount: (data.replacementHistory || []).length,
      categories: categoryStats,
      runtime: videoMetricsSnapshot(),
      /**
       * 这份统计来自哪一层：`fresh`（直连中枢）/ `cached`（进程内或 Data Cache）。
       * 降级时必须让调用方看见 —— 否则「缓存里的旧数字」和「实时数字」长得一模一样，
       * 运维会拿一份过时数据做决策。`readErrors` 同时给出降级原因。
       */
      dataSource: 'cached',
    })
  } catch (error) {
    console.error('Failed to get harvest overview:', error)
    return NextResponse.json(
      {
        error: '获取视频采集概览失败',
        details: (error as Error).message
      },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return NextResponse.json({ success: false, error: authCheck.error, message: authCheck.status === 401 ? '请先登录管理员账号' : '无权执行该操作' }, { status: authCheck.status })
    }

    let body: Record<string, any> = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const { dryRun = false, categoryId, forceKeywords, platforms, limitPerKeyword } = body

    /**
     * 与异步任务入口共用同一把租约锁。
     *
     * 此前本端点直接跑采集、完全不取锁：手动点击与 Cron 撞车时，两边各自搜索、
     * 各自整包写，只能靠 `ifVersion` 冲突重放兜底 —— 而重放的代价是**重新发起
     * 全部网络搜索**（每轮 25s 预算），不是简单重试写入。
     *
     * TTL 给到 10 分钟：12 个分类 × 25s 预算的最坏情况是 300s，默认 5 分钟会
     * 在任务跑完前过期，互斥就失效了。
     */
    const lockOwner = `harvest_sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const lock = videoTaskQueue.acquireLock(lockOwner, 10 * 60 * 1000)
    if (!lock.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'harvest_in_progress',
          message: lock.error ?? '已有采集任务正在执行，请稍后重试',
          retryable: true,
        },
        { status: 409 }
      )
    }

    try {
      const report = await runVideoHarvestAndRotation({
        dryRun,
        categoryId,
        forceKeywords,
        platforms: Array.isArray(platforms) && platforms.length > 0 ? platforms : undefined,
        limitPerKeyword: typeof limitPerKeyword === 'number' ? limitPerKeyword : undefined,
        accessToken: authCheck.githubToken || undefined
      })

      return NextResponse.json({ success: true, report })
    } finally {
      // owner 必须与 acquire 时一致，否则锁只能等 TTL 自然过期
      videoTaskQueue.releaseLock(lockOwner)
    }
  } catch (error) {
    console.error('Failed to run video harvest and rotation:', error)
    return NextResponse.json(
      {
        success: false,
        error: '自动采集与轮换执行失败',
        details: (error as Error).message
      },
      { status: 500 }
    )
  }
}
