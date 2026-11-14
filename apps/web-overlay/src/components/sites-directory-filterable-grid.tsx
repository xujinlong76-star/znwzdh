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

/** 筛选结果最多平铺展示多少条（其余只报总数，不分页） */
export const SEARCH_RESULT_LIMIT = 60

/**
 * 纯函数：按标题 / 链接 / 描述 / tags 匹配（与旧版内联逻辑同一语义，
 * 抽出来是为了 node 测试环境能直接单测——仓库无 jsdom，组件无法挂载交互）。
 */
export function filterSitesByQuery(sites: HubSite[], query: string): HubSite[] {
  const q = query.trim().toLowerCase()
  if (!q) return sites

  return sites.filter((site) => {
    const titleHit = site.title?.toLowerCase().includes(q)
    const urlHit = site.url?.toLowerCase().includes(q)
    const descHit = site.description?.toLowerCase().includes(q)
    const tagsHit = site.tags?.some((t) => t.toLowerCase().includes(q))
    return titleHit || urlHit || descHit || tagsHit
  })
}

interface SitesDirectoryFilterableGridProps {
  /** 当前页 60 条：无查询时照常渲染分页 */
  initialSites: HubSite[]
  /** 已取回的全部站点（父级 loadSitesPage 的 all）：有查询时只筛它，不只筛当前页 */
  searchableSites: HubSite[]
  totalPages: number
  totalSites: number
  /** 取到分块上限、后面还有没取到的数据：此时的 searchableSites 不是全量 */
  truncated: boolean
  /** 某一块请求失败：searchableSites 可能是空或半截，绝不能说成「共收录 N 个」 */
  failed: boolean
}

export function SitesDirectoryFilterableGrid({
  initialSites,
  searchableSites,
  totalPages,
  totalSites,
  truncated,
  failed,
}: SitesDirectoryFilterableGridProps) {
  const [filterQuery, setFilterQuery] = useState('')

  const isFiltering = filterQuery.trim() !== ''
  /** 取数不完整时筛的只是「已取回的部分」，文案里必须如实说，不许谎称全量 */
  const fetchedOnly = truncated || failed

  const matches = useMemo(
    () => (isFiltering ? filterSitesByQuery(searchableSites, filterQuery) : null),
    [searchableSites, filterQuery, isFiltering],
  )
  const capped = (matches?.length ?? 0) > SEARCH_RESULT_LIMIT
  // isFiltering 时 matches 一定非空（useMemo 里已算出），但 TS 从 isFiltering
  // 这个布尔值推不出 matches 非空：用 ?? [] 兜底，让 visibleSites 恒为数组。
  const visibleSites = isFiltering
    ? (matches ?? []).slice(0, SEARCH_RESULT_LIMIT)
    : initialSites

  const scopeWord = fetchedOnly ? '已取回' : '全站'

  return (
    <div className="space-y-4">
      {/* 0-RTT 客户端快速检索过滤条 */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 sm:p-3 rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs shadow-2xs">
        <div className="relative flex-1 min-w-[200px] sm:min-w-[15rem] max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="在全部站点中筛选（标题 / 链接 / 描述）..."
            aria-label="在全部站点中筛选"
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
            显示 {visibleSites.length} / {scopeWord} {totalSites} 个站点
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

      {/* 筛选时结果平铺、不分页：顶部如实报找到几条（超 60 只展前 60 条）。
          顶部这行与工具条计数是同一事实的两种说法——工具条说「正在看几条」，
          这里说「在多大范围里找到几条」，不许把「只筛了已取回的部分」说成全量。 */}
      {isFiltering && matches ? (
        <p role="status" className="text-xs text-muted-foreground">
          {fetchedOnly
            ? `只在已取回站点里筛选，找到 ${matches.length} 个`
            : `在全部 ${totalSites} 个站点中找到 ${matches.length} 个`}
          {capped ? '，显示前 60 个。输入更多关键字缩小范围' : ''}
        </p>
      ) : null}

      {/* 站点网格或无匹配状态：断言「没匹配上」必须同时满足两点——用户真的输了
          关键词、被筛的集合真的有站点。否则无词空页会渲染出「未匹配到「」」空引号，
          且 0 站有词时「收录的 0 个站点中暂未包含该关键词」会把「本来就没站点」
          说成「关键词没匹配上」；两种情况都由父级「暂无可展示的站点。」（或失败横幅）
          单独兜底，不在这里叠加第二个空态。注意被筛的集合现在是已取回的全部
          （searchableSites），不再是当前页（initialSites）。 */}
      {visibleSites.length === 0 && isFiltering && searchableSites.length > 0 ? (
        <div className="py-12 px-4 rounded-xl border border-dashed border-border/80 bg-muted/20">
          <EmptyState
            icon={Search}
            iconTone="muted"
            title={
              fetchedOnly
                ? `在已取回的 ${searchableSites.length} 个站点中未匹配到「${filterQuery}」`
                : `在全部 ${totalSites} 个站点中未匹配到「${filterQuery}」`
            }
            description={
              fetchedOnly
                ? `已取回的 ${searchableSites.length} 个站点中暂未包含该关键词；本次目录数据没有取全，该站可能在未取到的部分里。您可以直接前往全站搜索引擎进行多路召回（拼音 / 语义 / 全文）。`
                : `本站收录的 ${totalSites} 个站点中暂未包含该关键词。您可以直接前往全站搜索引擎进行多路召回（拼音 / 语义 / 全文）。`
            }
            action={
              <Button asChild size="sm" className="text-xs gap-1.5 bg-primary text-primary-foreground">
                <Link href={`/search?q=${encodeURIComponent(filterQuery.trim())}`}>
                  <span>
                    {fetchedOnly
                      ? '在全站搜索引擎中深度搜索'
                      : `在全站 ${totalSites} 个站点中深度搜索`}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {visibleSites.map((site) => (
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
