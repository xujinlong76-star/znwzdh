'use client'

/**
 * 「固定到我的常用」按钮（2026-11-20 20:00 战略研究 W9 落地）。
 *
 * 与 FavoriteButton 同款模型：点击不冒泡、不触发卡片跳转；固定状态只存
 * 浏览器本地（`znw:personal:v1`），上限 24 个，超限时明确提示、不静默丢弃。
 * 卡片内用 `cardAction` 形态（26px 密集按钮簇）；命令面板站点行用默认形态。
 */
import { Pin } from 'lucide-react'
import { usePersonalData } from '@/hooks/usePersonalData'
import { useToast } from '@/components/ui/use-toast'

interface PersonalPinButtonProps {
  site: { siteId: string; title: string; href: string; icon?: string | null }
  tabIndex?: number
  /** 标记为卡片操作项，供操作区 ←/→ 导航查询 */
  cardAction?: boolean
}

export function PersonalPinButton({ site, tabIndex, cardAction }: PersonalPinButtonProps) {
  const personal = usePersonalData()
  const { toast } = useToast()
  const pinned = personal.isPinned(site.siteId)

  return (
    <button
      type="button"
      tabIndex={tabIndex}
      data-card-action={cardAction ? '' : undefined}
      title={pinned ? `从「我的常用」取消固定：${site.title}` : `固定到「我的常用」：${site.title}`}
      aria-label={pinned ? `从「我的常用」取消固定：${site.title}` : `固定到「我的常用」：${site.title}`}
      aria-pressed={pinned}
      className={
        (cardAction
          ? 'pointer-events-auto inline-flex items-center justify-center h-6 w-6 rounded-md transition-colors hover:bg-accent '
          : 'inline-flex items-center justify-center rounded-md p-1 transition-colors hover:bg-muted ') +
        (pinned ? 'text-amber-500 bg-amber-500/10 ' : 'text-muted-foreground hover:text-amber-500 ')
      }
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (personal.storageBlocked) {
          toast({ title: '这一下没能保存', description: personal.storageBlocked, variant: 'destructive' })
          return
        }
        const res = personal.togglePin({ siteId: site.siteId, title: site.title, href: site.href, icon: site.icon ?? null })
        if (!res.ok) {
          toast({ title: '固定失败', description: res.error ?? '请稍后重试', variant: 'destructive' })
          return
        }
        toast({
          title: pinned ? `已从「我的常用」取消固定：${site.title}` : `📌 已固定到「我的常用」：${site.title}`,
          description: pinned ? undefined : '首页顶部「我的常用」区可查看，数据只在你的浏览器里',
        })
      }}
    >
      <Pin className={(cardAction ? 'w-3 h-3 ' : 'h-4 w-4 ') + (pinned ? 'fill-amber-500' : '')} />
    </button>
  )
}
