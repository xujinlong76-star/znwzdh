import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { STATIC_PATHS } from '../src/lib/seo/sitemap-entries'

/**
 * I4 收录策略（2026-10-22 决策）：
 * - /videos 视频库仍是占位内容 → noindex,follow 且移出 sitemap；
 * - /submit 保持可索引，但不进 sitemap；
 * - /graph 保留收录，并补静态说明作为可读正文。
 *
 * 这三条都是「读源码才能发现」的静默回归：sitemap 里多一条、metadata
 * 少一行 robots，运行时审计不会主动报错，所以在这里锁住。
 */
describe('I4 收录策略', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

  it('sitemap 静态页不含 /videos 与 /submit', () => {
    expect(STATIC_PATHS as readonly string[]).not.toContain('/videos')
    expect(STATIC_PATHS as readonly string[]).not.toContain('/submit')
  })

  it('/videos 声明 noindex,follow（保留内链权重）', () => {
    const page = read('../src/app/videos/page.tsx')
    expect(page).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*true\s*\}/)
  })

  it('/graph 补静态说明且保持可索引', () => {
    const page = read('../src/app/graph/page.tsx')
    expect(page).toContain('如何读这张图谱')
    expect(page).toContain('平替候选')
    expect(page).toContain('生态链路')
    expect(page).toContain('键盘漫游')
    expect(page).not.toMatch(/index:\s*false/)
  })
})
