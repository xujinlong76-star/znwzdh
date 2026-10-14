'use client'

import { Star } from 'lucide-react'
import { useFavorites } from '@/hooks/useFavorites'

interface FavoriteButtonProps {
  site: { siteId: string; title: string; href: string; icon?: string; description?: string }
  className?: string
}

/** 站点卡片上的收藏星标。点击不冒泡（不触发卡片的链接跳转）。 */
export function FavoriteButton({ site, className }: FavoriteButtonProps) {
  const favorites = useFavorites()
  const faved = favorites.isFavorite(site.siteId)

  return (
    <button
      title={faved ? '取消收藏' : '收藏'}
      aria-label={faved ? '取消收藏' : '收藏'}
      className={'inline-flex items-center justify-center rounded-md p-1.5 transition-colors hover:bg-muted ' + (className ?? '')}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void favorites.toggle(site)
      }}
    >
      <Star className={'h-4 w-4 ' + (faved ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/60')} />
    </button>
  )
}
