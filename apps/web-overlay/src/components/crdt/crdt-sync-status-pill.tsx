'use client'

/**
 * CRDT 多端协同状态浮动微胶囊 (CRDT Sync Status Pill)
 *
 * 直观指示当前终端与其他客户端（或多浏览器标签页）的 CRDT 向量时钟合流状态，
 * 支持点击查看当前同步日志数与手动即时合流。
 */
import { useState } from 'react'
import {
  CheckCircle2,
  Clock,
  Layers,
  Loader2,
  RefreshCw,
  Share2,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useCrdtRoaming } from '@/hooks/use-crdt-roaming'

export function CrdtSyncStatusPill() {
  const { status, peerCount, lastSyncedAt, reducedState, syncWithServer } = useCrdtRoaming()
  const [open, setOpen] = useState(false)
  const [manualSyncing, setManualSyncing] = useState(false)

  const handleManualSync = async () => {
    setManualSyncing(true)
    try {
      await syncWithServer()
    } finally {
      setManualSyncing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="查看多端 CRDT 协同状态"
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-xs text-muted-foreground transition-all hover:bg-muted/80 hover:text-foreground shadow-sm"
        >
          {status === 'synced' ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          ) : status === 'syncing' ? (
            <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-amber-500" />
          )}

          <span className="text-[11px] font-medium hidden sm:inline">
            {status === 'synced'
              ? peerCount > 1
                ? `${peerCount} 标签页协同中`
                : '多端协同已就绪'
              : status === 'syncing'
              ? '合流中…'
              : '离线就绪'}
          </span>
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Share2 className="h-4 w-4 text-emerald-500" />
            CRDT 零冲突多端协同漫游中枢
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <div className="rounded-lg border bg-muted/30 p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="text-muted-foreground">当前协同状态</span>
              <div className="flex items-center gap-1.5">
                {status === 'synced' ? (
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[11px]">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    已完全收敛 (Converged)
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[11px]">
                    <Wifi className="mr-1 h-3 w-3" />
                    本地优先运行中
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">活跃同端会话 / 标签页</span>
              <span className="font-semibold text-foreground">{peerCount} 个节点</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">最近云端合流时间</span>
              <span className="font-mono text-muted-foreground">
                {lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString('zh-CN') : '尚未上云'}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium text-foreground flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-indigo-500" />
              当前规约状态快照 (Reduced LWW State)
            </h4>
            <div className="rounded-lg border bg-card p-3 space-y-1.5 font-mono text-[11px] text-muted-foreground">
              <div className="flex justify-between">
                <span>置顶分类数量:</span>
                <span className="text-foreground">{reducedState.pinnedCategoryIds.length}</span>
              </div>
              <div className="flex justify-between">
                <span>自定义分类:</span>
                <span className="text-foreground">{reducedState.customCategories.length}</span>
              </div>
              <div className="flex justify-between">
                <span>分类排序权重:</span>
                <span className="text-foreground">{reducedState.categoryOrder.length} 项</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2">
            <span className="text-[11px] text-muted-foreground">
              基于因果一致性与 LWW 确定性时序无损合流
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleManualSync()}
              disabled={manualSyncing}
              className="h-8 sm:h-7 text-xs gap-1.5 w-full sm:w-auto shrink-0"
            >
              {manualSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              即时合流
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
