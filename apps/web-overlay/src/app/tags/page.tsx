import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { hubGet } from '@/lib/server/hub'
import type { HubTag } from '@/lib/navhub-api'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { TagCloud } from '@/components/tag-cloud'

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
 * metadata 继续由 `app/tags/layout.tsx` 提供（本页无 metadata export，
 * route-titles 测试按 page→layout 顺序找标题来源，行为与改版前一致）。
 */
export default async function TagsPage() {
  const tags = await hubGet<HubTag[]>('/api/tags?minCount=1')
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
