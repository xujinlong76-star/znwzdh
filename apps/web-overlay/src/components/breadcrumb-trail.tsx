import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { Crumb } from '@/lib/seo/json-ld'

/**
 * 纯可见面包屑（客户端安全）：零 hooks、零服务端 API——**不 import
 * `@/lib/seo/origin`**（那个模块用 next/headers，进了客户端图会直接
 * 构建报错）。客户端页面（'use client'）用本组件；需要 JSON-LD 的
 * 服务端页面用 `@/components/breadcrumbs` 的 `Breadcrumbs`。
 *
 * 为什么拆文件（2026-10-21）：Breadcrumbs 与 BreadcrumbTrail 原先同文件，
 * 客户端页 import Trail 会把 origin.ts 一起拖进客户端依赖图——
 * "You're importing a module that depends on next/headers" 构建报错
 * （/collections 实测 500）。模块边界必须把服务端 API 挡在外面。
 *
 * 可见 DOM 一律相对 href（origin 只属于 JSON-LD 的绝对 URL）。
 * 与 breadcrumbLd 共用同一 Crumb 结构与 usableCrumbs 过滤规则——
 * 可见足迹与结构化数据永不分叉。
 */

/** 与 breadcrumbLd 的过滤规则保持一致：空 label / 空 path 剔除，杜绝两边数量不一致 */
export function usableCrumbs(items: Crumb[]): Crumb[] {
  return (items ?? [])
    .map((c) => ({ label: (c?.label ?? '').trim(), path: (c?.path ?? '').trim() }))
    .filter((c) => c.label && c.path)
}

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
