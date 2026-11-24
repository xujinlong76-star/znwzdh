import Link from 'next/link'
import { ExternalLink, ShieldCheck } from 'lucide-react'
import { safeHref } from '@/lib/safe-url'
import type { VerifiedBrand } from '@/lib/verified-brands'
import type { OfficialCardSiteEntry } from '@/lib/official-card-rank'

/**
 * 已核实官网卡片（品牌认官网第二步 W1）。
 *
 * 纯服务端展示组件，不记搜索、不调接口、不含任何客户端状态。
 * 渲染条件由调用方（search-results.tsx）经 lib/official-card-rank.ts
 * 判定：查询命中 50 家已核实品牌之一才渲染，含糊查询不给卡。
 *
 * 每张卡必带：
 *  - 品牌名与规范官网域名（只认 verified-brands.ts 的 canonicalDomain）；
 *  - 「官网已核实」标识；
 *  - 核查日期（brand.checkedAt，2026-11-24）与来源链接（brand.source，
 *    核查时打开的官网 URL，逐字照抄名单）；
 *  - 「去官网」按钮：去向永远是 `https://` + 规范域名。
 * 站内已有该品牌条目时，另给一条站内条目入口（/site/{id}），官网链接
 * 不受影响，仍是规范域名。
 */

export interface VerifiedOfficialCardProps {
  brand: VerifiedBrand
  /** 官网地址：`https://` + 规范域名，由 lib/official-card-rank.ts 装配。 */
  officialUrl: string
  /** 该品牌在站内导航的条目；没有时只展示官网入口。 */
  siteEntry?: OfficialCardSiteEntry | null
  /** 收录站点外链 rel（站点级设置，服务端透传）；缺省 nofollow */
  externalRel?: string
}

export function VerifiedOfficialCard({
  brand,
  officialUrl,
  siteEntry = null,
  externalRel = 'nofollow noopener noreferrer',
}: VerifiedOfficialCardProps) {
  return (
    <section
      aria-label={`官网已核实：${brand.name}`}
      className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          官网已核实
        </span>
        <h2 className="text-base font-semibold text-foreground">{brand.name}</h2>
        <span className="text-xs text-muted-foreground">{brand.canonicalDomain}</span>
      </div>
      {brand.note ? <p className="text-xs text-muted-foreground">{brand.note}</p> : null}
      <p className="text-[11px] text-muted-foreground">
        核查日期 {brand.checkedAt} · 来源{' '}
        <a
          href={safeHref(brand.source)}
          target="_blank"
          rel={externalRel}
          title={brand.source}
          className="break-all text-primary hover:underline"
        >
          {brand.source}
        </a>
      </p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <a
          href={safeHref(officialUrl)}
          target="_blank"
          rel={externalRel}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          去官网
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
        {siteEntry ? (
          <Link
            href={`/site/${encodeURIComponent(siteEntry.id)}`}
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
          >
            站内查看：{siteEntry.title}
          </Link>
        ) : null}
      </div>
    </section>
  )
}
