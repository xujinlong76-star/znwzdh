'use client'

/**
 * 任务区：每日三槽 + 全清宝箱、每周五任务、新手链、回归包。
 * 全部状态由 growth.ts 派生（dailyTaskStatus / weeklyTaskStatus /
 * rookieStatus / returnPackStatus），达标自动入账——这里没有「领取」
 * 按钮可点（宝箱除外：全清后由用户亲手开，仪式感在这一格）。
 * 文案口径（v2 定稿）：说事实、不催促、不羞辱、不假装。
 */

import { useState } from 'react'
import { CheckCircle2, Circle, Gift, ListChecks, RotateCcw, Sprout } from 'lucide-react'
import {
  dailyTaskStatus,
  openDailyChestAction,
  returnPackStatus,
  rookieStatus,
  weeklyTaskStatus,
  type GrowthProfile,
} from '@/lib/growth'
import { cn } from '@/lib/utils'

function ProgressRow({
  title,
  current,
  target,
  done,
  xp,
}: {
  title: string
  current: number
  target: number
  done: boolean
  xp: number
}) {
  return (
    <li className="flex items-center gap-2.5 py-2">
      {done ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
      ) : (
        <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs font-medium text-foreground">{title}</p>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
            {Math.min(current, target)}/{target} · +{xp}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary/75 transition-all"
            style={{ width: `${Math.min(100, Math.round((current / target) * 100))}%` }}
          />
        </div>
      </div>
    </li>
  )
}

export function GrowthTasks({ profile }: { profile: GrowthProfile }) {
  const [chestMsg, setChestMsg] = useState<string | null>(null)
  const daily = dailyTaskStatus(profile)
  const weekly = weeklyTaskStatus(profile)
  const rookie = rookieStatus(profile)
  const ret = returnPackStatus(profile)

  const openChest = () => {
    const { result } = openDailyChestAction()
    if (!result.ok) {
      setChestMsg('宝箱还没攒满：把今天的 3 件事都做完就能开。')
      return
    }
    if (result.gotCard) setChestMsg(`开出来了：固定 +${result.fixedXp} 经验，还有一张冻结卡，已经放进你的口袋。`)
    else if (result.tier === 'card') setChestMsg(`开出来了：固定 +${result.fixedXp} 经验，冻结卡口袋满了，换成 +${result.bonusXp} 经验。`)
    else setChestMsg(`开出来了：固定 +${result.fixedXp} 经验，另加 +${result.bonusXp} 经验。`)
  }

  return (
    <section className="space-y-4" aria-label="每日与每周任务">
      {/* 桌面双栏并排：左侧每日三件事 + 宝箱，右侧本周五任务 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col rounded-2xl border border-border/70 bg-card/75 p-4 shadow-xs sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400">
                <ListChecks className="h-3.5 w-3.5" aria-hidden />
              </span>
              今天的三件事
            </h3>
            <span className="text-[11px] text-muted-foreground">每项 +10 经验</span>
          </div>

          <ul className="mt-2.5 flex-1 divide-y divide-border/60">
            {daily.slots.map((s) => (
              <li key={s.slot} className="flex items-center gap-2.5 py-2.5">
                {s.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">
                    {s.title}
                    <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">+10</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{s.hint}</p>
                </div>
                {s.granted && (
                  <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                    已入账
                  </span>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-3 rounded-xl border border-border/60 bg-muted/40 p-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Gift className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">全清宝箱</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {daily.chestOpened
                    ? '今天的宝箱已经开过了，明天再来。'
                    : daily.allDone
                      ? '三件事都做完了，宝箱在等你亲手打开。'
                      : '做完上面三件事即可打开今天的宝箱。'}
                </p>
              </div>
              <button
                type="button"
                onClick={openChest}
                disabled={daily.chestOpened || !daily.allDone}
                className="shrink-0 rounded-lg border border-border-strong bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-55"
              >
                打开宝箱
              </button>
            </div>
            {chestMsg && <p className="mt-2 text-xs font-medium text-primary">{chestMsg}</p>}
            <details className="mt-2 border-t border-border/50 pt-2">
              <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-foreground">
                查看宝箱概率与规则（明码标价）
              </summary>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                固定 +15 经验，外加一份随机奖励——小份 +5~10 经验（约 50%）、中份 +12~20 经验（约 32%）、冻结卡 1 张（约 18%；口袋里没卡时约 30%）。连开 3 个没出卡，第 4 个必出；口袋满时卡换成 +25 经验。
              </p>
            </details>
          </div>
        </div>

        <div className="flex flex-col rounded-2xl border border-border/70 bg-card/75 p-4 shadow-xs sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-sky-500/10 text-sky-700 dark:text-sky-300">
                <ListChecks className="h-3.5 w-3.5" aria-hidden />
              </span>
              本周任务
            </h3>
            <span className="text-[11px] text-muted-foreground">做完自动入账，每项 +40</span>
          </div>

          <ul className="mt-2.5 flex-1 divide-y divide-border/60">
            {weekly.map((t) => (
              <ProgressRow key={t.id} title={t.title} current={t.current} target={t.target} done={t.done} xp={t.xp} />
            ))}
          </ul>
          <p className="mt-2.5 rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            「五日同行」做完还会额外赠送 1 张冻结卡（口袋满时换成 +20 经验）。
          </p>
        </div>
      </div>

      {rookie.active && (
        <div className="rounded-2xl border border-border/70 bg-card/75 p-4 shadow-xs sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                <Sprout className="h-3.5 w-3.5" aria-hidden />
              </span>
              新手一周：第 {rookie.chainDay} 天
            </h3>
            <span className="text-[11px] text-muted-foreground">不用赶进度，晚几天做完也一样</span>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rookie.tasks.map((t) => (
              <li
                key={t.id}
                className={cn(
                  'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs',
                  t.done
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-foreground'
                    : t.day === rookie.chainDay
                      ? 'border-primary/50 bg-primary/5 text-foreground'
                      : 'border-border/60 bg-background/50 text-muted-foreground',
                )}
              >
                {t.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">D{t.day}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
                {t.day === rookie.chainDay && !t.done && (
                  <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    今天
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {ret.active && (
        <div className="rounded-2xl border border-border/70 bg-card/75 p-4 shadow-xs sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/10 text-violet-700 dark:text-violet-300">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              </span>
              欢迎回来
            </h3>
            <span className="text-[11px] text-muted-foreground">回归一周内有效，每项 +20</span>
          </div>
          <ul className="mt-2 grid gap-x-5 divide-y divide-border/60 sm:grid-cols-2 sm:divide-y-0">
            {ret.tasks.map((t) => (
              <ProgressRow key={t.id} title={t.title} current={t.current} target={t.target} done={t.done} xp={t.xp} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
