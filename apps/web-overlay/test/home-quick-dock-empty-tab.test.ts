/**
 * U-365 子项：速拨坞空 tab 只有 disabled、没有任何解释文案。
 *
 * 主项已修并已验证（home-quick-dock-default-tab.test.ts：resolveDefaultDockTab
 * 三条规则测试在纯 main 上通过；仅当无钉选且有最近访问时默认「最近」）。
 * 本文件只钉子项：空 tab 除了灰掉，必须有可见的解释文案。
 *
 * 注意：home-quick-dock-default-tab.test.ts 在 main 上另有 3 个失败，
 * 属未合入的 U-445（A′ 下拉重构）范围，与本子项无关，不在此修。
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

const DOCK = overlaySource('src/components/home-quick-dock.tsx')

describe('U-365 子项：空 tab 有解释文案，不只灰掉', () => {
  it('「最近」空时有可见文案「暂无最近访问」', () => {
    expect(DOCK).toContain('暂无最近访问')
  })

  it('「常用」空时有可见文案「暂无常用站点」', () => {
    expect(DOCK).toContain('暂无常用站点')
  })

  it('空 tab 的按钮仍 disabled，但带 title 解释（悬停也能看到原因）', () => {
    expect(DOCK).toContain("title={mounted && frequentVisits.length === 0 ? '暂无常用站点' : undefined}")
    expect(DOCK).toContain("title={mounted && recentVisits.length === 0 ? '暂无最近访问' : undefined}")
    expect(DOCK).toContain('disabled={!mounted || frequentVisits.length === 0}')
    expect(DOCK).toContain('disabled={!mounted || recentVisits.length === 0}')
  })

  it('文案只在对应列表为空时出现，不常驻', () => {
    // 文案渲染受空列表门控，而非写死在 tab 按钮里。
    expect(DOCK).toMatch(/frequentVisits\.length === 0 &&[\s\S]{0,200}暂无常用站点/)
    expect(DOCK).toMatch(/recentVisits\.length === 0 &&[\s\S]{0,200}暂无最近访问/)
  })
})
