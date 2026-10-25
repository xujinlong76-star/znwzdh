'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  fetchPluginReviews,
  replyPluginReview,
  reportPluginReview,
  submitPluginReview,
  type HubPluginReviewsResponse,
} from '@/lib/navhub-api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Star, MessageSquare, CheckCircle2, ShieldCheck, Flag } from 'lucide-react'
import { toast } from 'sonner'
import dynamic from 'next/dynamic'

/**
 * 评价表单只在点「发表使用体验」后出现，按需加载：它连同 Input 一起
 * 退出详情页初始 chunk，给首屏预算留出空间（文本域仍被举报表单使用，保留）。
 */
const ReviewForm = dynamic(
  () => import('@/components/plugins/plugin-review-form').then((m) => m.ReviewForm),
  {
    ssr: false,
    loading: () => (
      <div className="h-40 rounded-2xl border border-border/60 bg-muted/20" aria-busy="true">
        <span className="sr-only">正在加载评价表单…</span>
      </div>
    ),
  },
)

interface PluginReviewSectionProps {
  slug: string
  isInstalled: boolean
  installedVersion?: string | null
  isOwner?: boolean
  initialReviews?: HubPluginReviewsResponse | null
}

export function PluginReviewSection({
  slug,
  isInstalled,
  installedVersion,
  isOwner = false,
  initialReviews,
}: PluginReviewSectionProps) {
  const [data, setData] = useState<HubPluginReviewsResponse>(
    initialReviews ?? {
      slug,
      stats: { avgRating: 0, reviewCount: 0, ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
      myReview: null,
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    },
  )
  // 详情页传入的 initialReviews 只有统计没有条目：此时先显示骨架，
  // 避免首屏短暂出现「全部评价 (N) + 暂无用户评价」的自相矛盾状态。
  const [loading, setLoading] = useState(!initialReviews || initialReviews.items.length === 0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [hoverRating, setHoverRating] = useState<number | null>(null)
  const [rating, setRating] = useState<number>(5)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [reportingId, setReportingId] = useState<string | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [reportSubmitting, setReportSubmitting] = useState(false)
  const [replyingId, setReplyingId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replySubmitting, setReplySubmitting] = useState(false)

  const handleSendAuthorReply = async (reviewId: string) => {
    if (!replyText.trim()) return
    setReplySubmitting(true)
    try {
      const res = await replyPluginReview(reviewId, replyText.trim())
      if (res.ok) {
        toast.success('作者回复已发布')
        setReplyingId(null)
        setReplyText('')
        setData((prev) => ({
          ...prev,
          items: prev.items.map((it) => (it.id === reviewId ? { ...it, ...res.review } : it)),
        }))
      }
    } catch (err: any) {
      toast.error(err?.message || '回复发布失败')
    } finally {
      setReplySubmitting(false)
    }
  }

  // 刷新评价列表（首屏 / 提交后回到第一页）
  const loadReviews = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchPluginReviews(slug)
      setData(res)
      if (res.myReview) {
        setRating(res.myReview.rating)
        setTitle(res.myReview.title ?? '')
        setContent(res.myReview.content ?? '')
      }
    } catch {
      // 容错降级
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void loadReviews()
  }, [loadReviews])

  /** 分页加载更多：服务端按 offset 返回，追加到现有列表且不覆盖正在编辑的表单。 */
  const loadMore = async () => {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetchPluginReviews(slug, {
        limit: data.limit || 20,
        offset: data.items.length,
      })
      setData((prev) => ({ ...res, items: [...prev.items, ...res.items] }))
    } catch {
      toast.error('加载更多评价失败，请稍后重试')
    } finally {
      setLoadingMore(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (rating < 1 || rating > 5) {
      toast.error('请选择 1 到 5 星评分')
      return
    }

    setSubmitting(true)
    try {
      const res = await submitPluginReview(slug, {
        rating,
        title: title.trim() || undefined,
        content: content.trim() || undefined,
      })
      if (res.success) {
        toast.success(data.myReview ? '评价已更新' : '评价发布成功，感谢您的反馈！')
        setShowForm(false)
        await loadReviews()
      }
    } catch (err: any) {
      toast.error(err?.message || '提交评价失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const handleReport = async (reviewId: string) => {
    const reason = reportReason.trim()
    if (reason.length < 2) {
      toast.error('请填写至少 2 个字的举报原因')
      return
    }
    setReportSubmitting(true)
    try {
      await reportPluginReview(slug, reviewId, reason)
      toast.success('举报已提交', { description: '管理员会结合举报计数人工复核，不会自动隐藏评价' })
      setReportingId(null)
      setReportReason('')
    } catch (err: any) {
      toast.error(err?.message || '举报失败，请稍后重试')
    } finally {
      setReportSubmitting(false)
    }
  }

  const handleRatingKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, star: number) => {
    let next = star
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(5, star + 1)
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(1, star - 1)
    else if (event.key === 'Home') next = 1
    else if (event.key === 'End') next = 5
    else return
    event.preventDefault()
    setRating(next)
    const group = event.currentTarget.parentElement
    group?.querySelector<HTMLButtonElement>(`button[data-rating="${next}"]`)?.focus()
  }

  const { stats, myReview, items, total } = data
  const hasReviews = total > 0
  const initialLoading = loading && items.length === 0

  return (
    <section className="space-y-6 pt-2">
      {/* 头部统计卡片 */}
      <div className="rounded-2xl border border-border/70 bg-card/60 p-6 backdrop-blur-sm">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
          {/* 综合得分 */}
          <div className="flex flex-col items-center justify-center text-center p-2 border-b md:border-b-0 md:border-r border-border/60">
            <div className="text-4xl font-extrabold text-foreground tracking-tight flex items-baseline gap-1">
              {stats.avgRating > 0 ? stats.avgRating.toFixed(1) : '暂无'}
              {stats.avgRating > 0 && <span className="text-sm font-normal text-muted-foreground">/ 5.0</span>}
            </div>
            <div className="flex items-center gap-1 my-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`h-4 w-4 ${
                    star <= Math.round(stats.avgRating)
                      ? 'fill-amber-400 text-amber-400'
                      : 'fill-muted/30 text-muted-foreground/30'
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              基于 {stats.reviewCount} 条真实安装用户评价
            </p>
          </div>

          {/* 分数分布柱状条 */}
          <div className="space-y-1.5 md:col-span-1">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = stats.ratingDistribution[star] ?? 0
              const pct = stats.reviewCount > 0 ? Math.round((count / stats.reviewCount) * 100) : 0
              return (
                <div key={star} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="w-6 text-right font-mono flex items-center justify-end gap-0.5">
                    {star} <Star className="h-2.5 w-2.5 fill-muted-foreground/50 text-muted-foreground/50" />
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-muted/40 overflow-hidden">
                    <div
                      className="h-full bg-amber-400 rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono text-[11px]">{count}</span>
                </div>
              )
            })}
          </div>

          {/* 操作入口 */}
          <div className="flex flex-col items-center md:items-end justify-center">
            {isInstalled ? (
              <Button
                onClick={() => setShowForm(!showForm)}
                className="w-full md:w-auto text-xs h-9 bg-primary text-primary-foreground shadow-sm"
              >
                <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                {myReview ? '修改我的评价' : '发表使用体验'}
              </Button>
            ) : (
              <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 p-3.5 text-center md:text-right max-w-xs">
                <div className="inline-flex items-center gap-1 text-xs font-medium text-foreground mb-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  真实用户防刷保护
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  仅安装过该插件的用户可以撰写评价与评分，避免恶意刷分。
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 撰写/编辑评价表单抽屉（按需加载，见 ReviewForm 定义） */}
      {showForm && isInstalled && (
        <ReviewForm
          myReview={myReview}
          installedVersion={installedVersion}
          rating={rating}
          hoverRating={hoverRating}
          title={title}
          content={content}
          submitting={submitting}
          onRatingChange={setRating}
          onHoverRating={setHoverRating}
          onTitleChange={setTitle}
          onContentChange={setContent}
          onRatingKeyDown={handleRatingKeyDown}
          onCancel={() => setShowForm(false)}
          onSubmit={handleSubmit}
        />
      )}

      {/* 评价列表 */}
      <div className="space-y-3">
        <h4
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between"
          aria-live="polite"
        >
          <span>全部评价 ({total})</span>
          {loading && <span className="text-[11px] font-normal">加载中...</span>}
        </h4>

        {initialLoading ? (
          <div className="space-y-3" aria-label="正在加载用户评价">
            {[0, 1].map((row) => (
              <div key={row} className="rounded-xl border border-border/60 bg-card/70 p-4 space-y-2 animate-pulse">
                <div className="h-3.5 w-28 rounded bg-muted/60" />
                <div className="h-3 w-full rounded bg-muted/40" />
                <div className="h-3 w-2/3 rounded bg-muted/40" />
              </div>
            ))}
          </div>
        ) : !hasReviews ? (
          <div className="rounded-2xl border border-dashed border-border/80 p-8 text-center bg-card/30">
            <MessageSquare className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm font-medium text-foreground">暂无用户评价</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              成为第一位使用并分享体验的用户吧！
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((rev) => (
              <div
                key={rev.id}
                className="rounded-xl border border-border/60 bg-card/70 p-4 space-y-2 backdrop-blur-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`h-3.5 w-3.5 ${
                            star <= rev.rating
                              ? 'fill-amber-400 text-amber-400'
                              : 'fill-muted/30 text-muted-foreground/30'
                          }`}
                        />
                      ))}
                    </div>
                    {rev.title && (
                      <span className="text-xs font-semibold text-foreground truncate max-w-[200px] sm:max-w-md">
                        {rev.title}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground shrink-0 font-mono">
                    {rev.installedVersion && (
                      <span className="px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground text-[10px]">
                        v{rev.installedVersion}
                      </span>
                    )}
                    <span>{new Date(rev.updatedAt || rev.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                {rev.content && (
                  <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {rev.content}
                  </p>
                )}

                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                    <span>已验证真实安装用户</span>
                  </div>
                  <button
                    type="button"
                    aria-expanded={reportingId === rev.id}
                    onClick={() => {
                      setReportingId((prev) => (prev === rev.id ? null : rev.id))
                      setReportReason('')
                    }}
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-rose-500 transition-colors"
                  >
                    <Flag className="h-3 w-3" />
                    举报
                  </button>
                </div>

                                {/* 作者官方回复展示 */}
                {rev.authorReply && (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-primary flex items-center gap-1.5 text-xs">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        作者官方回复
                      </span>
                      {rev.authorRepliedAt && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {new Date(rev.authorRepliedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap text-[11px]">
                      {rev.authorReply}
                    </p>
                  </div>
                )}

                {/* 作者写回复输入框 */}
                {replyingId === rev.id && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                    <p className="text-[11px] text-foreground font-medium flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-primary" />
                      作为插件作者发表回复：
                    </p>
                    <Textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="解释说明、反馈感谢或同步新版本修复进展 (1-1000 字)..."
                      aria-label="作者回复内容"
                      maxLength={1000}
                      rows={2}
                      className="text-xs bg-background resize-none"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => setReplyingId(null)}
                      >
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={replySubmitting || !replyText.trim()}
                        className="h-7 text-[11px]"
                        onClick={() => handleSendAuthorReply(rev.id)}
                      >
                        {replySubmitting ? '正在提交...' : '确认发送回复'}
                      </Button>
                    </div>
                  </div>
                )}

                {reportingId === rev.id && (
                  <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                      请说明这条评价的问题（广告、人身攻击、虚假体验等）。举报只累计计数，由管理员人工复核。
                    </p>
                    <Textarea
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      placeholder="举报原因（2-200 字）"
                      aria-label="举报评价原因"
                      maxLength={200}
                      rows={2}
                      className="text-xs bg-background resize-none"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => setReportingId(null)}
                      >
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-[11px] bg-rose-600 hover:bg-rose-700 text-white"
                        disabled={reportSubmitting}
                        onClick={() => void handleReport(rev.id)}
                      >
                        {reportSubmitting ? '提交中…' : '提交举报'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!initialLoading && hasReviews && items.length < total && (
          <div className="text-center pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loadingMore}
              onClick={() => void loadMore()}
              className="text-xs h-8"
            >
              {loadingMore ? '加载中…' : `加载更多评价（${items.length}/${total}）`}
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
