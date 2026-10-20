import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

describe('拖拽库懒加载代理', () => {
  it('裸包名被别名指向代理组件', () => {
    const config = read('next.config.js')
    expect(config).toContain('resolveAlias')
    expect(config).toContain('"@hello-pangea/dnd": "./src/lib/lazy-dnd.tsx"')
  })

  it('代理内部用深路径加载真实实现，避免别名自递归', () => {
    const wrapper = read('src/lib/lazy-dnd.tsx')
    expect(wrapper).toContain('dynamic(')
    expect(wrapper).toContain("import('@hello-pangea/dnd/dist/dnd.esm.js')")
    // 裸包名 import 会再次命中别名 → 自递归
    expect(wrapper).not.toMatch(/import\(\s*["']@hello-pangea\/dnd["']\s*\)/)
  })

  it('三个拖拽组件都走代理，类型仍然透出', () => {
    const wrapper = read('src/lib/lazy-dnd.tsx')
    expect(wrapper).toContain('export const DragDropContext')
    expect(wrapper).toContain('export const Droppable')
    expect(wrapper).toContain('export const Draggable')
    expect(wrapper).toContain('export type { DropResult }')
  })
})
