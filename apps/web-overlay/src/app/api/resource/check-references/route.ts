/**
 * 资源引用检查（后台「资源管理」删除资源前确认谁在引用它）。
 *
 * 本文件是 overlay 对上游底座同路径路由的覆写，修的是生产构建 bug：
 * 底座版本声明 `runtime = 'edge'`，却经 @/lib/github → @/lib/auth 传递性
 * 引用 node:crypto，`next build` 在 Collecting page data 阶段直接失败，
 * 逼得本地部署只能用 dev 模式跑。本路由要读会话、要走存储层，没有任何
 * edge 诉求，如实声明 nodejs（与同目录 ../route.ts 及 /api/health 同口径）。
 * 检查逻辑与底座原版一致（遍历 navigation.json 与 site.json 的
 * icon/logo/favicon 引用），仅多一道与兄弟路由相同的管理员会话校验：
 * 这是后台接口，原版无鉴权是缺口，顺手补上；后台页面同源带 cookie 调用，
 * 不受影响。
 */
import { NextResponse } from 'next/server'
import { getFileContent } from '@/lib/github'
import { verifyAdminSession } from '@/lib/auth'
import type { NavigationData } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return new Response(authCheck.error, { status: authCheck.status })
    }

    const { resourcePaths } = await request.json()

    if (!Array.isArray(resourcePaths)) {
      return NextResponse.json({ error: 'Invalid resource paths' }, { status: 400 })
    }

    const navigationData = (await getFileContent('src/navsphere/content/navigation.json')) as NavigationData
    const siteData = (await getFileContent('src/navsphere/content/site.json')) as SiteConfig

    const references: Record<string, Array<{ type: string; location: string; title?: string }>> = {}

    for (const resourcePath of resourcePaths) {
      references[resourcePath] = []

      if (navigationData?.navigationItems) {
        for (const navItem of navigationData.navigationItems) {
          if (navItem.icon === resourcePath) {
            references[resourcePath].push({
              type: 'navigation',
              location: `导航项: ${navItem.title}`,
              title: navItem.title,
            })
          }

          if (navItem.items) {
            for (const subItem of navItem.items) {
              if (subItem.icon === resourcePath) {
                references[resourcePath].push({
                  type: 'navigation',
                  location: `导航子项: ${navItem.title} > ${subItem.title}`,
                  title: subItem.title,
                })
              }
            }
          }

          if (navItem.subCategories) {
            for (const subCategory of navItem.subCategories) {
              if (subCategory.icon === resourcePath) {
                references[resourcePath].push({
                  type: 'navigation',
                  location: `导航分类: ${navItem.title} > ${subCategory.title}`,
                  title: subCategory.title,
                })
              }

              if (subCategory.items) {
                for (const item of subCategory.items) {
                  if (item.icon === resourcePath) {
                    references[resourcePath].push({
                      type: 'navigation',
                      location: `导航项: ${navItem.title} > ${subCategory.title} > ${item.title}`,
                      title: item.title,
                    })
                  }
                }
              }
            }
          }
        }
      }

      if (siteData?.appearance) {
        if (siteData.appearance.logo === resourcePath) {
          references[resourcePath].push({
            type: 'site',
            location: '站点Logo',
            title: '站点Logo',
          })
        }

        if (siteData.appearance.favicon === resourcePath) {
          references[resourcePath].push({
            type: 'site',
            location: '站点图标',
            title: '站点图标',
          })
        }
      }
    }

    return NextResponse.json({ references })
  } catch (error) {
    console.error('Failed to check resource references:', error)
    return NextResponse.json({ error: 'Failed to check resource references' }, { status: 500 })
  }
}
