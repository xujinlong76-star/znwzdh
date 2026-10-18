'use client'

import { Bookmark, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { useFavorites } from '@/hooks/useFavorites'

export function FavoritesDockWidget() {
  const favorites = useFavorites()
  const items = favorites.items.slice(0, 6)

  return (
    <div className="h-full flex flex-col justify-between p-3 select-none">
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium">
          <Bookmark className="w-3.5 h-3.5 text-pink-500" />
          <span>星标收藏快捷启动坞</span>
        </div>
        <Link href="/favorites" className="text-xs text-primary hover:underline flex items-center gap-0.5">
          <span>全部 ({favorites.items.length})</span>
          <ExternalLink className="w-2.5 h-2.5" />
        </Link>
      </div>

      <div className="flex-1 py-1.5 overflow-y-auto min-h-0">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-2 text-xs text-muted-foreground space-y-1">
            <p>暂无收藏站点</p>
            <Link href="/" className="text-xs text-primary hover:underline">
              去主页探索并点击星标添加
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {items.map((site) => (
              <a
                key={site.siteId}
                href={site.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 p-1.5 rounded-lg bg-muted/30 hover:bg-muted/60 border border-border/40 hover:border-primary/40 transition-all group"
              >
                <div className="w-5 h-5 rounded bg-muted/60 flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0 overflow-hidden">
                  {site.icon ? (
                    <img src={site.icon} alt="" loading="lazy" decoding="async" className="w-full h-full object-contain" />
                  ) : (
                    site.title.slice(0, 1)
                  )}
                </div>
                <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors truncate">
                  {site.title}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="pt-1 text-xs text-muted-foreground/70 text-center font-mono">
        已集成 E2EE 零知识本地同步
      </div>
    </div>
  )
}
