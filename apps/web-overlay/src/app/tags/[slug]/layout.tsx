import { Container } from '@/components/ui/container'
import { Breadcrumbs } from '@/components/breadcrumbs'

/**
 * 标签详情页的 server layout：只挂面包屑。
 *
 * metadata 为什么在 page.tsx 而不在这里（2026-10-21 修正）：
 * 实测 Next 16 的 title.template 语义——**中间层一旦定义字符串 title，
 * 根 layout 的模板（'%s - 站点名'）就传不到孙级**：`/tags/layout.tsx`
 * 定义了 `title: '标签总览'`，导致 `/tags/[slug]/layout.tsx` 的标题
 * 拿不到品牌后缀（369 个标签页的 <title> 全是光杆）。而 page 级
 * metadata 不受影响（`/site/[id]` 的页面标题就带后缀）。
 * 因此 generateMetadata 放在 page.tsx，与 /sites、/site/[id] 同构。
 *
 * 面包屑为什么挂 layout 而不是 page：page 的主体是客户端岛挂载者，
 * 面包屑是服务端组件，挂 layout 里进 SSR HTML，爬虫首轮即可见。
 *
 * 别往这里加 `alternates.canonical`：标签页 canonical 归一属于
 * Phase 2 家族（无效 slug → 404/308），不在这轮改动里。
 */
export default async function TagDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const safeSlug = decodeURIComponent(slug)
  return (
    <>
      {/* 面包屑与 JSON-LD 同源；Container 默认渲染 div，与页面主体左右对齐 */}
      <Container className="pt-4">
        <Breadcrumbs
          items={[
            { label: '首页', path: '/' },
            { label: '标签云', path: '/tags' },
            { label: safeSlug, path: `/tags/${encodeURIComponent(safeSlug)}` },
          ]}
        />
      </Container>
      {children}
    </>
  )
}
