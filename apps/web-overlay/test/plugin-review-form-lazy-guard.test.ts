import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

describe('插件详情评价表单按需加载（首屏预算修复不得回退）', () => {
  const section = read('src/components/plugins/plugin-review-section.tsx')

  it('评价区块不静态引用 Input，表单走 dynamic 导入', () => {
    expect(section).not.toMatch(/from\s+["']@\/components\/ui\/input["']/)
    expect(section).toMatch(/import\(\s*["']@\/components\/plugins\/plugin-review-form["']\s*\)/)
    expect(section).toContain("from 'next/dynamic'")
    expect(section).toContain('ssr: false')
  })

  it('占位骨架固定高度并读屏可播报，避免 CLS 与静默加载', () => {
    const start = section.indexOf('const ReviewForm = dynamic(')
    expect(start).toBeGreaterThan(-1)
    const block = section.slice(start, start + 600)
    expect(block).toContain('aria-busy="true"')
    expect(block).toContain('sr-only')
    expect(block).toMatch(/h-\d+/)
  })

  it('表单本体保留星级 radiogroup 与键盘可达性', () => {
    const form = read('src/components/plugins/plugin-review-form.tsx')
    expect(form).toContain('export function ReviewForm')
    expect(form).toContain('role="radiogroup"')
    expect(form).toContain('role="radio"')
    expect(form).toContain('aria-checked')
    expect(form).toContain('onKeyDown')
  })
})
