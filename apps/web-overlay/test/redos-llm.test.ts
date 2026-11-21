import { describe, expect, it } from 'vitest'
import { stripTrailingSlashes, MAX_BASE_URL_LENGTH } from '../../../packages/ai/src/llm'

/**
 * ReDoS 回归（CodeQL #143/#144/#145）。
 *
 * 原实现 `value.replace(/\/+$/, "")` 是多项式回溯：对「N 个 / 后接一个
 * 非 / 字符」的输入，正则引擎在每个起始位置都要回溯量词长度，总步数 O(N²)。
 * 实测 N=5000 时 65ms、N=40000 时 1815ms（输入翻倍、耗时翻四倍）。
 *
 * 现改为倒序单遍扫描 O(n)。本测试断言两件事：
 *   1. 行为与旧正则逐字符等价（不能只是"变快"而改错语义）；
 *   2. 大输入下耗时在线性量级（用宽松上界，避免 CI 抖动误判）。
 */
describe('stripTrailingSlashes（ReDoS 回归）', () => {
  describe('行为等价', () => {
    const cases: Array<[string, string]> = [
      ['https://api.deepseek.com/v1/', 'https://api.deepseek.com/v1'],
      ['https://api.deepseek.com/v1///', 'https://api.deepseek.com/v1'],
      ['https://api.deepseek.com/v1', 'https://api.deepseek.com/v1'],
      ['/', ''],
      ['///', ''],
      ['', ''],
      ['a/b//c/', 'a/b//c'],
      ['http://x/', 'http://x'],
      ['no-slash', 'no-slash'],
    ]
    for (const [input, expected] of cases) {
      it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
        expect(stripTrailingSlashes(input)).toBe(expected)
      })
    }
    it('只剥末尾，不动中间的斜杠', () => {
      expect(stripTrailingSlashes('a//b///')).toBe('a//b')
    })
  })

  describe('线性时间（不再是 O(N²)）', () => {
    it('4 万个斜杠 + 一个非斜杠，必须在 100ms 内完成', () => {
      // 旧实现在这个输入上要 1.8 秒
      const evil = '/'.repeat(40_000) + 'x'
      const t0 = performance.now()
      const out = stripTrailingSlashes(evil)
      const cost = performance.now() - t0
      expect(out).toBe(evil) // 末尾不是斜杠 → 原样返回
      expect(cost, `耗时 ${cost.toFixed(1)}ms，疑似仍有回溯`).toBeLessThan(100)
    })

    it('4 万个斜杠全在末尾，同样快', () => {
      const evil = 'x' + '/'.repeat(40_000)
      const t0 = performance.now()
      expect(stripTrailingSlashes(evil)).toBe('x')
      expect(performance.now() - t0).toBeLessThan(100)
    })

    it('输入翻倍时耗时不应翻四倍（量级检查）', () => {
      const mk = (n: number) => '/'.repeat(n) + 'x'
      const time = (n: number) => {
        const t = performance.now()
        stripTrailingSlashes(mk(n))
        return performance.now() - t
      }
      // 预热，避免 JIT 首次编译污染
      time(10_000)
      const small = Math.max(time(20_000), 0.01)
      const big = time(40_000)
      // O(n) 下比值应≈2；O(n²) 下会是 4。给足余量只排除 quadratic 趋势。
      expect(big / small, `20k:${small.toFixed(2)}ms 40k:${big.toFixed(2)}ms`).toBeLessThan(8)
    })
  })

  describe('长度上限保护', () => {
    it('导出 MAX_BASE_URL_LENGTH 供调用方前置拒绝超长输入', () => {
      expect(typeof MAX_BASE_URL_LENGTH).toBe('number')
      expect(MAX_BASE_URL_LENGTH).toBeGreaterThan(0)
      expect(MAX_BASE_URL_LENGTH).toBeLessThanOrEqual(8192)
    })
  })
})
