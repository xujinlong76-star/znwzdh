/**
 * 热榜新鲜度相对时间测试（/brief 全网热榜卡片顶标注）。
 *
 * 口径：`fetchedAt` 是本站成功抓取时刻（非平台更新时间），文案一律是
 * 「本站 X 分钟前更新」。无 fetchedAt 时不编造时间；stale 升级阈值
 * 2 小时整按升级算（`>=`，见 relative-time.ts 的 STALE_ESCALATION_MS）。
 *
 * 注意：仓库 vitest 是 node 环境、无 jsdom，组件只测 renderToString
 * 首帧（小岛首帧沿用 SSR 文案、禁止首帧重算）；60 秒 tick 的推进
 * 由纯函数在不同 now 下断言 + 源码守卫 setInterval 存在性覆盖。
 */
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  STALE_ESCALATION_MS,
  formatFreshness,
  formatHotlistSubline,
} from '../src/lib/relative-time'
import HotlistFreshness from '../src/app/brief/hotlist-freshness'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

// 固定 now：2026-11-15 12:00:00 UTC（北京时间 20:00）。
const NOW = Date.UTC(2026, 10, 15, 12, 0, 0)
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN

const origTz = process.env.TZ
afterEach(() => {
  if (origTz === undefined) delete process.env.TZ
  else process.env.TZ = origTz
})

describe('formatFreshness 档位边界（固定 now）', () => {
  it('0 秒→刚刚、59 秒→刚刚', () => {
    expect(formatFreshness(NOW, NOW)).toBe('刚刚')
    expect(formatFreshness(NOW - 59 * SEC, NOW)).toBe('刚刚')
  })
  it('60 秒→1 分钟前、59 分 59 秒→59 分钟前', () => {
    expect(formatFreshness(NOW - 60 * SEC, NOW)).toBe('1 分钟前')
    expect(formatFreshness(NOW - (59 * MIN + 59 * SEC), NOW)).toBe('59 分钟前')
  })
  it('60 分钟→1 小时前、23 小时 59 分→23 小时前', () => {
    expect(formatFreshness(NOW - 60 * MIN, NOW)).toBe('1 小时前')
    expect(formatFreshness(NOW - (23 * HOUR + 59 * MIN), NOW)).toBe('23 小时前')
  })
  it('24 小时→M月D日（UTC 日期，不带空格）', () => {
    expect(formatFreshness(NOW - 24 * HOUR, NOW)).toBe('11月14日')
  })
  it('null/0/NaN/负数/undefined→null（不编造时间）', () => {
    expect(formatFreshness(null, NOW)).toBeNull()
    expect(formatFreshness(0, NOW)).toBeNull()
    expect(formatFreshness(Number.NaN, NOW)).toBeNull()
    expect(formatFreshness(-1, NOW)).toBeNull()
    expect(formatFreshness(undefined, NOW)).toBeNull()
  })
  it('未来时间钳制到刚刚，不出负数分钟', () => {
    expect(formatFreshness(NOW + 5 * MIN, NOW)).toBe('刚刚')
  })
})

describe('formatFreshness 时区无关性', () => {
  it('同一 now/fetchedAt 在 UTC 与 Asia/Shanghai 下同一文案', () => {
    // 午夜边界：fetchedAt = 2026-11-14 16:00 UTC = 上海 11月15日 00:00；
    // 若用本地月/日，UTC 下是 11月14日、上海下是 11月15日，会分叉。
    const at = Date.UTC(2026, 10, 14, 16, 0, 0)
    const now2 = Date.UTC(2026, 10, 15, 17, 0, 0) // 25 小时后→日期档
    const hourAt = Date.UTC(2026, 10, 14, 16, 0, 0) // now 之前 20 小时→小时档
    for (const tz of ['UTC', 'Asia/Shanghai']) {
      process.env.TZ = tz
      expect(formatFreshness(hourAt, NOW)).toBe('20 小时前')
      expect(formatFreshness(at, now2)).toBe('11月14日')
    }
  })
})

describe('formatHotlistSubline 副行文案', () => {
  it("ok → `${fresh}更新`", () => {
    expect(formatHotlistSubline('ok', NOW - 30 * MIN, NOW)).toBe('30 分钟前更新')
    expect(formatHotlistSubline('ok', NOW - 10 * SEC, NOW)).toBe('刚刚更新')
  })
  it('stale（≤2 小时）→普通句式', () => {
    expect(formatHotlistSubline('stale', NOW - 30 * MIN, NOW)).toBe(
      '抓取暂时失败，下面是 30 分钟前 的缓存',
    )
    expect(formatHotlistSubline('stale', NOW - (1 * HOUR + 59 * MIN), NOW)).toBe(
      '抓取暂时失败，下面是 1 小时前 的缓存',
    )
  })
  it('stale 升级：2 小时整按升级算（>=），2 小时 1 分、3 小时同样升级', () => {
    expect(STALE_ESCALATION_MS).toBe(2 * HOUR)
    expect(formatHotlistSubline('stale', NOW - 2 * HOUR, NOW)).toBe(
      '抓取已失败 2 小时，下面是旧缓存',
    )
    expect(formatHotlistSubline('stale', NOW - (2 * HOUR + MIN), NOW)).toBe(
      '抓取已失败 2 小时，下面是旧缓存',
    )
    expect(formatHotlistSubline('stale', NOW - 3 * HOUR, NOW)).toBe(
      '抓取已失败 3 小时，下面是旧缓存',
    )
  })
  it('fallback：empty/ok 无时间一律暂无数据，不编造时间', () => {
    expect(formatHotlistSubline('empty', null, NOW)).toBe('暂无数据（等待首次抓取）')
    expect(formatHotlistSubline('ok', null, NOW)).toBe('暂无数据（等待首次抓取）')
  })
  it('stale 无时间→时间未知的缓存（stale 态下方有缓存条目，不说暂无数据）', () => {
    expect(formatHotlistSubline('stale', null, NOW)).toBe('抓取暂时失败，下面是时间未知的缓存')
    expect(formatHotlistSubline('stale', 0, NOW)).toBe('抓取暂时失败，下面是时间未知的缓存')
    expect(formatHotlistSubline('stale', Number.NaN, NOW)).toBe(
      '抓取暂时失败，下面是时间未知的缓存',
    )
    expect(formatHotlistSubline('stale', -1, NOW)).toBe('抓取暂时失败，下面是时间未知的缓存')
    expect(formatHotlistSubline('stale', undefined, NOW)).toBe(
      '抓取暂时失败，下面是时间未知的缓存',
    )
  })
  it('路由边缘组合：items 为空但 lastOkAt 非空时仍按 status 为 empty，不显示时间', () => {
    expect(formatHotlistSubline('empty', NOW - 30 * MIN, NOW)).toBe(
      '暂无数据（等待首次抓取）',
    )
  })
})

describe('HotlistFreshness 小岛：hydration 首帧一致 + 60 秒 tick', () => {
  it('首帧沿用 SSR 文案，不重算（故意给与重算结果不同的 ssrText）', () => {
    const html = renderToString(
      createElement(HotlistFreshness, {
        status: 'ok',
        fetchedAt: NOW - 30 * MIN,
        clock: '11:30',
        ssrText: '刚刚更新',
      }),
    )
    expect(html).toContain('刚刚更新')
    expect(html).not.toContain('30 分钟前更新')
    expect(html).toContain('更新于 11:30')
  })
  it('tick 后文案随 now 推进 1 分钟（纯函数在不同 now 下断言）', () => {
    const at = NOW - 30 * MIN
    expect(formatHotlistSubline('ok', at, NOW)).toBe('30 分钟前更新')
    expect(formatHotlistSubline('ok', at, NOW + 60 * SEC)).toBe('31 分钟前更新')
  })
  it('源码守卫：小岛确有 60 秒 interval 且首帧 state 取 ssrText', () => {
    const src = read('src/app/brief/hotlist-freshness.tsx')
    expect(src).toContain('setInterval')
    expect(src).toContain('60_000')
    expect(src).toContain('useState(ssrText)')
    expect(src).not.toContain('router.refresh')
    expect(src).not.toContain('/api/hotlist')
  })
})
