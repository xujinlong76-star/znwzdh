import type { Metadata } from 'next'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { hubGet } from '@/lib/server/hub'
import type { HubTag } from '@/lib/navhub-api'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { TagCloud } from '@/components/tag-cloud'
import { pageShareMetadata } from '@/lib/seo/metadata'

/**
 * 标题与描述（2026-10-21 从 layout 迁来）。
 *
 * 为什么迁：根 layout 的 title.template 向孙级传递时，会被中间层的
 * 字符串 title 截断——本页的标题原先写在 `layout.tsx`，导致全部
 * 369 个 `/tags/[slug]` 页的 <title> 没有品牌后缀。放到 page 级
 * 后模板贯通（与 /sites、/site/[id] 同构）。
 *
 * og/twitter 走 pageShareMetadata 工厂：裸 `openGraph: { url }` 会整体
 * 替换根层默认值，运行时审计实测丢了 og:image/type/site_name/locale。
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: '标签总览',
    description: '按标签浏览全部站点，找到同一主题下的其它资源',
    alternates: { canonical: '/tags' },
    ...(await pageShareMetadata({
      url: '/tags',
      title: '标签总览',
      description: '按标签浏览全部站点，找到同一主题下的其它资源',
    })),
  }
}

/**
 * 标签云页（服务端取数 + 客户端岛渲染）。
 *
 * 为什么服务端化：标签链接必须进 **SSR HTML**。改版前整页是客户端组件，
 * useEffect 才取数，爬虫首轮与 link-graph.mjs（SSR 口径）看到的只有骨架屏
 * ——369 条标签内链对抓取等于不存在。现在服务端取数经 props 下发给
 * TagCloud 岛，首帧渲染即 SSR。
 *
 * `/api/tags` 不支持 limit（apps/api/src/routes/tags.ts 只读 minCount/group，
 * 客户端传的 limit=100 被静默忽略），这里同样不带 limit。
 * hubGet 失败返回 null → 交给客户端岛做降级提示 + 重试（不阻塞渲染）。
 *
 * revalidate=60：标签集合变更频率低（后台改标签不会秒级生效），
 * 但它是爬虫面页面——60s Data Cache 让重复抓取不再打穿中枢（Phase 6a）。
 * 后台改标签后最多 60s 体现在页面，与首页同档。
 *
 * metadata 在本页导出（2026-10-21 从 layout 迁来，见上方说明）——
 * route-titles 测试按 page→layout 顺序找标题来源，仍然命中本页。
 */
export default async function TagsPage() {
  const tags = await hubGet<HubTag[]>('/api/tags?minCount=1', 60)
  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-5 sm:space-y-6">
        <Breadcrumbs
          items={[
            { label: '首页', path: '/' },
            { label: '标签云', path: '/tags' },
          ]}
        />
        <TagCloud initialTags={tags} />
      </div>
      <Footer />
    </Container>
  )
}
