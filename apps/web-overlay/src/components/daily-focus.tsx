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
 *
 * 挂载前（U-61）：不 return null，渲染与终态同高的静态骨架——外壳与
 * 终态共用 DAILY_FOCUS_SECTION_CLASS（含 min-h），首帧即占位，水合后
 * 高度不变、CLS 归零。骨架只有固定文案标题与灰条占位，不含任何用户数据。
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

/**
 * 外壳类：骨架分支与终态分支共用，改一处即改两处，不会漂移。
 * min-h 取两种终态的最大值（Playwright 实测，dev 服务 :3101，2026-11-17）：
 *  - 移动端 390px：未定态 232px（输入行纵排 + 提示文换行）> 已定态 180px；
 *  - sm+（1280px）：已定态 190.5px > 未定态 188px，向上取整为 192px。
 * 已定态在移动端会留约 52px 下沿空白（内容顶对齐），是零 CLS 的代价；
 * 换行/多行专注等极端终态仍可能超高，届时以终态为准、骨架不再追高。
 */
const DAILY_FOCUS_SECTION_CLASS =
  'rounded-2xl border bg-card p-5 sm:p-6 min-h-[232px] sm:min-h-[192px]'

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

  // 挂载前渲染静态骨架（U-61）：外壳与终态同高，首帧即占位，水合后不跳动。
  // 骨架不含任何用户数据——只有固定文案「今日专注」标题与灰条占位，无输入框、无示例目标。
  if (!loaded) {
    return (
      <section aria-label="今日专注" className={DAILY_FOCUS_SECTION_CLASS}>
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
          <Target className="h-5 w-5 text-primary" aria-hidden /> 今日专注
        </h2>
        <div aria-hidden="true" className="animate-pulse">
          <div className="mt-1 h-5 w-2/3 rounded bg-muted" />
          <div className="mt-2 h-11 w-full rounded-md bg-muted" />
          <div className="mt-1.5 h-4 w-1/2 rounded bg-muted" />
        </div>
      </section>
    )
  }

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
    <section aria-label="今日专注" className={DAILY_FOCUS_SECTION_CLASS}>
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
        <Target className="h-5 w-5 text-primary" aria-hidden /> 今日专注
      </h2>

      {focus && !editing ? (
        <>
          <p className="mt-2 text-lg font-medium leading-relaxed sm:text-xl">
            <span className={focus.done ? 'text-muted-foreground line-through' : undefined}>{focus.text}</span>
            {focus.done ? (
              <span className="ml-2 inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 align-middle text-xs font-medium text-emerald-700 dark:text-emerald-400">
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
          <p className="mt-1.5 text-xs text-muted-foreground">
            只存在你这台浏览器里，不会同步到别处；明天自动清空，重新定。
          </p>
        </form>
      )}

      {notice ? <p className="mt-3 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">{notice}</p> : null}
    </section>
  )
}
