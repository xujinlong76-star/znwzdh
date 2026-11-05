import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { resolveVideoUrl } from '@/lib/video-harvester'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return NextResponse.json({ success: false, error: authCheck.error, message: authCheck.status === 401 ? '请先登录管理员账号' : '无权执行该操作' }, { status: authCheck.status })
    }

    const body = await request.json()
    const { url } = body

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: '请提供有效的视频链接' }, { status: 400 })
    }

    const resolved = await resolveVideoUrl(url)
    return NextResponse.json({ success: true, data: resolved })
  } catch (error) {
    console.error('Failed to resolve video URL:', error)
    return NextResponse.json(
      {
        error: '解析视频信息失败',
        details: (error as Error).message
      },
      { status: 500 }
    )
  }
}
