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
 * 就是 404。这里锁四件事：
 *   1. 链接工厂对非 published 状态走 `/marketplace/{slug}/preview`；
 *   2. 预览路由跳过服务端存在性判定，并输出 noindex；
 *   3. 主路由不再读 searchParams——那是它能进按需 ISR 的前提；
 *   4. 旧 `?preview=1` 链接由 next.config 的 redirects 兜住。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

describe('pluginDetailHref：非公开状态走预览路由', () => {
  it('published 与未知状态保持规范 URL', () => {
    expect(pluginDetailHref('legal-pro', 'published')).toBe('/marketplace/legal-pro')
    expect(pluginDetailHref('legal-pro')).toBe('/marketplace/legal-pro')
    expect(pluginDetailHref('legal-pro', null)).toBe('/marketplace/legal-pro')
  })

  it('pending/rejected/delisted/quarantined 走 /preview', () => {
    for (const status of ['pending', 'rejected', 'delisted', 'quarantined']) {
      expect(pluginDetailHref('legal-pro', status)).toBe('/marketplace/legal-pro/preview')
    }
  })

  it('不再产出 ?preview=1（那会把主路由挤出 ISR）', () => {
    for (const status of ['pending', 'rejected', 'delisted', 'quarantined', 'published']) {
      expect(pluginDetailHref('legal-pro', status)).not.toContain('preview=1')
    }
  })

  it('slug 做 URL 编码', () => {
    expect(pluginDetailHref('a b/c', 'pending')).toBe('/marketplace/a%20b%2Fc/preview')
  })
})

describe('预览路由：跳过 SSR 404 且 noindex', () => {
  const src = overlayFile('src/app/marketplace/[slug]/preview/page.tsx')

  it('输出 noindex,nofollow', () => {
    expect(src).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/)
  })

  it('不做服务端探活，直接交给客户端带身份取数', () => {
    expect(src).not.toContain('loadPluginDetail')
    expect(src).toContain('<PluginDetailView slug={safeSlug} />')
  })

  it('参数解码走 safeDecodeParam', () => {
    expect(src).toContain('safeDecodeParam')
    expect(src).not.toMatch(/decodeURIComponent\s*\(/)
  })

  it('强制动态渲染：预览不该命中 60 秒缓存', () => {
    expect(src).toContain("export const dynamic = 'force-dynamic'")
  })
})

describe('详情主路由：去掉 searchParams 才能进按需 ISR', () => {
  const src = overlayFile('src/app/marketplace/[slug]/page.tsx')

  it('page 与 generateMetadata 都不再接收 searchParams', () => {
    // 只挡真实用法（解构/类型/入参），注释里提这个词是刻意的背景说明
    expect(src).not.toMatch(/searchParams\s*[,=}:]/)
    expect(src).not.toContain('isPreviewSearch')
  })

  it('revalidate + 空 generateStaticParams（Next 16 的 ISR 硬性前提）', () => {
    expect(src).toContain('export const revalidate = 60')
    expect(src).toMatch(/export async function generateStaticParams\(\)\s*\{\s*return \[\]/)
  })
})

describe('旧 ?preview=1 链接仍有去向', () => {
  const cfg = overlayFile('next.config.js')

  it('redirects 把 ?preview=1 兜到 /preview', () => {
    expect(cfg).toMatch(/source:\s*"\/marketplace\/:slug"[\s\S]*?key:\s*"preview",\s*value:\s*"1"[\s\S]*?destination:\s*"\/marketplace\/:slug\/preview"/)
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
