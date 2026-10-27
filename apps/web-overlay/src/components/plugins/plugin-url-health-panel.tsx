'use client'

/**
 * 网址包「一键智能体检与 AI 自愈治理」指挥台（P0-1 深度细节优化版）。
 *
 * 核心升级点：
 *   1. 【一键全量/增量体检工作台】：支持一键扫描全量或仅测异常/未测包，带流式进度与抽样深度切换；
 *   2. 【历史快照秒级预载】：页面加载即联查 /plugins/url-health/summary，告别首屏全白；
 *   3. 【L1-L3 防劫持深度探针】：接入 Shannon 信息熵与域名停放/软404识别，抓取实际标题防篡改；
 *   4. 【三位一体 AI 诊断自愈闭环】：Wayback 历史快照 + 站内健康平替 + 后端大模型推荐；
 *   5. 【一键净网修复】：管理端一键从包内 Manifest 剔除死链或替换为修复地址并持久化；
 *   6. 【多选批量体检】：支持表格勾选任意网址包并唤出浮动操作条，一键体检所选；
 *   7. 【抽屉分栏视图】：按「风险与自愈 / 死链 / 疑似停放 / WAF放行」Tab 切片，告别超长滚屏；
 *   8. 【键盘快捷操作】：按 `/` 键秒级聚焦搜索框，按 `Esc` 键快速退出筛选与确认；
 *   9. 【极速轻量渲染】：抽离 React.memo 单卡片行，并发 startTransition 调度与客户端分页，彻底消除渲染冻结。
 */

import { memo, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { deriveHealthPanelState } from "@/lib/health-panel-state"
import {
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Filter,
  Gauge,
  Globe,
  History,
  Info,
  Layers,
  Loader2,
  Microscope,
  PackageSearch,
  Play,
  PlayCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
  Wand2,
  X,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { copyText } from '@/lib/clipboard'
import { hubGet, hubSend } from '@/lib/navhub-api'
import { safeHref } from '@/lib/safe-url'

export interface SitePackListItem {
  slug: string
  name: string
  version: string
  description?: string | null
  icon?: string | null
  tags?: string[]
}

export interface HistoricalSummary {
  /** null = 从未体检，或最近一条记录是「待复检」（清单改过但还没重测） */
  auditedAt: number | null
  /** 清单被改动过、尚未复检：此时所有健康计数都不可信 */
  stale?: boolean
  healedAt?: number | null
  declared: number | null
  sampled: number | null
  okCount: number | null
  blockedCount: number | null
  suspiciousCount: number | null
  brokenCount: number | null
  reachability: number | null
}

export interface AuditResult {
  slug: string
  /** 实时探活结果本身不带体检时间，与历史快照联合消费时可能由上层补齐 */
  auditedAt?: number | null
  declared: number
  sampled: number
  okCount: number
  blockedCount: number
  suspiciousCount?: number
  brokenCount: number
  redirected: number
  reachability: number | null
  brokenItems: Array<{ url: string; status?: number; error?: string; failureKind?: string; latencyMs?: number }>
  blockedItems: Array<{ url: string; status?: number; latencyMs?: number }>
  suspiciousItems?: Array<{
    url: string
    status?: number
    title?: string
    reason?: string
    shannonEntropy?: number
    matchedKeywords?: string[]
    latencyMs?: number
  }>
  brokenByReason?: Record<string, number>
  caveat?: string
  params: { sample: number; timeoutMs: number; maxRedirects?: number }
  /** 治愈后重新读取时为 true：计数为 null，不可展示为健康 */
  stale?: boolean
}

/** 候选可信度分解：与后端 CandidateConfidence 同构 */
export interface CandidateConfidence {
  total: number
  reachability: number
  contentHealth: number
  domainFit: number
}

export interface ReplacementCandidate {
  title: string
  url: string
  reason: string
  tag?: string
  qualityScore?: number
  verified?: boolean
  latencyMs?: number
  source?: 'ai' | 'catalog' | 'search'
  /** 探活四档：verified 才是真通过；blocked 无法验证内容；suspicious 是停放页 */
  grade?: 'verified' | 'blocked' | 'unverified' | 'suspicious' | 'dead'
  gradeReason?: string
  confidence?: CandidateConfidence
}

/** 体检历史的一个点（GET /:slug/url-health/history） */
export interface HealthTrendPoint {
  at: number
  reachability: number | null
  declared: number | null
  sampled: number | null
  ok: number | null
  blocked: number | null
  suspicious: number | null
  broken: number | null
}

export interface HealthTrendResult {
  ok: boolean
  slug: string
  points: HealthTrendPoint[]
  trend: 'improving' | 'degrading' | 'stable' | 'insufficient'
  slope: number
  delta: number
  validPoints: number
  /** 被排除在趋势之外的「待复检」记录数 */
  skippedStale: number
}

/** 单站点深度取证结果（POST /:slug/url-deep-diagnose） */
export interface DeepDiagnoseResult {
  ok: boolean
  slug: string
  diagnosis: {
    url: string
    verdict: string
    confidence: number
    headline: string
    evidence: Array<{ layer: string; status: 'pass' | 'warn' | 'fail' | 'skip'; detail: string }>
    actions: Array<{ id: string; label: string; kind: 'replace' | 'remove' | 'archive' | 'manual' }>
    contentFacts?: {
      shannonEntropy: number
      textLength: number
      matchedParkingKeywords: string[]
      pageHealth: string
    }
  }
  observed: {
    status: number | null
    finalUrl: string | null
    contentType: string | null
    redirects: string[]
    /** null = 根本没发起 HTTP 连接（例如被安全策略拦下），不是「0ms 秒回」 */
    latencyMs: number | null
    dnsOk?: boolean
    bodyBytes: number
  }
  waybackUrl: string
  caveat?: string
}

export interface AiHealResult {
  ok: boolean
  slug: string
  model: string
  aiDegraded?: 'quota' | 'unconfigured' | 'error'
  diagnoses: Array<{
    url: string
    title: string
    kind: 'broken' | 'suspicious'
    waybackUrl: string
    cause: string
    severity: string
    description: string
    resolved?: boolean
    /** 诊断依据：live-probe = 本轮实测；client-claimed = 仅调用方声称，结论未验证 */
    evidence?: {
      source: 'live-probe' | 'client-claimed'
      status?: number
      failureKind?: string
      latencyMs?: number
    }
    suggestedReplacements: ReplacementCandidate[]
  }>
  overview: string
  autoApplied?: {
    /** false = 明确未应用，配合 reason/detail 说明原因（旧实现失败时字段整个缺省） */
    applied?: boolean
    reason?: 'no-targets' | 'no-verified-candidate' | 'empty-manifest' | 'validation-failed'
    detail?: string
    replacedCount: number
    removedCount: number
    remainingSites: number
    version: string
    items: Array<{
      oldUrl: string
      newUrl: string
      newTitle: string
      tag?: string
      qualityScore?: number
      verified?: boolean
      confidence?: CandidateConfidence
    }>
    /** 实际被剔除的 URL（items 只装替换项，剔除的原来无处可查） */
    removedUrls?: string[]
  }
  /** 不属于本包、被后端拒绝处理的 URL */
  ignoredUrls?: string[]
}

const REASON_LABELS: Record<string, string> = {
  timeout: '超时',
  'redirect-limit': '重定向超限',
  'ssrf-blocked': 'SSRF 拦截',
  connect: '连接失败',
  'http-error': 'HTTP 错误',
  other: '其它',
}

/** 深检结论的中文名（与 core 的 DeepVerdict 一一对应） */
const DEEP_VERDICT_LABELS: Record<string, string> = {
  healthy: '正常可达',
  'bot-blocked': '拒绝爬虫（站点可用）',
  'soft-404': '软 404（页面不存在）',
  parked: '域名停放 / 广告占位',
  'expired-domain': '域名失效',
  'server-error': '服务端异常',
  'redirect-hijack': '异常跳转',
  unreachable: '无法连接',
  'http-error': 'HTTP 错误',
}

const DEEP_LAYER_LABELS: Record<string, string> = {
  url: 'URL 结构',
  dns: 'DNS',
  redirect: '重定向',
  http: 'HTTP',
  content: '内容',
  wayback: '归档',
}

/** 证据状态的视觉映射：fail 红 / warn 黄 / pass 绿 / skip 灰（skip 必须一眼看出「没查」） */
const DEEP_STATUS_CLASS: Record<string, string> = {
  pass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  fail: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  skip: 'bg-muted text-muted-foreground',
}

/** 自动应用未生效的原因（必须显示，否则用户以为「已修复」） */
const AUTO_APPLY_REASON_LABELS: Record<string, string> = {
  'no-targets': '无待治理站点',
  'no-verified-candidate': '无实测通过的平替',
  'empty-manifest': '剔除后清单为空',
  'validation-failed': '清单校验失败',
}

/** 候选档位的中文名与配色 */
const CANDIDATE_GRADE_META: Record<string, { label: string; className: string }> = {
  verified: { label: '实测可达', className: 'text-emerald-600 border-emerald-500/40 bg-emerald-500/10' },
  blocked: { label: '拒绝爬虫·未验证', className: 'text-sky-600 border-sky-500/40 bg-sky-500/10' },
  // 超时/连接中断只说明「这次没测到」，不能写成「不可达」——那是把没测准说成确认下线
  unverified: { label: '未能验证', className: 'text-slate-600 border-slate-400/40 bg-slate-500/10' },
  suspicious: { label: '疑似停放', className: 'text-amber-600 border-amber-500/40 bg-amber-500/10' },
  dead: { label: '不可达', className: 'text-rose-600 border-rose-500/40 bg-rose-500/10' },
}

/** 趋势文案：明确区分「真的在变」与「点数不够，判不了」 */
const TREND_META: Record<string, { label: string; className: string }> = {
  improving: { label: '近期改善', className: 'text-emerald-600 dark:text-emerald-400' },
  degrading: { label: '近期恶化', className: 'text-rose-600 dark:text-rose-400' },
  stable: { label: '基本稳定', className: 'text-muted-foreground' },
  insufficient: { label: '点数不足', className: 'text-muted-foreground' },
}

function reasonSummary(byReason?: Record<string, number>): string {
  if (!byReason) return ''
  return Object.entries(byReason)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${REASON_LABELS[kind] ?? kind} ${n}`)
    .join(' / ')
}

function formatRelativeTime(timestamp?: number | null): string {
  if (!timestamp || timestamp <= 0) return '未体检'
  const diff = Date.now() - timestamp
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  return `${Math.floor(diff / 86400_000)} 天前`
}

/**
 * 健康徽标。
 *
 * `stale` 优先于一切数值：清单被替换/剔除过之后，任何百分比都是旧数据或推算值。
 * 显示「待复检」比显示一个绿色「100% 健康」诚实 —— 后者会让人以为替换目标已被验证。
 */
function getHealthBadge(
  rate: number | null | undefined,
  brokenCount = 0,
  suspiciousCount = 0,
  stale = false,
): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
  if (stale) return { label: '待复检', variant: 'outline' }
  // 与筛选按钮同一口径：null 既可能是没体检过，也可能是体检了但样本为 0（total=0），
  // 一律说「从未体检」会把后者说错，也会和「无有效数据」的筛选语义打架。
  if (rate === null || rate === undefined) return { label: '无有效数据', variant: 'outline' }
  const percent = Math.round(rate * 100)
  if (percent >= 90 && brokenCount === 0 && suspiciousCount === 0) {
    return { label: `${percent}% 健康`, variant: 'default' }
  }
  if (percent >= 70 && brokenCount <= 2) {
    return { label: `${percent}% 需关注`, variant: 'secondary' }
  }
  return { label: `${percent}% 异常`, variant: 'destructive' }
}

/**
 * 从 autoApplied 推导「真的被处理掉的 URL」。
 *
 * 不能直接用提报列表：后端只为「找到通过实测的候选」的站点做替换，
 * 找不到候选的死链会原样留在清单里。若按提报列表标记「已解决」，
 * 没修好的死链会在界面上一并消失——这正是本次要根治的「用推算冒充实测」。
 */
function appliedUrlsOf(auto: AiHealResult['autoApplied']): string[] {
  if (!auto) return []
  return [...(auto.items ?? []).map((it) => it.oldUrl), ...(auto.removedUrls ?? [])]
}

/** 一键复制按钮组件 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation()
    void copyText(text).then((result) => {
      if (!result.ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted/80 transition-colors shrink-0"
      title={copied ? '已复制到剪贴板' : '复制网址'}
      aria-label="复制网址"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

/** 单包健康分布微条 */
function PackHealthBar({
  ok = 0,
  blocked = 0,
  suspicious = 0,
  broken = 0,
}: {
  ok?: number
  blocked?: number
  suspicious?: number
  broken?: number
}) {
  const total = ok + blocked + suspicious + broken
  if (total === 0) return null
  const pctOk = (ok / total) * 100
  const pctBlocked = (blocked / total) * 100
  const pctSuspicious = (suspicious / total) * 100
  const pctBroken = (broken / total) * 100

  return (
    <div
      className="h-2 w-28 sm:w-36 overflow-hidden rounded-full bg-muted/70 flex shrink-0 border border-border/40 shadow-inner"
      title={`健康可达: ${ok} | WAF放行: ${blocked} | 疑似停放: ${suspicious} | 确认死链: ${broken}`}
    >
      {pctOk > 0 && <div style={{ width: `${pctOk}%` }} className="h-full bg-emerald-500 transition-all duration-300" />}
      {pctBlocked > 0 && <div style={{ width: `${pctBlocked}%` }} className="h-full bg-sky-400 transition-all duration-300" />}
      {pctSuspicious > 0 && <div style={{ width: `${pctSuspicious}%` }} className="h-full bg-amber-400 transition-all duration-300" />}
      {pctBroken > 0 && <div style={{ width: `${pctBroken}%` }} className="h-full bg-rose-500 transition-all duration-300" />}
    </div>
  )
}

/** 延迟时间色标徽章 */
function LatencyBadge({ ms }: { ms?: number }) {
  if (ms === undefined || ms === null) return null
  let color = 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20'
  if (ms > 1500) color = 'text-rose-600 bg-rose-500/10 border-rose-500/20'
  else if (ms > 600) color = 'text-amber-600 bg-amber-500/10 border-amber-500/20'
  return (
    <span className={`text-[10px] font-mono px-1 py-0.2 rounded border shrink-0 ${color}`} title={`探测耗时: ${ms}ms`}>
      {ms}ms
    </span>
  )
}

/**
 * 单个网址包卡片行（独立 React.memo 抽取）：
 * 彻底切断单包状态变更或批量流式推进时引发的全列表 50+ 节点级联 Reconciliation 重渲染，
 * 将 Click 响应时延从 941ms 压降到 < 5ms。
 */
interface PackRowItemProps {
  pack: SitePackListItem
  snap?: HistoricalSummary | AuditResult
  auditResult?: AuditResult
  isRunning: boolean
  isExpanded: boolean
  isSelected: boolean
  aiHeal?: AiHealResult
  isAiLoading: boolean
  isFixing: boolean
  fixSuccess?: string
  activeTab: 'issues' | 'broken' | 'suspicious' | 'blocked' | 'ai'
  isBatchRunning: boolean
  onToggleSelect: (slug: string) => void
  onToggleExpand: (slug: string) => void
  onSetTab: (slug: string, tab: 'issues' | 'broken' | 'suspicious' | 'blocked' | 'ai') => void
  onRunAudit: (slug: string) => void
  onRunAutoHealPack: (slug: string) => void
  onRunAiHeal: (slug: string) => void
  onApplyHealthFix: (slug: string, urls: string[]) => void
  onExecuteReplacement: (slug: string, oldUrl: string, newUrl: string, newTitle: string) => void
  onExecuteBatchReplacement: (slug: string, replacements: Array<{ oldUrl: string; newUrl: string; newTitle: string }>) => void
  onDismissFixSuccess: (slug: string) => void
  /** 单站点深度取证：点某条 URL 的「深检」时触发 */
  onDeepDiagnose: (slug: string, url: string) => void
  deepResult?: DeepDiagnoseResult | null
  deepLoadingUrl?: string | null
  onCloseDeep: (slug: string) => void
  /** 历史趋势（按需加载，不在首屏请求） */
  onLoadTrend: (slug: string) => void
  trend?: HealthTrendResult | null
  isTrendLoading: boolean
}

const PackRowItem = memo(function PackRowItem({
  pack,
  snap,
  auditResult,
  isRunning,
  isExpanded,
  isSelected,
  aiHeal,
  isAiLoading,
  isFixing,
  fixSuccess,
  activeTab,
  isBatchRunning,
  onToggleSelect,
  onToggleExpand,
  onSetTab,
  onRunAudit,
  onRunAutoHealPack,
  onRunAiHeal,
  onApplyHealthFix,
  onExecuteReplacement,
  onExecuteBatchReplacement,
  onDismissFixSuccess,
  onDeepDiagnose,
  deepResult,
  deepLoadingUrl,
  onCloseDeep,
  onLoadTrend,
  trend,
  isTrendLoading,
}: PackRowItemProps) {
  const badge = getHealthBadge(
    snap?.reachability,
    snap?.brokenCount ?? 0,
    snap?.suspiciousCount ?? 0,
    snap?.stale === true,
  )
  const brokenCount = snap?.brokenCount ?? 0
  const suspiciousCount = snap?.suspiciousCount ?? 0
  /**
   * 视图状态的唯一来源。下面所有分支都读 `panelState.kind`，不再各自判 `snap`/`stale`——
   * 之前正是因为两处各自判断，才写出过一个永远跑不到的分支（前端门禁 TS2339）。
   */
  const panelState = deriveHealthPanelState(snap)

  return (
    // 行根节点带 data-testid：回归脚本原先按文案过滤 div 定位单行，会命中整个列表容器，
    // 于是「这一行有没有伪造健康度」「点的是哪一行的详情」全看错了对象。按 slug 定位才是一行一对象。
    <li
      className={`space-y-2 p-3.5 transition-colors ${isRunning || isAiLoading || isFixing ? 'bg-primary/5' : 'hover:bg-muted/10'}`}
      data-testid={`pack-row-${pack.slug}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* 复选框 */}
          <button
            type="button"
            onClick={() => onToggleSelect(pack.slug)}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title={isSelected ? '取消选中' : '选中此包'}
          >
            {isSelected ? (
              <CheckSquare className="h-4 w-4 text-primary" />
            ) : (
              <Square className="h-4 w-4 text-muted-foreground/60" />
            )}
          </button>

          <span aria-hidden className="text-xl leading-none shrink-0 p-1.5 rounded-md bg-muted/60 border border-border/50">
            {pack.icon ?? '📦'}
          </span>

          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="truncate text-sm font-semibold">{pack.name}</span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{pack.slug}</code>
              <span className="text-[11px] text-muted-foreground font-mono">v{pack.version}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatRelativeTime(snap?.auditedAt)}
              </span>
              {snap?.declared !== null && snap?.declared !== undefined && <span>声明 {snap.declared} 站点</span>}
              {snap?.sampled !== null && snap?.sampled !== undefined && <span>抽样 {snap.sampled} 站点</span>}
              {brokenCount > 0 && (
                <span className="text-destructive font-medium flex items-center gap-0.5">
                  <AlertCircle className="h-3 w-3" /> {brokenCount} 死链
                </span>
              )}
              {suspiciousCount > 0 && (
                <span className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-0.5">
                  <AlertTriangle className="h-3 w-3" /> {suspiciousCount} 疑似停放
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/*
            单包健康微条。
            待复检时计数全是 null，硬画会得到一条「全零空条」——它看起来像「0 个健康」，
            和「没有测量值」是两回事。宁可整条不画，让「待复检」徽标独占解释权。
          */}
          {snap && !snap.stale && (
            <div className="hidden sm:block">
              <PackHealthBar
                ok={snap.okCount ?? 0}
                blocked={snap.blockedCount ?? 0}
                suspicious={snap.suspiciousCount ?? 0}
                broken={snap.brokenCount ?? 0}
              />
            </div>
          )}

          <Badge variant={badge.variant} className="text-xs font-medium px-2 py-0.5 shadow-sm">
            {badge.label}
          </Badge>

          {(brokenCount > 0 || suspiciousCount > 0) && (
            <Button
              size="sm"
              className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm font-medium"
              disabled={isRunning || isAiLoading || isFixing || isBatchRunning}
              onClick={() => void onRunAutoHealPack(pack.slug)}
              title="全程自动化：实时探活 ➔ L3 AI 最优匹配 ➔ 自动去重采纳平替并更新保存"
            >
              {isAiLoading || isFixing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              <span className="ml-1.5">
                {isAiLoading || isFixing ? '自动平替中…' : '一键自动平替'}
              </span>
            </Button>
          )}

          <Button
            size="sm"
            variant="secondary"
            disabled={isRunning || isAiLoading || isFixing || isBatchRunning}
            onClick={() => void onRunAudit(pack.slug)}
            className="h-8 shadow-sm"
          >
            {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
            <span className="ml-1.5">{isRunning ? '体检中…' : '抽样体检'}</span>
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => onToggleExpand(pack.slug)}
            className="h-8 text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? (
              <>
                <span>收起</span>
                <ChevronUp className="h-3.5 w-3.5 ml-1" />
              </>
            ) : (
              <>
                <span>详情</span>
                <ChevronDown className="h-3.5 w-3.5 ml-1" />
              </>
            )}
          </Button>
        </div>
      </div>

      {/* 展开的体检详情抽屉 */}
      {isExpanded && (
        <div
          className="space-y-3 rounded-lg border bg-muted/30 p-3.5 text-xs mt-2 animate-in fade-in duration-200"
          data-testid={`pack-detail-${pack.slug}`}
        >
          {/* 修复成功提示 */}
          {fixSuccess && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                {fixSuccess}
              </span>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => onDismissFixSuccess(pack.slug)}>
                知道了
              </Button>
            </div>
          )}

          {/* 单站点深度取证结果（分层证据链） */}
          {deepResult && (
            <div
              className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2"
              data-testid="deep-diagnose-panel"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 font-semibold text-primary">
                    <Microscope className="h-4 w-4" />
                    深度取证：{DEEP_VERDICT_LABELS[deepResult.diagnosis.verdict] ?? deepResult.diagnosis.verdict}
                    <Badge variant="outline" className="text-[10px] font-normal">
                      置信度 {Math.round(deepResult.diagnosis.confidence * 100)}%
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 break-all">{deepResult.diagnosis.url}</p>
                  <p className="text-xs mt-1">{deepResult.diagnosis.headline}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 shrink-0"
                  onClick={() => onCloseDeep(pack.slug)}
                  aria-label="关闭深度取证"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>

              <ul className="space-y-1">
                {deepResult.diagnosis.evidence.map((ev, index) => (
                  <li key={`${ev.layer}-${index}`} className="flex items-start gap-2 text-[11px]">
                    <span
                      className={`mt-0.5 inline-flex h-4 shrink-0 items-center rounded px-1 font-mono text-[10px] ${
                        DEEP_STATUS_CLASS[ev.status] ?? 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {DEEP_LAYER_LABELS[ev.layer] ?? ev.layer}
                    </span>
                    <span className={ev.status === 'skip' ? 'text-muted-foreground' : ''}>{ev.detail}</span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground border-t pt-1.5">
                <span>HTTP {deepResult.observed.status ?? '—'}</span>
                {/* null 时不能写「延迟 0ms」：那是「没连过」，不是「秒回」 */}
                <span>
                  {deepResult.observed.latencyMs === null
                    ? '未发起连接'
                    : `延迟 ${deepResult.observed.latencyMs}ms`}
                </span>
                <span>重定向 {deepResult.observed.redirects.length} 跳</span>
                {deepResult.observed.bodyBytes > 0 && (
                  <span>采样 {deepResult.observed.bodyBytes} 字节</span>
                )}
                <a
                  href={safeHref(deepResult.waybackUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  查看历史快照 <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              {deepResult.diagnosis.actions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {/*
                    archive 建议必须可点：它给的是「去查历史快照」这个动作，
                    渲染成不可点的徽标等于给了一个按不动的按钮，用户只能自己往上找链接。
                    其余 kind（replace/remove/manual）是待确认的处置建议，不能一键执行，保持徽标。
                  */}
                  {deepResult.diagnosis.actions.map((action) =>
                    action.kind === 'archive' ? (
                      <a
                        key={action.id}
                        href={safeHref(deepResult.waybackUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded border border-border/70 bg-background px-1.5 py-0.5 text-[10px] font-normal hover:bg-muted/40"
                      >
                        {action.label}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ) : (
                      <Badge key={action.id} variant="secondary" className="text-[10px] font-normal">
                        {action.label}
                      </Badge>
                    )
                  )}
                </div>
              )}
            </div>
          )}

          {/* 抽样指标明细 */}
          {panelState.kind === "stale" ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-amber-800 dark:text-amber-200 font-medium">
                <AlertTriangle className="h-4 w-4" />
                清单已改动（现有 {panelState.declared ?? '--'} 条），健康度待复检
              </span>
              <span className="text-[11px] text-muted-foreground">
                替换与剔除之后没有有效的测量值，系统不会用推算值填补
              </span>
            </div>
          ) : panelState.kind === "verified" || panelState.kind === "no-data" ? (
            <div className="flex flex-wrap items-center gap-3 text-muted-foreground border-b pb-2.5">
              <span>声明 {snap.declared ?? '--'} 条</span>
              <span>抽样 {snap.sampled ?? '--'} 条</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">真健康 {snap.okCount ?? 0}</span>
              {(snap.blockedCount ?? 0) > 0 && (
                <span className="text-sky-600 dark:text-sky-400" title="站点存活，只是 WAF 拒绝了爬虫，已计入可达">
                  WAF放行 {snap.blockedCount}
                </span>
              )}
              {(snap.suspiciousCount ?? 0) > 0 && (
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  疑似停放/软404 {snap.suspiciousCount}
                </span>
              )}
              <span className={brokenCount > 0 ? 'text-destructive font-semibold' : ''}>
                确认死链 {brokenCount}
              </span>
              {auditResult?.redirected ? (
                <span>重定向 {auditResult.redirected}</span>
              ) : null}
              {auditResult?.brokenByReason && reasonSummary(auditResult.brokenByReason) && (
                <span className="text-muted-foreground">（{reasonSummary(auditResult.brokenByReason)}）</span>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">该网址包尚未运行过抽样体检，请点击「抽样体检」或「一键自动平替」开始探测。</p>
          )}

          {/* 历史趋势：按需加载，stale 包不显示（它没有有效测量值） */}
          {snap && !snap.stale && (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              {/*
                三种状态必须分开，不能共用一套渲染：
                  1) 没有有效测量值 —— 画空柱图会被读成「连续 0 次体检」，要说清楚；
                  2) 有数据 —— null 点单独用中性灰，绝不能落进 rose（恶化语义）；
                  3) 还没加载 —— 给按钮。
                reachability 为 null 表示「这次没有分母」（total=0），不是「0% 可达」。
              */}
              {trend && trend.validPoints === 0 ? (
                <>
                  <span className="text-muted-foreground">
                    {trend.points.length === 0 ? '暂无体检历史' : '历史记录里没有有效测量值'}
                    {trend.skippedStale > 0 ? `（已排除 ${trend.skippedStale} 条待复检记录）` : ''}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[10px] gap-1"
                    disabled={isTrendLoading}
                    onClick={() => onLoadTrend(pack.slug)}
                    aria-label={`重新加载 ${pack.name} 的体检历史趋势`}
                  >
                    {isTrendLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <History className="h-3 w-3" />
                    )}
                    重新加载
                  </Button>
                </>
              ) : trend ? (
                <>
                  <span className="text-muted-foreground">近 {trend.validPoints} 次有效体检</span>
                  <div
                    className="flex items-end gap-0.5 h-6"
                    role="img"
                    aria-label={`可达率趋势：${TREND_META[trend.trend]?.label ?? trend.trend}，共 ${trend.validPoints} 个有效数据点`}
                  >
                    {trend.points.map((point, pointIdx) => {
                      const pct =
                        point.reachability === null ? null : Math.round(point.reachability * 100)
                      const tone =
                        pct === null
                          ? 'bg-muted-foreground/25'
                          : pct >= 90
                            ? 'bg-emerald-500'
                            : pct >= 70
                              ? 'bg-amber-400'
                              : 'bg-rose-500'
                      return (
                        <div
                          /* at 是毫秒时间戳，同毫秒两次写入会撞 key，带上下标兜底 */
                          key={`${point.at}-${pointIdx}`}
                          className={`w-1.5 rounded-sm ${tone}`}
                          style={{ height: pct === null ? '8%' : `${Math.max(8, pct)}%` }}
                          title={
                            pct === null
                              ? `${formatRelativeTime(point.at)}：本次无有效测量值`
                              : `${formatRelativeTime(point.at)}：${pct}%`
                          }
                        />
                      )
                    })}
                  </div>
                  <span className={`font-medium ${TREND_META[trend.trend]?.className ?? ''}`}>
                    {TREND_META[trend.trend]?.label ?? trend.trend}
                    {trend.validPoints >= 2
                      ? `（${trend.delta > 0 ? '+' : ''}${Math.round(trend.delta * 100)} 个百分点）`
                      : ''}
                  </span>
                  {trend.skippedStale > 0 && (
                    <span className="text-muted-foreground">已排除 {trend.skippedStale} 条待复检记录</span>
                  )}
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px] gap-1"
                  disabled={isTrendLoading}
                  onClick={() => onLoadTrend(pack.slug)}
                  aria-label={`加载 ${pack.name} 的体检历史趋势`}
                >
                  {isTrendLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <History className="h-3 w-3" />}
                  查看历史趋势
                </Button>
              )}
            </div>
          )}

          {/* 抽屉分栏 Tab 切换器（已合并相似视图，默认一屏总览风险与智能平替） */}
          {snap && (
            <div className="flex flex-wrap items-center gap-1 border-b pb-2">
              <button
                type="button"
                onClick={() => onSetTab(pack.slug, 'issues')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                  activeTab === 'issues' || activeTab === 'ai'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'hover:bg-muted text-muted-foreground'
                }`}
              >
                <Wand2 className="h-3 w-3" />
                风险与智能平替总览 ({brokenCount + suspiciousCount})
              </button>
              {brokenCount > 0 && (
                <button
                  type="button"
                  onClick={() => onSetTab(pack.slug, 'broken')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    activeTab === 'broken' ? 'bg-destructive text-destructive-foreground shadow-sm' : 'hover:bg-muted text-destructive'
                  }`}
                >
                  仅看死链 ({brokenCount})
                </button>
              )}
              {suspiciousCount > 0 && (
                <button
                  type="button"
                  onClick={() => onSetTab(pack.slug, 'suspicious')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    activeTab === 'suspicious' ? 'bg-amber-500 text-white shadow-sm' : 'hover:bg-muted text-amber-600'
                  }`}
                >
                  仅看停放 ({suspiciousCount})
                </button>
              )}
              {(snap.blockedCount ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => onSetTab(pack.slug, 'blocked')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    activeTab === 'blocked' ? 'bg-sky-500 text-white shadow-sm' : 'hover:bg-muted text-sky-600'
                  }`}
                >
                  WAF放行 ({snap.blockedCount})
                </button>
              )}
            </div>
          )}

          {/* 若当前会话尚未拉取实时探活明细（仅有历史快照）时展示实时体检导引 */}
          {!auditResult && (
            <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 p-4 text-center space-y-2.5">
              <div className="text-xs text-muted-foreground leading-relaxed">
                {snap?.auditedAt ? (
                  <span>
                    当前展示最近一次历史体检汇总快照（记录于 {formatRelativeTime(snap.auditedAt)}）。可点击下方按钮一键完成「实时探活 + L3 AI 最优匹配 + 自动去重采纳平替」。
                  </span>
                ) : (
                  <span>该插件包暂未执行过 URL 可达性体检，建议立即进行抽样探测与自动自愈。</span>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {(brokenCount > 0 || suspiciousCount > 0) && (
                  <Button
                    size="sm"
                    disabled={isRunning || isAiLoading || isFixing || isBatchRunning}
                    onClick={() => void onRunAutoHealPack(pack.slug)}
                    className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm font-medium"
                  >
                    {isAiLoading || isFixing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    ) : (
                      <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    傻瓜式一键体检并自动平替自愈
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={brokenCount > 0 || suspiciousCount > 0 ? 'outline' : 'default'}
                  disabled={isRunning || isAiLoading || isFixing || isBatchRunning}
                  onClick={() => void onRunAudit(pack.slug)}
                  className="h-8 shadow-sm"
                >
                  {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <PlayCircle className="h-3.5 w-3.5 mr-1.5" />}
                  立即执行实时体检
                </Button>
              </div>
            </div>
          )}

          {/* 实时体检全绿时的空状态提示（stale 包不适用：它不是「没问题」，而是「还没测」） */}
          {auditResult &&
            !auditResult.stale &&
            auditResult.brokenItems.length === 0 &&
            (!auditResult.suspiciousItems || auditResult.suspiciousItems.length === 0) &&
            (activeTab === 'issues' || activeTab === 'broken' || activeTab === 'suspicious') && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 text-center space-y-1">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 mx-auto" />
                <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                  未发现失效死链或疑似停放站点
                </div>
                <div className="text-[11px] text-muted-foreground">
                  抽样 {auditResult.sampled} 条中未检出失效死链或疑似停放站点，无需修复。
                </div>
              </div>
            )}

          {/* Tab 1: 风险汇总或全部死链与疑似停放 */}
          {(activeTab === 'issues' || activeTab === 'suspicious') &&
            auditResult?.suspiciousItems &&
            auditResult.suspiciousItems.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" />
                    L2 内容级防劫持告警（疑似停放/软 404/低信息熵空壳页）
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    共检出 {auditResult.suspiciousItems.length} 处
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {auditResult.suspiciousItems.map((item) => (
                    <li key={item.url} className="rounded bg-background/80 p-2.5 border border-amber-500/20 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <a
                            href={safeHref(item.url)}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-amber-900 dark:text-amber-200 hover:underline flex items-center gap-1 break-all"
                          >
                            {item.title ? `${item.title} — ` : ''}
                            {item.url}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <CopyButton text={item.url} />
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <LatencyBadge ms={item.latencyMs} />
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/40">
                            HTTP {item.status ?? 200}
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-1.5 text-[10px] gap-1"
                            disabled={deepLoadingUrl === item.url}
                            onClick={() => onDeepDiagnose(pack.slug, item.url)}
                            aria-label={`深度取证：${item.url}`}
                          >
                            {deepLoadingUrl === item.url ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Microscope className="h-3 w-3" />
                            )}
                            深检
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                        <span>原因：{item.reason}</span>
                        {item.shannonEntropy !== undefined && <span>Shannon 熵：{item.shannonEntropy}</span>}
                        {item.matchedKeywords && item.matchedKeywords.length > 0 && (
                          <span>命中黑词：[{item.matchedKeywords.join(', ')}]</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {/* 确认死链明细与一键无弹窗直通修复按钮 */}
          {(activeTab === 'issues' || activeTab === 'broken') &&
            auditResult?.brokenItems &&
            auditResult.brokenItems.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-destructive flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4" />
                    确认不可达死链清单（共 {auditResult.brokenItems.length} 条）
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                      disabled={isFixing || isAiLoading}
                      onClick={() => void onRunAutoHealPack(pack.slug)}
                    >
                      {isFixing || isAiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                      <span className="ml-1">一键最优平替</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs shadow-sm"
                      disabled={isFixing || isAiLoading}
                      onClick={() => {
                        const urls = auditResult.brokenItems.map((i) => i.url)
                        void onApplyHealthFix(pack.slug, urls)
                      }}
                    >
                      {isFixing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      <span className="ml-1">一键净网剔除死链</span>
                    </Button>
                  </div>
                </div>
                <ul className="space-y-1">
                  {auditResult.brokenItems.map((item) => (
                    <li key={item.url} className="flex items-start justify-between gap-2 rounded bg-background/80 p-2 border border-destructive/20">
                      <div className="flex items-center gap-1 min-w-0">
                        <code className="break-all text-destructive font-mono text-[11px]">{item.url}</code>
                        <CopyButton text={item.url} />
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 text-muted-foreground text-[11px]">
                        <LatencyBadge ms={item.latencyMs} />
                        <span>
                          {item.failureKind ? REASON_LABELS[item.failureKind] ?? item.failureKind : '网络异常'}
                          {item.status ? ` (HTTP ${item.status})` : ''}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-1.5 text-[10px] gap-1"
                          disabled={deepLoadingUrl === item.url}
                          onClick={() => onDeepDiagnose(pack.slug, item.url)}
                          aria-label={`深度取证：${item.url}`}
                        >
                          {deepLoadingUrl === item.url ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Microscope className="h-3 w-3" />
                          )}
                          深检
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {/* WAF 放行明细 */}
          {activeTab === 'blocked' && auditResult?.blockedItems && auditResult.blockedItems.length > 0 && (
            <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-3 space-y-2">
              <span className="font-semibold text-sky-700 dark:text-sky-300 flex items-center gap-1.5">
                <Globe className="h-4 w-4" />
                受 WAF 反爬保护放行条目（共 {auditResult.blockedItems.length} 条）
              </span>
              <ul className="space-y-1">
                {auditResult.blockedItems.map((item) => (
                  <li key={item.url} className="flex items-center justify-between gap-2 text-[11px] rounded bg-background/80 p-2 border border-sky-500/20">
                    <div className="flex items-center gap-1 min-w-0">
                      <code className="break-all">{item.url}</code>
                      <CopyButton text={item.url} />
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <LatencyBadge ms={item.latencyMs} />
                      <Badge variant="outline" className="text-[10px] text-sky-600 border-sky-500/30">
                        {item.status ? `HTTP ${item.status}` : '被拦截'}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* AI 深度自愈与平替推荐区（全程无弹窗自动化） */}
          {(() => {
            const usedPreviewUrls = new Set<string>()
            const isAllResolved = Boolean(
              aiHeal?.diagnoses &&
                aiHeal.diagnoses.length > 0 &&
                aiHeal.diagnoses.every((d) => d.resolved),
            )
            const topReplacements = aiHeal?.diagnoses
              ? aiHeal.diagnoses
                  .filter((d) => !d.resolved && d.suggestedReplacements && d.suggestedReplacements.length > 0)
                  .map((d) => {
                    const top =
                      d.suggestedReplacements.find((r) => !usedPreviewUrls.has(r.url.trim().toLowerCase())) ||
                      d.suggestedReplacements[0]
                    usedPreviewUrls.add(top.url.trim().toLowerCase())
                    return {
                      oldUrl: d.url,
                      newUrl: top.url,
                      newTitle: top.title,
                      reason: top.reason,
                      tag: top.tag,
                      qualityScore: top.qualityScore,
                      verified: top.verified,
                      latencyMs: top.latencyMs,
                    }
                  })
              : []

            return (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3.5 space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="font-semibold text-primary flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4" />
                      L3 后端 AI 模型平替与时光机自愈引擎
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      结合大模型深度推理、7大垂类权威标杆站点库与 200 OK 实时探活，一键全自动采纳所有最优平替并持久化更新清单。
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {isAllResolved ? (
                      <Button
                        size="sm"
                        disabled
                        className="h-8 bg-emerald-600/80 text-white shadow-sm font-medium cursor-default"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        <span>全部受损站点已自愈完毕</span>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm font-medium"
                        disabled={
                          isFixing ||
                          isAiLoading ||
                          (brokenCount === 0 && suspiciousCount === 0 && topReplacements.length === 0)
                        }
                        onClick={() => {
                          if (topReplacements.length > 0) {
                            void onExecuteBatchReplacement(
                              pack.slug,
                              topReplacements.map((i) => ({
                                oldUrl: i.oldUrl,
                                newUrl: i.newUrl,
                                newTitle: i.newTitle,
                              })),
                            )
                          } else {
                            void onRunAutoHealPack(pack.slug)
                          }
                        }}
                      >
                        {isFixing || isAiLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1 text-emerald-100" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5 mr-1 text-emerald-100" />
                        )}
                        <span>
                          {topReplacements.length > 0
                            ? `傻瓜式一键采纳所有最优平替 (${topReplacements.length})`
                            : '傻瓜式一键全自动平替自愈'}
                        </span>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 border-primary/30 text-primary hover:bg-primary/10 shadow-sm"
                      disabled={isAiLoading || isFixing || (brokenCount === 0 && suspiciousCount === 0)}
                      onClick={() => void onRunAiHeal(pack.slug)}
                    >
                      {isAiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                      <span className="ml-1.5">{isAiLoading ? 'AI 诊断研判中…' : '仅预览平替候选'}</span>
                    </Button>
                  </div>
                </div>

                {aiHeal && (
                  <div className="space-y-3 pt-2 border-t border-primary/10">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="font-medium text-primary">诊断模型：{aiHeal.model}</span>
                      <div className="flex items-center gap-1.5">
                        {aiHeal.autoApplied &&
                          (aiHeal.autoApplied.applied === false ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] text-amber-600 border-amber-500/40 bg-amber-500/10"
                              title={aiHeal.autoApplied.detail}
                            >
                              未应用：{AUTO_APPLY_REASON_LABELS[aiHeal.autoApplied.reason ?? ''] ?? '未说明'}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[10px] text-emerald-600 border-emerald-500/40 bg-emerald-500/10"
                            >
                              已自动平替 {aiHeal.autoApplied.replacedCount} 条 · 清理 {aiHeal.autoApplied.removedCount} 条
                            </Badge>
                          ))}
                        {aiHeal.aiDegraded && (
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/40">
                            {aiHeal.aiDegraded === 'quota' ? '垂类权威标杆兜底' : aiHeal.aiDegraded === 'unconfigured' ? '垂类标杆引擎' : '智能兜底模式'}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {aiHeal.overview && (
                      <div className="rounded bg-background/90 p-3 text-[11px] text-foreground leading-relaxed border whitespace-pre-line shadow-sm">
                        {aiHeal.overview}
                      </div>
                    )}

                    {/*
                      被后端拒绝处理的 URL 必须露面。
                      旧实现把 ignoredUrls 收进类型就再没用过：调用方传了不属于本包的网址，
                      界面上什么提示都没有，只能看到「AI 说没问题」——比报错更误导。
                    */}
                    {aiHeal.ignoredUrls && aiHeal.ignoredUrls.length > 0 && (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-800 dark:text-amber-200 space-y-1">
                        <span className="flex items-center gap-1.5 font-medium">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          有 {aiHeal.ignoredUrls.length} 条网址不属于本包，已跳过诊断
                        </span>
                        <ul className="list-disc pl-5 space-y-0.5 break-all">
                          {aiHeal.ignoredUrls.slice(0, 5).map((ignored) => (
                            <li key={ignored}>
                              <code className="font-mono">{ignored}</code>
                            </li>
                          ))}
                          {aiHeal.ignoredUrls.length > 5 && <li>等共 {aiHeal.ignoredUrls.length} 条</li>}
                        </ul>
                      </div>
                    )}

                    {aiHeal.diagnoses && aiHeal.diagnoses.length > 0 && (
                      <div className="space-y-2">
                        <span className="font-semibold text-xs text-foreground">受损网址拯救方案：</span>
                        <div className="space-y-3">
                          {aiHeal.diagnoses.map((diag) => (
                            <div key={diag.url} className={`rounded-md border p-3 space-y-3 shadow-sm transition-colors ${diag.resolved ? 'bg-muted/20 border-emerald-500/30' : 'bg-background'}`}>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  {diag.resolved ? (
                                    <Badge className="text-[10px] shrink-0 bg-emerald-600 text-white font-medium flex items-center gap-1">
                                      <Check className="h-2.5 w-2.5" /> 已自愈平替
                                    </Badge>
                                  ) : (
                                    <Badge variant={diag.kind === 'suspicious' ? 'secondary' : 'destructive'} className="text-[10px] shrink-0">
                                      {diag.kind === 'suspicious' ? '疑似停放' : '死链'}
                                    </Badge>
                                  )}
                                  <span className={`font-semibold text-xs truncate ${diag.resolved ? 'line-through text-muted-foreground' : ''}`}>{diag.title}</span>
                                  <code className={`text-[10px] truncate ${diag.resolved ? 'line-through text-muted-foreground/60' : 'text-muted-foreground'}`}>{diag.url}</code>
                                  <CopyButton text={diag.url} />
                                  {diag.evidence?.source === 'client-claimed' && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] shrink-0 text-amber-600 border-amber-500/40"
                                      title="该 URL 由调用方提供，本轮没有实测证据；诊断原因是「未验证」，不是实测结论"
                                    >
                                      结论未实测
                                    </Badge>
                                  )}
                                  {diag.evidence?.source === 'live-probe' && diag.evidence.failureKind && (
                                    <span className="text-[10px] text-muted-foreground shrink-0">
                                      实测：{REASON_LABELS[diag.evidence.failureKind] ?? diag.evidence.failureKind}
                                      {diag.evidence.status ? ` (HTTP ${diag.evidence.status})` : ''}
                                    </span>
                                  )}
                                </div>
                                <a
                                  href={diag.waybackUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-primary hover:underline flex items-center gap-1 font-medium shrink-0"
                                >
                                  <History className="h-3.5 w-3.5" />
                                  时光机历史快照 ↗
                                </a>
                              </div>

                              {/* 推荐高质量平替候选 */}
                              {diag.suggestedReplacements && diag.suggestedReplacements.length > 0 && (
                                <div className="rounded-md bg-muted/40 p-3 space-y-2 border border-border/50">
                                  <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                                    <span className="flex items-center gap-1.5">
                                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                                      精选高可用平替候选（已自动探活筛选与质检评分，点击即刻替换）：
                                    </span>
                                  </div>
                                  <ul className="space-y-2 text-[11px]">
                                    {diag.suggestedReplacements.map((rep, repIdx) => (
                                      // 可信度分解挂在行上，而不是只挂在「质量分」徽标上：
                                      // 徽标只有 qualityScore 是数字时才渲染，AI 直接给出的候选
                                      // 往往没有质量分，那样刚算出来的可信度就没人看得见。
                                      <li
                                        key={rep.url}
                                        title={
                                          rep.confidence
                                            ? `合成可信度：可达性 ${rep.confidence.reachability} × 0.5 + 内容健康 ${rep.confidence.contentHealth} × 0.3 + 领域匹配 ${rep.confidence.domainFit} × 0.2 = ${rep.confidence.total}`
                                            : undefined
                                        }
                                        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-lg bg-background p-2.5 border shadow-2xs transition-colors ${
                                          repIdx === 0
                                            ? 'border-emerald-500/40 bg-emerald-500/[0.03]'
                                            : 'border-border/60 hover:border-primary/40'
                                        }`}
                                      >
                                        <div className="space-y-1.5 min-w-0 flex-1">
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            {repIdx === 0 && (
                                              <Badge className="text-[10px] bg-emerald-600 hover:bg-emerald-600 text-white py-0 px-1.5">
                                                最优首选
                                              </Badge>
                                            )}
                                            <span className="font-semibold text-xs text-foreground">{rep.title}</span>
                                            {rep.tag && (
                                              <Badge
                                                variant="outline"
                                                className="text-[10px] font-medium border-primary/30 text-primary bg-primary/10 py-0"
                                              >
                                                {rep.tag}
                                              </Badge>
                                            )}
                                            {typeof rep.qualityScore === 'number' && (
                                              <Badge
                                                variant="outline"
                                                className="text-[10px] font-bold border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 py-0"
                                                title={
                                                  rep.confidence
                                                    ? `合成可信度：可达性 ${rep.confidence.reachability} × 0.5 + 内容健康 ${rep.confidence.contentHealth} × 0.3 + 领域匹配 ${rep.confidence.domainFit} × 0.2`
                                                    : undefined
                                                }
                                              >
                                                <Sparkles className="h-2.5 w-2.5 mr-0.5 inline text-emerald-500" />
                                                {rep.qualityScore}分 {rep.qualityScore >= 95 ? '卓越' : '优质'}
                                              </Badge>
                                            )}
                                            {rep.grade && CANDIDATE_GRADE_META[rep.grade] ? (
                                              <Badge
                                                variant="outline"
                                                className={`text-[10px] py-0 ${CANDIDATE_GRADE_META[rep.grade].className}`}
                                                title={rep.gradeReason}
                                              >
                                                {CANDIDATE_GRADE_META[rep.grade].label}
                                                {rep.latencyMs ? ` · ${rep.latencyMs}ms` : ''}
                                              </Badge>
                                            ) : rep.verified === false ? (
                                              <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                                待复测
                                              </span>
                                            ) : null}
                                            {rep.source && (
                                              <span className="text-[10px] text-muted-foreground/80 font-mono">
                                                [{rep.source === 'ai' ? '大模型精选' : rep.source === 'catalog' ? '垂类权威标杆' : '类目匹配'}]
                                              </span>
                                            )}
                                          </div>

                                          <div className="flex items-center gap-2">
                                            <a
                                              href={safeHref(rep.url)}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-[11px] font-mono text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 hover:underline break-all"
                                              title="在新标签页测试访问此平替网址"
                                            >
                                              <span>{rep.url}</span>
                                              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                            </a>
                                            <CopyButton text={rep.url} />
                                          </div>

                                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                                            <span className="font-medium text-foreground/80">推荐理由：</span>
                                            {rep.reason}
                                          </p>
                                        </div>

                                        <div className="shrink-0 flex sm:flex-col items-end justify-between gap-1 pt-1 sm:pt-0 border-t sm:border-t-0 border-border/30">
                                          {diag.resolved ? (
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              disabled
                                              className="h-7 text-xs text-emerald-600 dark:text-emerald-400 font-medium cursor-default"
                                            >
                                              <Check className="h-3 w-3 mr-1" />
                                              已采纳
                                            </Button>
                                          ) : (
                                            <Button
                                              size="sm"
                                              variant={repIdx === 0 ? 'default' : 'secondary'}
                                              disabled={isFixing}
                                              className={
                                                repIdx === 0
                                                  ? 'h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs font-medium'
                                                  : 'h-7 text-xs text-primary hover:bg-primary/10 shadow-2xs font-medium'
                                              }
                                              onClick={() => {
                                                void onExecuteReplacement(pack.slug, diag.url, rep.url, rep.title)
                                              }}
                                            >
                                              <ArrowRightLeft className="h-3 w-3 mr-1" />
                                              采纳平替
                                            </Button>
                                          )}
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {auditResult?.caveat && (
            <p className="text-[11px] text-muted-foreground border-t pt-2">{auditResult.caveat}</p>
          )}
        </div>
      )}
    </li>
  )
})

export function PluginUrlHealthPanel() {
  const [packs, setPacks] = useState<SitePackListItem[]>([])
  const [history, setHistory] = useState<Record<string, HistoricalSummary>>({})
  const [results, setResults] = useState<Record<string, AuditResult>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 抽样深度选项（15条快速 / 30条标准 / 100条全量）
  const [sampleLimit, setSampleLimit] = useState<number>(30)

  // 单包运行状态
  const [runningSingle, setRunningSingle] = useState<string | null>(null)

  // 批量队列运行状态
  const [batchState, setBatchState] = useState<{
    isRunning: boolean
    currentSlug: string | null
    completed: number
    total: number
    mode?: 'audit' | 'auto-heal'
  }>({
    isRunning: false,
    currentSlug: null,
    completed: 0,
    total: 0,
    mode: 'audit',
  })
  const cancelBatchRef = useRef(false)

  // 批量执行结束的通知条状态
  const [batchCompleteNotice, setBatchCompleteNotice] = useState<string | null>(null)

  // 展开抽屉
  const [expandedPacks, setExpandedPacks] = useState<Set<string>>(new Set())

  // 各包详情抽屉内的激活 Tab
  const [packTabs, setPackTabs] = useState<Record<string, 'issues' | 'broken' | 'suspicious' | 'blocked' | 'ai'>>({})

  // 多选选中的包集合
  const [selectedPacks, setSelectedPacks] = useState<Set<string>>(new Set())

  // AI 智能诊断自愈与净网修复状态
  const [aiHealResults, setAiHealResults] = useState<Record<string, AiHealResult>>({})
  const [aiLoadingPacks, setAiLoadingPacks] = useState<Record<string, boolean>>({})
  const [fixingPacks, setFixingPacks] = useState<Record<string, boolean>>({})
  const [fixSuccessPacks, setFixSuccessPacks] = useState<Record<string, string>>({})

  // 单站点深度取证（按需触发，不做首屏预载）
  const [deepResults, setDeepResults] = useState<Record<string, DeepDiagnoseResult>>({})
  const [deepLoading, setDeepLoading] = useState<{ slug: string; url: string } | null>(null)

  // 体检历史趋势（同样按需加载：50 个包各查一次会把「秒开」变成「转圈」）
  const [trendResults, setTrendResults] = useState<Record<string, HealthTrendResult>>({})
  const [trendLoading, setTrendLoading] = useState<string | null>(null)

  // 筛选、搜索与排序
  const [filter, setFilter] = useState<'all' | 'issues' | 'healthy' | 'untested'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const deferredSearch = useDeferredValue(searchTerm)
  const [sortBy, setSortBy] = useState<'default' | 'reachability_asc' | 'broken_desc' | 'name'>('default')

  // 分页状态（默认 20 条，减轻 DOM 压力）
  const [pageSize, setPageSize] = useState<number>(20)
  const [currentPage, setCurrentPage] = useState<number>(1)

  // 搜索框 DOM 引用（供快捷键聚焦）
  const searchInputRef = useRef<HTMLInputElement>(null)

  // 快捷键支持（'/' 键聚焦搜索，'Escape' 键清除）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchInputRef.current && !['INPUT', 'TEXTAREA'].includes((document.activeElement as HTMLElement)?.tagName)) {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === 'Escape') {
        if (searchTerm) setSearchTerm('')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [searchTerm])

  // 当搜索、过滤或页大小时，重置当前页码
  useEffect(() => {
    setCurrentPage(1)
  }, [filter, deferredSearch, sortBy, pageSize])

  // 加载列表与批量历史快照
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pluginsRes, summaryRes] = await Promise.allSettled([
        hubGet<{ items: SitePackListItem[] }>('/plugins?kind=site-pack&limit=200'),
        hubGet<{ summaries: Record<string, HistoricalSummary> }>('/plugins/url-health/summary'),
      ])

      if (pluginsRes.status === 'fulfilled') {
        setPacks(pluginsRes.value.items ?? [])
      } else {
        throw new Error('加载网址包列表失败')
      }

      if (summaryRes.status === 'fulfilled' && summaryRes.value.summaries) {
        setHistory(summaryRes.value.summaries)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '初始化体检数据失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // 将已平替或剔除的网址在本地状态中即时标记为已修复（秒级反馈，无需再次等待全量重扫）
  /**
   * 治愈后的本地状态收敛：**标记待复检，不推算健康度**。
   *
   * 旧实现把 `replacedCount` 直接加到 `okCount` 上并重算 `reachability` ——
   * 但替换目标从未被探活，那个百分比是算出来的，不是测出来的。
   * 这里保留「已采纳平替」的记录（诊断条目仍标 resolved），但把所有健康计数清空，
   * 徽标转为「待复检」，由用户点一次真实体检拿回数字。
   */
  const markPackUrlsHealed = useCallback(
    (slug: string, healedUrls: string[], _replacedCount: number, removedCount: number, remainingSites?: number) => {
      const healedSet = new Set(healedUrls.map((u) => u.trim().toLowerCase()))
      setResults((prev) => {
        const cur = prev[slug]
        if (!cur) return prev
        return {
          ...prev,
          [slug]: {
            ...cur,
            stale: true,
            declared: remainingSites ?? Math.max(1, (cur.declared || 0) - removedCount),
            sampled: 0,
            okCount: 0,
            blockedCount: 0,
            suspiciousCount: 0,
            brokenCount: 0,
            redirected: 0,
            brokenItems: [],
            suspiciousItems: [],
            blockedItems: [],
            brokenByReason: undefined,
            reachability: null,
          },
        }
      })
      setHistory((prev) => ({
        ...prev,
        [slug]: {
          auditedAt: null,
          stale: true,
          healedAt: Date.now(),
          declared: remainingSites ?? prev[slug]?.declared ?? null,
          sampled: null,
          okCount: null,
          blockedCount: null,
          suspiciousCount: null,
          brokenCount: null,
          reachability: null,
        },
      }))
      setAiHealResults((prev) => {
        const cur = prev[slug]
        if (!cur || !cur.diagnoses) return prev
        return {
          ...prev,
          [slug]: {
            ...cur,
            diagnoses: cur.diagnoses.map((d) =>
              healedSet.has(d.url.trim().toLowerCase()) ? { ...d, resolved: true } : d,
            ),
          },
        }
      })
      /**
       * 清单被改写后，旧的深检证据与趋势缓存立刻过期。
       *
       * 不清理会出现本功能最自相矛盾的一种界面：横幅写着「健康度待复检（没有有效测量值）」，
       * 下面却挂着修复前那份「确认不可达」的六层证据，旁边还是修复前的趋势柱——
       * 用户没法判断眼前这些结论说的是旧 URL 还是新 URL。
       */
      setDeepResults((prev) => {
        if (!(slug in prev)) return prev
        const next = { ...prev }
        delete next[slug]
        return next
      })
      setTrendResults((prev) => {
        if (!(slug in prev)) return prev
        const next = { ...prev }
        delete next[slug]
        return next
      })
    },
    [],
  )

  // 单包抽样体检
  const runAudit = useCallback(
    async (slug: string) => {
      setRunningSingle(slug)
      setError(null)
      try {
        const res = await hubSend<AuditResult>(`/plugins/${encodeURIComponent(slug)}/audit`, 'POST', {
          limit: sampleLimit,
          timeoutMs: 4000,
        })
        startTransition(() => {
          setResults((prev) => ({ ...prev, [slug]: res }))
          setHistory((prev) => ({
            ...prev,
            [slug]: {
              auditedAt: Date.now(),
              declared: res.declared,
              sampled: res.sampled,
              okCount: res.okCount,
              blockedCount: res.blockedCount,
              suspiciousCount: res.suspiciousCount ?? 0,
              brokenCount: res.brokenCount,
              reachability: res.reachability,
            },
          }))
          setExpandedPacks((prev) => new Set(prev).add(slug))
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : `体检失败：${slug}`)
      } finally {
        setRunningSingle(null)
      }
    },
    [sampleLimit],
  )

  /**
   * 单站点深度取证。
   *
   * 与「抽样体检」的区别：体检是一次性把 30 条的结论压成一个百分比，
   * 深检是把某一条拆成 URL/DNS/重定向/HTTP/内容/归档六层证据。
   * 因此它按需触发（点一次查一条），不做列表预载。
   */
  const runDeepDiagnose = useCallback(async (slug: string, url: string) => {
    setDeepLoading({ slug, url })
    setError(null)
    try {
      const res = await hubSend<DeepDiagnoseResult>(`/plugins/${encodeURIComponent(slug)}/url-deep-diagnose`, 'POST', {
        url,
      })
      startTransition(() => {
        setDeepResults((prev) => ({ ...prev, [slug]: res }))
        setExpandedPacks((prev) => new Set(prev).add(slug))
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : `深度取证失败：${slug}`)
    } finally {
      setDeepLoading(null)
    }
  }, [])

  /** 加载某包的历史趋势（最多取 12 次体检，足够看方向） */
  const loadTrend = useCallback(async (slug: string) => {
    setTrendLoading(slug)
    // 与其他操作一致：先清掉上一条错误，否则「重试成功」后旧报错还挂在页面上
    setError(null)
    try {
      const res = await hubGet<HealthTrendResult>(
        `/plugins/${encodeURIComponent(slug)}/url-health/history?limit=12`,
      )
      startTransition(() => {
        setTrendResults((prev) => ({ ...prev, [slug]: res }))
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : `历史趋势加载失败：${slug}`)
    } finally {
      setTrendLoading(null)
    }
  }, [])

  // 批量一键体检编排器
  const startBatchAudit = useCallback(
    async (targets: SitePackListItem[]) => {
      if (targets.length === 0) return
      cancelBatchRef.current = false
      setBatchCompleteNotice(null)
      setBatchState({
        isRunning: true,
        currentSlug: targets[0].slug,
        completed: 0,
        total: targets.length,
        mode: 'audit',
      })

      let foundBroken = 0
      let foundSuspicious = 0

      for (let i = 0; i < targets.length; i++) {
        if (cancelBatchRef.current) break
        const pack = targets[i]
        startTransition(() => {
          setBatchState((prev) => ({ ...prev, currentSlug: pack.slug, completed: i, mode: 'audit' }))
        })

        try {
          const res = await hubSend<AuditResult>(`/plugins/${encodeURIComponent(pack.slug)}/audit`, 'POST', {
            limit: sampleLimit,
            timeoutMs: 4000,
          })
          startTransition(() => {
            setResults((prev) => ({ ...prev, [pack.slug]: res }))
            setHistory((prev) => ({
              ...prev,
              [pack.slug]: {
                auditedAt: Date.now(),
                declared: res.declared,
                sampled: res.sampled,
                okCount: res.okCount,
                blockedCount: res.blockedCount,
                suspiciousCount: res.suspiciousCount ?? 0,
                brokenCount: res.brokenCount,
                reachability: res.reachability,
              },
            }))
          })
          foundBroken += res.brokenCount || 0
          foundSuspicious += res.suspiciousCount || 0
        } catch {
          // 单包失败不打断整批队列
        }
      }

      setBatchState({
        isRunning: false,
        currentSlug: null,
        completed: targets.length,
        total: targets.length,
        mode: 'audit',
      })

      if (!cancelBatchRef.current) {
        setBatchCompleteNotice(
          `本轮批量体检顺利完成！共扫描 ${targets.length} 个网址包，共检出 ${foundBroken} 条确认死链与 ${foundSuspicious} 处疑似劫持停放。`,
        )
      }
    },
    [sampleLimit],
  )

  // 傻瓜式批量全自动「探活 ➔ AI 匹配高质平替 ➔ 自动采纳保存」编排器
  const startBatchAutoHeal = useCallback(
    async (targets: SitePackListItem[]) => {
      if (targets.length === 0) return
      cancelBatchRef.current = false
      setBatchCompleteNotice(null)
      setBatchState({
        isRunning: true,
        currentSlug: targets[0].slug,
        completed: 0,
        total: targets.length,
        mode: 'auto-heal',
      })

      let totalReplaced = 0
      let totalRemoved = 0
      let healedPackCount = 0

      for (let i = 0; i < targets.length; i++) {
        if (cancelBatchRef.current) break
        const pack = targets[i]
        startTransition(() => {
          setBatchState((prev) => ({ ...prev, currentSlug: pack.slug, completed: i, mode: 'auto-heal' }))
        })

        try {
          let activeRes = results[pack.slug]
          if (!activeRes) {
            activeRes = await hubSend<AuditResult>(`/plugins/${encodeURIComponent(pack.slug)}/audit`, 'POST', {
              limit: sampleLimit,
              timeoutMs: 4000,
            })
            startTransition(() => {
              setResults((prev) => ({ ...prev, [pack.slug]: activeRes! }))
              setHistory((prev) => ({
                ...prev,
                [pack.slug]: {
                  auditedAt: Date.now(),
                  declared: activeRes!.declared,
                  sampled: activeRes!.sampled,
                  okCount: activeRes!.okCount,
                  blockedCount: activeRes!.blockedCount,
                  suspiciousCount: activeRes!.suspiciousCount ?? 0,
                  brokenCount: activeRes!.brokenCount,
                  reachability: activeRes!.reachability,
                },
              }))
            })
          }

          const brokenUrls = activeRes?.brokenItems?.map((item) => item.url) || []
          const suspiciousUrls = activeRes?.suspiciousItems?.map((item) => item.url) || []
          if (brokenUrls.length === 0 && suspiciousUrls.length === 0) continue

          const healRes = await hubSend<AiHealResult>(`/plugins/${encodeURIComponent(pack.slug)}/ai-heal`, 'POST', {
            brokenUrls,
            suspiciousUrls,
            autoApply: true,
          })
          startTransition(() => {
            setAiHealResults((prev) => ({ ...prev, [pack.slug]: healRes }))
          })

          if (healRes.autoApplied && (healRes.autoApplied.replacedCount > 0 || healRes.autoApplied.removedCount > 0)) {
            totalReplaced += healRes.autoApplied.replacedCount
            totalRemoved += healRes.autoApplied.removedCount
            healedPackCount++
            const names = healRes.autoApplied.items.slice(0, 3).map((it) => it.newTitle).join('、')
            markPackUrlsHealed(
              pack.slug,
              /*
                只标记后端实际处理过的 URL。按 [...brokenUrls, ...suspiciousUrls] 标记
                会把「没找到合格候选、仍留在清单里」的死链也标成已解决——界面上一片
                「已修复」，实际死链还在。
              */
              appliedUrlsOf(healRes.autoApplied),
              healRes.autoApplied.replacedCount,
              healRes.autoApplied.removedCount,
              healRes.autoApplied.remainingSites,
            )
            setFixSuccessPacks((prev) => ({
              ...prev,
              [pack.slug]: `⚡ 全自动平替完成：已自动采纳 ${healRes.autoApplied!.replacedCount} 处高分平替${names ? `（${names}等）` : ''}${healRes.autoApplied!.removedCount > 0 ? `，清理 ${healRes.autoApplied!.removedCount} 条死链` : ''}！`,
            }))
          } else if (healRes.diagnoses && healRes.diagnoses.length > 0) {
            const usedUrls = new Set<string>()
            const replacements: Array<{ oldUrl: string; newUrl: string; newTitle: string }> = []
            const removeUrls: string[] = []
            for (const d of healRes.diagnoses) {
              const best =
                d.suggestedReplacements?.find((r) => !usedUrls.has(r.url.toLowerCase())) ||
                d.suggestedReplacements?.[0]
              if (best && best.url) {
                usedUrls.add(best.url.toLowerCase())
                replacements.push({ oldUrl: d.url, newUrl: best.url, newTitle: best.title })
              } else if (d.kind === 'broken') {
                removeUrls.push(d.url)
              }
            }
            if (replacements.length > 0 || removeUrls.length > 0) {
              const fixRes = await hubSend<{
                ok: boolean
                replacedCount: number
                removedCount: number
                remainingSites: number
              }>(`/plugins/${encodeURIComponent(pack.slug)}/apply-health-fix`, 'POST', {
                replaceUrls: replacements,
                removeUrls,
              })
              totalReplaced += fixRes.replacedCount
              totalRemoved += fixRes.removedCount
              healedPackCount++
              markPackUrlsHealed(
                pack.slug,
                [...replacements.map((r) => r.oldUrl), ...removeUrls],
                fixRes.replacedCount,
                fixRes.removedCount,
                fixRes.remainingSites,
              )
              const names = replacements.slice(0, 3).map((r) => r.newTitle).join('、')
              setFixSuccessPacks((prev) => ({
                ...prev,
                [pack.slug]: `⚡ 全自动平替完成：已自动采纳 ${fixRes.replacedCount} 处高分平替${names ? `（${names}等）` : ''}${fixRes.removedCount > 0 ? `，清理 ${fixRes.removedCount} 条死链` : ''}！`,
              }))
            }
          }
        } catch {
          // 单包失败不打断整批全自动队列
        }
      }

      setBatchState({
        isRunning: false,
        currentSlug: null,
        completed: targets.length,
        total: targets.length,
        mode: 'auto-heal',
      })

      if (!cancelBatchRef.current) {
        setBatchCompleteNotice(
          healedPackCount > 0
            ? `⚡ 傻瓜式全自动体检与平替圆满完成！共扫描 ${targets.length} 个网址包，自动治愈 ${healedPackCount} 个异常包（采纳最优平替 ${totalReplaced} 处、净网剔除死链 ${totalRemoved} 条）。`
            : `🎉 全自动巡检完成！共扫描 ${targets.length} 个网址包，全部处于健康可达状态，无需平替。`,
        )
      }
    },
    [results, sampleLimit, markPackUrlsHealed],
  )

  const stopBatch = useCallback(() => {
    cancelBatchRef.current = true
    setBatchState((prev) => ({ ...prev, isRunning: false, currentSlug: null }))
  }, [])

  // AI 智能诊断自愈（仅生成/预览方案）
  const runAiHeal = useCallback(
    async (slug: string) => {
      setAiLoadingPacks((prev) => ({ ...prev, [slug]: true }))
      setError(null)
      try {
        let activeRes = results[slug]
        if (!activeRes) {
          activeRes = await hubSend<AuditResult>(`/plugins/${encodeURIComponent(slug)}/audit`, 'POST', {
            limit: sampleLimit,
            timeoutMs: 4000,
          })
          startTransition(() => {
            setResults((prev) => ({ ...prev, [slug]: activeRes }))
            setHistory((prev) => ({
              ...prev,
              [slug]: {
                auditedAt: Date.now(),
                declared: activeRes.declared,
                sampled: activeRes.sampled,
                okCount: activeRes.okCount,
                blockedCount: activeRes.blockedCount,
                suspiciousCount: activeRes.suspiciousCount ?? 0,
                brokenCount: activeRes.brokenCount,
                reachability: activeRes.reachability,
              },
            }))
            setExpandedPacks((prev) => new Set(prev).add(slug))
          })
        }

        const brokenUrls = activeRes?.brokenItems?.map((i) => i.url) || []
        const suspiciousUrls = activeRes?.suspiciousItems?.map((i) => i.url) || []

        if (brokenUrls.length === 0 && suspiciousUrls.length === 0) {
          setAiHealResults((prev) => ({
            ...prev,
            [slug]: {
              ok: true,
              slug,
              diagnoses: [],
              overview: '🎉 经过实时体检，该网址包内全部抽样站点均处于健康可达状态，未检测到死链或可疑停放，无需进行平替与自愈修复！',
              model: '系统健康卫士',
            },
          }))
          setPackTabs((prev) => ({ ...prev, [slug]: 'ai' }))
          return
        }

        const healRes = await hubSend<AiHealResult>(`/plugins/${encodeURIComponent(slug)}/ai-heal`, 'POST', {
          brokenUrls,
          suspiciousUrls,
        })
        startTransition(() => {
          setAiHealResults((prev) => ({ ...prev, [slug]: healRes }))
          setPackTabs((prev) => ({ ...prev, [slug]: 'ai' }))
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : `AI 自愈诊断失败: ${slug}`)
      } finally {
        setAiLoadingPacks((prev) => ({ ...prev, [slug]: false }))
      }
    },
    [results, sampleLimit],
  )

  // 单包傻瓜式一键全自动「探活 ➔ AI 匹配 ➔ 自动批量采纳最优平替并保存」（全程无弹窗）
  const runAutoHealPack = useCallback(
    async (slug: string) => {
      setAiLoadingPacks((prev) => ({ ...prev, [slug]: true }))
      setFixingPacks((prev) => ({ ...prev, [slug]: true }))
      startTransition(() => {
        setExpandedPacks((prev) => new Set(prev).add(slug))
      })
      setError(null)
      try {
        const existingHeal = aiHealResults[slug]
        if (existingHeal && existingHeal.diagnoses && existingHeal.diagnoses.length > 0) {
          const usedUrls = new Set<string>()
          const replacements: Array<{ oldUrl: string; newUrl: string; newTitle: string }> = []
          const removeUrls: string[] = []
          for (const d of existingHeal.diagnoses) {
            const best =
              d.suggestedReplacements?.find((r) => !usedUrls.has(r.url.toLowerCase())) ||
              d.suggestedReplacements?.[0]
            if (best && best.url) {
              usedUrls.add(best.url.toLowerCase())
              replacements.push({ oldUrl: d.url, newUrl: best.url, newTitle: best.title })
            } else if (d.kind === 'broken') {
              removeUrls.push(d.url)
            }
          }

          if (replacements.length > 0 || removeUrls.length > 0) {
            const fixRes = await hubSend<{
              ok: boolean
              replacedCount: number
              removedCount: number
              remainingSites: number
            }>(`/plugins/${encodeURIComponent(slug)}/apply-health-fix`, 'POST', {
              replaceUrls: replacements,
              removeUrls,
            })
            markPackUrlsHealed(
              slug,
              [...replacements.map((r) => r.oldUrl), ...removeUrls],
              fixRes.replacedCount,
              fixRes.removedCount,
              fixRes.remainingSites,
            )
            const names = replacements.slice(0, 3).map((r) => r.newTitle).join('、')
            setFixSuccessPacks((prev) => ({
              ...prev,
              [slug]: `⚡ 全自动平替完成：已自动采纳 ${fixRes.replacedCount} 处高分平替${names ? `（${names}等）` : ''}${fixRes.removedCount > 0 ? `，清理 ${fixRes.removedCount} 条死链` : ''}，包内现有 ${fixRes.remainingSites} 条健康站点！`,
            }))
            return
          }
        }

        let activeRes = results[slug]
        if (!activeRes) {
          activeRes = await hubSend<AuditResult>(`/plugins/${encodeURIComponent(slug)}/audit`, 'POST', {
            limit: sampleLimit,
            timeoutMs: 4000,
          })
          startTransition(() => {
            setResults((prev) => ({ ...prev, [slug]: activeRes! }))
            setHistory((prev) => ({
              ...prev,
              [slug]: {
                auditedAt: Date.now(),
                declared: activeRes!.declared,
                sampled: activeRes!.sampled,
                okCount: activeRes!.okCount,
                blockedCount: activeRes!.blockedCount,
                suspiciousCount: activeRes!.suspiciousCount ?? 0,
                brokenCount: activeRes!.brokenCount,
                reachability: activeRes!.reachability,
              },
            }))
          })
        }

        const brokenUrls = activeRes?.brokenItems?.map((i) => i.url) || []
        const suspiciousUrls = activeRes?.suspiciousItems?.map((i) => i.url) || []

        if (brokenUrls.length === 0 && suspiciousUrls.length === 0) {
          setFixSuccessPacks((prev) => ({
            ...prev,
            [slug]: '🎉 实时探活完成：全包抽样站点 100% 健康可达，无需平替！',
          }))
          return
        }

        const healRes = await hubSend<AiHealResult>(`/plugins/${encodeURIComponent(slug)}/ai-heal`, 'POST', {
          brokenUrls,
          suspiciousUrls,
          autoApply: true,
        })
        startTransition(() => {
          setAiHealResults((prev) => ({ ...prev, [slug]: healRes }))
          setPackTabs((prev) => ({ ...prev, [slug]: 'ai' }))
        })

        if (healRes.autoApplied && (healRes.autoApplied.replacedCount > 0 || healRes.autoApplied.removedCount > 0)) {
          markPackUrlsHealed(
            slug,
            // 同上：只标真正处理掉的，未找到候选的死链必须继续显示为待处理
            appliedUrlsOf(healRes.autoApplied),
            healRes.autoApplied.replacedCount,
            healRes.autoApplied.removedCount,
            healRes.autoApplied.remainingSites,
          )
          const names = healRes.autoApplied.items.slice(0, 3).map((i) => i.newTitle).join('、')
          setFixSuccessPacks((prev) => ({
            ...prev,
            [slug]: `⚡ 全自动 AI 智愈完成：已自动采纳 ${healRes.autoApplied!.replacedCount} 处高分权威平替${names ? `（${names}等）` : ''}${healRes.autoApplied!.removedCount > 0 ? `，清理 ${healRes.autoApplied!.removedCount} 条死链` : ''}，包内现有 ${healRes.autoApplied!.remainingSites} 条健康站点！`,
          }))
        } else if (healRes.diagnoses && healRes.diagnoses.length > 0) {
          const usedUrls = new Set<string>()
          const replacements: Array<{ oldUrl: string; newUrl: string; newTitle: string }> = []
          const removeUrls: string[] = []
          for (const d of healRes.diagnoses) {
            const best =
              d.suggestedReplacements?.find((r) => !usedUrls.has(r.url.toLowerCase())) ||
              d.suggestedReplacements?.[0]
            if (best && best.url) {
              usedUrls.add(best.url.toLowerCase())
              replacements.push({ oldUrl: d.url, newUrl: best.url, newTitle: best.title })
            } else if (d.kind === 'broken') {
              removeUrls.push(d.url)
            }
          }
          if (replacements.length > 0 || removeUrls.length > 0) {
            const fixRes = await hubSend<{
              ok: boolean
              replacedCount: number
              removedCount: number
              remainingSites: number
            }>(`/plugins/${encodeURIComponent(slug)}/apply-health-fix`, 'POST', {
              replaceUrls: replacements,
              removeUrls,
            })
            markPackUrlsHealed(
              slug,
              [...replacements.map((r) => r.oldUrl), ...removeUrls],
              fixRes.replacedCount,
              fixRes.removedCount,
              fixRes.remainingSites,
            )
            const names = replacements.slice(0, 3).map((r) => r.newTitle).join('、')
            setFixSuccessPacks((prev) => ({
              ...prev,
              [slug]: `⚡ 全自动 AI 智愈完成：已自动采纳 ${fixRes.replacedCount} 处高分权威平替${names ? `（${names}等）` : ''}${fixRes.removedCount > 0 ? `，清理 ${fixRes.removedCount} 条死链` : ''}，包内现有 ${fixRes.remainingSites} 条健康站点！`,
            }))
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : `一键全自动平替失败: ${slug}`)
      } finally {
        setAiLoadingPacks((prev) => ({ ...prev, [slug]: false }))
        setFixingPacks((prev) => ({ ...prev, [slug]: false }))
      }
    },
    [aiHealResults, results, sampleLimit, markPackUrlsHealed],
  )

  // 一键净网修复：直接剔除死链（无二次弹窗）
  const applyHealthFix = useCallback(
    async (slug: string, brokenUrls: string[]) => {
      setFixingPacks((prev) => ({ ...prev, [slug]: true }))
      try {
        const fixRes = await hubSend<{ ok: boolean; removedCount: number; remainingSites: number }>(
          `/plugins/${encodeURIComponent(slug)}/apply-health-fix`,
          'POST',
          { removeUrls: brokenUrls },
        )
        markPackUrlsHealed(slug, brokenUrls, 0, fixRes.removedCount, fixRes.remainingSites)
        setFixSuccessPacks((prev) => ({
          ...prev,
          [slug]: `✅ 成功剔除 ${fixRes.removedCount} 条死链，包内现保留 ${fixRes.remainingSites} 条有效站点`,
        }))
      } catch (err) {
        setError(err instanceof Error ? err.message : `一键净网修复失败: ${slug}`)
      } finally {
        setFixingPacks((prev) => ({ ...prev, [slug]: false }))
      }
    },
    [markPackUrlsHealed],
  )

  // 单条直接采纳平替修复（无二次弹窗，秒级生效）
  const executeReplacement = useCallback(
    async (slug: string, oldUrl: string, newUrl: string, newTitle: string) => {
      setFixingPacks((prev) => ({ ...prev, [slug]: true }))
      try {
        const fixRes = await hubSend<{ ok: boolean; replacedCount: number; remainingSites: number }>(
          `/plugins/${encodeURIComponent(slug)}/apply-health-fix`,
          'POST',
          { replaceUrls: [{ oldUrl, newUrl, newTitle }] },
        )
        markPackUrlsHealed(slug, [oldUrl], fixRes.replacedCount || 1, 0, fixRes.remainingSites)
        setFixSuccessPacks((prev) => ({
          ...prev,
          [slug]: `✅ 已成功将失效站点平替为 ${newTitle} (${newUrl})`,
        }))
      } catch (err) {
        setError(err instanceof Error ? err.message : `平替更新失败: ${slug}`)
      } finally {
        setFixingPacks((prev) => ({ ...prev, [slug]: false }))
      }
    },
    [markPackUrlsHealed],
  )

  // 批量直接采纳所有最优平替（无二次弹窗，秒级生效）
  const executeBatchReplacement = useCallback(
    async (
      slug: string,
      replacements: Array<{ oldUrl: string; newUrl: string; newTitle: string }>,
    ) => {
      setFixingPacks((prev) => ({ ...prev, [slug]: true }))
      try {
        const fixRes = await hubSend<{ ok: boolean; replacedCount: number; remainingSites: number }>(
          `/plugins/${encodeURIComponent(slug)}/apply-health-fix`,
          'POST',
          { replaceUrls: replacements },
        )
        markPackUrlsHealed(
          slug,
          replacements.map((r) => r.oldUrl),
          fixRes.replacedCount,
          0,
          fixRes.remainingSites,
        )
        const names = replacements.slice(0, 3).map((r) => r.newTitle).join('、')
        setFixSuccessPacks((prev) => ({
          ...prev,
          [slug]: `⚡ 已成功一键批量采纳 ${fixRes.replacedCount} 处最优平替${names ? `（${names}等）` : ''}，包内现有 ${fixRes.remainingSites} 条健康站点！`,
        }))
      } catch (err) {
        setError(err instanceof Error ? err.message : `批量平替更新失败: ${slug}`)
      } finally {
        setFixingPacks((prev) => ({ ...prev, [slug]: false }))
      }
    },
    [markPackUrlsHealed],
  )

  // 展开/折叠抽屉
  const toggleExpand = useCallback((slug: string) => {
    startTransition(() => {
      setExpandedPacks((prev) => {
        const next = new Set(prev)
        if (next.has(slug)) next.delete(slug)
        else next.add(slug)
        return next
      })
    })
  }, [])

  // 多选切换
  const toggleSelect = useCallback((slug: string) => {
    startTransition(() => {
      setSelectedPacks((prev) => {
        const next = new Set(prev)
        if (next.has(slug)) next.delete(slug)
        else next.add(slug)
        return next
      })
    })
  }, [])

  // 全选/取消全选
  const toggleSelectAll = useCallback(() => {
    startTransition(() => {
      setSelectedPacks((prev) => {
        if (prev.size === packs.length) return new Set()
        return new Set(packs.map((p) => p.slug))
      })
    })
  }, [packs])

  // 切换单包内 Tab
  const handleSetTab = useCallback((slug: string, tab: 'issues' | 'broken' | 'suspicious' | 'blocked' | 'ai') => {
    startTransition(() => {
      setPackTabs((prev) => ({ ...prev, [slug]: tab }))
    })
  }, [])

  // 关闭单包修复成功横幅
  const handleDismissFixSuccess = useCallback((slug: string) => {
    setFixSuccessPacks((prev) => ({ ...prev, [slug]: '' }))
  }, [])

  /** 关闭某包的深度取证面板（只清该包的结果，不影响其它包） */
  const handleCloseDeep = useCallback((slug: string) => {
    setDeepResults((prev) => {
      if (!(slug in prev)) return prev
      const next = { ...prev }
      delete next[slug]
      return next
    })
  }, [])

  // 6 维全局实时汇总指标
  const globalMetrics = useMemo(() => {
    let auditedPacks = 0
    let totalSampled = 0
    let totalOk = 0
    let totalBlocked = 0
    let totalSuspicious = 0
    let totalBroken = 0

    for (const pack of packs) {
      const snap = results[pack.slug] || history[pack.slug]
      if (snap && snap.auditedAt) {
        auditedPacks++
        totalSampled += snap.sampled ?? 0
        totalOk += snap.okCount ?? 0
        totalBlocked += snap.blockedCount ?? 0
        totalSuspicious += snap.suspiciousCount ?? 0
        totalBroken += snap.brokenCount ?? 0
      }
    }

    const reachability = totalSampled > 0 ? Math.round(((totalOk + totalBlocked) / totalSampled) * 1000) / 10 : null

    return {
      auditedPacks,
      totalPacks: packs.length,
      totalSampled,
      totalOk,
      totalBlocked,
      totalSuspicious,
      totalBroken,
      reachability,
    }
  }, [packs, results, history])

  // 计数统计
  const counts = useMemo(() => {
    let issues = 0
    let healthy = 0
    let untested = 0
    for (const p of packs) {
      const snap = results[p.slug] || history[p.slug]
      if (!snap || !snap.auditedAt) {
        untested++
      } else if ((snap.brokenCount ?? 0) > 0 || (snap.suspiciousCount ?? 0) > 0) {
        issues++
      } else {
        healthy++
      }
    }
    return { issues, healthy, untested }
  }, [packs, results, history])

  // 过滤与排序
  const filteredPacks = useMemo(() => {
    return packs
      .filter((pack) => {
        const snap = results[pack.slug] || history[pack.slug]
        const hasTested = Boolean(snap && snap.auditedAt)
        const hasIssues = snap ? (snap.brokenCount ?? 0) > 0 || (snap.suspiciousCount ?? 0) > 0 : false

        if (filter === 'issues' && (!hasTested || !hasIssues)) return false
        if (filter === 'healthy' && (!hasTested || hasIssues)) return false
        if (filter === 'untested' && hasTested) return false

        if (deferredSearch.trim()) {
          const term = deferredSearch.toLowerCase().trim()
          const matchName = pack.name.toLowerCase().includes(term)
          const matchSlug = pack.slug.toLowerCase().includes(term)
          const matchDesc = pack.description ? pack.description.toLowerCase().includes(term) : false
          const matchTags = pack.tags ? pack.tags.some((t) => t.toLowerCase().includes(term)) : false
          if (!matchName && !matchSlug && !matchDesc && !matchTags) return false
        }
        return true
      })
      .sort((a, b) => {
        const snapA = results[a.slug] || history[a.slug]
        const snapB = results[b.slug] || history[b.slug]

        if (sortBy === 'reachability_asc') {
          const rateA = snapA?.reachability ?? 999
          const rateB = snapB?.reachability ?? 999
          return rateA - rateB
        }
        if (sortBy === 'broken_desc') {
          const brokenA = snapA?.brokenCount ?? 0
          const brokenB = snapB?.brokenCount ?? 0
          return brokenB - brokenA
        }
        if (sortBy === 'name') {
          return a.name.localeCompare(b.name, 'zh-Hans-CN')
        }
        return 0
      })
  }, [packs, results, history, filter, deferredSearch, sortBy])

  // 分页切片计算
  const totalPages = Math.max(1, Math.ceil(filteredPacks.length / (pageSize === 0 ? filteredPacks.length || 1 : pageSize)))
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages)

  const pagedPacks = useMemo(() => {
    if (pageSize === 0) return filteredPacks
    const start = (validCurrentPage - 1) * pageSize
    return filteredPacks.slice(start, start + pageSize)
  }, [filteredPacks, validCurrentPage, pageSize])

  // 问题包集合（用于“仅体检异常与未测”）
  const issueAndUntestedPacks = useMemo(() => {
    return packs.filter((pack) => {
      const snap = results[pack.slug] || history[pack.slug]
      if (!snap || !snap.auditedAt) return true
      return (snap.brokenCount ?? 0) > 0 || (snap.suspiciousCount ?? 0) > 0 || (snap.reachability ?? 1) < 0.85
    })
  }, [packs, results, history])

  // 勾选中的包实体列表
  const checkedPackItems = useMemo(() => {
    return packs.filter((p) => selectedPacks.has(p.slug))
  }, [packs, selectedPacks])

  // 导出体检报告
  const exportReport = useCallback(
    (format: 'json' | 'md') => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      if (format === 'json') {
        const payload = {
          generatedAt: new Date().toISOString(),
          metrics: globalMetrics,
          packs: packs.map((p) => ({
            slug: p.slug,
            name: p.name,
            version: p.version,
            audit: results[p.slug] || history[p.slug] || null,
          })),
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `navhub-plugin-health-report-${timestamp}.json`
        a.click()
        URL.revokeObjectURL(url)
      } else {
        let md = `# 山羊胡插件网址体检与治理快照报告\n\n`
        md += `> 生成时间：${new Date().toLocaleString('zh-CN')} | 网址包总数：${packs.length} | 已测包数：${globalMetrics.auditedPacks}\n\n`
        md += `### 全局汇总指标\n`
        md += `- 累计抽样 URL: **${globalMetrics.totalSampled}** 条\n`
        md += `- 综合健康度: **${globalMetrics.reachability ?? '--'}%**\n`
        md += `- 确认健康可达: **${globalMetrics.totalOk}** 条\n`
        md += `- WAF 防护放行: **${globalMetrics.totalBlocked}** 条\n`
        md += `- 疑似停放/软404: **${globalMetrics.totalSuspicious}** 条\n`
        md += `- 确认死链: **${globalMetrics.totalBroken}** 条\n\n`
        md += `### 网址包体检明细清单\n\n`
        md += `| 网址包名称 | Slug | 抽样条数 | 可达率 | 死链数 | 疑似停放 | 状态 |\n`
        md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`
        for (const p of packs) {
          const s = results[p.slug] || history[p.slug]
          const reach = s?.reachability !== null && s?.reachability !== undefined ? `${Math.round(s.reachability * 100)}%` : '未测'
          const broken = s?.brokenCount ?? '--'
          const susp = s?.suspiciousCount ?? '--'
          const status = s ? (s.brokenCount ? '异常' : '健康') : '待测'
          md += `| ${p.name} | \`${p.slug}\` | ${s?.sampled ?? '--'} | ${reach} | ${broken} | ${susp} | ${status} |\n`
        }
        const blob = new Blob([md], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `navhub-plugin-health-report-${timestamp}.md`
        a.click()
        URL.revokeObjectURL(url)
      }
    },
    [globalMetrics, packs, results, history],
  )

  return (
    <Card className="border-border/60 shadow-sm overflow-hidden">
      <CardHeader className="space-y-4 pb-4 bg-card/60 backdrop-blur-sm border-b">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
              <Gauge className="h-5 w-5 text-primary" />
              网址包智能体检与 AI 自愈指挥台
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              对各网址包开展真实探活、L2 内容级防劫持（Shannon 信息熵与停放黑词识别）及 L3 后端 AI 模型平替与一键自愈。
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadData()} disabled={loading || batchState.isRunning}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="ml-1.5">同步快照</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportReport('json')} disabled={loading}>
              <Download className="h-3.5 w-3.5" />
              <span className="ml-1.5">导出 JSON</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportReport('md')} disabled={loading}>
              <Download className="h-3.5 w-3.5" />
              <span className="ml-1.5">导出 Markdown</span>
            </Button>
          </div>
        </div>

        {/* 6 维全局实时健康度大盘（带顶部渐变强调条） */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-1">
          <div className="rounded-lg border bg-card/80 p-2.5 shadow-sm border-t-2 border-t-primary/80 transition-all hover:shadow">
            <div className="text-[11px] font-medium text-muted-foreground">已体检包数</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-xl font-bold tracking-tight">{globalMetrics.auditedPacks}</span>
              <span className="text-xs text-muted-foreground">/ {globalMetrics.totalPacks}</span>
            </div>
          </div>
          <div className="rounded-lg border bg-card/80 p-2.5 shadow-sm border-t-2 border-t-slate-400 transition-all hover:shadow">
            <div className="text-[11px] font-medium text-muted-foreground">累计抽样 URL</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-xl font-bold tracking-tight">{globalMetrics.totalSampled}</span>
              <span className="text-xs text-muted-foreground">条</span>
            </div>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 shadow-sm border-t-2 border-t-emerald-500 transition-all hover:shadow">
            <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> 真健康站点
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                {globalMetrics.totalOk}
              </span>
              <span className="text-xs text-muted-foreground">条</span>
            </div>
          </div>
          <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5 shadow-sm border-t-2 border-t-sky-400 transition-all hover:shadow">
            <div className="text-[11px] font-medium text-sky-600 dark:text-sky-400 flex items-center gap-1">
              <Globe className="h-3 w-3" /> WAF 拦截放行
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-xl font-bold tracking-tight text-sky-600 dark:text-sky-400">
                {globalMetrics.totalBlocked}
              </span>
              <span className="text-xs text-muted-foreground">条</span>
            </div>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 shadow-sm border-t-2 border-t-amber-400 transition-all hover:shadow">
            <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> 疑似停放/软404
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
                {globalMetrics.totalSuspicious}
              </span>
              <span className="text-xs text-muted-foreground">条</span>
            </div>
          </div>
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-2.5 shadow-sm border-t-2 border-t-rose-500 transition-all hover:shadow">
            <div className="text-[11px] font-medium text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> 确认死链
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-xl font-bold tracking-tight text-destructive">{globalMetrics.totalBroken}</span>
              <span className="text-xs text-muted-foreground">条</span>
            </div>
          </div>
        </div>

        {/* 批量完成提示横幅 */}
        {batchCompleteNotice && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs flex items-center justify-between text-emerald-800 dark:text-emerald-200 animate-in fade-in">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>{batchCompleteNotice}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-emerald-700 dark:text-emerald-300" onClick={() => setFilter('issues')}>
                仅看问题包
              </Button>
              <button type="button" onClick={() => setBatchCompleteNotice(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* 一键体检控制台与批量编排条 */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">抽样深度：</span>
              <select
                aria-label="抽样深度选择"
                value={sampleLimit}
                onChange={(e) => setSampleLimit(Number(e.target.value))}
                disabled={batchState.isRunning}
                className="h-8 rounded-md border bg-background px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring shadow-sm"
              >
                <option value={15}>快速抽样 (15条/包)</option>
                <option value={30}>标准体检 (30条/包)</option>
                <option value={100}>全量深度 (100条/包)</option>
              </select>
            </div>

            {batchState.isRunning ? (
              <Button size="sm" variant="destructive" onClick={stopBatch} className="shadow-sm">
                <Square className="h-3.5 w-3.5" />
                <span className="ml-1.5">终止任务</span>
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm font-medium"
                  disabled={packs.length === 0}
                  onClick={() => void startBatchAutoHeal(issueAndUntestedPacks.length > 0 ? issueAndUntestedPacks : packs)}
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  <span className="ml-1.5">
                    傻瓜式一键全自动体检并平替 ({issueAndUntestedPacks.length > 0 ? issueAndUntestedPacks.length : packs.length} 个包)
                  </span>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="shadow-sm"
                  disabled={packs.length === 0}
                  onClick={() => void startBatchAudit(packs)}
                >
                  <Play className="h-3.5 w-3.5" />
                  <span className="ml-1.5">仅全量体检 ({packs.length} 个包)</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={issueAndUntestedPacks.length === 0}
                  onClick={() => void startBatchAudit(issueAndUntestedPacks)}
                  className="shadow-sm"
                >
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span className="ml-1.5">仅体检异常/未测 ({issueAndUntestedPacks.length} 个包)</span>
                </Button>
              </>
            )}
          </div>

          {/* 搜索与过滤 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                aria-label="搜索网址包（包名或 Slug）"
                placeholder="搜索包名或 Slug（按 / 快速聚焦）…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 w-48 sm:w-64 rounded-md border bg-background pl-8 pr-7 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring shadow-sm"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                  aria-label="清空搜索"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <select
              aria-label="排序规则"
              value={sortBy}
              onChange={(e) => {
                const val = e.target.value as any
                startTransition(() => {
                  setSortBy(val)
                })
              }}
              className="h-8 rounded-md border bg-background px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring shadow-sm"
            >
              <option value="default">默认顺序</option>
              <option value="reachability_asc">健康度升序 (危险优先)</option>
              <option value="broken_desc">死链数最多</option>
              <option value="name">包名称 (A-Z)</option>
            </select>
          </div>
        </div>

        {/* 交互式过滤芯片 (Filter Chips) 与多选批量操作条 */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground text-[11px] mr-1 flex items-center gap-1">
              <Filter className="h-3 w-3" /> 过滤：
            </span>
            <button
              type="button"
              onClick={() => {
                startTransition(() => {
                  setFilter('all')
                })
              }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                filter === 'all'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              全部 ({packs.length})
            </button>
            <button
              type="button"
              onClick={() => {
                startTransition(() => {
                  setFilter('issues')
                })
              }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1 ${
                filter === 'issues'
                  ? 'bg-destructive text-destructive-foreground shadow-sm'
                  : 'bg-destructive/10 text-destructive hover:bg-destructive/20'
              }`}
            >
              <AlertCircle className="h-3 w-3" />
              含死链/停放 ({counts.issues})
            </button>
            <button
              type="button"
              onClick={() => {
                startTransition(() => {
                  setFilter('healthy')
                })
              }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1 ${
                filter === 'healthy'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
              }`}
            >
              <CheckCircle2 className="h-3 w-3" />
              健康良好 ({counts.healthy})
            </button>
            <button
              type="button"
              onClick={() => {
                startTransition(() => {
                  setFilter('untested')
                })
              }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                filter === 'untested'
                  ? 'bg-secondary text-secondary-foreground shadow-sm'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              title="包含两类：从未体检过，以及清单刚被改动、需要重新体检的包"
            >
              无有效数据 ({counts.untested})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              {selectedPacks.size === packs.length && packs.length > 0 ? (
                <>
                  <CheckSquare className="h-3.5 w-3.5 text-primary" />
                  <span>取消全选</span>
                </>
              ) : (
                <>
                  <Square className="h-3.5 w-3.5" />
                  <span>全选本页</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 多选勾选浮动执行栏 */}
        {selectedPacks.size > 0 && (
          <div className="rounded-lg border border-primary/40 bg-primary/10 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 animate-in fade-in slide-in-from-top-1 text-xs">
            <div className="flex items-center gap-2 font-medium text-primary">
              <Layers className="h-4 w-4" />
              <span>已选中 {selectedPacks.size} 个网址包</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm font-medium"
                disabled={batchState.isRunning}
                onClick={() => void startBatchAutoHeal(checkedPackItems)}
              >
                <Wand2 className="h-3 w-3 mr-1" />
                傻瓜式全自动平替所选 ({selectedPacks.size} 包)
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs bg-primary text-primary-foreground shadow-sm"
                disabled={batchState.isRunning}
                onClick={() => void startBatchAudit(checkedPackItems)}
              >
                <Play className="h-3 w-3 mr-1" />
                仅体检所选 ({selectedPacks.size} 包)
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => {
                  startTransition(() => {
                    setExpandedPacks((prev) => {
                      const next = new Set(prev)
                      for (const s of selectedPacks) next.add(s)
                      return next
                    })
                  })
                }}
              >
                展开所选
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  startTransition(() => {
                    setSelectedPacks(new Set())
                  })
                }}
              >
                清除勾选
              </Button>
            </div>
          </div>
        )}

        {/* 批量体检进行中的流式进度条 */}
        {batchState.isRunning && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2 animate-in fade-in duration-300">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 font-medium text-primary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在处理: <code>{batchState.currentSlug}</code>
              </div>
              <span className="text-muted-foreground">
                进度: {batchState.completed} / {batchState.total} ({Math.round((batchState.completed / (batchState.total || 1)) * 100)}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-primary/20">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${Math.round((batchState.completed / (batchState.total || 1)) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && packs.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            正在加载网址包历史健康快照…
          </div>
        ) : filteredPacks.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title="未找到匹配的网址包"
            description={packs.length === 0 ? '插件市场里还没有 site-pack 类型的插件。' : '根据当前的筛选与搜索条件未找到匹配项。'}
          />
        ) : (
          <div className="space-y-3">
            <ul className="divide-y rounded-lg border bg-card/60 shadow-sm">
              {pagedPacks.map((pack) => (
                <PackRowItem
                  key={pack.slug}
                  pack={pack}
                  snap={results[pack.slug] || history[pack.slug]}
                  auditResult={results[pack.slug]}
                  isRunning={runningSingle === pack.slug || (batchState.isRunning && batchState.currentSlug === pack.slug)}
                  isExpanded={expandedPacks.has(pack.slug)}
                  isSelected={selectedPacks.has(pack.slug)}
                  aiHeal={aiHealResults[pack.slug]}
                  isAiLoading={Boolean(aiLoadingPacks[pack.slug])}
                  isFixing={Boolean(fixingPacks[pack.slug])}
                  fixSuccess={fixSuccessPacks[pack.slug]}
                  activeTab={packTabs[pack.slug] || 'issues'}
                  isBatchRunning={batchState.isRunning}
                  onToggleSelect={toggleSelect}
                  onToggleExpand={toggleExpand}
                  onSetTab={handleSetTab}
                  onRunAudit={runAudit}
                  onRunAutoHealPack={runAutoHealPack}
                  onRunAiHeal={runAiHeal}
                  onApplyHealthFix={applyHealthFix}
                  onExecuteReplacement={executeReplacement}
                  onExecuteBatchReplacement={executeBatchReplacement}
                  onDismissFixSuccess={handleDismissFixSuccess}
                  onDeepDiagnose={runDeepDiagnose}
                  deepResult={deepResults[pack.slug] ?? null}
                  deepLoadingUrl={deepLoading?.slug === pack.slug ? deepLoading.url : null}
                  onCloseDeep={handleCloseDeep}
                  onLoadTrend={loadTrend}
                  trend={trendResults[pack.slug] ?? null}
                  isTrendLoading={trendLoading === pack.slug}
                />
              ))}
            </ul>

            {/* 分页控制栏 */}
            {filteredPacks.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-muted-foreground border-t border-border/40">
                <div className="flex items-center gap-2">
                  <span>
                    共 <strong className="text-foreground font-semibold">{filteredPacks.length}</strong> 个网址包
                  </span>
                  {pageSize > 0 && (
                    <span>
                      （第 <strong className="text-foreground font-semibold">{validCurrentPage}</strong> / {totalPages} 页）
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span>每页显示：</span>
                    <select
                      aria-label="每页显示条数"
                      value={pageSize}
                      onChange={(e) => {
                        const size = Number(e.target.value)
                        startTransition(() => {
                          setPageSize(size)
                          setCurrentPage(1)
                        })
                      }}
                      className="h-7 rounded border bg-background px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value={20}>20 条</option>
                      <option value={50}>50 条</option>
                      <option value={0}>全部 ({filteredPacks.length})</option>
                    </select>
                  </div>

                  {pageSize > 0 && totalPages > 1 && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={validCurrentPage <= 1}
                        onClick={() => {
                          startTransition(() => {
                            setCurrentPage((p) => Math.max(1, p - 1))
                          })
                        }}
                      >
                        <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />
                        上一页
                      </Button>

                      <span className="px-2 text-xs font-mono font-medium text-foreground">
                        {validCurrentPage} / {totalPages}
                      </span>

                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={validCurrentPage >= totalPages}
                        onClick={() => {
                          startTransition(() => {
                            setCurrentPage((p) => Math.min(totalPages, p + 1))
                          })
                        }}
                      >
                        下一页
                        <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
