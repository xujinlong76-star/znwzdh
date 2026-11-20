/**
 * Batch 1 W6b 补丁 3：macOS Option 键回退（04 §4.1，W6 遗留 4，协调员已批）。
 *
 * macOS 上 Option+数字的 `e.key` 是 ¡/™/£ 等特殊字符而非数字，Alt+数字
 * 可能不触发；补 `e.code` 回退：`Digit1`–`Digit0` 与 `Numpad1`–`Numpad0`
 * 与现有 `e.key` 数字判断取 OR。
 *
 * 测试策略：`altDigitFromKeyOrCode` 是纯函数（key/code → 数字字符），
 * 直接跑；组件接线（Alt 分支调它、越界静默守卫用它的返回值）用源码
 * 守卫锁住。真机 Alt+数字打开仍需真人验证（W6 遗留 3 未变）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { altDigitFromKeyOrCode, altDigitTargetIndex } from '@/lib/palette-actions'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位 overlay 根目录（镜像副本 apps/web/test 不会被误当成源） */
function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, '/')
    return s.includes('/web-overlay/') || s.endsWith('/web-overlay')
  }
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p))
  if (!hit) throw new Error('无法定位 web-overlay 根目录（候选：' + candidates.join(' | ') + '）')
  return hit
}

const paletteSrc = readFileSync(
  join(overlayRoot(), 'src/components/search-palette.tsx'),
  'utf8',
)

describe('altDigitFromKeyOrCode（key/code → 数字的映射）', () => {
  it('普通情况：e.key 是数字时直接用它（code 缺失也不影响）', () => {
    for (let d = 0; d <= 9; d++) {
      expect(altDigitFromKeyOrCode(String(d))).toBe(String(d))
      expect(altDigitFromKeyOrCode(String(d), `Digit${d}`)).toBe(String(d))
    }
  })

  it('macOS Option+数字：e.key 是特殊字符时用 e.code 兜底', () => {
    // Option+1 → ¡、Option+2 → ™、Option+3 → £（macOS 美式键盘实测字符）
    expect(altDigitFromKeyOrCode('¡', 'Digit1')).toBe('1')
    expect(altDigitFromKeyOrCode('™', 'Digit2')).toBe('2')
    expect(altDigitFromKeyOrCode('£', 'Digit3')).toBe('3')
    expect(altDigitFromKeyOrCode('¢', 'Digit4')).toBe('4')
    expect(altDigitFromKeyOrCode('∞', 'Digit5')).toBe('5')
    expect(altDigitFromKeyOrCode('§', 'Digit6')).toBe('6')
    expect(altDigitFromKeyOrCode('¶', 'Digit7')).toBe('7')
    expect(altDigitFromKeyOrCode('•', 'Digit8')).toBe('8')
    expect(altDigitFromKeyOrCode('ª', 'Digit9')).toBe('9')
    expect(altDigitFromKeyOrCode('º', 'Digit0')).toBe('0')
  })

  it('小键盘数字同样兜底：Numpad1–Numpad0', () => {
    for (let d = 1; d <= 9; d++) {
      expect(altDigitFromKeyOrCode('¡', `Numpad${d}`)).toBe(String(d))
    }
    expect(altDigitFromKeyOrCode('º', 'Numpad0')).toBe('0')
  })

  it('非数字键返回 null：字母键、修饰键、无 code 的特殊字符都不兜底', () => {
    expect(altDigitFromKeyOrCode('a', 'KeyA')).toBeNull()
    expect(altDigitFromKeyOrCode('¡')).toBeNull()
    expect(altDigitFromKeyOrCode('¡', 'KeyA')).toBeNull()
    expect(altDigitFromKeyOrCode('Alt', 'AltLeft')).toBeNull()
    expect(altDigitFromKeyOrCode('', 'Digit1')).toBe('1') // key 为空串时仍以 code 为准
  })

  it('端到端映射：macOS 的 ¡ + Digit1 在 10 条结果里仍指第 1 条', () => {
    const digit = altDigitFromKeyOrCode('¡', 'Digit1')
    expect(digit).not.toBeNull()
    expect(altDigitTargetIndex(digit!, 10)).toBe(0)
    expect(altDigitTargetIndex(altDigitFromKeyOrCode('º', 'Digit0')!, 10)).toBe(9)
  })
})

describe('组件接线（源码守卫）', () => {
  it('Alt 分支调 altDigitFromKeyOrCode(e.key, e.code)，越界静默守卫用 digit', () => {
    expect(paletteSrc).toContain('altDigitFromKeyOrCode(e.key, e.code)')
    expect(paletteSrc).toContain('altDigitTargetIndex(digit, navItems.length)')
    expect(paletteSrc).toContain('if (digit !== null) return')
  })
})
