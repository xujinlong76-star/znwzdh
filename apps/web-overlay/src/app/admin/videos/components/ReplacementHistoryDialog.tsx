'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/registry/new-york/ui/badge'
import { useToast } from '@/registry/new-york/hooks/use-toast'
import type { VideoReplacementRecord } from '@/types/navigation'
import { RotateCcw, ArrowRight } from 'lucide-react'

interface ReplacementHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRolledBack?: () => void
}

export function ReplacementHistoryDialog({
  open,
  onOpenChange,
  onRolledBack,
}: ReplacementHistoryDialogProps) {
  const { toast } = useToast()
  const [history, setHistory] = useState<VideoReplacementRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [rollingBackId, setRollingBackId] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      fetchHistory()
    }
  }, [open])

  const fetchHistory = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/videos/history')
      if (!res.ok) throw new Error('Failed to load history')
      const data = await res.json()
      setHistory(data.history || [])
    } catch (err) {
      toast({
        title: '错误',
        description: '加载替换历史失败',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleRollback = async (record: VideoReplacementRecord) => {
    setRollingBackId(record.id)
    try {
      const res = await fetch('/api/videos/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rollback',
          recordId: record.id,
        }),
      })

      if (!res.ok) throw new Error('Failed to rollback')
      const data = await res.json()

      toast({
        title: '回滚成功',
        description: data.message || `已成功还原视频并加锁保护`,
      })

      await fetchHistory()
      onRolledBack?.()
    } catch (err) {
      toast({
        title: '回滚失败',
        description: (err as Error).message || '操作失败',
        variant: 'destructive',
      })
    } finally {
      setRollingBackId(null)
    }
  }

  const getReasonBadge = (reason: VideoReplacementRecord['reason']) => {
    switch (reason) {
      case 'freshness_decay':
        return <Badge variant="destructive" className="text-[11px]">时效自然老化</Badge>
      case 'year_outdated':
        return <Badge variant="destructive" className="text-[11px]">年份旧版本过时</Badge>
      case 'broken':
        return <Badge variant="destructive" className="text-[11px]">原视频失效/删除</Badge>
      case 'hot_superseded':
        return <Badge variant="secondary" className="text-[11px] bg-amber-500/10 text-amber-600 dark:text-amber-400">更优新视频超越</Badge>
      default:
        return <Badge variant="outline" className="text-[11px]">自动替换</Badge>
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>过时视频替换与轮换历史</span>
            <Badge variant="outline" className="text-xs">{history.length} 条记录</Badge>
          </DialogTitle>
          <DialogDescription>
            查看系统自动采集与淘汰替换的审计轨迹；可对误淘汰的经典视频进行一键回滚与锁定保护
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 py-2 space-y-3">
          {loading ? (
            <div className="text-center py-12 text-sm text-muted-foreground">加载历史记录中...</div>
          ) : history.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              暂无视频替换记录（当开启自动采集并在容量满或视频过时后触发替换时会记录于此）
            </div>
          ) : (
            history.map((record) => (
              <div
                key={record.id}
                className="p-3.5 rounded-lg border bg-card text-card-foreground shadow-xs text-xs space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground text-sm">
                      {record.categoryTitle}
                    </span>
                    {getReasonBadge(record.reason)}
                    {record.trendKeyword && (
                      <span className="px-1.5 py-0.5 rounded bg-muted text-[11px] text-muted-foreground">
                        触发热词: {record.trendKeyword}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(record.timestamp).toLocaleString()}
                    </span>
                    {record.rolledBack ? (
                      <Badge variant="outline" className="text-[11px] text-muted-foreground">
                        已回滚
                      </Badge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={rollingBackId === record.id}
                        onClick={() => handleRollback(record)}
                        className="h-7 text-xs gap-1 px-2.5"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>{rollingBackId === record.id ? '还原中...' : '一键还原'}</span>
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-2.5 rounded-md bg-muted/40 border border-border/60">
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground flex items-center justify-between">
                      <span className="text-red-500 font-medium">被淘汰旧内容</span>
                      <span>评分: {record.oldItem.videoConfig?.freshnessScore ?? '未知'}</span>
                    </div>
                    <div className="font-medium text-foreground line-clamp-1">
                      {record.oldItem.title}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      UP主: {record.oldItem.videoConfig?.author || '未知'} · 发布于: {record.oldItem.videoConfig?.publishedAt ? new Date(record.oldItem.videoConfig.publishedAt).toLocaleDateString() : '未知'}
                    </div>
                  </div>

                  <div className="space-y-1 sm:border-l sm:pl-3 sm:border-border/60">
                    <div className="text-[11px] text-muted-foreground flex items-center justify-between">
                      <span className="text-emerald-500 font-medium flex items-center gap-1">
                        <ArrowRight className="h-3 w-3" />
                        新引入优质视频
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        评分: {record.newItem.videoConfig?.freshnessScore ?? '未知'} (+{record.scoreDiff})
                      </span>
                    </div>
                    <div className="font-medium text-foreground line-clamp-1">
                      {record.newItem.title}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      UP主: {record.newItem.videoConfig?.author || '未知'} · 发布于: {record.newItem.videoConfig?.publishedAt ? new Date(record.newItem.videoConfig.publishedAt).toLocaleDateString() : '未知'}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
