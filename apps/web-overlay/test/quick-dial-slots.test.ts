/**
 * 数字直达自定义快拨位：存储与清洗。
 *
 * 锁住的契约：
 *   1. validateAndCleanDIYConfig 白名单：合法十位保留（含 '0' 位）；
 *      非法键（如 '11'、'a'、'__proto__'）剔除；非字符串值剔除；
 *      同一站点占多个位允许；缺字段默认 {}；旧配置无该字段时加载不报错。
 *   2. DEFAULT_CONFIG 默认 quickDialSlots 为 {}。
 *   3. 分享/导出 diff：quickDialSlots 变化时有一条「数字快拨」差异行，
 *      没变时没有（导入确认预览不撒谎）。
 *   4. 导入携带：zod schema 与已知字段表都认 quickDialSlots，
 *      导入文件带该字段时 carriedFields 包含它（否则字段级合并会丢掉它）。
 */
import { describe, expect, it } from 'vitest'
import { validateAndCleanDIYConfig } from '@/lib/modular/diy-presets'
import { DEFAULT_CONFIG, computeHomeDiyShareDiff } from '@/lib/modular/home-diy-storage'
import { DIY_LAYOUT_FIELD_NAMES } from '@/lib/modular/diy-layout-schema'
import { LayoutSchema } from '@/lib/modular/diy-layout-schema-zod'
import { sanitizeDiyLayoutInput } from '@/lib/modular/diy-layout-schema-zod'

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    version: 3,
    viewMode: 'hybrid',
    cardDisplayMode: 'standard',
    canvasBackground: 'mesh',
    ...overrides,
  }
}

describe('validateAndCleanDIYConfig：quickDialSlots 白名单', () => {
  it('合法十位保留（含 0 位），同一站点占多个位允许', () => {
    const res = validateAndCleanDIYConfig(
      baseConfig({ quickDialSlots: { '1': 'nav-a', '2': 'nav-a', '0': 'nav-b' } }),
    )
    expect(res.valid).toBe(true)
    expect(res.config.quickDialSlots).toEqual({ '1': 'nav-a', '2': 'nav-a', '0': 'nav-b' })
  })

  it('非法键剔除（11、a、__proto__、空键）', () => {
    const res = validateAndCleanDIYConfig(
      baseConfig({
        quickDialSlots: { '1': 'nav-a', '11': 'nav-b', a: 'nav-c', __proto__: 'nav-d', '': 'nav-e' },
      }),
    )
    expect(res.valid).toBe(true)
    expect(res.config.quickDialSlots).toEqual({ '1': 'nav-a' })
    expect(res.dropped).toBeGreaterThan(0)
  })

  it('非字符串值剔除（数字、null、对象、数组）', () => {
    const res = validateAndCleanDIYConfig(
      baseConfig({ quickDialSlots: { '1': 123, '2': null, '3': { id: 'x' }, '4': ['nav-a'], '5': 'nav-e' } }),
    )
    expect(res.valid).toBe(true)
    expect(res.config.quickDialSlots).toEqual({ '5': 'nav-e' })
  })

  it('缺字段默认 {}；旧配置无该字段时加载不报错', () => {
    const res = validateAndCleanDIYConfig(baseConfig())
    expect(res.valid).toBe(true)
    expect(res.config.quickDialSlots).toEqual({})
    const legacy = validateAndCleanDIYConfig(
      baseConfig({ speedDialPinnedIds: ['nav-a'], speedDialEnabled: true }),
    )
    expect(legacy.valid).toBe(true)
    expect(legacy.config.quickDialSlots).toEqual({})
    expect(legacy.config.speedDialPinnedIds).toEqual(['nav-a'])
  })

  it('非对象值（字符串/数组）回退 {}', () => {
    expect(validateAndCleanDIYConfig(baseConfig({ quickDialSlots: 'nav-a' })).config.quickDialSlots).toEqual({})
    expect(validateAndCleanDIYConfig(baseConfig({ quickDialSlots: ['nav-a'] })).config.quickDialSlots).toEqual({})
  })

  it('DEFAULT_CONFIG 默认 quickDialSlots 为 {}', () => {
    expect(DEFAULT_CONFIG.quickDialSlots).toEqual({})
  })
})

describe('分享/导出 diff：quickDialSlots', () => {
  function configWith(slots: Record<string, string>) {
    return { ...DEFAULT_CONFIG, quickDialSlots: slots }
  }

  it('快拨位变化时有一条差异行', () => {
    const diff = computeHomeDiyShareDiff(configWith({ '1': 'nav-a' }), configWith({ '1': 'nav-b', '2': 'nav-c' }))
    expect(diff.some((d) => d.startsWith('数字快拨：'))).toBe(true)
  })

  it('快拨位没变时没有差异行', () => {
    const diff = computeHomeDiyShareDiff(configWith({ '1': 'nav-a' }), configWith({ '1': 'nav-a' }))
    expect(diff.some((d) => d.startsWith('数字快拨'))).toBe(false)
  })

  it('只给 carriedFields 含 quickDialSlots 时才比对（分享链接不带该字段时不列）', () => {
    const diff = computeHomeDiyShareDiff(configWith({ '1': 'nav-a' }), configWith({ '1': 'nav-b' }), ['viewMode'])
    expect(diff.some((d) => d.startsWith('数字快拨'))).toBe(false)
  })
})

describe('导入携带：quickDialSlots 进 schema 与已知字段表', () => {
  it('DIY_LAYOUT_FIELD_NAMES 与 LayoutSchema.shape 都有 quickDialSlots（两边漂移测试会拦）', () => {
    expect(DIY_LAYOUT_FIELD_NAMES).toContain('quickDialSlots')
    expect(Object.keys(LayoutSchema.shape)).toContain('quickDialSlots')
  })

  it('sanitizeDiyLayoutInput 的 carriedFields 包含 quickDialSlots', () => {
    const res = sanitizeDiyLayoutInput(baseConfig({ quickDialSlots: { '1': 'nav-a' } }))
    expect(res.ok).toBe(true)
    expect(res.carriedFields).toContain('quickDialSlots')
    expect((res.config as Record<string, unknown>).quickDialSlots).toEqual({ '1': 'nav-a' })
  })
})
