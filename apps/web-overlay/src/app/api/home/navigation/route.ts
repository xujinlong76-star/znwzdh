import { NextResponse } from 'next/server'
import { getFileContent } from '@/lib/github'

// 2026-11-07 九维评审环境修复：本路由经 @/lib/github → @/lib/auth 引入 node:crypto，
// Next 16.4.2 的 Edge Runtime 不支持（Native module not found）；Next 16 已废弃 Edge，
// 官方建议改用 nodejs runtime。本路由只读 JSON，切到 nodejs 行为不变。
export const runtime = 'nodejs'

const NAVIGATION_PATH = 'src/navsphere/content/navigation.json'

export async function GET() {
  const startedAt = performance.now()
  try {
    const data = await getFileContent(NAVIGATION_PATH)
    const dur = Math.round((performance.now() - startedAt) * 10) / 10
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
        'Content-Type': 'application/json',
        'Server-Timing': `nav;dur=${dur}`,
      },
    })
  } catch (error) {
    console.error('Error in navigation API:', error)
    return NextResponse.json(
      { error: '获取导航数据失败' },
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      },
    )
  }
}
