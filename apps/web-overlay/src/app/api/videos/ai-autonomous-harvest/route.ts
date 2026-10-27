import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { getFileContent, commitFile } from '@/lib/github'
import type { NavigationData } from '@/types/navigation'
import {
  getAutonomousHarvesterController,
  evaluateVideoWithAIModel,
} from '@/lib/video-autonomous-ai-harvester'
import { CURATED_TRENDING_TOPICS } from '@/lib/video-trending-harvester'

export const runtime = 'nodejs'

const VIDEOS_FILE_PATH = 'src/navsphere/content/videos.json'

export async function GET() {
  try {
    // 候选池样本与统计属运营数据（会暴露未上架内容与评分），不能匿名开放。
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return new Response(authCheck.error, { status: authCheck.status })
    }

    const data = (await getFileContent(VIDEOS_FILE_PATH)) as NavigationData
    const categories = data.navigationItems || []

    let totalVideos = 0
    let aiScoredCount = 0
    let totalScore = 0

    categories.forEach(cat => {
      ;(cat.items || []).forEach(item => {
        totalVideos++
        const score = item.videoConfig?.qualityScore
        if (typeof score === 'number' && score > 0) {
          aiScoredCount++
          totalScore += score
        }
      })
    })

    const avgAiScore = aiScoredCount > 0 ? Math.round(totalScore / aiScoredCount) : 85

    return NextResponse.json({
      code: 0,
      data: {
        totalVideos,
        categoriesCount: categories.length,
        aiScoredCount,
        avgAiScore,
        candidatePoolSize: CURATED_TRENDING_TOPICS.length,
        sampleCandidates: CURATED_TRENDING_TOPICS.slice(0, 5).map(c => ({
          title: c.recommendedTitle,
          domain: c.domain,
          author: c.author,
          durationSec: c.durationSec,
          preEvaluation: evaluateVideoWithAIModel({
            title: c.recommendedTitle,
            durationSec: c.durationSec,
            author: c.author,
          }),
        })),
      },
    })
  } catch (error) {
    console.error('Failed to get autonomous harvest stats:', error)
    return NextResponse.json(
      {
        code: 500,
        message: '获取自主采集系统状态与统计失败',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    // 该接口会整包覆盖写视频库，历史上缺少鉴权（任意匿名 POST 即可写库）。
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return new Response(authCheck.error, { status: authCheck.status })
    }

    const body = await request.json().catch(() => ({}))
    const { dryRun = false, forceCategory } = body

    const currentData = (await getFileContent(VIDEOS_FILE_PATH)) as NavigationData
    // 单例：每次 new 会让 controller.logs（管理端的「AI 思考过程」）每轮从零开始
    const controller = getAutonomousHarvesterController()

    const { updatedData, report } = await controller.runCycle(currentData, {
      dryRun: Boolean(dryRun),
      forceCategory: typeof forceCategory === 'string' ? forceCategory : undefined,
    })

    if (!dryRun && report.newCourses.length > 0) {
      // 写失败必须让调用方知道：此前这里是 catch + console.warn 后继续返回 success，
      // 运营看到「处理成功」而库里没有内容。
      await commitFile(
        VIDEOS_FILE_PATH,
        JSON.stringify(updatedData, null, 2),
        `[AI Harvest] Autonomous harvest cycle added ${report.newCourses.length} courses`
      )
    }

    return NextResponse.json({
      code: 0,
      success: true,
      data: {
        report,
      },
    })
  } catch (error) {
    console.error('Failed to run autonomous harvest cycle:', error)
    return NextResponse.json(
      {
        code: 500,
        message: '自主采集与 AI 模型审核循环执行异常',
        details: (error as Error).message,
        retryable: true,
      },
      { status: 500 }
    )
  }
}
