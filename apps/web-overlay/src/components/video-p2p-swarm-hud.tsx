'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  P2PVideoSwarmManager,
  type SwarmTelemetry,
} from '@/lib/video-p2p-chunk-swarm'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Network, Zap, ShieldCheck, ArrowDownCircle, ArrowUpCircle, Radio } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoP2PSwarmHudProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  totalChunks?: number
}

export function VideoP2PSwarmHud({
  open,
  onOpenChange,
  totalChunks = 24,
}: VideoP2PSwarmHudProps) {
  const swarmRef = useRef<P2PVideoSwarmManager>(new P2PVideoSwarmManager(totalChunks))
  const [telemetry, setTelemetry] = useState<SwarmTelemetry>(() => swarmRef.current.getTelemetry())
  const [bitfield, setBitfield] = useState<boolean[]>(() => swarmRef.current.getLocalBitfield())

  useEffect(() => {
    // Register some virtual peers
    swarmRef.current.registerPeer('peer-tokyo-node-1')
    swarmRef.current.registerPeer('peer-shanghai-node-2')
    swarmRef.current.registerPeer('peer-singapore-node-3')

    // Simulate chunk acquisition
    let currentIdx = 0
    const timer = setInterval(async () => {
      if (!open) return
      if (currentIdx < totalChunks) {
        await swarmRef.current.acquireChunk(currentIdx, 512 * 1024, Math.random() > 0.25)
        currentIdx++
        setTelemetry(swarmRef.current.getTelemetry())
        setBitfield(swarmRef.current.getLocalBitfield())
      }
    }, 600)

    return () => clearInterval(timer)
  }, [open, totalChunks])

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Network className="w-5 h-5 text-primary" />
            <span>WebRTC P2P-CDN 混合分片传输遥测 (BitTorrent Swarm)</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2.5 rounded-lg border border-border/50 bg-card text-center space-y-1">
              <span className="text-[10px] text-muted-foreground">P2P 减负率</span>
              <p className="text-base font-bold text-emerald-400 font-mono">
                {Math.round(telemetry.p2pOffloadRatio * 100)}%
              </p>
            </div>
            <div className="p-2.5 rounded-lg border border-border/50 bg-card text-center space-y-1">
              <span className="text-[10px] text-muted-foreground">P2P 节省流量</span>
              <p className="text-base font-bold text-primary font-mono">
                {formatBytes(telemetry.p2pBytes)}
              </p>
            </div>
            <div className="p-2.5 rounded-lg border border-border/50 bg-card text-center space-y-1">
              <span className="text-[10px] text-muted-foreground">活跃对等节点</span>
              <p className="text-base font-bold text-sky-400 font-mono">
                {telemetry.activePeersCount} 节点
              </p>
            </div>
            <div className="p-2.5 rounded-lg border border-border/50 bg-card text-center space-y-1">
              <span className="text-[10px] text-muted-foreground">集群均摊延迟</span>
              <p className="text-base font-bold text-amber-400 font-mono">
                {telemetry.averageSwarmLatencyMs} ms
              </p>
            </div>
          </div>

          {/* Chunk Bitfield Map */}
          <div className="space-y-2 p-3 rounded-lg border border-border/50 bg-muted/20">
            <div className="flex items-center justify-between text-[11px] font-semibold">
              <span>视频切片位图缓存分布 ({telemetry.downloadedChunksCount} / {totalChunks})</span>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded bg-emerald-500 inline-block" /> P2P
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded bg-blue-500 inline-block" /> CDN
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded bg-muted-foreground/30 inline-block" /> 待调度
                </span>
              </div>
            </div>

            <div className="grid grid-cols-8 sm:grid-cols-12 gap-1.5 pt-1">
              {bitfield.map((hasChunk, idx) => (
                <div
                  key={idx}
                  title={`分片 #${idx + 1}: ${hasChunk ? '已就绪' : '缓冲中'}`}
                  className={cn(
                    'h-6 rounded text-[10px] font-mono flex items-center justify-center font-bold transition-all',
                    hasChunk
                      ? idx % 3 === 0
                        ? 'bg-blue-600/80 text-white'
                        : 'bg-emerald-600/80 text-white'
                      : 'bg-muted/60 text-muted-foreground border border-border/40'
                  )}
                >
                  {idx + 1}
                </div>
              ))}
            </div>
          </div>

          {/* Swarm Security & Protocol Note */}
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-primary/5 border border-primary/20 text-muted-foreground">
            <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed">
              每个切片在端侧校验 SHA-256 哈希完整性，遇超时或坏块自动毫秒级切换至原站 CDN 镜像，保障播放流畅零卡顿。
            </p>
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={() => onOpenChange(false)}>
              关闭面板
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
