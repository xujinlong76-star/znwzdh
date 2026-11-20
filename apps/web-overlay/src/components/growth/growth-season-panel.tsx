'use client'

/**
 * 赛季区：本季进度（20 级主轨 + 漫游轨）、赛季任务、季中主题事件、
 * 季中里程碑、休息日设置与往季足迹卡。
 * 事件与里程碑来自 growth-season.ts 的配置（换季只改配置），
 * 全部状态由 growth.ts 派生，达标自动发放，没有手动领取。
 */

import { useState } from 'react'
import Link from 'next/link'
import { CalendarRange, CheckCircle2, Circle, Snowflake, Trophy } from 'lucide-react'
import {
  SEASON_MILESTONE_LEVELS,
  roamingNodesOf,
  seasonCalendar,
  seasonEventStatus,
  seasonLevelOf,
  seasonTaskStatus,
  setRestWeekdayAction,
  type GrowthProfile,
} from '@/lib/growth'
import { MID_SEASON_MILESTONES, SEASON_LEVEL_COUNT, SEASON_SP_PER_LEVEL } from '@/lib/growth-season'
import { eventMetricAction, taskAction, type TaskAction } from './task-actions'
import { cn } from '@/lib/utils'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/** 未完成任务的一键直达按钮（与 growth-tasks.tsx 的 TaskGoButton 同款）。 */
function GoButton({ action }: { action: TaskAction | undefined }) {
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

export function GrowthSeasonPanel({ profile }: { profile: GrowthProfile }) {
  const [restMsg, setRestMsg] = useState<string | null>(null)
  const cal = seasonCalendar()
  const sp = profile.season.sp
  const level = seasonLevelOf(sp)
  const nodes = roamingNodesOf(sp)
  const onMainTrack = level < SEASON_LEVEL_COUNT
  const trackProgress = onMainTrack
    ? (sp % SEASON_SP_PER_LEVEL) / SEASON_SP_PER_LEVEL
    : ((sp - SEASON_LEVEL_COUNT * SEASON_SP_PER_LEVEL) % 400) / 400
  const tasks = seasonTaskStatus(profile)
  const events = seasonEventStatus(profile)
  const inMidWindow = cal.dayOfSeason >= 30 && cal.dayOfSeason <= 60

  const pickRest = (weekday: number) => {
    const r = setRestWeekdayAction(weekday)
    if (r.ok) setRestMsg(`休息日设为周${WEEKDAY_LABELS[weekday]}：那天不来也不算断签。`)
    else if (r.reason === 'monthly-limit') setRestMsg('休息日每个月只能改一次，这个月已经改过了。')
    else setRestMsg('没改成，再试一次。')
  }

  return (
    <section className="rounded-2xl border border-border/70 bg-card/75 p-4 shadow-xs sm:p-5" aria-label="赛季">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400">
            <Trophy className="h-3.5 w-3.5" aria-hidden />
          </span>
          第 {profile.season.index + 1} 季 · 第 {cal.dayOfSeason} 天（共 90 天）
        </h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">
          <Snowflake className="h-3.5 w-3.5" aria-hidden />
          冻结卡 {profile.freezeCards} 张
        </span>
      </div>

      <div className="mt-3 rounded-xl border border-border/60 bg-background/60 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
          <p className="font-medium text-foreground">
            赛季积分 <span className="text-sm font-semibold text-primary tabular-nums">{sp}</span>
            <span className="ml-2 text-muted-foreground">
              {onMainTrack ? `赛季 Lv.${level} / ${SEASON_LEVEL_COUNT}` : `主轨已满级 · 漫游 ${nodes} 节点`}
            </span>
          </p>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            进度 {Math.round(trackProgress * 100)}%
          </span>
        </div>
        <div
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round(trackProgress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="赛季进度"
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(trackProgress * 100)}%` }} />
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {onMainTrack
            ? `再攒 ${SEASON_SP_PER_LEVEL - (sp % SEASON_SP_PER_LEVEL)} 赛季积分升到赛季 Lv.${level + 1}（每升一级 +10 经验；到 Lv.${SEASON_MILESTONE_LEVELS.join(' / ')} 各送 1 张冻结卡）。`
            : `主轨已打满，之后每 400 赛季积分多 1 个漫游节点（每个 +15 经验），慢慢攒，不清零到季末。`}
          赛季积分和平时赚的经验 1:1 同步。
        </p>
      </div>

      {events.map(({ event, tasks: evTasks }) => (
        <div key={event.id} className="mt-3.5 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
              <CalendarRange className="h-3.5 w-3.5" aria-hidden />
              季中事件 · {event.name}
            </p>
            <span className="text-[11px] text-muted-foreground">
              本季第 {event.dayFrom}–{event.dayTo} 天
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{event.blurb}</p>
          <ul className="mt-2 divide-y divide-border/50">
            {evTasks.map((t) => {
              // 任务进度对象不带 metric：按 `${event.id}:${def.id}` 从事件定义里找回
              // （seasonEventStatus 只返回 TaskProgress，展示层在此处做映射，不改结算）
              const metric = event.tasks.find((d) => `${event.id}:${d.id}` === t.id)?.metric
              return (
                <li key={t.id} className="flex items-center gap-2 py-1.5 text-xs">
                  {t.done ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 font-medium text-foreground">{t.title}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                    {Math.min(t.current, t.target)}/{t.target} · +{t.xp}
                    {t.granted ? ' · 已入账' : ''}
                  </span>
                  {!t.done && <GoButton action={metric ? eventMetricAction(metric) : undefined} />}
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      {inMidWindow && (
        <p className="mt-2.5 text-[11px] text-muted-foreground">
          季中里程碑（积分达标自动发）：
          {MID_SEASON_MILESTONES.map(
            (m) =>
              `${m.sp} 分 +${m.xp} 经验${m.freezeCard ? ' + 冻结卡' : ''}${profile.season.midMilestonesGranted.includes(m.sp) ? '（已发）' : ''}`,
          ).join(' · ')}
        </p>
      )}

      {/* 8 条本季任务改为 2 列网格，节省一半垂直篇幅 */}
      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            本季任务（每项 +60，做完自动入账）
          </h4>
          <span className="text-[11px] text-muted-foreground">{tasks.filter((t) => t.done).length} / {tasks.length}</span>
        </div>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {tasks.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-background/60 px-3 py-2"
            >
              {t.done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-medium text-foreground">{t.title}</p>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                    {Math.min(t.current, t.target)}/{t.target}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/75"
                    style={{ width: `${Math.min(100, Math.round((t.current / t.target) * 100))}%` }}
                  />
                </div>
              </div>
              {!t.done && <GoButton action={taskAction(t.id)} />}
            </li>
          ))}
        </ul>
      </div>

      {/* 每周休息日：提升未选中态在深浅模式下的边框与文字对比度 */}
      <div className="mt-4 rounded-xl border border-border/60 bg-muted/40 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">每周休息日</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              选一天作固定休息日：当天不来不算断签、不耗冻结卡（每月可改 1 次）。
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="选择每周休息日">
            {WEEKDAY_LABELS.map((label, weekday) => (
              <button
                key={label}
                type="button"
                onClick={() => pickRest(weekday)}
                aria-pressed={profile.restWeekday === weekday}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  profile.restWeekday === weekday
                    ? 'border-primary bg-primary text-primary-foreground shadow-2xs'
                    : 'border-border-strong bg-background/85 text-foreground/85 hover:border-primary/50 hover:text-foreground',
                )}
              >
                周{label}
              </button>
            ))}
          </div>
        </div>
        {restMsg && <p className="mt-2 text-xs font-medium text-primary">{restMsg}</p>}
      </div>

      {profile.seasonHistory.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">往季足迹</h4>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {profile.seasonHistory.map((h) => (
              <li key={h.index} className="rounded-xl border border-border/60 bg-background/60 p-3 text-xs">
                <p className="font-semibold text-foreground">第 {h.index + 1} 季足迹卡</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  赛季积分 {h.sp} · 到达赛季 Lv.{h.level}
                  {h.roamingNodes > 0 ? ` · 漫游 ${h.roamingNodes} 节点` : ''} · 结束于 {h.endedKey}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
