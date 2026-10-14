'use client'

/**
 * 管理端：运营数据看板。
 * 热门搜索（指导补录）、零结果搜索（用户找了但库里没有）、热度榜。
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { hubGet } from '@/lib/navhub-api'

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
  /** 成功率百分比（0-100）；当天没有巡检为 null（不是 100%） */
  rate: number | null
  avgLatencyMs: number | null
}

/**
 * 成功率曲线：SVG 折线（每天一个点，断点用 null 跳过）。
 * 不引入图表库——14/30 个点的折线用几行 SVG 就够，且避免给 admin 页加 bundle 负担。
 */
function HealthTrendChart({ points }: { points: HealthTrendPoint[] }) {
  const w = 560
  const h = 140
  const padX = 28
  const padY = 16
  const withData = points.filter((p) => p.rate !== null)
  if (withData.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        暂无巡检记录（health_check 任务或 MCP health_check 运行后生成）。
      </p>
    )
  }
  const step = points.length > 1 ? (w - padX * 2) / (points.length - 1) : 0
  const xOf = (i: number) => padX + step * i
  const yOf = (rate: number) => h - padY - (rate / 100) * (h - padY * 2)

  // 连续有数据的点连成一段段折线（null 断开，避免用直线「补」出不存在的数据）
  const segments: string[] = []
  let cur: string[] = []
  points.forEach((p, i) => {
    if (p.rate === null) {
      if (cur.length > 1) segments.push(cur.join(' '))
      cur = []
      return
    }
    cur.push(xOf(i).toFixed(1) + ',' + yOf(p.rate).toFixed(1))
  })
  if (cur.length > 1) segments.push(cur.join(' '))

  const totalChecked = points.reduce((s, p) => s + p.checked, 0)
  const totalFailed = points.reduce((s, p) => s + p.failed, 0)

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2">
        近 {points.length} 天：巡检 {totalChecked} 次 · 失败 {totalFailed} 次
        {totalChecked > 0 && ` · 总体成功率 ${Math.round(((totalChecked - totalFailed) / totalChecked) * 100)}%`}
      </div>
      <div className="rounded-md border overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto min-w-[480px]" role="img" aria-label="健康巡检成功率趋势">
          {/* 横向刻度 0/50/100% */}
          {[0, 50, 100].map((r) => (
            <g key={r}>
              <line x1={padX} x2={w - padX} y1={yOf(r)} y2={yOf(r)} className="stroke-border" strokeDasharray="3 3" strokeWidth="1" />
              <text x={4} y={yOf(r) + 3} className="fill-muted-foreground" fontSize="9">{r}%</text>
            </g>
          ))}
          {segments.map((s, i) => (
            <polyline key={i} points={s} fill="none" className="stroke-primary" strokeWidth="2" strokeLinejoin="round" />
          ))}
          {points.map((p, i) =>
            p.rate === null ? null : (
              <circle key={p.date} cx={xOf(i)} cy={yOf(p.rate)} r="2.5" className="fill-primary">
                <title>{`${p.date}：成功率 ${p.rate}%（${p.checked} 次，失败 ${p.failed} 次）`}</title>
              </circle>
            ),
          )}
          {/* x 轴标签：首/中/尾，避免挤 */}
          {[0, Math.floor(points.length / 2), points.length - 1].map((i) =>
            points[i] ? (
              <text key={i} x={xOf(i)} y={h - 3} textAnchor="middle" className="fill-muted-foreground" fontSize="9">
                {points[i].date.slice(5)}
              </text>
            ) : null,
          )}
        </svg>
      </div>
      <div className="text-xs text-muted-foreground mt-1.5">
        断点 = 当天没有巡检记录（不是 0% 失败）。悬停圆点查看当日明细。
      </div>
    </div>
  )
}

export default function AdminStatsPage() {
  const [data, setData] = useState<Trends | null>(null)
  const [health, setHealth] = useState<HealthTrendPoint[] | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    void hubGet<Trends>('/api/hub/admin/stats/trends?days=30').then((d: Trends) => { setData(d); setLoading(false) })
    // 健康趋势独立加载：失败只显示「暂无数据」，不阻塞整个看板
    void hubGet<{ points: HealthTrendPoint[] }>('/api/hub/admin/health/trend?days=14')
      .then((d) => setHealth(d.points))
      .catch(() => setHealth([]))
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="p-6 text-muted-foreground text-sm">加载中…</div>
  if (!data) return <div className="p-6 text-muted-foreground text-sm">加载失败</div>

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold mb-6">运营数据（近 {data.days} 天）</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="lg:col-span-2">
          <h2 className="text-base font-medium mb-3">健康巡检趋势（近 14 天成功率）</h2>
          {health === null ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : (
            <HealthTrendChart points={health} />
          )}
        </section>
        <section>
          <h2 className="text-base font-medium mb-3">热门搜索 Top 20</h2>
          {data.topQueries.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无数据</p>
          ) : (
            <div className="rounded-md border divide-y">
              {data.topQueries.map((q) => (
                <div key={q.query} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="truncate">{q.query}</span>
                  <span className="text-muted-foreground text-xs">{q.count} 次</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-base font-medium mb-3">零结果搜索（补录线索）</h2>
          {data.zeroResultQueries.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无数据</p>
          ) : (
            <div className="rounded-md border divide-y">
              {data.zeroResultQueries.map((q) => (
                <div key={q.query} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="truncate">{q.query}</span>
                  <span className="text-muted-foreground text-xs">
                    {q.count} 次 · {new Date(q.lastAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="lg:col-span-2">
          <h2 className="text-base font-medium mb-3">热度榜 Top 20</h2>
          {data.hotSites.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无数据（recompute_rank 任务运行后生成）</p>
          ) : (
            <div className="rounded-md border divide-y">
              {data.hotSites.map((s, i) => (
                <div key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="truncate">
                    <span className="text-muted-foreground mr-2">{i + 1}</span>
                    <Link href={'/site/' + s.id} className="hover:text-primary">{s.title}</Link>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {s.visitCount} 次点击 · 热度 {s.trendScore.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
