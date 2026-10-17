'use client'

import { Star } from 'lucide-react'
import { useFavorites } from '@/hooks/useFavorites'
import { useToast } from '@/components/ui/use-toast'

interface FavoriteButtonProps {
  site: { siteId: string; title: string; href: string; icon?: string; description?: string }
  className?: string
}

/** 站点卡片上的收藏星标。点击不冒泡（不触发卡片的链接跳转）。 */
export function FavoriteButton({ site, className }: FavoriteButtonProps) {
  const favorites = useFavorites()
  const { toast } = useToast()
  const faved = favorites.isFavorite(site.siteId)

  return (
    <button
      title={faved ? '取消收藏' : '收藏'}
      aria-label={faved ? '取消收藏' : '收藏'}
      className={'inline-flex items-center justify-center rounded-md p-1.5 transition-colors hover:bg-muted ' + (className ?? '')}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        // 存储读不出来时收藏会被拒绝（为了不覆盖原数据）：必须说出来，
        // 否则用户看到的是「点了星星没反应」
        if (favorites.storageBlocked) {
          toast({ title: '这一下没能保存', description: favorites.storageBlocked, variant: 'destructive' })
          return
        }
        void favorites.toggle(site)
      }}
    >
      <Star className={'h-4 w-4 ' + (faved ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/60')} />
    </button>
  )
}
