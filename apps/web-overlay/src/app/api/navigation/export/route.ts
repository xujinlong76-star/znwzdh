import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { getFileContent } from '@/lib/github'

export const runtime = 'nodejs'

/**
 * 命令面板「快速备份与数据导出」（spotlight-modal cmd-backup）的下载端点。
 * 历史上 window.open('/api/navigation/export') 被 [id] 动态路由当成 id='export'
 * 吞掉并返回 404——备份功能一直是死按钮。2026-11-25 补建专用静态路由
 * （静态段优先于动态段），导出整包导航文档为带日期的 JSON 快照。
 */
export async function GET() {
  try {
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return new Response(authCheck.error, { status: authCheck.status })
    }
    const data = await getFileContent('src/navsphere/content/navigation.json')
    const stamp = new Date().toISOString().slice(0, 10)
    const body = JSON.stringify(data, null, 2)
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="navhub-navigation-${stamp}.json"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('导出导航备份失败:', error)
    return NextResponse.json({ error: '导出导航备份失败', details: (error as Error).message }, { status: 500 })
  }
}
