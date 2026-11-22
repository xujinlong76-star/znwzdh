import { describe, it, expect } from 'vitest'
import { formatAbsoluteTime, formatRelativeTime } from '../src/lib/format-relative-time'

/**
 * 绝对时间固定 Asia/Shanghai 渲染。
 *
 * 根因：`toLocaleString('zh-CN')` 不带 timeZone 时跟服务器本地时区，
 * 同一时刻在 UTC 部署（:3000）与 CST 部署（:3100）上渲染出不同的
 * /hot title（13:40:51 vs 21:40:51），跨端口比对须先换算。
 * 本文件锁死：无论进程 TZ 是什么，绝对时间一律按北京时间出。
 * 验证方式：同一测试分别在 TZ=UTC 与 TZ=America/New_York 下跑，
 * 两次都必须通过（见轮次笔记）。
 */
describe('formatAbsoluteTime', () => {
  it('固定渲染北京时间：2026-11-21 13:40:51 UTC 即 21:40:51 CST', () => {
    expect(formatAbsoluteTime(Date.UTC(2026, 10, 21, 13, 40, 51))).toBe('2026/11/21 21:40:51')
  })

  it('非法值返回 —', () => {
    expect(formatAbsoluteTime(null)).toBe('—')
    expect(formatAbsoluteTime(undefined)).toBe('—')
    expect(formatAbsoluteTime(NaN)).toBe('—')
    expect(formatAbsoluteTime(Infinity)).toBe('—')
  })
})

describe('formatRelativeTime', () => {
  it('超 1 年回落到绝对时间时同样渲染北京时间', () => {
    const ts = Date.UTC(2024, 0, 2, 3, 4, 5)
    const now = Date.UTC(2026, 0, 2, 3, 4, 5)
    expect(formatRelativeTime(ts, now)).toBe('2024/1/2 11:04:05')
  })

  it('现有行为不变：未来时间戳为刚刚、45 分钟前、非法为 —', () => {
    const now = Date.UTC(2026, 10, 21, 14, 0, 0)
    expect(formatRelativeTime(now + 60_000, now)).toBe('刚刚')
    expect(formatRelativeTime(now - 45 * 60_000, now)).toBe('45分钟前')
    expect(formatRelativeTime(null, now)).toBe('—')
    expect(formatRelativeTime(0, now)).toBe('—')
  })
})
