import { NextResponse } from 'next/server'
import { commitFile, getFileContent } from '@/lib/github'
import { sweepVideoHealth } from '@/lib/video-deadlink-sweeper'
import { requireCronSecret } from '@/lib/cron-auth'
import { recordSweepRun } from '@/lib/video-harvest-metrics'
import type { NavigationData } from '@/types/navigation'

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
    const rawData = (await getFileContent(VIDEOS_FILE_PATH)) as NavigationData
    if (!rawData || !Array.isArray(rawData.navigationItems)) {
      return NextResponse.json({ error: 'Failed to read video library' }, { status: 500 })
    }

    const { report, updatedData } = await sweepVideoHealth(rawData, {
      maxItemsToCheck,
      timeoutMs,
      autoPrune,
    })

    // 写的是 updatedData：历史实现写回 rawData，prune 结果与 healthStatus 落不了盘。
    const shouldPersist = report.brokenCount > 0 || (report.prunedCount ?? 0) > 0
    if (!dryRun && shouldPersist) {
      await commitFile(
        VIDEOS_FILE_PATH,
        JSON.stringify(updatedData, null, 2),
        `chore(video): health sweep — ${report.healthyCount} healthy / ${report.brokenCount} dead / ${report.unverifiedCount ?? 0} unverified`
      )
    }

    return NextResponse.json({
      success: true,
      report,
      dryRun,
      persisted: !dryRun && shouldPersist,
    }, { status: 200 })
  } catch (error: any) {
    recordSweepRun({ ok: false, error: error?.message || 'health sweep failed' })
    return NextResponse.json({
      error: error?.message || 'Video health sweep execution failed',
      retryable: true,
    }, { status: 500 })
  }
}
