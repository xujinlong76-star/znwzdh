import { NextResponse } from 'next/server'
import { getFileContent } from '@/lib/github'
import { loadNavigationCatalog, loadNavigationCategoryById } from '@/lib/navigation-catalog-read'
import { filterNavigationData, processNavigationData } from '@/lib/data-loader'

// 2026-11-07 九维评审环境修复：本路由经 @/lib/github → @/lib/auth 引入 node:crypto，
// Next 16.4.2 的 Edge Runtime 不支持（Native module not found）；Next 16 已废弃 Edge，
// 官方建议改用 nodejs runtime。本路由只读 JSON，切到 nodejs 行为不变。
export const runtime = 'nodejs'

const NAVIGATION_PATH = 'src/navsphere/content/navigation.json'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const categoryId = searchParams.get('category')

  // 单分类按需取数（首页 flight 分片，2026-11-26 perf/flight-shard-1126）：
  // 只返回该分类经首页同一套处理（process + filter）后的形态，与首页
  // navigationData.navigationItems 里的条目逐字等值；不存在返回 404。
  // 优先读 U-36 单分类分片（只读该分类的片，不碰整包）；分片不可用
  //（doc 模式 / 索引缺失 / 版本撕裂）时回落整包读再取该分类。
  if (categoryId) {
    try {
      let raw = (await loadNavigationCategoryById(categoryId))?.category ?? null
      if (!raw) {
        const whole = await loadNavigationCatalog()
        raw = whole.data.navigationItems.find((c) => c.id === categoryId) ?? null
      }
      if (!raw) {
        return NextResponse.json(
          { error: '分类不存在' },
          { status: 404, headers: JSON_HEADERS },
        )
      }
      const processed = filterNavigationData(
        processNavigationData({ navigationItems: [raw] }),
      )
      const category = processed.navigationItems[0]
      if (!category) {
        return NextResponse.json(
          { error: '分类不存在' },
          { status: 404, headers: JSON_HEADERS },
        )
      }
      return NextResponse.json(
        { category },
        {
          headers: {
            'Cache-Control': 's-maxage=60, stale-while-revalidate',
            ...JSON_HEADERS,
          },
        },
      )
    } catch (error) {
      console.error('Error in navigation category API:', error)
      return NextResponse.json(
        { error: '获取分类数据失败' },
        { status: 500, headers: JSON_HEADERS },
      )
    }
  }

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
