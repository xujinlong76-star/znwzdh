/**
 * 跨设备接力云端接线纯规则层测试（Batch 3 第 9 项，D 组）。
 *
 * 覆盖：payload 整形（与本机 savePlaybackPosition 同一套百分比口径）、
 * 启动合并取舍（LWW、几秒回退容差、未来时间戳丢弃、标题缺失丢弃、
 * author/cover 沿用本机）、首次上传去重（云端已有且更新时不重复发、
 * 看完条目比云端新时也上传）、云端断点 → 卡片输入转换、会话标记键。
 * 全部用注入的固定 now，不读真实时钟。
 */
import { describe, expect, it } from 'vitest'
import {
  HANDOFF_MERGE_REGRESSION_TOLERANCE_SEC,
  buildVideoProgressPayload,
  firstUploadFlagKey,
  selectLocalProgressToUpload,
  selectRemoteProgressToMerge,
  toHandoffVideoProgress,
} from '../src/lib/handoff-sync'
import type { VideoProgress } from '../src/lib/crdt-sync'
import type { PlaybackHistoryItem } from '../src/lib/video-playback-storage'

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0)
const HOUR = 3_600_000
const MIN = 60_000

function localItem(overrides: Partial<PlaybackHistoryItem> & { videoId: string }): PlaybackHistoryItem {
  return {
    title: '测试视频',
    author: '讲师 A',
    cover: 'https://example.com/cover.jpg',
    platform: 'bilibili',
    timestampSec: 754,
    durationSec: 1800,
    lastWatchedAt: NOW - 2 * HOUR,
    progressPercent: 42,
    ...overrides,
  }
}

function remoteProgress(overrides: Partial<VideoProgress> & { videoId: string }): VideoProgress {
  return {
    title: '测试视频',
    author: '讲师 A',
    cover: 'https://example.com/cover.jpg',
    platform: 'bilibili',
    timestampSec: 900,
    durationSec: 1800,
    progressPercent: 50,
    updatedAt: NOW - 1 * HOUR,
    deviceId: 'client_b',
    ...overrides,
  }
}

describe('buildVideoProgressPayload：与本机写入同一百分比口径', () => {
  it('754/1800 得 42%，字段齐全', () => {
    const payload = buildVideoProgressPayload({
      videoId: 'v1',
      title: '测试视频',
      author: '讲师 A',
      cover: 'https://example.com/cover.jpg',
      platform: 'bilibili',
      timestampSec: 754,
      durationSec: 1800,
      updatedAt: NOW,
    })
    expect(payload.progressPercent).toBe(42)
    expect(payload).toMatchObject({
      videoId: 'v1',
      title: '测试视频',
      author: '讲师 A',
      cover: 'https://example.com/cover.jpg',
      platform: 'bilibili',
      timestampSec: 754,
      durationSec: 1800,
      updatedAt: NOW,
    })
  })

  it('秒数夹到 [0, duration]，duration 为 0 时按 1s 算', () => {
    expect(
      buildVideoProgressPayload({
        videoId: 'v1', title: 't', platform: 'other',
        timestampSec: 9999, durationSec: 600, updatedAt: NOW,
      }).timestampSec,
    ).toBe(600)
    expect(
      buildVideoProgressPayload({
        videoId: 'v1', title: 't', platform: 'other',
        timestampSec: -5, durationSec: 600, updatedAt: NOW,
      }).timestampSec,
    ).toBe(0)
    const zero = buildVideoProgressPayload({
      videoId: 'v1', title: 't', platform: 'other',
      timestampSec: 3, durationSec: 0, updatedAt: NOW,
    })
    expect(zero.durationSec).toBe(1)
    expect(zero.timestampSec).toBe(1)
    expect(zero.progressPercent).toBe(100)
  })

  it('空 author / cover 不进 payload；不带 deviceId（规约层回落到 op.clientId）', () => {
    const payload = buildVideoProgressPayload({
      videoId: 'v1', title: 't', platform: 'youtube',
      timestampSec: 10, durationSec: 100, updatedAt: NOW,
    })
    expect('author' in payload).toBe(false)
    expect('cover' in payload).toBe(false)
    expect('deviceId' in payload).toBe(false)
  })
})

describe('toHandoffVideoProgress：字段一一对应', () => {
  it('云端断点原样转成卡片输入', () => {
    const p = remoteProgress({ videoId: 'v1' })
    expect(toHandoffVideoProgress(p)).toEqual({
      videoId: 'v1',
      title: '测试视频',
      author: '讲师 A',
      cover: 'https://example.com/cover.jpg',
      platform: 'bilibili',
      timestampSec: 900,
      durationSec: 1800,
      progressPercent: 50,
      updatedAt: NOW - 1 * HOUR,
      deviceId: 'client_b',
      deviceLabel: undefined,
    })
  })
})

describe('selectRemoteProgressToMerge：启动合并取舍', () => {
  it('本机没有该视频时合入，lastWatchedAt 用云端 updatedAt 原值', () => {
    const out = selectRemoteProgressToMerge([], [remoteProgress({ videoId: 'v1' })], NOW)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      videoId: 'v1',
      timestampSec: 900,
      durationSec: 1800,
      lastWatchedAt: NOW - 1 * HOUR,
    })
  })

  it('云端 updatedAt 不晚于本机时跳过（旧的、相等的都不覆盖）', () => {
    const local = [localItem({ videoId: 'v1', lastWatchedAt: NOW - 1 * HOUR })]
    expect(
      selectRemoteProgressToMerge(local, [remoteProgress({ videoId: 'v1', updatedAt: NOW - 1 * HOUR })], NOW),
    ).toEqual([])
    expect(
      selectRemoteProgressToMerge(local, [remoteProgress({ videoId: 'v1', updatedAt: NOW - 2 * HOUR })], NOW),
    ).toEqual([])
  })

  it('云端更新且秒数前进时合入（覆盖本机断点）', () => {
    const local = [localItem({ videoId: 'v1', timestampSec: 754, lastWatchedAt: NOW - 2 * HOUR })]
    const out = selectRemoteProgressToMerge(
      local,
      [remoteProgress({ videoId: 'v1', timestampSec: 900, updatedAt: NOW - 30 * MIN })],
      NOW,
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.timestampSec).toBe(900)
  })

  it(`几秒内的位置回退（≤ ${HANDOFF_MERGE_REGRESSION_TOLERANCE_SEC}s）视为滞后写入，跳过`, () => {
    const local = [localItem({ videoId: 'v1', timestampSec: 900, lastWatchedAt: NOW - 2 * HOUR })]
    const out = selectRemoteProgressToMerge(
      local,
      [remoteProgress({ videoId: 'v1', timestampSec: 900 - HANDOFF_MERGE_REGRESSION_TOLERANCE_SEC, updatedAt: NOW - 30 * MIN })],
      NOW,
    )
    expect(out).toEqual([])
  })

  it('回退超过容差时视为有意回看，照常合入', () => {
    const local = [localItem({ videoId: 'v1', timestampSec: 900, lastWatchedAt: NOW - 2 * HOUR })]
    const out = selectRemoteProgressToMerge(
      local,
      [remoteProgress({ videoId: 'v1', timestampSec: 900 - HANDOFF_MERGE_REGRESSION_TOLERANCE_SEC - 1, updatedAt: NOW - 30 * MIN })],
      NOW,
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.timestampSec).toBe(900 - HANDOFF_MERGE_REGRESSION_TOLERANCE_SEC - 1)
  })

  it('未来时间戳（> now + 5min）丢弃；标题缺失/空白丢弃；秒数非法丢弃', () => {
    const local: PlaybackHistoryItem[] = []
    const future = remoteProgress({ videoId: 'vf', updatedAt: NOW + 6 * MIN })
    const noTitle = remoteProgress({ videoId: 'vt', title: '   ' })
    const badSec = remoteProgress({ videoId: 'vs', timestampSec: -1 })
    const badDur = remoteProgress({ videoId: 'vd', durationSec: 0 })
    expect(selectRemoteProgressToMerge(local, [future, noTitle, badSec, badDur], NOW)).toEqual([])
  })

  it('云端没有 author / cover 时沿用本机已有的，不降级为缺省', () => {
    const local = [localItem({ videoId: 'v1', author: '讲师 A', cover: 'https://example.com/cover.jpg', lastWatchedAt: NOW - 2 * HOUR })]
    const remote = remoteProgress({ videoId: 'v1', author: undefined, cover: undefined, updatedAt: NOW - 30 * MIN })
    const out = selectRemoteProgressToMerge(local, [remote], NOW)
    expect(out).toHaveLength(1)
    expect(out[0]?.author).toBe('讲师 A')
    expect(out[0]?.cover).toBe('https://example.com/cover.jpg')
  })

  it('看完（≥95%）的云端断点也合入：本机续播随即归零、卡片随即消失', () => {
    const local = [localItem({ videoId: 'v1', timestampSec: 754, lastWatchedAt: NOW - 2 * HOUR })]
    const out = selectRemoteProgressToMerge(
      local,
      [remoteProgress({ videoId: 'v1', timestampSec: 1790, progressPercent: 99, updatedAt: NOW - 30 * MIN })],
      NOW,
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.timestampSec).toBe(1790)
  })
})

describe('selectLocalProgressToUpload：首次上传去重', () => {
  it('云端没有该视频时上传', () => {
    const out = selectLocalProgressToUpload([localItem({ videoId: 'v1' })], {})
    expect(out).toHaveLength(1)
  })

  it('本机比云端新时上传；云端更新或相等时跳过', () => {
    const local = [localItem({ videoId: 'v1', lastWatchedAt: NOW - 1 * HOUR })]
    const older = { v1: remoteProgress({ videoId: 'v1', updatedAt: NOW - 2 * HOUR }) }
    const newer = { v1: remoteProgress({ videoId: 'v1', updatedAt: NOW - 30 * MIN }) }
    const equal = { v1: remoteProgress({ videoId: 'v1', updatedAt: NOW - 1 * HOUR }) }
    expect(selectLocalProgressToUpload(local, older)).toHaveLength(1)
    expect(selectLocalProgressToUpload(local, newer)).toEqual([])
    expect(selectLocalProgressToUpload(local, equal)).toEqual([])
  })

  it('数组形式云端态同样去重', () => {
    const local = [localItem({ videoId: 'v1', lastWatchedAt: NOW - 1 * HOUR })]
    const cloud = [remoteProgress({ videoId: 'v1', updatedAt: NOW - 30 * MIN })]
    expect(selectLocalProgressToUpload(local, cloud)).toEqual([])
  })

  it('看完（≥95%）的本机条目：云端有更旧的同视频时上传（让另一端卡片消失），云端没有时也上传', () => {
    const done = localItem({ videoId: 'v1', timestampSec: 1790, progressPercent: 99, lastWatchedAt: NOW - 1 * HOUR })
    const staleCloud = { v1: remoteProgress({ videoId: 'v1', timestampSec: 900, progressPercent: 50, updatedAt: NOW - 2 * HOUR }) }
    expect(selectLocalProgressToUpload([done], staleCloud)).toHaveLength(1)
    expect(selectLocalProgressToUpload([done], {})).toHaveLength(1)
  })

  it('标题缺失的本机条目不上', () => {
    const bad = localItem({ videoId: 'v1', title: '   ' })
    expect(selectLocalProgressToUpload([bad], {})).toEqual([])
  })
})

describe('firstUploadFlagKey：每身份一个会话标记键', () => {
  it('键含身份、不同身份不重合', () => {
    expect(firstUploadFlagKey('user_1')).toContain('user_1')
    expect(firstUploadFlagKey('user_1')).not.toBe(firstUploadFlagKey('user_2'))
  })
})
