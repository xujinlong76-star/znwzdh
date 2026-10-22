/**
 * 插件详情链接。
 *
 * 详情页的 SSR 探活拿不到浏览器身份：anonId 存在 localStorage，服务端请求
 * 不带 `X-Navhub-Anon-Id`，API 对 pending/rejected/delisted/quarantined 只能
 * 返回 404。直接链过去会把「作者/管理员预览」变成 404。
 *
 * 非 published 记录统一走 `/marketplace/{slug}/preview` 独立路由：页面跳过服务端
 * 存在性判定，由客户端带身份取数，真正的可见性仍由 API 的 owner/admin 门禁决定
 * （路由自身输出 noindex，避免预览 URL 被收录）。
 *
 * 为什么不用 `?preview=1`：详情页主路由要进按需 ISR，而 `searchParams` 一旦出现在
 * page/generateMetadata 签名里，Next 就把整条路由退回逐请求渲染（与
 * `/category/{slug}` 的分页同一约束，那条也因此拆成了 `/p/{n}`）。预览是少数入口，值得为它单独开一条
 * 动态路由，而不是让 165 个公开详情页陪跑。旧 `?preview=1` 链接由 next.config
 * 的 redirects 兜底。
 */
export function pluginDetailHref(slug: string, status?: string | null): string {
  const base = `/marketplace/${encodeURIComponent(slug)}`
  return status && status !== 'published' ? `${base}/preview` : base
}
