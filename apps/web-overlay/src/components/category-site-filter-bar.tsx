'use client'

import { useState, useTransition, useId } from 'react'
import { Search, X, MonitorPlay, ExternalLink, ArrowRight, Layers } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { searchHref } from '@/lib/search-page'

export interface CategorySubcategoryOption {
  id: string
  title: string
  count: number
}

export interface CategorySiteFilterBarProps {
  totalCount: number
  categoryName: string
  topTags?: [string, number][]
  /**
   * 分类的 URL 标识（slug）。用于把「全局搜索」链接到 /search?category=，
   * 那里是服务端检索、覆盖分页后的全部站点——本组件的即时筛选只作用于
   * 当前已渲染的这一页（DOM 过滤），两者必须区分，不能假装本地过滤是全量的。
   */
  categorySlug?: string | null
  /** 该分类在服务端的总站点数（分页后仍有更多时为 sites.length + hasMore 的下限值） */
  totalAcrossPages?: number | null
  /** 站点数未达独立索引页门槛的子分类，直接在页内提供切片筛选 */
  subcategories?: CategorySubcategoryOption[]
  /** 是否为短剧专区：空结果改导流至追剧/看剧场景而非技术视频库 */
  isDrama?: boolean
}

export function CategorySiteFilterBar({
  totalCount,
  categoryName,
  topTags = [],
  categorySlug = null,
  totalAcrossPages = null,
  subcategories = [],
  isDrama = false,
}: CategorySiteFilterBarProps) {
  const [query, setQuery] = useState('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string | null>(null)
  const [matchedCount, setMatchedCount] = useState(totalCount)
  const [, startTransition] = useTransition()
  const filterInputId = useId()

  const applyFilter = (newQuery: string, newTag: string | null, newSubcategoryId: string | null) => {
    const q = newQuery.trim().toLowerCase()
    const tag = newTag?.trim().toLowerCase() || null
    const subId = newSubcategoryId?.trim() || null

    startTransition(() => {
      const items = document.querySelectorAll<HTMLElement>('#category-sites-list > li[data-site-item]')
      let count = 0

      items.forEach((item) => {
        const title = item.getAttribute('data-title') || ''
        const desc = item.getAttribute('data-desc') || ''
        const url = item.getAttribute('data-url') || ''
        const tags = item.getAttribute('data-tags') || ''
        const categoryId = item.getAttribute('data-category-id') || ''

        const matchQuery = !q || title.includes(q) || desc.includes(q) || url.includes(q)
        const matchTag = !tag || tags.includes(tag)
        const matchSub = !subId || categoryId === subId

        if (matchQuery && matchTag && matchSub) {
          item.style.display = ''
          count++
        } else {
          item.style.display = 'none'
        }
      })

      setMatchedCount(count)
      const emptyEl = document.getElementById('category-filter-empty')
      if (emptyEl) {
        emptyEl.style.display = count === 0 ? 'block' : 'none'
      }
    })
  }

  const handleQueryChange = (val: string) => {
    setQuery(val)
    applyFilter(val, selectedTag, selectedSubcategoryId)
  }

  const handleTagClick = (tag: string) => {
    const nextTag = selectedTag === tag ? null : tag
    setSelectedTag(nextTag)
    applyFilter(query, nextTag, selectedSubcategoryId)
  }

  const handleSubcategoryClick = (subId: string | null) => {
    const nextSub = selectedSubcategoryId === subId ? null : subId
    setSelectedSubcategoryId(nextSub)
    applyFilter(query, selectedTag, nextSub)
  }

  const handleReset = () => {
    setQuery('')
    setSelectedTag(null)
    setSelectedSubcategoryId(null)
    applyFilter('', null, null)
  }

  const isFiltering = Boolean(query || selectedTag || selectedSubcategoryId)

  return (
    <div className="space-y-3 pt-2 pb-1">
      {/* 搜索与统计栏 */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="relative flex-1">
          <label htmlFor={filterInputId} className="sr-only">
            在「{categoryName}」分类中即时筛选站点
          </label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            id={filterInputId}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder={`在「${categoryName}」收录的 ${totalCount} 个站点中即时筛选 (名称 / 描述 / 域名)...`}
            className="w-full h-9 pl-9 pr-8 text-xs rounded-xl border border-border/80 bg-background/80 shadow-2xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50 transition-all"
          />
          {query && (
            <button
              type="button"
              onClick={() => handleQueryChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
              title="清除关键词"
              aria-label="清除关键词"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 数量指示与清除筛选 */}
        <div className="flex items-center justify-between sm:justify-end gap-2 text-xs shrink-0 px-1">
          <span className="text-muted-foreground text-xs">
            显示 <span className="font-mono font-semibold text-foreground">{matchedCount}</span> / {totalCount} 个站点
          </span>
          {isFiltering && (
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-primary hover:underline cursor-pointer font-medium ml-1"
            >
              重置筛选
            </button>
          )}
        </div>
      </div>

      {/* 全局检索出口：本地即时筛选只覆盖当前页，跨分页必须走服务端 /search。
          不写清楚这一点，用户在大分类里搜不到第二页的站点会以为「本站没有」。 */}
      {categorySlug ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5 min-w-0">
            <Layers className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden />
            <span className="truncate">
              上方即时筛选仅覆盖<span className="font-medium text-foreground">当前这一页</span>的 {totalCount} 个站点
              {totalAcrossPages && totalAcrossPages > totalCount
                ? `；本分类共 ${totalAcrossPages} 个，跨页请用全局检索`
                : ''}
              。
            </span>
          </span>
          <Link
            href={searchHref({ q: query.trim(), category: categorySlug })}
            className="inline-flex items-center gap-1 shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
          >
            {query.trim() ? `在全部「${categoryName}」站点中搜索「${query.trim()}」` : `在全部「${categoryName}」站点中检索`}
            <ArrowRight className="w-3 h-3" aria-hidden />
          </Link>
        </div>
      ) : null}

      {/* 根分类内子切片快选（不跳转到独立薄页，页内实时过滤） */}
      {subcategories.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-xs">
          <span className="text-[11px] text-muted-foreground shrink-0">分区筛选:</span>
          <button
            type="button"
            onClick={() => handleSubcategoryClick(null)}
            className={cn(
              'px-2.5 py-1 rounded-lg text-[11px] shrink-0 transition-colors cursor-pointer flex items-center gap-1 border',
              selectedSubcategoryId === null
                ? 'bg-primary text-primary-foreground border-primary font-medium shadow-2xs'
                : 'bg-muted/40 text-muted-foreground hover:text-foreground border-border/60 hover:bg-muted',
            )}
          >
            <span>全部</span>
            <span
              className={cn(
                'text-[10px] font-mono',
                selectedSubcategoryId === null ? 'text-primary-foreground/80' : 'text-muted-foreground/60',
              )}
            >
              {totalCount}
            </span>
          </button>
          {subcategories.map((sub) => {
            const isSelected = selectedSubcategoryId === sub.id
            return (
              <button
                key={sub.id}
                type="button"
                onClick={() => handleSubcategoryClick(sub.id)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-[11px] shrink-0 transition-colors cursor-pointer flex items-center gap-1 border',
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary font-medium shadow-2xs'
                    : 'bg-muted/40 text-muted-foreground hover:text-foreground border-border/60 hover:bg-muted',
                )}
              >
                <span>{sub.title}</span>
                <span
                  className={cn(
                    'text-[10px] font-mono',
                    isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground/60',
                  )}
                >
                  {sub.count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* 热门标签快选 */}
      {topTags.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-xs">
          <span className="text-[11px] text-muted-foreground shrink-0">标签精选:</span>
          {topTags.map(([tag, count]) => {
            const isSelected = selectedTag === tag
            return (
              <button
                key={tag}
                type="button"
                onClick={() => handleTagClick(tag)}
                className={cn(
                  'px-2 py-0.5 rounded-md text-[11px] shrink-0 transition-colors cursor-pointer flex items-center gap-1 border',
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary font-medium shadow-2xs'
                    : 'bg-muted/40 text-muted-foreground hover:text-foreground border-border/60 hover:bg-muted'
                )}
              >
                <span>#{tag}</span>
                <span className={cn('text-[10px] font-mono', isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground/60')}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* 筛选零结果动态提示区（初始由 DOM 隐藏） */}
      <div
        id="category-filter-empty"
        style={{ display: 'none' }}
        className="p-6 rounded-xl border border-dashed border-border/80 bg-muted/20 text-center space-y-3"
      >
        <p className="text-xs text-muted-foreground">
          在「{categoryName}」当前页未找到与「{query || selectedTag}」匹配的站点
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {query && (
            <Link
              href={`/search?q=${encodeURIComponent(query)}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/70 bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Search className="w-3.5 h-3.5 text-primary" />
              <span>全站搜索「{query}」</span>
            </Link>
          )}
          {isDrama ? (
            <Link
              href="/scenes/watch-drama"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-2xs"
            >
              <MonitorPlay className="w-3.5 h-3.5" />
              <span>去追剧场景页找平台</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          ) : (
            <Link
              href={`/videos?q=${encodeURIComponent(query || categoryName)}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-2xs"
            >
              <MonitorPlay className="w-3.5 h-3.5" />
              <span>在技术视频库搜索相关教程</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          )}
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-1.5 rounded-lg border border-border/70 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            清除当前筛选
          </button>
        </div>
      </div>
    </div>
  )
}
