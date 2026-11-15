/**
 * /brief 360px 页级横向溢出守卫（进化第 72 轮）：
 *  - 360px 下「全网热榜」grid（md:grid-cols-2，360px 为单列 auto）与
 *    「今日热榜精选」grid（sm:grid-cols-2，360px 为单列 auto）的 grid item
 *    必须含 min-w-0：grid item 默认 min-width:auto 会把 HotRow 标题
 *    （nowrap 全宽）当成列宽下限，轨道被撑宽 → documentElement.scrollWidth
 *    > innerWidth，页级横向溢出；行内截断链（HotRow min-w-0 flex-1 +
 *    truncate）本身完整，问题只在 grid item 层。
 *  - 两处：SourceColumn 的 <section>、热榜精选的 grid item <div>。
 *  - 不动 HotRow、不动站内搜按钮（min-h-11 min-w-11 shrink-0 守卫见
 *    brief-hotrow-target-guard.test.ts）、不动数据逻辑。
 * 源码断言模式照 brief-hotrow-target-guard.test.ts。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

describe('/brief 360px 横向溢出守卫（grid item min-w-0）', () => {
  const page = read('src/app/brief/page.tsx')
  // SourceColumn 函数体：从定义处起到下一个顶层函数（BriefPage）为止。
  const sourceColumn = page.slice(page.indexOf('function SourceColumn'), page.indexOf('export default async function BriefPage'))
  // 热榜精选 grid item <div>：从「今日热榜精选」起的第一个 grid item。
  const hotPicks = page.slice(page.indexOf('今日热榜精选'))

  it('SourceColumn 的 section 含 min-w-0（全网热榜 grid item）', () => {
    expect(page.indexOf('function SourceColumn')).toBeGreaterThan(-1)
    expect(sourceColumn).toContain('<section aria-label={source.name} className="min-w-0 rounded-xl border bg-card p-4">')
  })

  it('热榜精选 grid item <div> 含 min-w-0', () => {
    expect(hotPicks).toContain('<div key={sourceId} className="min-w-0 rounded-xl border bg-card p-4">')
  })

  it('两处 grid 仍为单列 auto 轨道（360px 下生效的前提未变）', () => {
    expect(page).toContain('className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"')
    expect(page).toContain('className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"')
  })

  it('行内截断链未动：HotRow 仍 min-w-0 flex-1 + truncate', () => {
    const hotRow = page.slice(page.indexOf('function HotRow'), page.indexOf('function SourceColumn'))
    expect(hotRow).toContain('min-w-0 flex-1')
    expect(hotRow).toContain('truncate')
  })
})
