import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { readVideoLibrary } from '@/lib/video-library-store'
import type { NavigationData } from '@/types/navigation'
import {
  evaluateVideoWithAIModel,
} from '@/lib/video-autonomous-ai-harvester'
import { CURATED_TRENDING_TOPICS } from '@/lib/video-trending-harvester'
import { runAutonomousCycle, clampPositiveInt } from '@/lib/video-harvest-service'

export const runtime = 'nodejs'

const VIDEOS_FILE_PATH = 'src/navsphere/content/videos.json'

export async function GET() {
  try {
    // 候选池样本与统计属运营数据（会暴露未上架内容与评分），不能匿名开放。
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return NextResponse.json({ success: false, error: authCheck.error, message: authCheck.status === 401 ? '请先登录管理员账号' : '无权执行该操作' }, { status: authCheck.status })
    }

    const data = await readVideoLibrary()
    const categories = data.navigationItems || []

    let totalVideos = 0
    let aiScoredCount = 0
    let totalScore = 0

    categories.forEach(cat => {
      const allItems = [...(cat.items || []), ...(cat.subCategories || []).flatMap(s => s.items || [])]
      allItems.forEach(item => {
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
      return NextResponse.json({ success: false, error: authCheck.error, message: authCheck.status === 401 ? '请先登录管理员账号' : '无权执行该操作' }, { status: authCheck.status })
    }

    const body = await request.json().catch(() => ({}))
    const {
      dryRun = false,
      forceCategory,
      includeMultiPlatform = true,
      autoSubmitIndexNow = true,
      maxAdditionsPerCycle = 15,
    } = body

    // 单例 controller 由服务层持有（每次 new 会让「AI 思考过程」日志每轮从零开始）

    /**
     * 采集周期会读全库做去重与配额判断，写回是整包覆盖 —— 必须带版本号。
     * 「读 + 算 + 写」与租约锁统一收敛到服务层：此前本路由不取任何锁，并发
     * POST 会各跑一轮完整周期，只靠 ifVersion 冲突重放兜底（重放 = 重跑整轮）。
     * dryRun 与「本轮没新增」都不落盘（skip），但仍把 report 返回给管理端。
     *
     * maxAdditionsPerCycle 钳制在 1..50：此前接受任意大数字，等于把全局熔断
     * （newCourses >= maxAdditions）的闸门拆掉。
     */
    const outcome = await runAutonomousCycle({
      scope: 'ai_autonomous',
      dryRun: Boolean(dryRun),
      forceCategory: typeof forceCategory === 'string' ? forceCategory : undefined,
      includeMultiPlatform: Boolean(includeMultiPlatform),
      autoSubmitIndexNow: Boolean(autoSubmitIndexNow),
      maxAdditionsPerCycle: clampPositiveInt(maxAdditionsPerCycle, 15, 50),
    })

    if (!outcome.ok) {
      return NextResponse.json(
        { code: 409, success: false, message: '视频库正在被并发修改，请稍后重试', retryable: true },
        { status: 409 }
      )
    }

    return NextResponse.json({
      code: 0,
      success: true,
      data: {
        report: outcome.report,
      },
    })
  } catch (error) {
    console.error('Failed to run autonomous harvest cycle:', error)
    return NextResponse.json(
      {
        code: 500,
        message: '自主采集与 AI 模型审核循环执行异常',
        retryable: true,
      },
      { status: 500 }
    )
  }
}
