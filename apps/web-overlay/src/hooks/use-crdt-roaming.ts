'use client'

/**
 * CRDT 零冲突多端协同漫游 Hook (Local-First Op-Log CRDT Roaming Hook)
 *
 * 结合 BroadcastChannel 跨标签页瞬时总线与云端 /api/crdt/sync 原子合并，
 * 实现毫秒级同端多 Tab 广播与跨设备因果收敛。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CrdtStore,
  createCRDTOperation,
  mergeOperationLogs,
  reduceOperationsToState,
  type CRDTOperation,
  type CRDTOpType,
  type CRDTReducedState,
} from '@/lib/crdt-sync'
import { fetchCrdtSync, pushCrdtSync } from '@/lib/navhub-api'
import { getIdentity } from '@/lib/identity'
import { CrdtPresence, PEER_HEARTBEAT_MS } from '@/lib/crdt-presence'

export type CrdtSyncStatus = 'synced' | 'syncing' | 'offline' | 'error'

const BROADCAST_CHANNEL_NAME = 'navhub-crdt-sync-channel'

export function useCrdtRoaming() {
  const [status, setStatus] = useState<CrdtSyncStatus>('synced')
  const [peerCount, setPeerCount] = useState(1)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const [reducedState, setReducedState] = useState<CRDTReducedState>({
    pinnedCategoryIds: [],
    categoryOrder: [],
    pinnedSiteIdsByCategory: {},
    customCategories: [],
  })

  const clientIdRef = useRef<string>('')
  // 每次 hook 实例化一个 instanceId：同 tab 双实例（桌面 Sidebar + 移动端
  // 抽屉各挂一个胶囊）共享同一个 sessionStorage clientId，必须靠实例 id
  // 区分消息来源；计数口径见 @/lib/crdt-presence。
  const instanceIdRef = useRef<string>('')
  const presenceRef = useRef<CrdtPresence | null>(null)
  const storeRef = useRef<CrdtStore | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const pendingOpsRef = useRef<CRDTOperation[]>([])

  // 初始化 ClientId 与 CrdtStore
  useEffect(() => {
    if (typeof window === 'undefined') return

    let cid = sessionStorage.getItem('navhub_crdt_client_id')
    if (!cid) {
      cid = 'client_' + Math.random().toString(36).slice(2, 9)
      sessionStorage.setItem('navhub_crdt_client_id', cid)
    }
    clientIdRef.current = cid
    // instanceId 每次实例化随机生成：同 tab 双实例靠它区分，计数时只按
    // clientId 去重（见 crdt-presence 注释），所以这里不参与计数键。
    const instanceId = 'inst_' + Math.random().toString(36).slice(2, 9)
    instanceIdRef.current = instanceId
    presenceRef.current = new CrdtPresence(cid)
    storeRef.current = new CrdtStore(cid)

    // 过期扫除后刷新计数（只在集合变化时才 setState，避免无谓重渲染）。
    const refreshCount = () => {
      const presence = presenceRef.current
      if (!presence) return
      if (presence.prune(Date.now())) {
        setPeerCount(presence.peerCount)
      }
    }

    // 初始化跨标签页 BroadcastChannel
    let heartbeat: number | undefined
    let channel: BroadcastChannel | null = null
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
        channelRef.current = channel

        channel.onmessage = (event) => {
          const msg = event.data
          const presence = presenceRef.current
          if (!presence) return
          if (msg?.type === 'CRDT_OP_BROADCAST' && Array.isArray(msg.operations)) {
            // 收到同浏览器其他标签页推送的操作流
            const incoming = msg.operations as CRDTOperation[]
            storeRef.current?.applyRemoteBatch(incoming)
            setReducedState(reduceOperationsToState(storeRef.current?.getOperations() || []))
            // 发操作的远端 tab 一定活着：按 clientId 记一次即可。
            // 不再采信对方报来的 peerCount（旧代码 Math.max 会跨标签传染虚高）。
            if (presence.noteMessage(msg, Date.now())) {
              setPeerCount(presence.peerCount)
            }
          } else if (msg?.type === 'CRDT_PING') {
            // 收到探活即回 PONG（也顺带记下对方活着，PONG 丢了也不影响计数）。
            const isNewPeer = presence.noteMessage(msg, Date.now())
            channel?.postMessage({ type: 'CRDT_PONG', clientId: cid, instanceId })
            if (isNewPeer) setPeerCount(presence.peerCount)
          } else if (msg?.type === 'CRDT_PONG') {
            // 只按 clientId 去重记存活：重复 PONG 只刷新时间戳，不虚增；
            // 同 tab 另一实例的 PONG 与自己同 clientId，直接忽略。
            if (presence.noteMessage(msg, Date.now())) {
              setPeerCount(presence.peerCount)
            }
          }
        }

        // 发送探活 PING
        channel.postMessage({ type: 'CRDT_PING', clientId: cid, instanceId })
        // 心跳：每 5 秒重发 PING（让后加入的标签页发现自己），顺带过期扫除，
        // 15 秒未见的标签页摘除后计数回落。
        heartbeat = window.setInterval(() => {
          channel?.postMessage({ type: 'CRDT_PING', clientId: cid, instanceId })
          refreshCount()
        }, PEER_HEARTBEAT_MS)
      } catch {
        // BroadcastChannel 降级
      }
    }

    return () => {
      if (heartbeat !== undefined) window.clearInterval(heartbeat)
      channel?.close()
      channelRef.current = null
    }
  }, [])

  // 从服务端拉取初始操作日志与状态
  const syncWithServer = useCallback(async () => {
    setStatus('syncing')
    try {
      const identity = getIdentity()
      const res = await fetchCrdtSync(identity)
      if (res.ok && Array.isArray(res.operations)) {
        if (storeRef.current) {
          storeRef.current.applyRemoteBatch(res.operations)
          const allOps = storeRef.current.getOperations()
          setReducedState(reduceOperationsToState(allOps))
        }
        setLastSyncedAt(Date.now())
        setStatus('synced')
      } else {
        setStatus('offline')
      }
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void syncWithServer()
  }, [syncWithServer])

  // 提交并广播原子操作
  const dispatchOp = useCallback(
    async <T = any>(type: CRDTOpType, entityId: string, payload: T) => {
      const cid = clientIdRef.current || 'client_anon'
      const op = createCRDTOperation(type, entityId, payload, cid)

      // 1. 本地 Store 立即入队与状态规约响应（0 延迟）
      if (storeRef.current) {
        storeRef.current.applyRemoteBatch([op])
        setReducedState(reduceOperationsToState(storeRef.current.getOperations()))
      }

      // 2. 跨标签页瞬时广播 (< 5ms)
      // 不再随广播带 peerCount：接收方只按 clientId 记 presence，
      // 不采信任何一方自报的计数（旧代码 Math.max 会跨标签传染虚高）。
      channelRef.current?.postMessage({
        type: 'CRDT_OP_BROADCAST',
        operations: [op],
        clientId: cid,
        instanceId: instanceIdRef.current,
      })

      // 3. 异步回写云端服务端合流
      pendingOpsRef.current.push(op)
      setStatus('syncing')
      try {
        const identity = getIdentity()
        const res = await pushCrdtSync(pendingOpsRef.current, identity)
        if (res.ok) {
          pendingOpsRef.current = []
          setLastSyncedAt(Date.now())
          setStatus('synced')
        }
      } catch {
        setStatus('offline')
      }
    },
    []
  )

  return {
    status,
    peerCount,
    lastSyncedAt,
    reducedState,
    dispatchOp,
    syncWithServer,
  }
}
