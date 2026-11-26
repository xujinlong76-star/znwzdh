'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 可关闭推广横幅（2026-11-25 UI 评审 P0-1 阶段 B 的 PromoBanner 原语）：
 * 只出现在页面头部 slot，关闭后记忆 7 天不再打扰。
 *
 * 此前 /sites 顶部的「视频库」推广条写死在视图里、没有关闭出口。收成原语后：
 *   - 内容（icon/标题/描述/CTA）由调用方传入，组件只管壳与关闭记忆；
 *   - 关闭时间戳写 localStorage（键由调用方给，多条推广互不干扰）；
 *   - 服务端首帧与水合首帧都渲染「未关闭」，挂载后再按记忆隐藏——
 *     两端一致，不制造 hydration mismatch（短暂闪现是已知取舍）。
 *
 * 样式沿用推广条现用的 primary/5 底 + primary/20 描边（已是 Token 体系内）。
 */

/** 关闭后的静默天数（评审 P0-1 规格：7 天） */
export const PROMO_MUTE_DAYS = 7

/** 关闭时刻 → 静默到期时刻（导出供测试钉口径） */
export function promoHiddenUntil(dismissedAt: number): number {
  return dismissedAt + PROMO_MUTE_DAYS * 24 * 60 * 60 * 1000
}

export function PromoBanner({
  storageKey,
  icon,
  title,
  description,
  actionHref,
  actionLabel,
  className,
}: {
  /** localStorage 键（每个推广位一个，如 navhub.promo.video-hub.v1） */
  storageKey: string
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  actionHref?: string
  /** CTA 文案（可传入图标，如「探索精选视频库 →」） */
  actionLabel?: ReactNode
  className?: string
}) {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let muted = false
    try {
      const until = Number(localStorage.getItem(storageKey) ?? '')
      muted = Number.isFinite(until) && Date.now() < until
    } catch {
      // localStorage 不可用（隐私模式等）：不隐藏、也不报错
    }
    setHidden(muted)
  }, [storageKey])

  if (hidden) return null

  const dismiss = () => {
    setHidden(true)
    try {
      localStorage.setItem(storageKey, String(promoHiddenUntil(Date.now())))
    } catch {
      // 写不进去就只对本次会话生效
    }
  }

  return (
    <div
      role="note"
      className={cn(
        'flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-primary/20 bg-primary/5 text-xs text-foreground',
        className,
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {icon ? <span className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">{icon}</span> : null}
        <div className="min-w-0">
          <span className="font-semibold text-foreground block text-sm">{title}</span>
          {description ? (
            <span className="text-muted-foreground text-xs block truncate">{description}</span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {actionHref && actionLabel ? (
          <Link
            href={actionHref}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors text-xs shadow-2xs pointer-coarse:min-h-11"
          >
            {actionLabel}
          </Link>
        ) : null}
        <button
          type="button"
          onClick={dismiss}
          aria-label={`关闭此提示，${PROMO_MUTE_DAYS} 天内不再显示`}
          title={`${PROMO_MUTE_DAYS} 天内不再显示`}
          className="inline-flex items-center justify-center h-7 w-7 pointer-coarse:h-11 pointer-coarse:w-11 rounded-lg text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      </div>
    </div>
  )
}
