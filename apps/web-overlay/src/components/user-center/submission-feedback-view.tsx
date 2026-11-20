'use client'

/**
 * 收录反馈视图（提交后网址收录情况汇报）。
 *
 * 数据源 GET /api/hub/submissions/feedback：我的投稿 + 审核结果（提交时间 /
 * 网址 / 状态 / 原因）。原因由 AI 在审核时生成（通过=亮点与收录理由，未通过=
 * 改进建议），状态或原因更新后点「刷新」即见最新（接口无缓存，拉取即真相）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, RefreshCw, ExternalLink, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format-relative-time'
import { safeHref } from '@/lib/safe-url'
import { getIdentity } from '@/lib/identity'
import { anonHeaders } from '@/lib/navhub-api'
import { cn } from '@/lib/utils'

interface FeedbackItem {
  siteId: string
  title: string
  url: string
  submittedAt: number
  status: 'pending' | 'approved' | 'rejected'
  reason: string
  reviewedAt: number | null
}

const STATUS_META: Record<FeedbackItem['status'], {
  label: string
  className: string
  Icon: typeof CheckCircle2
}> = {
  pending: {
    label: '审核中',
    className: 'text-sky-700 dark:text-sky-400 bg-sky-500/10 border-sky-500/30',
    Icon: Clock,
  },
  approved: {
    label: '已通过',
    className: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    Icon: CheckCircle2,
  },
  rejected: {
    label: '未通过',
    className: 'text-rose-700 dark:text-rose-400 bg-rose-500/10 border-rose-500/30',
    Icon: XCircle,
  },
}

export function SubmissionFeedbackView() {
  const [items, setItems] = useState<FeedbackItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 并发刷新（加载/手动/焦点）可能同时在飞：只让最新一次请求落地，
  // 旧响应晚返回时丢弃，避免过期状态覆盖刚拉到的新状态。
  const requestSeqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current
    setLoading(true)
    setError(null)
    try {
      // 身份必须显式带：/api/hub/* 代理不读 anon cookie，裸 fetch 在代理层
      // 被判为 anonymous，后端缺 identity 直接 400——未登录投稿者（投稿主力）
      // 将永远看不到自己的汇报。getIdentity() 登录优先、否则本机 anonId。
      const identity = getIdentity()
      const res = await fetch('/api/hub/submissions/feedback', { headers: anonHeaders(identity) })
      // 响应体不是 JSON（网关错误页等）按无数据处理，由 res.ok 分支兜底
      const data = await res.json().catch(() => { /* 解析失败即视为无数据，由 res.ok 判定 */ return null })
      if (seq !== requestSeqRef.current) return // 旧请求晚返回：丢弃，不覆盖新结果
      if (res.ok && data?.success && Array.isArray(data.items)) {
        setItems(data.items as FeedbackItem[])
      } else {
        setItems(null) // 拉取失败清掉旧数据，不拿过期汇报冒充最新
        setError(data?.message || '收录反馈拉取失败，请稍后重试')
      }
    } catch {
      if (seq !== requestSeqRef.current) return
      setItems(null)
      setError('中枢暂不可用，请稍后重试')
    } finally {
      if (seq === requestSeqRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // 状态或原因更新后同步显示：窗口重新获得焦点时自动拉最新（用户切去
    // 通知/审核页再回来，无需手点刷新）。visibilitychange 覆盖标签页切换。
    const onFocus = () => {
      // visibilitychange 隐藏方向也触发：只在可见时才拉，省一次空请求
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void load()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [load])

  return (
    <div className="py-4 sm:py-8 space-y-5 sm:space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">收录反馈</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            你投稿网站的收录审核结果与原因说明——通过与未通过都会给出说明，状态更新后刷新即见最新。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          className="gap-1.5 rounded-xl shrink-0"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          刷新
        </Button>
      </div>

      {loading && items === null && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-6 rounded-2xl border border-border/60">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载收录反馈…
        </div>
      )}

      {error && (
        <div className="p-4 rounded-2xl border border-destructive/40 bg-destructive/5 text-sm text-destructive-text">
          {error}
        </div>
      )}

      {!loading && !error && items !== null && items.length === 0 && (
        <div className="p-6 rounded-2xl border border-border/60 bg-muted/20 text-sm text-muted-foreground space-y-2">
          <p>还没有投稿记录。</p>
          <p>
            去{' '}
            <Link href="/submit" className="text-primary underline-offset-2 hover:underline">
              投稿优质网站
            </Link>
            ，审核结果（含原因说明）会在这里展示。
          </p>
        </div>
      )}

      {items !== null && items.length > 0 && (
        <ul className="space-y-3">
          {items.map((item) => {
            const meta = STATUS_META[item.status]
            return (
              <li
                key={item.siteId}
                className="p-4 rounded-2xl border border-border/60 bg-card/60 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground truncate">{item.title || item.url}</span>
                      <a
                        href={safeHref(item.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary shrink-0"
                        aria-label={`访问 ${item.title || item.url}`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    </div>
                    <p className="text-xs text-muted-foreground truncate font-mono">{item.url}</p>
                    <p className="text-xs text-muted-foreground">
                      提交于 {formatAbsoluteTime(item.submittedAt)}（{formatRelativeTime(item.submittedAt)}）
                      {item.reviewedAt != null && (
                        <> · 审核于 {formatAbsoluteTime(item.reviewedAt)}</>
                      )}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-semibold shrink-0',
                      meta.className,
                    )}
                  >
                    <meta.Icon className="h-3.5 w-3.5" aria-hidden />
                    {meta.label}
                  </span>
                </div>

                {/* 原因说明：通过/未通过都有（AI 生成）；审核中给等待说明 */}
                <div className="text-xs sm:text-sm rounded-xl border border-border/50 bg-muted/20 px-3 py-2 leading-relaxed text-foreground">
                  {item.status === 'pending' ? (
                    <span className="text-muted-foreground">
                      审核中——收录结果与原因说明会在审核完成后出现在这里（也可留意站内通知）。
                    </span>
                  ) : item.reason ? (
                    item.reason
                  ) : (
                    <span className="text-muted-foreground">
                      {item.status === 'approved' ? '已通过收录并上架。' : '暂未通过收录。'}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
