import { describe, expect, it } from 'vitest'
import { fnv1aHash, getDeterministicGradient } from '../src/components/site-favicon'

/**
 * 图标渐变角度回归（2026-10-23）。
 *
 * 真实故障：首页「通义千问」「腾讯元宝」等图标底色消失，SSR HTML 里是
 * `linear-gradient(undefineddeg, #f97316, #e11d48)`——无效 CSS，浏览器丢弃整条
 * background 声明，只剩透明底 + 白字。
 *
 * 根因：`fnv1aHash` 返回无符号 32 位，但取角度时用了有符号右移 `hash >> 4`。
 * hash ≥ 2^31 会被解释成负数，`(负 % 5)` 仍是负索引 → `angleSteps[-1]` = undefined。
 * 约一半种子的图标受影响，且只影响服务端渲染出的初始 HTML（客户端重算同样错）。
 *
 * 这个测试直接执行函数而不是读源码文本：符号问题只有跑起来才看得见。
 */

const ANGLE_STEPS = [135, 45, 120, 160, 90]

describe('getDeterministicGradient', () => {
  it('已知会触发有符号溢出的种子也能产出合法角度', () => {
    // 3918906569 ≥ 2^31：旧实现下 (hash >> 4) % 5 === -1
    expect(fnv1aHash('通义千问')).toBeGreaterThanOrEqual(2 ** 31)

    const g = getDeterministicGradient('通义千问')
    expect(g.angle).toBe(135)
    expect(g.cssGradient).not.toContain('undefined')
    expect(g.cssGradient).toBe(`linear-gradient(${g.angle}deg, ${g.from}, ${g.to})`)
  })

  it('任意种子都给出预设角度与合法 CSS', () => {
    const seeds = ['', 'huggingchat', '腾讯元宝', 'navhub', 'https://www.google.com', 'a']
    for (let i = 0; i < 2000; i++) seeds.push(`seed-${i}`)

    for (const seed of seeds) {
      const g = getDeterministicGradient(seed)
      expect(ANGLE_STEPS, seed).toContain(g.angle)
      expect(g.cssGradient, seed).not.toContain('undefined')
      expect(g.from, seed).toMatch(/^#[0-9a-f]{6}$/i)
      expect(g.to, seed).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('同一种子稳定复现（首帧 SSR 与客户端水合必须一致）', () => {
    for (const seed of ['通义千问', 'navhub', 'https://github.com']) {
      expect(getDeterministicGradient(seed)).toEqual(getDeterministicGradient(seed))
    }
  })
})
