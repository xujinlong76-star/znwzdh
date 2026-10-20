import { describe, expect, it } from 'vitest'
import { reachabilityTone, relativeTime } from '../src/lib/plugins/url-audit-badge.ts'

/**
 * 详情页体检徽标的展示逻辑。
 * 阈值与文案错了不会抛错、只会误导用户，所以用纯函数测试钉住边界。
 */
describe('reachabilityTone（可达率 → 徽标）', () => {
  it('三档阈值：≥95% 健康色 / ≥80% 关注色 / 其余异常色', () => {
    expect(reachabilityTone(1).label).toBe('100% 可达')
    expect(reachabilityTone(1).className).toContain('emerald')
    expect(reachabilityTone(0.95).className).toContain('emerald')
    expect(reachabilityTone(0.94).className).toContain('amber')
    expect(reachabilityTone(0.8).className).toContain('amber')
    expect(reachabilityTone(0.79).className).toContain('destructive')
    expect(reachabilityTone(0).className).toContain('destructive')
  })

  it('null / undefined / NaN 显示「未知」，不能用 0% 冒充全挂', () => {
    for (const v of [null, undefined, Number.NaN]) {
      const tone = reachabilityTone(v as number | null | undefined)
      expect(tone.label).toBe('可达性未知')
      expect(tone.label).not.toContain('0%')
    }
  })

  it('越界历史数据被夹紧到 0..100%', () => {
    expect(reachabilityTone(1.5).label).toBe('100% 可达')
    expect(reachabilityTone(-0.2).label).toBe('0% 可达')
  })
})

describe('relativeTime（相对时间）', () => {
  const now = 1_700_000_000_000

  it('一分钟内与未来时间都显示「刚刚」', () => {
    expect(relativeTime(now - 30_000, now)).toBe('刚刚')
    expect(relativeTime(now + 60_000, now)).toBe('刚刚')
  })

  it('分钟 / 小时 / 天 / 月 四档', () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 小时前')
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 天前')
    expect(relativeTime(now - 65 * 86_400_000, now)).toBe('2 个月前')
  })
})
