'use client'

import { useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import { Search, X, ChevronDown, ChevronUp, Folder, ArrowRight, Layers } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { safeHref } from '@/lib/safe-url'

export interface FormattedCategoryLeaf {
  id: string
  title: string
  href: string
  description?: string | null
  count: number
}

export interface FormattedCategoryGroup {
  id: string
  title: string
  href: string
  rootCount: number
  leaves: FormattedCategoryLeaf[]
}

interface CategoryIndexFilterableListProps {
  groups: FormattedCategoryGroup[]
  totalLeaves: number
}

export function CategoryIndexFilterableList({
  groups,
  totalLeaves,
}: CategoryIndexFilterableListProps) {
  const [filterQuery, setFilterQuery] = useState('')
  // 记录每个分类手动展开/收起的状态；当正在搜索时，匹配项默认全部展开
  const [openStates, setOpenStates] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    if (groups.length > 0) {
      initial[groups[0].id] = true
    }
    return initial
  })

  const trimmedQuery = filterQuery.trim().toLowerCase()
  const isFiltering = trimmedQuery.length > 0

  // 0-RTT 客户端过滤
  const filteredGroups = useMemo(() => {
    if (!isFiltering) return groups

    return groups
      .map((group) => {
        const rootMatch = group.title.toLowerCase().includes(trimmedQuery)
        const matchingLeaves = group.leaves.filter(
          (leaf) =>
            leaf.title.toLowerCase().includes(trimmedQuery) ||
            (leaf.description && leaf.description.toLowerCase().includes(trimmedQuery))
        )

        // 如果主类目命中，保留所有子类目；如果仅子类目命中，保留命中的子类目
        if (rootMatch) {
          return group
        }
        if (matchingLeaves.length > 0) {
          return {
            ...group,
            leaves: matchingLeaves,
          }
        }
        return null
      })
      .filter((g): g is FormattedCategoryGroup => g !== null)
  }, [groups, trimmedQuery, isFiltering])

  // 当前显示的子分类总数
  const visibleLeavesCount = useMemo(() => {
    return filteredGroups.reduce((acc, g) => acc + g.leaves.length, 0)
  }, [filteredGroups])

  // 一键展开全部
  const handleExpandAll = () => {
    const next: Record<string, boolean> = {}
    groups.forEach((g) => {
      next[g.id] = true
    })
    setOpenStates(next)
  }

  // 一键收起全部
  const handleCollapseAll = () => {
    setOpenStates({})
  }

  const toggleGroup = (groupId: string) => {
    setOpenStates((prev) => {
      // 正在搜索时，未记录的默认为 true
      const current = isFiltering ? (prev[groupId] !== false) : !!prev[groupId]
      return {
        ...prev,
        [groupId]: !current,
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* 0-RTT 分类搜索与快捷控制条 */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xs shadow-2xs">
        <div className="relative flex-1 min-w-[220px] sm:min-w-[18rem] max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="快速查找分类或子类目（例如: AI, 数据库, 博客, 官方文档）..."
            aria-label="快速查找分类或子类目"
            className="pl-9 pr-8 h-9 text-xs sm:text-sm bg-background/80"
          />
          {filterQuery && (
            <button
              type="button"
              onClick={() => setFilterQuery('')}
              aria-label="清空筛选输入"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded-sm cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground font-mono hidden sm:inline-block">
            {isFiltering ? (
              <span>
                匹配到 <strong className="text-foreground">{filteredGroups.length}</strong> / {groups.length} 个主类目，
                <strong className="text-foreground">{visibleLeavesCount}</strong> / {totalLeaves} 个子分类
              </span>
            ) : (
              <span>共 {groups.length} 个主类目 · {totalLeaves} 个子分类</span>
            )}
          </span>

          <div className="flex items-center gap-1.5 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExpandAll}
              className="h-7.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className="w-3.5 h-3.5 mr-1" />
              <span>全部展开</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCollapseAll}
              className="h-7.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronUp className="w-3.5 h-3.5 mr-1" />
              <span>全部收起</span>
            </Button>
            {isFiltering && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilterQuery('')}
                className="h-7.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                重置
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 分类列表或无匹配状态 */}
      {filteredGroups.length === 0 ? (
        <div className="py-12 px-4 rounded-2xl border border-dashed border-border/80 bg-muted/20">
          <EmptyState
            icon={Search}
            iconTone="muted"
            title={`未找到与「${filterQuery}」相关的分类`}
            description={`全站收录的 ${groups.length} 个主类目及 ${totalLeaves} 个子分类中未直接包含该关键词。您可以直接前往全站多路搜索引擎检索站点与教程。`}
            action={
              <Button asChild size="sm" className="text-xs gap-1.5 bg-primary text-primary-foreground">
                <Link href={`/search?q=${encodeURIComponent(trimmedQuery)}`}>
                  <span>在全站搜索「{trimmedQuery}」</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filteredGroups.map(({ id, title, href, rootCount, leaves }) => {
            // 搜索状态下默认全部展开，除非用户手动折叠；非搜索状态读 openStates
            const isOpen = isFiltering ? (openStates[id] !== false) : !!openStates[id]

            return (
              <div
                key={id}
                className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xs overflow-hidden transition-all duration-200"
              >
                <div className="flex items-center justify-between p-3 sm:px-4 bg-muted/20">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="p-1.5 rounded-lg bg-primary/10 text-primary shrink-0">
                      <Folder className="w-4 h-4" />
                    </span>
                    <Link
                      href={safeHref(href)}
                      className="text-sm sm:text-base font-bold text-foreground hover:text-primary transition-colors truncate"
                    >
                      {title}
                    </Link>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0 ml-2">
                    <span className="text-xs text-muted-foreground font-mono">
                      <span>{rootCount} 站点</span>
                      <span className="hidden sm:inline"> · {leaves.length} 个子分类</span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleGroup(id)}
                      aria-expanded={isOpen}
                      aria-label={isOpen ? `收起 ${title}` : `展开 ${title}`}
                      className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                    >
                      <span>{isOpen ? '收起' : '展开'}</span>
                      {isOpen ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </div>
                </div>

                {isOpen && (
                  <div className="p-3.5 sm:p-4 pt-1 sm:pt-1 border-t border-border/50 bg-background/40">
                    {leaves.length === 0 ? (
                      <p className="py-2 text-xs text-muted-foreground">
                        该分类暂无可展示的达标子分类，请前往主分类页面浏览全量聚合站点。
                      </p>
                    ) : (
                      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-2">
                        {leaves.map((leaf) => (
                          <li key={leaf.id}>
                            <Link
                              href={safeHref(leaf.href)}
                              className="group flex items-center justify-between gap-2.5 rounded-xl border border-border/60 p-2.5 hover:bg-muted/60 hover:border-primary/40 transition-all shadow-2xs"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block text-xs sm:text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                                  {leaf.title}
                                </span>
                                {leaf.description ? (
                                  <span className="block text-[11px] text-muted-foreground/80 truncate mt-0.5 font-normal">
                                    {leaf.description}
                                  </span>
                                ) : null}
                              </span>
                              <span className="text-xs font-mono font-medium text-muted-foreground/70 bg-muted/60 px-2 py-0.5 rounded-md border border-border/40 shrink-0">
                                {leaf.count}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
