import type { Metadata } from 'next'
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
 * revalidate=60：369 个标签页每个都直出 50-100 条站点内链（爬虫面）。
 * 带缓存后爬虫重复抓取走 Next Data Cache，不再每次打穿 hub 的 search
 * 聚合查询——这是孤岛收敛后 hub 端最大的负载来源（Phase 6a）。
 * identity 不带：公开检索即可，个性化是客户端重试时的增强项。
 */

/** 标签元信息（resolve 通道）：name 是规范名，description 为回填的标签描述 */
type TagMeta = { ok: boolean; tag: { name: string; slug: string; description: string | null } | null }

/**
 * 每页独立的 title/description（2026-10-21 从 layout 迁到 page）。
 *
 * 为什么迁：改版前 layout 里是写死的 `title: '标签详情'`——369 个标签页
 * 共享同一个 title/description，正是方案验收表「重复 title 页面 2100 → 0」
 * 要消灭的对象。且实测 `/tags/layout.tsx` 的字符串 title 会截断根
 * title.template 向孙级传递，放 layout 里连品牌后缀都拿不到；page 级
 * metadata 不受影响（与 /sites、/site/[id] 同构）。
 *
 * 取数口径：`/api/tags/resolve?q={slug}`（public scope，store 侧
 * resolveTag 按 slug/name/别名归一化命中，2026-10-21 起返回 description）。
 * revalidate=60 与正文取数同档。resolve 失败（无效 slug）退回 slug
 * 字面量，页面自身的空状态接管。
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const safeSlug = decodeURIComponent(slug)
  const res = await hubGet<TagMeta>('/api/tags/resolve?q=' + encodeURIComponent(safeSlug), 60)
  const name = res?.tag?.name ?? safeSlug
  return {
    title: `「${name}」相关站点`,
    description:
      res?.tag?.description ?? `「${name}」标签下的站点列表，按收录顺序排列，可进入详情查看简介、分类与标签。`,
  }
}

export default async function TagDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const safeSlug = decodeURIComponent(slug)
  // hub 暴露 /api/search（web 侧 app/api/search/route.ts 只是它的转发）。
  // revalidate=60：见上方注释——爬虫面页面走 Data Cache，降级仍由岛负责。
  // identity 不带：公开检索即可，个性化是客户端重试时的增强项。
  const [res, tagRes] = await Promise.all([
    hubGet<{ hits: Array<{ site: HubSite }> }>(
      '/api/search?q=&tag=' + encodeURIComponent(safeSlug) + '&limit=100',
      60,
    ),
    // 标签描述（82 个 ≥5 站标签由 scripts/tag-descriptions.mjs 回填）：
    // hero 文案与 generateMetadata 的 description 共用同一数据源，
    // 消灭 369 页共用同一段通用文案的重复正文问题。
    hubGet<TagMeta>('/api/tags/resolve?q=' + encodeURIComponent(safeSlug), 60),
  ])
  const sites = (res?.hits ?? []).map((h) => h.site).filter((s): s is HubSite => Boolean(s))
  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-5 sm:space-y-6">
        <TagResultsBoard
          slug={safeSlug}
          initialSites={sites}
          degraded={res === null}
          tagDescription={tagRes?.tag?.description ?? null}
        />
      </div>
      <Footer />
    </Container>
  )
}
