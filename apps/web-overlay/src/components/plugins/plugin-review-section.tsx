'use client'

import { useState, useEffect } from 'react'
import {
  fetchPluginReviews,
  submitPluginReview,
  type HubPluginReviewItem,
  type HubPluginReviewsResponse,
} from '@/lib/navhub-api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Star, MessageSquare, CheckCircle2, ShieldCheck, UserCheck } from 'lucide-react'
import { toast } from 'sonner'

interface PluginReviewSectionProps {
  slug: string
  isInstalled: boolean
  installedVersion?: string | null
  initialReviews?: HubPluginReviewsResponse | null
}

export function PluginReviewSection({
  slug,
  isInstalled,
  installedVersion,
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
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [hoverRating, setHoverRating] = useState<number | null>(null)
  const [rating, setRating] = useState<number>(5)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 刷新评价列表
  const loadReviews = async () => {
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
  }

  useEffect(() => {
    loadReviews()
  }, [slug])

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

  const { stats, myReview, items, total } = data
  const hasReviews = total > 0

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

      {/* 撰写/编辑评价表单抽屉 */}
      {showForm && isInstalled && (
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-primary/30 bg-card p-5 space-y-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <div className="flex items-center justify-between border-b border-border/50 pb-3">
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-primary" />
              {myReview ? '修改评价' : '撰写使用评价'}
              {installedVersion && (
                <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">
                  体验版本 v{installedVersion}
                </span>
              )}
            </h4>
            <span className="text-xs text-muted-foreground">所有安装用户可见</span>
          </div>

          {/* 星级打分 */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              整体满意度评分 *
            </label>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((star) => {
                const active = (hoverRating ?? rating) >= star
                return (
                  <button
                    type="button"
                    key={star}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(null)}
                    onClick={() => setRating(star)}
                    className="p-1 hover:scale-110 transition-transform focus:outline-none"
                    aria-label={`${star} 星`}
                  >
                    <Star
                      className={`h-6 w-6 transition-colors ${
                        active ? 'fill-amber-400 text-amber-400' : 'fill-muted/30 text-muted-foreground/30'
                      }`}
                    />
                  </button>
                )
              })}
              <span className="ml-2 text-xs font-semibold text-amber-500">
                {rating === 5 && '🌟 超出预期'}
                {rating === 4 && '👍 体验良好'}
                {rating === 3 && '👌 符合预期'}
                {rating === 2 && '👎 有待提升'}
                {rating === 1 && '⚠️ 体验较差'}
              </span>
            </div>
          </div>

          {/* 评价标题 */}
          <div>
            <label htmlFor="review-title" className="block text-xs font-medium text-muted-foreground mb-1.5">
              一句话亮点或总结（可选）
            </label>
            <Input
              id="review-title"
              aria-label="一句话亮点或总结（可选）"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：界面优雅，收录的开发者资源非常齐全！"
              maxLength={100}
              className="text-xs h-9 bg-background"
            />
          </div>

          {/* 评价详情 */}
          <div>
            <label htmlFor="review-content" className="block text-xs font-medium text-muted-foreground mb-1.5">
              具体使用心得或改进建议（可选）
            </label>
            <Textarea
              id="review-content"
              aria-label="具体使用心得或改进建议（可选）"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="分享您的真实使用场景，帮助其他开发者选择此插件..."
              rows={3}
              maxLength={1000}
              className="text-xs bg-background resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowForm(false)}
              className="text-xs h-8"
            >
              取消
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting}
              className="text-xs h-8 bg-primary text-primary-foreground"
            >
              {submitting ? '提交中...' : myReview ? '保存修改' : '提交评价'}
            </Button>
          </div>
        </form>
      )}

      {/* 评价列表 */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
          <span>全部评价 ({total})</span>
          {loading && <span className="text-[11px] font-normal">加载中...</span>}
        </h4>

        {!hasReviews ? (
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

                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70 pt-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  <span>已验证真实安装用户</span>
                  <span className="font-mono text-muted-foreground/50">
                    ({rev.identity.slice(0, 10)}...)
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
