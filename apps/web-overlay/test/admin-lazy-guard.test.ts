import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

const FORM_LIBS = [/from\s+["']react-hook-form["']/, /from\s+["']zod["']/, /from\s+["']@hookform\/resolvers\/zod["']/]

describe('管理端表单必须按需加载（首屏不再背 react-hook-form + zod）', () => {
  it('站点设置页：页面壳不引表单库，实现里才引', () => {
    const page = read('src/app/admin/site/page.tsx')
    expect(page).toContain('dynamic(')
    expect(page).toContain("import('./page.impl')")
    for (const re of FORM_LIBS) expect(page).not.toMatch(re)

    const impl = read('src/app/admin/site/page.impl.tsx')
    expect(impl).toContain('from "react-hook-form"')
    expect(impl).toContain('from "zod"')
    expect(impl).toContain('@hookform/resolvers/zod')
  })

  it('站点项表单：同路径包装器不引表单库', () => {
    const wrapper = read('src/app/admin/navigation/components/AddItemForm.tsx')
    expect(wrapper).toContain('dynamic(')
    expect(wrapper).toMatch(/import\(["']\.\/AddItemForm\.impl["']\)/)
    for (const re of FORM_LIBS) expect(wrapper).not.toMatch(re)

    const impl = read('src/app/admin/navigation/components/AddItemForm.impl.tsx')
    expect(impl).toContain('from "react-hook-form"')
    expect(impl).toContain('from "zod"')
  })

  it('分类表单：同路径包装器不引表单库', () => {
    const wrapper = read('src/app/admin/navigation/components/AddCategoryForm.tsx')
    expect(wrapper).toContain('dynamic(')
    expect(wrapper).toMatch(/import\(["']\.\/AddCategoryForm\.impl["']\)/)
    for (const re of FORM_LIBS) expect(wrapper).not.toMatch(re)

    const impl = read('src/app/admin/navigation/components/AddCategoryForm.impl.tsx')
    expect(impl).toContain('from "react-hook-form"')
    expect(impl).toContain('from "zod"')
  })
})
