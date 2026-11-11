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

function ProgressRow({ title, current, target, done, xp }: { title: string; current: number; target: number; done: boolean; xp: number }) {
  return (
    <li className="flex items-center gap-3 py-2">
      {done ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" aria-hidden />
      ) : (
        <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, Math.round((current / target) * 100))}%` }} />
        </div>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {Math.min(current, target)} / {target} · +{xp}
      </span>
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
    <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5" aria-label="每日与每周任务">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <ListChecks className="h-4 w-4 text-primary" aria-hidden /> 今天的三件事
      </h3>
      <ul className="mt-2 divide-y divide-border/60">
        {daily.slots.map((s) => (
          <li key={s.slot} className="flex items-center gap-3 py-2.5">
            {s.done ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" aria-hidden />
            ) : (
              <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{s.title} <span className="ml-1 text-xs font-normal text-muted-foreground">+10</span></p>
              <p className="text-xs text-muted-foreground">{s.hint}</p>
            </div>
            {s.granted && <span className="shrink-0 text-xs text-muted-foreground">已入账</span>}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-muted/50 p-3">
        <Gift className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">全清宝箱</p>
          <p className="text-muted-foreground">
            {daily.chestOpened
              ? '今天的宝箱已经开过了，明天再来。'
              : daily.allDone
                ? '三件事都做完了，宝箱在等你亲手打开。'
                : '把上面三件事都做完，就能开今天的宝箱。'}
          </p>
          {chestMsg && <p className="mt-1 font-medium text-primary">{chestMsg}</p>}
        </div>
        <button
          type="button"
          onClick={openChest}
          disabled={daily.chestOpened || !daily.allDone}
          className="shrink-0 rounded-lg border border-primary/40 px-3 py-1.5 text-sm font-medium text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          打开宝箱
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        宝箱规则（明码标价）：固定 +15 经验，外加一份随机奖励——小份 +5~10 经验（约 50%）、中份 +12~20 经验（约 32%）、冻结卡 1 张（约 18%；口袋里没卡时约 30%）。连开 3 个没出卡，第 4 个必出；口袋满时卡换成 +25 经验。
      </p>

      <h3 className="mt-5 flex items-center gap-2 text-sm font-semibold">
        <ListChecks className="h-4 w-4 text-primary" aria-hidden /> 本周任务（做完自动入账，每项 +40）
      </h3>
      <ul className="mt-1 divide-y divide-border/60">
        {weekly.map((t) => (
          <ProgressRow key={t.id} title={t.title} current={t.current} target={t.target} done={t.done} xp={t.xp} />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">「五日同行」做完还会多给一张冻结卡（口袋满时换成 +20 经验）。</p>

      {rookie.active && (
        <>
          <h3 className="mt-5 flex items-center gap-2 text-sm font-semibold">
            <Sprout className="h-4 w-4 text-primary" aria-hidden /> 新手一周：第 {rookie.chainDay} 天
          </h3>
          <ul className="mt-2 space-y-1.5">
            {rookie.tasks.map((t) => (
              <li
                key={t.id}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm',
                  t.done
                    ? 'border-primary/30 bg-primary/5'
                    : t.day === rookie.chainDay
                      ? 'border-primary/50'
                      : 'border-border/60 opacity-70',
                )}
              >
                {t.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" aria-hidden />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="shrink-0 text-xs text-muted-foreground">第 {t.day} 天</span>
                <span>{t.title}</span>
                {t.day === rookie.chainDay && !t.done && <span className="ml-auto shrink-0 text-xs font-medium text-primary">今天</span>}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-muted-foreground">不用赶进度，晚几天做完也一样——这里只是告诉你这个站都能干什么。</p>
        </>
      )}

      {ret.active && (
        <>
          <h3 className="mt-5 flex items-center gap-2 text-sm font-semibold">
            <RotateCcw className="h-4 w-4 text-primary" aria-hidden /> 欢迎回来（回归一周内有效，每项 +20）
          </h3>
          <ul className="mt-1 divide-y divide-border/60">
            {ret.tasks.map((t) => (
              <ProgressRow key={t.id} title={t.title} current={t.current} target={t.target} done={t.done} xp={t.xp} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
