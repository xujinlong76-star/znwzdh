'use client'

import type { FormEvent, KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Star, UserCheck } from 'lucide-react'
import type { HubPluginReviewsResponse } from '@/lib/navhub-api'

/**
 * 撰写/修改评价表单（按需加载）。
 *
 * 表单只在用户点「发表使用体验」后出现，静态留在详情页 chunk 里会白白占首屏预算
 * （CI 实测 /marketplace/[slug] 因此超预算）。状态与提交逻辑仍留在
 * plugin-review-section，本组件只负责渲染，避免两处各自维护评分状态。
 */
export interface ReviewFormProps {
  myReview: HubPluginReviewsResponse['myReview']
  installedVersion?: string | null
  rating: number
  hoverRating: number | null
  title: string
  content: string
  submitting: boolean
  onRatingChange: (value: number) => void
  onHoverRating: (value: number | null) => void
  onTitleChange: (value: string) => void
  onContentChange: (value: string) => void
  onRatingKeyDown: (event: KeyboardEvent<HTMLButtonElement>, star: number) => void
  onCancel: () => void
  onSubmit: (event: FormEvent) => void
}

const RATING_LABELS: Record<number, string> = {
  5: '🌟 超出预期',
  4: '👍 体验良好',
  3: '👌 符合预期',
  2: '👎 有待提升',
  1: '⚠️ 体验较差',
}

export function ReviewForm({
  myReview,
  installedVersion,
  rating,
  hoverRating,
  title,
  content,
  submitting,
  onRatingChange,
  onHoverRating,
  onTitleChange,
  onContentChange,
  onRatingKeyDown,
  onCancel,
  onSubmit,
}: ReviewFormProps) {
  return (
    <form
      onSubmit={onSubmit}
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

      {myReview?.status === 'hidden' && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
          这条评价已被管理员隐藏，其他用户暂时看不到；修改后不会自动恢复，如需申诉请通过举报/反馈渠道联系管理员。
        </p>
      )}

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
          整体满意度评分 *
        </label>
        <div role="radiogroup" aria-label="整体满意度评分" className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5].map((star) => {
            const active = (hoverRating ?? rating) >= star
            return (
              <button
                type="button"
                role="radio"
                aria-checked={rating === star}
                aria-label={`${star} 星`}
                data-rating={star}
                tabIndex={rating === star ? 0 : -1}
                key={star}
                onMouseEnter={() => onHoverRating(star)}
                onMouseLeave={() => onHoverRating(null)}
                onFocus={() => onHoverRating(star)}
                onBlur={() => onHoverRating(null)}
                onKeyDown={(event) => onRatingKeyDown(event, star)}
                onClick={() => onRatingChange(star)}
                className="p-1 hover:scale-110 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
              >
                <Star
                  className={`h-6 w-6 transition-colors ${
                    active ? 'fill-amber-400 text-amber-400' : 'fill-muted/30 text-muted-foreground/30'
                  }`}
                />
              </button>
            )
          })}
          <span className="ml-2 text-xs font-semibold text-amber-500">{RATING_LABELS[rating]}</span>
        </div>
      </div>

      <div>
        <label htmlFor="review-title" className="block text-xs font-medium text-muted-foreground mb-1.5">
          一句话亮点或总结（可选）
        </label>
        <Input
          id="review-title"
          aria-label="一句话亮点或总结（可选）"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="例如：界面优雅，收录的开发者资源非常齐全！"
          maxLength={100}
          className="text-xs h-9 bg-background"
        />
      </div>

      <div>
        <label htmlFor="review-content" className="block text-xs font-medium text-muted-foreground mb-1.5">
          具体使用心得或改进建议（可选）
        </label>
        <Textarea
          id="review-content"
          aria-label="具体使用心得或改进建议（可选）"
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder="分享您的真实使用场景，帮助其他开发者选择此插件..."
          rows={3}
          maxLength={1000}
          className="text-xs bg-background resize-none"
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} className="text-xs h-8">
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
  )
}
