import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pluginDetailHref } from '../src/lib/plugins/detail-href.ts'

/**
 * 作者/管理员预览通道（2026-10-22）。
 *
 * 详情页 SSR 拿不到 localStorage 里的 anonId，API 对 pending/rejected 等
 * 非公开状态只会返回 404。内部入口如果仍链到裸 URL，作者刚投稿完点「预览」
 * 就是 404。这里锁两件事：
 *   1. 链接工厂对非 published 状态加 `?preview=1`；
 *   2. 详情页识别预览参数、跳过服务端 404，并输出 noindex。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

describe('pluginDetailHref：非公开状态走预览通道', () => {
  it('published 与未知状态保持规范 URL', () => {
    expect(pluginDetailHref('legal-pro', 'published')).toBe('/marketplace/legal-pro')
    expect(pluginDetailHref('legal-pro')).toBe('/marketplace/legal-pro')
    expect(pluginDetailHref('legal-pro', null)).toBe('/marketplace/legal-pro')
  })

  it('pending/rejected/delisted/quarantined 带 preview=1', () => {
    for (const status of ['pending', 'rejected', 'delisted', 'quarantined']) {
      expect(pluginDetailHref('legal-pro', status)).toBe('/marketplace/legal-pro?preview=1')
    }
  })

  it('slug 做 URL 编码', () => {
    expect(pluginDetailHref('a b/c', 'pending')).toBe('/marketplace/a%20b%2Fc?preview=1')
  })
})

describe('详情页：preview=1 跳过 SSR 404 且 noindex', () => {
  const src = overlayFile('src/app/marketplace/[slug]/page.tsx')

  it('metadata 与页面都识别预览参数', () => {
    expect(src).toContain('isPreviewSearch')
    expect(src).toMatch(/if\s*\(isPreviewSearch\(sp\)\)\s*\{\s*return\s*\{[\s\S]*?robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/)
    expect(src).toMatch(/if\s*\(isPreviewSearch\(sp\)\)\s*\{\s*return\s*<PluginDetailView\s+slug=\{safeSlug\}\s*\/>/)
  })

  it('预览分支在 loadPluginDetail/notFound 之前', () => {
    const previewIdx = src.indexOf('if (isPreviewSearch(sp))')
    const probeIdx = src.indexOf('const probe = await loadPluginDetail(safeSlug)', previewIdx)
    expect(previewIdx).toBeGreaterThan(-1)
    expect(probeIdx).toBeGreaterThan(previewIdx)
  })
})

describe('内部入口不再把非公开插件链到裸详情 URL', () => {
  const entries: Array<[string, string]> = [
    ['src/app/admin/plugins/page.tsx', 'pluginDetailHref(item.slug, item.status)'],
    ['src/app/marketplace/mine/page.tsx', 'pluginDetailHref(plugin.slug, plugin.status)'],
    ['src/components/plugins/export-plugin-modal.tsx', 'pluginDetailHref(res.slug, res.status)'],
    ['src/components/plugins/plugin-audit-modal.tsx', 'pluginDetailHref(plugin.slug, plugin.status)'],
  ]

  for (const [rel, call] of entries) {
    it(rel, () => {
      const src = overlayFile(rel)
      expect(src).toContain(call)
    })
  }
})
