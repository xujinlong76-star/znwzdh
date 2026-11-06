/**
 * 数值型 env 静默失效回归（2026-11-06 深扫 C-3）。
 *
 * storage.ts:74 旧写法 `Math.max(100, Number(env || 15000))`：env='abc' 时
 * Number('abc')=NaN，Math.max(100,NaN)=NaN，导致快照上限判断 `sites.length > NaN`
 * 恒 false —— 大库全表读进内存 OOM 且无日志。本守卫钉住「必须 Number.isFinite 校验」。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(resolve(ROOT, 'src/storage.ts'), 'utf8')

describe('NAVHUB_NAVIGATION_MAX_SITES 数值解析', () => {
  it('不再用 Math.max(100, Number(env)) 的 NaN 穿透写法', () => {
    expect(SRC).not.toMatch(/Math\.max\(\s*100\s*,\s*Number\(process\.env\.NAVHUB_NAVIGATION_MAX_SITES/)
  })

  it('用 Number.isFinite 校验并对非法值回退默认', () => {
    expect(SRC).toContain('NAVHUB_NAVIGATION_MAX_SITES')
    expect(SRC).toMatch(/Number\.isFinite\(n\)/ )
    expect(SRC).toContain('回退默认 15000')
  })

  it('与 SNAPSHOT_TTL_MS 同口径（同文件内安全校验写法存在）', () => {
    expect(SRC).toContain('SNAPSHOT_TTL_MS')
    expect(SRC).toMatch(/Number\.isFinite\(n\) && n >= 0/)
  })
})
