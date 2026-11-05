'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { SiteFavicon } from '@/components/site-favicon'
import { Search, X, ExternalLink, ArrowRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import type { HubSite } from '@/lib/navhub-api'
import { safeHref } from '@/lib/safe-url'

interface SitesDirectoryFilterableGridProps {
  initialSites: HubSite[]
  current: number
  totalPages: number
  totalSites: number
}

export function SitesDirectoryFilterableGrid({
  initialSites,
  current,
  totalPages,
  totalSites,
}: SitesDirectoryFilterableGridProps) {
  const [filterQuery, setFilterQuery] = useState('')

  const filteredSites = useMemo(() => {
    const q = filterQuery.trim().toLowerCase()
    if (!q) return initialSites

    return initialSites.filter((site) => {
      const titleHit = site.title?.toLowerCase().includes(q)
      const urlHit = site.url?.toLowerCase().includes(q)
      const descHit = site.description?.toLowerCase().includes(q)
      const tagsHit = site.tags?.some((t) => t.toLowerCase().includes(q))
      return titleHit || urlHit || descHit || tagsHit
    })
  }, [initialSites, filterQuery])

  return (
    <div className="space-y-4">
      {/* 0-RTT 客户端快速检索过滤条 */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 sm:p-3 rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs shadow-2xs">
        <div className="relative flex-1 min-w-[200px] sm:min-w-[15rem] max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={`在当前第 ${current} 页筛选站点 (标题 / 链接 / 描述)...`}
            aria-label="筛选当前页站点"
            className="pl-8 pr-8 h-8 text-xs bg-background/80"
          />
          {filterQuery && (
            <button
              type="button"
              onClick={() => setFilterQuery('')}
              aria-label="清空筛选输入"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-sm"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <span>
            显示 {filteredSites.length} / {initialSites.length} 个站点
          </span>
          {filterQuery && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilterQuery('')}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              重置
            </Button>
          )}
        </div>
      </div>

      {/* 站点网格或无匹配状态 */}
      {filteredSites.length === 0 ? (
        <div className="py-12 px-4 rounded-xl border border-dashed border-border/80 bg-muted/20">
          <EmptyState
            icon={Search}
            iconTone="muted"
            title={`当前第 ${current} 页未匹配到「${filterQuery}」`}
            description={`本页收录的 ${initialSites.length} 个站点中暂未包含该关键词。您可以直接前往全站搜索引擎进行多路召回（拼音 / 语义 / 全文）。`}
            action={
              <Button asChild size="sm" className="text-xs gap-1.5 bg-primary text-primary-foreground">
                <Link href={`/search?q=${encodeURIComponent(filterQuery.trim())}`}>
                  <span>在全站 {totalSites} 个站点中深度搜索</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filteredSites.map((site) => (
            <li key={site.id}>
              <div className="group relative flex items-center justify-between rounded-xl border border-border/70 p-2.5 hover:bg-muted/40 transition-colors">
                <Link
                  href={`/site/${encodeURIComponent(site.id)}`}
                  className="flex items-center gap-3 min-w-0 flex-1 py-0.5"
                >
                  <SiteFavicon
                    title={site.title}
                    url={site.url}
                    icon={site.iconKey ?? undefined}
                    className="w-6 h-6 rounded-md object-contain shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                      {site.title}
                    </span>
                    {site.description ? (
                      <span className="block text-xs text-muted-foreground truncate">{site.description}</span>
                    ) : null}
                  </span>
                </Link>
                <a
                  href={safeHref(site.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`新窗口直达 ${site.title} 官网`}
                  aria-label={`新窗口直达 ${site.title} 官网`}
                  className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-primary hover:bg-primary/10 transition-colors shrink-0 ml-2 cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
