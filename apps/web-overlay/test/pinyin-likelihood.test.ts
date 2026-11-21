import { describe, expect, it } from 'vitest'
import { computePinyinLikelihood } from '../src/lib/linucb'

/**
 * pinyinProb 特征提取（2026-11-21 重写守卫）。
 *
 * 旧实现缺陷：`/^[a-zA-Z]+$/.test(q) && len >= 2 && len <= 15 → 1.0`
 * 任何纯英文串都拿满分，'vsc' / 'react' / 'github' 全被判成 100% 拼音。
 * 后果是 LinUCB 第 4 维特征对英文查询恒为 1，PINYIN 通道收益被系统性高估。
 *
 * 新实现用「真实音节表 DP 全覆盖切分 + 声母简拼启发式」三档打分。
 * 下面的区间就是设计契约，改动算法必须同步这些数字。
 */
describe('computePinyinLikelihood', () => {
  describe('明显非拼音的英文词/缩写 → 0.0–0.15', () => {
    it.each(['vsc', 'react', 'github', 'nginx', 'http'])('%s 应判为低分', (input) => {
      const v = computePinyinLikelihood(input)
      expect(v, `${input} 不应被当成拼音`).toBeLessThanOrEqual(0.15)
      expect(v).toBeGreaterThanOrEqual(0)
    })

    it('vsc 不再是 1.0（原缺陷的直接回归点）', () => {
      // v 不是汉语拼音声母，sc 也不是合法音节
      expect(computePinyinLikelihood('vsc')).not.toBe(1)
      expect(computePinyinLikelihood('vsc')).toBeLessThanOrEqual(0.15)
    })
  })

  describe('完整合法拼音音节 → 0.85–1.0', () => {
    it.each(['zhihu', 'duanju', 'kaogong'])('%s 应判为高分', (input) => {
      const v = computePinyinLikelihood(input)
      expect(v, `${input} 是标准拼音`).toBeGreaterThanOrEqual(0.85)
      expect(v).toBeLessThanOrEqual(1)
    })
  })

  describe('声母简拼 → 0.35–0.55', () => {
    it.each(['qdjb', 'zgh'])('%s 应判为中等', (input) => {
      const v = computePinyinLikelihood(input)
      expect(v, `${input} 是首字母缩写`).toBeGreaterThanOrEqual(0.35)
      expect(v).toBeLessThanOrEqual(0.55)
    })
  })

  describe('非拉丁输入 → 0', () => {
    it('中文「大模型」不是拼音串', () => {
      expect(computePinyinLikelihood('大模型')).toBe(0)
    })
    it('空串与纯数字', () => {
      expect(computePinyinLikelihood('')).toBe(0)
      expect(computePinyinLikelihood('123')).toBe(0)
    })
  })

  describe('排序合理性：真拼音必须高于英文缩写', () => {
    it('zhihu > qdjb > vsc', () => {
      const zh = computePinyinLikelihood('zhihu')
      const qd = computePinyinLikelihood('qdjb')
      const vs = computePinyinLikelihood('vsc')
      expect(zh).toBeGreaterThan(qd)
      expect(qd).toBeGreaterThan(vs)
    })
  })
})
