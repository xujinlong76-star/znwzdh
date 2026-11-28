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
describe('温度单位偏好 tempUnit：与 weatherCity 同款一致性（P1-5）', () => {
  it('缺省为 °C：未传、脏值都归 celsius，fahrenheit / F 保留', () => {
    expect(normalizeUserSettings({}).tempUnit).toBe('celsius')
    expect(normalizeUserSettings().tempUnit).toBe('celsius')
    expect(normalizeUserSettings({ tempUnit: 'kelvin' }).tempUnit).toBe('celsius')
    expect(normalizeUserSettings({ tempUnit: 'fahrenheit' }).tempUnit).toBe('fahrenheit')
    expect(normalizeUserSettings({ tempUnit: 'F' }).tempUnit).toBe('fahrenheit')
  })

  it('同值 tempUnit 不误报', () => {
    const localWritten = normalizeUserSettings({ tempUnit: 'fahrenheit' })
    const { verified, mismatchedKeys } = verifySettingsConsistency(
      { tempUnit: 'fahrenheit' },
      { tempUnit: 'fahrenheit' },
      localWritten,
    )
    expect(verified).toBe(true)
    expect(mismatchedKeys).toEqual([])
  })

  it('tempUnit 真变了仍要报出偏差（不是一律放过）', () => {
    const localWritten = normalizeUserSettings({ tempUnit: 'celsius' })
    const { verified, mismatchedKeys } = verifySettingsConsistency(
      { tempUnit: 'fahrenheit' },
      { tempUnit: 'fahrenheit' },
      localWritten,
    )
    expect(verified).toBe(false)
    expect(mismatchedKeys).toContain('tempUnit')
  })
})

describe('/weather 页与挂件单位同源：偏好 tempUnit 是唯一来源（P1-5）', () => {
  it('/weather 页初始读偏好、切换写回本机 + 账号同步', () => {
    const src = readFileSync(join(ROOT, 'src/app/weather/weather-page.tsx'), 'utf8')
    expect(src).toContain('readLocalUserSettings().tempUnit')
    expect(src).toContain('writeLocalUserSettings({ tempUnit')
    expect(src).toContain('saveSettingsPatchToCloud({ tempUnit')
    // 不再是纯内存态：useState 初始值必须来自偏好
    expect(src).toContain('useState<WeatherUnit>(() => readLocalUserSettings().tempUnit)')
    expect(src).not.toContain("useState<WeatherUnit>('celsius')")
  })

  it('挂件读偏好 tempUnit，齿轮 config.unit 只作采纳、不另存一份值', () => {
    const src = readFileSync(join(ROOT, 'src/components/modular/modules/weather-widget.tsx'), 'utf8')
    expect(src).toContain('readLocalUserSettings().tempUnit')
    expect(src).toContain('navhub_settings_changed')
    expect(src).toContain('CONFIG_UNIT_ADOPTED_KEY')
    // 临时切换标记与 unitOverride 仍在（widget-honesty 守卫同款要求）
    expect(src).toContain('临时')
    expect(src).toContain('unitOverride')
    // 不再以 config.unit 为显示基准
    expect(src).not.toContain('normalizeUnit(config?.unit)')
  })
})
