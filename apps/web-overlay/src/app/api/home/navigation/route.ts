import { NextResponse } from 'next/server'
import { loadNavigationCatalog } from '@/lib/navigation-catalog-read'

// 2026-11-07 九维评审环境修复：本路由经 @/lib/github → @/lib/auth 引入 node:crypto，
// Next 16.4.2 的 Edge Runtime 不支持（Native module not found）；Next 16 已废弃 Edge，
// 官方建议改用 nodejs runtime。本路由只读 JSON，切到 nodejs 行为不变。
export const runtime = 'nodejs'

// U-463：此前整包读 navigation.json（3.16MB）经 Next Data Cache——
// 单条目 2MB 上限写不进缓存，每次调用都重拉整包并在日志里留
// "items over 2MB can not be cached"。改读中枢派生的分片（U-36）：
// index + 按分类分片每片 ≤750KB，都能进 Data Cache；拼装结果在渲染
// 字段上与整包逐字等值（分片只丢渲染不消费的重字段），本路由的消费方
// （生态图谱 / 影院 / 追剧清单）只读渲染字段。分片不可用时
// loadNavigationCatalog 自动回落整包读（degraded），永不比现状差。
export async function GET() {
  try {
    const load = await loadNavigationCatalog()
    return NextResponse.json(load.data, {
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