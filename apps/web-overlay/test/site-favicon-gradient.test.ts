import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
      // P2-1（2026-11-21）：from/to 改为 CSS 变量引用（Token 化），hex 值收进
      // globals.css 的 --gradient-brand-*-from/to；角度回归仍由本测试覆盖，
      // 颜色值由下方「Token 定义」测试核查 globals.css。
      expect(g.from, seed).toMatch(/^var\(--gradient-brand-\d{2}-from\)$/)
      expect(g.to, seed).toMatch(/^var\(--gradient-brand-\d{2}-to\)$/)
      expect(g.textColor, seed).toBe('var(--color-on-gradient)')
    }
  })

  it('Token 定义：globals.css 有 16 组渐变 from/to（hex）与 --color-on-gradient', () => {
    const cssPath = fileURLToPath(new URL('../src/styles/globals.css', import.meta.url))
    const css = readFileSync(cssPath, 'utf8')
    for (let i = 1; i <= 16; i++) {
      const n = String(i).padStart(2, '0')
      expect(css, `缺 --gradient-brand-${n}-from`).toMatch(
        new RegExp(`--gradient-brand-${n}-from:\\s*#[0-9a-f]{6}`, 'i'),
      )
      expect(css, `缺 --gradient-brand-${n}-to`).toMatch(
        new RegExp(`--gradient-brand-${n}-to:\\s*#[0-9a-f]{6}`, 'i'),
      )
    }
    expect(css).toContain('--color-on-gradient: hsl(var(--on-gradient))')
    expect(css).toContain('--on-gradient: 0 0% 100%')
  })

  it('同一种子稳定复现（首帧 SSR 与客户端水合必须一致）', () => {
    for (const seed of ['通义千问', 'navhub', 'https://github.com']) {
      expect(getDeterministicGradient(seed)).toEqual(getDeterministicGradient(seed))
    }
  })
})
