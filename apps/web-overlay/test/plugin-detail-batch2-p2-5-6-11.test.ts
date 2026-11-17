import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
// 相对路径：镜像后 apps/web/test -> apps/web/src；overlay 内同理
import { isSafeScreenshotUrl } from '../src/app/marketplace/[slug]/detail-tab-panels'

/**
 * 插件市场第 2 批详情页三项（P2-5 懒加载 / P2-6 截图 / P2-11 安全摘要）。
 *
 * P2-5：DetailTabPanels（33,850 B）与 DetailModals（20,058 B）此前静态进
 * /marketplace/[slug] 首屏 chunk；改为 next/dynamic + ssr:false 后只在
 * 客户端按需加载。占位须定高 + aria-busy + sr-only（与
 * plugin-detail-lazy-guard.test.ts 的差异面板占位同款要求），防 CLS 与静默。
 * P2-6：截图只渲染白名单通过的公网 https 地址，容器 aspect-video 定高 +
 * 1280×720 尺寸属性 + referrerPolicy="no-referrer"；不走 next/image
 *（next.config.js 有意开着 images.unoptimized，优化器会以本站身份抓取
 * 任意第三方地址）。P2-11：详情头安全摘要条带（声明式清单明示 + 审计分 +
 * URL 健康徽章单实例，徽章从 badge 行移入、避免双实例双请求）。
 *
 * 本文件不用 vi.mock（纯源码断言 + 白名单纯函数行为），无需 resetModules。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

const SHELL = 'src/app/marketplace/[slug]/plugin-detail-view.tsx'
const PANELS = 'src/app/marketplace/[slug]/detail-tab-panels.tsx'

describe('P2-5 详情页 tab 面板与弹窗懒加载', () => {
  const shell = overlaySource(SHELL)

  it('不再静态引入 tab 面板与弹窗', () => {
    expect(shell).not.toMatch(/^import\s+\{\s*DetailTabPanels\s*\}\s+from\s+'\.\/detail-tab-panels'/m)
    expect(shell).not.toMatch(/^import\s+\{\s*DetailModals\s*\}\s+from\s+'\.\/detail-modals'/m)
  })

  it('经 next/dynamic 且仅在客户端加载', () => {
    expect(shell).toContain("from 'next/dynamic'")
    expect(shell).toContain("dynamic(() => import('./detail-tab-panels')")
    expect(shell).toContain("dynamic(() => import('./detail-modals')")
    expect(shell.match(/ssr: false/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('加载占位有固定高度与读屏播报，避免 CLS 与静默', () => {
    const loadings = [...shell.matchAll(/loading: \(\) =>/g)]
    expect(loadings.length).toBeGreaterThanOrEqual(2)
    for (const m of loadings) {
      const block = shell.slice(m.index!, m.index! + 400)
      expect(block).toContain('aria-busy="true"')
      expect(block).toContain('sr-only')
      expect(block).toMatch(/h-64/)
    }
  })

  it('壳仍在瘦身下限内（< 1150 行）', () => {
    expect(shell.split('\n').length).toBeLessThan(1150)
  })
})

describe('P2-6 截图白名单与定尺寸', () => {
  const panels = overlaySource(PANELS)

  it('画廊只渲染白名单过滤后的截图', () => {
    expect(panels).toContain('isSafeScreenshotUrl')
    expect(panels).toContain('.filter(isSafeScreenshotUrl)')
  })

  it('白名单规则齐全：仅 https、禁 localhost/内网段/元数据地址', () => {
    expect(panels).toContain("url.protocol !== 'https:'")
    expect(panels).toContain("'localhost'")
    expect(panels).toContain('a === 10')
    expect(panels).toContain('a === 127')
    expect(panels).toContain('b >= 16 && b <= 31')
    expect(panels).toContain('b === 168')
    expect(panels).toContain('a === 169 && b === 254')
  })

  it('截图定尺寸零 CLS：1280×720 + aspect-video 容器 + object-contain + no-referrer', () => {
    expect(panels).toContain('width={1280}')
    expect(panels).toContain('height={720}')
    expect(panels).toContain('referrerPolicy="no-referrer"')
    expect(panels).toContain('aspect-video')
    expect(panels).toContain('object-contain')
  })

  it('不走 next/image（优化器会以本站身份抓取任意第三方地址）', () => {
    expect(panels).not.toMatch(/from\s+'next\/image'/)
    expect(panels).not.toContain('<Image')
  })
})

describe('P2-6 截图白名单行为', () => {
  it('放行公网 https 图片地址', () => {
    expect(isSafeScreenshotUrl('https://example.com/shot.png')).toBe(true)
    expect(isSafeScreenshotUrl('https://cdn.example.com/a/b.jpg?x=1')).toBe(true)
    expect(isSafeScreenshotUrl('https://8.8.8.8/shot.png')).toBe(true)
  })

  it('拦下 http、相对地址与非法地址', () => {
    expect(isSafeScreenshotUrl('http://example.com/shot.png')).toBe(false)
    expect(isSafeScreenshotUrl('/shots/a.png')).toBe(false)
    expect(isSafeScreenshotUrl('data:image/png;base64,xxx')).toBe(false)
    expect(isSafeScreenshotUrl('not a url')).toBe(false)
    expect(isSafeScreenshotUrl(undefined)).toBe(false)
  })

  it('拦下 localhost、内网段、回环与元数据地址', () => {
    expect(isSafeScreenshotUrl('https://localhost:3000/shot.png')).toBe(false)
    expect(isSafeScreenshotUrl('https://127.0.0.1/shot.png')).toBe(false)
    expect(isSafeScreenshotUrl('https://10.0.0.5/shot.png')).toBe(false)
    expect(isSafeScreenshotUrl('https://172.16.0.9/shot.png')).toBe(false)
    expect(isSafeScreenshotUrl('https://172.31.255.1/shot.png')).toBe(false)
    expect(isSafeScreenshotUrl('https://192.168.1.1/shot.png')).toBe(false)
    expect(isSafeScreenshotUrl('https://169.254.169.254/latest/meta-data/')).toBe(false)
    expect(isSafeScreenshotUrl('https://[::1]/shot.png')).toBe(false)
    expect(isSafeScreenshotUrl('https://[::ffff:192.168.1.1]/shot.png')).toBe(false)
    expect(isSafeScreenshotUrl('https://[::ffff:169.254.169.254]/latest/meta-data/')).toBe(false)
    expect(isSafeScreenshotUrl('https://0x7f.0.0.1/shot.png')).toBe(false)
  })

  it('不误伤公网段：172.32 与 192.169 不是内网', () => {
    expect(isSafeScreenshotUrl('https://172.32.0.1/shot.png')).toBe(true)
    expect(isSafeScreenshotUrl('https://192.169.1.1/shot.png')).toBe(true)
  })
})

describe('P2-11 详情头安全摘要', () => {
  const shell = overlaySource(SHELL)

  it('安全摘要条带在详情头，含声明式清单明示', () => {
    expect(shell).toContain('data-testid="plugin-safety-summary"')
    expect(shell).toContain('声明式清单 · 无可执行代码')
  })

  it('有审计报告时显示审计分', () => {
    expect(shell).toContain('AI 审计 {auditReport.score} 分')
  })

  it('URL 健康徽章只剩一个实例（从 badge 行移入条带，避免双请求）', () => {
    expect(shell.match(/<PluginUrlAuditBadge/g)?.length).toBe(1)
    const strip = shell.slice(shell.indexOf('data-testid="plugin-safety-summary"'))
    expect(strip).toContain('<PluginUrlAuditBadge slug={plugin.slug} />')
  })
})
