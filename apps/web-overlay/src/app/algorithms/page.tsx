import { Metadata } from 'next'
import { AlgorithmLab } from '@/components/algorithm-lab'
import { Footer } from '@/components/footer'
import { pageShareMetadata } from '@/lib/seo/metadata'

/**
 * 这一行不是性能设定，是**自愈设定**，删掉它会永久保留一份坏快照。
 *
 * 本路由曾是全仓 9 条 `revalidate=false` 静态路由里唯一进了 sitemap 的一条：
 * 构建期缺 `NAVHUB_SITE_URL` → metadataBase 缺席 → Next 用兜底值
 * `http://localhost:3000` 把 og:image 绝对化并烤进产物，而 `revalidate=false`
 * 意味着它永不重生成（实测三连 `x-nextjs-cache: HIT`，地址纹丝不动）。
 * 其余 6 个概览页都带 revalidate，同一个缺陷一个周期后就转成绝对地址自愈。
 * 内容以月计，3600s 足够；真正的约束是「收录页必须能自愈」。
 */
export const revalidate = 3600

/** 标题只写页面名，站点名由根 layout 的 title.template 追加（避免品牌名重复两次） */
export async function generateMetadata(): Promise<Metadata> {
  // 描述说人话（2026-11-11）：旧版堆 LinUCB/Poincaré 等术语，搜索用户零命中；
  // 页面是推荐与排序算法的交互演示，照实说即可。
  const title = '算法实验室 - 推荐与排序算法交互演示'
  const description =
    '交互式体验导航站背后的推荐、排序与相似度算法：亲手调一调参数，看站点为什么这样排序、平替推荐是怎么算出来的。'
  return {
    title,
    description,
    alternates: { canonical: '/algorithms' },
    ...(await pageShareMetadata({ url: '/algorithms', title, description })),
  }
}

export default function AlgorithmsPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <main id="main-content" className="flex-1">
        <AlgorithmLab />
      </main>
      <Footer />
    </div>
  )
}
