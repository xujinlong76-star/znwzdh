'use client'

/**
 * 管理端：运营数据与搜索智能看板。
 * 包含健康巡检与响应延迟趋势曲线、热门搜索、零结果补录线索、热度总榜与时间窗口切换。
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  ArrowRight,
  Clock,
  ExternalLink,
  Flame,
  PlusCircle,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { hubGet } from '@/lib/navhub-api'
import { describeDegrade } from '@/lib/degrade'

interface Trends {
  days: number
  topQueries: Array<{ query: string; count: number }>
  zeroResultQueries: Array<{ query: string; count: number; lastAt: number }>
  hotSites: Array<{ id: string; url: string; title: string; visitCount: number; trendScore: number }>
}

interface HealthTrendPoint {
  date: string
  checked: number
  failed: number
  /** 成功率百分比（0-100）；当天没有巡检为 null */
  rate: number | null
  avgLatencyMs: number | null
}

/**
 * 成功率与响应延迟趋势图：双轴 SVG 折线
 */
function HealthTrendChart({ points }: { points: HealthTrendPoint[] }) {
  const w = 680
  const h = 180
  const padX = 36
  const padY = 24

  const withData = points.filter((p) => p.rate !== null)
  if (withData.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground border rounded-lg bg-card">
        暂无巡检记录（可在后台任务面板触发「健康巡检」或等待定时任务巡检）。
      </div>
    )
  }

  const step = points.length > 1 ? (w - padX * 2) / (points.length - 1) : 0
  const xOf = (i: number) => padX + step * i
  const yOfRate = (rate: number) => h - padY - (rate / 100) * (h - padY * 2)

  // 计算延迟的最大上限，用于自适应归一化延迟坐标
  const maxLat = Math.max(100, ...points.map((p) => p.avgLatencyMs ?? 0))
  const yOfLat = (lat: number) => h - padY - (Math.min(maxLat, lat) / maxLat) * (h - padY * 2)

  // 成功率折线段
  const rateSegments: string[] = []
  let curRate: string[] = []
  points.forEach((p, i) => {
    if (p.rate === null) {
      if (curRate.length > 1) rateSegments.push(curRate.join(' '))
      curRate = []
      return
    }
    curRate.push(xOf(i).toFixed(1) + ',' + yOfRate(p.rate).toFixed(1))
  })
  if (curRate.length > 1) rateSegments.push(curRate.join(' '))

  // 延迟折线段
  const latSegments: string[] = []
  let curLat: string[] = []
  points.forEach((p, i) => {
    if (p.avgLatencyMs === null) {
      if (curLat.length > 1) latSegments.push(curLat.join(' '))
      curLat = []
      return
    }
    curLat.push(xOf(i).toFixed(1) + ',' + yOfLat(p.avgLatencyMs).toFixed(1))
  })
  if (curLat.length > 1) latSegments.push(curLat.join(' '))

  const totalChecked = points.reduce((s, p) => s + p.checked, 0)
  const totalFailed = points.reduce((s, p) => s + p.failed, 0)
  const avgOverallRate =
    totalChecked > 0 ? Math.round(((totalChecked - totalFailed) / totalChecked) * 100) : 100

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between text-xs text-muted-foreground gap-2">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-primary inline-block rounded" />
            成功率曲线 (可用率: <strong className="text-foreground">{avgOverallRate}%</strong>)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-amber-500 inline-block rounded stroke-dash" />
            平均响应延迟 (峰值: <strong className="text-foreground">{maxLat}ms</strong>)
          </span>
        </div>
        <div>
          巡检 {totalChecked} 次 · 故障 {totalFailed} 次
        </div>
      </div>

      <div className="rounded-lg border bg-card p-2 overflow-x-auto">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="w-full h-auto min-w-[560px]"
          role="img"
          aria-label="健康巡检与响应延迟趋势图"
        >
          {/* 背景刻度 0% / 50% / 100% */}
          {[0, 50, 100].map((r) => (
            <g key={r}>
              <line
                x1={padX}
                x2={w - padX}
                y1={yOfRate(r)}
                y2={yOfRate(r)}
                className="stroke-border"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              <text x={6} y={yOfRate(r) + 3} className="fill-muted-foreground text-[10px]">
                {r}%
              </text>
            </g>
          ))}

          {/* 延迟折线（虚线，琥珀色） */}
          {latSegments.map((s, i) => (
            <polyline
              key={'lat-' + i}
              points={s}
              fill="none"
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeDasharray="4 2"
              strokeLinejoin="round"
            />
          ))}

          {/* 成功率折线（主色，实线） */}
          {rateSegments.map((s, i) => (
            <polyline
              key={'rate-' + i}
              points={s}
              fill="none"
              className="stroke-primary"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          ))}

          {/* 数据圆点 */}
          {points.map((p, i) =>
            p.rate === null ? null : (
              <g key={p.date}>
                <circle
                  cx={xOf(i)}
                  cy={yOfRate(p.rate)}
                  r="3"
                  className="fill-primary cursor-pointer hover:r-4 transition-all"
                >
                  <title>{`${p.date}\n成功率: ${p.rate}%\n巡检: ${p.checked} 次\n失败: ${p.failed} 次\n平均延迟: ${p.avgLatencyMs ?? '--'}ms`}</title>
                </circle>
              </g>
            ),
          )}

          {/* x 轴日期刻度（首、1/4、1/2、3/4、尾） */}
          {[
            0,
            Math.floor(points.length * 0.25),
            Math.floor(points.length * 0.5),
            Math.floor(points.length * 0.75),
            points.length - 1,
          ].map((i) =>
            points[i] ? (
              <text
                key={i}
                x={xOf(i)}
                y={h - 6}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {points[i].date.slice(5)}
              </text>
            ) : null,
          )}
        </svg>
      </div>
      <div className="text-[11px] text-muted-foreground">
        * 断点表示当天无巡检记录；悬停圆点可查看当日详细可用率与毫秒耗时。
      </div>
    </div>
  )
}

export default function AdminStatsPage() {
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<Trends | null>(null)
  const [health, setHealth] = useState<HealthTrendPoint[] | null>(null)
  const [loading, setLoading] = useState(true)
  // 拉取失败必须能持续显示：只写控制台的话，下面那些「暂无…」就会把故障说成「没数据」
  const [loadError, setLoadError] = useState<unknown>(null)

  const load = useCallback((selectedDays: number) => {
    setLoading(true)
    Promise.all([
      hubGet<Trends>(`/api/hub/admin/stats/trends?days=${selectedDays}`),
      hubGet<{ points: HealthTrendPoint[] }>(`/api/hub/admin/health/trend?days=${selectedDays}`),
    ])
      .then(([trendsData, healthData]) => {
        setData(trendsData)
        setHealth(healthData?.points || [])
        setLoadError(null)
      })
      .catch((err) => {
        console.error('Failed to load stats trends:', err)
        setLoadError(err)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load(days)
  }, [load, days])

  const degradeNotice = loadError ? describeDegrade(loadError) : null
  // 加载失败时，所有「暂无…」都必须换成「没加载出来」——
  // 否则等于把故障说成「确实没有数据」（其中一句还会「太棒了！」地恭喜你）。
  const emptyHint = (normal: string) =>
    loadError && !data ? '统计趋势没能加载出来（见上方说明）' : normal

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* 头部与时间窗口控制器 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">运营与搜索洞察看板</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            近 {days} 天系统巡检可用率、高频检索词与热度总榜
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* 时间跨度 Pills */}
          <div className="flex rounded-lg border bg-muted/30 p-1 text-xs">
            {[7, 14, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  days === d
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                近 {d} 天
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => load(days)}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* 拉取失败必须说出来：以前这里只 console.error，下面的「暂无…」就把故障说成了没数据 */}
      {degradeNotice && (
        <div
          role="status"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          <span>
            {data
              ? `本次刷新失败，下面是上一次成功获取的统计趋势。${degradeNotice.message}`
              : `没能取回统计趋势。${degradeNotice.message}`}
          </span>
          {degradeNotice.retryable && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 text-xs"
              onClick={() => load(days)}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              重试
            </Button>
          )}
        </div>
      )}

      {/* 健康巡检趋势曲线 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-500" />
            站点健康巡检与响应延迟趋势
          </CardTitle>
          <CardDescription>
            全站已收录站点近 {days} 天巡检通过率与平均网络往返耗时（毫秒）
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !health ? (
            <div className="py-12 text-center text-sm text-muted-foreground">正在加载趋势数据...</div>
          ) : loadError && !data ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              巡检趋势没能加载出来（见上方说明）。
            </div>
          ) : (
            <HealthTrendChart points={health || []} />
          )}
        </CardContent>
      </Card>

      {/* 核心洞察两列网格 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 热门搜索词 Top 20 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" />
              热门搜索词 Top 20
            </CardTitle>
            <CardDescription>反映当前用户最迫切的需求与高频热搜意图</CardDescription>
          </CardHeader>
          <CardContent>
            {data?.topQueries && data.topQueries.length > 0 ? (
              <div className="rounded-lg border divide-y text-sm">
                {data.topQueries.map((q, idx) => (
                  <div key={q.query} className="flex items-center justify-between px-3 py-2.5">
                    <span className="flex items-center gap-2 truncate">
                      <span className="text-xs font-mono text-muted-foreground w-5 text-right">
                        {idx + 1}
                      </span>
                      <span className="font-medium truncate">{q.query}</span>
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {q.count} 次
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-6 text-center">{emptyHint('暂无搜索统计记录')}</p>
            )}
          </CardContent>
        </Card>

        {/* 零结果搜索（补录线索） */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-amber-600 dark:text-amber-500">
              <Sparkles className="h-4 w-4" />
              零结果搜索（补录线索）
            </CardTitle>
            <CardDescription>
              用户主动搜索但库内未收录的关键词，可一键直达录入
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data?.zeroResultQueries && data.zeroResultQueries.length > 0 ? (
              <div className="rounded-lg border divide-y text-sm">
                {data.zeroResultQueries.map((q) => (
                  <div key={q.query} className="flex items-center justify-between px-3 py-2.5">
                    <div className="truncate mr-2">
                      <div className="font-medium truncate">{q.query}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {q.count} 次无结果 · 最近于{' '}
                        {new Date(q.lastAt).toLocaleDateString('zh-CN')}
                      </div>
                    </div>
                    <Button asChild variant="ghost" size="sm" className="h-8 text-xs text-primary">
                      <Link
                        href={`/admin/sitelist?action=add&keyword=${encodeURIComponent(q.query)}`}
                      >
                        <PlusCircle className="h-3.5 w-3.5 mr-1" />
                        补录
                      </Link>
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {emptyHint('太棒了！近期没有任何未命中的零结果搜索。')}
              </p>
            )}
          </CardContent>
        </Card>

        {/* 热度榜 Top 20 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-500" />
              站点综合热度榜 Top 20
            </CardTitle>
            <CardDescription>
              基于浏览点击、驻留时长与时间衰减算法（Trend Score）加权排序
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data?.hotSites && data.hotSites.length > 0 ? (
              <div className="rounded-lg border divide-y text-sm">
                {data.hotSites.map((s, idx) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between px-3.5 py-2.5 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 truncate mr-4">
                      <span
                        className={`text-xs font-bold w-5 text-right ${
                          idx === 0
                            ? 'text-amber-500'
                            : idx === 1
                            ? 'text-slate-400'
                            : idx === 2
                            ? 'text-amber-700'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <Link
                        href={`/site/${s.id}`}
                        target="_blank"
                        className="font-medium hover:text-primary transition-colors flex items-center gap-1 truncate"
                      >
                        {s.title}
                        <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                      </Link>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                      <span>{s.visitCount} 次点击</span>
                      <Badge variant="outline" className="text-[11px] font-mono">
                        热度 {s.trendScore.toFixed(2)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {emptyHint('暂无热度数据（可运行 recompute_rank 任务生成）')}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
