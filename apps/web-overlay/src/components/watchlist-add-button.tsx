'use client'

/**
 * 「加入追剧」入口：挂在短剧平台站卡上（首页短剧影院），点开是一个小表单。
 *
 * 文案纪律（与收藏划清界限，全站统一口径）：
 *  - 按钮叫「追剧」，不叫「收藏」——收藏是存着，追剧是记进度 + 到更新日提醒；
 *  - 节奏选项第一项永远是「不清楚」：我们没有平台排播数据，用户不知道就选
 *    不知道，清单只帮他记着、给个「去看看」的入口，绝不假装知道更新了；
 *  - 选了节奏也要写明「按你在平台看到的节奏，我们照着提醒你」——标注的
 *    出处是用户本人，不冒充平台官方排播。
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, Clapperboard, X } from 'lucide-react'
import { useWatchlist } from '@/hooks/useWatchlist'
import {
  cadenceLabel,
  type WatchCadence,
  type WatchPlatformRef,
  type WatchPriority,
} from '@/lib/watchlist'

const WEEKDAYS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' },
] as const

export interface WatchDraft {
  title: string
  episode: number
  cadence: WatchCadence
  priority: WatchPriority
}

/** 节奏 + 集数 + 优先级字段组：加入弹窗与清单页的添加表单共用，保证两处口径一致 */
export function WatchlistFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: Omit<WatchDraft, 'title'>
  onChange: (next: Omit<WatchDraft, 'title'>) => void
  idPrefix: string
}) {
  const cadenceKind = draft.cadence.kind
  const weeklyDays = draft.cadence.kind === 'weekly' ? draft.cadence.weekdays : [1]

  const setKind = (kind: WatchCadence['kind']) => {
    if (kind === 'weekly') onChange({ ...draft, cadence: { kind: 'weekly', weekdays: weeklyDays } })
    else onChange({ ...draft, cadence: { kind } as WatchCadence })
  }
  const toggleDay = (day: number) => {
    const has = weeklyDays.includes(day)
    const next = has ? weeklyDays.filter((d) => d !== day) : [...weeklyDays, day].sort((a, b) => a - b)
    onChange({ ...draft, cadence: next.length > 0 ? { kind: 'weekly', weekdays: next } : { kind: 'unknown' } })
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}-episode`} className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          看到第几集了（没开始看就填 0）
        </label>
        <input
          id={`${idPrefix}-episode`}
          type="number"
          min={0}
          max={100000}
          inputMode="numeric"
          value={draft.episode}
          onChange={(e) => onChange({ ...draft, episode: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-rose-500 dark:border-zinc-700"
        />
      </div>
      <fieldset>
        <legend className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          这部剧的更新节奏（按你在平台看到的填，不知道就选不知道）
        </legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="更新节奏">
          {(
            [
              { kind: 'unknown', label: '不清楚' },
              { kind: 'daily', label: '每天更新' },
              { kind: 'weekly', label: '每周更新' },
              { kind: 'finished', label: '已完结' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.kind}
              type="button"
              role="radio"
              aria-checked={cadenceKind === opt.kind}
              onClick={() => setKind(opt.kind)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                cadenceKind === opt.kind
                  ? 'border-rose-500 bg-rose-500/10 font-semibold text-rose-700 dark:text-rose-400'
                  : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {cadenceKind === 'weekly' && (
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label="每周哪几天更新">
            {WEEKDAYS.map((d) => (
              <button
                key={d.value}
                type="button"
                aria-pressed={weeklyDays.includes(d.value)}
                onClick={() => toggleDay(d.value)}
                className={`h-8 w-8 rounded-full border text-xs transition-colors ${
                  weeklyDays.includes(d.value)
                    ? 'border-rose-500 bg-rose-500 font-semibold text-white'
                    : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
          {cadenceKind === 'unknown'
            ? '没关系：清单只帮你记着这部剧，想看时从清单一键过去看看有没有更新。'
            : '到更新日我们会在追剧清单里提醒你 —— 节奏是你标注的，平台临时改档时提醒可能不准。'}
        </p>
      </fieldset>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={draft.priority === 'high'}
          onChange={(e) => onChange({ ...draft, priority: e.target.checked ? 'high' : 'normal' })}
          className="h-4 w-4 accent-rose-500"
        />
        想先看这部（在清单里排前面）
      </label>
    </div>
  )
}

export function WatchlistAddButton({
  platform,
  variant = 'light',
}: {
  platform: WatchPlatformRef
  /** dark = 首页短剧影院的深色卡面；light = 普通页面 */
  variant?: 'dark' | 'light'
}) {
  const watchlist = useWatchlist()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [fields, setFields] = useState<Omit<WatchDraft, 'title'>>({
    episode: 0,
    cadence: { kind: 'unknown' },
    priority: 'normal',
  })
  const [added, setAdded] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) titleRef.current?.focus()
  }, [open ])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open ])

  const existing = title.trim() ? watchlist.findByPlatformAndTitle(platform.siteId, title) : undefined

  const submit = () => {
    const entry = watchlist.add(platform, {
      title,
      episode: fields.episode,
      cadence: fields.cadence,
      priority: fields.priority,
    })
    if (entry) {
      setAdded(entry.title)
      setOpen(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAdded(null)
          setOpen(true)
        }}
        disabled={Boolean(watchlist.storageBlocked)}
        title={watchlist.storageBlocked ?? `把在${platform.title}追的剧加进追剧清单`}
        className={
          variant === 'dark'
            ? 'inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-zinc-100 transition-colors hover:bg-white/20 disabled:opacity-50'
            : 'inline-flex shrink-0 items-center gap-1 rounded-full border border-zinc-300 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:border-rose-400 hover:text-rose-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300'
        }
      >
        <Clapperboard className="h-3.5 w-3.5" aria-hidden />
        追剧
      </button>

      {added && !open && (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500" role="status">
          <Check className="h-3.5 w-3.5" aria-hidden /> 已加入
          <Link href="/me/watchlist" className="underline underline-offset-2">
            追剧清单
          </Link>
        </span>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={`加入追剧清单（${platform.title}）`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold">在{platform.title}追剧</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                  追剧和收藏不一样：收藏是先存着，追剧是记着看到第几集、到更新日提醒你。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                className="rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor={`watch-add-title-${platform.siteId}`} className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  剧名（必填）
                </label>
                <input
                  ref={titleRef}
                  id={`watch-add-title-${platform.siteId}`}
                  type="text"
                  value={title}
                  maxLength={80}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="比如：我叫赵甲第"
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-rose-500 dark:border-zinc-700"
                />
                {existing && (
                  <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400" role="status">
                    这部剧已经在你的追剧清单里（看到第 {existing.episode} 集 · {cadenceLabel(existing.cadence)}），再提交会更新它的标注。
                  </p>
                )}
              </div>
              <WatchlistFields draft={fields} onChange={setFields} idPrefix={`watch-add-${platform.siteId}`} />
              {watchlist.storageBlocked && (
                <p className="text-xs text-red-500" role="alert">
                  {watchlist.storageBlocked}
                </p>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!title.trim() || Boolean(watchlist.storageBlocked)}
                  className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:opacity-50"
                >
                  {existing ? '更新标注' : '加入追剧清单'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
