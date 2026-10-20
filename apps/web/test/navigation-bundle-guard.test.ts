import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

describe('/admin/navigation 的添加表单必须按需加载', () => {
  it('同路径包装器不静态引入 react-hook-form/zod', () => {
    const wrapper = read('src/app/admin/navigation/components/AddNavigationForm.tsx')
    expect(wrapper).toContain('dynamic(')
    expect(wrapper).toContain('import("./AddNavigationForm.impl")')
    expect(wrapper).not.toMatch(/from\s+["']react-hook-form["']/)
    expect(wrapper).not.toMatch(/from\s+["']zod["']/)
  })

  it('真正的表单实现保留表单库与图标选择器', () => {
    const impl = read('src/app/admin/navigation/components/AddNavigationForm.impl.tsx')
    expect(impl).toContain('from "react-hook-form"')
    expect(impl).toContain("from './IconSelector'")
  })
})
