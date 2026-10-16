'use client'

/**
 * 管理端：任务队列与自动化调度面板。
 *
 * 全面集成：
 * 1. 原生 SSE 实时流式事件推送 (/api/hub/jobs/stream)
 * 2. 7 大任务类型即时触发 (可用性巡检/元数据刷新/热度重排/全文重建/死链自愈/凭据查杀/垃圾箱终极清理)
 * 3. 任务多维状态统计、筛选与可读错误追溯
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  History,
  Play,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { hubGet, hubSend } from '@/lib/navhub-api'

interface Job {
  id: string
  kind: string
  payload?: Record<string, unknown> | null
  status: 'pending' | 'running' | 'done' | 'failed' | 'retrying'
  attempts: number
  error: string | null
  createdAt: number
  updatedAt: number
}

const KIND_CONFIG: Record<
  string,
  { label: string; desc: string; icon: React.ComponentType<{ className?: string }> }
> = {
  health_check: {
    label: '健康巡检',
    desc: '基于 Weibull 寿命衰减模型，优先巡检老旧及高危失效站点',
    icon: Activity,
  },
  refetch_metadata: {
    label: '元数据刷新',
    desc: '重新抓取站点标题、描述与图标，自动更新陈旧信息',
    icon: RefreshCw,
  },
  recompute_rank: {
    label: '热度重算',
    desc: '按近 7 天点击次数 + 收藏次数 − 年龄衰减更新 TrendScore',
    icon: Zap,
  },
  reindex: {
    label: '检索重建',
    desc: '全量重算 FTS5 CJK 二元分词与多音字拼音线索',
    icon: Search,
  },
  site_self_healing: {
    label: '死链自愈',
    desc: '触发故障诊断，分析死链根因并基于图谱匹配健康替代品',
    icon: Sparkles,
  },
  token_audit: {
    label: '凭据巡检',
    desc: '扫描临期、过期与长期未使用的僵尸 API 凭据并落审计',
    icon: ShieldAlert,
  },
  purge_trash: {
    label: '清理回收站',
    desc: '彻底物理抹除软删除超过 30 天的垃圾站点与相关向量',
    icon: Trash2,
  },
}

const STATUS_MAP: Record<
  string,
  { label: string; color: string; badgeVariant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  pending: { label: '等待执行', color: 'text-amber-500', badgeVariant: 'secondary' },
  running: { label: '正在执行', color: 'text-blue-500', badgeVariant: 'default' },
  done: { label: '已完成', color: 'text-emerald-500', badgeVariant: 'outline' },
  retrying: { label: '退避重试', color: 'text-orange-500', badgeVariant: 'secondary' },
  failed: { label: '失败终止', color: 'text-rose-500', badgeVariant: 'destructive' },
}

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [enqueuing, setEnqueuing] = useState<string | null>(null)
  const [sseConnected, setSseConnected] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const load = useCallback(async () => {
    try {
      const data = await hubGet<Job[]>('/api/hub/jobs?limit=100')
      setJobs(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('[jobs] 加载任务失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // 建立 SSE 实时监听通道，并在断开时自动重连与定时轮询兜底
  useEffect(() => {
    load()

    let es: EventSource | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let isSubscribed = true

    const setupSSE = () => {
      try {
        es = new EventSource('/api/hub/jobs/stream')
        es.onopen = () => {
          if (isSubscribed) setSseConnected(true)
        }
        es.addEventListener('job', (event: MessageEvent) => {
          try {
            const update = JSON.parse(event.data) as {
              jobId: string
              kind: string
              status: Job['status']
              attempts?: number
              error?: string | null
              timestamp: number
            }
            setJobs((prev) => {
              const idx = prev.findIndex((j) => j.id === update.jobId)
              if (idx >= 0) {
                const next = [...prev]
                next[idx] = {
                  ...next[idx],
                  status: update.status,
                  attempts: update.attempts ?? next[idx].attempts,
                  error: update.error !== undefined ? update.error : next[idx].error,
                  updatedAt: update.timestamp,
                }
                return next
              }
              // 新出现的任务异步增量刷新
              load()
              return prev
            })
          } catch {
            // 忽略格式解析抖动
          }
        })
        es.onerror = () => {
          if (isSubscribed) {
            setSseConnected(false)
            es?.close()
            reconnectTimeout = setTimeout(setupSSE, 5000)
          }
        }
      } catch {
        if (isSubscribed) setSseConnected(false)
      }
    }

    setupSSE()
    const fallbackPoll = setInterval(load, 20_000)

    return () => {
      isSubscribed = false
      es?.close()
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      clearInterval(fallbackPoll)
    }
  }, [load])

  const enqueue = async (kind: string) => {
    setEnqueuing(kind)
    try {
      await hubSend('/api/hub/jobs', 'POST', { kind })
      await load()
    } catch (err) {
      console.error('[jobs] 入队失败:', err)
    } finally {
      setEnqueuing(null)
    }
  }

  // 状态分类统计
  const stats = useMemo(() => {
    const total = jobs.length
    const running = jobs.filter((j) => j.status === 'running').length
    const pending = jobs.filter((j) => j.status === 'pending').length
    const failed = jobs.filter((j) => j.status === 'failed' || j.status === 'retrying').length
    const done = jobs.filter((j) => j.status === 'done').length
    return { total, running, pending, failed, done }
  }, [jobs])

  const filteredJobs = useMemo(() => {
    if (statusFilter === 'all') return jobs
    if (statusFilter === 'failed') return jobs.filter((j) => j.status === 'failed' || j.status === 'retrying')
    return jobs.filter((j) => j.status === statusFilter)
  }, [jobs, statusFilter])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 顶栏与 SSE 状态 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">任务调度与自动化中心</h1>
            <Badge
              variant="outline"
              className={
                sseConnected
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-300'
              }
            >
              <Radio className={`w-3 h-3 mr-1.5 ${sseConnected ? 'animate-pulse text-emerald-500' : 'text-amber-500'}`} />
              {sseConnected ? 'SSE 实时推流已就绪' : '轮询监测中'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            监控分布式与单实例异步作业，支持 Weibull 可用性探测、死链自愈、热度重排与回收站物理抹除。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* 核心指标统计卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card
          className={`cursor-pointer transition-colors ${statusFilter === 'all' ? 'border-primary ring-1 ring-primary/20' : ''}`}
          onClick={() => setStatusFilter('all')}
        >
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-xs text-muted-foreground font-medium flex items-center justify-between">
              总任务数
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-colors ${statusFilter === 'running' ? 'border-blue-500 ring-1 ring-blue-500/20' : ''}`}
          onClick={() => setStatusFilter('running')}
        >
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-xs text-blue-600 dark:text-blue-400 font-medium flex items-center justify-between">
              执行中
              <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.running}</div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-colors ${statusFilter === 'pending' ? 'border-amber-500 ring-1 ring-amber-500/20' : ''}`}
          onClick={() => setStatusFilter('pending')}
        >
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center justify-between">
              排队等待
              <Clock className="w-3.5 h-3.5 text-amber-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.pending}</div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-colors ${statusFilter === 'done' ? 'border-emerald-500 ring-1 ring-emerald-500/20' : ''}`}
          onClick={() => setStatusFilter('done')}
        >
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center justify-between">
              执行完成
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.done}</div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-colors ${statusFilter === 'failed' ? 'border-rose-500 ring-1 ring-rose-500/20' : ''}`}
          onClick={() => setStatusFilter('failed')}
        >
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-xs text-rose-600 dark:text-rose-400 font-medium flex items-center justify-between">
              失败 / 告警
              <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold text-rose-600 dark:text-rose-400">{stats.failed}</div>
          </CardContent>
        </Card>
      </div>

      {/* 快捷入队操作面板 */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Play className="w-4 h-4 text-primary" />
            即时发起后台任务
          </CardTitle>
          <CardDescription className="text-xs">
            点击入队后由 Runner 在后台以指数退避重试安全消费，不影响前端请求。
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {Object.entries(KIND_CONFIG).map(([kind, cfg]) => {
              const Icon = cfg.icon
              const isEnqueuingThis = enqueuing === kind
              return (
                <Button
                  key={kind}
                  variant="outline"
                  size="sm"
                  className="h-auto py-2 px-2.5 flex flex-col items-start text-left justify-center hover:border-primary/50 transition-all"
                  disabled={Boolean(enqueuing)}
                  onClick={() => void enqueue(kind)}
                >
                  <div className="flex items-center gap-1.5 w-full mb-1">
                    <Icon className={`w-3.5 h-3.5 text-primary ${isEnqueuingThis ? 'animate-spin' : ''}`} />
                    <span className="font-medium text-xs truncate">{cfg.label}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground line-clamp-2 leading-tight">
                    {cfg.desc}
                  </span>
                </Button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* 任务列表明细 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">任务运行日志与状态队列</h2>
          {statusFilter !== 'all' && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setStatusFilter('all')}>
              清除过滤 (当前: {STATUS_MAP[statusFilter]?.label ?? statusFilter})
            </Button>
          )}
        </div>

        {loading ? (
          <div className="rounded-md border p-8 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-primary" />
            正在装载任务队列…
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="rounded-md border p-8 text-center text-muted-foreground text-sm">
            暂无匹配任务记录
          </div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2.5 font-medium">任务类型</th>
                  <th className="text-left px-4 py-2.5 font-medium">状态</th>
                  <th className="text-left px-4 py-2.5 font-medium">尝试次数</th>
                  <th className="text-left px-4 py-2.5 font-medium">详情 / 异常</th>
                  <th className="text-left px-4 py-2.5 font-medium">创建时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredJobs.map((j) => {
                  const cfg = KIND_CONFIG[j.kind]
                  const statusInfo = STATUS_MAP[j.status] ?? {
                    label: j.status,
                    badgeVariant: 'outline' as const,
                    color: 'text-muted-foreground',
                  }
                  const Icon = cfg?.icon ?? Wrench
                  return (
                    <tr key={j.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-medium">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-primary shrink-0" />
                          <span className="truncate">{cfg?.label ?? j.kind}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusInfo.badgeVariant} className="text-xs font-normal">
                          {j.status === 'running' && (
                            <RefreshCw className="w-3 h-3 mr-1 animate-spin text-blue-500" />
                          )}
                          {statusInfo.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {j.attempts > 0 ? (
                          <span className={j.attempts >= 3 ? 'text-rose-500 font-semibold' : ''}>
                            {j.attempts} / 3 次
                          </span>
                        ) : (
                          '0'
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs max-w-[320px]">
                        {j.error ? (
                          <div
                            className="text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 p-1.5 rounded border border-rose-200 dark:border-rose-900 truncate"
                            title={j.error}
                          >
                            {j.error}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(j.createdAt).toLocaleString('zh-CN')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
