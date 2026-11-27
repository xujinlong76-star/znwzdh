import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeUserSettings,
  verifySettingsConsistency,
} from '../src/lib/user-settings'

/**
 * 天气 P0 复核报告（绑定 27fd2cd7）两处轻微问题回归锁：
 *   ISSUE 1：verifySettingsConsistency 对 weatherCity（模型唯一普通对象型
 *   字段）用 === 比较，normalize 每次生成新对象 → 恒误报「修复了 1 项偏差」。
 *   ISSUE 2：/weather 搜索框 ArrowUp 不打开下拉，下拉关闭时先按 ArrowUp
 *   会静默选中首项（视觉不可见）。
 */

const NANJING = {
  id: '1799962',
  name: '南京',
  region: '江苏',
  country: '中国',
  timezone: 'Asia/Shanghai',
  latitude: 32.0603,
  longitude: 118.7969,
}

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

describe('verifySettingsConsistency：weatherCity 对象字段按值比较', () => {
  it('同值不同引用的 weatherCity 不误报（每次 normalize 生成新对象）', () => {
    const localWritten = normalizeUserSettings({ weatherCity: { ...NANJING } })
    // 云端回读是另一份同值对象：模拟 PATCH 后 save-then-verify 的真实路径
    const cloud = { weatherCity: { ...NANJING } }
    const { verified, mismatchedKeys } = verifySettingsConsistency(
      { weatherCity: { ...NANJING } },
      cloud,
      localWritten,
    )
    expect(verified).toBe(true)
    expect(mismatchedKeys).toEqual([])
  })

  it('weatherCity 真变了仍要报出偏差（不是一律放过）', () => {
    const localWritten = normalizeUserSettings({ weatherCity: { ...NANJING } })
    const { verified, mismatchedKeys } = verifySettingsConsistency(
      { weatherCity: { ...NANJING, name: '北京' } },
      { weatherCity: { ...NANJING, name: '北京' } },
      localWritten,
    )
    expect(verified).toBe(false)
    expect(mismatchedKeys).toContain('weatherCity')
  })
})

describe('/weather 搜索框：ArrowUp 与 ArrowDown 对称打开下拉', () => {
  it('ArrowUp 分支先 setDropdownOpen(true)，再调 activeIdx', () => {
    const src = readFileSync(join(ROOT, 'src/app/weather/weather-page.tsx'), 'utf8')
    const up = src.indexOf("e.key === 'ArrowUp'")
    expect(up).toBeGreaterThan(-1)
    const block = src.slice(up, src.indexOf('} else if', up))
    expect(block).toContain('setDropdownOpen(true)')
    expect(block.indexOf('setDropdownOpen(true)')).toBeLessThan(block.indexOf('setActiveIdx'))
  })
})
