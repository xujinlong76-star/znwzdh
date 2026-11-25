/**
 * F-09 守卫：`/pub` 无列表页是产品定义（by-design），不是缺口。
 *
 * 已核实的事实（2026-11-24，基底 4bbaccea）：
 * - `GET /pub` → 404；树里只有 `app/pub/[slug]`（公开页）与
 *   `app/pub/compare/[slug]`（对照快照）两个动态段；
 * - 公开页是「按 slug 的非公开分享链接」（站内链接与 sitemap 均不收
 *   `/pub` 裸路径；`[slug]` 页注释写明是 live 引用、`compare/[slug]`
 *   是快照），没有也不应有列表页；
 * - 动态段的 404 纪律另由 route-state-coverage.test.ts 锁定。
 * 若产品定义将来改为「应有列表页」，先删本文件、按 P1 立项建页，
 * 不要悄悄加路由。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayPath(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/'))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return hit
}

function overlaySource(rel: string): string {
  return readFileSync(overlayPath(rel), 'utf8')
}

describe('F-09：/pub 无列表页（by-design）', () => {
  it('树里没有 app/pub/page.tsx，只有 [slug] 与 compare/[slug] 两个动态段', () => {
    expect(existsSync(overlayPath('src/app/pub/page.tsx'))).toBe(false)
    expect(existsSync(overlayPath('src/app/pub/[slug]/page.tsx'))).toBe(true)
    expect(existsSync(overlayPath('src/app/pub/compare/[slug]/page.tsx'))).toBe(true)
  })

  it('sitemap 静态页 STATIC_PATHS 不收 /pub（也不收任何 /pub/*）', () => {
    const entries = overlaySource('src/lib/seo/sitemap-entries.ts')
    const block = entries.slice(entries.indexOf('STATIC_PATHS'))
    expect(block).not.toContain("'/pub'")
    expect(block).not.toContain('"/pub"')
    expect(block).not.toContain("'/pub/")
    expect(overlaySource('src/app/sitemap.ts')).not.toContain('/pub')
  })

  it('站内导航与底栏不链裸 /pub（公开页只以分享链接出现）', () => {
    const footer = overlaySource('src/components/footer.tsx')
    expect(footer).not.toContain('href="/pub"')
    expect(footer).not.toContain("href='/pub'")
    expect(footer).not.toContain('/pub')
  })
})
