import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { hubGet } from '@/lib/server/hub'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { CollectionBoard } from '@/components/collection-board'
import type { HubCollection } from '@/lib/navhub-api'

/**
 * 精选专题列表页（服务端取数 + 客户端岛渲染）。
 *
 * 为什么服务端化（Batch D，2026-10-21）：合集卡片的 `/collections/{slug}`
 * 内链必须进 **SSR HTML**。改版前整页是客户端组件、useEffect 取数，
 * link-graph 实测 4 个合集详情页 100% 孤岛（索引页的链接爬虫看不见）。
 * 现在服务端取数经 props 下发给 CollectionBoard 岛，首帧渲染即 SSR。
 *
 * revalidate=60：合集是低频变更的人工策划内容，爬虫面走 Data Cache
 * （与 /tags 家族同档，Phase 6a 口径）。hubGet 失败返回 null →
 * 交给客户端岛自动重取 + 降级提示（不阻塞渲染）。
 *
 * 面包屑用服务端 Breadcrumbs（带 BreadcrumbList JSON-LD）：本页已是
 * 服务端组件，不再需要客户端版 Trail——JSON-LD 与可见足迹同源进 SSR。
 */
export default async function CollectionsPage() {
  const cols = await hubGet<HubCollection[]>('/api/collections', 60)
  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-5 sm:space-y-6">
        <Breadcrumbs
          items={[
            { label: '首页', path: '/' },
            { label: '合集', path: '/collections' },
          ]}
        />
        <CollectionBoard initialCollections={cols} />
      </div>
      <Footer />
    </Container>
  )
}
