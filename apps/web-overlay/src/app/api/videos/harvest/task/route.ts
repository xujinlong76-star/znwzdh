import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { videoTaskQueue, scheduleAndRunVideoHarvest } from '@/lib/video-task-queue'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return new Response(authCheck.error, { status: authCheck.status })
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
      lock: lockStatus
    })
  } catch (error) {
    console.error('Failed to get harvest task status:', error)
    return NextResponse.json(
      { error: '获取任务状态失败', details: (error as Error).message },
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

    const body = await request.json()
    const { dryRun = false, categoryId, forceKeywords, trigger = 'admin' } = body

    const { taskId, task } = await scheduleAndRunVideoHarvest({
      dryRun,
      categoryId,
      forceKeywords,
      trigger,
      accessToken: authCheck.githubToken || undefined
    })

    return NextResponse.json({
      success: true,
      taskId,
      task
    })
  } catch (error) {
    console.error('Failed to enqueue harvest task:', error)
    return NextResponse.json(
      { error: '启动采集长任务失败', details: (error as Error).message },
      { status: 409 }
    )
  }
}
