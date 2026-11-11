import { cache } from 'react'
import { VideoContent } from '@/components/video-content'
import { Metadata } from 'next/types'
import { ScrollToTop } from '@/components/ScrollToTop'
import { getProcessedData } from '@/lib/data-loader'
import { getFileContent } from '@/lib/github'
import { loadVideoCatalog } from '@/lib/video-catalog-read'
import { withSignedVideoIcons } from '@/lib/media-proxy'
import { pageShareMetadata } from '@/lib/seo/metadata'
import type { NavigationData } from '@/types/navigation'

/**
 * NavHub 改动：数据改为从中枢异步读取（原为 import 构建期静态 JSON），
 * 使视频导航内容与站点配置都来自数据库；中枢不可用时回退到构建期基线。
 *
 * 为什么从 `force-dynamic` 改成 ISR（revalidate = 60）：
 *   - `getFileContent` 的读链路本来就带 Next Data Cache（`revalidateFromEnv`，默认 60s），
 *     `force-dynamic` 把这一层缓存整个废掉 —— 每个请求都要打一次中枢，
 *     而读到的东西最多只差 60 秒；
 *   - `/hot` 早就用的是 `revalidate = 60`，同类页面（内容由后台策划、`noindex`）
 *     没有理由一半 ISR 一半动态；
 *   - 元信息不会「固化在构建产物里」：`generateMetadata` 在每次再生成时都会重跑。
 *
 * 注意：这里的 60 与 `NAVHUB_STORAGE_REVALIDATE_S` 的默认值对齐。若把该环境变量
 * 设为 0（关掉数据缓存、要求后台改完立刻可见），页面仍会有 60s 的 ISR 窗口 ——
 * Next 要求 `revalidate` 是静态字面量，无法读环境变量。
 */
export const revalidate = 60

const SITE_PATH = 'src/navsphere/content/site.json'

/**
 * `generateMetadata` 与页面组件各调一次，用 React 的 `cache` 合并成**同一请求内一次读取**。
 * （Data Cache 命中时本来也不贵，但两条链路各自 await 会让首字节多等一轮微任务调度，
 * 且一旦适配器冷却降级，重复调用就是双倍失败重试。）
 *
 * 视频目录走 loadVideoCatalog（分片读）：videos.json 本体 7MB+ 超 Data Cache
 * 上限、只能 no-store 实时读，曾让本页 ISR 名存实亡；中枢写后派生的分类
 * 分片每片 ≤457KB 可正常进缓存，分片不可用时该模块自动回落整包读。
 */
const getData = cache(async () => {
  const [catalog, siteRaw] = await Promise.all([
    loadVideoCatalog(),
    getFileContent(SITE_PATH),
  ])
  const videosRaw = catalog.data
  const processed = getProcessedData(videosRaw as never, siteRaw as never)
  // 图片代理签名在服务端算好下发：客户端自己签会把 node:crypto 垫片打进首屏包
  return { ...processed, navigationData: withSignedVideoIcons(processed.navigationData) }
})

export async function generateMetadata(): Promise<Metadata> {
  const { siteData } = await getData()

  return {
    // 只写页面名：根 layout 的 title.template 会统一追加站点名
    title: '视频教程中心',
    // 点击行为是站内弹窗播放或无播放配置时直达原站，不是「进入站内播放页」
    description: '按分类浏览收录的视频教程与精品课程，支持站内弹窗播放或直达原站观看',
    alternates: { canonical: '/videos' },
    // 收录口径（2026-10-28 复核 + 2026-10-31 改判）：
    //   库里是**真实内容**——video_categories 12 个类目（带 harvest_policy）、
    //   video_items 5578 条（含 platform / external_id / duration_sec / quality_score）。
    //   原先判据「内容是占位、链接指向第三方视频站」都不成立，故改判为可索引；
    //   sitemap 静态清单（lib/seo/sitemap-entries.ts 的 STATIC_PATHS）与本行的
    //   robots 必须同口径，两边都已改，不留「一边 sitemap 一边 noindex」的打架状态。
    robots: { index: true, follow: true },
    ...(await pageShareMetadata({
      url: '/videos',
      title: '视频教程中心',
      description: '按分类浏览收录的视频教程与精品课程，支持站内弹窗播放或直达原站观看',
    })),
    keywords: 'Bilibili, YouTube, Videos',
    icons: {
      icon: siteData.appearance.favicon,
    },
  }
}

export default async function VideosPage() {
  const { navigationData, siteData } = await getData()

  // 首屏极致性能优化：保留全量分类树结构与精准 totalCount，
  // 仅在首屏下发各子方向前 10 部精选视频，将 Next.js 服务端 RSC 序列化流
  // 从 7.1MB 压缩到 ~220KB，将流式传输从 7 秒压降到毫秒级，实现秒开。
  const initialNavigationData: NavigationData = {
    ...navigationData,
    navigationItems: navigationData.navigationItems.map(category => {
      const catItems = category.items || []
      const subCats = category.subCategories || []
      const directTotal = catItems.length
      const subTotal = subCats.reduce((acc, s) => acc + (s.items?.length || 0), 0)
      const totalCount = directTotal + subTotal

      return {
        ...category,
        totalCount,
        items: catItems.slice(0, 10),
        subCategories: subCats.map(sub => ({
          ...sub,
          totalCount: (sub.items || []).length,
          items: (sub.items || []).slice(0, 10),
        })),
      }
    }),
  }

  return (
    <>
      <VideoContent navigationData={initialNavigationData} siteData={siteData} />
      <ScrollToTop />
    </>
  )
}
