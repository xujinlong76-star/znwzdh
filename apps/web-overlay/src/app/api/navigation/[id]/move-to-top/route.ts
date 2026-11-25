import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { commitFile, getFileContent } from '@/lib/github'
import type { NavigationData } from '@/types/navigation'

export const runtime = 'nodejs'

/**
 * 把指定导航分类移到首/末位（管理端 NavigationCard 的「置顶 / 置底」按钮）。
 * 历史上前端调用的 /api/navigation/[id]/move-to-top|bottom 从未注册（404 死按钮），
 * 2026-11-25 补建。与 reorder 共用同一存储层，按 id 定位而不是数组下标——
 * 前端 filteredItems 的下标与全量 navigationItems 下标不同，不能复用 sourceIndex。
 */
async function move(request: Request, args: { params: Promise<{ id: string }> }, to: 'top' | 'bottom') {
  try {
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return new Response(authCheck.error, { status: authCheck.status })
    }
    const { id } = await args.params
    const data = await getFileContent('src/navsphere/content/navigation.json') as NavigationData
    if (!Array.isArray(data.navigationItems)) {
      return NextResponse.json({ error: '无效的导航数据' }, { status: 500 })
    }
    const index = data.navigationItems.findIndex((item) => item.id === id)
    if (index < 0) {
      return NextResponse.json({ error: '未找到要移动的导航项' }, { status: 404 })
    }
    if ((to === 'top' && index === 0) || (to === 'bottom' && index === data.navigationItems.length - 1)) {
      return NextResponse.json(data.navigationItems, { status: 200 })
    }
    const updated = [...data.navigationItems]
    const [moved] = updated.splice(index, 1)
    updated.splice(to === 'top' ? 0 : updated.length, 0, moved)
    data.navigationItems = updated
    await commitFile(
      'src/navsphere/content/navigation.json',
      JSON.stringify(data, null, 2),
      `${to === 'top' ? '置顶' : '置底'}导航项 ${id} - ${new Date().toISOString()}`,
      authCheck.githubToken || undefined,
    )
    return NextResponse.json(updated, { status: 200 })
  } catch (error) {
    console.error('移动导航项失败:', error)
    return NextResponse.json({ error: '移动导航项失败', details: (error as Error).message }, { status: 500 })
  }
}



export async function POST(request: Request, args: { params: Promise<{ id: string }> }) {
  return move(request, args, 'top')
}
