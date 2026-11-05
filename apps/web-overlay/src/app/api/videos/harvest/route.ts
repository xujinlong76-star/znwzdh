import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { getFileContentWithStatus } from '@/lib/github'
import { videoMetricsSnapshot } from '@/lib/video-harvest-metrics'
import { hydrateVideoMetrics } from '@/lib/video-metrics-store'
import { readDocResilient } from '@/lib/video-doc-read'
import {
  runPolicyHarvest,
  clampPositiveInt,
  sanitizePlatforms,
} from '@/lib/video-harvest-service'
import { HarvestBusyError } from '@/lib/video-task-queue'
import { VideoShrinkBlockedError } from '@/lib/video-harvester'
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

    // 概览读数与「数据新鲜度」必须一起返回：degraded=true 说明这份统计来自
    // 进程内/数据缓存（中枢抖动时的兜底），运维不能拿它当实时数据做决策。
    const overview = await getFileContentWithStatus<NavigationData>(VIDEOS_FILE_PATH)
    const rawData = overview.data
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
       * 运维会拿一份过时数据做决策。
       */
      dataSource: overview.degraded ? 'cached' : 'fresh',
    })
  } catch (error) {
    // 错误细节只进服务端日志；客户端拿通用文案（内部异常信息不外泄）
    console.error('Failed to get harvest overview:', error)
    return NextResponse.json(
      {
        error: '获取视频采集概览失败'
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
    const { dryRun = false, categoryId, forceKeywords } = body

    /**
     * 互斥、指标与跨实例租约统一由服务层负责（与异步任务入口、cron 完全同一套）。
     *
     * 此前本端点自己拿进程内锁、cron 却完全不取锁——两个入口行为不一致，
     * cron 与手动任务可以并行跑两轮全量采集。现在三入口共用 `runPolicyHarvest`。
     *
     * TTL 给到 10 分钟：12 个分类 × 25s 预算的最坏情况是 300s，默认 5 分钟会
     * 在任务跑完前过期，互斥就失效了。
     */
    try {
      const report = await runPolicyHarvest({
        scope: 'harvest_sync',
        dryRun,
        categoryId,
        forceKeywords,
        platforms: sanitizePlatforms(platforms),
        // 钳制：每关键词条数接受任意大数字会打穿上游与时间预算（1..10）
        limitPerKeyword: clampPositiveInt(limitPerKeyword, 2, 10),
        accessToken: authCheck.githubToken || undefined
      })

      return NextResponse.json({ success: true, report })
    } catch (err) {
      if (err instanceof HarvestBusyError) {
        return NextResponse.json(
          {
            success: false,
            error: 'harvest_in_progress',
            message: err.message,
            retryable: true,
          },
          { status: 409 }
        )
      }
      throw err
    }
  } catch (error) {
    // 缩水保护拦截是给管理员的明确操作指引（带 expectedCount），如实透传；
    // 其余内部错误只进日志，客户端拿通用文案。
    if (error instanceof VideoShrinkBlockedError) {
      return NextResponse.json(
        {
          success: false,
          error: 'video_shrink_blocked',
          message: error.message,
        },
        { status: 409 }
      )
    }
    console.error('Failed to run video harvest and rotation:', error)
    return NextResponse.json(
      {
        success: false,
        error: '自动采集与轮换执行失败'
      },
      { status: 500 }
    )
  }
}
