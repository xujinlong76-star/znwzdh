'use client'

/**
 * 个性化摘要卡：开关、近 30 天信号计数、按类型清理。
 *
 * 这些能力原先内嵌在 1238 行的 `/me` 里，拆分后保留原交互与文案；
 * 更完整的画像解释仍在 `/preferences`。
 */
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight, Wand2 } from 'lucide-react'
import type { HubProfileExplain } from '@/lib/navhub-api'

const SIGNAL_KINDS = [
  ['click', '清理点击信号'],
  ['search', '清理搜索信号'],
  ['favorite', '清理收藏信号'],
] as const

export function PersonalizationCard({
  enabled,
  busy,
  explain,
  onToggle,
  onClearSignal,
}: {
  enabled: boolean
  busy: boolean
  explain: HubProfileExplain | null
  onToggle: () => void
  onClearSignal: (kind: 'click' | 'search' | 'favorite') => void
}) {
  return (
    <section className="flex h-full flex-col rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Wand2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            个性化
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            决定搜索结果排序与画像是否继续更新
          </p>
        </div>
        <Button
          variant={enabled ? 'outline' : 'default'}
          size="sm"
          className="w-full text-xs sm:w-auto"
          disabled={busy}
          onClick={onToggle}
          aria-pressed={enabled}
        >
          {enabled ? '已开启 · 点击关闭' : '已关闭 · 点击开启'}
        </Button>
      </div>

      <p className="mt-3 max-w-prose text-xs leading-relaxed text-muted-foreground">
        关闭后搜索结果不再按你的点击/收藏偏好排序，也不再更新画像；收藏与历史本身不受影响。
      </p>

      {explain?.explain && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
          <span>近 {explain.explain.windowDays} 天信号</span>
          <span>
            点击 <span className="font-medium tabular-nums text-foreground">{explain.explain.signalCounts.click}</span>
          </span>
          <span>
            收藏 <span className="font-medium tabular-nums text-foreground">{explain.explain.signalCounts.favorite}</span>
          </span>
          <span>
            搜索 <span className="font-medium tabular-nums text-foreground">{explain.explain.signalCounts.searches}</span>
          </span>
          {explain.profile?.topTags.length ? (
            <span className="min-w-0 max-w-full truncate" title={explain.profile.topTags.slice(0, 3).join('、')}>
              偏好标签 {explain.profile.topTags.slice(0, 3).join('、')}
            </span>
          ) : null}
        </div>
      )}

      <div className="mt-4 border-t border-border/60 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">按信号类型清理（画像会按剩余行为重建）</p>
          <Link
            href="/preferences"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            完整画像
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {SIGNAL_KINDS.map(([kind, label]) => (
            <Button
              key={kind}
              variant="outline"
              size="sm"
              className="text-[11px]"
              disabled={busy}
              onClick={() => onClearSignal(kind)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
    </section>
  )
}
