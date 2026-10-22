import type { Metadata } from 'next'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { categoryHref, isHiddenCategory } from '@/lib/seo/category-url'
import { MIN_SITES_FOR_INDEX } from '@/lib/seo/thresholds'
import {
  categoryDisplayName,
  loadActiveCategoryCounts,
  loadCategories,
  type HubCategory,
} from '@/lib/server/categories'

/**
 * 分类总览：132 条达标分类的入口页。
 *
 * 只列「存活站点 ≥ MIN_SITES_FOR_INDEX」的分类——分类详情页对未达标分类
 * 直接 notFound()（方案 §3.1），这里若照单全收会制造 462 条死链。
 * 计数口径与详情页一致：category_id ∪ sub_category_id（建站双指针）。
 */

export const revalidate = 3600

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: '分类总览',
    description: `按分类浏览全部站点。仅列出收录站点不少于 ${MIN_SITES_FOR_INDEX} 个的分类，避免薄内容空页。`,
    alternates: { canonical: '/category' },
    ...(await pageShareMetadata({
      url: '/category',
      title: '分类总览',
      description: `按分类浏览全部站点。仅列出收录站点不少于 ${MIN_SITES_FOR_INDEX} 个的分类，避免薄内容空页。`,
    })),
  }
}

export default async function CategoryIndexPage() {
  const [categories, counts] = await Promise.all([
    loadCategories(3600),
    loadActiveCategoryCounts(3600),
  ])

  const items: Array<{ category: HubCategory; count: number }> = []
  if (categories && counts) {
    for (const category of categories) {
      if (category.enabled === false) continue
      // 「未分类」是归类失败的兜底桶，不是可浏览入口：列进总览等于承认树有洞
      if (isHiddenCategory(category)) continue
      const count = counts.get(category.id) ?? 0
      if (count < MIN_SITES_FOR_INDEX) continue
      items.push({ category, count })
    }
    items.sort((a, b) => b.count - a.count || a.category.title.localeCompare(b.category.title, 'zh-CN'))
  }

  return (
    <>
      <Container as="main" id="main-content">
        <div className="py-6 sm:py-10 max-w-5xl mx-auto space-y-6">
          <Breadcrumbs
            items={[
              { label: '首页', path: '/' },
              { label: '分类总览', path: '/category' },
            ]}
          />
          <header className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              分类总览
            </h1>
            <p className="text-sm text-muted-foreground">
              {counts
                ? `共 ${items.length} 个分类收录了 ${MIN_SITES_FOR_INDEX} 个以上站点，点击查看各分类下的站点列表。`
                : '分类数据暂时不可用，请稍后重试。'}
            </p>
            <nav aria-label="站内目录" className="flex flex-wrap items-center gap-3 text-xs pt-1">
              <Link href="/sites" className="text-primary hover:underline">
                全部站点目录
              </Link>
              <span className="text-border" aria-hidden>
                ·
              </span>
              <Link href="/tags" className="text-primary hover:underline">
                按标签浏览
              </Link>
            </nav>
          </header>

          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无可展示的分类。</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {items.map(({ category, count }) => (
                <li key={category.id}>
                  <Link
                    href={categoryHref(category)}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2.5 hover:bg-muted/50 transition-colors"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground truncate">
                        {categoryDisplayName(category, categories ?? [])}
                      </span>
                      {category.description ? (
                        <span className="block text-xs text-muted-foreground truncate">
                          {category.description}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground shrink-0">{count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Container>
      <Footer />
    </>
  )
}
