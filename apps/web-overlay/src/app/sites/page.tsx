import type { Metadata } from 'next'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { sitesPageDescription, sitesPageHref, sitesPageTitle, SitesDirectory, loadSitesPage } from './sites-directory'

/**
 * 全站站点目录第 1 页（`/sites`）。
 *
 * 为什么要有这一页：改版前 1013 个 `/site/{id}` 详情页**没有任何站内入链**
 * （首页卡片全是外链、页脚没有 `/site/`），点击深度是 ∞，等于 99.4% 的内容页是孤岛。
 * 这一页是成本最低的孤岛解法：一个页面、17 个分页、首页一条入口，
 * 就把全部详情页的点击深度降到 2，且首页卡片一张都不用改。
 *
 * 第 2 页起在 `./p/[n]/page.tsx`，取数与视图都在 `./sites-directory.tsx`。
 * 索引口径（页 1 可索引 / 页 ≥2 noindex,follow + 自指 canonical）写在那两个文件里。
 */

export const revalidate = 60

export async function generateMetadata(): Promise<Metadata> {
  const canonical = sitesPageHref(1)
  const title = sitesPageTitle(1)
  const description = sitesPageDescription(1)

  // 显式写 `title:` / `description:`（不用对象简写）：
  // test/route-titles.test.ts 靠正则识别标题来源，简写会被判定成「这个路由没有标题」。
  return {
    title: title,
    description: description,
    alternates: { canonical },
    // og:url 与 canonical 同值
    ...(await pageShareMetadata({ url: canonical, title, description })),
  }
}

export default async function SitesDirectoryPage() {
  const data = await loadSitesPage()
  return <SitesDirectory requested={1} data={data} />
}
