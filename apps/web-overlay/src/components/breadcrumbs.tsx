import { configuredSiteOrigin } from '@/lib/seo/origin'
import { breadcrumbLd, type Crumb } from '@/lib/seo/json-ld'
import { JsonLd } from '@/components/json-ld'
import { BreadcrumbTrail, usableCrumbs } from '@/components/breadcrumb-trail'

/**
 * 可见面包屑 + BreadcrumbList JSON-LD（同源组件，**服务端专用**）。
 *
 * 四条约束，改前必读：
 *
 * 1. **可见 DOM 与结构化数据同源**：两边由同一个 `items: Crumb[]`
 *    （lib/seo/json-ld.ts 的 Crumb 结构，与 breadcrumbLd 同一文件）渲染，
 *    并用同一个过滤函数（usableCrumbs，与 breadcrumbLd 的过滤规则逐字一致）。
 *    历史上「可见写死、JSON-LD 另算」导致两边断档，Google 整条丢弃。
 * 2. **origin 只来自 `configuredSiteOrigin()`**：绝不读 `window.location`
 *    （SSR 时取不到、CSR 取得到，参与可见 DOM 会水合崩溃）。
 *    origin 只用于 JSON-LD 的绝对 URL；可见 DOM 一律相对 href，恒等。
 * 3. **纯服务端**：本组件只在 Server Component / Server Layout 挂载。
 *    客户端页面（'use client'）用 `@/components/breadcrumb-trail` 的
 *    `BreadcrumbTrail`（仅可见 DOM）。**不要从本文件 re-export Trail**——
 *    那会把 origin.ts 拖进客户端依赖图（2026-10-21 实测 /collections 构建报错，
 *    教训已固化在模块边界上）。
 * 4. **这里刻意不用 `siteOrigin()`**：它在 `NAVHUB_SITE_URL` 缺失时回退到
 *    `headers()`，而本组件挂在几乎所有收录型路由的渲染链上，一旦被
 *    `revalidate` + `generateStaticParams` 的按需生成走到，实测后果是——
 *    没有动态段的静态路径（`/sites`）在构建期退化成 ƒ（缓存全废），
 *    带动态段的详情族（`/site/{id}`、`/tags/{slug}` 等）**直接 500**
 *    （DYNAMIC_SERVER_USAGE，2026-10-22 用无 origin 产物实测）。
 *    缺配置时的正确降级是「JSON-LD 不输出、地址保持相对」，不是丢缓存也不是炸页。
 *    `scripts/check-isr-routes.mjs` 的静态渲染链钉子会把这里改回 `siteOrigin()` 的提交拦下。
 *
 * noindex 页（如 /sites 页 ≥2）传 `jsonLd={false}`：结构化数据对不进
 * 索引的页面没有意义，但可见面包屑对用户仍有导航价值，照常渲染。
 */
export async function Breadcrumbs({
  items,
  jsonLd = true,
  className,
}: {
  items: Crumb[]
  /** noindex 页传 false；默认 true */
  jsonLd?: boolean
  className?: string
}) {
  const crumbs = usableCrumbs(items)
  if (crumbs.length === 0) return null
  const origin = configuredSiteOrigin()
  return (
    <>
      {jsonLd && origin ? <JsonLd data={breadcrumbLd(origin, crumbs)} /> : null}
      <BreadcrumbTrail items={crumbs} className={className} />
    </>
  )
}
