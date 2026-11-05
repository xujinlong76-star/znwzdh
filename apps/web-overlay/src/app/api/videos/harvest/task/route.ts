import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { videoTaskQueue, scheduleAndRunVideoHarvest, HarvestBusyError } from '@/lib/video-task-queue'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return NextResponse.json({ success: false, error: authCheck.error, message: authCheck.status === 401 ? '请先登录管理员账号' : '无权执行该操作' }, { status: authCheck.status })
    }

    // 进程重启后内存是空的：先把上一条快照懒加载回来，管理端才不会看到「没有任何任务」
    await videoTaskQueue.hydrate()

    const { searchParams } = new URL(request.url)
    const taskId = searchParams.get('taskId')

    if (taskId) {
      const task = videoTaskQueue.getTask(taskId)
      if (!task) {
        return NextResponse.json({ error: '任务不存在' }, { status: 404 })
      }
      return NextResponse.json({ task })
    }

    const activeTask = videoTaskQueue.getActiveTask()
    const recentTasks = videoTaskQueue.listRecentTasks(5)
    const lockStatus = videoTaskQueue.getLockStatus()

    return NextResponse.json({
      activeTask: activeTask || null,
      recentTasks,
      lock: lockStatus,
      /** 排队等待前置任务的任务数（排队语义引入后的可观测项） */
      queueDepth: videoTaskQueue.getQueueDepth()
    })
  } catch (error) {
    console.error('Failed to get harvest task status:', error)
    return NextResponse.json(
      { error: '获取任务状态失败' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return NextResponse.json({ success: false, error: authCheck.error, message: authCheck.status === 401 ? '请先登录管理员账号' : '无权执行该操作' }, { status: authCheck.status })
    }

    // 畸形 JSON 是客户端错误（400），此前会落进外层 catch 被伪装成 409「锁冲突」
    const body = await request.json().catch(() => {
      // 畸形 JSON 按缺参处理：返回 null 交给下方 400 分支如实回错
      return null
    })
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: '请求体必须是 JSON 对象' },
        { status: 400 }
      )
    }
    const { dryRun = false, categoryId, forceKeywords, trigger = 'admin', platforms } = body

    const { taskId, task, queued } = await scheduleAndRunVideoHarvest({
      dryRun: Boolean(dryRun),
      categoryId,
      forceKeywords,
      platforms,
      trigger,
      accessToken: authCheck.githubToken || undefined
    })

    return NextResponse.json({
      success: true,
      taskId,
      task,
      /** true = 锁被占，任务已排队，将在前置任务完成后自动开始 */
      queued
    })
  } catch (error) {
    // 忙碌（锁被占/队列满）才是 409；程序错误是 500——此前一刀切 409，
    // 监控无法区分「真的有任务在跑」和「调度器崩了」
    if (error instanceof HarvestBusyError) {
      return NextResponse.json(
        {
          success: false,
          error: error.code === 'queue_full' ? 'harvest_queue_full' : 'harvest_in_progress',
          message: error.message,
          retryable: true
        },
        { status: 409 }
      )
    }
    console.error('Failed to enqueue harvest task:', error)
    return NextResponse.json(
      { error: '启动采集长任务失败' },
      { status: 500 }
    )
  }
}
