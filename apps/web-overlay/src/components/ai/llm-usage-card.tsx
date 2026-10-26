'use client'

/**
 * LLM 用量自查条（T21）：当前身份 24h 滚动窗口的调用次数与 token。
 * 此前额度信息只在 429 时才可见；现在常态展示，超 80% 提前预警。
 * 辅助信息：取数失败静默收起，绝不打断 AI 配置卡。
 */
import { useEffect, useState } from 'react'
import { Gauge } from 'lucide-react'
import { getSession } from 'next-auth/react'

interface LlmUsagePayload {
  ok: boolean
  calls: number
  tokens: number
  limits: { calls: number; tokens: number }
}

function fmt(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)
}

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  // 上限为 0 = 该档关闭（无限制），如实展示而不是假装有进度
  if (limit <= 0) {
    return (
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span>
          已用 {fmt(used)} · 无上限
        </span>
      </div>
    )
  }
  const pct = Math.min(100, Math.round((used / limit) * 100))
  const warn = pct >= 80
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className={warn ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}>
          {label}
          {warn ? ' · 即将达限' : ''}
        </span>
        <span className="tabular-nums">
          {fmt(used)} / {fmt(limit)}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}用量 ${pct}%`}
      >
        <div
          className={`h-full rounded-full transition-all ${warn ? 'bg-amber-500' : 'bg-primary/70'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function LlmUsageCard() {
  const [usage, setUsage] = useState<LlmUsagePayload | null>(null)
  // 用量是登录用户的私有数据：匿名访客无权访问 /api/me/llm-usage，未登录时强行
  // 拉取只会稳定拿到 401，并在控制台刷「Failed to load resource」噪声（preferences、
  // /me、/favorites、/me/workspaces 打开即触发）。
  // 这里用 getSession() 命令式判定登录态——它不依赖 <SessionProvider> 上下文，
  // 可避免部分渲染子树缺失 Provider 时 useSession 直接抛错导致整卡崩溃；也只在
  // 确认已登录后才发用量请求，从源头消除匿名 401 噪声。
  useEffect(() => {
    let alive = true
    void (async () => {
      let authed = false
      try {
        const session = await getSession()
        authed = Boolean(session)
      } catch {
        authed = false
      }
      if (!alive || !authed) return
      try {
        const res = await fetch('/api/me/llm-usage', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as LlmUsagePayload
        if (alive && data?.ok) setUsage(data)
      } catch {
        // 用量是辅助信息：取不到就不展示
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (!usage) return null
  return (
    <section
      aria-label="AI 用量（24 小时滚动窗口）"
      className="space-y-2.5 rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Gauge className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        AI 用量
        <span className="text-[11px] font-normal text-muted-foreground">24 小时滚动窗口</span>
      </h2>
      <UsageRow label="调用次数" used={usage.calls} limit={usage.limits.calls} />
      <UsageRow label="Token" used={usage.tokens} limit={usage.limits.tokens} />
    </section>
  )
}
