import { NextResponse } from 'next/server'
import { runVideoHarvestAndRotation } from '@/lib/video-harvester'
import { sendHarvestWebhookNotification } from '@/lib/webhook-notifier'
import { requireCronSecret } from '@/lib/cron-auth'

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

  try {
    const report = await runVideoHarvestAndRotation({
      dryRun,
      categoryId
    })

    // 触发外部 Webhook 异步推送（不阻断当前响应）
    void sendHarvestWebhookNotification(report)

    return NextResponse.json({
      success: true,
      timestamp: Date.now(),
      report
    })
  } catch (error) {
    console.error('[CronVideoHarvest] Execution failed:', error)
    return NextResponse.json(
      {
        error: 'Cron harvest execution failed',
        details: (error as Error).message
      },
      { status: 500 }
    )
  }
}
