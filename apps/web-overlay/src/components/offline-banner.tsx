'use client'

import { useEffect, useRef, useState } from 'react'
import { WifiOff, Wifi, ShieldCheck } from 'lucide-react'

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(true)
  const [justReconnected, setJustReconnected] = useState(false)
  /**
   * 重连提示的定时器必须存在 ref 里由 effect cleanup 清理。
   * 原实现把 `return () => clearTimeout(timer)` 写在事件回调内 —— 该返回值被
   * addEventListener 直接丢弃，重连一次就堆一个永不取消的定时器，
   * 卸载后回调还会对已卸载组件 setState。
   */
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    setIsOnline(navigator.onLine)

    const handleOnline = () => {
      setIsOnline(true)
      setJustReconnected(true)
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = setTimeout(() => {
        setJustReconnected(false)
        reconnectTimerRef.current = null
      }, 3500)
    }

    const handleOffline = () => {
      setIsOnline(false)
      setJustReconnected(false)
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }
  }, [])

  if (isOnline && !justReconnected) return null

  return (
    <aside
      aria-label="网络状态通知"
      className="fixed bottom-4 right-4 z-50 max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-300"
    >
      <div
        className={`rounded-xl px-3.5 py-2.5 text-xs shadow-lg backdrop-blur-md border flex items-center gap-2.5 ${
          !isOnline
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
        }`}
      >
        {!isOnline ? (
          <>
            <WifiOff className="w-4 h-4 flex-shrink-0 text-amber-500 animate-pulse" />
            <div className="flex-1">
              <span className="font-semibold">离线优先模式运行中</span>
              <p className="text-xs opacity-90 mt-0.5">
                已启用本地离岸存储与缓存，您的私密收藏与端侧工具 100% 可用。
              </p>
            </div>
          </>
        ) : (
          <>
            <Wifi className="w-4 h-4 flex-shrink-0 text-emerald-500" />
            <div className="flex-1">
              <span className="font-semibold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> 网络已恢复连接
              </span>
              <p className="text-xs opacity-90 mt-0.5">
                已自动恢复云端同步与实时检索。
              </p>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
