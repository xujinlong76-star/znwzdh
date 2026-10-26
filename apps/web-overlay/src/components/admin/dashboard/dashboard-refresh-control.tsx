'use client'

import React, { useEffect, useState, useRef } from 'react'
import { Check, Clock, Pause, Play, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface DashboardRefreshControlProps {
  onRefresh: (showLoading?: boolean) => void | Promise<void>
  isRefreshing: boolean
  defaultIntervalSeconds?: number
}

export function DashboardRefreshControl({
  onRefresh,
  isRefreshing,
  defaultIntervalSeconds = 30,
}: DashboardRefreshControlProps) {
  const [intervalSec, setIntervalSec] = useState<number>(defaultIntervalSeconds)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(Date.now())
  const [timeAgoText, setTimeAgoText] = useState<string>('刚刚更新')
  const [isTabVisible, setIsTabVisible] = useState<boolean>(true)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // 监听浏览器标签页可见性（Page Visibility API）
  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible'
      setIsTabVisible(visible)
      // 用户重新切回前台时，立即触发一次静默差量更新
      if (visible) {
        onRefresh(false)
        setLastRefreshedAt(Date.now())
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [onRefresh])

  // 计算相对时间字符串（1秒刷新一次相对时间）
  useEffect(() => {
    const calcAgo = () => {
      const diffSec = Math.max(0, Math.floor((Date.now() - lastRefreshedAt) / 1000))
      if (diffSec < 5) {
        setTimeAgoText('刚刚更新')
      } else if (diffSec < 60) {
        setTimeAgoText(`${diffSec}秒前`)
      } else {
        setTimeAgoText(`${Math.floor(diffSec / 60)}分钟前`)
      }
    }

    calcAgo()
    const int = setInterval(calcAgo, 2000)
    return () => clearInterval(int)
  }, [lastRefreshedAt])

  // 定时自动轮询器
  useEffect(() => {
    if (intervalSec <= 0 || !isTabVisible) {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }

    timerRef.current = setInterval(() => {
      onRefresh(false)
      setLastRefreshedAt(Date.now())
    }, intervalSec * 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [intervalSec, isTabVisible, onRefresh])

  const handleManualClick = async () => {
    await onRefresh(true)
    setLastRefreshedAt(Date.now())
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      {/* 上次同步时间指示 */}
      <span
        title={isTabVisible ? `自动刷新中 (${intervalSec}s)` : '后台标签页已自动休眠'}
        className="hidden sm:inline-flex items-center gap-1.5 text-muted-foreground font-mono text-[11px] px-2 py-1 rounded bg-muted/30 border border-border/50"
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            !isTabVisible
              ? 'bg-muted-foreground'
              : intervalSec > 0
              ? 'bg-emerald-500 animate-pulse'
              : 'bg-muted-foreground'
          }`}
        />
        <span>{timeAgoText}</span>
      </span>

      {/* 轮询周期切换器 */}
      <div className="flex items-center rounded-lg border border-border/80 bg-muted/40 p-0.5">
        {[
          { label: '关闭', sec: 0 },
          { label: '15s', sec: 15 },
          { label: '30s', sec: 30 },
          { label: '60s', sec: 60 },
        ].map((item) => (
          <button
            key={item.sec}
            type="button"
            onClick={() => setIntervalSec(item.sec)}
            className={`px-2 py-0.5 text-[11px] font-medium rounded transition-all ${
              intervalSec === item.sec
                ? 'bg-background text-foreground shadow-xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* 立即手动刷新按钮 */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleManualClick}
        disabled={isRefreshing}
        className="h-8 text-xs gap-1.5"
        aria-label="立即同步仪表盘数据"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-primary' : ''}`} />
        <span>刷新</span>
      </Button>
    </div>
  )
}
