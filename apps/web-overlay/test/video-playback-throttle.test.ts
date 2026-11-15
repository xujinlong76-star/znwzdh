/**
 * 视频断点节流保存（Batch 3 第 9 项 A 组 · 本地写路径修复）。
 *
 * 纯函数部分直接测 `@/lib/video-playback-throttle`；播放器页的接线用源码守卫
 * 体例（仿 route-prefetch.test.ts / offline-shell.test.ts）：运行时不挂载
 * 组件，只锁「两路共用同一入口、节流阈值只活在 lib 里、pause/pagehide/
 * visibilitychange/切集/关闭都立即写、iframe 类平台不断点秒数」。
 *
 * 锁：
 *   - 节流：播放中 >= 15s 且进度变化 > 5s 才写；5s 整不写、15s 未满不写；
 *     后退大跳变也写（取绝对值）；
 *   - 强制写（pause / pagehide / hidden / 切集 / 关闭）：绕过 15s，但同一秒
 *     不重复写；从未写过时只在进度 > 0 才写；
 *   - 两路共用：Bilibili 与 mp4 都走 handlePlaybackTimeUpdate，写点只有
 *     handler 与 flush 两处 savePlaybackPosition 调用；
 *   - 阈值只活在 lib：播放页源码里不得出现 15000；
 *   - iframe 诚实：YouTube 分支里没有任何写断点的调用，flush 被 hasPlayhead
 *     守住（无真实播放头不写秒数）；
 *   - 存储契约不变：键 navhub:video:playback-history:v1、30 条上限。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  PLAYBACK_SAVE_INTERVAL_MS,
  PLAYBACK_SAVE_MIN_DELTA_SEC,
  createPlaybackSaveThrottle,
  markPlaybackSaved,
  seedPlaybackSaveThrottle,
  shouldSavePlaybackPosition,
  type PlaybackSaveThrottle,
} from '@/lib/video-playback-throttle'
import { getResumePosition, savePlaybackPosition } from '@/lib/video-playback-storage'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1
}

/** 切出播放页 renderVideoPlayer 里某平台的分支做局部断言 */
function playerBranch(page: string, from: string, to: string): string {
  const start = page.indexOf(from)
  const end = page.indexOf(to, start + from.length)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return page.slice(start, end)
}

const T0 = Date.UTC(2026, 11, 14, 0, 0, 0)

describe('节流写：播放中每 15s 且进度变化 > 5s 时一次', () => {
  it('常量就是 15s / 5s', () => {
    expect(PLAYBACK_SAVE_INTERVAL_MS).toBe(15_000)
    expect(PLAYBACK_SAVE_MIN_DELTA_SEC).toBe(5)
  })

  it('15s 未满不写，哪怕进度跳变很大', () => {
    const throttle = seedPlaybackSaveThrottle(100, T0)
    expect(shouldSavePlaybackPosition(throttle, 200, T0 + 14_999)).toBe(false)
  })

  it('15s 已满但进度变化 <= 5s 不写；5s 整不写，6s 写', () => {
    const throttle = seedPlaybackSaveThrottle(100, T0)
    expect(shouldSavePlaybackPosition(throttle, 105, T0 + 15_000)).toBe(false)
    expect(shouldSavePlaybackPosition(throttle, 106, T0 + 15_000)).toBe(true)
    expect(shouldSavePlaybackPosition(throttle, 95, T0 + 15_000)).toBe(false)
    expect(shouldSavePlaybackPosition(throttle, 94, T0 + 15_000)).toBe(true)
  })

  it('后退大跳变也写（取绝对值）：seek 回去是新断点，不是旧断点', () => {
    const throttle = seedPlaybackSaveThrottle(100, T0)
    expect(shouldSavePlaybackPosition(throttle, 40, T0 + 20_000)).toBe(true)
  })

  it('写过一次后，下一轮 15s 从该次写开始算', () => {
    const seeded = seedPlaybackSaveThrottle(0, T0)
    expect(shouldSavePlaybackPosition(seeded, 20, T0 + 16_000)).toBe(true)
    const afterSave = markPlaybackSaved(seeded, 20, T0 + 16_000)
    expect(shouldSavePlaybackPosition(afterSave, 40, T0 + 30_000)).toBe(false)
    expect(shouldSavePlaybackPosition(afterSave, 40, T0 + 31_000)).toBe(true)
  })

  it('从未写过：只在进度已离开 0 点超过 5s 时才写，避免打开瞬间写 0', () => {
    const fresh = createPlaybackSaveThrottle()
    expect(shouldSavePlaybackPosition(fresh, 0, T0 + 100_000)).toBe(false)
    expect(shouldSavePlaybackPosition(fresh, 5, T0 + 100_000)).toBe(false)
    expect(shouldSavePlaybackPosition(fresh, 6, T0 + 100_000)).toBe(true)
  })

  it('非有限输入一律不写', () => {
    const throttle = seedPlaybackSaveThrottle(100, T0)
    expect(shouldSavePlaybackPosition(throttle, Number.NaN, T0 + 20_000)).toBe(false)
    expect(shouldSavePlaybackPosition(throttle, 120, Number.NaN)).toBe(false)
    expect(shouldSavePlaybackPosition(throttle, Number.POSITIVE_INFINITY, T0 + 20_000)).toBe(false)
  })
})

describe('强制写：pause / pagehide / hidden / 切集 / 关闭时立即一次', () => {
  it('绕过 15s 节流，但同一秒不重复写', () => {
    const throttle = seedPlaybackSaveThrottle(100, T0)
    expect(shouldSavePlaybackPosition(throttle, 100, T0, { force: true })).toBe(false)
    expect(shouldSavePlaybackPosition(throttle, 101, T0, { force: true })).toBe(true)
  })

  it('从未写过时只在进度 > 0 才强制写', () => {
    const fresh = createPlaybackSaveThrottle()
    expect(shouldSavePlaybackPosition(fresh, 0, T0, { force: true })).toBe(false)
    expect(shouldSavePlaybackPosition(fresh, 1, T0, { force: true })).toBe(true)
  })

  it('强制写也不写非有限秒数', () => {
    const throttle = seedPlaybackSaveThrottle(100, T0)
    expect(shouldSavePlaybackPosition(throttle, Number.NaN, T0, { force: true })).toBe(false)
  })
})

describe('seedPlaybackSaveThrottle / markPlaybackSaved', () => {
  it('播种：取整、下限 0、非有限变 null', () => {
    expect(seedPlaybackSaveThrottle(100.9, T0)).toEqual({ lastSavedSec: 100, lastSavedAtMs: T0 })
    expect(seedPlaybackSaveThrottle(-5, T0)).toEqual({ lastSavedSec: 0, lastSavedAtMs: T0 })
    expect(seedPlaybackSaveThrottle(Number.NaN, Number.NaN)).toEqual({ lastSavedSec: null, lastSavedAtMs: null })
  })

  it('markPlaybackSaved 返回新对象，不改传入的状态', () => {
    const before: PlaybackSaveThrottle = { lastSavedSec: null, lastSavedAtMs: null }
    const after = markPlaybackSaved(before, 42.7, T0)
    expect(after).toEqual({ lastSavedSec: 42, lastSavedAtMs: T0 })
    expect(before).toEqual({ lastSavedSec: null, lastSavedAtMs: null })
    expect(markPlaybackSaved(before, Number.NaN, T0)).toBe(before)
  })
})

describe('节流判定接到真实写表：按判定写，续播能读回新断点', () => {
  it('15s 后进度 20s：判定写 -> getResumePosition 读回 20', () => {
    const videoId = `throttle-e2e-${Date.now()}`
    const throttle = seedPlaybackSaveThrottle(0, T0)
    expect(shouldSavePlaybackPosition(throttle, 20, T0 + 16_000)).toBe(true)
    savePlaybackPosition({
      videoId,
      title: '节流写端到端',
      platform: 'bilibili',
      timestampSec: 20,
      durationSec: 600,
    })
    expect(getResumePosition(videoId)).toBe(20)
  })
})

describe('播放页接线守卫：两路共用同一处节流逻辑', () => {
  const page = overlaySource('src/components/video-player-page.tsx')
  const biliPlayer = overlaySource('src/components/video-bilibili-hd-player.tsx')
  const storage = overlaySource('src/lib/video-playback-storage.ts')

  it('Bilibili 与 mp4 都走 handlePlaybackTimeUpdate，没有第二套节流写', () => {
    const bili = playerBranch(page, "if (platform === 'bilibili')", "if (platform === 'youtube')")
    expect(bili).toContain('handlePlaybackTimeUpdate(selectedVideo, curSec, durationSec)')
    const mp4 = playerBranch(page, 'if (embedUrl &&', 'if (embedUrl) {')
    expect(mp4).toContain('handlePlaybackTimeUpdate(selectedVideo, e.currentTarget.currentTime, e.currentTarget.duration)')
    // 写表调用全页只有两处：节流写（handler 内）与强制写（flush 内）
    expect(countOccurrences(page, 'savePlaybackPosition(')).toBe(2)
    expect(countOccurrences(page, 'shouldSavePlaybackPosition(')).toBe(2)
  })

  it('节流阈值只活在 lib 里：播放页不得出现 15000', () => {
    expect(page).not.toContain('15000')
    expect(page).toContain("from '@/lib/video-playback-throttle'")
  })

  it('pause 时立即写：mp4 用 onPause，Bilibili 用 onPauseSec', () => {
    expect(page).toContain('onPause={() => flushPlaybackPosition()}')
    expect(page).toContain('onPauseSec={() => flushPlaybackPosition()}')
    expect(biliPlayer).toContain('onPauseSec?: (currentTimeSec: number) => void')
    expect(biliPlayer).toContain('onPause={')
  })

  it('pagehide 与 visibilitychange(hidden) 时立即写', () => {
    expect(page).toContain("window.addEventListener('pagehide', handlePageHide)")
    expect(page).toContain("document.addEventListener('visibilitychange', handleVisibilityChange)")
    expect(page).toContain("if (document.visibilityState === 'hidden') flushPlaybackPosition()")
  })

  it('切集 / 关闭时写一次：selectedVideo 变化的 effect 带 flush cleanup', () => {
    expect(page).toContain('}, [selectedVideo, flushPlaybackPosition])')
    expect(page).toContain('seedPlaybackSaveThrottle(resumeSec, Date.now())')
  })

  it('YouTube / 通用 iframe 分支里没有任何写断点的调用', () => {
    // 结束锚是 mp4 直链分支：embedUrl 的计算已提到组件层的 videoRoute 里
    //（与语音执行器共用），renderVideoPlayer 内不再有 `const embedUrl`。
    const youtube = playerBranch(page, "if (platform === 'youtube')", 'if (embedUrl && isMp4Direct)')
    expect(youtube).not.toContain('savePlaybackPosition')
    expect(youtube).not.toContain('handlePlaybackTimeUpdate')
    expect(youtube).not.toContain('onTimeUpdate')
    const genericIframe = playerBranch(page, 'if (embedUrl) {', 'const platformMeta')
    expect(genericIframe).not.toContain('savePlaybackPosition')
    expect(genericIframe).not.toContain('handlePlaybackTimeUpdate')
  })

  it('flush 被 hasPlayhead 守住：无真实播放头不写秒数', () => {
    expect(page).toContain('if (!snapshot || !snapshot.hasPlayhead) return')
    expect(page).toContain('hasPlayhead: false')
  })

  it('存储契约不变：同一键、30 条上限', () => {
    expect(storage).toContain("const STORAGE_KEY = 'navhub:video:playback-history:v1'")
    expect(storage).toContain('const MAX_HISTORY_ITEMS = 30')
  })
})
