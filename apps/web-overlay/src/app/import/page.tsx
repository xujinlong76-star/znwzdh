import type { Metadata } from 'next'
import { BookmarkImporter } from '@/components/bookmark-importer'
import { Footer } from '@/components/footer'
import { getFileContentWithStatus } from '@/lib/github'
import { loadCategories } from '@/lib/server/categories'
import {
  buildPublicIndex,
  collectHrefs,
  type CategoryNode,
} from '@/lib/import-workbench'

export const metadata: Metadata = {
  title: '浏览器书签一键导入',
  description: '一次解析 HTML 书签、Markdown、OneTab 与 JSON，本地完成隐私脱敏、公共库去重与自动归类，再分流到个人收藏或公共导航库。',
  robots: { index: false, follow: true },
}

/**
 * 与首页同源的实时导航树（ISR 60s）。
 *
 * 公共库去重索引在服务端算好，只把「规范化指纹数组」传给浏览器：
 * 目录 JSON 约 2MB，指纹数组约 200KB；后者既省带宽，也避免把整站目录
 * 暴露给一个只用得上 URL 集合的页面。降级标记跟着数据一起下发，
 * 中枢不可读时页面会明说「去重未生效」，不会拿构建期基线冒充全量库。
 */
export const revalidate = 60

const NAVIGATION_PATH = 'src/navsphere/content/navigation.json'

export default async function ImportPage() {
  const [navResult, categoryResult] = await Promise.all([
    // 两者任一失败都只降级为「无数据」：导入页的本职是本地解析书签文件，
    // 站点/分类数据缺失只会让「归类建议」少一档，不该整页 500。
    // 两者任一失败都只降级为「无数据」：导入页的本职是本地解析书签文件，
    // 站点/分类数据缺失只会让「归类建议」少一档，不该整页 500。
    getFileContentWithStatus(NAVIGATION_PATH).catch(() => {
      /* 取数失败按无导航数据处理，见上 */
      return null
    }),
    loadCategories().catch(() => {
      /* 取数失败按无分类数据处理，见上 */
      return null
    }),
  ])

  const navigation = navResult?.data ?? null
  const index = buildPublicIndex(navigation)
  const categories: CategoryNode[] = (categoryResult ?? [])
    .filter((c) => Boolean(c.id))
    .map((c) => ({
      id: c.id,
      slug: String(c.slug ?? c.id),
      title: c.title,
      parentId: c.parentId ?? null,
      enabled: c.enabled ?? true,
    }))

  return (
    <div className="flex flex-col min-h-screen">
      <main id="main-content" className="flex-1">
        <BookmarkImporter
          publicIndex={index.fingerprints}
          publicSampleUrls={collectHrefs(navigation, 8)}
          publicSiteCount={index.siteCount}
          categories={categories}
          indexReady={navResult !== null && !navResult.degraded}
        />
      </main>
      <Footer />
    </div>
  )
}
