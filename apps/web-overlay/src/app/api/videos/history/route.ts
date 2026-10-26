import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { getFileContent } from '@/lib/github'
import { rollbackReplacement } from '@/lib/video-harvester'
import type { NavigationData } from '@/types/navigation'

export const runtime = 'nodejs'

const VIDEOS_FILE_PATH = 'src/navsphere/content/videos.json'

export async function GET() {
  try {
    const data = (await getFileContent(VIDEOS_FILE_PATH)) as NavigationData
    return NextResponse.json({
      history: data.replacementHistory || []
    })
  } catch (error) {
    console.error('Failed to get replacement history:', error)
    return NextResponse.json(
      {
        error: '获取替换历史失败',
        details: (error as Error).message
      },
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
    const { action, recordId } = body

    if (action === 'rollback' && recordId) {
      const res = await rollbackReplacement(recordId, authCheck.githubToken || undefined)
      return NextResponse.json(res)
    }

    return NextResponse.json({ error: '无效的操作指令' }, { status: 400 })
  } catch (error) {
    console.error('Failed to execute history action:', error)
    return NextResponse.json(
      {
        error: '操作执行失败',
        details: (error as Error).message
      },
      { status: 500 }
    )
  }
}
