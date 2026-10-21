import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { hubGet } from '@/lib/server/hub'
import type { HubSite } from '@/lib/navhub-api'
import { TagResultsBoard } from '@/components/tag-results-board'

/**
 * 标签结果页（服务端取数 + 客户端岛渲染）。
 *
 * 为什么服务端化：站点卡片标题的 `/site/{id}` 内链必须进 **SSR HTML**。
 * 改版前整页 useEffect 取数，爬虫首轮只看到骨架屏。现在服务端取数经 props
 * 下发，首帧渲染即 SSR，每个标签页 50-100 条站点内链进入 HTML——
 * 这是 `/site/{id}` 详情页除 `/sites` 目录外的第二批入链（孤岛 2163 → ≈71
 * 的关键一步）。
 *
 * limit=100 与改版前客户端口径一致（页面无「加载更多」，一次拉全）。
 * hubGet 失败返回 null → degraded=true 交给客户端岛出降级提示 + 重试。
 *
 * metadata 与面包屑由 `app/tags/[slug]/layout.tsx` 提供（本页无 metadata
 * export，route-titles 测试按 page→layout 顺序找标题来源）。
 */
export default async function TagDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const safeSlug = decodeURIComponent(slug)
  // hub 暴露 /api/search（web 侧 app/api/search/route.ts 只是它的转发）；
  // identity 不带：公开检索即可，个性化是客户端重试时的增强项
  const res = await hubGet<{ hits: Array<{ site: HubSite }> }>(
    '/api/search?q=&tag=' + encodeURIComponent(safeSlug) + '&limit=100',
  )
  const sites = (res?.hits ?? []).map((h) => h.site).filter((s): s is HubSite => Boolean(s))
  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-5 sm:space-y-6">
        <TagResultsBoard slug={safeSlug} initialSites={sites} degraded={res === null} />
      </div>
      <Footer />
    </Container>
  )
}
