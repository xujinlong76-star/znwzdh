import { NextResponse } from 'next/server'
import type { VideoHarvestReport } from '@/lib/video-harvester'
import { sendHarvestWebhookNotification } from '@/lib/webhook-notifier'
import { requireCronSecret } from '@/lib/cron-auth'
import {
  runPolicyHarvest,
  runAutonomousCycle,
  submitHarvestIndexNow,
} from '@/lib/video-harvest-service'
import { HarvestBusyError } from '@/lib/video-task-queue'
import { hydrateVideoMetrics } from '@/lib/video-metrics-store'
import type { AutonomousHarvestCycleReport } from '@/lib/video-autonomous-ai-harvester'
import { configuredSiteOrigin } from '@/lib/seo/origin'

export const runtime = 'nodejs'

/**
 * 定时自动化采集与过时内容轮换 Cron 端点
 *
 * 接入方式：
 * 1. Vercel Cron: 配置 vercel.json 自动定期唤起；
 * 2. GitHub Actions Scheduled Workflow: curl -H "Authorization: Bearer $CRON_SECRET" ...
 * 3. 宿主机 crontab / Linux 定时器。
 *
 * 升级说明：此前本路由是三个采集入口里唯一**不取租约锁**的——cron 与手动任务
 * 可以并行跑两轮全量采集，只靠 ifVersion 冲突重放兜底（重放 = 重跑全部上游搜索）。
 * 现在策略采集与自主采集统一走服务层（进程内租约 + 中枢 CAS 跨实例租约），
 * 与管理端入口行为完全一致。
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
    // 指标接上历史累计（进程重启后 run 计数从 0 重新开始的问题）
    await hydrateVideoMetrics()

    // 1. 策略型定向采集与保鲜轮换 (Bilibili / Dailymotion / PeerTube / TED / YouTube)
    if (mode === 'hybrid' || mode === 'policy') {
      policyReport = await runPolicyHarvest({
        scope: 'cron',
        dryRun,
        categoryId,
      })

      // 触发外部 Webhook 异步推送（不阻断响应）
      if (policyReport) {
        void sendHarvestWebhookNotification(policyReport)
      }
    }

    // 2. 自主型 AI 模型热点嗅探与跨平台全自动采集（与 cron 之外的管理端入口共用同一实现）
    if (mode === 'hybrid' || mode === 'autonomous') {
      const outcome = await runAutonomousCycle({
        scope: 'cron',
        dryRun,
        forceCategory: categoryId,
        includeMultiPlatform: true,
        autoSubmitIndexNow: false, // 统一在下方集中做 IndexNow 提交
      })
      if (outcome.ok && outcome.report) {
        autonomousReport = outcome.report
      }
    }

    // 3. 集中搜索引擎 IndexNow 主动提交（拼装逻辑与 seo-index 收敛到服务层）
    if (!dryRun && autoIndexNow && siteOrigin) {
      const pingResult = await submitHarvestIndexNow({ siteOrigin, policyReport, autonomousReport })
      totalIndexNowSubmitted = pingResult.submitted
      if (pingResult.error) {
        // 推送失败不影响采集结果，但必须可见（此前静默吞掉，与「没推」无法区分）
        console.warn('[CronVideoHarvest] IndexNow 提交失败:', pingResult.error)
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
    // cron 与手动任务撞锁时如实回 409（调度器会重试），其余是程序错误
    if (error instanceof HarvestBusyError) {
      return NextResponse.json(
        {
          error: 'harvest_in_progress',
          message: error.message,
          retryable: true,
        },
        { status: 409 }
      )
    }
    // 错误细节只进服务端日志；HTTP 响应不带内部异常信息
    console.error('[CronVideoHarvest] Execution failed:', error)
    return NextResponse.json(
      {
        error: 'Cron harvest execution failed',
      },
      { status: 500 }
    )
  }
}
