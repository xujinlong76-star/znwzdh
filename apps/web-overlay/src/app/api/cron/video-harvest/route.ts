import { NextResponse } from 'next/server'
import { runVideoHarvestAndRotation, type VideoHarvestReport } from '@/lib/video-harvester'
import { sendHarvestWebhookNotification } from '@/lib/webhook-notifier'
import { requireCronSecret } from '@/lib/cron-auth'
import { mutateVideoLibrary } from '@/lib/video-library-store'
import {
  getAutonomousHarvesterController,
  type AutonomousHarvestCycleReport,
} from '@/lib/video-autonomous-ai-harvester'
import { submitUrlsToIndexNow } from '@/lib/video-seo'
import { configuredSiteOrigin } from '@/lib/seo/origin'

export const runtime = 'nodejs'

/**
 * 定时自动化采集与过时内容轮换 Cron 端点
 *
 * 接入方式：
 * 1. Vercel Cron: 配置 vercel.json 自动定期唤起；
 * 2. GitHub Actions Scheduled Workflow: curl -H "Authorization: Bearer $CRON_SECRET" ...
 * 3. 宿主机 crontab / Linux 定时器。
 */
export async function GET(request: Request) {
  return handleCronTrigger(request)
}

export async function POST(request: Request) {
  return handleCronTrigger(request)
}

async function handleCronTrigger(request: Request) {
  const auth = requireCronSecret(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { searchParams } = new URL(request.url)
  const dryRun = searchParams.get('dryRun') === 'true'
  const categoryId = searchParams.get('categoryId') || undefined
  const mode = searchParams.get('mode') || 'hybrid' // 'hybrid' | 'policy' | 'autonomous'
  const autoIndexNow = searchParams.get('autoIndexNow') !== 'false'
  const siteOrigin = configuredSiteOrigin()

  let policyReport: VideoHarvestReport | null = null
  let autonomousReport: AutonomousHarvestCycleReport | null = null
  let totalIndexNowSubmitted = 0

  try {
    // 1. 策略型定向采集与保鲜轮换 (Bilibili / Dailymotion / PeerTube / TED / YouTube)
    if (mode === 'hybrid' || mode === 'policy') {
      policyReport = await runVideoHarvestAndRotation({
        dryRun,
        categoryId,
      })

      // 触发外部 Webhook 异步推送（不阻断响应）
      if (policyReport) {
        void sendHarvestWebhookNotification(policyReport)
      }
    }

    // 2. 自主型 AI 模型热点嗅探与跨平台全自动采集
    if (mode === 'hybrid' || mode === 'autonomous') {
      const controller = getAutonomousHarvesterController()
      const outcome = await mutateVideoLibrary(
        async (data) => {
          const { updatedData, report } = await controller.runCycle(data, {
            dryRun,
            forceCategory: categoryId,
            includeMultiPlatform: true,
            autoSubmitIndexNow: false, // 统一在下方集中做 IndexNow 提交
          })
          return {
            next: updatedData,
            result: { report },
            skip: dryRun || report.newCourses.length === 0,
          }
        },
        '[Cron AI Harvest] Automated autonomous harvest cycle'
      )

      if (outcome.ok) {
        autonomousReport = outcome.result.report
      }
    }

    // 3. 集中搜索引擎 IndexNow 主动提交
    if (!dryRun && autoIndexNow && siteOrigin) {
      const urlsToPing: string[] = [`${siteOrigin}/videos/sitemap.xml`]

      if (policyReport && policyReport.additions.length > 0) {
        for (const add of policyReport.additions) {
          urlsToPing.push(`${siteOrigin}/videos/v/${encodeURIComponent(add.item.id)}`)
        }
      }

      if (autonomousReport && autonomousReport.newCourses.length > 0) {
        for (const nc of autonomousReport.newCourses) {
          if (nc.landingUrl) urlsToPing.push(nc.landingUrl)
        }
      }

      if (urlsToPing.length > 1) {
        const pingResult = await submitUrlsToIndexNow(urlsToPing, { siteOrigin })
        totalIndexNowSubmitted = pingResult.submitted
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: Date.now(),
      mode,
      dryRun,
      indexNowSubmitted: totalIndexNowSubmitted,
      report: policyReport,
      autonomousReport,
    })
  } catch (error) {
    console.error('[CronVideoHarvest] Execution failed:', error)
    return NextResponse.json(
      {
        error: 'Cron harvest execution failed',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
}
