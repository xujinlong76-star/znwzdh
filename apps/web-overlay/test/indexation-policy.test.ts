import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { STATIC_PATHS } from '../src/lib/seo/sitemap-entries'

/**
 * I4 收录策略。
 *
 * 2026-10-22 决策（视频库仍是占位内容 → noindex,follow 且移出 sitemap）：
 * **该决策的判据已经不成立**——库内 video_items 实测 5578 条真实内容（含
 * platform / duration_sec / quality_score），不是占位；而且视频与站点详情页
 * 长期互无联动（查 Docker 站点看不到 Docker 教程），属于内容孤岛。
 * 因此 2026-10-31 改判：
 * - /videos **可索引**（index:true），并进 sitemap 静态页；
 * - /submit 保持可索引但不进 sitemap；
 * - /graph 保留收录，并补静态说明作为可读正文。
 *
 * 这几条都是「读源码才能发现」的静默回归：sitemap 里多/少一条、metadata
 * 少一行 robots，运行时审计不会主动报错，所以在这里锁住。
 * 改判必须连测试一起改——否则就是「把策略改了、守卫还在防旧策略」。
 */
describe('I4 收录策略', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

  it('sitemap 静态页含 /videos，但不含 /submit', () => {
    // /videos 改判为可索引（见文件头），必须真的出现在静态清单里，
    // 否则爬虫从 sitemap 发现不了这一批 5578 条视频内容。
    expect(STATIC_PATHS as readonly string[]).toContain('/videos')
    // /submit 是提交入口（一次性动作页），进 sitemap 只会浪费抓取预算
    expect(STATIC_PATHS as readonly string[]).not.toContain('/submit')
  })

  it('/videos 声明 index:true（可索引，不再是 noindex）', () => {
    const page = read('../src/app/videos/page.tsx')
    expect(page).toMatch(/robots:\s*\{\s*index:\s*true,\s*follow:\s*true\s*\}/)
    expect(page).not.toMatch(/index:\s*false/)
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
