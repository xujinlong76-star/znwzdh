import { NextResponse } from 'next/server'
import { getFileContent } from '@/lib/github'
import { requireAdmin } from '@/lib/admin-guard'
import { NavigationCategory, NavigationItem, NavigationData } from '@/types/navigation'
// nodejs：requireAdmin 走服务端会话校验，edge 下的模块实例不共享，鉴权状态不可靠
export const runtime = 'nodejs'

export async function GET() {
  // 此前完全无鉴权：任何人可直接拉取站内统计（分类/站点/健康数据）
  const guard = await requireAdmin()
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status })
  }
  try {
    // 动态读取最新的导航数据，而不是静态导入
    const navigationData = await getFileContent('src/navsphere/content/navigation.json') as NavigationData
    const navigationItems = navigationData.navigationItems || []

    // 计算一级分类数量
    const parentCategories = navigationItems.length
    console.log('Parent categories:', parentCategories)

    // 计算二级分类数量
    const subCategories = navigationItems.reduce((total: number, category: NavigationItem) => {
      return total + (category.subCategories?.length || 0)
    }, 0)

    // 计算总分类数量
    const totalCategories = parentCategories + subCategories

    // 计算站点总数
    const totalSites = navigationItems.reduce((total: number, category: NavigationItem) => {
      // 一级分类的站点
      const parentSites = category.items?.length || 0

      // 二级分类的站点
      const subCategoriesSites = Array.isArray(category.subCategories)
        ? (category.subCategories as NavigationCategory[]).reduce((sum, subCategory) => {
          return sum + (subCategory.items?.length || 0);
        }, 0)
        : 0;

      return total + parentSites + subCategoriesSites
    }, 0)

    const result = {
      parentCategories,
      subCategories,
      totalCategories,
      totalSites
    }

    console.log('Sending stats:', result)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to fetch stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    )
  }
} 