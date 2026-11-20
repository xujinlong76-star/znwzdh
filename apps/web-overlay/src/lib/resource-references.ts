/**
 * 资源引用扫描（navigation/site 内容里 icon/logo/favicon 对上传资源的引用）。
 *
 * 抽自 /api/resource/check-references 的内联扫描，并由 /api/resource 的 DELETE
 * 复用做**服务端强制**引用检查：此前引用检查只是前端删除前的预检（
 * admin/resources/page.tsx），直连 DELETE 可绕过、删出悬空引用（导航项 icon
 * 指向已删除资源，页面上图标静默 404）。UI 无「强制删除」语义（引用只作警告），
 * 服务端据此拒绝删除被引用的资源。
 */
import type { NavigationData } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'

export interface ResourceReference {
  type: string
  location: string
  title?: string
}

/** 扫描内容里的引用，返回 path → 引用列表（无引用的 path 也会出现，列表为空）。 */
export function findResourceReferences(
  navigationData: NavigationData | null,
  siteData: SiteConfig | null,
  resourcePaths: string[],
): Record<string, ResourceReference[]> {
  const references: Record<string, ResourceReference[]> = {}

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

  return references
}
