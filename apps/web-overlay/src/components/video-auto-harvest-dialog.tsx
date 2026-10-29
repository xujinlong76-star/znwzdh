'use client'

import React, { useState } from 'react'
import {
  CURATED_TRENDING_TOPICS,
  type TrendingHarvestResult,
} from '@/lib/video-trending-harvester'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Flame, Sparkles, CheckCircle2, RefreshCw, Terminal, Layers } from 'lucide-react'
import { formatDuration } from '@/lib/video-format'
import { cn } from '@/lib/utils'
import { ensureAdminSession } from '@/lib/client-auto-auth'

interface VideoAutoHarvestDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onHarvestCompleted?: () => void
}

export function VideoAutoHarvestDialog({
  open,
  onOpenChange,
  onHarvestCompleted,
}: VideoAutoHarvestDialogProps) {
  const [isHarvesting, setIsHarvesting] = useState<boolean>(false)
  const [logs, setLogs] = useState<string[]>([])
  const [result, setResult] = useState<TrendingHarvestResult | null>(null)

  const handleStartHarvest = async () => {
    setIsHarvesting(true)
    setLogs([
      '[Harvester] 启动全网多源技术热点雷达...',
      '[Auth] 正在验证管理员调度会话安全通行凭证...',
    ])

    // 自动激活管理员会话（本地开发与免密模式下无缝签发）
    await ensureAdminSession()

    setLogs(prev => [
      ...prev,
      '[Harvester] 正在扫描全网开发者前沿高分视频 (B站/YouTube/技术社区)...',
    ])

    try {
      // 1. 发起真实全网热点采集与过时内容平滑轮换
      const response = await fetch('/api/videos/harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      })

      if (!response.ok) {
        throw new Error(`服务端采集调度返回 HTTP ${response.status}`)
      }

      const json = await response.json()
      const report = json.report

      setLogs(prev => [
        ...prev,
        `[Analysis] 扫描全部分类已完成，捕获候选视频 ${report?.totalHarvestedCount || 0} 部。`,
        `[Filter & AI Scoring] 质量模型审核完成，新增优质视频 ${report?.totalAddedCount || 0} 部，淘汰过时内容 ${report?.totalReplacedCount || 0} 部。`,
      ])

      const res: TrendingHarvestResult = {
        timestamp: report?.timestamp || Date.now(),
        harvestedCount: (report?.totalAddedCount || 0) + (report?.totalReplacedCount || 0),
        categoriesEnriched: (report?.categorySummaries || [])
          .filter((c: any) => c.addedCount > 0 || c.replacedCount > 0)
          .map((c: any) => c.categoryTitle),
        topDiscoveredVideos: (report?.additions || []).slice(0, 8).map((a: any) => ({
          title: a.item?.title || '新采集视频',
          category: a.categoryTitle,
          author: a.item?.videoConfig?.author || '开发者讲师',
          hotIndex: a.item?.videoConfig?.qualityScore || 85,
          durationSec: a.item?.videoConfig?.durationSec || 600,
        })),
      }

      // 如果新增和替换均为0，展示库内最新热点视频
      if (res.topDiscoveredVideos.length === 0 && CURATED_TRENDING_TOPICS.length > 0) {
        res.topDiscoveredVideos = CURATED_TRENDING_TOPICS.slice(0, 5).map(t => ({
          title: t.recommendedTitle,
          category: t.domain,
          author: t.author,
          hotIndex: t.hotIndex,
          durationSec: t.durationSec,
        }))
      }

      setLogs(prev => [
        ...prev,
        `✅ [Completed] 热点采集入库成功！网站视频库已同步至最新演进状态。`,
      ])
      setResult(res)
      if (onHarvestCompleted) onHarvestCompleted()
    } catch (err: any) {
      setLogs(prev => [
        ...prev,
        `❌ [Error] 采集流水线异常: ${err?.message || err}`,
      ])
    } finally {
      setIsHarvesting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Flame className="w-5 h-5 text-amber-500 fill-amber-500" />
            <span>自动全网热点视频采集与内容丰富引擎</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <p className="text-muted-foreground leading-relaxed">
            实时聚合多平台开发者前沿热点（DeepSeek、React 19、Cilium eBPF、Rust 2024、AI SaaS 出海），智能评分、提取章节并丰富网站视频库。
          </p>

          <div className="p-3 rounded-lg border border-border/50 bg-muted/30 font-mono text-[11px] space-y-1 max-h-36 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-muted-foreground">就绪。点击下方“立即全网采集”启动采集流水线。</p>
            ) : (
              logs.map((l, i) => (
                <p key={i} className="text-foreground leading-snug">
                  {l}
                </p>
              ))
            )}
          </div>

          {result && (
            <div className="space-y-2 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
              <div className="flex items-center justify-between font-semibold text-emerald-400">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>最新采集入库内容 ({result.harvestedCount} 部)</span>
                </span>
                <span className="text-[11px] font-mono">
                  涉及 {result.categoriesEnriched.length} 个分类
                </span>
              </div>

              <div className="space-y-1.5 pt-1">
                {result.topDiscoveredVideos.map((v, i) => (
                  <div
                    key={i}
                    className="p-2 rounded bg-background border border-border/40 flex items-center justify-between text-xs"
                  >
                    <div className="space-y-0.5 max-w-[70%]">
                      <p className="font-medium text-foreground line-clamp-1">{v.title}</p>
                      <p className="text-[10px] text-muted-foreground">导师: {v.author}</p>
                    </div>
                    <div className="text-right font-mono text-[11px]">
                      <span className="text-amber-400 font-bold">热度 {v.hotIndex}</span>
                      <p className="text-[10px] text-muted-foreground">{formatDuration(v.durationSec)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button
              size="sm"
              className="gap-1.5 font-semibold bg-amber-500 hover:bg-amber-600 text-black"
              onClick={handleStartHarvest}
              disabled={isHarvesting}
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isHarvesting && 'animate-spin')} />
              <span>{isHarvesting ? '正在采集清洗中...' : '立即全网采集'}</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
