/**
 * 低版本浏览器兜底注入的预取链接必须能清理（P2-14）。
 *
 * 修的是什么：`SpeculativePrerenderManager` 在卸载时只删了 speculationrules 的
 * `<script>`，兜底路径注入的 `<link rel=prefetch/prerender>` 留在 `document.head`
 * 里跨路由累积（悬停扫过的每个链接都会加一条）。
 *
 * 关键约束（本轮特意避开的一个坑）：**不能**按 `link[rel=prefetch]` 全删——
 * Next App Router 自己也用 prefetch 链接，全删会打断路由预取。
 * 所以只删带本组件标记的那些，断言里要同时锁住「有标记」与「按标记删」。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const src = readFileSync(resolve(ROOT, 'src/components/speculative-prerender.tsx'), 'utf8')

describe('speculative-prerender：兜底 <link> 的注入与清理', () => {
  it('注入时打上 data-navhub-speculation 标记', () => {
    expect(src).toMatch(/link\.dataset\.navhubSpeculation\s*=/)
  })

  it('卸载时按标记清理（不是按 rel=prefetch 全删）', () => {
    expect(src).toMatch(/querySelectorAll\('link\[data-navhub-speculation="1"\]'\)/)
    // 反向保险：不得出现把全部 prefetch 链接删掉的写法
    expect(src).not.toMatch(/querySelectorAll\('link\[rel="prefetch"\]'\)/)
  })

  it('script 与 link 的清理都在同一个 effect 的返回函数里', () => {
    const cleanup = src.slice(src.indexOf('return () => {'))
    expect(cleanup).toContain('script.remove()')
    expect(cleanup).toContain('data-navhub-speculation')
  })
})
