import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { siteOrigin } from '@/lib/seo/origin'
import { breadcrumbLd, type Crumb } from '@/lib/seo/json-ld'
import { JsonLd } from '@/components/json-ld'

/**
 * 可见面包屑 + BreadcrumbList JSON-LD（同源组件）。
 *
 * 三条约束，改前必读：
 *
 * 1. **可见 DOM 与结构化数据同源**：两边由同一个 `items: Crumb[]`
 *    （lib/seo/json-ld.ts 的 Crumb 结构，与 breadcrumbLd 同一文件）渲染，
 *    并用同一个过滤函数（与 breadcrumbLd 的过滤规则逐字一致）。
 *    历史上「可见写死、JSON-LD 另算」导致两边断档，Google 整条丢弃。
 * 2. **origin 只能来自 `siteOrigin()`**：绝不读 `window.location`
 *    （SSR 时取不到、CSR 取得到，参与可见 DOM 会水合崩溃）。
 *    origin 只用于 JSON-LD 的绝对 URL；可见 DOM 一律相对 href，恒等。
 * 3. **零 hooks、纯服务端**：`await siteOrigin()` 会触碰 headers()，
 *    只能在 Server Component / Server Layout 挂载。客户端页面
 *    （'use client'）用同文件导出的 `BreadcrumbTrail`（仅可见 DOM）。
 *
 * noindex 页（如 /sites 页 ≥2）传 `jsonLd={false}`：结构化数据对不进
 * 索引的页面没有意义，但可见面包屑对用户仍有导航价值，照常渲染。
 */

/** 与 breadcrumbLd 的过滤规则保持一致：空 label / 空 path 剔除，杜绝两边数量不一致 */
function usableCrumbs(items: Crumb[]): Crumb[] {
  return (items ?? [])
    .map((c) => ({ label: (c?.label ?? '').trim(), path: (c?.path ?? '').trim() }))
    .filter((c) => c.label && c.path)
}

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
  const origin = await siteOrigin()
  return (
    <>
      {jsonLd && origin ? <JsonLd data={breadcrumbLd(origin, crumbs)} /> : null}
      <BreadcrumbTrail items={crumbs} className={className} />
    </>
  )
}

/**
 * 纯可见面包屑：无服务端 API、零 hooks，客户端页面也能直接用。
 * 只渲染相对 href、不产出结构化数据——需要 JSON-LD 的页面用上面的
 * `Breadcrumbs`（服务端组件）。两侧共用 usableCrumbs，DOM 永不分叉。
 */
export function BreadcrumbTrail({
  items,
  className,
}: {
  items: Crumb[]
  className?: string
}) {
  const crumbs = usableCrumbs(items)
  if (crumbs.length === 0) return null
  return (
    <nav aria-label="面包屑" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={c.path + c.label} className="flex items-center gap-1.5">
              {i > 0 ? <ChevronRight aria-hidden className="w-3 h-3 opacity-50" /> : null}
              {last ? (
                <span aria-current="page" className="font-medium text-foreground">
                  {c.label}
                </span>
              ) : (
                <Link href={c.path} className="hover:text-foreground transition-colors">
                  {c.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
