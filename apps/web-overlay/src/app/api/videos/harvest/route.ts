import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { runVideoHarvestAndRotation } from '@/lib/video-harvester'
import { getFileContent } from '@/lib/github'
import { videoMetricsSnapshot } from '@/lib/video-harvest-metrics'
import type { NavigationData } from '@/types/navigation'

export const runtime = 'nodejs'

const VIDEOS_FILE_PATH = 'src/navsphere/content/videos.json'

export async function GET() {
  try {
    // 概览含各分类的采集策略（keywords / maxItems）与运行期计数，属运营数据
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return new Response(authCheck.error, { status: authCheck.status })
    }

    const data = (await getFileContent(VIDEOS_FILE_PATH)) as NavigationData
    const categories = data.navigationItems || []

    let totalVideos = 0
    let autoHarvestCategories = 0
    let totalScore = 0
    let scoreCount = 0
    let outdatedCount = 0

    const categoryStats = categories.map(cat => {
      const items = cat.items || []
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
      /**
       * 运行期计数（进程内累计）。
       *
       * 上面那些是「库的静态快照」，回答不了「今天采集跑了几次、失败几次、
       * 有多少关键词被风控挡了、探活里多少条不可判定」。这些量只在这里能看到。
       * 多副本部署时各实例独立计数（不做跨实例汇总）。
       */
      runtime: videoMetricsSnapshot(),
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
      return new Response(authCheck.error, { status: authCheck.status })
    }

    const body = await request.json()
    const { dryRun = false, categoryId, forceKeywords } = body

    const report = await runVideoHarvestAndRotation({
      dryRun,
      categoryId,
      forceKeywords,
      accessToken: authCheck.githubToken || undefined
    })

    return NextResponse.json({ success: true, report })
  } catch (error) {
    console.error('Failed to run video harvest and rotation:', error)
    return NextResponse.json(
      {
        error: '自动采集与轮换执行失败',
        details: (error as Error).message
      },
      { status: 500 }
    )
  }
}
