'use client'

/**
 * 成长活跃热力图（近 4 周 / 近 16 周自适应视图）：
 *  - 新用户（累计活跃天数 < 7）：默认展示更饱满、格子尺寸更大的「近 4 周活跃日历」，
 *    避免 111 个灰格带来空态压迫感；右上角提供 [展开近 16 周] 轻量切换。
 *  - 老用户（累计活跃天数 >= 7）或手动展开 16 周：使用全宽自适应列网格铺满容器宽度
 *    （w-full + 等分列 + aspect-square），彻底消除右侧 45% 死白。
 *  - 颜色深浅 = 当日经验，金框 = 里程碑日，蓝格 = 冻结卡垫付日，紫格 = 抢救日，灰格 = 休息日。
 */

import { useEffect, useRef, useState } from 'react'
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
  if (state === 'rest') return 'bg-zinc-200/55 dark:bg-zinc-800/55'
  if (xp <= 0) return 'bg-zinc-200/85 dark:bg-zinc-800/90'
  if (xp < 40) return 'bg-amber-400/45 dark:bg-amber-400/35'
  if (xp < 90) return 'bg-amber-500/75 dark:bg-amber-400/70'
  return 'bg-amber-500 dark:bg-amber-400'
}

export function GrowthHeatmap({ profile }: { profile: GrowthProfile }) {
  /**
   * 16 周热力图在窄屏可横滚，挂载后自动滚到最右端（最新一周）。
   * 用 useRef + useEffect 而不是 CSS `scroll-snap-align: end`：
   * 后者只能"靠近"末尾，无法保证首帧就停在最右。
   */
  const weekScrollRef = useRef<HTMLDivElement | null>(null)
  const allCells = heatmapCells(profile)
  const activeDays = allCells.filter(
    (c) => c.xp > 0 || c.state === 'lit' || c.state === 'frozen' || c.state === 'rescued',
  ).length
  const isNewUser = activeDays < 7
  const [expanded16, setExpanded16] = useState<boolean | null>(null)
  const show16Weeks = expanded16 ?? !isNewUser
  // 近 4 周取尾部 28 天（4 列 × 7 行）
  const visibleCells = show16Weeks ? allCells : allCells.slice(-28)
  const colCount = Math.max(1, Math.ceil(visibleCells.length / 7))

  /**
   * 挂载/切换到 16 周模式后，把横滚容器定位到最右端（最新一周）。
   *
   * 时机选在 layout 之后：格子宽度由 grid 分配，首帧 scrollWidth 才是终值。
   * 移动端才需要（桌面端 overflow-visible，scrollWidth == clientWidth，
   * 滚不滚都不产生视觉差异）。
   */
  useEffect(() => {
    if (!show16Weeks) return
    const el = weekScrollRef.current
    if (!el) return
    // 只在真的溢出时滚动，避免桌面端无谓地写 scrollLeft
    if (el.scrollWidth > el.clientWidth + 1) {
      el.scrollLeft = el.scrollWidth - el.clientWidth
    }
  }, [show16Weeks, colCount])

  return (
    <figure
      aria-label={show16Weeks ? '近 16 周活跃热力图' : '近 4 周活跃热力图'}
      data-heatmap-mode={show16Weeks ? '16w' : '4w'}
      className="flex h-full flex-col justify-between rounded-xl border border-border/60 bg-background/65 px-3.5 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">
            {show16Weeks ? '近 16 周活跃日历' : '近 4 周活跃日历'}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            累计活跃 <strong className="font-semibold text-foreground">{activeDays}</strong> 天
          </span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded16(!show16Weeks)}
          aria-pressed={show16Weeks}
          className="rounded-lg border border-border/70 bg-muted/45 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {show16Weeks ? '收起至近 4 周' : '展开近 16 周'}
        </button>
      </div>

      {/* 自适应等比铺满容器宽度：近 4 周为饱满大格（7 列 × 4 行周视图），
          近 16 周为 w-full 16 列自适应弹性网格，彻底消除右侧大片死白。 */}
      {show16Weeks ? (
        /*
         * 2026-11-21 移动端改造：16 周 = 16 列 × 7 行 = 112 个格子。
         * 桌面端弹性铺满容器最舒服；但在 375px 手机上，112 格挤进 340px
         * 意味着每格约 5px——小到看不清也点不动。
         * 改为窄屏横向滚动：格子保持 14px 最小可点尺寸，容器可横滚，
         * 且默认滚到**最右端**（最新一周），符合"最近数据优先"的阅读习惯。
         */
        <div
          ref={weekScrollRef}
          className="no-scrollbar w-full overflow-x-auto pb-1 sm:overflow-visible"
        >
          <div
            className="grid grid-flow-col grid-rows-7 gap-1 max-sm:min-w-[340px] sm:w-full"
            style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
          >
            {visibleCells.map((c) => (
              <span
                key={c.key}
                title={`${c.key} · +${c.xp} 经验${c.state ? ` · ${STATE_LABEL[c.state] ?? ''}` : ''}${c.milestone ? ' · 里程碑日' : ''}`}
                className={cn(
                  'aspect-square w-full min-h-[10px] rounded-[3px] transition-colors',
                  cellClass(c.xp, c.state),
                  c.milestone && 'ring-1 ring-amber-500 dark:ring-amber-400',
                )}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="w-full pb-1">
          <div className="mb-1.5 grid grid-cols-7 gap-1.5 text-center text-[10px] text-muted-foreground">
            {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
              <span key={w}>周{w}</span>
            ))}
          </div>
          <div className="grid w-full grid-cols-7 gap-1.5">
            {visibleCells.map((c) => {
              const dayNum = c.key.slice(-2).replace(/^0/, '')
              const isLit = c.xp > 0 || c.state === 'lit' || c.state === 'frozen' || c.state === 'rescued'
              return (
                <span
                  key={c.key}
                  title={`${c.key} · +${c.xp} 经验${c.state ? ` · ${STATE_LABEL[c.state] ?? ''}` : ''}${c.milestone ? ' · 里程碑日' : ''}`}
                  className={cn(
                    'flex h-7 w-full items-center justify-center rounded-md text-[10px] font-medium tabular-nums transition-colors',
                    cellClass(c.xp, c.state),
                    isLit ? 'text-amber-950 dark:text-zinc-950 font-semibold' : 'text-muted-foreground',
                    c.milestone && 'ring-1.5 ring-amber-500 dark:ring-amber-300',
                  )}
                >
                  {dayNum}
                </span>
              )
            })}
          </div>
        </div>
      )}

      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span>少</span>
          <span className="h-2.5 w-2.5 rounded-[2px] bg-zinc-200/85 dark:bg-zinc-800/90" />
          <span className="h-2.5 w-2.5 rounded-[2px] bg-amber-400/45 dark:bg-amber-400/35" />
          <span className="h-2.5 w-2.5 rounded-[2px] bg-amber-500/75 dark:bg-amber-400/70" />
          <span className="h-2.5 w-2.5 rounded-[2px] bg-amber-500 dark:bg-amber-400" />
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
            <span className="h-2.5 w-2.5 rounded-[2px] ring-1 ring-amber-500" />
            里程碑日
          </span>
        </span>
      </figcaption>
    </figure>
  )
}
