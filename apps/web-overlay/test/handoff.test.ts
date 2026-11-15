/**
 * 跨设备接力卡纯规则层测试（Batch 3 第 9 项，C 组）。
 *
 * 覆盖：挑选最新一条 / 剩余条数、LWW、95% 消失、未来时间戳丢弃、
 * YouTube 无秒数文案与链接、跨类型排序、空态与脏数据丢弃。
 * 全部用注入的固定 now，不读真实时钟。
 */
import { describe, expect, it } from 'vitest'
import {
  HANDOFF_COMPLETED_PERCENT,
  HANDOFF_FUTURE_SKEW_MS,
  adaptLocalPlayback,
  handoffDetailLine,
  handoffPrimaryLabel,
  handoffVideoHref,
  mergeVideoProgress,
  selectHandoffItems,
  type HandoffVideoProgress,
} from '../src/lib/handoff'

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0)
const HOUR = 3_600_000

function video(
  overrides: Partial<HandoffVideoProgress> & { videoId: string },
): HandoffVideoProgress {
  return {
    title: '测试视频',
    platform: 'bilibili',
    timestampSec: 754,
    durationSec: 1800,
    progressPercent: 42,
    updatedAt: NOW - 2 * HOUR,
    deviceId: 'client_a',
    ...overrides,
  }
}

describe('selectHandoffItems：只挑最新的一条未完成进度', () => {
  it('空输入时 current 为 null、remaining 为 0（调用方整块不渲染）', () => {
    const sel = selectHandoffItems({ localProgress: [], now: NOW })
    expect(sel.current).toBeNull()
    expect(sel.remaining).toBe(0)
    expect(sel.items).toEqual([])
  })

  it('多条时取 updatedAt 最晚的一条，remaining 如实计数', () => {
    const sel = selectHandoffItems({
      localProgress: [
        video({ videoId: 'v1', updatedAt: NOW - 3 * HOUR }),
        video({ videoId: 'v2', title: '更新的视频', updatedAt: NOW - 1 * HOUR }),
        video({ videoId: 'v3', updatedAt: NOW - 2 * HOUR }),
      ],
      now: NOW,
    })
    expect(sel.current?.kind).toBe('video')
    if (sel.current?.kind === 'video') expect(sel.current.id).toBe('v2')
    expect(sel.remaining).toBe(2)
    expect(sel.items).toHaveLength(3)
  })

  it('跨类型也按 updatedAt 排序：最近打开的站点晚于视频时站点胜出', () => {
    const sel = selectHandoffItems({
      localProgress: [video({ videoId: 'v1', updatedAt: NOW - 2 * HOUR })],
      visits: [
        { siteId: 's1', title: '某站点', url: 'https://example.com', at: NOW - 30 * 60_000 },
      ],
      watchlist: [
        {
          key: 'p1::某剧',
          title: '某剧',
          playUrl: 'https://example.com/play',
          episode: 3,
          lastProgressAt: NOW - 3 * HOUR,
        },
      ],
      now: NOW,
    })
    expect(sel.current?.kind).toBe('visit')
    expect(sel.remaining).toBe(2)
  })
})

describe('mergeVideoProgress：LWW 与完成态', () => {
  it('两设备同视频取 updatedAt 更晚者（云端新胜出；本机新也胜出）', () => {
    const cloudNewer = mergeVideoProgress(
      [video({ videoId: 'v1', timestampSec: 100, updatedAt: NOW - 2 * HOUR })],
      [video({ videoId: 'v1', timestampSec: 900, updatedAt: NOW - 1 * HOUR })],
      NOW,
    )
    expect(cloudNewer).toHaveLength(1)
    expect(cloudNewer[0].timestampSec).toBe(900)

    const localNewer = mergeVideoProgress(
      [video({ videoId: 'v1', timestampSec: 900, updatedAt: NOW - 1 * HOUR })],
      [video({ videoId: 'v1', timestampSec: 100, updatedAt: NOW - 2 * HOUR })],
      NOW,
    )
    expect(localNewer).toHaveLength(1)
    expect(localNewer[0].timestampSec).toBe(900)
  })

  it('视频 ≥95% 视为完成、不显示；94% 仍显示', () => {
    expect(HANDOFF_COMPLETED_PERCENT).toBe(95)
    const sel = selectHandoffItems({
      localProgress: [
        video({ videoId: 'done95', progressPercent: 95, timestampSec: 1710 }),
        video({ videoId: 'done100', progressPercent: 100, timestampSec: 1800 }),
        video({ videoId: 'doing94', progressPercent: 94, timestampSec: 1692 }),
      ],
      now: NOW,
    })
    expect(sel.items.map((i) => i.id)).toEqual(['doing94'])
    expect(sel.current?.id).toBe('doing94')
  })
})

describe('未来时间戳丢弃（时钟回拨脏数据）', () => {
  it('updatedAt > now + 5min 的视频丢弃；恰好 now + 5min 的保留', () => {
    expect(HANDOFF_FUTURE_SKEW_MS).toBe(5 * 60_000)
    const sel = selectHandoffItems({
      localProgress: [
        video({ videoId: 'future', updatedAt: NOW + HANDOFF_FUTURE_SKEW_MS + 1 }),
        video({ videoId: 'edge', updatedAt: NOW + HANDOFF_FUTURE_SKEW_MS }),
        video({ videoId: 'normal', updatedAt: NOW - HOUR }),
      ],
      now: NOW,
    })
    expect(sel.items.map((i) => i.id)).toEqual(['edge', 'normal'])
  })

  it('未来时间戳的 visit / watchlist 也丢弃', () => {
    const sel = selectHandoffItems({
      localProgress: [],
      visits: [{ siteId: 's1', title: '未来站点', url: 'https://example.com', at: NOW + HOUR }],
      watchlist: [
        {
          key: 'p1::未来剧',
          title: '未来剧',
          playUrl: 'https://example.com/play',
          episode: 1,
          lastProgressAt: NOW + HOUR,
        },
      ],
      now: NOW,
    })
    expect(sel.current).toBeNull()
  })
})

describe('无秒数文案与链接（YouTube / iframe 类）', () => {
  it('YouTube 记录只显示「继续观看」，不写「从 xx:xx 继续」，链接不带 t=', () => {
    const sel = selectHandoffItems({
      localProgress: [
        video({ videoId: 'yt1', platform: 'youtube', timestampSec: 754, updatedAt: NOW - HOUR }),
      ],
      now: NOW,
    })
    const item = sel.current
    expect(item?.kind).toBe('video')
    if (item?.kind !== 'video') throw new Error('expected video item')
    expect(item.hasSeek).toBe(false)
    expect(handoffPrimaryLabel(item)).toBe('继续观看')
    expect(handoffVideoHref(item)).toBe('/videos/player?id=yt1')
    expect(handoffVideoHref(item)).not.toContain('t=')
  })

  it('Bilibili 有秒数时写「从 12:34 继续」，链接带 ?t=754', () => {
    const sel = selectHandoffItems({
      localProgress: [video({ videoId: 'b1', timestampSec: 754, updatedAt: NOW - HOUR })],
      now: NOW,
    })
    const item = sel.current
    expect(item?.kind).toBe('video')
    if (item?.kind !== 'video') throw new Error('expected video item')
    expect(item.hasSeek).toBe(true)
    expect(handoffPrimaryLabel(item)).toBe('从 12:34 继续')
    expect(handoffVideoHref(item)).toBe('/videos/player?id=b1&t=754')
  })

  it('timestampSec 为 0 的记录也没有秒数文案', () => {
    const sel = selectHandoffItems({
      localProgress: [video({ videoId: 'z1', timestampSec: 0, updatedAt: NOW - HOUR })],
      now: NOW,
    })
    const item = sel.current
    if (item?.kind !== 'video') throw new Error('expected video item')
    expect(item.hasSeek).toBe(false)
    expect(handoffPrimaryLabel(item)).toBe('继续观看')
  })
})

describe('其它类型的主按钮与副行文案', () => {
  it('站点主按钮是「打开」，追剧是「看下一集」', () => {
    const visit = selectHandoffItems({
      localProgress: [],
      visits: [{ siteId: 's1', title: '某站', url: 'https://example.com', at: NOW - HOUR }],
      now: NOW,
    }).current
    expect(visit && handoffPrimaryLabel(visit)).toBe('打开')

    const drama = selectHandoffItems({
      localProgress: [],
      watchlist: [
        {
          key: 'p1::某剧',
          title: '某剧',
          playUrl: 'https://example.com/play',
          episode: 3,
          lastProgressAt: NOW - HOUR,
        },
      ],
      now: NOW,
    }).current
    expect(drama && handoffPrimaryLabel(drama)).toBe('看下一集')
  })

  it('副行只写进度 + 相对时间，不编造设备名', () => {
    const twoHoursAgo = video({ videoId: 'v1', updatedAt: NOW - 2 * HOUR })
    const sel = selectHandoffItems({ localProgress: [twoHoursAgo], now: NOW })
    const item = sel.current
    expect(item && handoffDetailLine(item, NOW)).toBe('看到 42% · 2小时前')
    expect(item && handoffDetailLine(item, NOW)).not.toContain('手机')
    expect(item && handoffDetailLine(item, NOW)).not.toContain('电脑')
    expect(item && handoffDetailLine(item, NOW)).not.toContain('iPhone')
  })

  it('追剧副行写「追到第 N 集 · 相对时间」', () => {
    const sel = selectHandoffItems({
      localProgress: [],
      watchlist: [
        {
          key: 'p1::某剧',
          title: '某剧',
          playUrl: 'https://example.com/play',
          episode: 3,
          lastProgressAt: NOW - 2 * HOUR,
        },
      ],
      now: NOW,
    })
    const item = sel.current
    expect(item && handoffDetailLine(item, NOW)).toBe('追到第 3 集 · 2小时前')
  })
})

describe('脏数据丢弃与本机适配', () => {
  it('无标题 / 无 videoId 的进度丢弃，不拖垮整批', () => {
    const sel = selectHandoffItems({
      localProgress: [
        video({ videoId: '', title: '空 id' }),
        video({ videoId: 'no-title', title: '   ' }),
        video({ videoId: 'good', updatedAt: NOW - HOUR }),
      ],
      now: NOW,
    })
    expect(sel.items.map((i) => i.id)).toEqual(['good'])
  })

  it('adaptLocalPlayback 把 lastWatchedAt 映射为 LWW 键 updatedAt', () => {
    const adapted = adaptLocalPlayback(
      {
        videoId: 'v1',
        title: '本机视频',
        author: '作者',
        platform: 'bilibili',
        timestampSec: 120,
        durationSec: 600,
        lastWatchedAt: NOW - HOUR,
        progressPercent: 20,
      },
      'client_a',
    )
    expect(adapted.updatedAt).toBe(NOW - HOUR)
    expect(adapted.deviceId).toBe('client_a')
    expect(adapted.videoId).toBe('v1')
  })
})
