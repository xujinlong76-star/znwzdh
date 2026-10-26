import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/github', () => ({
  getFileContent: vi.fn(),
  commitFile: vi.fn(),
}))

import {
  formatDuration,
  calculateQualityScore,
  calculateFreshnessScore,
} from '../src/lib/video-harvester'

describe('video-harvester 核心工具函数单测', () => {
  describe('formatDuration 时长格式化', () => {
    it('正确格式化分秒', () => {
      expect(formatDuration(1540)).toBe('25:40')
      expect(formatDuration(180)).toBe('3:00')
      expect(formatDuration(65)).toBe('1:05')
    })

    it('正确格式化超过 1 小时的视频', () => {
      expect(formatDuration(3665)).toBe('1:01:05')
      expect(formatDuration(7200)).toBe('2:00:00')
    })

    it('对无效或空时长优雅返回空串', () => {
      expect(formatDuration(undefined)).toBe('')
      expect(formatDuration(0)).toBe('')
      expect(formatDuration(-10)).toBe('')
    })
  })

  describe('calculateQualityScore 质量分模型', () => {
    it('对高播放、高收藏的高赞教程给出 85+ 高分', () => {
      const score = calculateQualityScore(
        {
          views: 180000,
          likes: 12000,
          coins: 5000,
          favorites: 15000,
          danmaku: 800,
        },
        1800, // 30 分钟
        Math.floor(Date.now() / 1000)
      )
      expect(score).toBeGreaterThanOrEqual(85)
    })

    it('对不足 2 分钟的短视频碎片给予时长降权', () => {
      const shortVideoScore = calculateQualityScore(
        {
          views: 50000,
          likes: 3000,
          coins: 500,
          favorites: 1000,
        },
        60, // 1 分钟
        Math.floor(Date.now() / 1000)
      )

      const normalVideoScore = calculateQualityScore(
        {
          views: 50000,
          likes: 3000,
          coins: 500,
          favorites: 1000,
        },
        1200, // 20 分钟
        Math.floor(Date.now() / 1000)
      )

      expect(shortVideoScore).toBeLessThan(normalVideoScore)
    })
  })

  describe('calculateFreshnessScore 保鲜衰减与年份过时检测', () => {
    it('新鲜发布的视频保鲜度基本等于初始质量分', () => {
      const now = new Date().toISOString()
      const score = calculateFreshnessScore(now, 90, 90)
      expect(score).toBe(90)
    })

    it('随着时间推移产生指数衰减', () => {
      const halfLife = 90
      const daysAgo90 = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()
      const score = calculateFreshnessScore(daysAgo90, 80, halfLife)
      // 经过一个半衰期，分数应衰减约 50%
      expect(score).toBe(40)
    })

    it('标题包含旧年份时触发额外折旧惩罚', () => {
      const daysAgo30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
      const scoreWithoutYear = calculateFreshnessScore(daysAgo30, 80, 90, 'Next.js 深度实战教程')
      const scoreWithOldYear = calculateFreshnessScore(daysAgo30, 80, 90, '2021 年 Next.js 极速上手')

      expect(scoreWithOldYear).toBeLessThan(scoreWithoutYear)
    })
  })
})

// 跨模块 vi.mock 的模块缓存必须清掉，避免驻留同 worker 的后续文件
// （mock-hygiene 守卫：apps/web/test/mock-hygiene.test.ts）
afterAll(() => {
  vi.resetModules()
})
