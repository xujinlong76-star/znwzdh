'use client'

/**
 * AI 模型效能与 Token 遥测大盘 (AI Observability & Telemetry Panel)
 *
 * 聚合展示当前生效模型的实时运行效能、响应时延（Avg / P95）、Token 消耗总量与
 * 预估花费、按小时分桶的调用走势、各业务场景调用分布，以及 24 小时滚动额度闸门的余量。
 * 所有读数来自 `/api/admin/ai/observability`：测不到的项目写「未配置 / 未采集」，不填默认值。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertCircle,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  Coins,
  Cpu,
  Layers,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  fetchAdminAiObservability,
  type HubAiObservabilityResponse,
  type HubAiQuotaMeter,
} from '@/lib/navhub-api'

const TIME_WINDOWS = [
  { label: '最近 24 小时', value: '24h' },
  { label: '最近 7 天', value: '7d' },
  { label: '最近 30 天', value: '30d' },
]

/** 走势按「本地小时的第几小时」分桶，所以 7/30 天窗口是同小时的跨天合计，不是连续时间轴 */
const TREND_CAPTION: Record<string, string> = {
  '1d': '过去 24 小时每小时的调用频次（柱状高度）与平均时延（悬浮查看）',
  '7d': '最近 7 天按小时归并的调用频次（同一小时跨天合计，非连续时间轴）',
  '30d': '最近 30 天按小时归并的调用频次（同一小时跨天合计，非连续时间轴）',
}

const QUOTA_TIERS = [
  { key: 'identity', title: '单身份档', desc: '登录用户与带匿名标识的访客，每人各自计数' },
  { key: 'anonymous', title: '无身份合池', desc: '取不到身份的请求（含后台批量任务）合并计数' },
  { key: 'system', title: '运维 key 预算', desc: '系统密钥的实际消耗上限，用户自带 key 不计入' },
] as const

/**
 * 额度条文案：limit=0 是「这一档没启用」，used=null 是「这一档整体用量测不出来」。
 * 两者都不能渲染成 0 —— 0 会被读成「一次都没用」，而真实含义完全不同。
 */
function quotaMeterText(meter: HubAiQuotaMeter | undefined, unit: '次' | 'tokens'): string {
  if (!meter || meter.limit <= 0) return '未启用'
  if (meter.used === null || meter.used === undefined) {
    return `上限 ${meter.limit.toLocaleString()} ${unit}（按人分别计量）`
  }
  return `${meter.used.toLocaleString()} / ${meter.limit.toLocaleString()} ${unit}`
}

function quotaFillPercent(meter: HubAiQuotaMeter | undefined): number | null {
  if (!meter || meter.limit <= 0) return null
  if (meter.used === null || meter.used === undefined) return null
  return Math.min(100, Math.round((meter.used / meter.limit) * 100))
}

export function AiObservabilityPanel() {
  const [data, setData] = useState<HubAiObservabilityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeWindow, setTimeWindow] = useState('24h')

  const loadMetrics = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchAdminAiObservability(timeWindow)
      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [timeWindow])

  useEffect(() => {
    void loadMetrics()
  }, [loadMetrics])

  const maxHourlyCalls = Math.max(1, ...(data?.hourlyTrend?.map((h) => h.calls) ?? [1]))

  return (
    <div className="space-y-6">
      {/* 头部控制栏 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
              <Cpu className="h-5 w-5 text-indigo-500" />
              AI 效能与 Token 遥测大盘
            </h2>
            <Badge variant="outline" className="text-xs bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20">
              {/* 大盘解的是「当前生效的那个模型」，名字必须来自接口而不是写死的厂商名 */}
              {data?.activeModel ? `${data.activeModel} 实时中枢` : '实时中枢'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            监控全站 Copilot 抽屉、智能工作台规划与元数据富化的请求吞吐、时延与 Token 配额消耗
          </p>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
          {/* 时间跨度选择 */}
          <div className="flex rounded-lg border bg-muted/40 p-0.5 text-xs">
            {TIME_WINDOWS.map((tw) => (
              <button
                key={tw.value}
                type="button"
                aria-label={`切换统计周期至 ${tw.label}`}
                onClick={() => setTimeWindow(tw.value)}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  timeWindow === tw.value
                    ? 'bg-background font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tw.label}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadMetrics()}
            disabled={loading}
            className="h-8 gap-1.5 text-xs"
            aria-label="刷新效能指标"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            刷新
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>获取遥测指标异常：{error}</span>
        </div>
      )}

      {/* 四张核心 KPI 指标卡片 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* 卡片 1：总调用次数 */}
        <div className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>总调用频次</span>
            <Activity className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {data ? data.totalCalls.toLocaleString() : '--'}
            </span>
            <span className="text-xs text-muted-foreground">次请求</span>
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            <span>成功率: {data ? `${data.successRate}%` : '--'}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>异常: {data ? data.errorCalls : 0}</span>
            {data && typeof data.thinkingCalls === 'number' && data.thinkingCalls > 0 && (
              <>
                <span className="text-muted-foreground/60">·</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                  🧠 思考调用: {data.thinkingCalls}
                </span>
              </>
            )}
          </div>
        </div>

        {/* 卡片 2：响应时延与 P95 */}
        <div className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>响应延迟 (P95 / Avg)</span>
            <Clock className="h-4 w-4 text-amber-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {data ? `${data.p95LatencyMs}` : '--'}
            </span>
            <span className="text-xs text-muted-foreground">ms (P95)</span>
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Zap className="h-3 w-3 text-amber-500" />
            <span>平均耗时: {data ? `${data.avgLatencyMs} ms` : '--'}</span>
          </div>
        </div>

        {/* 卡片 3：Token 消耗总量 */}
        <div className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Token 消耗量</span>
            <Coins className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {data ? (data.totalTokens >= 10000 ? `${(data.totalTokens / 1000).toFixed(1)}k` : data.totalTokens) : '--'}
            </span>
            <span className="text-xs text-muted-foreground">tokens</span>
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center justify-between">
            <span>输入: {data ? `${(data.promptTokens / 1000).toFixed(1)}k` : '--'}</span>
            <span>输出: {data ? `${(data.completionTokens / 1000).toFixed(1)}k` : '--'}</span>
          </div>
        </div>

        {/* 卡片 4：折合资费（仅在运维配置了真实单价时才给数） */}
        <div className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>预估折合资费</span>
            <TrendingUp className="h-4 w-4 text-purple-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {data?.estimatedCostRmb !== null && data?.estimatedCostRmb !== undefined
                ? `¥${data.estimatedCostRmb}`
                : '未配置'}
            </span>
            {data?.estimatedCostRmb !== null && data?.estimatedCostRmb !== undefined && (
              <span className="text-xs text-muted-foreground">RMB</span>
            )}
          </div>
          {/* 单价没配就直说：报一个凭空写的 ¥ 数只会让运维者按假账做决策 */}
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            {data?.costUnitPriceRmb ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span>单价 ¥{data.costUnitPriceRmb}/1K tokens（总消耗折算，不区分输入输出）</span>
              </>
            ) : (
              <span>
                尚未填写单价：在「模型参数与备用池配置」的成本单价（或
                <code className="mx-1">NAVHUB_LLM_COST_PER_1K_TOKENS</code>）设好后才能折算
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 24 小时滚动额度闸门：撞上限的请求会拿到 429 + 恢复时间，界面必须能看到余量 */}
      {data?.quota && (
        <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              AI 额度闸门（{data.quota.windowHours} 小时滚动窗口）
            </h3>
            <span className="text-[11px] text-muted-foreground">
              上限由 NAVHUB_LLM_QUOTA_* 配置，改完需重启中枢
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {QUOTA_TIERS.map((tier) => {
              const tierState = data.quota?.[tier.key]
              const calls = tierState?.calls
              const tokens = tierState?.tokens
              const percent = quotaFillPercent(tokens?.limit ? tokens : calls)
              const allDisabled =
                (!calls || calls.limit <= 0) && (!tokens || tokens.limit <= 0)
              return (
                <div key={tier.key} className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">{tier.title}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        allDisabled
                          ? 'text-muted-foreground'
                          : percent !== null && percent >= 90
                            ? 'bg-destructive/10 text-destructive border-destructive/20'
                            : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                      }`}
                    >
                      {allDisabled ? '未启用' : percent === null ? '按人计量' : percent >= 90 ? '接近上限' : '有余量'}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{tier.desc}</p>
                  <div className="text-[11px] font-mono text-muted-foreground space-y-0.5">
                    <div>次数: {quotaMeterText(calls, '次')}</div>
                    <div>Token: {quotaMeterText(tokens, 'tokens')}</div>
                  </div>
                  {percent !== null && (
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          percent >= 90 ? 'bg-destructive' : 'bg-amber-500'
                        }`}
                        style={{ width: `${Math.max(2, percent)}%` }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            超额请求不会被静默丢弃：中枢回 429 与恢复时间，能给出本地结果的场景（伴侣问答、平替推荐、元数据富化）
            自动降级并在界面上标明「未经模型生成」，只能靠模型完成的场景（工作台生成、插件工坊）明确报错。
          </p>
        </div>
      )}

      {/* 真实遥测说明引导 */}
      {data && (!data.hasData || data.totalCalls === 0) && (
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 text-xs text-muted-foreground flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles className="h-4 w-4 text-indigo-500 shrink-0" />
            <span>
              <strong>真实遥测已就绪：</strong>当前统计周期内尚未产生真实调用。在 Copilot 抽屉提问、在个人中心试聊、使用工作台智能生成或触发站点标签富化，系统将实时采集并在本大盘呈现真实 Token 与时延。
            </span>
          </div>
        </div>
      )}

      {/* 中部图表区：24小时走势 + 业务场景分布 */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* 左侧 2/3：24 小时请求与时延柱状图 */}
        <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-indigo-500" />
                调用负载与时延趋势
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {TREND_CAPTION[data?.window ?? '1d'] ?? TREND_CAPTION['1d']}
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-indigo-500" />
                调用频次
              </span>
            </div>
          </div>

          {/* 纯 CSS 自适应响应式柱状图 */}
          <div className="pt-4 pb-2">
            <div className="flex h-36 items-end gap-1.5 sm:gap-2">
              {data?.hourlyTrend?.map((pt, idx) => {
                const heightPercent = Math.max(8, Math.round((pt.calls / maxHourlyCalls) * 100))
                return (
                  <div
                    key={idx}
                    className="group relative flex flex-1 flex-col items-center h-full justify-end"
                  >
                    {/* Hover Tooltip */}
                    <div className="pointer-events-none absolute -top-12 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md group-hover:block border">
                      <div className="font-semibold">{pt.time}</div>
                      <div>调用: {pt.calls} 次 · 耗时: {pt.latencyMs}ms</div>
                    </div>

                    {/* 柱条 */}
                    <div
                      style={{ height: `${heightPercent}%` }}
                      className="w-full rounded-t-sm bg-indigo-500/80 transition-all duration-300 group-hover:bg-indigo-600 dark:bg-indigo-500/70 dark:group-hover:bg-indigo-400"
                    />

                    {/* 时间刻度（隔3个显示一个） */}
                    <span className="mt-1.5 text-[10px] text-muted-foreground scale-90 sm:scale-100">
                      {idx % 3 === 0 ? pt.time.slice(0, 2) : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* 右侧 1/3：场景调用占比与消耗拆分 */}
        <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Layers className="h-4 w-4 text-purple-500" />
              业务场景分布
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              各业务组件对大模型算力与 Token 的消耗配比
            </p>
          </div>

          <div className="space-y-3.5 pt-1">
            {data?.byScenario?.map((sc) => {
              const percent = data.totalCalls > 0 ? Math.round((sc.count / data.totalCalls) * 100) : 0
              return (
                <div key={sc.scenario} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{sc.name}</span>
                    <span className="text-muted-foreground">{sc.count} 次 ({percent}%)</span>
                  </div>
                  {/* 进度条 */}
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Token: {(sc.tokens / 1000).toFixed(1)}k</span>
                    <span>均耗: {sc.avgLatencyMs}ms</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* 模型状态卡片 */}
          <div className="rounded-lg border bg-muted/30 p-3 mt-4 space-y-1">
            <div className="flex items-center justify-between text-xs font-medium">
              <span>当前主服务模型</span>
              <Badge
                variant="outline"
                className={
                  data?.activeModel?.trim()
                    ? 'text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                    : 'text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
                }
              >
                {data?.activeModel?.trim() ? '已解析' : '未配置'}
              </Badge>
            </div>
            <p className="text-xs font-mono text-muted-foreground">
              {/* 「当前主服务模型」是运维读数：没采到就不能填一个默认厂商名，
                  否则管理员换了模型，大盘仍显示老的那一个，读数从此不可信 */}
              {data?.activeModel?.trim() || '未采集到模型名'}
            </p>
            <p className="text-[11px] text-muted-foreground">
              名称取自管理端此刻生效的配置；上下文长度、JSON 模式等能力以该端点实测为准，本面板不做假设。
            </p>
          </div>
        </div>
      </div>

      {/* 底部调用流水实时日志表 */}
      <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Bot className="h-4 w-4 text-indigo-500" />
              最近调用流审计日志 (Recent Invocations)
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              记录每次模型交互的时延、Token 规格、调用场景与执行结果
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            显示最近 {data?.recentLogs?.length ?? 0} 条记录
          </span>
        </div>

        <div className="overflow-x-auto no-scrollbar touch-pan-x">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-2.5 px-3 font-medium">时间</th>
                <th className="py-2.5 px-3 font-medium">业务场景</th>
                <th className="py-2.5 px-3 font-medium">模型</th>
                <th className="py-2.5 px-3 font-medium">来源</th>
                <th className="py-2.5 px-3 font-medium">耗时</th>
                <th className="py-2.5 px-3 font-medium">Token 消耗</th>
                <th className="py-2.5 px-3 font-medium text-right">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {data?.recentLogs && data.recentLogs.length > 0 ? (
                data.recentLogs.map((log) => {
                  const dateStr = new Date(log.timestamp).toLocaleTimeString('zh-CN', {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })
                  return (
                    <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-3 text-muted-foreground font-mono">{dateStr}</td>
                      <td className="py-2 px-3 font-medium">
                        {log.scenario === 'ai_chat'
                          ? 'AI Web Copilot 助手'
                          : log.scenario === 'ai_canvas_generate'
                          ? '一句话工作台生成'
                          : log.scenario === 'ai_config_test'
                          ? '连通性测试探测'
                          : log.scenario === 'copilot'
                          ? 'Copilot 导航问答'
                          : log.scenario === 'health_audit'
                          ? '健康审计与平替推荐'
                          : log.scenario === 'enrich'
                          ? '站点标签与描述富化'
                          : log.scenario}
                      </td>
                      <td className="py-2 px-3">
                        <code className="text-[11px] bg-muted/60 px-1.5 py-0.5 rounded">{log.model}</code>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">
                        {log.source === 'system' ? '系统配置' : log.source === 'user' ? '用户配置' : log.source}
                      </td>
                      <td className="py-2 px-3 font-mono">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${
                            log.latencyMs < 400
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : log.latencyMs < 800
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : 'bg-red-500/10 text-red-600 dark:text-red-400'
                          }`}
                        >
                          {log.latencyMs} ms
                        </span>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">
                        {log.tokens} tokens
                      </td>
                      <td className="py-2 px-3 text-right">
                        {log.status === 'success' ? (
                          <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                            成功
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/20">
                            异常
                          </Badge>
                        )}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    暂无调用记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
