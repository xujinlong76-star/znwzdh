import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/cron-auth'
import {
  runHealthSweepPage,
  runHealthSweepToCompletion,
} from '@/lib/video-health-sweep-service'

export const runtime = 'nodejs'

/**
 * 视频健康巡检 Cron 端点（薄入口：鉴权 + 参数解析，执行在
 * `@/lib/video-health-sweep-service`，与管理端手动触发、进程内定时调度
 * 共用同一份实现）。
 *
 * 接入方式：
 * 1. 进程内定时调度（默认）：服务启动时 `video-health-scheduler` 按
 *    `VIDEO_HEALTH_SWEEP_INTERVAL_MS`（默认 6h）自动跑，不需要外部 cron；
 * 2. Vercel Cron / GitHub Actions / 宿主机 crontab：按间隔调本端点；
 * 3. 管理端手动触发：`/api/videos/health-sweep`（管理员会话鉴权）。
 *
 * 分页与断点续扫：
 * - 默认只扫一页（`limit` = 每页条数，默认 100，上限 500），响应带
 *   `nextCursor` + `coverage`；把 `nextCursor` 原样传回 `?cursor=` 可续扫。
 * - `?full=1`：循环扫页直到全库完成或 `maxRunMs` 预算到点；到点即停，
 *   断点已写检查点，下次调用（不带 cursor）自动从断点续扫。
 * - 空库：直接返回全 0 的完成报告，不报错。
 */
const VIDEOS_FILE_PATH = 'src/navsphere/content/videos.json'

function clampInt(raw: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(raw) ? Math.min(max, Math.max(min, Math.floor(raw))) : fallback
}

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
  const rawLimit = searchParams.get('limit')
  const parsedLimit = rawLimit ? parseInt(rawLimit, 10) : 100
  const pageSize = clampInt(parsedLimit, 1, 500, 100)

  const rawTimeout = searchParams.get('timeout')
  const parsedTimeout = rawTimeout ? parseInt(rawTimeout, 10) : 3500
  const timeoutMs = clampInt(parsedTimeout, 500, 30000, 3500)
  /**
   * 自动删除默认关闭。
   *
   * 探活失败分三态（healthy / dead / unverified），只有「确认不存在」才进删除候选；
   * 超时与限流属不可判定。即使确认失效，也先进报告由人工/下一轮复核，不做单次即删。
   */
  const autoPrune = searchParams.get('autoPrune') === 'true'
  const force = searchParams.get('force') === '1'
  const cursor = searchParams.get('cursor') || null
  const full = searchParams.get('full') === '1'
  const rawMaxRunMs = searchParams.get('maxRunMs')
  const maxRunMs = rawMaxRunMs ? clampInt(parseInt(rawMaxRunMs, 10), 10_000, 600_000, 120_000) : 120_000

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
        scope: 'cron',
      })
      if (!result.success) {
        return NextResponse.json(
          { error: '已有巡检在跑，请稍后再试', retryable: true, runningScope: result.scope },
          { status: 409 },
        )
      }
      return NextResponse.json(
        {
          success: true,
          report: result.report,
          coverage: result.coverage,
          nextCursor: result.nextCursor,
          done: result.done,
          pages: result.pages,
          dryRun: result.dryRun,
          persisted: result.persisted,
          applied: result.applied,
        },
        { status: 200 },
      )
    }

    const result = await runHealthSweepPage({
      cursor,
      pageSize,
      timeoutMs,
      autoPrune,
      dryRun,
      force,
      resumeFromCheckpoint: !cursor,
      scope: 'cron',
    })
    if (!result.success) {
      return NextResponse.json(
        { error: '已有巡检在跑，请稍后再试', retryable: true, runningScope: result.scope },
        { status: 409 },
      )
    }
    return NextResponse.json(
      {
        success: true,
        report: result.report,
        coverage: result.coverage,
        nextCursor: result.nextCursor,
        done: result.done,
        dryRun: result.dryRun,
        persisted: result.persisted,
        applied: result.applied,
      },
      { status: 200 },
    )
  } catch (error: unknown) {
    // 内部异常细节只进日志；cron 调用方按 5xx + retryable 重试即可
    console.error(`[VideoHealthSweep] Execution failed (library: ${VIDEOS_FILE_PATH}):`, error)
    return NextResponse.json({
      error: 'Video health sweep execution failed',
      retryable: true,
    }, { status: 500 })
  }
}
