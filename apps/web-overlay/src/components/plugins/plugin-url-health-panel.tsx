'use client'

/**
 * 网址包「可达性体检」面板（P0-1）。
 *
 * 与既有巡检的分工（刻意不重复）：
 *   - **已安装**插件的站点由后台 24h 的 health_check 覆盖（Weibull 抽样 + 健康字段回写）；
 *   - 本面板负责**任意网址包声明清单里的 URL**（**未安装也能测**），回答
 *     「这个包里的网址是不是真的能用」——这是市场数据可信度的命门。
 *
 * 口径说明（与后端 `POST /api/plugins/:slug/audit` 一致）：
 *   - 均匀抽样、默认 30 条（覆盖整包各分类，不是只验前 30 条）；
 *   - 探活走 SSRF 守卫，私网/内网目标一律判不可达；
 *   - 结果**不落库**（即时快照），服务端每次运行写一条 `audit.plugin_url_audit` 留痕。
 */

import { useCallback, useEffect, useState } from 'react'
import { Gauge, Loader2, PackageSearch, PlayCircle, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { hubGet, hubSend } from '@/lib/navhub-api'

/** 单次体检抽样条数（后端上限 200，这里给一个兼顾速度与覆盖的默认值） */
const SAMPLE_LIMIT = 30
/** 明细区最多逐条列出的不可达条目数（其余折叠为计数，避免刷屏） */
const MAX_BROKEN_ROWS = 8

interface SitePackListItem {
  slug: string
  name: string
  version: string
  icon?: string | null
}

interface AuditResult {
  slug: string
  declared: number
  sampled: number
  okCount: number
  /** 存活但拒绝爬虫（401/403/405/412/429）—— 计入可达，不计入不可达 */
  blockedCount: number
  brokenCount: number
  redirected: number
  reachability: number | null
  brokenItems: Array<{ url: string; status?: number; error?: string; failureKind?: string }>
  blockedItems: Array<{ url: string; status?: number }>
  /** 不可达原因分布：区分「我们的探针限制」（超时/重定向超限）与「站点真挂」（连接失败/HTTP 错误） */
  brokenByReason?: Record<string, number>
  /** 服务端返回的报告口径声明（本机网络测得 / 拒绝爬虫计入可达），随结果一起展示 */
  caveat?: string
  params: { sample: number; timeoutMs: number; maxRedirects?: number }
}

/** 不可达原因的中文标签（报告与明细共用） */
const REASON_LABELS: Record<string, string> = {
  timeout: '超时',
  'redirect-limit': '重定向超限',
  'ssrf-blocked': 'SSRF 拦截',
  connect: '连接失败',
  'http-error': 'HTTP 错误',
  other: '其它',
}

/** 把 brokenByReason 渲染成「超时 2 / 连接失败 1」这样的紧凑串 */
function reasonSummary(byReason?: Record<string, number>): string {
  if (!byReason) return ''
  return Object.entries(byReason)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${REASON_LABELS[kind] ?? kind} ${n}`)
    .join(' / ')
}

/** 可达率 → 徽标语义：≥95% 健康 / ≥80% 需关注 / 其余异常；null 视为未知（不拿 0 冒充全挂） */
function reachabilityBadge(rate: number | null): {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
} {
  if (rate === null) return { label: '未体检', variant: 'outline' }
  if (rate >= 0.95) return { label: `${Math.round(rate * 100)}% 健康`, variant: 'default' }
  if (rate >= 0.8) return { label: `${Math.round(rate * 100)}% 需关注`, variant: 'secondary' }
  return { label: `${Math.round(rate * 100)}% 异常`, variant: 'destructive' }
}

export function PluginUrlHealthPanel() {
  const [packs, setPacks] = useState<SitePackListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, AuditResult>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await hubGet<{ items: SitePackListItem[] }>('/plugins?kind=site-pack&limit=200')
      setPacks(data.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载网址包列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const runAudit = useCallback(async (slug: string) => {
    setRunning(slug)
    setError(null)
    try {
      const res = await hubSend<AuditResult>(`/plugins/${encodeURIComponent(slug)}/audit`, 'POST', {
        limit: SAMPLE_LIMIT,
      })
      setResults((prev) => ({ ...prev, [slug]: res }))
    } catch (err) {
      setError(err instanceof Error ? err.message : `体检失败：${slug}`)
    } finally {
      setRunning(null)
    }
  }, [])

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            网址包可达性体检
          </CardTitle>
          <CardDescription>
            对每个网址包**均匀抽样 {SAMPLE_LIMIT} 条**真实探测（未安装的包也能测）：私网目标会被 SSRF 守卫判为不可达，
            结果不落库，服务端只写一条审计留痕。
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          <span className="ml-1.5">刷新列表</span>
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && packs.length === 0 ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载网址包…
          </div>
        ) : packs.length === 0 ? (
          <EmptyState icon={PackageSearch} title="没有可体检的网址包" description="插件市场里还没有 site-pack 类型的插件。" />
        ) : (
          <ul className="divide-y rounded-lg border">
            {packs.map((pack) => {
              const result = results[pack.slug]
              const badge = reachabilityBadge(result ? result.reachability : null)
              const isRunning = running === pack.slug
              return (
                <li key={pack.slug} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className="text-base leading-none">{pack.icon ?? '📦'}</span>
                      <span className="truncate text-sm font-medium">{pack.name}</span>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{pack.slug}</code>
                      <span className="text-xs text-muted-foreground">v{pack.version}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      <Button size="sm" variant="secondary" disabled={isRunning} onClick={() => void runAudit(pack.slug)}>
                        {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                        <span className="ml-1.5">{isRunning ? '体检中…' : '抽样体检'}</span>
                      </Button>
                    </div>
                  </div>

                  {result && (
                    <div className="space-y-2 rounded-md bg-muted/40 p-3 text-xs">
                      <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
                        <span>声明 {result.declared} 条</span>
                        <span>抽样 {result.sampled} 条</span>
                        <span className="text-emerald-600 dark:text-emerald-400">可达 {result.okCount}</span>
                        {result.blockedCount > 0 && (
                          <span title="站点存活，只是 WAF 拒绝了爬虫（401/403/405/412/429），已计入可达">
                            存活但拒绝爬虫 {result.blockedCount}
                          </span>
                        )}
                        <span
                          className={result.brokenCount > 0 ? 'text-destructive' : ''}
                          title="从本机网络探测失败：可能是地域/网络限制或目标站风控，不等于站点已死，需人工复核"
                        >
                          本机不可达 {result.brokenCount}
                        </span>
                        {result.brokenCount > 0 && reasonSummary(result.brokenByReason) && (
                          <span className="text-muted-foreground">（{reasonSummary(result.brokenByReason)}）</span>
                        )}
                        {result.redirected > 0 && <span>重定向 {result.redirected}</span>}
                        <span>单条超时 {result.params.timeoutMs}ms</span>
                      </div>

                      {result.brokenCount === 0 ? (
                        <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          抽样样本没有真死链{result.blockedCount > 0 ? '（有站点拒绝爬虫，但站点本身可用）' : ''}
                        </div>
                      ) : (
                        <ul className="space-y-1">
                          {result.brokenItems.slice(0, MAX_BROKEN_ROWS).map((item) => (
                            <li key={item.url} className="flex items-start gap-1.5">
                              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                              <code className="break-all">{item.url}</code>
                              <span className="shrink-0 text-muted-foreground">
                                {item.failureKind ? (REASON_LABELS[item.failureKind] ?? item.failureKind) : (item.status ? 'HTTP 错误' : '不可达')}
                                {item.status ? ` HTTP ${item.status}` : ''}
                              </span>
                            </li>
                          ))}
                          {result.brokenItems.length > MAX_BROKEN_ROWS && (
                            <li className="text-muted-foreground">……还有 {result.brokenItems.length - MAX_BROKEN_ROWS} 条未列出</li>
                          )}
                        </ul>
                      )}

                      {result.blockedItems.length > 0 && (
                        <details className="text-muted-foreground">
                          <summary className="cursor-pointer">
                            站点存活但拒绝爬虫的条目（{result.blockedItems.length} 条，不计入不可达）
                          </summary>
                          <ul className="mt-1 space-y-1">
                            {result.blockedItems.slice(0, MAX_BROKEN_ROWS).map((item) => (
                              <li key={item.url} className="flex items-start gap-1.5">
                                <code className="break-all">{item.url}</code>
                                <span className="shrink-0">{item.status ? `HTTP ${item.status}` : '被拦截'}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}

                      {result.caveat && <p className="text-muted-foreground">{result.caveat}</p>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          提示：体检是**即时快照**，不写入站点健康表；已安装包内站点的长期健康走势由后台 health_check 任务负责。
        </p>
      </CardContent>
    </Card>
  )
}
