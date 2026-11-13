'use client'

/**
 * 简报页的「今日专注」岛（客户端岛，BriefWatch 的同款做法）。
 *
 * 为什么必须是岛：/brief 是服务端渲染的中枢缓存页，看不到本机数据；
 * 专注是用户自己定的、只存在本机 localStorage 里的一句话，SSR 壳里
 * 不出现任何用户数据。岛在挂载后读今天的专注，没定就给一个 inline
 * 输入框现定；昨天的专注不带进今天（lib/daily-focus 的 focusForToday）。
 *
 * 一眼原则：它是简报的第一块内容，上面只有面包屑。没定专注时不拿
 * 「示例目标」占位——示例就是编造的用户数据；空就是空，给输入框。
 */

import { useEffect, useState } from 'react'
import { Check, Pencil, Target, Trash2 } from 'lucide-react'
import {
  DAILY_FOCUS_MAX_LENGTH,
  clearDailyFocus,
  createDailyFocus,
  isValidFocusText,
  readDailyFocusForToday,
  todayKey,
  withDone,
  withText,
  writeDailyFocus,
  type DailyFocus,
} from '@/lib/daily-focus'

export default function DailyFocus() {
  const [focus, setFocus] = useState<DailyFocus | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setFocus(readDailyFocusForToday(todayKey()))
    setLoaded(true)
  }, [])

  // 挂载前不渲染：避免 SSR 壳与本机数据 hydration 对不上（BriefWatch 同款）。
  if (!loaded) return null

  const saveDraft = () => {
    if (!isValidFocusText(draft)) return
    const today = todayKey()
    const next = focus
      ? withText(focus, draft, Date.now())
      : createDailyFocus(draft, today, Date.now())
    if (!next) return
    if (!writeDailyFocus(next)) {
      setNotice('保存失败：本机存储写不进去，专注还在原处')
      return
    }
    setFocus(next)
    setEditing(false)
    setDraft('')
    setNotice(null)
  }

  const toggleDone = () => {
    if (!focus) return
    const next = withDone(focus, !focus.done, Date.now())
    if (!writeDailyFocus(next)) {
      setNotice('保存失败：本机存储写不进去，专注还在原处')
      return
    }
    setFocus(next)
    setNotice(null)
  }

  const clear = () => {
    if (!clearDailyFocus()) {
      setNotice('清除失败：本机存储写不进去，专注还在原处')
      return
    }
    setFocus(null)
    setEditing(false)
    setDraft('')
    setNotice(null)
  }

  const startEditing = () => {
    setDraft(focus ? focus.text : '')
    setEditing(true)
    setNotice(null)
  }

  return (
    <section aria-label="今日专注" className="rounded-2xl border bg-card p-5 sm:p-6">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
        <Target className="h-5 w-5 text-primary" aria-hidden /> 今日专注
      </h2>

      {focus && !editing ? (
        <>
          <p className="mt-2 text-lg font-medium leading-relaxed sm:text-xl">
            <span className={focus.done ? 'text-muted-foreground line-through' : undefined}>{focus.text}</span>
            {focus.done ? (
              <span className="ml-2 inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 align-middle text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                已完成
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {focus.done ? '完成了，今天干得不错。' : '今天只定这一件，做完再说。'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={toggleDone}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Check className="h-4 w-4" aria-hidden />
              {focus.done ? '还没完成' : '完成了'}
            </button>
            <button
              type="button"
              onClick={startEditing}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent"
            >
              <Pencil className="h-4 w-4" aria-hidden /> 换一个
            </button>
            <button
              type="button"
              onClick={clear}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Trash2 className="h-4 w-4" aria-hidden /> 清除
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            saveDraft()
          }}
        >
          <label htmlFor="daily-focus-input" className="mt-1 block text-sm text-muted-foreground">
            {focus ? '换一件今天最想完成的事：' : '今天最想完成的一件事是什么？只定一件。'}
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="daily-focus-input"
              type="text"
              value={draft}
              maxLength={DAILY_FOCUS_MAX_LENGTH}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-11 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              disabled={!isValidFocusText(draft)}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {focus ? '改好了' : '定下来'}
            </button>
            {focus ? (
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setDraft('')
                }}
                className="inline-flex min-h-11 items-center justify-center rounded-md border px-4 py-2 text-sm hover:bg-accent"
              >
                取消
              </button>
            ) : null}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            只存在你这台浏览器里，不会同步到别处；明天自动清空，重新定。
          </p>
        </form>
      )}

      {notice ? <p className="mt-3 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">{notice}</p> : null}
    </section>
  )
}
