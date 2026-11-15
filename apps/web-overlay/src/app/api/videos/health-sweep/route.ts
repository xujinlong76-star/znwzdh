import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { videoMetricsSnapshot } from '@/lib/video-harvest-metrics'
import { readHealthSweepCheckpoint } from '@/lib/video-metrics-store'
import {
  getHealthSweepRunStatus,
  runHealthSweepPage,
  runHealthSweepToCompletion,
} from '@/lib/video-health-sweep-service'
import {
  getVideoHealthSchedulerStatus,
  readVideoHealthScheduleConfig,
} from '@/lib/video-health-scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 视频健康巡检的管理端入口（管理员会话鉴权，不是 CRON_SECRET——
 * 浏览器里不能放 cron 密钥）。
 *
 * - GET：巡检状态总览——调度器（是否启动/间隔/下次运行/上次结果）、
 *   断点检查点（本轮扫到哪、是否已完成）、运行期累计、本轮生效配置。
 *   只读，不触发巡检。
 * - POST：手动触发。默认 `full: true`（循环扫页直到全库完成或 `maxRunMs`
 *   预算到点）；`full: false` 只扫一页。不带 `cursor` 时自动从检查点断点
 *   续扫。已有巡检在跑时返回 409（单飞互斥），不排队、不静默丢弃。
 */

function clampInt(raw: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(raw) ? Math.min(max, Math.max(min, Math.floor(raw))) : fallback
}

export async function GET() {
  const authCheck = await verifyAdminSession()
  if (!authCheck.ok) {
    return NextResponse.json({ success: false, error: authCheck.error, message: authCheck.status === 401 ? '请先登录管理员账号' : '无权执行该操作' }, { status: authCheck.status })
  }

  const checkpoint = await readHealthSweepCheckpoint()
  return NextResponse.json({
    success: true,
    scheduler: getVideoHealthSchedulerStatus(),
    run: getHealthSweepRunStatus(),
    checkpoint,
    metrics: videoMetricsSnapshot().sweep,
    config: readVideoHealthScheduleConfig(),
  })
}

export async function POST(request: Request) {
  const authCheck = await verifyAdminSession()
  if (!authCheck.ok) {
    return NextResponse.json({ success: false, error: authCheck.error, message: authCheck.status === 401 ? '请先登录管理员账号' : '无权执行该操作' }, { status: authCheck.status })
  }

  const body: unknown = await request.json().catch(() => ({}))
  const params = (body ?? {}) as Record<string, unknown>
  const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined)

  const pageSize = clampInt(num(params.pageSize) ?? 100, 1, 500, 100)
  const timeoutMs = clampInt(num(params.timeoutMs) ?? 3500, 500, 30000, 3500)
  const maxRunMs = clampInt(num(params.maxRunMs) ?? 120_000, 10_000, 600_000, 120_000)
  const cursor = typeof params.cursor === 'string' ? params.cursor : null
  const full = params.full !== false
  const dryRun = params.dryRun === true
  const autoPrune = params.autoPrune === true
  const force = params.force === true

  try {
    if (full) {
      const result = await runHealthSweepToCompletion({
        cursor,
        pageSize,
        timeoutMs,
        autoPrune,
        dryRun,
        force,
        maxRunMs,
        resumeFromCheckpoint: !cursor,
        scope: 'admin',
      })
      if (!result.success) {
        return NextResponse.json({ success: false, error: '已有巡检在跑，请稍后再试', runningScope: result.scope }, { status: 409 })
      }
      return NextResponse.json({
        success: true,
        report: result.report,
        coverage: result.coverage,
        nextCursor: result.nextCursor,
        done: result.done,
        pages: result.pages,
        dryRun: result.dryRun,
        persisted: result.persisted,
        applied: result.applied,
      })
    }

    const result = await runHealthSweepPage({
      cursor,
      pageSize,
      timeoutMs,
      autoPrune,
      dryRun,
      force,
      resumeFromCheckpoint: !cursor,
      scope: 'admin',
    })
    if (!result.success) {
      return NextResponse.json({ success: false, error: '已有巡检在跑，请稍后再试', runningScope: result.scope }, { status: 409 })
    }
    return NextResponse.json({
      success: true,
      report: result.report,
      coverage: result.coverage,
      nextCursor: result.nextCursor,
      done: result.done,
      dryRun: result.dryRun,
      persisted: result.persisted,
      applied: result.applied,
    })
  } catch (error: unknown) {
    console.error('[VideoHealthSweep] Admin trigger failed:', error)
    return NextResponse.json({ success: false, error: 'Video health sweep execution failed', retryable: true }, { status: 500 })
  }
}
