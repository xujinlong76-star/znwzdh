'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import { OfflineRecentList } from '@/components/offline-recent-list'
import { OfflineSnapshotSections } from '@/components/offline-snapshot-sections'

/**
 * /offline 页的客户端容器（Batch 3 第 8 项 P2）。
 *
 * 标题过滤框只过滤本机快照的标题——最近访问 + 收藏（本机）+
 * 稍后再看 / 续播三个分区共用同一查询；不调 /api/search，不建
 * 全文索引，占位文案写明「仅搜本机内容」。
 */
export function OfflineContent() {
  const [query, setQuery] = useState('')

  return (
    <>
      <div className="mt-6">
        <label htmlFor="offline-title-filter" className="sr-only">
          按标题过滤本机内容
        </label>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="offline-title-filter"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="仅搜本机内容：按标题过滤最近访问、收藏与稍后再看"
            autoComplete="off"
            className="w-full rounded-xl border border-border/70 bg-card py-2.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      <OfflineSnapshotSections query={query} />

      <OfflineRecentList query={query} />
    </>
  )
}
