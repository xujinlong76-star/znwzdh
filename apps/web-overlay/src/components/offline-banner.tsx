'use client'

/**
 * 离线 / 重连提示条。
 *
 * 这个组件之前**写好了但从未被挂载**（全仓没有任何地方渲染它），
 * 而且文案在编造能力（「私密收藏与端侧工具 100% 可用」「已自动恢复云端同步」）。
 * 现在：挂到根布局上，文案由 `lib/offline-banner.ts`（纯函数）决定，
 * 只说实话 —— 离线时哪些功能不可用、恢复后要手动重试。
 *
 * 位置：桌面左下角卡片 / 移动端贴底通栏。刻意避开右下角（toast 视口在
 * 桌面是右下角、移动端是顶部），也避开中部（批量操作坞在底部居中）。
 */

import { useEffect, useRef, useState } from 'react'
import { WifiOff, Wifi, ShieldCheck } from 'lucide-react'

import { RECONNECTED_NOTICE_MS, describeOfflineBanner } from '@/lib/offline-banner'

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(true)
  const [justReconnected, setJustReconnected] = useState(false)
  /** 「刚恢复」提示的定时器：必须在卸载 / 再次离线时清掉，否则会在卸载后 setState */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    setIsOnline(navigator.onLine)

    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const handleOnline = () => {
      setIsOnline(true)
      setJustReconnected(true)
      clearTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        setJustReconnected(false)
      }, RECONNECTED_NOTICE_MS)
    }

    const handleOffline = () => {
      clearTimer()
      setIsOnline(false)
      setJustReconnected(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      clearTimer()
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const state = describeOfflineBanner(isOnline, justReconnected)
  if (!state.visible) return null

  const offline = state.tone === 'offline'

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label="网络状态通知"
      className="fixed bottom-4 left-4 right-4 sm:right-auto z-[60] sm:max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-300"
    >
      <div
        className={`rounded-xl px-3.5 py-2.5 text-xs shadow-lg backdrop-blur-md border flex items-start gap-2.5 ${
          offline
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
        }`}
      >
        {offline ? (
          <>
            <WifiOff className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
            <div className="flex-1 min-w-0">
              <span className="font-semibold">{state.title}</span>
              <p className="text-xs opacity-90 mt-0.5 leading-relaxed">{state.hint}</p>
            </div>
          </>
        ) : (
          <>
            <Wifi className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-500" />
            <div className="flex-1 min-w-0">
              <span className="font-semibold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                {state.title}
              </span>
              <p className="text-xs opacity-90 mt-0.5 leading-relaxed">{state.hint}</p>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
