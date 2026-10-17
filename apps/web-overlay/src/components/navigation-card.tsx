'use client'

import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardDescription } from '@/registry/new-york/ui/card'
import type { NavigationSubItem } from '@/types/navigation'
import { SiteFavicon } from '@/components/site-favicon'
import { FavoriteButton } from '@/components/favorite-button'
import type { SiteConfig } from '@/types/site'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Eye, Star, Zap, Pin, Clock } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { useToast } from "@/components/ui/use-toast"
import { pinSiteToWorkbench } from '@/lib/modular/workbench-bridge'
import type { CardDisplayMode } from '@/lib/modular/use-home-diy'
import { cn } from '@/lib/utils'
import { safeHref } from '@/lib/safe-url'

interface NavigationCardProps {
  item: NavigationSubItem
  siteConfig?: SiteConfig
  onPeek?: (item: NavigationSubItem) => void
  cardDisplayMode?: CardDisplayMode
  isPinnedInCategory?: boolean
  onTogglePinInCategory?: (siteId: string) => void
  isDraggable?: boolean
  sourceCategoryId?: string
  /** 多选模式：点击卡片 = 切换选中，而不是打开站点 */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (siteId: string) => void
}

export function NavigationCard({
  item,
  siteConfig,
  onPeek,
  cardDisplayMode = 'standard',
  isPinnedInCategory = false,
  onTogglePinInCategory,
  isDraggable = false,
  sourceCategoryId,
  selectable = false,
  selected = false,
  onToggleSelect,
}: NavigationCardProps) {
  const { toast } = useToast()
  const linkTarget = siteConfig?.navigation?.linkTarget || '_blank'

  /**
   * 多选模式下卡片点击**不导航**，只切换选中。
   * 这是「批量操作」的入口：没有它，底部的批量操作坞永远不会出现。
   */
  const handleLinkClick = (e: React.MouseEvent) => {
    if (!selectable) return
    e.preventDefault()
    e.stopPropagation()
    onToggleSelect?.(item.id)
  }

  const handleDragStart = (e: React.DragEvent) => {
    if (!isDraggable) return
    e.dataTransfer.setData(
      'text/navhub-card-payload',
      JSON.stringify({
        id: item.id,
        title: item.title,
        href: item.href,
        description: item.description,
        icon: item.icon,
        sourceCategoryId,
      })
    )
    e.dataTransfer.effectAllowed = 'copy'
  }

  // 提取首个平替
  const topAlternative = item.relations?.find((r) => r.relationType === 'alternative')

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault()
      onPeek?.(item)
    }
  }

  const handleWorkbenchPin = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const res = pinSiteToWorkbench({
      siteId: item.id,
      title: item.title,
      href: item.href,
      icon: item.icon,
      description: item.description,
    })
    toast({
      title: res.ok ? '📌 已固定到工作台' : '固定提示',
      description: res.message,
    })
  }

  const handleCategoryPin = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (onTogglePinInCategory) {
      onTogglePinInCategory(item.id)
      toast({
        title: isPinnedInCategory ? '已取消分类内置顶' : '📌 已在当前分类置顶',
        description: isPinnedInCategory ? `站点「${item.title}」已恢复默认排序` : `站点「${item.title}」已优先排至该分类首位`,
      })
    }
  }

  /**
   * 多选模式的视觉态：整卡可点（不再是链接）+ 主色描边；已选中再叠一层底色。
   * 放在这里而不是每处 markup，是为了三个显示模式（紧凑 / 标准 / 丰富）完全一致。
   */
  const selectionClass = !selectable
    ? ''
    : cn(
        'cursor-pointer ring-2 ring-primary/25 hover:ring-primary/45',
        selected && 'ring-primary/70 border-primary/60 bg-primary/5',
      )

  // 1. 紧凑单行条形多态 (Compact Bar Mode)
  if (cardDisplayMode === 'compact') {
    return (
      <Tooltip>
          <TooltipTrigger asChild>
            <div
              tabIndex={0}
              data-navhub-site-id={item.id}
              data-navhub-selected={selected ? 'true' : undefined}
              onKeyDown={handleKeyDown}
              draggable={isDraggable}
              onDragStart={handleDragStart}
              className={cn(
                "group relative flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border/70 hover:border-primary/40 bg-card/85 dark:bg-card/45 backdrop-blur-xs depth-card hover:shadow-xs transition-all duration-150 transform hover:-translate-y-0.25 focus:outline-none focus:ring-1.5 focus:ring-primary/40",
                isPinnedInCategory && "ring-1 ring-amber-500/40 bg-amber-500/4 border-amber-500/30",
                isDraggable && "cursor-grab active:cursor-grabbing hover:border-primary/60 hover:ring-1 hover:ring-primary/30",
                selectionClass
              )}
            >
              <Link
                href={safeHref(item.href)}
                target={linkTarget}
                rel="noopener noreferrer"
                data-prefetch-target="true"
                onClick={handleLinkClick}
                className="flex items-center gap-2 min-w-0 flex-1"
              >
                <div className="flex-shrink-0 w-6 h-6 rounded-md p-0.5 bg-muted/50 dark:bg-muted/20 border border-border/40 flex items-center justify-center transition-transform duration-150 group-hover:scale-105">
                  <SiteFavicon
                    title={item.title}
                    url={item.href}
                    icon={item.icon}
                    useDefaultIcon={item.useDefaultIcon}
                    className="w-full h-full object-contain rounded-xs"
                  />
                </div>
                <div className="min-w-0 flex-1 flex items-center gap-1.5">
                  <span className="text-xs sm:text-sm font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors truncate">
                    {item.title}
                  </span>
                  {isPinnedInCategory && (
                    <Pin className="w-2.5 h-2.5 text-amber-500 fill-amber-500 shrink-0" />
                  )}
                  {item.liveMetrics?.githubStars && (
                    <span className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-mono font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1 py-0.2 rounded">
                      <Star className="w-2 h-2 text-amber-500 fill-amber-500" />
                      {(item.liveMetrics.githubStars / 1000).toFixed(0)}k
                    </span>
                  )}
                  {item.health?.ok === false && (
                    <span
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onPeek?.(item)
                      }}
                      className="inline-flex items-center gap-0.5 text-[9px] font-mono font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1 py-0.2 rounded-full hover:bg-amber-500/20 transition-colors cursor-pointer shrink-0"
                      title="检测到站点当前无法直连，点击开启时光机历史快照自愈"
                    >
                      <Clock className="w-2.5 h-2.5 text-amber-500" />
                      <span>快照自愈</span>
                    </span>
                  )}
                </div>
              </Link>

              {/* 紧凑操作按钮 */}
              <div className="flex items-center gap-0.5 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                {onTogglePinInCategory && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-6 w-6 rounded-md",
                      isPinnedInCategory ? "text-amber-500 bg-amber-500/10" : "text-muted-foreground hover:text-amber-500"
                    )}
                    title={isPinnedInCategory ? "取消分类内置顶" : "置顶在当前分类首位"}
                    onClick={handleCategoryPin}
                  >
                    <Pin className={cn("w-3 h-3", isPinnedInCategory && "fill-amber-500")} />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
                  title="速览与行动"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onPeek?.(item)
                  }}
                >
                  <Eye className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-md text-muted-foreground hover:text-emerald-500"
                  title="📌 固定到工作台"
                  onClick={handleWorkbenchPin}
                >
                  <Pin className="w-3 h-3" />
                </Button>
                <FavoriteButton
                  site={{ siteId: item.id, title: item.title, href: item.href, icon: item.icon, description: item.description }}
                />
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" className="max-w-[280px] text-xs">
            <p>{item.description || item.title}</p>
            <p className="text-[10px] text-muted-foreground pt-1 border-t mt-1">按 Space 空格键沙箱速览</p>
          </TooltipContent>
        </Tooltip>
    )
  }

  // 2. 深度丰富卡片多态 (Rich / Detailed Mode)
  if (cardDisplayMode === 'rich') {
    return (
      <Tooltip>
          <TooltipTrigger asChild>
            <Card
              tabIndex={0}
              data-navhub-site-id={item.id}
              data-navhub-selected={selected ? 'true' : undefined}
              onKeyDown={handleKeyDown}
              draggable={isDraggable}
              onDragStart={handleDragStart}
              className={cn(
                "group @container relative overflow-hidden rounded-xl border border-border/80 hover:border-primary/50 bg-card/90 dark:bg-card/50 backdrop-blur-xs depth-card hover:shadow-lg dark:hover:shadow-primary/10 nav-card-glow transition-all duration-200 transform hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-primary/40 before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-primary/40 before:via-accent/60 before:to-primary/30",
                isPinnedInCategory && "ring-1 ring-amber-500/40 bg-amber-500/4 border-amber-500/30",
                isDraggable && "cursor-grab active:cursor-grabbing hover:border-primary/70 hover:ring-1 hover:ring-primary/40",
                selectionClass
              )}
            >
              {isPinnedInCategory && (
                <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-medium">
                  <Pin className="w-2.5 h-2.5 fill-amber-500" />
                  <span>已置顶</span>
                </div>
              )}

              <Link
                href={safeHref(item.href)}
                target={linkTarget}
                rel="noopener noreferrer"
                data-prefetch-target="true"
                onClick={handleLinkClick}
                className="block h-full"
              >
                <CardHeader className="p-4 sm:p-5">
                  <div className="flex items-start gap-3.5">
                    <div className="flex-shrink-0 w-11 h-11 rounded-xl p-2 bg-muted/60 dark:bg-muted/30 border border-border/60 flex items-center justify-center transition-transform duration-200 group-hover:scale-105 shadow-xs">
                      <SiteFavicon
                        title={item.title}
                        url={item.href}
                        icon={item.icon}
                        useDefaultIcon={item.useDefaultIcon}
                        className="w-full h-full object-contain rounded-sm"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap pr-20">
                        <CardTitle className="text-sm sm:text-base font-bold tracking-tight text-foreground group-hover:text-primary transition-colors truncate">
                          {item.title}
                        </CardTitle>
                        {item.liveMetrics?.githubStars && (
                          <span className="inline-flex items-center gap-0.5 text-xs font-mono font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                            <Star className="w-2.5 h-2.5 text-amber-500 fill-amber-500" />
                            {(item.liveMetrics.githubStars / 1000).toFixed(0)}k
                          </span>
                        )}
                        {item.health?.ok === false && (
                          <span
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              onPeek?.(item)
                            }}
                            className="inline-flex items-center gap-0.5 text-[10px] font-mono font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full hover:bg-amber-500/20 transition-colors cursor-pointer"
                            title="检测到站点当前无法直连，点击开启时光机历史快照自愈"
                          >
                            <Clock className="w-2.5 h-2.5 text-amber-500" />
                            <span>快照自愈</span>
                          </span>
                        )}
                      </div>

                      {item.description && (
                        <CardDescription className="text-xs text-muted-foreground/90 line-clamp-2 leading-relaxed mt-1.5">
                          {item.description}
                        </CardDescription>
                      )}

                      {/* 丰富标签池 */}
                      <div className="flex items-center gap-1.5 pt-2.5 flex-wrap">
                        {item.tags?.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-muted/70 text-muted-foreground font-mono"
                          >
                            #{tag}
                          </span>
                        ))}
                        {topAlternative && (
                          <span
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              onPeek?.(item)
                            }}
                            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium hover:bg-indigo-500/20 border border-indigo-500/20 transition-colors cursor-pointer"
                          >
                            <span>平替: {topAlternative.targetTitle}</span>
                          </span>
                        )}
                        {item.actions && item.actions.length > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400 font-medium bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                            <Zap className="w-2.5 h-2.5" />
                            <span>深链</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </Link>

              {/* 操作区：右上角悬浮药丸胶囊 */}
              <div className="absolute top-2 right-2 flex items-center gap-0.5 p-0.5 rounded-full bg-background/90 dark:bg-background/95 backdrop-blur-md border border-border/70 shadow-xs opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-all duration-150">
                {onTogglePinInCategory && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-7 w-7 rounded-full transition-colors",
                      isPinnedInCategory ? "text-amber-500 bg-amber-500/10" : "text-muted-foreground hover:text-amber-500"
                    )}
                    title={isPinnedInCategory ? "取消分类内置顶" : "置顶在当前分类首位"}
                    onClick={handleCategoryPin}
                  >
                    <Pin className={cn("w-3.5 h-3.5", isPinnedInCategory && "fill-amber-500")} />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent"
                  title="速览与行动"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onPeek?.(item)
                  }}
                >
                  <Eye className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-full text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                  title="📌 固定到工作台"
                  onClick={handleWorkbenchPin}
                >
                  <Pin className="w-3.5 h-3.5" />
                </Button>
                <FavoriteButton
                  site={{ siteId: item.id, title: item.title, href: item.href, icon: item.icon, description: item.description }}
                />
              </div>
            </Card>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" className="max-w-[280px] text-xs">
            <p>{item.description || item.title}</p>
            <p className="text-[10px] text-muted-foreground pt-1 border-t mt-1">💡 按 Space 空格键呼出沙箱速览与微动作</p>
          </TooltipContent>
        </Tooltip>
    )
  }

  // 3. 标准现代卡片 (Standard Mode - 默认)
  return (
    <Tooltip>
        <TooltipTrigger asChild>
          <Card
            tabIndex={0}
            data-navhub-site-id={item.id}
            data-navhub-selected={selected ? 'true' : undefined}
            onKeyDown={handleKeyDown}
            draggable={isDraggable}
            onDragStart={handleDragStart}
            className={cn(
              "group @container relative overflow-hidden rounded-xl border border-border/70 hover:border-primary/40 bg-card/85 dark:bg-card/45 backdrop-blur-xs depth-card hover:shadow-md dark:hover:shadow-primary/5 nav-card-glow transition-all duration-200 transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-primary/40",
              isPinnedInCategory && "ring-1 ring-amber-500/40 bg-amber-500/4 border-amber-500/30",
              isDraggable && "cursor-grab active:cursor-grabbing hover:border-primary/60 hover:ring-1 hover:ring-primary/30",
              selectionClass
            )}
          >
            {isPinnedInCategory && (
              <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-medium">
                <Pin className="w-2.5 h-2.5 fill-amber-500" />
                <span>已置顶</span>
              </div>
            )}

            <Link
              href={safeHref(item.href)}
              target={linkTarget}
              rel="noopener noreferrer"
              data-prefetch-target="true"
              onClick={handleLinkClick}
              className="block h-full"
            >
              <CardHeader className="p-[var(--density-card-padding,0.875rem)]">
                <div className="flex items-start gap-2.5 @[280px]:gap-3">
                  <div className="flex-shrink-0 w-9 h-9 @[280px]:w-10 @[280px]:h-10 rounded-lg p-1.5 bg-muted/50 dark:bg-muted/20 border border-border/50 flex items-center justify-center transition-transform duration-200 group-hover:scale-105 shadow-xs">
                    <SiteFavicon
                      title={item.title}
                      url={item.href}
                      icon={item.icon}
                      useDefaultIcon={item.useDefaultIcon}
                      className="w-full h-full object-contain rounded-xs"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap pr-20">
                      <CardTitle className="text-sm font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors truncate">
                        {item.title}
                      </CardTitle>
                      {item.liveMetrics?.githubStars && (
                        <span className="inline-flex items-center gap-0.5 text-xs font-mono font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                          <Star className="w-2.5 h-2.5 text-amber-500 fill-amber-500" />
                          {(item.liveMetrics.githubStars / 1000).toFixed(0)}k
                        </span>
                      )}
                      {item.health?.ok === false && (
                        <span
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onPeek?.(item)
                          }}
                          className="inline-flex items-center gap-0.5 text-[10px] font-mono font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full hover:bg-amber-500/20 transition-colors cursor-pointer"
                          title="检测到站点当前无法直连，点击开启时光机历史快照自愈"
                        >
                          <Clock className="w-2.5 h-2.5 text-amber-500" />
                          <span>快照自愈</span>
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <CardDescription className="text-xs text-muted-foreground/90 line-clamp-2 leading-relaxed mt-1">
                        {item.description}
                      </CardDescription>
                    )}

                    {/* 动态特性：平替雷达徽标 / 微动作提示 */}
                    {(topAlternative || (item.actions && item.actions.length > 0)) && (
                      <div className="flex items-center gap-1.5 pt-1.5 flex-wrap">
                        {topAlternative && (
                          <span
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              onPeek?.(item)
                            }}
                            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium hover:bg-indigo-500/20 border border-indigo-500/20 transition-colors cursor-pointer"
                          >
                            <span>平替: {topAlternative.targetTitle}</span>
                          </span>
                        )}
                        {item.actions && item.actions.length > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-xs text-amber-600 dark:text-amber-400 font-medium bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                            <Zap className="w-2.5 h-2.5" />
                            <span>深链</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </CardHeader>
            </Link>

            {/* 操作区：右上角悬浮药丸胶囊 */}
            <div className="absolute top-1.5 right-1.5 @[280px]:top-2 @[280px]:right-2 flex items-center gap-0.5 p-0.5 rounded-full bg-background/85 dark:bg-background/90 backdrop-blur-md border border-border/60 shadow-xs opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-all duration-150">
              {onTogglePinInCategory && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-6.5 w-6.5 rounded-full transition-colors",
                    isPinnedInCategory ? "text-amber-500 bg-amber-500/10" : "text-muted-foreground hover:text-amber-500"
                  )}
                  title={isPinnedInCategory ? "取消分类内置顶" : "置顶在当前分类首位"}
                  onClick={handleCategoryPin}
                >
                  <Pin className={cn("w-3.5 h-3.5", isPinnedInCategory && "fill-amber-500")} />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6.5 w-6.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent"
                title="按空格键或点击速览详情与行动"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onPeek?.(item)
                }}
              >
                <Eye className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6.5 w-6.5 rounded-full text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                title="📌 固定到模块化工作台快捷启动坞"
                onClick={handleWorkbenchPin}
              >
                <Pin className="w-3.5 h-3.5" />
              </Button>
              <FavoriteButton
                site={{ siteId: item.id, title: item.title, href: item.href, icon: item.icon, description: item.description }}
              />
            </div>
          </Card>
        </TooltipTrigger>

        <TooltipContent 
          side="bottom" 
          align="center"
          sideOffset={8}
          className="max-w-[280px] text-xs sm:text-sm"
        >
          <p>{item.description || item.title}</p>
          <p className="text-xs text-muted-foreground pt-1 border-t mt-1">💡 聚焦时按 Space 空格键呼出沙箱速览与微动作</p>
        </TooltipContent>
      </Tooltip>
  )
}
