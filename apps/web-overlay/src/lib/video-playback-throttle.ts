/**
 * 视频断点节流保存（Batch 3 第 9 项 A 组 · 本地写路径修复）。
 *
 * 背景：video-player-page 的 onTimeUpdate 只更新本地 currentTimeSec state，
 * 全程不写表；唯一写入点是 useVideoPlayerState 打开时的 effect，写的是打开
 * 那一刻的旧断点。Bilibili 直连与 mp4 两路共用同一处节流判定（本文件纯函数），
 * 不在两处各写一份。
 *
 * 保存口径（设计文档第 9 项 §3.2）：
 * - 播放中：距上次写入 >= 15s 且进度变化 > 5s 时一次；
 * - pause / pagehide / visibilitychange(hidden) / 切集 / 关闭时立即一次
 *  （force：绕过 15s 节流，但同一秒不重复写）；
 * - 仍写同一张本地表（navhub:video:playback-history:v1，30 条上限不变），
 *   本文件只做「何时写」的判定，不碰键与结构；
 * - YouTube / 通用 iframe 取不到播放头：调用方以 hasPlayhead 为闸直接跳过，
 *   只记「打开过 + 打开时间」（open 写入负责），不断点秒数、不编造秒数。
 *
 * 本文件是纯函数：无 window / localStorage / React 依赖，可直接单测。
 */

export const PLAYBACK_SAVE_INTERVAL_MS = 15_000
export const PLAYBACK_SAVE_MIN_DELTA_SEC = 5

export interface PlaybackSaveThrottle {
  /** 上次写入的断点秒数（null = 本视频尚未写入过） */
  lastSavedSec: number | null
  /** 上次写入的 wall-clock 毫秒（null = 尚未写入过） */
  lastSavedAtMs: number | null
}

export function createPlaybackSaveThrottle(): PlaybackSaveThrottle {
  return { lastSavedSec: null, lastSavedAtMs: null }
}

/**
 * 以已存断点为基线播种：打开时 useVideoPlayerState 已把 resumeSec（或 0）
 * 写回过一次，节流的 15s / 5s 从该基线开始算，而不是从 0 开始算
 *（否则续播 100s 后只看 3s 就暂停，节流会误判「进度没变」而不写）。
 */
export function seedPlaybackSaveThrottle(savedSec: number, savedAtMs: number): PlaybackSaveThrottle {
  return {
    lastSavedSec: Number.isFinite(savedSec) ? Math.max(0, Math.floor(savedSec)) : null,
    lastSavedAtMs: Number.isFinite(savedAtMs) ? savedAtMs : null,
  }
}

export interface ShouldSavePlaybackPositionOptions {
  intervalMs?: number
  minDeltaSec?: number
  /** pause / pagehide / visibilitychange(hidden) / 切集 / 关闭：绕过 15s 节流 */
  force?: boolean
}

/**
 * 这一次是否应把 currentSec 写入断点表。
 *
 * - 节流写：距上次写入 >= intervalMs 且 |currentSec - lastSavedSec| > minDeltaSec；
 * - 强制写（force）：只要求进度真的变了，同一秒不重复写；
 * - 从未写过（lastSavedSec 为 null）：节流写要求进度已离开 0 点超过 minDeltaSec
 *   （避免打开瞬间写 0 覆盖已有断点），强制写要求 currentSec > 0。
 * 非有限输入一律不写。
 */
export function shouldSavePlaybackPosition(
  throttle: PlaybackSaveThrottle,
  currentSec: number,
  nowMs: number,
  options: ShouldSavePlaybackPositionOptions = {},
): boolean {
  if (!Number.isFinite(currentSec) || !Number.isFinite(nowMs)) return false
  const current = Math.max(0, Math.floor(currentSec))
  const {
    intervalMs = PLAYBACK_SAVE_INTERVAL_MS,
    minDeltaSec = PLAYBACK_SAVE_MIN_DELTA_SEC,
    force = false,
  } = options
  if (throttle.lastSavedSec === null) {
    if (force) return current > 0
    if (throttle.lastSavedAtMs === null) return current > minDeltaSec
    return nowMs - throttle.lastSavedAtMs >= intervalMs && current > minDeltaSec
  }
  if (force) return current !== throttle.lastSavedSec
  if (throttle.lastSavedAtMs === null) return Math.abs(current - throttle.lastSavedSec) > minDeltaSec
  return (
    nowMs - throttle.lastSavedAtMs >= intervalMs &&
    Math.abs(current - throttle.lastSavedSec) > minDeltaSec
  )
}

/** 写入成功后推进节流状态（返回新对象，不改传入的 throttle）。 */
export function markPlaybackSaved(
  throttle: PlaybackSaveThrottle,
  currentSec: number,
  nowMs: number,
): PlaybackSaveThrottle {
  if (!Number.isFinite(currentSec) || !Number.isFinite(nowMs)) return throttle
  return { lastSavedSec: Math.max(0, Math.floor(currentSec)), lastSavedAtMs: nowMs }
}
