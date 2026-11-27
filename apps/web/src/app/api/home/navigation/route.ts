import { NextResponse } from 'next/server'
import { getFileContent } from '@/lib/github'

// 2026-11-07 九维评审环境修复：本路由经 @/lib/github → @/lib/auth 引入 node:crypto，
// Next 16.4.2 的 Edge Runtime 不支持（Native module not found）；Next 16 已废弃 Edge，
// 官方建议改用 nodejs runtime。本路由只读 JSON，切到 nodejs 行为不变。
export const runtime = 'nodejs'

const NAVIGATION_PATH = 'src/navsphere/content/navigation.json'

export async function GET() {
  try {
    const data = await getFileContent(NAVIGATION_PATH)
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 's-maxage=60, stale-while-revalidate',
        'Content-Type': 'application/json'
      }
    })
  } catch (error) {
    console.error('Error in navigation API:', error)
    return NextResponse.json(
      { error: '获取导航数据失败' },
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    )
  }
}