'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CopyResult } from '@/lib/clipboard'

/**
 * 复制操作的按钮本地反馈。
 *
 * 为什么必须有：sonner 的 Toaster 在首帧渲染后才订阅事件，Toaster 就绪前
 * 发出的 toast 会被静默丢弃（E2E 徽章用例 2026-10-23 实测），所以「已复制」
 * 不能只挂在 toast 上。确认与失败原因都要回到触发按钮自身，toast 可以继续发，
 * 但不能是唯一通道。
 */
export type CopyFeedback = { state: 'idle' | 'copied' | 'failed'; reason: string | null }

export const IDLE_COPY_FEEDBACK: CopyFeedback = { state: 'idle', reason: null }

const RESET_MS = 2_500

export function useCopyFeedback(resetMs: number = RESET_MS) {
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(IDLE_COPY_FEEDBACK)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const resetCopy = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setCopyFeedback(IDLE_COPY_FEEDBACK)
  }, [])

  const reportCopy = useCallback(
    (result: CopyResult) => {
      setCopyFeedback(
        result.ok ? { state: 'copied', reason: null } : { state: 'failed', reason: result.reason },
      )
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopyFeedback(IDLE_COPY_FEEDBACK), resetMs)
    },
    [resetMs],
  )

  return { copyFeedback, reportCopy, resetCopy }
}
