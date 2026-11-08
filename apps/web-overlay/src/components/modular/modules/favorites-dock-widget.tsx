'use client'

import React, { useState, useEffect } from 'react'
import { Bookmark, ExternalLink, Clock, Copy, Plus } from 'lucide-react'
import { safeHref } from '@/lib/safe-url'
import { SiteFavicon } from '@/components/site-favicon'
import Link from 'next/link'
import { useFavorites } from '@/hooks/useFavorites'
import { readOfflineVisits, type RecentVisit } from '@/lib/offline-recent'
import { useToast } from '@/components/ui/use-toast'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

export function FavoritesDockWidget() {
  const { toast } = useToast()
  const favorites = useFavorites()
  const [activeTab, setActiveTab] = useState<'favorites' | 'history'>('favorites')
  const [recentVisits, setRecentVisits] = useState<RecentVisit[]>([])

  useEffect(() => {
    let active = true
    readOfflineVisits(12)
      .then((rows) => {
        if (active && Array.isArray(rows)) {
          setRecentVisits(rows)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const favItems = favorites.items.slice(0, 6)
  const historyItems = recentVisits.slice(0, 6)

  const handleCopy = async (e: React.MouseEvent, href: string, title: string) => {
    e.preventDefault()
    e.stopPropagation()
    const res = await copyText(href)
    if (res.ok) {
      toast({ title: '已复制网址', description: `「${title}」链接已复制到剪贴板` })
    }
  }

  return (
    <div className="h-full flex flex-col justify-between p-3 select-none">
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('favorites')}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors cursor-pointer text-xs font-semibold',
              activeTab === 'favorites'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Bookmark className="w-3.5 h-3.5 text-pink-500" />
            <span>收藏 ({favorites.items.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors cursor-pointer text-xs font-semibold',
              activeTab === 'history'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Clock className="w-3.5 h-3.5 text-emerald-500" />
            <span>足迹 ({recentVisits.length})</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/import"
            className="text-[11px] text-primary/80 hover:text-primary hover:underline flex items-center gap-0.5"
            title="一键导入浏览器书签或 HTML 文件"
          >
            <span>📥 导入书签</span>
          </Link>
          <Link
            href="/favorites"
            className="text-xs text-primary hover:underline flex items-center gap-0.5"
          >
            <span>全部 ({favorites.items.length})</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </Link>
        </div>
      </div>

      <div className="flex-1 py-1.5 overflow-y-auto min-h-0">
        {activeTab === 'favorites' ? (
          favItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-2 text-xs text-muted-foreground space-y-2">
              <p className="text-muted-foreground">暂无星标收藏站点</p>
              <div className="flex items-center gap-2">
                <Link
                  href="/import"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/25 font-medium transition-colors text-xs"
                >
                  <Plus className="w-3 h-3" />
                  <span>智能书签导入</span>
                </Link>
                <Link
                  href="/"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted text-foreground border border-border/50 font-medium transition-colors text-xs"
                >
                  <span>主页探索</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {favItems.map((site) => (
                <div
                  key={site.siteId}
                  className="group relative flex items-center gap-2 p-1.5 rounded-lg bg-muted/30 hover:bg-muted/60 border border-border/40 hover:border-primary/40 transition-all"
                >
                  <div className="w-5 h-5 rounded bg-muted/60 flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0 overflow-hidden">
                    <SiteFavicon
                      title={site.title}
                      url={site.href}
                      icon={site.icon}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <a
                    href={safeHref(site.href)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-xs font-medium text-foreground group-hover:text-primary transition-colors after:absolute after:inset-0 after:z-0"
                    title={site.title}
                  >
                    {site.title}
                  </a>
                  <button
                    type="button"
                    onClick={(e) => handleCopy(e, site.href, site.title)}
                    className="relative z-10 opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-opacity cursor-pointer"
                    title="复制网址"
                    aria-label={`复制 ${site.title} 网址`}
                  >
                    <Copy className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )
        ) : (
          historyItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-2 text-xs text-muted-foreground space-y-1">
              <p className="text-muted-foreground">暂无本机最近访问足迹</p>
              <p className="text-[11px] text-muted-foreground">点击主页站点卡片将自动沉淀足迹</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {historyItems.map((visit) => (
                <div
                  key={visit.id}
                  className="group relative flex items-center gap-2 p-1.5 rounded-lg bg-muted/30 hover:bg-muted/60 border border-border/40 hover:border-primary/40 transition-all"
                >
                  <div className="w-5 h-5 rounded bg-muted/60 flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0 overflow-hidden">
                    <SiteFavicon
                      title={visit.title}
                      url={visit.href}
                      icon={visit.icon}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <a
                    href={safeHref(visit.href)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-xs font-medium text-foreground group-hover:text-primary transition-colors after:absolute after:inset-0 after:z-0"
                    title={visit.title}
                  >
                    {visit.title}
                  </a>
                  <button
                    type="button"
                    onClick={(e) => handleCopy(e, visit.href, visit.title)}
                    className="relative z-10 opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-opacity cursor-pointer"
                    title="复制网址"
                    aria-label={`复制 ${visit.title} 网址`}
                  >
                    <Copy className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <div className="pt-1 text-xs text-muted-foreground text-center font-mono">
        已集成 E2EE 零知识本地同步
      </div>
    </div>
  )
}
