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
    storeRef.current = new CrdtStore(cid)

    // 初始化跨标签页 BroadcastChannel
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
        channelRef.current = channel

        channel.onmessage = (event) => {
          const msg = event.data
          if (msg?.type === 'CRDT_OP_BROADCAST' && Array.isArray(msg.operations)) {
            // 收到同浏览器其他标签页推送的操作流
            const incoming = msg.operations as CRDTOperation[]
            storeRef.current?.applyRemoteBatch(incoming)
            setReducedState(reduceOperationsToState(storeRef.current?.getOperations() || []))
            setPeerCount((prev) => Math.max(prev, Number(msg.peerCount) || 2))
          } else if (msg?.type === 'CRDT_PING') {
            channel.postMessage({ type: 'CRDT_PONG', clientId: cid })
          } else if (msg?.type === 'CRDT_PONG') {
            setPeerCount((prev) => Math.min(prev + 1, 8))
          }
        }

        // 发送探活 PING
        channel.postMessage({ type: 'CRDT_PING', clientId: cid })
      } catch {
        // BroadcastChannel 降级
      }
    }

    return () => {
      channelRef.current?.close()
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
      channelRef.current?.postMessage({
        type: 'CRDT_OP_BROADCAST',
        operations: [op],
        clientId: cid,
        peerCount,
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
    [peerCount]
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
