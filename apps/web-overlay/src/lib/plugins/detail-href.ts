/**
 * 插件详情链接。
 *
 * 详情页的 SSR 探活拿不到浏览器身份：anonId 存在 localStorage，服务端请求
 * 不带 `X-Navhub-Anon-Id`，API 对 pending/rejected/delisted/quarantined 只能
 * 返回 404。直接链过去会把「作者/管理员预览」变成 404。
 *
 * 非 published 记录统一带 `?preview=1`：页面跳过服务端存在性判定，由客户端
 * 带身份取数，真正的可见性仍由 API 的 owner/admin 门禁决定（页面同时输出
 * noindex，避免预览 URL 被收录）。
 */
export function pluginDetailHref(slug: string, status?: string | null): string {
  const base = `/marketplace/${encodeURIComponent(slug)}`
  return status && status !== 'published' ? `${base}?preview=1` : base
}
