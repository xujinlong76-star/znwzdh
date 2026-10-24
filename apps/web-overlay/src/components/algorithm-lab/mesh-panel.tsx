'use client'

/**
 * 算法 12：P2P Mesh 去中心化状态向量共识。
 * 从 algorithm-lab.tsx 拆出（第五批 A1）：状态与逻辑原样搬运，行为由
 * algorithm-lab-structure.test.ts 与 e2e/algorithms.spec.ts 双守卫锁定。
 */
import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/registry/new-york/ui/card'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, CheckCircle2, Share2 } from 'lucide-react'
import { type EncryptedVaultPayload, type VaultItem } from '@/lib/vault'
import { type JsonRpcResponse } from '@/lib/webmcp-bridge'
import { type CandidateItem } from '@/lib/federated-recommendation'
import { type SpeculationCandidate } from '@/lib/speculative-prerender'
import { CrdtStore, compareVectorClocks, type VectorClock } from '@/lib/crdt-sync'


export function MeshPanel() {
  /* --- 模块 12：P2P Mesh 共识与 CRDT 状态向量状态 --- */
  const [p2pLog, setP2pLog] = useState<string[]>([
    '初始化 Node-Alpha (客户端 A) 与 Node-Beta (客户端 B)...',
    '等待建立点对点握手通道',
  ])
  const [nodeAStore] = useState(() => {
    const s = new CrdtStore('client-alpha')
    s.addSite({ url: 'https://nextjs.org', title: 'Next.js 15', categoryId: 'framework' })
    return s
  })
  const [nodeBStore] = useState(() => {
    const s = new CrdtStore('client-beta')
    s.addSite({ url: 'https://tauri.app', title: 'Tauri 2.0', categoryId: 'desktop' })
    return s
  })
  const [meshClockA, setMeshClockA] = useState<VectorClock>(() => nodeAStore.getVectorClock())
  const [meshClockB, setMeshClockB] = useState<VectorClock>(() => nodeBStore.getVectorClock())
  const [meshSitesA, setMeshSitesA] = useState(() => nodeAStore.getActiveSites())
  const [meshSitesB, setMeshSitesB] = useState(() => nodeBStore.getActiveSites())

  const handleP2pHandshake = () => {
    const relation = compareVectorClocks(nodeAStore.getVectorClock(), nodeBStore.getVectorClock())
    setP2pLog((prev) => [
      ...prev,
      `[P2P HELLO] 对端比对结果：${relation} (Alpha 时钟: ${JSON.stringify(nodeAStore.getVectorClock())}, Beta 时钟: ${JSON.stringify(nodeBStore.getVectorClock())})`,
      '状态迁移: IDLE -> HANDSHAKE -> SYNCING',
    ])
  }

  const handleP2pExchangeSync = () => {
    const deltaForB = nodeAStore.getDeltaSince(nodeBStore.getVectorClock())
    const deltaForA = nodeBStore.getDeltaSince(nodeAStore.getVectorClock())
    const appliedB = nodeBStore.applyRemoteBatch(deltaForB)
    const appliedA = nodeAStore.applyRemoteBatch(deltaForA)

    setMeshClockA(nodeAStore.getVectorClock())
    setMeshClockB(nodeBStore.getVectorClock())
    setMeshSitesA(nodeAStore.getActiveSites())
    setMeshSitesB(nodeBStore.getActiveSites())

    setP2pLog((prev) => [
      ...prev,
      `[P2P DELTA_BATCH] 双向差量收敛：Alpha 应用了 ${appliedA} 个增量，Beta 应用了 ${appliedB} 个增量。`,
      `[P2P ACK] 双方最终时钟已达成一致！状态已进入 READY。`,
    ])
  }

  return (
    <div className="space-y-4">
          <Card className="nav-card-glow border-border/70 shadow-xs overflow-hidden">
            <CardHeader className="bg-muted/15 border-b border-border/50 pb-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-teal-500/10 text-teal-500">
                      <Share2 className="w-4 h-4" />
                    </div>
                    <span>P2P Mesh 去中心化 CRDT 状态向量共识测试台</span>
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs sm:text-sm">
                    模拟客户端无中心节点点对点直连（WebRTC DataChannel），通过状态向量时钟实现离线书签创建与双向最终一致性收敛。
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-teal-500 border-teal-500/30 bg-teal-500/5 text-xs font-mono">
                  Vector Clock P2P
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5 sm:p-6 space-y-6">
              {/* 双节点状态对比 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-teal-600 dark:text-teal-400">Node-Alpha (手机端)</span>
                    <Badge variant="secondary" className="text-[10px] font-mono">
                      时钟: {JSON.stringify(meshClockA)}
                    </Badge>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-[11px] text-muted-foreground">活跃书签集合：</span>
                    {meshSitesA.map((s) => (
                      <div key={s.id} className="p-2 rounded bg-background border border-border/40 text-xs flex justify-between">
                        <span className="font-medium">{s.title}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{s.url}</span>
                      </div>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      nodeAStore.addSite({ url: `https://alpha-${Date.now()}.dev`, title: `Alpha 记录 #${meshSitesA.length + 1}`, categoryId: 'tools' })
                      setMeshClockA(nodeAStore.getVectorClock())
                      setMeshSitesA(nodeAStore.getActiveSites())
                    }}
                    className="text-xs h-7 w-full"
                  >
                    + Alpha 新建本地书签 (时钟递增)
                  </Button>
                </div>

                <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-teal-600 dark:text-teal-400">Node-Beta (平板端)</span>
                    <Badge variant="secondary" className="text-[10px] font-mono">
                      时钟: {JSON.stringify(meshClockB)}
                    </Badge>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-[11px] text-muted-foreground">活跃书签集合：</span>
                    {meshSitesB.map((s) => (
                      <div key={s.id} className="p-2 rounded bg-background border border-border/40 text-xs flex justify-between">
                        <span className="font-medium">{s.title}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{s.url}</span>
                      </div>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      nodeBStore.addSite({ url: `https://beta-${Date.now()}.dev`, title: `Beta 记录 #${meshSitesB.length + 1}`, categoryId: 'tools' })
                      setMeshClockB(nodeBStore.getVectorClock())
                      setMeshSitesB(nodeBStore.getActiveSites())
                    }}
                    className="text-xs h-7 w-full"
                  >
                    + Beta 新建本地书签 (时钟递增)
                  </Button>
                </div>
              </div>

              {/* P2P 共识动作 */}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={handleP2pHandshake}
                  className="text-xs h-8 bg-teal-600 hover:bg-teal-700 text-white gap-1.5"
                >
                  <Share2 className="w-3.5 h-3.5" /> 1. 发送 HELLO 握手 (比对时钟)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleP2pExchangeSync}
                  className="text-xs h-8 border-teal-500/40 text-teal-600 dark:text-teal-400 gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> 2. 交换 DELTA_BATCH 增量 (自动收敛)
                </Button>
              </div>

              {/* 实时通讯报文日志流 */}
              <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-teal-500 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    P2P Mesh 通信与状态机流转日志：
                  </span>
                  <span className="font-mono text-muted-foreground text-[11px]">
                    共 {p2pLog.length} 条记录
                  </span>
                </div>
                <div className="p-3.5 rounded-lg bg-background border border-border/50 text-[11px] font-mono space-y-1 overflow-x-auto text-foreground/90 max-h-48">
                  {p2pLog.map((log, i) => (
                    <div key={i} className="text-muted-foreground">
                      <span className="text-teal-500 font-bold">&gt;</span> {log}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
    </div>
  )
}
