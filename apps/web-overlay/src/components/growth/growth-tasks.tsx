'use client'

/**
 * 任务区（2026-11-21 UX 全面重构）：
 *  1. 按生命周期动态置顶「新手一周」：新手一周未全部完成时，以紧凑型横向任务卡置顶至
 *     「今天的三件事」正上方（7 天圆点进度条支持点击预览每一天，绝不垂直铺开占高度）；
 *     7 天全部完成后自动收纳归档，不再占据核心首屏位置；
 *  2. 主次 CTA 视觉层级：今天的三件事仅第一条未完成任务的按钮升级为实心强调色 Primary CTA，
 *     其余未完成任务保持浅灰描边次级按钮（Secondary Ghost），已完成项展示温和绿色徽标；
 *  3. 克制强调色点亮可领取态「全清宝箱」按钮（带微妙光泽与轻呼吸态），支持从外部
 *     `/me/growth?openChest=1` 自动触发开箱；
 *  4. 联动减负说明：明示完成同一动作自动同步推进今日、本周与新手多条进度；
 *  5. 本周任务「满格一天 X/120」补齐无障碍 ? Hover+Focus Tooltip，清晰拆解 120 XP 凑单路径。
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { CheckCircle2, ChevronDown, Circle, Gift, ListChecks, RotateCcw, Sparkles, Sprout } from 'lucide-react'
import {
  dailyTaskStatus,
  openDailyChestAction,
  returnPackStatus,
  rookieStatus,
  weeklyTaskStatus,
  type GrowthProfile,
} from '@/lib/growth'
import { Popover, PopoverContent, PopoverTrigger } from '@/registry/new-york/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { taskAction, type TaskAction } from './task-actions'
import { cn } from '@/lib/utils'
import { safeHref } from '@/lib/safe-url'

/** 未完成任务的一键直达按钮：支持 primary（第一条未完成主行动）与 secondary（次级描边）两档 */
function TaskGoButton({ id, variant = 'secondary' }: { id: string; variant?: 'primary' | 'secondary' }) {
  const action = taskAction(id)
  if (!action) return null
  return (
    <Link
      href={safeHref(action.href)}
      data-task-cta={variant}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        variant === 'primary'
          ? 'bg-amber-500 text-amber-950 shadow-xs hover:bg-amber-600 dark:bg-amber-400 dark:text-zinc-950 dark:hover:bg-amber-300 font-semibold'
          : 'border border-border/80 bg-background/80 text-muted-foreground hover:border-border-strong hover:text-foreground',
      )}
    >
      {action.cta}
    </Link>
  )
}

function WeeklyHelpTip({ label, content }: { label: string; content: ReactNode }) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/80 bg-background/80 text-xs font-semibold leading-none text-muted-foreground transition-colors hover:border-amber-500/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        className="max-w-[270px] rounded-xl border border-border/80 bg-popover px-3 py-2 text-[11px] leading-relaxed text-popover-foreground shadow-md"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

function ProgressRow({
  id,
  title,
  current,
  target,
  done,
  xp,
  action,
}: {
  id: string
  title: string
  current: number
  target: number
  done: boolean
  xp: number
  action?: TaskAction
}) {
  const isFullDay = id === 'w5' || title.includes('满格')
  return (
    <li className="flex items-center gap-2.5 py-2">
      {done ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
      ) : (
        <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-xs font-medium text-foreground">{title}</p>
            {isFullDay && (
              <WeeklyHelpTip
                label="满格一天 120 经验凑单路径说明"
                content={
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground">单日 120 XP 轻松凑单路径</p>
                    <p>
                      · 每日到访 +5 + 专注浏览 30 分钟 +30<br />
                      · 今天的三件事全部完成 +30<br />
                      · 开启每日全清宝箱 +20~35<br />
                      · 浏览新分类 / 收藏站点 / 首次体验功能 +20~40
                    </p>
                    <p className="text-muted-foreground">日常正常逛站与领宝箱即可自然达标，无需刻意刷分。</p>
                  </div>
                }
              />
            )}
          </div>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
            {Math.min(current, target)}/{target} · +{xp}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              done ? 'bg-emerald-500' : 'bg-amber-500/75 dark:bg-amber-400/75',
            )}
            style={{ width: `${Math.min(100, Math.round((current / target) * 100))}%` }}
          />
        </div>
      </div>
      {!done && action && (
        <Link
          href={safeHref(action.href)}
          className="shrink-0 whitespace-nowrap rounded-lg border border-border/80 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  autoOpenChestToken = 0,
}: {
  profile: GrowthProfile
  /** 新手 D3「设为首页」的面板内动作：切到「图鉴与指南」Tab 看设置向导 */
  onGoToGuide?: () => void
  /** 外部回流（?openChest=1）递增该 token，触发自动开箱 */
  autoOpenChestToken?: number
}) {
  const [chestMsg, setChestMsg] = useState<string | null>(null)
  const [selectedRookieDay, setSelectedRookieDay] = useState<number | null>(null)
  const [rookieArchiveOpen, setRookieArchiveOpen] = useState(false)

  const daily = dailyTaskStatus(profile)
  const weekly = weeklyTaskStatus(profile)
  const rookie = rookieStatus(profile)
  const ret = returnPackStatus(profile)

  const rookieDoneCount = rookie.tasks.filter((t) => t.done).length
  const rookieAllDone = rookieDoneCount >= rookie.tasks.length && rookie.tasks.length > 0
  // 生命周期置顶判定：新手一周活跃且尚未全部完成 → 置顶至「今天的三件事」正上方
  const pinRookieTop = rookie.active && !rookieAllDone

  const defaultRookieTask =
    rookie.tasks.find((t) => t.day === rookie.chainDay) ??
    rookie.tasks.find((t) => !t.done) ??
    rookie.tasks[rookie.tasks.length - 1]
  const previewRookieTask =
    (selectedRookieDay !== null ? rookie.tasks.find((t) => t.day === selectedRookieDay) : null) ??
    defaultRookieTask
  const lastDoneIndex = rookie.tasks.reduce((acc, t, i) => (t.done ? i : acc), -1)

  // 今天的三件事中仅第一条未完成项升级为 Primary CTA
  const firstPendingDailyId = daily.slots.find((s) => !s.done)?.id ?? null

  const openChest = useCallback(() => {
    const { result } = openDailyChestAction()
    if (!result.ok) {
      setChestMsg('宝箱还没攒满：把今天的 3 件事都做完就能开。')
      return
    }
    if (result.gotCard) setChestMsg(`开出来了：固定 +${result.fixedXp} 经验，还有一张冻结卡，已经放进你的口袋。`)
    else if (result.tier === 'card') setChestMsg(`开出来了：固定 +${result.fixedXp} 经验，冻结卡口袋满了，换成 +${result.bonusXp} 经验。`)
    else setChestMsg(`开出来了：固定 +${result.fixedXp} 经验，另加 +${result.bonusXp} 经验。`)
  }, [])

  // 跨页回流自动开箱（?openChest=1）
  useEffect(() => {
    if (autoOpenChestToken <= 0) return
    if (daily.chestAvailable) {
      openChest()
    }
  }, [autoOpenChestToken, daily.chestAvailable, openChest])

  const renderRookieBanner = (isPinnedTop: boolean) => (
    <div
      data-rookie-section={isPinnedTop ? 'pinned-top' : 'archived-bottom'}
      className={cn(
        'rounded-2xl border p-4 shadow-xs sm:px-5 sm:py-4',
        isPinnedTop
          ? 'border-amber-500/30 bg-card/90 dark:border-amber-400/25'
          : 'border-border/70 bg-card/75',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
              <Sprout className="h-3.5 w-3.5" aria-hidden />
            </span>
            新手一周：第 {rookie.chainDay} 天
            <span className="rounded-md bg-muted/75 px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground tabular-nums">
              {rookieDoneCount}/{rookie.tasks.length}
            </span>
          </h3>
          {isPinnedTop && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">
              破冰优先引导
            </span>
          )}
        </div>

        {/* 7 天紧凑圆点进度条：点击可切换预览任意一天，不垂直展开占高度 */}
        <div className="flex items-center gap-2">
          <ol className="flex items-center gap-1" aria-label="新手一周 7 天进度">
            {rookie.tasks.map((t) => {
              const isCurrent = t.day === rookie.chainDay
              const isPreview = previewRookieTask?.day === t.day
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedRookieDay(t.day)}
                    aria-label={`查看第 ${t.day} 天目标${t.done ? '（已完成）' : isCurrent ? '（今日）' : ''}`}
                    aria-pressed={isPreview}
                    title={`第 ${t.day} 天：${t.title}`}
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      t.done
                        ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                        : isCurrent
                          ? 'border-amber-500 bg-amber-500 text-amber-950 dark:border-amber-400 dark:bg-amber-400 dark:text-zinc-950'
                          : 'border-border/80 bg-background text-muted-foreground hover:border-border-strong hover:text-foreground',
                      isPreview && 'ring-2 ring-amber-500/45 ring-offset-1 ring-offset-card',
                    )}
                  >
                    {t.done ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : t.day}
                  </button>
                </li>
              )
            })}
          </ol>
          {!isPinnedTop && (
            <button
              type="button"
              onClick={() => setRookieArchiveOpen((v) => !v)}
              aria-expanded={rookieArchiveOpen}
              aria-label={rookieArchiveOpen ? '收起新手一周' : '展开新手一周'}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown className={cn('h-4 w-4 transition-transform', !rookieArchiveOpen && '-rotate-90')} aria-hidden />
            </button>
          )}
        </div>
      </div>

      {/* 进度细条 */}
      <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{
            width: lastDoneIndex < 0 ? '0%' : `${Math.round((rookieDoneCount / Math.max(1, rookie.tasks.length)) * 100)}%`,
          }}
        />
      </div>

      {/* 横向紧凑当前日目标条 */}
      {(isPinnedTop || rookieArchiveOpen) && previewRookieTask && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border/70 bg-background/75 px-3.5 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
              第 {previewRookieTask.day} 天{previewRookieTask.day === rookie.chainDay ? ' · 今日破冰目标' : ' · 目标预览'}
            </p>
            <p className="mt-0.5 text-xs font-medium text-foreground">{previewRookieTask.title}</p>
          </div>
          {previewRookieTask.done ? (
            <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              已完成
            </span>
          ) : previewRookieTask.id === 'd3' && onGoToGuide ? (
            <button
              type="button"
              onClick={onGoToGuide}
              className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-semibold text-amber-950 shadow-xs transition-colors hover:bg-amber-600 dark:bg-amber-400 dark:text-zinc-950 dark:hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              查看设置向导 →
            </button>
          ) : (
            <TaskGoButton id={previewRookieTask.id} variant={isPinnedTop ? 'primary' : 'secondary'} />
          )}
        </div>
      )}
    </div>
  )

  return (
    <section className="space-y-4" aria-label="每日与每周任务">
      {/* 动态置顶：新手一周未全部完成时，紧凑横向卡片置顶在「今天的三件事」正上方 */}
      {pinRookieTop && renderRookieBanner(true)}

      {/* 桌面双栏并排：左侧每日三件事 + 宝箱，右侧本周五任务 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col rounded-2xl border border-border/70 bg-card/85 p-4 shadow-xs sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400">
                <ListChecks className="h-3.5 w-3.5" aria-hidden />
              </span>
              今天的三件事
            </h3>
            <span className="text-[11px] text-muted-foreground">每项 +10 经验</span>
          </div>

          {/* 温和联动说明：消除三套任务重叠导致的“打工感” */}
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            完成同一动作将自动同步推进今日、本周与新手多条进度，无需重复操作。
          </p>

          <ul className="mt-2 flex-1 divide-y divide-border/60">
            {daily.slots.map((s) => {
              const isPrimaryAction = !s.done && s.id === firstPendingDailyId
              return (
                <li key={s.slot} className="flex items-center gap-2.5 py-2.5">
                  {s.done ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                  ) : (
                    <Circle
                      className={cn(
                        'h-4 w-4 shrink-0',
                        isPrimaryAction ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
                      )}
                      aria-hidden
                    />
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
                  {!s.done && <TaskGoButton id={s.id} variant={isPrimaryAction ? 'primary' : 'secondary'} />}
                </li>
              )
            })}
          </ul>

          {/* 全清宝箱：可领取时启用克制琥珀金强调色 + 轻呼吸光泽；未达成保持低调灰态 */}
          <div
            data-chest-ready={daily.chestAvailable ? 'true' : 'false'}
            className={cn(
              'mt-3 rounded-xl border p-3 transition-colors',
              daily.chestAvailable
                ? 'border-amber-500/45 bg-amber-500/[0.07] dark:border-amber-400/35 dark:bg-amber-400/[0.08]'
                : 'border-border/60 bg-muted/40',
            )}
          >
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                  daily.chestAvailable
                    ? 'bg-amber-500/20 text-amber-700 dark:bg-amber-400/20 dark:text-amber-300'
                    : 'bg-muted text-muted-foreground',
                )}
              >
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
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  daily.chestAvailable
                    ? 'bg-amber-500 text-amber-950 shadow-sm ring-2 ring-amber-500/30 hover:bg-amber-600 animate-pulse dark:bg-amber-400 dark:text-zinc-950 dark:hover:bg-amber-300'
                    : 'border border-border/70 bg-background/70 text-muted-foreground disabled:cursor-not-allowed disabled:opacity-55',
                )}
              >
                {daily.chestAvailable && <Sparkles className="h-3.5 w-3.5" aria-hidden />}
                {daily.chestOpened ? '今日已领' : '打开宝箱'}
              </button>
            </div>
            {chestMsg && <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">{chestMsg}</p>}
            <div className="mt-2 border-t border-border/50 pt-2">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="宝箱规则说明"
                    className="inline-flex min-h-6 items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border-strong text-xs font-semibold leading-none">
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

        <div className="flex flex-col rounded-2xl border border-border/70 bg-card/85 p-4 shadow-xs sm:p-5">
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
                id={t.id}
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

      {/* 新手一周全部完成后自动沉底收纳 */}
      {rookie.active && rookieAllDone && renderRookieBanner(false)}

      {ret.active && (
        <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-xs sm:p-5">
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
                id={t.id}
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
