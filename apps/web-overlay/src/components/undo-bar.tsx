'use client'

/**
 * 全局撤销条（第 1 层：8 秒内存撤销的唯一出口）。
 *
 * 刻意不复用 toast：TOAST_LIMIT=1、视口右上、小字，不符合"底部、大字、
 * 大按钮"的要求；也不用 sonner。独立组件，挂在 app/layout.tsx 的
 * <Toaster /> 旁，全站只有一个实例。
 *
 * 行为：
 *  - 一条，不是多条：只显示栈顶；不同 kind 的新条替换旧条显示，旧条仍在
 *    栈里，Ctrl+Z 按栈顺序逐条撤；
 *  - 8 秒倒计时（顶部 3px 进度条，100ms 一跳）；悬停/聚焦暂停，
 *    切后台暂停、回来继续；到时自动消失（条消失 = 撤销失效，D1）；
 *    暂停是真暂停：暂停开始记下剩余时间，恢复时按剩余时间顺延栈顶
 *    的真实 deadline（extendGlobalUndoExpiry），暂停期间每跳也顺延
 *    一次——只停显示倒计时不够，过期判定按 wall-clock 的 expiresAt
 *    走，悬停 8 秒后条还在、栈里却已过期，点「撤销」会落空；
 *  - Esc 只关条，不撤销；prefers-reduced-motion 时去掉滑入动画；
 *  - role="status" aria-live="polite"，不抢焦点。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import {
  UNDO_WINDOW_MS,
  dismissGlobalUndo,
  extendGlobalUndoExpiry,
  globalUndoDepth,
  peekGlobalUndo,
  pruneGlobalUndo,
  subscribeGlobalUndo,
  UNDO_SUBLABEL,
  type UndoEntry,
} from '@/lib/undo-stack'
import { useFavorites } from '@/hooks/useFavorites'
import { isAnyDialogOpen } from '@/lib/keyboard-guards'

export function UndoBar() {
  const favorites = useFavorites()
  const [top, setTop] = useState<UndoEntry | null>(() => peekGlobalUndo())
  const [depth, setDepth] = useState<number>(() => globalUndoDepth())
  const [remainingMs, setRemainingMs] = useState<number>(UNDO_WINDOW_MS)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const pausedRef = useRef(false)
  // 暂停的两个原因各自记一位：悬停/聚焦、切后台。任一成立即暂停；
  // 只有两个都解除才恢复——悬停时切后台再回来，不能把悬停的暂停也解掉。
  const hoverPausedRef = useRef(false)
  const hiddenPausedRef = useRef(false)
  // 暂停开始时记下的栈顶剩余时间 + 栈顶 id：恢复时按它顺延真实 deadline。
  // 暂停中又进了新条时，旧条的剩余时间绝不能套到新条头上（按 id 校验）。
  const pausedRemainingRef = useRef<number | null>(null)
  const pausedTopIdRef = useRef<string | null>(null)
  const topIdRef = useRef<string | null>(null)

  // 暂停状态同步：未暂停→暂停记剩余时间；暂停→未暂停按剩余时间顺延。
  const syncPause = useCallback(() => {
    const shouldPause = hoverPausedRef.current || hiddenPausedRef.current
    if (shouldPause && !pausedRef.current) {
      pausedRef.current = true
      const entry = peekGlobalUndo()
      if (entry) {
        pausedRemainingRef.current = Math.max(0, entry.expiresAt - Date.now())
        pausedTopIdRef.current = entry.id
      }
      return
    }
    if (!shouldPause && pausedRef.current) {
      pausedRef.current = false
      const remaining = pausedRemainingRef.current
      const topId = pausedTopIdRef.current
      pausedRemainingRef.current = null
      pausedTopIdRef.current = null
      if (remaining !== null && remaining > 0) {
        // 恢复：真实 deadline 顺延到 now + 暂停时剩下的时间，显示同步回同一值
        extendGlobalUndoExpiry(remaining, Date.now(), topId ?? undefined)
        setRemainingMs(remaining)
      }
    }
  }, [])

  // 订阅全局栈：入栈/出栈/过期都刷新显示
  useEffect(() => {
    const refresh = () => {
      setTop(peekGlobalUndo())
      setDepth(globalUndoDepth())
    }
    refresh()
    return subscribeGlobalUndo(refresh)
  }, [])

  // 栈顶变化时倒计时重置回 8 秒。
  // 依赖是 top 对象本身而不是 top.id：合并进栈时 mergeUndoEntries
  // 保留旧条 id、只换新对象（expiresAt 重置回 8 秒），只盯 id 的话
  // 合并不会触发重置，进度条会提前走到 0%。
  useEffect(() => {
    if (!top) return
    topIdRef.current = top.id
    setRemainingMs(Math.max(0, top.expiresAt - Date.now()))
    // 暂停中进了新条：暂停的剩余时间按新条重记（旧条的剩余时间不套新条）
    if (pausedRef.current) {
      pausedRemainingRef.current = Math.max(0, top.expiresAt - Date.now())
      pausedTopIdRef.current = top.id
    }
    setMounted(false)
    const frame = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(frame)
  }, [top])

  useEffect(() => {
    try {
      setReducedMotion(
        typeof window !== 'undefined' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      )
    } catch {
      // 查不到就按有动画处理：动画缺失不影响撤销本身
    }
  }, [])

  // 倒计时：100ms 一跳；悬停/聚焦到条上时暂停，切后台时暂停、回来继续。
  // 暂停期间每跳顺延一次栈顶的真实 deadline（now + 暂停时剩下的时间），
  // 这样暂停中按 Ctrl+Z 也不会因 wall-clock 过期被放行；只停显示不够。
  useEffect(() => {
    if (!top) return
    const timer = setInterval(() => {
      if (pausedRef.current) {
        const remaining = pausedRemainingRef.current
        const topId = pausedTopIdRef.current
        if (remaining !== null && remaining > 0) {
          extendGlobalUndoExpiry(remaining, Date.now(), topId ?? undefined)
        }
        return
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      setRemainingMs((prev) => {
        const next = prev - 100
        if (next <= 0) {
          // 到时自动 dismiss：过期条从栈里剪掉（条消失 = 撤销失效，D1）
          pruneGlobalUndo()
          return 0
        }
        return next
      })
    }, 100)
    return () => clearInterval(timer)
  }, [top]) // 同上：合并换对象不换 id，盯 top 本身，合并后按新条的窗口重新计时

  // 切后台暂停、回来继续（与悬停/聚焦的暂停同口径：都走 syncPause，
  // 恢复时按剩余时间顺延真实 deadline，不只是停显示）
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibilityChange = () => {
      hiddenPausedRef.current = document.visibilityState === 'hidden'
      syncPause()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [syncPause])

  // Esc 只关条，不撤销（对话框打开时不抢 Esc：那是对话框的关闭键）
  useEffect(() => {
    if (!top) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (isAnyDialogOpen()) return
      dismissGlobalUndo(top.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [top?.id])

  // 失败提示 5 秒后自动消失
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  const handleUndo = useCallback(async () => {
    if (!top || busy) return
    setBusy(true)
    try {
      const result = await favorites.undoLast()
      if (!result.ok) {
        setNotice(result.message ?? '撤销失败，可在回收站里恢复')
      }
    } finally {
      setBusy(false)
    }
  }, [top, busy, favorites])

  const pause = useCallback(() => {
    hoverPausedRef.current = true
    syncPause()
  }, [syncPause])
  const resume = useCallback(() => {
    hoverPausedRef.current = false
    syncPause()
  }, [syncPause])

  if (!top && !notice) return null

  const progress = Math.max(0, Math.min(100, (remainingMs / UNDO_WINDOW_MS) * 100))
  const extra = depth > 1 ? ` · 还有 ${depth - 1} 个可撤销的操作` : ''

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="undo-bar"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      style={reducedMotion || mounted ? undefined : { transform: 'translate(-50%, 16px)', opacity: 0 }}
      className="fixed left-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-background/95 shadow-lg backdrop-blur transition-all duration-200 bottom-[calc(env(safe-area-inset-bottom,0px)+72px)] min-[640px]:max-[1024px]:bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-6"
    >
      {/* 顶部 3px 倒计时进度条（按剩余时间缩短） */}
      {top ? (
        <div aria-hidden className="h-[3px] w-full bg-muted">
          <div className="h-full bg-primary transition-[width] duration-100 ease-linear" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold leading-snug">
            {notice ?? top?.label ?? ''}
          </p>
          {top && !notice ? (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {UNDO_SUBLABEL}
              {extra}
            </p>
          ) : null}
        </div>
        {top && !notice ? (
          <>
            <button
              type="button"
              onClick={() => void handleUndo()}
              disabled={busy}
              className="min-h-11 min-w-11 shrink-0 rounded-xl bg-primary px-5 text-base font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              撤销
            </button>
            <Link
              href="/favorites/trash"
              className="shrink-0 text-sm font-medium text-primary underline underline-offset-2 hover:opacity-80"
            >
              查看回收站
            </Link>
            <button
              type="button"
              aria-label="关闭撤销条"
              onClick={() => dismissGlobalUndo(top.id)}
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </>
        ) : (
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => setNotice(null)}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}
