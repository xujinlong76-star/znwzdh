/**
 * 跨设备接力云端接线纯规则层（Batch 3 第 9 项，D 组）。
 *
 * 职责：播放器写路径的云端 payload 整形（D1）、云端断点合入本机历史
 * 的取舍（D2 启动合并）、登录后首次上传的去重（D3）、首次上传会话
 * 标记的键。
 *
 * 本模块是纯函数：不读存储、不发请求、不碰 React。存储读写（读本机
 * 历史、写回合并结果、会话标记）由调用方（use-handoff-cloud-sync）
 * 负责；CRDT 操作的派发也由调用方负责。
 *
 * 诚实纪律（与 lib/handoff.ts 同款）：
 *  - 只合入携带真实标题的云端条目；标题缺失的丢弃，绝不编造。
 *  - author / cover 只透传：云端没有时沿用本机已有的，不凭空补。
 *  - LWW 以 updatedAt 为准；未来时间戳（> now + 5min）丢弃。
 *  - 几秒内的位置回退视为另一设备的滞后 flush，不覆盖本机断点。
 */
import { HANDOFF_FUTURE_SKEW_MS } from './handoff'
import type { VideoPlatform, VideoProgress } from './crdt-sync'
import type { HandoffVideoProgress } from './handoff'
import type {
  PlaybackHistoryItem,
  SavePlaybackPositionInput,
} from './video-playback-storage'

/** 启动合并：云端断点比本机断点回退这么多秒以内，视为滞后写入，直接跳过。 */
export const HANDOFF_MERGE_REGRESSION_TOLERANCE_SEC = 10

/** 首次上传会话标记前缀（sessionStorage，登录会话内只跑一次）。 */
export const HANDOFF_FIRST_UPLOAD_FLAG_PREFIX = 'navhub:handoff:first-upload-done:'

/** D1 / D3 派发 UPSERT_VIDEO_PROGRESS 时的输入（与播放器快照同字段）。 */
export interface VideoProgressDispatchInput {
  videoId: string
  title: string
  author?: string
  cover?: string
  platform: VideoPlatform
  timestampSec: number
  durationSec: number
  /** LWW 键：调用方传本次本机写入的同一毫秒时间戳。 */
  updatedAt: number
}

/** UPSERT_VIDEO_PROGRESS 的 payload（规约层校验口径，见 lib/crdt-sync.ts）。 */
export interface VideoProgressPayload {
  videoId: string
  title: string
  author?: string
  cover?: string
  platform: VideoPlatform
  timestampSec: number
  durationSec: number
  progressPercent: number
  updatedAt: number
}

/** 云端断点取舍时只读这些字段：VideoProgress 与 HandoffVideoProgress 都满足。 */
export type RemoteProgressLike = Pick<
  VideoProgress,
  | 'videoId'
  | 'title'
  | 'author'
  | 'cover'
  | 'platform'
  | 'timestampSec'
  | 'durationSec'
  | 'progressPercent'
  | 'updatedAt'
>

/**
 * D1/D3 payload 整形：与 savePlaybackPosition 同一套百分比口径
 *（duration 至少 1s；秒数夹到 [0, duration]；百分比四舍五入、上限 100）。
 *
 * 不带 deviceId：规约层缺 deviceId 时回落到 op.clientId，而 op.clientId
 * 本就是同一份 sessionStorage client id，不另造 id。
 */
export function buildVideoProgressPayload(input: VideoProgressDispatchInput): VideoProgressPayload {
  const durationSec = Number.isFinite(input.durationSec)
    ? Math.max(1, Math.floor(input.durationSec))
    : 1
  const timestampSec = Number.isFinite(input.timestampSec)
    ? Math.max(0, Math.min(Math.floor(input.timestampSec), durationSec))
    : 0
  const progressPercent = Math.min(100, Math.round((timestampSec / durationSec) * 100))
  const payload: VideoProgressPayload = {
    videoId: input.videoId,
    title: input.title,
    platform: input.platform,
    timestampSec,
    durationSec,
    progressPercent,
    updatedAt: input.updatedAt,
  }
  if (typeof input.author === 'string' && input.author.length > 0) payload.author = input.author
  if (typeof input.cover === 'string' && input.cover.length > 0) payload.cover = input.cover
  return payload
}

/** 规约态里的云端断点 → 接力卡要的 HandoffVideoProgress（字段一一对应）。 */
export function toHandoffVideoProgress(p: VideoProgress): HandoffVideoProgress {
  return {
    videoId: p.videoId,
    title: p.title,
    author: p.author,
    cover: p.cover,
    platform: p.platform,
    timestampSec: p.timestampSec,
    durationSec: p.durationSec,
    progressPercent: p.progressPercent,
    updatedAt: p.updatedAt,
    deviceId: p.deviceId,
    deviceLabel: p.deviceLabel,
  }
}

function isValidRemote(p: RemoteProgressLike, now: number): boolean {
  return (
    typeof p.videoId === 'string' &&
    p.videoId.length > 0 &&
    typeof p.title === 'string' &&
    p.title.trim().length > 0 &&
    Number.isFinite(p.updatedAt) &&
    Number.isFinite(p.timestampSec) &&
    Number.isFinite(p.durationSec) &&
    Number.isFinite(p.progressPercent) &&
    p.timestampSec >= 0 &&
    p.durationSec > 0 &&
    !(p.updatedAt > now + HANDOFF_FUTURE_SKEW_MS)
  )
}

/**
 * D2 启动合并：挑出应当写回本机历史的云端断点（调用方再逐条调
 * savePlaybackPosition 写回，lastWatchedAt 用云端 updatedAt 原值，
 * 这样下次合并 / 首次上传去重时同一条不再重复动作）。
 *
 *  - 云端 updatedAt 必须严格晚于本机 lastWatchedAt，否则跳过；
 *  - 云端秒数比本机回退 ≤ 容差秒时跳过（另一设备的滞后 flush，
 *    不是用户真的往回拖了进度；回退超过容差视为有意回看，照常合入）；
 *  - 云端没有 author / cover 时沿用本机已有的，不编造、不降级。
 */
export function selectRemoteProgressToMerge(
  local: readonly PlaybackHistoryItem[],
  remote: readonly RemoteProgressLike[],
  now = Date.now(),
): SavePlaybackPositionInput[] {
  const localById = new Map(local.map((item) => [item.videoId, item]))
  const out: SavePlaybackPositionInput[] = []
  for (const r of remote) {
    if (!isValidRemote(r, now)) continue
    const existing = localById.get(r.videoId)
    if (existing) {
      if (r.updatedAt <= existing.lastWatchedAt) continue
      if (
        r.timestampSec < existing.timestampSec &&
        existing.timestampSec - r.timestampSec <= HANDOFF_MERGE_REGRESSION_TOLERANCE_SEC
      ) {
        continue
      }
    }
    out.push({
      videoId: r.videoId,
      title: r.title,
      author: r.author ?? existing?.author,
      cover: r.cover ?? existing?.cover,
      platform: r.platform,
      timestampSec: Math.floor(r.timestampSec),
      durationSec: Math.floor(r.durationSec),
      lastWatchedAt: r.updatedAt,
    })
  }
  return out
}

function cloudUpdatedAtById(
  cloud: Readonly<Record<string, VideoProgress>> | readonly RemoteProgressLike[],
): Map<string, number> {
  const map = new Map<string, number>()
  if (Array.isArray(cloud)) {
    for (const p of cloud) {
      if (typeof p.videoId === 'string' && Number.isFinite(p.updatedAt)) {
        map.set(p.videoId, p.updatedAt)
      }
    }
    return map
  }
  for (const [videoId, p] of Object.entries(cloud)) {
    if (Number.isFinite(p.updatedAt)) map.set(videoId, p.updatedAt)
  }
  return map
}

/**
 * D3 首次上传去重：本机历史里「云端没有、或本机比云端新」的条目才上传。
 *
 *  - 云端已有且 updatedAt ≥ 本机 lastWatchedAt：跳过（启动时已登录、
 *    云端已含该断点的情形，一条也不重复发）；
 *  - 不按百分比过滤：看完（≥95%）的本机条目若比云端新也上传——它让
 *    另一设备的卡片正确消失，而不是继续显示一条已看完的「继续观看」；
 *    展示层的 ≥95% 过滤仍由接力卡自己做。
 */
export function selectLocalProgressToUpload(
  local: readonly PlaybackHistoryItem[],
  cloud: Readonly<Record<string, VideoProgress>> | readonly RemoteProgressLike[],
): PlaybackHistoryItem[] {
  const cloudAt = cloudUpdatedAtById(cloud)
  const out: PlaybackHistoryItem[] = []
  for (const item of local) {
    if (!item.videoId || !item.title?.trim()) continue
    if (!Number.isFinite(item.lastWatchedAt)) continue
    const cloudUpdatedAt = cloudAt.get(item.videoId)
    if (cloudUpdatedAt === undefined || item.lastWatchedAt > cloudUpdatedAt) {
      out.push(item)
    }
  }
  return out
}

/** 首次上传会话标记的 sessionStorage 键（每身份一个，退出登录时清除）。 */
export function firstUploadFlagKey(identity: string): string {
  return `${HANDOFF_FIRST_UPLOAD_FLAG_PREFIX}${identity}`
}
