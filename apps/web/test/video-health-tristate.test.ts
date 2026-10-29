import { describe, it, expect, afterEach } from 'vitest'
import { probeVideoAvailability, sweepVideoHealth } from '../src/lib/video-deadlink-sweeper'
import type { NavigationData, NavigationSubItem } from '../src/types/navigation'

/**
 * 回归守卫：探活必须是三态（healthy / dead / unverified），且「不可判定」不删内容。
 *
 * 历史实现：
 *   catch (err) { return { healthy: false, reason: err.message } }
 *   const autoPrune = options?.autoPrune ?? true
 *   if (autoPrune && brokenIds.size > 0) { …filter 掉… }
 *
 * 后果：B 站接口抖动一次（超时/429/5xx），条目就被永久删除，且 replacementRecords
 * 永远是空数组 —— 没有任何回滚凭据。这与本仓「超时 = 不可判定」的口径直接冲突。
 */

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function videoItem(id: string, bvid: string): NavigationSubItem {
  return {
    id,
    title: `视频 ${id}`,
    href: `https://www.bilibili.com/video/${bvid}`,
    enabled: true,
    videoConfig: {
      type: 'bilibili',
      bvid,
      healthStatus: 'healthy',
    },
  } as NavigationSubItem
}

function navData(items: NavigationSubItem[]): NavigationData {
  return {
    navigationItems: [{ id: 'cat1', title: '分类一', enabled: true, items, subCategories: [] }],
  } as NavigationData
}

describe('probeVideoAvailability — 三态判定', () => {
  it('超时/网络中断 → unverified（不是 dead）', async () => {
    globalThis.fetch = (async () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }) as unknown as typeof fetch

    const res = await probeVideoAvailability(videoItem('v1', 'BV1aaaaaaaaa'), 50)
    expect(res.state).toBe('unverified')
    expect(res.healthy).toBe(false)
    expect(res.reason).toContain('确认状态')
  })

  it('HTTP 404 → dead（平台明确说没有）', async () => {
    globalThis.fetch = (async () =>
      new Response('not found', { status: 404 })) as unknown as typeof fetch

    const res = await probeVideoAvailability(videoItem('v2', 'BV1bbbbbbbbb'))
    expect(res.state).toBe('dead')
  })

  it('HTTP 429 / 风控 412 → unverified（限流不等于视频没了）', async () => {
    for (const status of [429, 412, 503]) {
      globalThis.fetch = (async () =>
        new Response('blocked', { status })) as unknown as typeof fetch
      const res = await probeVideoAvailability(videoItem('v3', 'BV1ccccccccc'))
      expect(res.state, `HTTP ${status} 不应被判 dead`).toBe('unverified')
    }
  })

  it('B 站业务码 -404 / 62002 → dead；其它 code → unverified', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ code: -404, message: '啥都木有' }), { status: 200 })) as unknown as typeof fetch
    expect((await probeVideoAvailability(videoItem('v4', 'BV1ddddddddd'))).state).toBe('dead')

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ code: -352, message: '风控校验失败' }), { status: 200 })) as unknown as typeof fetch
    const risk = await probeVideoAvailability(videoItem('v5', 'BV1eeeeeeeee'))
    expect(risk.state).toBe('unverified')
    expect(risk.reason).toContain('风控')
  })
})

describe('sweepVideoHealth — 删除策略', () => {
  it('默认不删除任何条目（autoPrune 默认为 false）', async () => {
    const data = navData([videoItem('v1', 'BV1aaaaaaaaa')])
    const { report, updatedData } = await sweepVideoHealth(data, {
      prober: async (item) => ({
        videoId: item.id,
        title: item.title,
        platform: 'bilibili',
        healthy: false,
        state: 'dead',
        reason: '平台确认已删除',
        latencyMs: 1,
      }),
    })

    expect(report.brokenCount).toBe(1)
    // 关键：标记了，但没删
    expect(report.prunedCount ?? 0).toBe(0)
    expect(updatedData.navigationItems[0].items?.length).toBe(1)
  })

  it('即使显式开启 autoPrune，unverified 也不进删除候选', async () => {
    const prober = async (item: NavigationSubItem) => ({
      videoId: item.id,
      title: item.title,
      platform: 'bilibili' as const,
      healthy: false,
      state: item.id === 'dead1' ? ('dead' as const) : ('unverified' as const),
      reason: 'test',
      latencyMs: 1,
    })

    const first = await sweepVideoHealth(
      navData([videoItem('dead1', 'BV1aaaaaaaaa'), videoItem('flaky1', 'BV1bbbbbbbbb')]),
      { autoPrune: true, prober }
    )
    expect(first.report.brokenCount).toBe(1)
    expect(first.report.unverifiedCount).toBe(1)

    // 跑第二轮再断言结果，而不是只看第一轮 —— 因为「删不删」的口径可能变
    // （见 video-deadlink-sweeper：删除候选现在是「连续失败达阈值」，一次失败只标记）。
    // 两种口径下最终状态一致：旧口径第一轮就删掉 dead1，第二轮只剩 flaky1 可探；
    // 新口径第二轮把 dead1 的连击数推到阈值后才删。这样本用例守的是
    // 「unverified 不该被删」这件事本身，不绑定具体阈值实现。
    const second = await sweepVideoHealth(first.updatedData, { autoPrune: true, prober })
    const remaining = second.updatedData.navigationItems[0].items ?? []
    expect(remaining.map(i => i.id)).toEqual(['flaky1'])
  })

  it('unverified 的条目会被标记 healthStatus=unverified，而不是 broken', async () => {
    const data = navData([videoItem('v1', 'BV1aaaaaaaaa')])
    await sweepVideoHealth(data, {
      prober: async (item) => ({
        videoId: item.id,
        title: item.title,
        platform: 'bilibili',
        healthy: false,
        state: 'unverified',
        reason: 'timeout',
        latencyMs: 1,
      }),
    })

    expect(data.navigationItems[0].items?.[0].videoConfig?.healthStatus).toBe('unverified')
  })
})
