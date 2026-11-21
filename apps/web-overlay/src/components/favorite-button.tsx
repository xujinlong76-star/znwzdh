'use client'

import { Star } from 'lucide-react'
import { useFavorites } from '@/hooks/useFavorites'
import { useToast } from '@/components/ui/use-toast'

interface FavoriteButtonProps {
  site: { siteId: string; title: string; href: string; icon?: string; description?: string }
  className?: string
  /**
   * 卡片内的星标参与「整卡一个 Tab 停留点」的复合控件模型：
   * 由卡片操作区的方向键导航聚焦，因此传 -1 退出 Tab 序列。
   * 独立使用（搜索结果、详情页）时不传，保持原生可聚焦。
   */
  tabIndex?: number
  /** 标记为卡片操作项，供操作区 ←/→ 导航查询 */
  cardAction?: boolean
}

/** 站点卡片上的收藏星标。点击不冒泡（不触发卡片的链接跳转）。 */
export function FavoriteButton({ site, className, tabIndex, cardAction }: FavoriteButtonProps) {
  const favorites = useFavorites()
  const { toast } = useToast()
  const faved = favorites.isFavorite(site.siteId)

  return (
    <button
      tabIndex={tabIndex}
      data-card-action={cardAction ? '' : undefined}
      title={faved ? `取消收藏${site.title ? '：' + site.title : ''}` : `收藏${site.title ? '：' + site.title : ''}`}
      aria-label={faved ? `取消收藏${site.title ? '：' + site.title : ''}` : `收藏${site.title ? '：' + site.title : ''}`}
      className={
        (cardAction
          ? // 卡片内星标（卡片悬浮修复 2026-11-20）：星标已移出 26px 密集按钮簇、
            // 独立居卡片右上角，故可用 ::after 把点击区无形扩到 44×44
            // （26 + 9×2，视觉仍是 26px 小星标；标题行 pr-10/pr-14 留位
            // 54/70px，扩区最远到 43px，不盖标题链接——见 mobile-touch-targets
            // 的跟进项已随本布局决策释放）。
            "relative inline-flex items-center justify-center h-6.5 w-6.5 rounded-full transition-colors hover:bg-accent after:absolute after:-inset-[9px] after:content-[''] "
          : // 独立使用（搜索结果、热榜、详情页、速览对话框）：行高足够，直接给足 44px。
            'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-1.5 transition-colors hover:bg-muted ') +
        (className ?? '')
      }
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        // 存储读不出来时收藏会被拒绝（为了不覆盖原数据）：必须说出来，
        // 否则用户看到的是「点了星星没反应」
        if (favorites.storageBlocked) {
          toast({ title: '这一下没能保存', description: favorites.storageBlocked, variant: 'destructive' })
          return
        }
        // 卡片悬浮修复 2026-11-20：切换成功后立即给 toast 反馈（旧代码
        // 只在存储被拒时提示，成功时静默——用户无法确认星标是否点上）。
        // toggle 返回切换后是否已收藏；写失败时返回旧态，不 toast。
        const wasFaved = favorites.isFavorite(site.siteId)
        void favorites.toggle(site).then((nowFaved) => {
          if (nowFaved === wasFaved) return
          toast({ title: nowFaved ? `已收藏${site.title ? '：' + site.title : ''}` : `已取消收藏${site.title ? '：' + site.title : ''}` })
        })
      }}
    >
      <Star className={(cardAction ? 'w-3.5 h-3.5 ' : 'h-4 w-4 ') + (faved ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground')} />
    </button>
  )
}
