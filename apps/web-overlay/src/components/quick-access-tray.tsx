'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { readOfflineVisits, type RecentVisit } from '@/lib/offline-recent'
import { useFavorites, type LocalFavorite } from '@/hooks/useFavorites'
import { SiteFavicon } from '@/components/site-favicon'
import { safeHref, safeWindowOpen } from '@/lib/safe-url'
import { Button } from '@/registry/new-york/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { copyText, copyFailureToast } from '@/lib/clipboard'
import { Star, Clock, Copy, ExternalLink, ChevronDown, ChevronUp, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QuickAccessTrayProps {
  className?: string
}

export function QuickAccessTray({ className }: QuickAccessTrayProps) {
  const { toast } = useToast()
  const { items: favorites = [], remove } = useFavorites()
  const [recentVisits, setRecentVisits] = useState<RecentVisit[]>([])
  const [isOpen, setIsOpen] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<'all' | 'favorites' | 'recent'>('all')

  const refreshRecent = useCallback(async () => {
    try {
      const visits = await readOfflineVisits(12)
      setRecentVisits(visits)
    } catch {
      // 容错降级
    }
  }, [])

  // 综合展示列表：置顶收藏在前，最近访问（去重后）在后
  const favList = useMemo(() => Array.isArray(favorites) ? favorites : [], [favorites])
  const recentList = useMemo(() => Array.isArray(recentVisits) ? recentVisits : [], [recentVisits])
  const favoriteIds = useMemo(() => new Set(favList.map(f => f.siteId)), [favList])
  const dedupedRecent = useMemo(() => recentList.filter(r => !favoriteIds.has(r.id)), [recentList, favoriteIds])

  const displayItems = useMemo(() => {
    return activeTab === 'favorites'
      ? favList.map(f => ({ id: f.siteId, title: f.title, href: f.href, icon: f.icon, isPinned: true }))
      : activeTab === 'recent'
        ? dedupedRecent.map(r => ({ id: r.id, title: r.title, href: r.href, icon: r.icon, isPinned: false }))
        : [
            ...favList.map(f => ({ id: f.siteId, title: f.title, href: f.href, icon: f.icon, isPinned: true })),
            ...dedupedRecent.map(r => ({ id: r.id, title: r.title, href: r.href, icon: r.icon, isPinned: false }))
          ]
  }, [activeTab, favList, dedupedRecent])

  useEffect(() => {
    setMounted(true)
    refreshRecent()

    // 存储变化或窗口聚焦时自动刷新
    const handleFocus = () => refreshRecent()
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [refreshRecent])

  // 极客专属：数字键 1~9 秒开常用站点
  useEffect(() => {
    if (!mounted || !isOpen || displayItems.length === 0) return

    const handleDigitKeyDown = (e: KeyboardEvent) => {
      // 1. 输入法组合状态（IME composition）静默，防拼音选词误触
      if (e.isComposing || e.keyCode === 229) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return

      // 2. 存在弹窗对话框或处于卡片批量整理模式时静默，保障主心流不被打断
      if (typeof document !== 'undefined') {
        if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
        if (document.querySelector('[data-navhub-selected="true"]')) return
      }

      if (e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key, 10) - 1
        if (index < displayItems.length) {
          const site = displayItems[index]
          if (site?.href) {
            e.preventDefault()
            const safe = safeHref(site.href, '')
            if (safe) {
              safeWindowOpen(safe)
              toast({
                title: `⚡ 数字键 ${e.key} 直达`,
                description: `正在新窗口打开「${site.title}」`,
              })
            }
          }
        }
      }
    }

    window.addEventListener('keydown', handleDigitKeyDown)
    return () => window.removeEventListener('keydown', handleDigitKeyDown)
  }, [mounted, isOpen, displayItems, toast])

  const copyUrl = async (e: React.MouseEvent, href: string, title: string) => {
    e.preventDefault()
    e.stopPropagation()
    const safe = safeHref(href, '')
    if (!safe) return
    const res = await copyText(safe)
    if (res.ok) {
      toast({
        title: '已复制网址',
        description: `「${title}」链接已复制到剪贴板`,
      })
    } else {
      const note = copyFailureToast(res)
      toast({
        title: note.title,
        description: note.description,
        variant: 'destructive',
      })
    }
  }

  if (!mounted) return null

  const totalCount = favList.length + dedupedRecent.length
  if (totalCount === 0) return null

  return (
    <section
      id="quick-access-tray"
      aria-label="我的常用与最近访问"
      className={cn(
        "mb-6 rounded-2xl border border-border/70 bg-card/80 dark:bg-card/40 backdrop-blur-md p-3.5 sm:p-4 shadow-xs transition-all duration-200",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-amber-500/10 text-amber-500">
            <Star className="h-4 w-4 fill-amber-500" />
          </div>
          <span className="text-xs sm:text-sm font-semibold tracking-tight text-foreground">
            常用与最近访问
          </span>
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
            {displayItems.length}
          </span>
          <span className="hidden sm:inline-flex items-center text-[10px] text-muted-foreground font-mono bg-muted/60 px-1.5 py-0.5 rounded border border-border/40">
            按 1-9 秒开
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* 筛选切换 */}
          <div className="inline-flex rounded-lg bg-muted/60 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={cn(
                "px-2 py-0.5 rounded-md transition-all text-[11px]",
                activeTab === 'all'
                  ? "bg-background text-foreground font-medium shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              全部
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('favorites')}
              className={cn(
                "px-2 py-0.5 rounded-md transition-all text-[11px] flex items-center gap-1",
                activeTab === 'favorites'
                  ? "bg-background text-foreground font-medium shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
              <span>收藏 ({favorites.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('recent')}
              className={cn(
                "px-2 py-0.5 rounded-md transition-all text-[11px] flex items-center gap-1",
                activeTab === 'recent'
                  ? "bg-background text-foreground font-medium shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Clock className="h-3 w-3" />
              <span>足迹 ({dedupedRecent.length})</span>
            </button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setIsOpen(v => !v)}
            aria-label={isOpen ? "折叠常用栏" : "展开常用栏"}
          >
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {isOpen && (
        <div className="pt-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-2.5">
            {displayItems.map((site, idx) => (
              <a
                key={site.id}
                href={safeHref(site.href)}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex items-center gap-2.5 p-2 rounded-xl border border-border/50 bg-background/50 hover:bg-accent/40 hover:border-border hover:shadow-xs transition-all duration-150 overflow-hidden"
              >
                <div className="shrink-0 relative">
                  <SiteFavicon
                    url={site.href}
                    icon={site.icon ?? undefined}
                    title={site.title}
                    size={24}
                    className="h-6 w-6 rounded-md shadow-2xs"
                  />
                  {site.isPinned && (
                    <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-background" title="置顶常用" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">
                      {site.title}
                    </span>
                    {idx < 9 && (
                      <kbd className="hidden sm:inline-flex items-center justify-center h-4 min-w-4 px-1 rounded text-[9px] font-mono font-semibold bg-muted/80 text-muted-foreground border border-border/60 shrink-0" title={`按键盘数字键 ${idx + 1} 直接在新窗口打开`}>
                        {idx + 1}
                      </kbd>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate font-mono">
                    {(() => {
                      try {
                        return new URL(site.href).hostname.replace(/^www\./, '')
                      } catch {
                        return site.href
                      }
                    })()}
                  </div>
                </div>

                {/* 悬停微动作 */}
                <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-background/95 backdrop-blur-xs rounded-md shadow-xs border border-border/60 p-0.5">
                  <button
                    type="button"
                    onClick={(e) => copyUrl(e, site.href, site.title)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                    title="复制链接"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  {site.isPinned && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        remove(site.id)
                      }}
                      className="p-1 rounded text-muted-foreground hover:text-destructive-text hover:bg-destructive/15 transition-colors"
                      title="取消常用"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
