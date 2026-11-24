'use client'

import { useCallback, useEffect, useState } from 'react'
import { ClipboardCheck, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { hubGet, hubSend } from '@/lib/navhub-api'
import { safeHref } from '@/lib/safe-url'

type CandidateStatus = 'pending' | 'approved' | 'rejected'
interface DiscoveryCandidate {
  id: string
  url: string
  canonicalUrl: string
  title: string | null
  description: string | null
  categoryId: string | null
  tags: string[]
  source: string
  confidence: number | null
  evidence: Record<string, unknown>
  status: CandidateStatus
  siteId: string | null
  discoveredAt: number
  lastSeenAt: number
  reviewedAt: number | null
  reviewedBy: string | null
  rejectionReason: string | null
}
interface DiscoveryResponse {
  ok: boolean
  items: DiscoveryCandidate[]
  total: number
  limit: number
  offset: number
  status: string
}

const PAGE_SIZE = 30
const FILTERS: Array<{ value: CandidateStatus | 'all'; label: string }> = [
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'all', label: '全部' },
]

function formatTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export default function DiscoveryReviewPage() {
  const [status, setStatus] = useState<CandidateStatus | 'all'>('pending')
  const [data, setData] = useState<DiscoveryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reasons, setReasons] = useState<Record<string, string>>({})

  const load = useCallback(async (offset = 0, append = false) => {
    setLoading(!append)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (status !== 'all') params.set('status', status)
      const response = await hubGet<DiscoveryResponse>('/api/hub/admin/discovery/candidates?' + params.toString())
      setData((previous) => append && previous
        ? { ...response, items: [...previous.items, ...response.items] }
        : response)
    } catch (err) {
      setError(err instanceof Error ? err.message : '候选队列加载失败')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  const review = async (candidate: DiscoveryCandidate, action: 'approve' | 'reject') => {
    if (busyId) return
    setBusyId(candidate.id)
    setError(null)
    try {
      await hubSend(
        '/api/hub/admin/discovery/candidates/' + encodeURIComponent(candidate.id) + '/review',
        'POST',
        action === 'approve'
          ? { action }
          : { action, rejectionReason: reasons[candidate.id] || '人工审核未通过' },
      )
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '审核操作失败')
    } finally {
      setBusyId(null)
    }
  }

  const hasMore = Boolean(data && data.items.length < data.total)

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-3 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardCheck className="h-6 w-6" aria-hidden />
            自动采集审核
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            AI、导入和其他采集来源先进入隔离候选队列。只有管理员明确通过后，站点才会进入正式导航目录。
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

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="采集候选状态">
        {FILTERS.map((item) => (
          <Button
            key={item.value}
            size="sm"
            variant={status === item.value ? 'default' : 'outline'}
            role="tab"
            aria-selected={status === item.value}
            onClick={() => setStatus(item.value)}
          >
            {item.label}
          </Button>
        ))}
        {data && <span className="self-center text-xs text-muted-foreground">共 {data.total} 条</span>}
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">正在读取候选…</p>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">当前没有候选记录</p>
            <p className="mt-1 text-xs text-muted-foreground">采集端提交的新网址会先进入待审核队列，不会自动公开。</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.items.map((candidate) => (
            <Card key={candidate.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="break-all text-base">{candidate.title || new URL(candidate.url).hostname}</CardTitle>
                    <CardDescription className="mt-1 break-all">
                      <a href={safeHref(candidate.url)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                        {candidate.url}
                      </a>
                    </CardDescription>
                  </div>
                  <span className="rounded-full border px-2.5 py-1 text-xs">
                    {candidate.status === 'pending' ? '待审核' : candidate.status === 'approved' ? '已通过' : '已拒绝'}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {candidate.description && <p className="text-sm text-muted-foreground">{candidate.description}</p>}
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-md bg-muted px-2 py-1">来源：{candidate.source}</span>
                  {candidate.categoryId && <span className="rounded-md bg-muted px-2 py-1">类目：{candidate.categoryId}</span>}
                  {candidate.confidence !== null && <span className="rounded-md bg-muted px-2 py-1">采集置信度：{Math.round(candidate.confidence * 100)}%</span>}
                  <span className="rounded-md bg-muted px-2 py-1">首次发现：{formatTime(candidate.discoveredAt)}</span>
                  <span className="rounded-md bg-muted px-2 py-1">最近出现：{formatTime(candidate.lastSeenAt)}</span>
                </div>
                {candidate.tags.length > 0 && <p className="text-xs text-muted-foreground">标签：{candidate.tags.join('、')}</p>}
                <details className="rounded-lg bg-muted/30 p-3">
                  <summary className="cursor-pointer text-sm font-medium">采集证据与来源数据</summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">{JSON.stringify(candidate.evidence, null, 2)}</pre>
                </details>
                {candidate.status === 'pending' ? (
                  <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center">
                    <Button size="sm" disabled={busyId !== null} onClick={() => void review(candidate, 'approve')}>
                      <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden />
                      {busyId === candidate.id ? '处理中…' : '审核通过并入库'}
                    </Button>
                    <input
                      value={reasons[candidate.id] ?? ''}
                      onChange={(event) => setReasons((previous) => ({ ...previous, [candidate.id]: event.target.value }))}
                      placeholder="拒绝原因（可选）"
                      aria-label="拒绝原因"
                      className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                    />
                    <Button size="sm" variant="outline" disabled={busyId !== null} onClick={() => void review(candidate, 'reject')}>
                      <XCircle className="mr-1.5 h-4 w-4" aria-hidden />
                      拒绝
                    </Button>
                  </div>
                ) : (
                  <p className="border-t pt-3 text-xs text-muted-foreground">
                    审核人：{candidate.reviewedBy || '—'} · 审核时间：{candidate.reviewedAt ? formatTime(candidate.reviewedAt) : '—'}
                    {candidate.siteId ? ' · 关联站点：' + candidate.siteId : ''}
                    {candidate.rejectionReason ? ' · 原因：' + candidate.rejectionReason : ''}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
          {hasMore && (
            <div className="pt-2 text-center">
              <Button variant="outline" disabled={loading} onClick={() => void load(data.offset + data.limit, true)}>
                加载更多
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
