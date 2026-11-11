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
  if (state === 'frozen') return 'bg-sky-400/70'
  if (state === 'rescued') return 'bg-violet-400/70'
  if (state === 'rest') return 'bg-muted/30'
  if (xp <= 0) return 'bg-muted/50'
  if (xp < 40) return 'bg-primary/25'
  if (xp < 90) return 'bg-primary/55'
  return 'bg-primary'
}

export function GrowthHeatmap({ profile }: { profile: GrowthProfile }) {
  const cells = heatmapCells(profile)
  return (
    <figure aria-label="近 16 周活跃热力图">
      <div className="grid grid-flow-col grid-rows-7 gap-[3px] overflow-x-auto pb-1">
        {cells.map((c) => (
          <span
            key={c.key}
            title={`${c.key} · +${c.xp} 经验${c.state ? ` · ${STATE_LABEL[c.state] ?? ''}` : ''}${c.milestone ? ' · 里程碑日' : ''}`}
            className={cn('h-3 w-3 rounded-[3px]', cellClass(c.xp, c.state), c.milestone && 'ring-1 ring-amber-400')}
          />
        ))}
      </div>
      <figcaption className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>颜色越深，那天用得越多</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[3px] bg-sky-400/70" />冻结垫付</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[3px] bg-violet-400/70" />抢救接回</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[3px] ring-1 ring-amber-400" />里程碑日</span>
      </figcaption>
    </figure>
  )
}
