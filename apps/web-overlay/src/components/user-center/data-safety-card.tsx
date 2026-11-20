'use client'

/**
 * 数据安全区（第 15 项，Phase 1）：/me/data 顶部的“安不安全”一眼信息。
 *
 * 只陈述有真实来源的状态（导出审计 / 同步水位 / 金库记录 / 同步失败通知）：
 *  - 不许写断言式文案称数据已经备好（除非刚导出过且在新鲜期内）；
 *  - 不许写云端会自动备份（没有自动备份这回事）；
 *  - 不许把全站冷备说成是用户个人的备份（那是整站的，恢复要管理员整库操作、
 *    且不能只恢复一个人）；
 *  - 无记录时写“近一年内没有导出记录”（audit_logs 只保留 365 天，
 *    不能断言从未导出过）；
 *  - 失败原因只给三档分类，绝不展示审计里的原始异常文本，
 *    不许猜具体原因（未知就写“原因未知”）。
 *
 * 每项状态下标注来源小字；时间相对主显 + 绝对副显。
 * 匿名态不渲染本组件（页面只在登录态挂载它）；本机部分由 LocalDataManager 负责。
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Bell, CheckCircle2, CircleDashed, Download, Loader2, RefreshCw, ShieldCheck, Stethoscope, XCircle } from 'lucide-react'
import { safeHref } from '@/lib/safe-url'
import { Button } from '@/components/ui/button'
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format-relative-time'
import type { DataSafety, SafetyCheck, SafetyStatus } from '@/lib/me-types'
import type { DiagnosticCheckItem } from '@/lib/user-settings'
import { buildLocalSnapshotCheck } from '@/lib/user-settings'

/** 失败原因三档文案（与服务端 mapSyncErrorCode 的枚举同源，只给分类）。 */
export function describeSyncErrorCode(code: string | null | undefined): string {
  switch (code) {
    case 'timeout':
      return '请求超时'
    case 'network':
      return '网络波动'
    case 'server_5xx':
      return '服务端暂时不可用'
    case 'validation_4xx':
      return '请求数据未被接受'
    default:
      return '原因未知'
  }
}

export function overallTitle(overall: SafetyStatus): string {
  switch (overall) {
    case 'ok':
      return '数据有备份，放心用'
    case 'warning':
      return '该导一份备份了'
    case 'critical':
      return '你的数据还没有安全备份'
    default:
      return '暂时看不到这项状态'
  }
}

const STATUS_DOT: Record<SafetyStatus, string> = {
  ok: 'h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500',
  warning: 'h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500',
  critical: 'h-1.5 w-1.5 shrink-0 rounded-full bg-destructive',
  unknown: 'h-1.5 w-1.5 shrink-0 rounded-full border border-foreground/25',
}

const STATUS_TEXT: Record<SafetyStatus, string> = {
  ok: 'text-emerald-700 dark:text-emerald-300',
  warning: 'text-amber-700 dark:text-amber-300',
  critical: 'text-destructive-text',
  unknown: 'text-muted-foreground',
}

function Row({
  label,
  value,
  sub,
  status,
  source,
  next,
}: {
  label: string
  value: string
  sub?: string
  status: SafetyStatus
  source: string
  next?: { href: string; label: string }
}) {
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden className={STATUS_DOT[status]} />
          <span className="truncate">{label}</span>
        </span>
        {sub ? <span className="pl-3.5 text-[11px] leading-relaxed text-muted-foreground">{sub}</span> : null}
        {next && status !== 'ok' ? (
          <span className="flex min-w-0 pl-3.5">
            <a
              href={safeHref(next.href, '/')}
              className="inline-flex min-h-6 items-center gap-1 rounded-sm text-[11px] text-muted-foreground underline decoration-border underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {next.label}
            </a>
          </span>
        ) : null}
        <span className="pl-3.5 text-[11px] text-muted-foreground">来源：{source}</span>
      </span>
      <span className={`shrink-0 text-right text-xs font-medium ${STATUS_TEXT[status]}`}>
        {value}
      </span>
    </li>
  )
}

function CheckIcon({ status }: { status: DiagnosticCheckItem['status'] }) {
  if (status === 'failed' || status === 'critical') {
    return <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive-text" aria-hidden />
  }
  if (status === 'warning') {
    return <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
  }
  if (status === 'unknown') {
    return <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
  }
  return (
    <CheckCircle2
      className={
        status === 'repaired'
          ? 'mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500'
          : 'mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500'
      }
      aria-hidden
    />
  )
}

function syncRowValue(
  state: DataSafety['sync']['favorites'],
  unread: number,
  now: number,
): { value: string; sub: string; status: SafetyStatus } {
  if (state.lastFailureAt != null && now - state.lastFailureAt <= 60 * 60_000) {
    return {
      value: '1 小时内失败',
      sub: `失败原因：${describeSyncErrorCode(state.lastErrorCode)}（${formatRelativeTime(state.lastFailureAt, now)}）`,
      status: 'critical',
    }
  }
  if (state.lastSuccessAt == null) {
    return {
      value: '尚未记录到成功同步',
      sub: '同步成功时间尚未记录——水位表刚上线，同步一次后就有',
      status: 'unknown',
    }
  }
  const fresh = now - state.lastSuccessAt <= 24 * 60 * 60_000
  return {
    value: `上次成功 ${formatRelativeTime(state.lastSuccessAt, now)}`,
    sub:
      `${formatAbsoluteTime(state.lastSuccessAt)}` +
      (unread > 0 ? `；另有 ${unread} 条未读同步失败通知` : '；没有未读同步失败通知'),
    status: fresh && unread === 0 ? 'ok' : 'warning',
  }
}

export function DataSafetyCard({
  initialSafety,
  onExport,
  exporting = false,
}: {
  /** 测试/受控渲染用：给了就直接展示，不自动 fetch。 */
  initialSafety?: DataSafety | null
  /** 页面已有的导出 handler（复用 handleExport）；成功后安全区重新拉取。 */
  onExport?: () => Promise<void> | void
  exporting?: boolean
}) {
  const [safety, setSafety] = useState<DataSafety | null>(initialSafety ?? null)
  const [loading, setLoading] = useState(initialSafety === undefined)
  const [error, setError] = useState<string | null>(null)
  const [diagChecks, setDiagChecks] = useState<DiagnosticCheckItem[] | null>(null)
  const [diagRunning, setDiagRunning] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  const loadSafety = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/me/safety', { cache: 'no-store' })
      if (!res.ok) throw new Error('数据安全状态暂时读不到')
      const data = (await res.json()) as DataSafety & { ok?: boolean }
      setSafety(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '数据安全状态暂时读不到')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (initialSafety !== undefined) return
    void loadSafety()
  }, [initialSafety, loadSafety])

  const handleExport = useCallback(async () => {
    if (onExport) await onExport()
    // 导出成功后安全区即时刷新；导出失败时刷新也是无害的（状态不变）
    if (initialSafety === undefined) await loadSafety()
  }, [initialSafety, loadSafety, onExport])

  const handleResync = useCallback(async () => {
    setSyncing(true)
    setSyncMessage(null)
    try {
      // 收藏同步模块只在用户点「重新同步」时才需要：动态 import，避免整条
      // useFavorites 闭包（favorites-storage/triage/hibernation/undo-stack…）
      // 静态挂进数据页首屏（/me/data 曾超首屏预算 2 KB）。
      const { syncFavoritesToCloud } = await import('@/hooks/useFavorites')
      const result = await syncFavoritesToCloud()
      setSyncMessage(
        result.ok
          ? `收藏已重新同步（本次提交 ${result.pushed} 条变更）。`
          : `重新同步失败：${result.error ?? '原因未知'}。`,
      )
    } catch {
      setSyncMessage('重新同步失败：原因未知。')
    } finally {
      setSyncing(false)
      if (initialSafety === undefined) await loadSafety()
    }
  }, [initialSafety, loadSafety])

  const runDiagnostics = useCallback(async () => {
    setDiagRunning(true)
    try {
      const res = await fetch('/api/me/diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('自检请求失败')
      const data = (await res.json()) as { checks?: SafetyCheck[]; repairedCount?: number }
      const cloud: DiagnosticCheckItem[] = Array.isArray(data.checks)
        ? data.checks.map((c) => ({ id: c.id, label: c.label, status: c.status, detail: c.detail }))
        : []
      // local_snapshot 是纯前端探针（JSON.parse，不读内容），服务端不管这一项
      setDiagChecks([...cloud, buildLocalSnapshotCheck()])
    } catch {
      setDiagChecks(null)
      setSyncMessage('一键检查失败，请稍后重试。')
    } finally {
      setDiagRunning(false)
    }
  }, [])

  const now = Date.now()
  const overall = safety?.overall ?? 'unknown'
  const lastExport = safety?.lastExport ?? null
  const exportStatus: SafetyStatus =
    lastExport?.at == null
      ? 'critical'
      : now - lastExport.at <= 7 * 86_400_000
        ? 'ok'
        : now - lastExport.at <= 30 * 86_400_000
          ? 'warning'
          : 'critical'
  const fav = safety ? syncRowValue(safety.sync.favorites, safety.sync.unreadSyncFailures, now) : null
  const watch = safety ? syncRowValue(safety.sync.watchlist, safety.sync.unreadSyncFailures, now) : null

  return (
    <section aria-label="数据安全" className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="h-4 w-4" aria-hidden />
          </span>
          数据安全
        </h2>
        {safety ? (
          <span className={`rounded-full border border-border/60 px-2 py-0.5 text-[11px] font-medium ${STATUS_TEXT[overall]}`}>
            {overallTitle(overall)}
          </span>
        ) : null}
      </div>

      {loading && !safety ? (
        <p className="mt-3 text-xs text-muted-foreground">正在读取数据安全状态…</p>
      ) : null}

      {error && !safety ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-destructive-text">{error}</p>
          <Button size="sm" variant="outline" className="w-full text-xs sm:w-auto" onClick={() => void loadSafety()}>
            重试
          </Button>
        </div>
      ) : null}

      {safety ? (
        <>
          {(overall === 'warning' || overall === 'critical') && (
            <div
              role="alert"
              className={
                overall === 'critical'
                  ? 'mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-xs text-destructive-text'
                  : 'mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200'
              }
            >
              <p className="font-semibold">{overallTitle(overall)}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed">
                {lastExport?.at == null
                  ? '近一年内没有导出记录；现在导一份只要几秒，导完这里就变绿。'
                  : `上次导出是 ${formatRelativeTime(lastExport.at, now)}，之后新增的数据还没进备份；现在导一份就能刷新。`}
              </p>
            </div>
          )}

          <ul className="mt-2 divide-y divide-border/60">
            <Row
              label="我的导出"
              value={
                lastExport?.at == null
                  ? '近一年内没有导出记录'
                  : `上次导出 ${formatRelativeTime(lastExport.at, now)}`
              }
              sub={
                lastExport?.at == null
                  ? undefined
                  : `${formatAbsoluteTime(lastExport.at)} · 含 ${lastExport.counts?.favorites ?? 0} 条收藏` +
                    (lastExport.truncated === true
                      ? ' · 该次导出不完整（被截断过）'
                      : lastExport.truncated === false
                        ? ' · 该次导出完整'
                        : ' · 该次导出是否完整未知')
              }
              status={exportStatus}
              source="你的导出记录"
              next={{ href: '#export-section', label: '去导出一份' }}
            />
            {fav ? (
              <Row
                label="收藏同步"
                value={fav.value}
                sub={fav.sub}
                status={fav.status}
                source="同步记录"
                next={{ href: '/me/notifications', label: '去看同步失败通知' }}
              />
            ) : null}
            {watch ? (
              <Row
                label="追剧同步"
                value={watch.value}
                sub={watch.sub}
                status={watch.status}
                source="同步记录"
                next={{ href: '/me/notifications', label: '去看同步失败通知' }}
              />
            ) : null}
            <Row
              label="金库与跨端排版"
              value={
                safety.sync.vault.exists
                  ? `金库 v${safety.sync.vault.version ?? 1}`
                  : safety.sync.crdt.exists
                    ? '跨端排版日志在云端'
                    : '均未建立'
              }
              sub={
                safety.sync.vault.exists && safety.sync.vault.updatedAt
                  ? `金库更新于 ${formatRelativeTime(safety.sync.vault.updatedAt, now)}（${formatAbsoluteTime(safety.sync.vault.updatedAt)}）`
                  : safety.sync.crdt.exists && safety.sync.crdt.updatedAt
                    ? `跨端排版日志更新于 ${formatRelativeTime(safety.sync.crdt.updatedAt, now)}`
                    : '不用这两项不代表数据不安全'
              }
              status={safety.sync.vault.exists || safety.sync.crdt.exists ? 'ok' : 'unknown'}
              source="云端金库记录"
            />
            <Row
              label="全站冷备"
              value="站长侧维护，不在此列"
              sub="全站备份由站长每日维护，恢复是整库操作、不能只恢复某一个用户；它不是你手里的个人备份。"
              status="unknown"
              source="运维侧（普通用户不可见）"
            />
          </ul>

          {safety.sync.unreadSyncFailures > 0 ? (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              另有 {safety.sync.unreadSyncFailures} 条未读同步失败通知，
              <a href="/me/notifications" className="underline underline-offset-2 hover:text-foreground">
                去通知页查看
              </a>
              。
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Button size="sm" className="w-full text-xs sm:w-auto" disabled={exporting} onClick={() => void handleExport()}>
              {exporting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
              立即导出一份 JSON
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs sm:w-auto"
              disabled={syncing}
              onClick={() => void handleResync()}
            >
              {syncing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
              重新同步收藏
            </Button>
            <Button asChild size="sm" variant="outline" className="w-full text-xs sm:w-auto">
              <a href="/me/notifications">
                <Bell className="mr-2 h-3.5 w-3.5" />
                查看通知
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs sm:w-auto"
              disabled={diagRunning}
              onClick={() => void runDiagnostics()}
            >
              {diagRunning ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="mr-2 h-3.5 w-3.5" />}
              一键检查
            </Button>
          </div>

          {syncMessage ? (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground" role="status">
              {syncMessage}
            </p>
          ) : null}

          {diagChecks ? (
            <div className="mt-3 space-y-2">
              <p className="text-[11px] text-muted-foreground">
                自检结果（{diagChecks.length} 项，只读检查，不修复、不删数）
              </p>
              <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
                {diagChecks.map((check) => (
                  <li key={check.id} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
                    <span className="flex min-w-0 items-start gap-2">
                      <CheckIcon status={check.status} />
                      <span className="min-w-0">
                        <span className="block break-words font-medium">{check.label}</span>
                        <span className="block break-words text-[11px] text-muted-foreground">{check.detail}</span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <CircleDashed className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            以上状态来自云端最近一次写入；断网时可能滞后，不代表数据丢失。全站冷备不在此列。
          </p>
        </>
      ) : null}
    </section>
  )
}
