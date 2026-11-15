'use client'

/**
 * 跨设备接力云端接线 Hook（Batch 3 第 9 项，D 组）。
 *
 * 一处接线，供两处复用：播放器页（D1 断点上报 + D2/D3 合并与上传，
 * 深链直达播放器时续播也要对）与接力卡外壳（D2/D3/D4）。
 *
 *  - D1：dispatchVideoProgress——播放器节流写 / flush 写本机断点的
 *    同时，把同一份位置以 UPSERT_VIDEO_PROGRESS 发往云端。只在已
 *    登录时派发；匿名时直接丢弃，不产生任何云端请求。
 *  - D2：启动合并——首次云端拉取完成后，把云端断点按 LWW 合入本机
 *    播放历史（规则见 lib/handoff-sync.ts），本机 getResumePosition
 *    随即能续播另一设备的断点。云端拉取中 / 失败时不合入、不编造。
 *  - D3：登录后首次上传——同一登录会话内只跑一次：本机有、云端没有
 *    或本机更新的断点一次性上传（去重见 lib/handoff-sync.ts）。
 *    启动时已登录且云端已含这些断点时，去重结果为空，一条也不发。
 *  - D4：deleteCloudProgress——用户在卡上清除某条视频时，除本机
 *    删除外再发 DELETE_VIDEO_PROGRESS；只在已登录时派发。
 *
 * 已知缺口（不伪装已解决，留给后续轮次）：云端删除只清云端规约态，
 * 另一设备本机历史里那条记录还在（规约态分不清「云端从未有过」与
 * 「已被删」），该设备的 D3 也可能在新会话里把它重新上传——彻底修
 * 需要读操作日志里的删除墓碑，本轮不上。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useCrdtRoaming } from '@/hooks/use-crdt-roaming'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import {
  buildVideoProgressPayload,
  firstUploadFlagKey,
  selectLocalProgressToUpload,
  selectRemoteProgressToMerge,
  toHandoffVideoProgress,
  type VideoProgressDispatchInput,
} from '@/lib/handoff-sync'
import type { HandoffCloudStatus } from '@/components/handoff-card'
import type { HandoffVideoProgress } from '@/lib/handoff'
import {
  getPlaybackHistory,
  savePlaybackPosition,
} from '@/lib/video-playback-storage'

function readSessionFlag(identity: string): boolean {
  try {
    if (typeof window === 'undefined') return false
    return window.sessionStorage.getItem(firstUploadFlagKey(identity)) === '1'
  } catch {
    return false
  }
}

function writeSessionFlag(identity: string): void {
  try {
    if (typeof window === 'undefined') return
    window.sessionStorage.setItem(firstUploadFlagKey(identity), '1')
  } catch {
    // 隐私模式 / 存储被禁：标记写不进，下次挂载会重跑一次去重上传（去重本身保证不重复发）。
  }
}

function clearSessionFlag(identity: string): void {
  try {
    if (typeof window === 'undefined') return
    window.sessionStorage.removeItem(firstUploadFlagKey(identity))
  } catch {
    // ignore
  }
}

export interface HandoffCloudSync {
  isLoggedIn: boolean
  identity: string | null
  /** 云端断点（接力卡 cloudProgress 直传）；未登录时为空数组。 */
  cloudProgress: HandoffVideoProgress[]
  /** 接力卡 cloudStatus 直传；未登录时为 'idle'（调用方不传该值）。 */
  cloudStatus: HandoffCloudStatus
  /** 首次云端拉取已完成（合并与首次上传的闸）。 */
  cloudReady: boolean
  /** D1：上报一条播放断点（已登录才派发，匿名直接丢弃）。 */
  dispatchVideoProgress: (input: VideoProgressDispatchInput) => void
  /** D4：删除一条视频的云端断点（已登录才派发）。 */
  deleteCloudProgress: (videoId: string) => void
}

export function useHandoffCloudSync(): HandoffCloudSync {
  const identityReady = useIdentityReady()
  const isLoggedIn =
    identityReady.ready && !identityReady.isAnonymous && !!identityReady.identity
  const identity = isLoggedIn ? identityReady.identity : null

  // 未登录时 enabled=false：不拉取、不派发、不产生任何云端请求。
  const { status, lastSyncedAt, reducedState, dispatchOp } = useCrdtRoaming({
    enabled: isLoggedIn,
  })

  const cloudReady = isLoggedIn && lastSyncedAt !== null

  const cloudProgress = useMemo<HandoffVideoProgress[]>(
    () => Object.values(reducedState.videoProgress).map(toHandoffVideoProgress),
    [reducedState.videoProgress],
  )

  // 拉取状态只反映「读」：首次拉取完成前 loading，失败 error，之后 ready。
  // 后续推送失败不改这个值——已拉到的云端态依然可信，卡片不应因此消失。
  const cloudStatus: HandoffCloudStatus = !isLoggedIn
    ? 'idle'
    : lastSyncedAt === null
      ? status === 'error' || status === 'offline'
        ? 'error'
        : 'loading'
      : 'ready'

  // D2 启动合并：云端快照就绪后合入本机历史；云端态每次变化都重算，
  // 取舍规则保证已合入的条目下次不再动作（幂等）。按 updatedAt 升序
  // 写回：savePlaybackPosition 每次把条目顶到最前，写完后本机历史
  // 仍按 lastWatchedAt 降序排列。
  useEffect(() => {
    if (!cloudReady) return
    const toMerge = selectRemoteProgressToMerge(
      getPlaybackHistory(),
      Object.values(reducedState.videoProgress),
    ).sort((a, b) => (a.lastWatchedAt ?? 0) - (b.lastWatchedAt ?? 0))
    for (const item of toMerge) savePlaybackPosition(item)
  }, [cloudReady, reducedState.videoProgress])

  // D3 登录后首次上传：同一登录会话内只跑一次；去重后为空时也记标记。
  useEffect(() => {
    if (!cloudReady || !identity) return
    if (readSessionFlag(identity)) return
    const toUpload = selectLocalProgressToUpload(
      getPlaybackHistory(),
      reducedState.videoProgress,
    )
    for (const item of toUpload) {
      void dispatchOp(
        'UPSERT_VIDEO_PROGRESS',
        item.videoId,
        buildVideoProgressPayload({
          videoId: item.videoId,
          title: item.title,
          author: item.author,
          cover: item.cover,
          platform: item.platform,
          timestampSec: item.timestampSec,
          durationSec: item.durationSec,
          updatedAt: item.lastWatchedAt,
        }),
      )
    }
    writeSessionFlag(identity)
  }, [cloudReady, identity, reducedState.videoProgress, dispatchOp])

  // 退出登录时清除该身份的首次上传标记：下次再登录是新的登录会话，
  // 匿名期间攒下的本机断点应当重新上传（去重保证云端已有的不重复发）。
  const prevIdentityRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevIdentityRef.current
    if (prev && prev !== identity) clearSessionFlag(prev)
    prevIdentityRef.current = identity
  }, [identity])

  const dispatchVideoProgress = useCallback(
    (input: VideoProgressDispatchInput) => {
      if (!isLoggedIn) return
      void dispatchOp('UPSERT_VIDEO_PROGRESS', input.videoId, buildVideoProgressPayload(input))
    },
    [isLoggedIn, dispatchOp],
  )

  const deleteCloudProgress = useCallback(
    (videoId: string) => {
      if (!isLoggedIn || !videoId) return
      void dispatchOp('DELETE_VIDEO_PROGRESS', videoId, { updatedAt: Date.now() })
    },
    [isLoggedIn, dispatchOp],
  )

  return {
    isLoggedIn,
    identity,
    cloudProgress,
    cloudStatus,
    cloudReady,
    dispatchVideoProgress,
    deleteCloudProgress,
  }
}
