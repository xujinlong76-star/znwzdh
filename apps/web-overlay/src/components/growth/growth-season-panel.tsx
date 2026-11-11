'use client'

/**
 * 赛季区：本季进度（20 级主轨 + 漫游轨）、赛季任务、季中主题事件、
 * 季中里程碑、休息日设置与往季足迹卡。
 * 事件与里程碑来自 growth-season.ts 的配置（换季只改配置），
 * 全部状态由 growth.ts 派生，达标自动发放，没有手动领取。
 */

import { useState } from 'react'
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
import { cn } from '@/lib/utils'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

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
    <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5" aria-label="赛季">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Trophy className="h-4 w-4 text-primary" aria-hidden /> 第 {profile.season.index + 1} 季 · 第 {cal.dayOfSeason} 天（共 90 天）
      </h3>
      <div className="mt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <p>
            赛季积分 <span className="font-semibold text-primary">{sp}</span>
            <span className="ml-2 text-muted-foreground">
              {onMainTrack ? `赛季 Lv.${level} / ${SEASON_LEVEL_COUNT}` : `主轨已满级 · 漫游 ${nodes} 节点`}
            </span>
          </p>
          <p className="inline-flex items-center gap-1 text-muted-foreground">
            <Snowflake className="h-3.5 w-3.5 text-sky-500" aria-hidden /> 冻结卡 {profile.freezeCards} 张
          </p>
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(trackProgress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="赛季进度">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(trackProgress * 100)}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {onMainTrack
            ? `再攒 ${SEASON_SP_PER_LEVEL - (sp % SEASON_SP_PER_LEVEL)} 赛季积分升到赛季 Lv.${level + 1}（每升一级 +10 经验；到 Lv.${SEASON_MILESTONE_LEVELS.join(' / ')} 各送 1 张冻结卡）。`
            : `主轨已打满，之后每 400 赛季积分多 1 个漫游节点（每个 +15 经验），慢慢攒，不清零到季末。`}
          赛季积分和你平时赚的经验 1:1 同步，不用单独肝。
        </p>
      </div>

      {events.map(({ event, tasks: evTasks }) => (
        <div key={event.id} className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CalendarRange className="h-4 w-4 text-amber-500" aria-hidden /> 季中事件 · {event.name}
            <span className="text-xs font-normal text-muted-foreground">本季第 {event.dayFrom}–{event.dayTo} 天</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{event.blurb}</p>
          <ul className="mt-2 divide-y divide-border/50">
            {evTasks.map((t) => (
              <li key={t.id} className="flex items-center gap-2.5 py-2 text-sm">
                {t.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" aria-hidden />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1">{t.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {Math.min(t.current, t.target)} / {t.target} · +{t.xp}
                  {t.granted ? ' · 已入账' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {inMidWindow && (
        <p className="mt-3 text-xs text-muted-foreground">
          季中里程碑（赛季积分到点自动发）：{MID_SEASON_MILESTONES.map((m) => `${m.sp} 分 +${m.xp} 经验${m.freezeCard ? ' + 冻结卡' : ''}${profile.season.midMilestonesGranted.includes(m.sp) ? '（已发）' : ''}`).join(' · ')}
        </p>
      )}

      <h4 className="mt-4 text-sm font-semibold">本季任务（每项 +60，做完自动入账）</h4>
      <ul className="mt-1 divide-y divide-border/60">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2">
            {t.done ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" aria-hidden />
            ) : (
              <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.title}</p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, Math.round((t.current / t.target) * 100))}%` }} />
              </div>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{Math.min(t.current, t.target)} / {t.target}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-xl bg-muted/50 p-3">
        <p className="text-sm font-medium">每周休息日</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          选一天当你的固定休息日：那天不来，不算断签、不用冻结卡。哪天都行，每个月能改一次。
          {profile.restWeekday == null ? ' 还没选——不选也没关系，冻结卡会先顶上。' : ''}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="选择每周休息日">
          {WEEKDAY_LABELS.map((label, weekday) => (
            <button
              key={label}
              type="button"
              onClick={() => pickRest(weekday)}
              aria-pressed={profile.restWeekday === weekday}
              className={cn(
                'rounded-lg border px-2.5 py-1 text-sm',
                profile.restWeekday === weekday
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-border/70 text-muted-foreground',
              )}
            >
              周{label}
            </button>
          ))}
        </div>
        {restMsg && <p className="mt-2 text-xs font-medium text-primary">{restMsg}</p>}
      </div>

      {profile.seasonHistory.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold">往季足迹</h4>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {profile.seasonHistory.map((h) => (
              <li key={h.index} className="rounded-xl border border-border/60 p-3 text-sm">
                <p className="font-medium">第 {h.index + 1} 季足迹卡</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
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
