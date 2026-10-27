'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  P2PDanmakuMeshCoordinator,
  type MeshTopologyStats,
  type GossipDanmakuMessage,
} from '@/lib/video-p2p-danmaku-mesh'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Network, Send, ShieldCheck, Zap, Radio } from 'lucide-react'

interface VideoDanmakuMeshMonitorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  videoId: string
}

export function VideoDanmakuMeshMonitor({
  open,
  onOpenChange,
  videoId,
}: VideoDanmakuMeshMonitorProps) {
  const coordinatorRef = useRef<P2PDanmakuMeshCoordinator>(new P2PDanmakuMeshCoordinator(videoId))
  const [stats, setStats] = useState<MeshTopologyStats>(() => coordinatorRef.current.getStats())
  const [testText, setTestText] = useState<string>('')
  const [recentMessages, setRecentMessages] = useState<GossipDanmakuMessage[]>([])

  useEffect(() => {
    coordinatorRef.current = new P2PDanmakuMeshCoordinator(videoId)
    const unsubscribe = coordinatorRef.current.onDanmakuReceived((msg) => {
      setRecentMessages(prev => [msg, ...prev.slice(0, 10)])
      setStats(coordinatorRef.current.getStats())
    })
    return () => unsubscribe()
  }, [videoId])

  const handleBroadcast = (e: React.FormEvent) => {
    e.preventDefault()
    if (!testText.trim()) return
    coordinatorRef.current.broadcastDanmaku(testText, 0)
    setTestText('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Network className="w-5 h-5 text-primary" />
            <span>分布式 WebRTC P2P 弹幕信标网格监控</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <p className="text-muted-foreground leading-relaxed">
            基于 WebRTC DataChannel 与布隆过滤器（BloomFilter）去重，在在线学员节点间直连 Gossip 广播弹幕，规避中心服务器洪流风暴。
          </p>

          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="p-2.5 rounded-lg border bg-card space-y-1">
              <div className="text-[10px] text-muted-foreground">直连对等节点</div>
              <div className="text-emerald-500 font-mono font-bold text-base flex items-center justify-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                {stats.connectedPeersCount}
              </div>
            </div>
            <div className="p-2.5 rounded-lg border bg-card space-y-1">
              <div className="text-[10px] text-muted-foreground">中继分发量</div>
              <div className="font-mono font-bold text-foreground text-base">
                {stats.totalRelayedMessages}
              </div>
            </div>
            <div className="p-2.5 rounded-lg border border-primary/20 bg-primary/5 space-y-1">
              <div className="text-[10px] text-primary">布隆过滤去重</div>
              <div className="text-primary font-mono font-bold text-base">
                {stats.deduplicatedCount}
              </div>
            </div>
            <div className="p-2.5 rounded-lg border bg-card space-y-1">
              <div className="text-[10px] text-muted-foreground">平均对等延迟</div>
              <div className="text-cyan-400 font-mono font-bold text-base">
                {stats.averageLatencyMs} ms
              </div>
            </div>
          </div>

          {/* Gossip Broadcast Test Input */}
          <form onSubmit={handleBroadcast} className="flex gap-2">
            <input aria-label="测试弹幕内容"
              type="text"
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              placeholder="发送测试 Gossip 弹幕消息..."
              className="flex-1 px-3 py-1.5 rounded-md bg-muted border border-border/50 text-xs focus:outline-none"
            />
            <Button size="sm" type="submit" className="gap-1 text-xs">
              <Send className="w-3.5 h-3.5" /> 广播
            </Button>
          </form>

          {/* Recent Broadcast Log */}
          <div className="space-y-1.5">
            <div className="font-semibold text-foreground text-[11px] flex items-center justify-between">
              <span>近期待接收/广播弹幕流水</span>
              <span className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-500" /> TokenBucket 频控就绪
              </span>
            </div>
            <div className="p-2.5 rounded-lg border bg-zinc-950 font-mono text-[10px] text-zinc-300 max-h-36 overflow-y-auto space-y-1">
              {recentMessages.length === 0 ? (
                <div className="text-zinc-600 text-center py-4">暂无活动 P2P 弹幕广播，网格信标静默监听中</div>
              ) : (
                recentMessages.map((m) => (
                  <div key={m.id} className="flex items-center justify-between border-b border-zinc-800 pb-0.5">
                    <span className="text-emerald-400">[{m.originPeerId.slice(0, 10)}] {m.text}</span>
                    <span className="text-zinc-500">{new Date(m.timestamp).toLocaleTimeString()}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={() => onOpenChange(false)}>
              确定
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
