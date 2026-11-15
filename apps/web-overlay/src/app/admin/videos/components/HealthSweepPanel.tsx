'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Button } from '@/registry/new-york/ui/button'
import { ShieldCheck, Play, RefreshCw, Loader2 } from 'lucide-react'

/**
 * 视频健康巡检面板（管理端视频页）。
 *
 * 显示的是真实状态，不是写死的文案：调度器是否启动/间隔/下次运行、
 * 断点检查点（本轮扫到哪）、上次巡检结果，都来自 `GET /api/videos/health-sweep`；
 * 两个按钮都真实触发巡检（`POST /api/videos/health-sweep`），跑完后按返回的
 * coverage 刷新数字；已有巡检在跑时按钮禁用，后端也会回 409。
 */

interface HealthSweepStatus {
  scheduler: {
    started: boolean
    enabled: boolean
    intervalMs: number
    nextRunAt: number | null
    lastRunAt: number | null
    lastOutcome: string | null
    running: boolean
  }
  run: { running: boolean; scope: string | null; startedAt: number | null }
  checkpoint: {
    runId: string
    cursor: string | null
    scanned: number
    total: number
    updatedAt: number
    done: boolean
    lastHealthy?: number
    lastDead?: number
    lastUnverified?: number
    lastPruned?: number
  } | null
  metrics: { runs: number; failed: number; healthy: number; dead: number; unverified: number; pruned: number }
  config: { enabled: boolean; intervalMs: number; pageSize: number }
}

interface SweepRunResponse {
  success: boolean
  error?: string
  coverage?: { runId: string; total: number; scanned: number; remaining: number; done: boolean }
  report?: { healthyCount: number; brokenCount: number; unverifiedCount?: number; prunedCount?: number }
  pages?: number
  nextCursor?: string | null
  done?: boolean
}

async function statusFetcher(url: string): Promise<HealthSweepStatus> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch health sweep status')
  return res.json()
}

function formatTime(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

function formatInterval(ms: number): string {
  if (ms >= 60 * 60 * 1000) return `每 ${Math.round(ms / (60 * 60 * 1000))} 小时`
  return `每 ${Math.round(ms / 60000)} 分钟`
}

export function HealthSweepPanel() {
  const { data, error, isLoading, mutate } = useSWR<HealthSweepStatus>(
    '/api/videos/health-sweep',
    statusFetcher,
    { revalidateOnFocus: false },
  )
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const running = busy || data?.run.running === true || data?.scheduler.running === true
  const checkpoint = data?.checkpoint ?? null
  const hasResumePoint = checkpoint !== null && !checkpoint.done && checkpoint.cursor !== null
  const coveragePct =
    checkpoint && checkpoint.total > 0 ? Math.round((checkpoint.scanned / checkpoint.total) * 100) : null

  async function triggerSweep(cursor: string | null) {
    if (busy) return
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/videos/health-sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full: true, cursor }),
      })
      const payload = (await res.json()) as SweepRunResponse
      if (!res.ok || !payload.success) {
        setResult(res.status === 409 ? '已有巡检在跑，稍后再试。' : `巡检失败：${payload.error ?? `HTTP ${res.status}`}`)
        return
      }
      const coverage = payload.coverage
      const report = payload.report
      setResult(
        coverage?.done
          ? `已扫完全库：${coverage.scanned}/${coverage.total} 条（${payload.pages ?? 1} 页），健康 ${report?.healthyCount ?? 0} / 失效 ${report?.brokenCount ?? 0} / 未确认 ${report?.unverifiedCount ?? 0}。`
          : `本轮扫到 ${coverage?.scanned ?? 0}/${coverage?.total ?? 0} 条（预算到点），剩余 ${coverage?.remaining ?? 0} 条，下次自动续扫。`,
      )
    } catch (err) {
      setResult(`巡检失败：${err instanceof Error ? err.message : '网络错误'}`)
    } finally {
      setBusy(false)
      void mutate()
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h2 className="text-base sm:text-lg font-bold tracking-tight">视频健康巡检</h2>
            {data && (
              <span className="text-xs rounded-full border px-2 py-0.5 text-muted-foreground">
                {data.scheduler.started
                  ? `定时运行中 · ${formatInterval(data.scheduler.intervalMs)}`
                  : data.scheduler.enabled
                    ? '定时已配置（服务启动后生效）'
                    : '定时已禁用'}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            按页扫完全库（不是只扫前几十条），断点写进检查点，中断后下轮自动续扫；空库时报告 0 条待查。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasResumePoint && (
            <Button
              variant="outline"
              size="sm"
              disabled={running}
              onClick={() => void triggerSweep(checkpoint?.cursor ?? null)}
              className="gap-1.5 text-xs h-9"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span>从断点续扫（已扫 {checkpoint?.scanned ?? 0}/{checkpoint?.total ?? 0}）</span>
            </Button>
          )}
          <Button size="sm" disabled={running} onClick={() => void triggerSweep(null)} className="gap-1.5 text-xs h-9">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            <span>{running ? '巡检进行中…' : '立即巡检全库'}</span>
          </Button>
        </div>
      </div>

      <div className="mt-4 pt-3.5 border-t border-border/60 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="space-y-0.5">
          <span className="text-muted-foreground">全库覆盖</span>
          <div className="text-base font-semibold text-foreground">
            {isLoading ? '…' : error ? '读取失败' : checkpoint ? `${checkpoint.scanned}/${checkpoint.total} 条${coveragePct !== null ? `（${coveragePct}%）` : ''}` : '尚未巡检'}
          </div>
        </div>
        <div className="space-y-0.5">
          <span className="text-muted-foreground">本轮结果（健康 / 失效 / 未确认）</span>
          <div className="text-base font-semibold text-foreground">
            {isLoading
              ? '…'
              : checkpoint
                ? `${checkpoint.lastHealthy ?? 0} / ${checkpoint.lastDead ?? 0} / ${checkpoint.lastUnverified ?? 0}`
                : '—'}
          </div>
        </div>
        <div className="space-y-0.5">
          <span className="text-muted-foreground">上次巡检</span>
          <div className="text-base font-semibold text-foreground">
            {isLoading ? '…' : formatTime(checkpoint?.updatedAt ?? null)}
          </div>
        </div>
        <div className="space-y-0.5">
          <span className="text-muted-foreground">下次定时巡检</span>
          <div className="text-base font-semibold text-foreground">
            {isLoading ? '…' : formatTime(data?.scheduler.nextRunAt ?? null)}
          </div>
        </div>
      </div>

      {result && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{result}</p>}
      {data?.scheduler.lastOutcome && !result && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">上轮调度：{data.scheduler.lastOutcome}</p>
      )}
    </div>
  )
}
