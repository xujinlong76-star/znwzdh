'use client'

/**
 * 近 16 周成长热力图：一格一天，颜色深浅 = 当日经验，金框 = 里程碑日
 * （升级日 / 连胜里程碑日），蓝格 = 冻结卡垫付日，紫格 = 抢救日，灰格 = 休息日。
 * 数据全部派生自 growth.ts 的热力单元（xp / 日状态 / 里程碑标记），不编造。
 */

import { heatmapCells, type GrowthProfile } from '@/lib/growth'
import { cn } from '@/lib/utils'

const STATE_LABEL: Record<string, string> = {
  lit: '到访',
  frozen: '冻结卡垫付',
  rescued: '抢救接回',
  rest: '休息日',
}

function cellClass(xp: number, state: string | null): string {
  if (state === 'frozen') return 'bg-sky-400/80 dark:bg-sky-400/75'
  if (state === 'rescued') return 'bg-violet-400/80 dark:bg-violet-400/75'
  if (state === 'rest') return 'bg-zinc-200/50 dark:bg-zinc-800/50'
  if (xp <= 0) return 'bg-zinc-200/85 dark:bg-zinc-800/90'
  if (xp < 40) return 'bg-primary/30 dark:bg-primary/35'
  if (xp < 90) return 'bg-primary/60 dark:bg-primary/65'
  return 'bg-primary'
}

export function GrowthHeatmap({ profile }: { profile: GrowthProfile }) {
  const cells = heatmapCells(profile)
  const activeDays = cells.filter(
    (c) => c.xp > 0 || c.state === 'lit' || c.state === 'frozen' || c.state === 'rescued',
  ).length

  return (
    <figure
      aria-label="近 16 周活跃热力图"
      className="rounded-xl border border-border/60 bg-background/60 px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <span className="text-xs font-medium text-foreground">近 16 周活跃日历</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          累计活跃 <strong className="font-semibold text-foreground">{activeDays}</strong> 天
        </span>
      </div>
      {/* w-fit 保证 16 列方格紧致排列，不再被拉宽至 1100px 变成稀疏竖条 */}
      <div className="overflow-x-auto pb-1">
        <div className="grid w-fit grid-flow-col grid-rows-7 gap-1">
          {cells.map((c) => (
            <span
              key={c.key}
              title={`${c.key} · +${c.xp} 经验${c.state ? ` · ${STATE_LABEL[c.state] ?? ''}` : ''}${c.milestone ? ' · 里程碑日' : ''}`}
              className={cn(
                'h-3 w-3 rounded-[3px] transition-colors',
                cellClass(c.xp, c.state),
                c.milestone && 'ring-1 ring-amber-400',
              )}
            />
          ))}
        </div>
      </div>
      <figcaption className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span>少</span>
          <span className="h-2.5 w-2.5 rounded-[2px] bg-zinc-200/85 dark:bg-zinc-800/90" />
          <span className="h-2.5 w-2.5 rounded-[2px] bg-primary/30 dark:bg-primary/35" />
          <span className="h-2.5 w-2.5 rounded-[2px] bg-primary/60 dark:bg-primary/65" />
          <span className="h-2.5 w-2.5 rounded-[2px] bg-primary" />
          <span>多</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-sky-400/80" />
            冻结垫付
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-violet-400/80" />
            抢救接回
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-[2px] ring-1 ring-amber-400" />
            里程碑日
          </span>
        </span>
      </figcaption>
    </figure>
  )
}
