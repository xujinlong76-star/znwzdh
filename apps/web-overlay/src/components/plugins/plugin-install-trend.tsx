'use client'

/**
 * 单插件安装趋势（D 批）：详情页「影响评估」tab 内的 30 天安装量柱状图。
 *
 * 数据来自 GET /api/plugins/:slug/trend（按天聚合 plugin_install_success
 * 真实事件，零安装的日子补 0）。加载失败时只显示一行 muted 提示、不编造
 * 曲线；total 为 0 时如实显示「近 30 天安装 0 次」与全零柱形。
 */
import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { fetchPluginInstallTrend, type PluginInstallTrend } from '@/lib/navhub-api'

export function PluginInstallTrendChart({ slug }: { slug: string }) {
  const [trend, setTrend] = useState<PluginInstallTrend | null>(null)
  const [failed, setFailed] = useState(false)
  // 重试计数：失败后点「重试」+1，effect 重跑再拉一次（不编造、不静默）。
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    setTrend(null)
    void fetchPluginInstallTrend(slug, 30).then((res) => {
      if (cancelled) return
      if (res) setTrend(res)
      else setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [slug, attempt])

  if (failed) {
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] text-muted-foreground">安装趋势暂不可用，请稍后刷新重试。</p>
        <button
          type="button"
          aria-label="重新加载安装趋势"
          onClick={() => setAttempt((n) => n + 1)}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <RotateCcw className="w-3 h-3" aria-hidden />
          <span>重试</span>
        </button>
      </div>
    )
  }
  if (!trend) {
    return <p className="text-[11px] text-muted-foreground">正在加载安装趋势…</p>
  }
  const max = Math.max(1, ...trend.series.map((d) => d.installs))
  const start = trend.series[0]?.date ?? ''
  const end = trend.series[trend.series.length - 1]?.date ?? ''
  return (
    <div className="pt-2 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-medium text-foreground">
          安装趋势（近 {trend.days} 天，共 {trend.total} 次）
        </h4>
        <span className="text-[10px] text-muted-foreground font-mono">
          {start} ~ {end}
        </span>
      </div>
      <div
        role="img"
        aria-label={`近 ${trend.days} 天安装趋势，共 ${trend.total} 次安装`}
        className="flex items-end gap-px h-20 rounded-lg bg-muted/30 border border-border/40 p-2"
      >
        {trend.series.map((d) => (
          <div
            key={d.date}
            title={`${d.date}：安装 ${d.installs} 次`}
            className="flex-1 rounded-sm bg-primary/70 hover:bg-primary transition-colors min-w-0"
            style={{ height: `${Math.max(d.installs > 0 ? 6 : 2, (d.installs / max) * 100)}%` }}
          />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        按天聚合真实安装记录；没有安装的日子记 0，不跳过、不补曲线。
      </p>
    </div>
  )
}
