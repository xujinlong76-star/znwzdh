'use client'

/**
 * 任务区：每日三槽 + 全清宝箱、每周五任务、新手链、回归包。
 * 全部状态由 growth.ts 派生（dailyTaskStatus / weeklyTaskStatus /
 * rookieStatus / returnPackStatus），达标自动入账——这里没有「领取」
 * 按钮可点（宝箱除外：全清后由用户亲手开，仪式感在这一格）。
 * 文案口径（v2 定稿）：说事实、不催促、不羞辱、不假装。
 */

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ChevronDown, Circle, Gift, ListChecks, RotateCcw, Sprout } from 'lucide-react'
import {
  dailyTaskStatus,
  openDailyChestAction,
  returnPackStatus,
  rookieStatus,
  weeklyTaskStatus,
  type GrowthProfile,
} from '@/lib/growth'
import { Popover, PopoverContent, PopoverTrigger } from '@/registry/new-york/ui/popover'
import { taskAction, type TaskAction } from './task-actions'
import { cn } from '@/lib/utils'

/** 未完成任务的一键直达按钮：无映射（s1/d6/d7）时不渲染。 */
function TaskGoButton({ id }: { id: string }) {
  const action = taskAction(id)
  if (!action) return null
  return (
    <Link
      href={action.href}
      className="shrink-0 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
    >
      {action.cta}
    </Link>
  )
}

function ProgressRow({
  title,
  current,
  target,
  done,
  xp,
  action,
}: {
  title: string
  current: number
  target: number
  done: boolean
  xp: number
  action?: TaskAction
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
      {!done && action && (
        <Link
          href={action.href}
          className="shrink-0 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
        >
          {action.cta}
        </Link>
      )}
    </li>
  )
}

export function GrowthTasks({
  profile,
  onGoToGuide,
}: {
  profile: GrowthProfile
  /** 新手 D3「设为首页」的面板内动作：切到「图鉴与指南」Tab 看设置向导 */
  onGoToGuide?: () => void
}) {
  const [chestMsg, setChestMsg] = useState<string | null>(null)
  const [rookieOpen, setRookieOpen] = useState(true)
  const daily = dailyTaskStatus(profile)
  const weekly = weeklyTaskStatus(profile)
  const rookie = rookieStatus(profile)
  const ret = returnPackStatus(profile)
  // 新手步骤条：当前天优先，未到当前天时取第一个未完成项
  const currentRookieTask =
    rookie.tasks.find((t) => t.day === rookie.chainDay) ??
    rookie.tasks.find((t) => !t.done) ??
    rookie.tasks[rookie.tasks.length - 1]
  const rookieDoneCount = rookie.tasks.filter((t) => t.done).length
  const lastDoneIndex = rookie.tasks.reduce((acc, t, i) => (t.done ? i : acc), -1)

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
                {!s.done && <TaskGoButton id={s.id} />}
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
            <div className="mt-2 border-t border-border/50 pt-2">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="宝箱规则说明"
                    className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-border-strong text-[10px] font-semibold leading-none">
                      ?
                    </span>
                    规则说明
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 text-[11px] leading-relaxed text-muted-foreground" align="start">
                  固定 +15 经验，外加一份随机奖励——小份 +5~10 经验（约 50%）、中份 +12~20 经验（约 32%）、冻结卡 1 张（约 18%；口袋里没卡时约 30%）。连开 3 个没出卡，第 4 个必出；口袋满时卡换成 +25 经验。
                </PopoverContent>
              </Popover>
            </div>
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
              <ProgressRow
                key={t.id}
                title={t.title}
                current={t.current}
                target={t.target}
                done={t.done}
                xp={t.xp}
                action={taskAction(t.id)}
              />
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
              <span className="rounded-md bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground tabular-nums">
                {rookieDoneCount}/{rookie.tasks.length}
              </span>
            </h3>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-muted-foreground">不用赶进度，晚几天做完也一样</span>
              <button
                type="button"
                onClick={() => setRookieOpen((v) => !v)}
                aria-expanded={rookieOpen}
                aria-label={rookieOpen ? '收起新手一周' : '展开新手一周'}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronDown className={cn('h-4 w-4 transition-transform', !rookieOpen && '-rotate-90')} aria-hidden />
              </button>
            </div>
          </div>

          {/* 横向 7 天步骤条：已完成收起为绿色对勾，仅当前天高亮 */}
          <div className="relative mt-4">
            <div className="absolute left-[7%] right-[7%] top-3.5 h-0.5 rounded bg-muted" aria-hidden />
            <div
              className="absolute left-[7%] top-3.5 h-0.5 rounded bg-emerald-500 transition-all"
              style={{ width: lastDoneIndex < 0 ? '0%' : `${(lastDoneIndex / (rookie.tasks.length - 1)) * 86}%` }}
              aria-hidden
            />
            <ol className="relative flex items-start justify-between" aria-label="新手一周进度">
              {rookie.tasks.map((t) => {
                const isCurrent = t.day === rookie.chainDay
                return (
                  <li key={t.id} className="flex w-0 flex-1 flex-col items-center gap-1.5">
                    <span
                      className={cn(
                        'relative z-10 flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold',
                        t.done
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : isCurrent
                            ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                            : 'border-border-strong bg-background text-muted-foreground',
                      )}
                      aria-label={`第 ${t.day} 天${t.done ? '已完成' : isCurrent ? '今天' : ''}`}
                    >
                      {t.done ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : t.day}
                    </span>
                    <span
                      className={cn(
                        'text-[10px]',
                        isCurrent && !t.done ? 'font-semibold text-primary' : 'text-muted-foreground',
                      )}
                    >
                      第 {t.day} 天
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>

          {/* 仅当前天高亮展开：今日目标 + 直达按钮 */}
          {rookieOpen && currentRookieTask && (
            <div className="mt-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
              <p className="text-xs font-semibold text-foreground">
                第 {currentRookieTask.day} 天：今日目标
              </p>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 flex-1 text-xs font-medium text-foreground">{currentRookieTask.title}</p>
                {currentRookieTask.done ? (
                  <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                    已完成
                  </span>
                ) : currentRookieTask.id === 'd3' && onGoToGuide ? (
                  <button
                    type="button"
                    onClick={onGoToGuide}
                    className="shrink-0 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
                  >
                    查看设置向导 →
                  </button>
                ) : (
                  <TaskGoButton id={currentRookieTask.id} />
                )}
              </div>
            </div>
          )}
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
              <ProgressRow
                key={t.id}
                title={t.title}
                current={t.current}
                target={t.target}
                done={t.done}
                xp={t.xp}
                action={taskAction(t.id)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
