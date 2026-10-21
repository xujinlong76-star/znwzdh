import { notFound } from 'next/navigation'
import { hubGetProbe } from '@/lib/server/hub'
import { SiteDetailView } from '@/components/site-detail-view'

/**
 * 站点详情页服务端壳：软 404 判定 + 客户端岛挂载。
 *
 * 软 404 消灭战（2026-10-21）：改版前整页是 'use client'，无效 id 也返回
 * HTTP 200 + 「站点不存在」空态——爬虫把几千个无效 URL 当有效页收录。
 * 现在服务端先探中枢，**只有** hubGetProbe 返回 'miss'（中枢 API 确认
 * 404）才 notFound()；'failed'（网络/中枢抖动）必须降级正常渲染，
 * 绝不把上游故障误判成 404。
 *
 * 实测铁律（2026-10-21，dev + curl 佐证）：**本路由不能有 loading.tsx**。
 * 有骨架屏边界时 Next 会先流式刷出 HTTP 200 壳，之后 notFound() 再抛
 * 也改不了状态码（generateMetadata 里抛同样被回退）——软 404 就是这么
 * 来的。删掉 loading.tsx 后 /site/zz-probe-* 才真正返回 404。岛内自带
 * 骨架屏（SiteDetailView 的 loading 态），加载体验不受影响。
 *
 * 标题/描述仍由 layout.tsx 的静态 metadata 提供（792d700 收口的成果，
 * 不在本轮推翻）；page 不再导出 metadata，避免顶掉 layout 的同名字段。
 */

export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const probe = await hubGetProbe('/api/sites/' + encodeURIComponent(id), 60)
  if (probe.status === 'miss') notFound()
  return <SiteDetailView id={id} />
}
