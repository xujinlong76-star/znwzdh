'use client'

/**
 * /search 空态「最近搜索」chips（U-332）。
 *
 * 为什么这里是客户端岛、而热词 chips 是纯服务端组件：最近搜索是**个人**
 * 数据，身份只存在浏览器 localStorage（`lib/identity.ts`，SSR 返回空串），
 * 服务端 `hubGet` 不带身份头——服务端去调 GET /api/search-history 只会
 * 拿到 `{ items: [] }`，永远渲染不出东西。面板（SearchPalette /
 * SpotlightModal）同样是在浏览器里用身份调同一端点，本岛复用同一数据源、
 * 同一去重口径（`toRecentSearchItems`，经 `fetchRecentSearchQueries`），
 * 不新增数据源、不编造数据。
 *
 * 「无 JS 照常直达」只对 chips 本身成立：每枚 chip 都是指向
 * `/search?q=<词>` 的普通 <a>（`searchHref` 编码），点选不需要 JS；
 * 但**加载**个人数据需要 JS（身份在浏览器里）。无 JS 时本块不渲染，
 * 搜索框 + 服务端热词 chips 照常可用——不谎称「没有最近搜索」。
 * 取数失败 / 无历史时整块不渲染（空数组 → null，与热词同口径）。
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { getIdentity } from '@/lib/identity'
import { searchHref } from '@/lib/search-page'
import { fetchRecentSearchQueries } from '@/lib/recent-search-fetch'

/** 去掉已在热词区出现的词（大小写不敏感，与 toRecentSearchItems 同键），不与热词重复。 */
export function excludeHotwords(queries: string[], hotwords: string[]): string[] {
  const hot = new Set(hotwords.map((w) => w.trim().toLowerCase()).filter(Boolean))
  return queries.filter((q) => !hot.has(q.trim().toLowerCase()))
}

/**
 * 最近搜索 chips 列表（纯展示，与 HotwordChips 同款式、同链接形状）。
 * 空数组返回 null：未取到或取数失败时整块不渲染。
 */
export function RecentSearchChipsList({ queries }: { queries: string[] }) {
  if (queries.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">最近搜索</p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {queries.map((item) => (
          <Link
            key={item}
            href={searchHref({ q: item })}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            {item}
          </Link>
        ))}
      </div>
    </div>
  )
}

/**
 * 挂载后取当前身份的最近搜索（前 8，面板同口径），渲染时再去掉已在热词区
 * 的词（热词 prop 每次渲染都是新数组引用，排重放渲染时做，不进 effect 依赖）。
 * 首屏先渲染 null（不闪现错误内容）；身份未就绪 / 取数失败时保持 null。
 */
export function RecentSearchChips({ hotwords = [] }: { hotwords?: string[] }) {
  const identity = useMemo(() => getIdentity(), [])
  const [queries, setQueries] = useState<string[]>([])
  useEffect(() => {
    if (!identity) return
    let cancelled = false
    void fetchRecentSearchQueries(identity, 8).then((items) => {
      if (!cancelled) setQueries(items)
    })
    return () => {
      cancelled = true
    }
  }, [identity])
  return <RecentSearchChipsList queries={excludeHotwords(queries, hotwords)} />
}
