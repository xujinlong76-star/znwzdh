'use client'

import { useState } from 'react'
import { reportPlugin } from '@/lib/navhub-api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { AlertCircle, Flag } from 'lucide-react'
import { toast } from 'sonner'

export interface PluginReportModalProps {
  slug: string
  pluginName: string
  identity?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const COMMON_REASONS = [
  '包含侵权或未经授权的网址/资源',
  '大量失效链接或死链',
  '包含恶意诈骗或钓鱼网站诱导',
  '元数据与实际内容严重不符',
]

export function PluginReportModal({
  slug,
  pluginName,
  identity,
  open,
  onOpenChange,
}: PluginReportModalProps) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = reason.trim()
    if (!trimmed) {
      toast.error('请填写或选择举报原因')
      return
    }

    setLoading(true)
    try {
      await reportPlugin(slug, trimmed, identity)
      toast.success('感谢反馈，举报已成功提交至管理员审核队列')
      setReason('')
      onOpenChange(false)
    } catch (err) {
      toast.error('举报提交失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <div className="flex items-center gap-2 text-amber-500">
              <Flag className="w-5 h-5" />
              <DialogTitle className="text-base font-semibold text-foreground">
                举报插件「{pluginName}」
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground pt-1">
              为了共同维护纯净、安全的导航社区环境，请客观描述您发现的问题。
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-3">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-foreground">快速选择常见原因：</div>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_REASONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setReason(item)}
                    className="text-[11px] px-2 py-1 rounded-md border border-border/60 bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground text-left transition-colors"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 pt-2">
              <label htmlFor="report-detail-reason" className="text-xs font-medium text-foreground block">详细说明：</label>
              <textarea
                id="report-detail-reason"
                aria-label="详细说明"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="请补充具体违规说明或证据链接…"
                rows={4}
                className="w-full text-xs rounded-lg border border-border/80 bg-background p-2.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:ring-2 focus:ring-primary/40 resize-none"
                maxLength={500}
                required
              />
              <div className="flex justify-between text-[10px] text-muted-foreground/80">
                <span>理由不能为空</span>
                <span>{reason.length}/500</span>
              </div>
            </div>
          </div>

          <DialogFooter className="flex sm:justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg border border-border/60 hover:bg-muted/60 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !reason.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {loading ? '提交中…' : '提交举报'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
