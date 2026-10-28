import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { runVideoHarvestAndRotation } from '@/lib/video-harvester'
import { getFileContent, readStorageFresh } from '@/lib/github'
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
      return new Response(authCheck.error, { status: authCheck.status })
    }

    const read = await readDocResilient<NavigationData>({
      fresh: () => readStorageFresh<NavigationData>(VIDEOS_FILE_PATH),
      cached: () => getFileContent(VIDEOS_FILE_PATH) as Promise<NavigationData>,
    })

    // 两层都失败才报错，且是 503 + retryable，不是 500：
    // 这不是代码 bug，是存储后端暂时不可达，客户端重试即可。
    if (!read.data) {
      return NextResponse.json(
        {
          success: false,
          error: '读取视频库失败：存储后端不可达',
          details: read.errors,
          retryable: true,
        },
        { status: 503 },
      )
    }

    const data = read.data
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
      dataSource: read.source,
      ...(read.errors.length > 0 ? { readErrors: read.errors } : {}),
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

    let body: Record<string, any> = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
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
        success: false,
        error: '自动采集与轮换执行失败',
        details: (error as Error).message
      },
      { status: 500 }
    )
  }
}
