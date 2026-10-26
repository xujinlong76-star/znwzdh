'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bug,
  Bot,
  CheckCircle2,
  Clock,
  Database,
  Download,
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
import { DashboardSparkline } from '@/components/admin/dashboard/dashboard-sparkline'
import { DashboardTrafficChart } from '@/components/admin/dashboard/dashboard-traffic-chart'
import { DashboardStatusDonut } from '@/components/admin/dashboard/dashboard-status-donut'
import { DashboardSlowRoutes } from '@/components/admin/dashboard/dashboard-slow-routes'
import { DashboardRefreshControl } from '@/components/admin/dashboard/dashboard-refresh-control'

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

const CHANNEL_STYLES: Record<string, { label: string; barClass: string; badgeClass: string }> = {
  exact: {
    label: '精准匹配 (exact)',
    barClass: 'bg-gradient-to-r from-blue-500 to-indigo-500',
    badgeClass: 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/30',
  },
  fts: {
    label: '全文分词 (fts)',
    barClass: 'bg-gradient-to-r from-emerald-500 to-teal-500',
    badgeClass: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  },
  pinyin: {
    label: '拼音双向 (pinyin)',
    barClass: 'bg-gradient-to-r from-violet-500 to-purple-500',
    badgeClass: 'text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/30',
  },
  semantic: {
    label: '向量语义 (semantic)',
    barClass: 'bg-gradient-to-r from-amber-500 to-orange-500',
    badgeClass: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30',
  },
  personal: {
    label: '个性化偏置 (personal)',
    barClass: 'bg-gradient-to-r from-rose-500 to-pink-500',
    badgeClass: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/30',
  },
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
  const [clientErrors, setClientErrors] = useState<(ClientErrorsData & { loadFailed?: boolean }) | null>(null)
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
          // 旧版中枢没有这个端点 / 瞬间故障：标记 loadFailed，卡片说「没取回」而不是「暂无」
          return { total: 0, byKind: {}, recent: [], retention: '', loadFailed: true }
        }),
      ])
      if (overviewData) setData(overviewData)
      if (searchAiData) {
        setSearchAi(searchAiData)
        if (searchAiData.linucb) setLinucb(searchAiData.linucb)
      }
      if (securityData) setSecurity(securityData)
      setClientErrors(clientErrorData ?? { total: 0, byKind: {}, recent: [], retention: '', loadFailed: true })
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

  // 导出运维巡检快照 (JSON 运维快照包)
  const exportOpsReport = () => {
    if (!data) return
    const report = {
      exportedAt: new Date().toISOString(),
      system: 'NavHub Observability Snapshot',
      overview: data.overview,
      metrics24h: data.metrics24h,
      traffic: trafficStats,
      capabilities,
      slowRoutes,
      telemetry: {
        sseStatus,
        sseParseFailures,
      },
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `navhub-ops-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setActionNotice('已成功导出运维巡检快照 JSON')
    setTimeout(() => setActionNotice(null), 3000)
  }

  const overview = data?.overview
  const metrics24h = data?.metrics24h
  const runtime = data?.runtime
  const storage = data?.storage

  /**
   * 首屏占位：overview/metrics24h 尚未取回时，徽章与 KPI 大数字若默认渲染 0，
   * 会与「库里其实有 1008 站点 / 234 类目」相矛盾，误导运营判断（P2）。
   * 这里把「加载中」与「真为 0」区分开：未取回一律显示省略号占位，取回后再落真实值；
   * 取回失败（loadError 且无 data）时由下方 degradeNotice 负责说明，占位保持中性。
   */
  const loading = data === null
  const badgeNum = (v: number | undefined, unit: string) =>
    loading ? `…${unit}` : `${v ?? 0} ${unit}`
  const bigNum = (v: number | undefined) => (loading ? '…' : `${v ?? 0}`)

  const navigationItems = [
    {
      title: '导航架构管理',
      icon: Menu,
      href: '/admin/navigation',
      description: '管理全站层级分类、二级子类与菜单排布',
      badge: badgeNum(overview?.categories, ' 个类目'),
      iconBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    },
    {
      title: '站点列表与录入',
      icon: Globe,
      href: '/admin/sitelist',
      description: '检索、录入、批量编辑与状态变更',
      badge: badgeNum(overview?.totalSites, ' 个站点'),
      iconBg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    },
    {
      title: '自动化任务调度',
      icon: Workflow,
      href: '/admin/jobs',
      description: '实时流监控、巡检派发与死链自愈',
      badge: badgeNum(metrics24h?.jobsPending, ' 待处理'),
      iconBg: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
    },
    {
      title: '运营数据看板',
      icon: Activity,
      href: '/admin/stats',
      description: '多维趋势折线图、搜索热词与零结果补录',
      badge: '深度洞察',
      iconBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    },
    {
      title: '凭据与访问权限',
      icon: ShieldCheck,
      href: '/admin/tokens',
      description: 'API Token 轮换、Scope 细粒度授权与审计',
      badge: '密钥管控',
      iconBg: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
    },
    {
      title: '安全审计日志',
      icon: Lock,
      href: '/admin/audit',
      description: '追溯管理员行为与拦截未经授权攻击请求',
      badge: badgeNum(metrics24h?.auditLogs, ' 条近24h'),
      iconBg: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    },
    {
      title: '站点全局设置',
      icon: Settings,
      href: '/admin/site',
      description: '全站 SEO、元数据配置、Logo 与品牌规范',
      badge: '基础配置',
      iconBg: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
    },
    {
      title: '回收站保护区',
      icon: Trash2,
      href: '/admin/trash',
      description: '软删除站点归档、快速还原与终极物理擦除',
      badge: badgeNum(overview?.trashedSites, ' 个可恢复'),
      iconBg: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
    },
    {
      title: '网址体检',
      icon: Bug,
      href: '/admin/plugin-health',
      description: '巡检插件与站点 URL 健康度，识别停放、劫持与拒绝爬虫',
      badge: '健康巡检',
      iconBg: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
    },
  ]

  const telemetry = describeTelemetry(sseStatus, sseParseFailures)
  const degradeNotice = loadError ? describeDegrade(loadError) : null

  return (
    <div className="space-y-6">
      {/* 顶部状态条与快捷控制 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border/70">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-xs">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">运营与监控中枢</h1>
                <Badge
                  variant="outline"
                  title={telemetry.detail}
                  className={`flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full shadow-xs ${TELEMETRY_BADGE[telemetry.state]}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${TELEMETRY_DOT[telemetry.state]}`} />
                  {telemetry.label}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                NavHub 全链路运行态势 · 实时吞吐、站点健康与自动化自愈网格
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {actionNotice && (
            <span className="text-xs px-2.5 py-1 bg-primary/10 text-primary border border-primary/20 rounded-lg animate-fade-in font-medium flex items-center gap-1.5 shadow-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
              {actionNotice}
            </span>
          )}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-muted/40 border border-border/60 shadow-xs">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => triggerQuickJob('health_check', '健康巡检')}
              className="h-8 text-xs gap-1.5 hover:bg-background hover:text-foreground hover:shadow-xs transition-all"
              aria-label="触发全站健康巡检"
            >
              <Activity className="h-3.5 w-3.5 text-blue-500" />
              <span>全站巡检</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => triggerQuickJob('recompute_rank', '热度重排')}
              className="h-8 text-xs gap-1.5 hover:bg-background hover:text-foreground hover:shadow-xs transition-all"
              aria-label="触发热度重排"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              <span>重排热度</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={exportOpsReport}
              disabled={!data}
              className="h-8 text-xs gap-1.5 hover:bg-background hover:text-foreground hover:shadow-xs transition-all"
              aria-label="导出巡检快照"
              title="导出当前运维指标与全链路健康度快照 JSON"
            >
              <Download className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>导出快照</span>
            </Button>
            <div className="w-[1px] h-4 bg-border/80 mx-0.5 hidden sm:block" />
            <DashboardRefreshControl
              onRefresh={(show) => fetchFullDashboard(show)}
              isRefreshing={isRefreshing}
              defaultIntervalSeconds={30}
            />
          </div>
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

      {/* 运行时全链路微指标胶囊带 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <div className="rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs p-3 shadow-xs hover:border-primary/40 transition-colors flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>运行时长</span>
            <Clock className="w-3.5 h-3.5 text-muted-foreground/70" />
          </div>
          <div className="text-base font-bold font-mono tracking-tight mt-1.5 text-foreground">
            {runtime ? formatUptime(runtime.uptimeSeconds) : '--'}
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs p-3 shadow-xs hover:border-emerald-500/40 transition-colors flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>当前 QPS</span>
            <Zap className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-base font-bold font-mono tracking-tight mt-1.5 text-emerald-600 dark:text-emerald-400">
            {runtime ? runtime.qps : 0} <span className="text-xs font-normal text-muted-foreground font-sans">r/s</span>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs p-3 shadow-xs hover:border-amber-500/40 transition-colors flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>P95 响应耗时</span>
            <Gauge className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-base font-bold font-mono tracking-tight mt-1.5 text-foreground">
            {runtime ? runtime.p95LatencyMs : 0} <span className="text-xs font-normal text-muted-foreground font-sans">ms</span>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs p-3 shadow-xs hover:border-indigo-500/40 transition-colors flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>进程常驻内存</span>
            <Server className="w-3.5 h-3.5 text-indigo-500" />
          </div>
          <div className="text-base font-bold font-mono tracking-tight mt-1.5 text-foreground">
            {runtime ? runtime.memory.rssMb : 0} <span className="text-xs font-normal text-muted-foreground font-sans">MB</span>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs p-3 shadow-xs hover:border-emerald-500/40 transition-colors flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>全文搜索引擎</span>
            <Database className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-base font-bold font-mono tracking-tight mt-1.5 flex items-center gap-1.5 text-foreground">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm">FTS5 (CJK)</span>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs p-3 shadow-xs hover:border-purple-500/40 transition-colors flex flex-col justify-between">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>向量检索通道</span>
            <Sparkles className="w-3.5 h-3.5 text-purple-500" />
          </div>
          <div className="text-base font-bold font-mono tracking-tight mt-1.5 flex items-center gap-1.5 text-foreground">
            <span
              className={`w-2 h-2 rounded-full ${
                data?.capabilities?.semantic ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'
              }`}
            />
            <span className="text-sm font-sans">{data?.capabilities?.semantic ? 'sqlite-vec' : '降级'}</span>
          </div>
        </div>
      </div>

      {/* 6 大核心 KPI 态势卡片（带 Sparkline 趋势微图与等宽字体） */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* 站点资产总数 */}
        <Card className="relative overflow-hidden border-border/70 bg-card/70 hover:border-blue-500/50 hover:shadow-md transition-all">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-blue-500 via-indigo-500 to-transparent" />
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">站点资产规模</CardTitle>
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              <Globe className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-2">
              <div className="text-2xl font-bold font-mono tracking-tight">{bigNum(overview?.totalSites)}</div>
              <DashboardSparkline
                data={[
                  overview?.totalSites ? Math.max(0, overview.totalSites - 15) : 980,
                  overview?.totalSites ? Math.max(0, overview.totalSites - 10) : 992,
                  overview?.totalSites ? Math.max(0, overview.totalSites - 6) : 1001,
                  overview?.totalSites ? Math.max(0, overview.totalSites - 2) : 1008,
                  overview?.totalSites ?? 1010,
                ]}
                color="blue"
                width={100}
                height={32}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-2.5 pt-2 border-t border-border/40 flex items-center gap-2 flex-wrap font-mono">
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {bigNum(overview?.activeSites)} 正常
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {bigNum(overview?.brokenSites)} 异常
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                {bigNum(overview?.pendingSites)} 待审
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                {bigNum(overview?.trashedSites)} 回收站
              </span>
            </div>
          </CardContent>
        </Card>

        {/* 24h 健康可用率 */}
        <Card className="relative overflow-hidden border-border/70 bg-card/70 hover:border-emerald-500/50 hover:shadow-md transition-all">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-emerald-500 via-teal-500 to-transparent" />
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">24h 站点健康度</CardTitle>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <Activity className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-2">
              <div
                className={`text-2xl font-bold font-mono tracking-tight ${
                  metrics24h?.healthRate !== null && metrics24h?.healthRate !== undefined && metrics24h.healthRate < 95
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {metrics24h?.healthRate !== null && metrics24h?.healthRate !== undefined
                  ? `${metrics24h.healthRate}%`
                  : '100%'}
              </div>
              <DashboardSparkline
                data={[98.1, 98.6, 99.0, 98.4, 98.8, 99.2, metrics24h?.healthRate ?? 99.4]}
                color="emerald"
                width={100}
                height={32}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-2.5 pt-2 border-t border-border/40 font-mono truncate">
              近24h 巡检 {metrics24h?.healthChecks ?? 0} 次 · 失败{' '}
              {metrics24h?.healthFailed ?? 0} 次 · 均值耗时{' '}
              {metrics24h?.avgLatencyMs ?? 0} ms
            </div>
          </CardContent>
        </Card>

        {/* API 吞吐与 QPS */}
        <Card className="relative overflow-hidden border-border/70 bg-card/70 hover:border-indigo-500/50 hover:shadow-md transition-all">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-indigo-500 via-violet-500 to-transparent" />
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">API 性能吞吐</CardTitle>
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
              <Zap className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-2">
              <div className="text-2xl font-bold font-mono tracking-tight">
                {runtime?.totalRequests ?? 0}{' '}
                <span className="text-xs font-normal text-muted-foreground font-sans">总请求</span>
              </div>
              <DashboardSparkline
                data={[10, 14, 18, 12, 16, 22, runtime?.qps ?? 18]}
                color="indigo"
                width={100}
                height={32}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-2.5 pt-2 border-t border-border/40 flex items-center gap-2 font-mono">
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                2xx 成功: {runtime?.statusCodes?.s2xx ?? 0}
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                错误率: {runtime?.statusCodes?.errorRate ?? 0}%
              </span>
            </div>
          </CardContent>
        </Card>

        {/* 任务调度队列 */}
        <Card className="relative overflow-hidden border-border/70 bg-card/70 hover:border-amber-500/50 hover:shadow-md transition-all">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-amber-500 via-orange-500 to-transparent" />
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">自愈与后台任务</CardTitle>
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              <Workflow className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-2">
              <div className="text-2xl font-bold font-mono tracking-tight">
                {bigNum(metrics24h?.jobsCompleted)}{' '}
                <span className="text-xs font-normal text-muted-foreground font-sans">24h 完成</span>
              </div>
              <DashboardSparkline
                data={[5, 12, 8, 16, 20, 15, metrics24h?.jobsCompleted ?? 25]}
                color="amber"
                width={100}
                height={32}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-2.5 pt-2 border-t border-border/40 flex items-center gap-2 font-mono">
              <span className="inline-flex items-center gap-1 text-blue-500 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                {metrics24h?.jobsPending ?? 0} 待认领
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1 text-amber-500 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {metrics24h?.jobsRunning ?? 0} 运行中
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1 text-rose-500 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                {metrics24h?.jobsFailed ?? 0} 失败
              </span>
            </div>
          </CardContent>
        </Card>

        {/* 安全审计态势 */}
        <Card className="relative overflow-hidden border-border/70 bg-card/70 hover:border-rose-500/50 hover:shadow-md transition-all">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-rose-500 via-pink-500 to-transparent" />
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">安全防护与审计</CardTitle>
            <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
              <ShieldCheck className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-2">
              <div className="text-2xl font-bold font-mono tracking-tight">
                {bigNum(metrics24h?.auditLogs)}{' '}
                <span className="text-xs font-normal text-muted-foreground font-sans">近24h 日志</span>
              </div>
              <DashboardSparkline
                data={[8, 14, 11, 19, 22, 17, metrics24h?.auditLogs ?? 26]}
                color="rose"
                width={100}
                height={32}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-2.5 pt-2 border-t border-border/40 flex items-center gap-2 font-mono">
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Token: {security?.tokenStats.active ?? 0}/{security?.tokenStats.total ?? 0} 有效
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                拦截: {security?.totalAuthFailures24h ?? metrics24h?.authFailures ?? 0} 次
              </span>
            </div>
          </CardContent>
        </Card>

        {/* LinUCB 强化学习引擎 */}
        <Card className="relative overflow-hidden border-border/70 bg-card/70 hover:border-purple-500/50 hover:shadow-md transition-all">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-violet-500 via-purple-500 to-transparent" />
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">检索强化学习 (LinUCB)</CardTitle>
            <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
              <Sparkles className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-2">
              <div className="text-2xl font-bold font-mono tracking-tight flex items-center gap-1.5">
                {linucb?.feedbackCount ?? 0}
                <span className="text-xs font-normal text-muted-foreground font-sans">样本</span>
                {sseStatus === 'connected' && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    动态调优
                  </span>
                )}
              </div>
              <DashboardSparkline
                data={[45, 62, 78, 88, 95, 102, linucb?.feedbackCount ?? 115]}
                color="violet"
                width={100}
                height={32}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-2.5 pt-2 border-t border-border/40 font-mono truncate">
              5 通道自适应置信度重排 · 探索系数 α={linucb?.alpha ?? 0.15}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 核心可视化大盘：24h 流量延时时序面积图 + HTTP 状态与底层能力甜甜圈图 */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-12">
        <div className="lg:col-span-7 xl:col-span-8">
          <DashboardTrafficChart
            totalRequests={runtime?.totalRequests}
            avgLatencyMs={runtime?.avgLatencyMs ?? metrics24h?.avgLatencyMs ?? 18}
            p95LatencyMs={runtime?.p95LatencyMs ?? 28}
            p99LatencyMs={runtime?.p99LatencyMs ?? 65}
            currentQps={runtime?.qps ?? 12}
            errorRate={runtime?.statusCodes?.errorRate ?? 0.2}
          />
        </div>
        <div className="lg:col-span-5 xl:col-span-4">
          <DashboardStatusDonut
            statusCodes={runtime?.statusCodes}
            totalRequests={runtime?.totalRequests}
            p50LatencyMs={runtime?.p50LatencyMs}
            p99LatencyMs={runtime?.p99LatencyMs}
            capabilities={data?.capabilities}
          />
        </div>
      </div>

      {/* 深入分析区块：慢请求排障治理 + LinUCB 权重 + 分类统计 + 数据库容量 */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* 耗时最高路由治理排行榜 */}
        <DashboardSlowRoutes routes={runtime?.topSlowRoutes} />

        {/* LinUCB 检索通道自适应权重 */}
        <Card className="border-border/70 shadow-xs hover:border-primary/40 transition-colors">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              LinUCB 多通道自适应权重
            </CardTitle>
            <CardDescription>
              打破传统静态常数，根据查询 CJK/拼音/长度情境自适应调节
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3.5">
            {linucb?.arms ? (
              Object.entries(linucb.arms).map(([ch, info]) => {
                const style = CHANNEL_STYLES[ch] || {
                  label: ch,
                  barClass: 'bg-primary',
                  badgeClass: 'text-primary bg-primary/10 border-primary/20',
                }
                const pct = Math.min(100, Math.max(8, (info.weightEstimate / 2.0) * 100))
                return (
                  <div key={ch} className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-medium flex items-center gap-1.5">
                        <Badge variant="outline" className={`text-[10px] h-4 px-1 font-mono ${style.badgeClass}`}>
                          {ch}
                        </Badge>
                        <span>{style.label}</span>
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        权重 <span className="font-bold text-foreground">{info.weightEstimate.toFixed(3)}</span> · L2模 {info.bNorm.toFixed(2)}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-muted/60 rounded-full overflow-hidden p-0.5 border border-border/40">
                      <div
                        className={`h-full rounded-full transition-all duration-500 shadow-xs ${style.barClass}`}
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
        <Card className="border-border/70 shadow-xs hover:border-primary/40 transition-colors">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Folders className="h-4 w-4 text-primary" />
              顶级分类收录分布
            </CardTitle>
            <CardDescription>各主分类下站点占比（前 8 大主要分类）</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.categoryDistribution && data.categoryDistribution.length > 0 ? (
              data.categoryDistribution.map((cat, idx) => {
                const colorPalette = [
                  'bg-blue-500',
                  'bg-emerald-500',
                  'bg-violet-500',
                  'bg-amber-500',
                  'bg-rose-500',
                  'bg-cyan-500',
                  'bg-indigo-500',
                  'bg-teal-500',
                ]
                const barColor = colorPalette[idx % colorPalette.length]
                return (
                  <div key={cat.id} className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-medium truncate max-w-[200px] flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${barColor}`} />
                        <span>{cat.title}</span>
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {cat.siteCount} 站 · <span className="font-bold text-foreground">{cat.percentage}%</span>
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-muted/60 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                        style={{ width: `${Math.max(5, cat.percentage)}%` }}
                      />
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="text-sm text-muted-foreground">暂无分类统计数据</p>
            )}
          </CardContent>
        </Card>

        {/* 数据库存储容量与核心表记录数 */}
        <Card className="border-border/70 shadow-xs hover:border-primary/40 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-primary" />
                存储引擎与数据表容量
              </CardTitle>
              <CardDescription>
                物理数据库容量: {formatBytes(storage?.dbSizeBytes ?? null)} · WAL 写入缓冲就绪
              </CardDescription>
            </div>
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-xs font-mono">
              WAL 模式
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {storage?.tableCounts &&
                Object.entries(storage.tableCounts).map(([table, count]) => (
                  <div key={table} className="border border-border/60 rounded-lg p-2.5 text-center bg-muted/20 hover:bg-muted/40 transition-colors">
                    <div className="text-[11px] font-mono text-muted-foreground truncate flex items-center justify-center gap-1">
                      <Database className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                      <span className="truncate">{table}</span>
                    </div>
                    <div className="text-sm font-bold font-mono mt-1 text-foreground">{count.toLocaleString()}</div>
                  </div>
                ))}
            </div>

            {/* 在线自检与数据库维护动作 */}
            <div className="pt-3 border-t border-border/60 space-y-2.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                <span className="flex items-center gap-1.5">
                  <Wrench className="w-3.5 h-3.5 text-primary" />
                  在线存储引擎自检与运维工具箱
                </span>
                {isMaintaining && <span className="text-primary animate-pulse text-xs">执行引擎指令中…</span>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs px-2 gap-1.5 hover:bg-primary/10 hover:border-primary/40 transition-colors"
                  disabled={isMaintaining}
                  aria-label="执行数据库完整性自检"
                  onClick={() => runMaintenance('status')}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>完整性自检</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs px-2 gap-1.5 hover:bg-primary/10 hover:border-primary/40 transition-colors"
                  disabled={isMaintaining}
                  aria-label="执行 WAL 刷盘"
                  onClick={() => runMaintenance('checkpoint')}
                >
                  <HardDrive className="w-3.5 h-3.5 text-blue-500" />
                  <span>WAL 刷盘</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs px-2 gap-1.5 hover:bg-primary/10 hover:border-primary/40 transition-colors"
                  disabled={isMaintaining}
                  aria-label="执行 FTS5 段合并"
                  onClick={() => runMaintenance('optimize')}
                >
                  <Layers className="w-3.5 h-3.5 text-purple-500" />
                  <span>FTS5 段合并</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs px-2 gap-1.5 hover:bg-primary/10 hover:border-primary/40 transition-colors"
                  disabled={isMaintaining}
                  aria-label="执行碎片回收"
                  onClick={() => runMaintenance('vacuum')}
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>碎片回收</span>
                </Button>
              </div>
              {maintenanceMsg && (
                <div className="text-[11px] font-mono bg-zinc-950 text-emerald-400 p-2.5 rounded-lg border border-zinc-800 flex items-start gap-2 shadow-inner">
                  <span className="text-zinc-500 select-none font-bold">$</span>
                  <span className="flex-1 leading-relaxed">{maintenanceMsg}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 搜索情报与安全审计动态 */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* 搜索情报与零结果雷达 */}
        <Card className="border-border/70 shadow-xs hover:border-primary/40 transition-colors">
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
              <Button asChild variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground">
                <Link href="/admin/stats">
                  完整大盘 <ArrowRight className="w-3 h-3 ml-1" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 热门搜索 Top 5 */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-2.5 flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-orange-500" />
                高频热搜 Top 5
              </div>
              {searchAi?.topQueries && searchAi.topQueries.length > 0 ? (
                <div className="space-y-1.5">
                  {searchAi.topQueries.slice(0, 5).map((q, idx) => {
                    const medalClasses = [
                      'bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold border-amber-500/30',
                      'bg-slate-500/20 text-slate-700 dark:text-slate-300 font-bold border-slate-500/30',
                      'bg-orange-500/20 text-orange-700 dark:text-orange-300 font-bold border-orange-500/30',
                    ]
                    const rankClass = medalClasses[idx] || 'bg-muted text-muted-foreground'
                    return (
                      <div
                        key={q.query}
                        className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors border border-border/40"
                      >
                        <span className="flex items-center gap-2.5 truncate min-w-0 flex-1">
                          <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-mono shrink-0 border ${rankClass}`}>
                            {idx + 1}
                          </span>
                          <span className="font-medium truncate text-foreground">{q.query}</span>
                        </span>
                        <Badge variant="secondary" className="text-[10px] h-5 px-2 font-mono">
                          {q.count} 次检索
                        </Badge>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground py-2 text-center">暂无搜索统计数据</div>
              )}
            </div>

            {/* 零结果补录线索 */}
            <div className="pt-3 border-t border-border/60">
              <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <Sparkles className="w-3.5 h-3.5" />
                  零结果补录线索 (用户搜但库内缺失)
                </span>
                {searchAi?.zeroResultQueries && searchAi.zeroResultQueries.length > 0 && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 font-mono">
                    {searchAi.zeroResultQueries.length} 条线索
                  </Badge>
                )}
              </div>
              {searchAi?.zeroResultQueries && searchAi.zeroResultQueries.length > 0 ? (
                <div className="space-y-1.5">
                  {searchAi.zeroResultQueries.slice(0, 4).map((q) => (
                    <div
                      key={q.query}
                      className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
                    >
                      <span className="font-medium text-foreground truncate min-w-0 max-w-[120px] sm:max-w-[180px]">
                        {q.query}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-muted-foreground">{q.count} 次未命中</span>
                        <Button asChild variant="outline" size="sm" className="h-6 text-[10px] px-2 text-primary border-primary/30 hover:bg-primary/10">
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
        <Card className="border-border/70 shadow-xs hover:border-primary/40 transition-colors">
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
              <Button asChild variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground">
                <Link href="/admin/audit">
                  全部审计 <ArrowRight className="w-3 h-3 ml-1" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Token 状态概况 */}
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="p-2.5 rounded-lg bg-card/80 border border-border/60 shadow-xs">
                <div className="text-muted-foreground text-[11px]">有效 Token</div>
                <div className="text-base font-bold font-mono mt-0.5 text-emerald-600 dark:text-emerald-400">
                  {security?.tokenStats.active ?? 0}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-card/80 border border-border/60 shadow-xs">
                <div className="text-muted-foreground text-[11px]">已过期 / 吊销</div>
                <div className="text-base font-bold font-mono mt-0.5 text-muted-foreground">
                  {(security?.tokenStats.expired ?? 0) + (security?.tokenStats.revoked ?? 0)}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-card/80 border border-border/60 shadow-xs">
                <div className="text-muted-foreground text-[11px]">24h 拦截未授权</div>
                <div className="text-base font-bold font-mono mt-0.5 text-amber-600 dark:text-amber-400">
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
                <div className="space-y-1.5">
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
                        className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg border border-border/50 bg-card/60 hover:bg-card transition-colors"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <Badge variant="outline" className={`text-[10px] h-5 px-1.5 font-mono ${badgeClass}`}>
                            {log.action}
                          </Badge>
                          <span className="text-muted-foreground truncate min-w-0 max-w-[100px] sm:max-w-[150px]">
                            {log.actor} ({log.actorKind})
                          </span>
                        </div>
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1 shrink-0 font-mono">
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
      <Card className="border-border/70 shadow-xs hover:border-destructive/40 transition-colors">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Bug className="h-4 w-4 text-destructive" />
                前端错误监控
                {clientErrors && clientErrors.total > 0 && (
                  <Badge variant="destructive" className="text-[10px] h-5 px-1.5 font-mono">
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
                    className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg bg-muted/30 border border-border/40 font-mono"
                  >
                    <span className="flex items-center gap-2 truncate min-w-0 flex-1">
                      <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                        {e.kind}
                      </Badge>
                      <span className="text-muted-foreground truncate">{e.path ?? '/'}</span>
                      <span className="text-[10px] text-muted-foreground/70 truncate">{e.fingerprint}</span>
                    </span>
                    <span className="text-muted-foreground shrink-0 ml-2">
                      ×{e.count} · {new Date(e.lastSeen).toLocaleTimeString('zh-CN', { hour12: false })}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : clientErrors?.loadFailed ? (
            <div className="text-xs text-amber-600 dark:text-amber-400 py-2 text-center">
              前端错误聚合这次没有取回（中枢不可用，或该版本还没有这个端点）——这里不能读成「没有崩溃被捕获」。
            </div>
          ) : (
            <div className="text-xs text-muted-foreground py-2 text-center">
              暂无前端错误上报（进程启动以来）
            </div>
          )}
        </CardContent>
      </Card>

      {/* 快捷运维与管理中枢导航 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight">快捷管理导航</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              一键直达核心业务管理域与底层治理面板
            </p>
          </div>
          <Badge variant="outline" className="text-xs font-mono">
            {navigationItems.length} 个核心管理域
          </Badge>
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {navigationItems.map((item) => (
            <Link key={item.href} href={item.href} className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl">
              <Card className="h-full border-border/70 bg-card/60 hover:bg-card hover:border-primary/50 hover:shadow-md transition-all duration-200 group-hover:-translate-y-0.5 overflow-hidden relative">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className={`p-2 rounded-lg border shrink-0 transition-transform group-hover:scale-105 ${item.iconBg}`}>
                      <item.icon className="w-4 h-4" />
                    </div>
                    <CardTitle className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                      {item.title}
                    </CardTitle>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="secondary" className="text-[11px] font-normal">
                      {item.badge}
                    </Badge>
                    <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/60 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all text-primary" />
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {item.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
