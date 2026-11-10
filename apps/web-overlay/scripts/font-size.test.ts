/**
 * 字号档位（大字模式）的纯逻辑测试：坏值回标准档、档位表与标签齐全、
 * 水合前脚本只引用同一份存储键与档位表（不存在第二份真相）。
 */
import { describe, expect, it } from 'vitest'
import {
  FONT_SIZE_LABEL,
  FONT_SIZE_PREPAINT_SCRIPT,
  FONT_SIZE_PX,
  FONT_SIZE_STORAGE_KEY,
  parseFontSizeLevel,
} from '../src/lib/font-size'

describe('字号档位', () => {
  it('解析：large/xlarge 保留，其余一律标准档', () => {
    expect(parseFontSizeLevel('large')).toBe('large')
    expect(parseFontSizeLevel('xlarge')).toBe('xlarge')
    expect(parseFontSizeLevel('standard')).toBe('standard')
    expect(parseFontSizeLevel('huge')).toBe('standard')
    expect(parseFontSizeLevel(null)).toBe('standard')
  })

  it('档位递增且标签齐全，脚本引用同一存储键', () => {
    expect(FONT_SIZE_PX.standard).toBeLessThan(FONT_SIZE_PX.large)
    expect(FONT_SIZE_PX.large).toBeLessThan(FONT_SIZE_PX.xlarge)
    for (const level of ['standard', 'large', 'xlarge'] as const) {
      expect(FONT_SIZE_LABEL[level].length).toBeGreaterThan(0)
    }
    expect(FONT_SIZE_PREPAINT_SCRIPT).toContain(FONT_SIZE_STORAGE_KEY)
    expect(FONT_SIZE_PREPAINT_SCRIPT).toContain('fontSize')
  })
})
