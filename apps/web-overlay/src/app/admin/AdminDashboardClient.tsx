'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bug,
  Bot,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  Flame,
  Folders,
  FolderTree,
  Gauge,
  Globe,
  HardDrive,
  History,
  KeyRound,
  Layers,
  Lock,
  Menu,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  Workflow,
  Wrench,
  Zap,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { hubGet, hubSend } from '@/lib/navhub-api'
import { describeDegrade } from '@/lib/degrade'
import { describeTelemetry, type TelemetryState } from '@/lib/telemetry-status'

interface DashboardData {
  overview: {
    totalSites: number
    activeSites: number
    brokenSites: number
    pendingSites: number
    archivedSites: number
    trashedSites: number
    categories: number
    tags: number
    collections: number
    favorites: number
  }
  metrics24h: {
    newSites: number
    healthChecks: number
    healthFailed: number
    healthRate: number | null
    avgLatencyMs: number | null
    jobsTotal: number
    jobsCompleted: number
    jobsFailed: number
    jobsPending: number
    jobsRunning: number
    auditLogs: number
    authFailures: number
    eventsTotal: number
    searches: number
    clicks: number
    zeroResults: number
  }
  storage: {
    dbSizeBytes: number | null
    walSizeBytes: number | null
    tableCounts: Record<string, number>
  }
  runtime: {
    uptimeSeconds: number
    totalRequests: number
    qps: number
    avgLatencyMs: number
    p50LatencyMs: number
    p95LatencyMs: number
    p99LatencyMs: number
    statusCodes: {
      s2xx: number
      s3xx: number
      s4xx: number
      s5xx: number
      errorRate: number
    }
    topSlowRoutes: Array<{ route: string; method: string; avgLatencyMs: number; count: number }>
    topHotRoutes: Array<{ route: string; method: string; count: number }>
    memory: {
      rssMb: number
      heapUsedMb: number
      heapTotalMb: number
    }
  }
  capabilities: {
    semantic: boolean
    fts: boolean
    llm: boolean
    notes: string[]
  }
  categoryDistribution: Array<{
    id: string
    title: string
    icon: string | null
    siteCount: number
    percentage: number
  }>
}

interface LinUCBInfo {
  dimension: number
  alpha: number
  feedbackCount: number
  arms: Record<string, { bNorm: number; bSum: number; weightEstimate: number }>
}

interface SecurityOverviewData {
  totalAuthFailures24h: number
  recentFailures: Array<{ ip: string; path: string; count: number; lastAt: number }>
  recentAudits: Array<{
    id: number
    actor: string
    actorKind: string
    action: string
    target?: string | null
    createdAt: number
  }>
  tokenStats: {
    total: number
    active: number
    expired: number
    revoked: number
  }
}

interface ClientErrorItem {
  kind: string
  fingerprint: string
  path: string | null
  digest: string | null
  count: number
  firstSeen: number
  lastSeen: number
}

interface ClientErrorsData {
  total: number
  byKind: Record<string, number>
  recent: ClientErrorItem[]
  retention: string
}

interface SearchAiOverviewData {
  days: number
  linucb: LinUCBInfo
  topQueries: Array<{ query: string; count: number }>
  zeroResultQueries: Array<{ query: string; count: number }>
  hotSites: Array<{ id: string; url: string; title: string; visitCount: number; trendScore: number }>
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined || bytes === 0) return '未知'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i]
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${h}h ${m}m`
}

function formatRelativeTime(ts: number): string {
  const diffSec = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (diffSec < 60) return `${diffSec}秒前`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟前`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时前`
  return `${Math.floor(diffSec / 86400)}天前`
}

const CHANNEL_LABELS: Record<string, string> = {
  exact: '精准匹配 (exact)',
  fts: '全文分词 (fts)',
  pinyin: '拼音双向 (pinyin)',
  semantic: '向量语义 (semantic)',
  personal: '个性化偏置 (personal)',
}

/** 遥测徽标配色：只有真的在更新才是绿色，解析失败/离线一律不是 */
const TELEMETRY_BADGE: Record<TelemetryState, string> = {
  live: 'border-emerald-500/40 text-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20',
  connecting: 'border-amber-500/40 text-amber-600 bg-amber-50/50 dark:bg-amber-950/20',
  stale: 'border-amber-500/40 text-amber-600 bg-amber-50/50 dark:bg-amber-950/20',
  offline: 'border-red-500/40 text-red-600 bg-red-50/50 dark:bg-red-950/20',
}

const TELEMETRY_DOT: Record<TelemetryState, string> = {
  live: 'bg-emerald-500 animate-pulse',
  connecting: 'bg-amber-500 animate-ping',
  stale: 'bg-amber-500',
  offline: 'bg-red-500',
}

export function AdminDashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [linucb, setLinucb] = useState<LinUCBInfo | null>(null)
  const [searchAi, setSearchAi] = useState<SearchAiOverviewData | null>(null)
  const [security, setSecurity] = useState<SecurityOverviewData | null>(null)
  const [clientErrors, setClientErrors] = useState<ClientErrorsData | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [sseStatus, setSseStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  // 最近有多少条实时消息解析失败。连接是通的、但数值冻住时，必须能说出来。
  const [sseParseFailures, setSseParseFailures] = useState(0)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const sseRef = useRef<EventSource | null>(null)

  const fetchFullDashboard = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setIsRefreshing(true)
      const [overviewData, searchAiData, securityData, clientErrorData] = await Promise.all([
        hubGet<DashboardData>('/api/admin/dashboard/overview'),
        hubGet<SearchAiOverviewData>('/api/admin/dashboard/search-ai?days=7'),
        hubGet<SecurityOverviewData>('/api/admin/dashboard/security?hours=24'),
        // 前端错误聚合：单点失败只让这张卡片缺席，不拖垮整块面板
        hubGet<ClientErrorsData>('/api/admin/client-errors').catch(() => {
          /* 旧版中枢没有这个端点 / 瞬间故障：这张卡片显示「暂无」，其余面板照常 */
          return null
        }),
      ])
      if (overviewData) setData(overviewData)
      if (searchAiData) {
        setSearchAi(searchAiData)
        if (searchAiData.linucb) setLinucb(searchAiData.linucb)
      }
      if (securityData) setSecurity(securityData)
      setClientErrors(clientErrorData)
      setLoadError(null)
    } catch (err) {
      // 以前只 console.error：首屏拉取失败时页面会永远停在「正在加载…」，
      // 用户既不知道出了什么事，也没有重试入口。
      console.error('Failed to fetch dashboard data:', err)
      setLoadError(err)
    } finally {
      if (showLoading) setIsRefreshing(false)
    }
  }, [])

  // 连接 SSE 实时遥测管道
  useEffect(() => {
    fetchFullDashboard()

    const sse = new EventSource('/api/hub/admin/dashboard/stream')
    sseRef.current = sse

    sse.onopen = () => {
      setSseStatus('connected')
    }

    sse.addEventListener('init', (e) => {
      try {
        const payload = JSON.parse(e.data)
        if (payload.runtime) {
          setData((prev) => (prev ? { ...prev, runtime: payload.runtime } : prev))
        }
        if (payload.linucb) {
          setLinucb(payload.linucb)
        }
        setSseParseFailures(0)
      } catch {
        // 解析不了就只能继续用旧数值 —— 但要如实计数，不能装作还在实时刷新
        setSseParseFailures((n) => n + 1)
      }
    })

    sse.addEventListener('tick', (e) => {
      try {
        const payload = JSON.parse(e.data)
        if (payload.linucb) {
          setLinucb(payload.linucb)
        }
        setData((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            runtime: payload.runtime,
            overview: {
              ...prev.overview,
              totalSites: payload.stats?.sites ?? prev.overview.totalSites,
              brokenSites: payload.stats?.broken ?? prev.overview.brokenSites,
              pendingSites: payload.stats?.pending ?? prev.overview.pendingSites,
              trashedSites: payload.stats?.trashed ?? prev.overview.trashedSites,
            },
            metrics24h: {
              ...prev.metrics24h,
              jobsPending: payload.queue?.pending ?? prev.metrics24h.jobsPending,
              jobsRunning: payload.queue?.running ?? prev.metrics24h.jobsRunning,
            },
          }
        })
        setSseParseFailures(0)
      } catch {
        // 同上：一次解析失败不代表流断了，但数值会停在旧值，必须让徽标说出来
        setSseParseFailures((n) => n + 1)
      }
    })

    sse.onerror = () => {
      setSseStatus('disconnected')
    }

    return () => {
      sse.close()
    }
  }, [fetchFullDashboard])

  // 快捷触发任务
  const triggerQuickJob = async (kind: string, label: string) => {
    try {
      setActionNotice(`正在触发任务: ${label}...`)
      await hubSend('/api/jobs', 'POST', { kind, payload: {} })
      setActionNotice(`已成功派发任务 [${label}] 至后台队列！`)
      setTimeout(() => {
        setActionNotice(null)
        fetchFullDashboard()
      }, 3000)
    } catch (err) {
      setActionNotice(`派发失败: ${String(err)}`)
      setTimeout(() => setActionNotice(null), 4000)
    }
  }

  const [maintenanceMsg, setMaintenanceMsg] = useState<string | null>(null)
  const [isMaintaining, setIsMaintaining] = useState(false)

  const runMaintenance = async (action: 'status' | 'checkpoint' | 'optimize' | 'vacuum') => {
    setIsMaintaining(true)
    setMaintenanceMsg(null)
    try {
      if (action === 'status') {
        const res = await hubGet<{ ok: boolean; integrity: string; freePages?: number }>('/api/admin/maintenance/status')
        setMaintenanceMsg(`数据库自检: ${res.ok ? '✅ 健康 (Integrity: ' + res.integrity + ')' : '❌ 异常'}${res.freePages !== undefined ? ` · 空闲页: ${res.freePages}` : ''}`)
      } else if (action === 'checkpoint') {
        const res = await hubSend<{ ok: boolean; tookMs: number; logSize?: number }>('/api/admin/maintenance/checkpoint', 'POST', { mode: 'passive' })
        setMaintenanceMsg(`WAL 刷盘完成: 耗时 ${res.tookMs}ms${res.logSize !== undefined ? ` · 写入帧: ${res.logSize}` : ''}`)
      } else if (action === 'optimize') {
        const res = await hubSend<{ ok: boolean; tookMs: number }>('/api/admin/maintenance/optimize', 'POST')
        setMaintenanceMsg(`FTS5 检索索引优化完毕: 耗时 ${res.tookMs}ms`)
      } else if (action === 'vacuum') {
        const res = await hubSend<{ ok: boolean; tookMs: number; message: string }>('/api/admin/maintenance/vacuum', 'POST')
        setMaintenanceMsg(`碎片回收: ${res.message} (${res.tookMs}ms)`)
        await fetchFullDashboard(true)
      }
    } catch (err) {
      setMaintenanceMsg(`维护执行失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsMaintaining(false)
    }
  }

  const overview = data?.overview
  const metrics24h = data?.metrics24h
  const runtime = data?.runtime
  const storage = data?.storage

  const navigationItems = [
    {
      title: '导航架构管理',
      icon: Menu,
      href: '/admin/navigation',
      description: '管理全站层级分类、二级子类与菜单排布',
      badge: `${overview?.categories ?? 0} 个类目`,
    },
    {
      title: '站点列表与录入',
      icon: Globe,
      href: '/admin/sitelist',
      description: '检索、录入、批量编辑与状态变更',
      badge: `${overview?.totalSites ?? 0} 个站点`,
    },
    {
      title: '自动化任务调度',
      icon: Workflow,
      href: '/admin/jobs',
      description: '实时流监控、巡检派发与死链自愈',
      badge: `${metrics24h?.jobsPending ?? 0} 待处理`,
    },
    {
      title: '运营数据看板',
      icon: Activity,
      href: '/admin/stats',
      description: '多维趋势折线图、搜索热词与零结果补录',
      badge: '深度洞察',
    },
    {
      title: '凭据与访问权限',
      icon: ShieldCheck,
      href: '/admin/tokens',
      description: 'API Token 轮换、Scope 细粒度授权与审计',
      badge: '密钥管控',
    },
    {
      title: '安全审计日志',
      icon: Lock,
      href: '/admin/audit',
      description: '追溯管理员行为与拦截未经授权攻击请求',
      badge: `${metrics24h?.auditLogs ?? 0} 条近24h`,
    },
    {
      title: '站点全局设置',
      icon: Settings,
      href: '/admin/site',
      description: '全站 SEO、元数据配置、Logo 与品牌规范',
      badge: '基础配置',
    },
    {
      title: '回收站保护区',
      icon: Trash2,
      href: '/admin/trash',
      description: '软删除站点归档、快速还原与终极物理擦除',
      badge: `${overview?.trashedSites ?? 0} 个可恢复`,
    },
  ]

  const telemetry = describeTelemetry(sseStatus, sseParseFailures)
  const degradeNotice = loadError ? describeDegrade(loadError) : null

  return (
    <div className="space-y-6">
      {/* 顶部状态条与快捷控制 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">运营与监控中枢</h1>
            <Badge
              variant="outline"
              title={telemetry.detail}
              className={`flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium ${TELEMETRY_BADGE[telemetry.state]}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${TELEMETRY_DOT[telemetry.state]}`} />
              {telemetry.label}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            NavHub 后端运行态势 · 实时吞吐、站点健康与自愈监控
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {actionNotice && (
            <span className="text-xs px-2.5 py-1 bg-primary/10 text-primary rounded-md animate-fade-in">
              {actionNotice}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerQuickJob('health_check', '健康巡检')}
          >
            <Activity className="h-3.5 w-3.5 mr-1.5 text-blue-500" />
            全站巡检
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerQuickJob('recompute_rank', '热度重排')}
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5 text-amber-500" />
            重排热度
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchFullDashboard(true)}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* 拉取失败必须说出来：以前这里只 console.error，首屏失败就永远停在「正在加载…」 */}
      {degradeNotice && (
        <div
          role="status"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          <span>
            {data
              ? `本次刷新失败，下面是上一次成功获取的数据。${degradeNotice.message}`
              : `没能取回监控数据。${degradeNotice.message}`}
          </span>
          {degradeNotice.retryable && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 text-xs"
              onClick={() => fetchFullDashboard(true)}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              重试
            </Button>
          )}
        </div>
      )}

      {/* 运行时轻量系统态势小卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="rounded-lg border bg-card p-3 shadow-sm">
          <div className="text-xs text-muted-foreground">运行时长</div>
          <div className="text-base font-semibold mt-0.5">
            {runtime ? formatUptime(runtime.uptimeSeconds) : '--'}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3 shadow-sm">
          <div className="text-xs text-muted-foreground">当前 QPS</div>
          <div className="text-base font-semibold mt-0.5 text-emerald-600">
            {runtime ? runtime.qps : 0} <span className="text-xs font-normal">req/s</span>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3 shadow-sm">
          <div className="text-xs text-muted-foreground">P95 响应耗时</div>
          <div className="text-base font-semibold mt-0.5">
            {runtime ? runtime.p95LatencyMs : 0} <span className="text-xs font-normal">ms</span>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3 shadow-sm">
          <div className="text-xs text-muted-foreground">进程常驻内存</div>
          <div className="text-base font-semibold mt-0.5">
            {runtime ? runtime.memory.rssMb : 0} <span className="text-xs font-normal">MB</span>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3 shadow-sm">
          <div className="text-xs text-muted-foreground">全文搜索引擎</div>
          <div className="text-base font-semibold mt-0.5 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            FTS5 (CJK)
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3 shadow-sm">
          <div className="text-xs text-muted-foreground">向量检索通道</div>
          <div className="text-base font-semibold mt-0.5 flex items-center gap-1">
            <span
              className={`w-2 h-2 rounded-full ${
                data?.capabilities?.semantic ? 'bg-emerald-500' : 'bg-muted-foreground'
              }`}
            />
            {data?.capabilities?.semantic ? 'sqlite-vec' : '降级'}
          </div>
        </div>
      </div>

      {/* 6 大核心 KPI 态势卡片 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* 站点资产总数 */}
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">站点资产规模</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overview?.totalSites ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
              <span className="text-emerald-600 font-medium">
                {overview?.activeSites ?? 0} 正常
              </span>
              <span>·</span>
              <span className="text-amber-600 font-medium">
                {overview?.brokenSites ?? 0} 异常
              </span>
              <span>·</span>
              <span>{overview?.pendingSites ?? 0} 待审</span>
              <span>·</span>
              <span>{overview?.trashedSites ?? 0} 回收站</span>
            </div>
          </CardContent>
        </Card>

        {/* 24h 健康可用率 */}
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">24h 站点健康度</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics24h?.healthRate !== null && metrics24h?.healthRate !== undefined
                ? `${metrics24h.healthRate}%`
                : '100%'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              近24h 巡检 {metrics24h?.healthChecks ?? 0} 次 · 失败{' '}
              {metrics24h?.healthFailed ?? 0} 次 · 均值耗时{' '}
              {metrics24h?.avgLatencyMs ?? 0} ms
            </div>
          </CardContent>
        </Card>

        {/* API 吞吐与 QPS */}
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">API 性能吞吐</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {runtime?.totalRequests ?? 0}{' '}
              <span className="text-sm font-normal text-muted-foreground">总请求</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
              <span className="text-emerald-600 font-medium">
                2xx 成功: {runtime?.statusCodes?.s2xx ?? 0}
              </span>
              <span>·</span>
              <span className="text-red-500 font-medium">
                错误率: {runtime?.statusCodes?.errorRate ?? 0}%
              </span>
            </div>
          </CardContent>
        </Card>

        {/* 任务调度队列 */}
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">自愈与后台任务</CardTitle>
            <Workflow className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics24h?.jobsCompleted ?? 0}{' '}
              <span className="text-sm font-normal text-muted-foreground">24h 完成</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
              <span className="text-blue-500 font-medium">
                {metrics24h?.jobsPending ?? 0} 待认领
              </span>
              <span>·</span>
              <span className="text-amber-500 font-medium">
                {metrics24h?.jobsRunning ?? 0} 运行中
              </span>
              <span>·</span>
              <span className="text-red-500 font-medium">
                {metrics24h?.jobsFailed ?? 0} 失败
              </span>
            </div>
          </CardContent>
        </Card>

        {/* 安全审计态势 */}
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">安全防护与审计</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics24h?.auditLogs ?? 0}{' '}
              <span className="text-sm font-normal text-muted-foreground">近24h 日志</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
              <span className="text-emerald-600 font-medium">
                Token: {security?.tokenStats.active ?? 0}/{security?.tokenStats.total ?? 0} 有效
              </span>
              <span>·</span>
              <span className="text-amber-600 font-medium">
                拦截: {security?.totalAuthFailures24h ?? metrics24h?.authFailures ?? 0} 次
              </span>
            </div>
          </CardContent>
        </Card>

        {/* LinUCB 强化学习引擎 */}
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">检索强化学习 (LinUCB)</CardTitle>
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              {linucb?.feedbackCount ?? 0}{' '}
              <span className="text-sm font-normal text-muted-foreground">反馈样本</span>
              {sseStatus === 'connected' && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  动态调优
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              5 通道自适应置信度动态重排 · 探索系数 α={linucb?.alpha ?? 0.15}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 深入分析区块：HTTP 状态分布 + LinUCB 权重 + 分类统计 + 数据库容量 */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* HTTP 状态码分布与接口性能 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              HTTP 状态码分布与性能瓶颈
            </CardTitle>
            <CardDescription>
              基于有界基数模板统计 · 延迟中位数 P50: {runtime?.p50LatencyMs ?? 0}ms · P99:{' '}
              {runtime?.p99LatencyMs ?? 0}ms
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 状态码进度条 */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>2xx 成功 ({runtime?.statusCodes.s2xx ?? 0})</span>
                <span>3xx 重定向 ({runtime?.statusCodes.s3xx ?? 0})</span>
                <span>4xx 客户端 ({runtime?.statusCodes.s4xx ?? 0})</span>
                <span>5xx 服务端 ({runtime?.statusCodes.s5xx ?? 0})</span>
              </div>
              <div className="w-full h-2.5 bg-muted rounded-full flex overflow-hidden">
                {runtime && runtime.totalRequests > 0 ? (
                  <>
                    <div
                      style={{
                        width: `${(runtime.statusCodes.s2xx / runtime.totalRequests) * 100}%`,
                      }}
                      className="bg-emerald-500"
                    />
                    <div
                      style={{
                        width: `${(runtime.statusCodes.s3xx / runtime.totalRequests) * 100}%`,
                      }}
                      className="bg-blue-500"
                    />
                    <div
                      style={{
                        width: `${(runtime.statusCodes.s4xx / runtime.totalRequests) * 100}%`,
                      }}
                      className="bg-amber-500"
                    />
                    <div
                      style={{
                        width: `${(runtime.statusCodes.s5xx / runtime.totalRequests) * 100}%`,
                      }}
                      className="bg-red-500"
                    />
                  </>
                ) : (
                  <div className="w-full bg-emerald-500" />
                )}
              </div>
            </div>

            {/* 耗时最高路由 Top 5 */}
            <div className="border rounded-md divide-y text-xs">
              <div className="px-3 py-1.5 bg-muted/40 font-medium text-muted-foreground flex justify-between">
                <span>耗时最高路由 (Top 5)</span>
                <span>平均响应 / 请求量</span>
              </div>
              {runtime?.topSlowRoutes && runtime.topSlowRoutes.length > 0 ? (
                runtime.topSlowRoutes.map((r) => (
                  <div key={r.route} className="px-3 py-2 flex justify-between items-center">
                    <span className="font-mono text-xs truncate max-w-[280px]">
                      <span className="text-muted-foreground mr-1.5">{r.method}</span>
                      {r.route}
                    </span>
                    <span className="font-semibold text-amber-600">
                      {r.avgLatencyMs} ms{' '}
                      <span className="text-muted-foreground font-normal">({r.count} 次)</span>
                    </span>
                  </div>
                ))
              ) : (
                <div className="px-3 py-2 text-muted-foreground">暂无足够请求采样</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* LinUCB 检索通道自适应权重 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              LinUCB 多通道自适应权重
            </CardTitle>
            <CardDescription>
              打破传统静态常数，根据查询 CJK/拼音/长度情境自适应调节
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {linucb?.arms ? (
              Object.entries(linucb.arms).map(([ch, info]) => {
                const label = CHANNEL_LABELS[ch] || ch
                const pct = Math.min(100, Math.max(10, (info.weightEstimate / 2.0) * 100))
                return (
                  <div key={ch} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium">{label}</span>
                      <span className="text-muted-foreground">
                        权重估值: <span className="font-semibold">{info.weightEstimate}</span> ·
                        L2模: {info.bNorm}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="text-sm text-muted-foreground">正在加载模型状态...</p>
            )}
          </CardContent>
        </Card>

        {/* 分类资源分布 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Folders className="h-4 w-4 text-primary" />
              顶级分类收录分布
            </CardTitle>
            <CardDescription>各主分类下站点占比（前 8 大主要分类）</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {data?.categoryDistribution && data.categoryDistribution.length > 0 ? (
              data.categoryDistribution.map((cat) => (
                <div key={cat.id} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium truncate max-w-[200px]">{cat.title}</span>
                    <span className="text-muted-foreground">
                      {cat.siteCount} 站 · {cat.percentage}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${Math.max(5, cat.percentage)}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">暂无分类统计数据</p>
            )}
          </CardContent>
        </Card>

        {/* 数据库存储容量与核心表记录数 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-primary" />
              存储引擎与数据表容量
            </CardTitle>
            <CardDescription>
              物理数据库容量: {formatBytes(storage?.dbSizeBytes ?? null)} · WAL 写入缓冲就绪
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {storage?.tableCounts &&
                Object.entries(storage.tableCounts).map(([table, count]) => (
                  <div key={table} className="border rounded p-2 text-center bg-muted/20">
                    <div className="text-[11px] font-mono text-muted-foreground truncate">
                      {table}
                    </div>
                    <div className="text-sm font-semibold mt-0.5">{count}</div>
                  </div>
                ))}
            </div>

            {/* 在线自检与数据库维护动作 */}
            <div className="mt-4 pt-3 border-t space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                <span className="flex items-center gap-1">
                  <Wrench className="w-3.5 h-3.5 text-primary" />
                  在线存储引擎自检与维护
                </span>
                {isMaintaining && <span className="text-primary animate-pulse">执行中…</span>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2"
                  disabled={isMaintaining}
                  onClick={() => runMaintenance('status')}
                >
                  完整性自检
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2"
                  disabled={isMaintaining}
                  onClick={() => runMaintenance('checkpoint')}
                >
                  WAL 刷盘
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2"
                  disabled={isMaintaining}
                  onClick={() => runMaintenance('optimize')}
                >
                  FTS5 段合并
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2"
                  disabled={isMaintaining}
                  onClick={() => runMaintenance('vacuum')}
                >
                  碎片回收
                </Button>
              </div>
              {maintenanceMsg && (
                <div className="text-[11px] bg-muted/60 text-foreground p-2 rounded border border-border/80">
                  {maintenanceMsg}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 搜索情报与安全审计动态 */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* 搜索情报与零结果雷达 */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="text-base flex items-center gap-2">
                  <Search className="h-4 w-4 text-primary" />
                  高频搜索与零结果雷达
                </CardTitle>
                <CardDescription>
                  近 7 天用户搜索需求与未收录关键词补录线索
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
                <Link href="/admin/stats">
                  完整大盘 <ArrowRight className="w-3 h-3 ml-1" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 热门搜索 Top 5 */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-orange-500" />
                高频热搜 Top 5
              </div>
              {searchAi?.topQueries && searchAi.topQueries.length > 0 ? (
                <div className="space-y-1.5">
                  {searchAi.topQueries.slice(0, 5).map((q, idx) => (
                    <div
                      key={q.query}
                      className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-md bg-muted/30 hover:bg-muted/60 transition-colors"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span className="font-mono text-muted-foreground w-4 text-right">
                          {idx + 1}
                        </span>
                        <span className="font-medium truncate">{q.query}</span>
                      </span>
                      <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                        {q.count} 次检索
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground py-2 text-center">暂无搜索统计数据</div>
              )}
            </div>

            {/* 零结果补录线索 */}
            <div className="pt-2 border-t">
              <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <Sparkles className="w-3.5 h-3.5" />
                  零结果补录线索 (用户搜但库内缺失)
                </span>
                {searchAi?.zeroResultQueries && searchAi.zeroResultQueries.length > 0 && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600">
                    {searchAi.zeroResultQueries.length} 条线索
                  </Badge>
                )}
              </div>
              {searchAi?.zeroResultQueries && searchAi.zeroResultQueries.length > 0 ? (
                <div className="space-y-1.5">
                  {searchAi.zeroResultQueries.slice(0, 4).map((q) => (
                    <div
                      key={q.query}
                      className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-md border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
                    >
                      <span className="font-medium text-foreground truncate max-w-[180px]">
                        {q.query}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">{q.count} 次未命中</span>
                        <Button asChild variant="outline" size="sm" className="h-6 text-[10px] px-2 text-primary">
                          <Link href={`/admin/sitelist?action=new&title=${encodeURIComponent(q.query)}`}>
                            <Plus className="w-2.5 h-2.5 mr-1" />
                            录入新站
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground py-2 text-center">
                  暂无零结果关键词，内容覆盖良好
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 安全防护与审计时间线 */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  安全防线与最新审计流
                </CardTitle>
                <CardDescription>
                  Token 签发管控与管理员操作可追溯流水
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
                <Link href="/admin/audit">
                  全部审计 <ArrowRight className="w-3 h-3 ml-1" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Token 状态概况 */}
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="p-2 rounded bg-muted/40 border">
                <div className="text-muted-foreground">有效 Token</div>
                <div className="text-base font-semibold mt-0.5 text-emerald-600">
                  {security?.tokenStats.active ?? 0}
                </div>
              </div>
              <div className="p-2 rounded bg-muted/40 border">
                <div className="text-muted-foreground">已过期 / 吊销</div>
                <div className="text-base font-semibold mt-0.5 text-muted-foreground">
                  {(security?.tokenStats.expired ?? 0) + (security?.tokenStats.revoked ?? 0)}
                </div>
              </div>
              <div className="p-2 rounded bg-muted/40 border">
                <div className="text-muted-foreground">24h 拦截未授权</div>
                <div className="text-base font-semibold mt-0.5 text-amber-600">
                  {security?.totalAuthFailures24h ?? 0}
                </div>
              </div>
            </div>

            {/* 最新审计动作流 */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-blue-500" />
                最新管理员行为时间线 (Top 5)
              </div>
              {security?.recentAudits && security.recentAudits.length > 0 ? (
                <div className="space-y-2">
                  {security.recentAudits.slice(0, 5).map((log) => {
                    const isToken = log.action.startsWith('token.')
                    const isJob = log.action.startsWith('job.')
                    const isDb = log.action.startsWith('db.')
                    const badgeClass = isToken
                      ? 'border-purple-500/40 text-purple-600 bg-purple-50/50 dark:bg-purple-950/20'
                      : isJob
                      ? 'border-blue-500/40 text-blue-600 bg-blue-50/50 dark:bg-blue-950/20'
                      : isDb
                      ? 'border-amber-500/40 text-amber-600 bg-amber-50/50 dark:bg-amber-950/20'
                      : 'border-emerald-500/40 text-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20'

                    return (
                      <div
                        key={log.id}
                        className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-md border bg-card/60"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <Badge variant="outline" className={`text-[10px] h-5 px-1.5 font-mono ${badgeClass}`}>
                            {log.action}
                          </Badge>
                          <span className="text-muted-foreground truncate max-w-[150px]">
                            {log.actor} ({log.actorKind})
                          </span>
                        </div>
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1 shrink-0">
                          <Clock className="w-3 h-3" />
                          {formatRelativeTime(log.createdAt)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground py-2 text-center">暂无审计日志记录</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 前端错误闭环（P2-5）：崩溃不再只活在用户的标签页里 */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Bug className="h-4 w-4 text-destructive" />
                前端错误监控
                {clientErrors && clientErrors.total > 0 && (
                  <Badge variant="destructive" className="text-[10px] h-5 px-1.5">
                    {clientErrors.total} 次
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                错误边界捕获的崩溃（按指纹去重计数）。只收分类 / 指纹 / 路径，不含错误原文与用户内容；
                需前端启用 NEXT_PUBLIC_ERROR_REPORT=1 才会上报。聚合视图为进程内存，events 表有全量明细。
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {clientErrors && clientErrors.total > 0 ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(clientErrors.byKind)
                  .filter(([, n]) => n > 0)
                  .map(([kind, n]) => (
                    <Badge key={kind} variant="outline" className="text-[10px] h-5 px-1.5 font-mono">
                      {kind}: {n}
                    </Badge>
                  ))}
              </div>
              <div className="space-y-1.5">
                {clientErrors.recent.slice(0, 6).map((e) => (
                  <div
                    key={`${e.kind}|${e.fingerprint}|${e.path ?? '-'}`}
                    className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-md bg-muted/30"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-mono">
                        {e.kind}
                      </Badge>
                      <span className="font-mono text-muted-foreground truncate">{e.path ?? '/'}</span>
                      <span className="font-mono text-[10px] text-muted-foreground/70 truncate">{e.fingerprint}</span>
                    </span>
                    <span className="text-muted-foreground shrink-0 ml-2">
                      ×{e.count} · {new Date(e.lastSeen).toLocaleTimeString('zh-CN', { hour12: false })}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground py-2 text-center">
              暂无前端错误上报（进程启动以来）
            </div>
          )}
        </CardContent>
      </Card>

      {/* 快捷运维与管理中枢导航 */}
      <div>
        <h2 className="text-lg font-bold mb-3 tracking-tight">快捷管理导航</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {navigationItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <Card className="hover:shadow-md hover:border-primary/50 transition-all cursor-pointer h-full">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <div className="flex items-center space-x-2.5">
                    <item.icon className="w-5 h-5 text-primary" />
                    <CardTitle className="text-sm font-semibold">{item.title}</CardTitle>
                  </div>
                  <Badge variant="secondary" className="text-[11px]">
                    {item.badge}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
