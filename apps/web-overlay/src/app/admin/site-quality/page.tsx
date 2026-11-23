'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { RefreshCw, ShieldCheck, AlertTriangle, SearchCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { hubGet } from '@/lib/navhub-api'

type QualityBand = 'high' | 'medium' | 'low' | 'high_risk' | 'insufficient_evidence'
type Dimension = {
  score: number | null
  evidence: string[]
}
type Dimensions = {
  accessibility: Dimension
  contentCompleteness: Dimension
  sourceTrust: Dimension
  relevance: Dimension
  uniqueness: Dimension
  freshness: Dimension
  risk: Dimension
}
interface QualityItem {
  siteId: string
  title: string
  url: string
  categoryId: string
  status: string
  version: string
  evaluatedAt: number
  score: number | null
  evidenceCoverage: number
  observedDimensions: number
  riskScore: number | null
  band: QualityBand
  dimensions: Dimensions
  updatedAt: number
}
interface QualitySummary {
  totalSites: number
  assessedSites: number
  unassessedSites: number
  highRiskCount: number
  insufficientEvidenceCount: number
  highCount: number
  mediumCount: number
  lowCount: number
  averageScore: number | null
  averageEvidenceCoverage: number | null
  lastEvaluatedAt: number | null
}
interface QualityResponse {
  ok: boolean
  summary: QualitySummary
  items: QualityItem[]
  total: number
  limit: number
  offset: number
  band: string
}

const PAGE_SIZE = 50
const BAND_LABEL: Record<QualityBand, string> = {
  high: '高质量候选',
  medium: '中等',
  low: '待改进',
  high_risk: '高风险待复核',
  insufficient_evidence: '证据不足',
}
const DIMENSION_LABEL: Record<keyof Dimensions, string> = {
  accessibility: '可访问性',
  contentCompleteness: '内容完整度',
  sourceTrust: '来源可信度',
  relevance: '内容相关性',
  uniqueness: '独特性',
  freshness: '时效性',
  risk: '风险严重度',
}
const FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: '全部站点' },
  { value: 'high_risk', label: '高风险待复核' },
  { value: 'insufficient_evidence', label: '证据不足' },
  { value: 'low', label: '待改进' },
  { value: 'medium', label: '中等' },
  { value: 'high', label: '高质量候选' },
]

function formatTime(value: number | null): string {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '暂无'
}

function scoreLabel(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
}

export default function SiteQualityAdminPage() {
  const [data, setData] = useState<QualityResponse | null>(null)
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (offset = 0, append = false) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (filter !== 'all') params.set('band', filter)
      const response = await hubGet<QualityResponse>('/api/hub/admin/quality/report?' + params.toString())
      setData((previous) => append && previous
        ? { ...response, items: [...previous.items, ...response.items] }
        : response)
    } catch (err) {
      setError(err instanceof Error ? err.message : '质量数据加载失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  const summary = data?.summary
  const hasMore = Boolean(data && data.items.length < data.total)

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-3 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldCheck className="h-6 w-6" aria-hidden />
            站点质量治理
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            基于巡检记录与目录证据生成的影子评分。当前仅用于观察和人工复核，不会自动下架站点，也不会改变搜索与推荐排序。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          刷新
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {error}
          </CardContent>
        </Card>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {[
            ['站点总数', summary.totalSites],
            ['已评估', summary.assessedSites],
            ['未评估', summary.unassessedSites],
            ['高风险', summary.highRiskCount],
            ['证据不足', summary.insufficientEvidenceCount],
            ['平均分', scoreLabel(summary.averageScore)],
            ['平均证据覆盖', summary.averageEvidenceCoverage === null ? '—' : summary.averageEvidenceCoverage + '%'],
          ].map(([label, value]) => (
            <Card key={String(label)}>
              <CardHeader className="pb-2">
                <CardDescription>{label}</CardDescription>
                <CardTitle className="text-2xl">{value}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">质量证据清单</CardTitle>
            <CardDescription>风险与证据缺口优先显示；未知分数不会被当成 0 分。</CardDescription>
          </div>
          <select
            aria-label="质量分档筛选"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">正在读取质量证据…</p>
          ) : !data || data.items.length === 0 ? (
            <div className="py-10 text-center">
              <SearchCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">暂无质量快照</p>
              <p className="mt-1 text-xs text-muted-foreground">站点完成健康巡检后，会在这里生成第一版证据评分。</p>
            </div>
          ) : (
            data.items.map((item) => (
              <article key={item.siteId} className="rounded-xl border border-border/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/site/${encodeURIComponent(item.siteId)}`} className="break-all text-sm font-semibold hover:text-primary">
                      {item.title}
                    </Link>
                    <p className="mt-1 break-all text-xs text-muted-foreground">{item.url}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      类目：{item.categoryId} · 站点状态：{item.status} · 规则：{item.version}
                    </p>
                  </div>
                  <div className="min-w-32 text-right">
                    <div className="text-2xl font-semibold tabular-nums">{scoreLabel(item.score)}</div>
                    <div className="text-xs text-muted-foreground">{BAND_LABEL[item.band]}</div>
                    <div className="mt-1 text-xs text-muted-foreground">证据覆盖 {item.evidenceCoverage}%</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border px-2 py-1">已观测 {item.observedDimensions}/7 维</span>
                  {item.riskScore !== null && <span className="rounded-full border px-2 py-1">风险严重度 {item.riskScore}</span>}
                  <span className="rounded-full border px-2 py-1">评估于 {formatTime(item.evaluatedAt)}</span>
                </div>
                <details className="mt-3 rounded-lg bg-muted/30 p-3">
                  <summary className="cursor-pointer text-sm font-medium">查看七维证据明细</summary>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {(Object.keys(DIMENSION_LABEL) as Array<keyof Dimensions>).map((key) => {
                      const dimension = item.dimensions[key]
                      return (
                        <div key={key} className="rounded-md border border-border/60 p-3">
                          <div className="flex justify-between gap-2 text-sm font-medium">
                            <span>{DIMENSION_LABEL[key]}</span>
                            <span className="tabular-nums">{dimension.score === null ? '未知' : dimension.score + (key === 'risk' ? ' 严重度' : ' 分')}</span>
                          </div>
                          {dimension.evidence.length > 0 ? (
                            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                              {dimension.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}
                            </ul>
                          ) : (
                            <p className="mt-2 text-xs text-muted-foreground">暂无可用证据</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </details>
              </article>
            ))
          )}
          {data && data.items.length > 0 && hasMore && (
            <div className="pt-2 text-center">
              <Button variant="outline" onClick={() => void load(data.offset + data.limit, true)} disabled={loadingMore}>
                {loadingMore ? '加载中…' : '加载更多'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        最近一次评分更新时间：{formatTime(summary?.lastEvaluatedAt ?? null)}。分数权重与证据口径仍处于 v1 校准阶段。
      </p>
    </div>
  )
}
