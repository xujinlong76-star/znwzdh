'use client'

/**
 * 管理端：链接巡检（A10）——坏站清单 + 处置闭环。
 *
 * 数据来自中枢巡检本体每天落库的 health_checks 与 sites 健康列
 * （GET /api/hub/admin/link-health），本页只做呈现与处置，不另起检测：
 *  - 总览：巡检覆盖率、已确认失效（broken）数、连续失败中数量、最近巡检时间；
 *  - 清单：每个坏站的连续失败次数、最近检测时间、HTTP 状态与错误类型；
 *  - 处置：把坏站「从前台隐藏」或「恢复展示」——走 sites.enabled 开关，
 *    与快照公开投影同一口径，隐藏后分类/搜索/首页/合集都不可见；
 *    巡检把站点判活（status 回 active）不会自动解除隐藏，必须在这里手动恢复，
 *    避免运营者不知情时坏站又悄悄回前台。
 * 修复类动作（换镜像/平替/归档）在「审计日志」旁的自治自愈页处理，这里不重复造。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Eye, EyeOff, HeartPulse, RefreshCw } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { hubGet, hubSend } from '@/lib/navhub-api'

interface LinkHealthItem {
  siteId: string
  title: string
  url: string
  categoryId: string
  status: string
  enabled: boolean
  consecutiveFailures: number
  lastCheckedAt: number | null
  httpStatus: number | null
  error: string | null
  errorKind: string
}

interface LinkHealthOverview {
  ok: boolean
  summary: {
    totalSites: number
    checkedSites: number
    uncheckedSites: number
    coveragePct: number
    brokenCount: number
    failingCount: number
    failThreshold: number
    lastPatrolAt: number | null
  }
  items: LinkHealthItem[]
}

const ERROR_KIND_LABEL: Record<string, string> = {
  parked_or_soft404: '停靠页/软404',
  http_error: 'HTTP 错误',
  timeout: '超时',
  network: '网络不可达',
  other: '其他错误',
  unknown: '未知',
}

function formatTime(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

export default function LinkHealthPage() {
  const [data, setData] = useState<LinkHealthOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await hubGet<LinkHealthOverview>('/api/hub/admin/link-health')
      setData(res)
      setSelected(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const allSelected = useMemo(
    () => Boolean(data && data.items.length > 0 && data.items.every((i) => selected.has(i.siteId))),
    [data, selected],
  )

  const toggleOne = (siteId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(siteId)) next.delete(siteId)
      else next.add(siteId)
      return next
    })
  }

  const toggleAll = () => {
    if (!data) return
    setSelected(allSelected ? new Set() : new Set(data.items.map((i) => i.siteId)))
  }

  const applyVisibility = async (siteIds: string[], visible: boolean) => {
    if (siteIds.length === 0 || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await hubSend<{ ok: boolean; updated: number }>(
        '/api/hub/admin/link-health/visibility',
        'POST',
        { siteIds, visible },
      )
      setNotice(`已${visible ? '恢复展示' : '从前台隐藏'} ${res.updated} 个站点`)
      await load()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const summary = data?.summary

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <HeartPulse className="h-6 w-6 text-rose-500" aria-hidden />
            链接巡检
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            巡检每天真查外链，连续失败达到阈值（当前 {summary?.failThreshold ?? 3} 次）的站会被标为已失效。
            这里能一眼看到现在哪些站死了，并先把它们从前台拿掉；站点本身和数据不会被删除，修好后可随时恢复展示。
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>站点总数</CardDescription>
              <CardTitle className="text-2xl">{summary.totalSites}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>巡检覆盖</CardDescription>
              <CardTitle className="text-2xl">{summary.coveragePct}%</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              已查 {summary.checkedSites} / 未查 {summary.uncheckedSites}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>已确认失效</CardDescription>
              <CardTitle className="text-2xl text-destructive">{summary.brokenCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>连续失败中</CardDescription>
              <CardTitle className="text-2xl text-orange-500">{summary.failingCount}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">还没到失效阈值，先观察</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>最近巡检</CardDescription>
              <CardTitle className="text-base leading-8">{formatTime(summary.lastPatrolAt)}</CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>坏站清单</CardTitle>
              <CardDescription>
                隐藏走的是站点停用开关：隐藏后前台任何位置（分类、搜索、首页、合集）都不可见；
                巡检日后把站判活也不会自动解除隐藏，必须回到这里手动恢复展示。
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">已选 {selected.size} 个</span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || selected.size === 0}
                onClick={() => void applyVisibility([...selected], false)}
              >
                <EyeOff className="mr-1.5 h-4 w-4" aria-hidden />
                批量隐藏
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || selected.size === 0}
                onClick={() => void applyVisibility([...selected], true)}
              >
                <Eye className="mr-1.5 h-4 w-4" aria-hidden />
                批量恢复
              </Button>
            </div>
          </div>
          {notice && <p className="pt-2 text-sm text-muted-foreground">{notice}</p>}
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
          ) : data && data.items.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              iconTone="success"
              title="当前没有失效或连续失败的站点"
              description="巡检覆盖到的站点最近一次检测都正常。"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="全选"
                        className="h-4 w-4 align-middle"
                      />
                    </th>
                    <th className="py-2 pr-3">站点</th>
                    <th className="py-2 pr-3">状态</th>
                    <th className="py-2 pr-3">连续失败</th>
                    <th className="py-2 pr-3">最近检测</th>
                    <th className="py-2 pr-3">HTTP</th>
                    <th className="py-2 pr-3">错误</th>
                    <th className="py-2 pr-3">前台</th>
                    <th className="py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((item) => (
                    <tr key={item.siteId} className="border-b last:border-0">
                      <td className="py-2.5 pr-3">
                        <input
                          type="checkbox"
                          checked={selected.has(item.siteId)}
                          onChange={() => toggleOne(item.siteId)}
                          aria-label={`选择 ${item.title}`}
                          className="h-4 w-4 align-middle"
                        />
                      </td>
                      <td className="max-w-[260px] py-2.5 pr-3">
                        <div className="truncate font-medium">{item.title}</div>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-xs text-muted-foreground hover:underline"
                        >
                          {item.url}
                        </a>
                      </td>
                      <td className="py-2.5 pr-3">
                        {item.status === 'broken' ? (
                          <Badge variant="destructive">已失效</Badge>
                        ) : (
                          <Badge variant="secondary">连续失败中</Badge>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums">{item.consecutiveFailures} 次</td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-muted-foreground">
                        {formatTime(item.lastCheckedAt)}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums">{item.httpStatus ?? '—'}</td>
                      <td className="max-w-[220px] py-2.5 pr-3">
                        <div className="text-xs">{ERROR_KIND_LABEL[item.errorKind] ?? item.errorKind}</div>
                        {item.error && (
                          <div className="truncate text-xs text-muted-foreground" title={item.error}>
                            {item.error}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        {item.enabled ? (
                          <Badge variant="outline">可见</Badge>
                        ) : (
                          <Badge variant="secondary">已隐藏</Badge>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-2.5">
                        {item.enabled ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void applyVisibility([item.siteId], false)}
                          >
                            <EyeOff className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                            从前台隐藏
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void applyVisibility([item.siteId], true)}
                          >
                            <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                            恢复展示
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
