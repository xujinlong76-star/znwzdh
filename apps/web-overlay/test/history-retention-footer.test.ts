/**
 * U-373：历史页脚显示上次清理时间。
 *
 * vitest 无 jsdom 写不了渲染断言，沿用 history-visits-tab.test.ts 的
 * 源码文本断言体例：读 apps/web-overlay/src/app/me/history/page.tsx 源码，
 * 锁死「页脚读服务端真实清理时间、无记录不编造、离线快照态不展示」的接线。
 * 真点按靠 CI E2E 闭合。
 *
 * 注意：vitest 只从 apps/web/test 运行（见根 vitest.config.ts），本文件
 * 经 `pnpm mirror:web` 同步到 apps/web/test 后才生效；overlaySource 按
 * history-visits-tab.test.ts 的口径优先读 overlay 源码。
 */
import { existsSync, readFileSync } from 'node:fs'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// mock 卫生兜底：本文件无跨模块 mock，但与同 worker 的后续文件隔离，
// 沿用 drama-due-badge.test.ts / search-plugin-results.test.ts 的口径。
afterAll(() => {
  vi.resetModules()
})

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

const PAGE = overlaySource('src/app/me/history/page.tsx')

describe('U-373：历史页脚显示上次清理时间', () => {
  it('断言 1：页脚读服务端返回的真实清理时间（lastHistoryCleanupAt），不是本地编造', () => {
    expect(PAGE).toContain('lastHistoryCleanupAt')
    expect(PAGE).toContain('setLastCleanupAt(page.lastHistoryCleanupAt ?? null)')
    // 时间只从服务端来：页脚不得出现写死的日期/时间字面量
    expect(PAGE).not.toMatch(/上次清理于 \$\{[^}]*202\d/)
  })

  it('断言 2：无清理记录时如实说「暂无清理记录」，不编造时间', () => {
    expect(PAGE).toContain('暂无清理记录')
    expect(PAGE).toContain("lastCleanupAt\n            ? `历史自动清理：上次清理于")
  })

  it('断言 3：离线快照态不展示页脚时间（快照不知道服务端最新清理时间）', () => {
    expect(PAGE).toContain("{state === 'ready' && !offlineSnapshotAt && (")
  })

  it('断言 4：身份/重取时先清旧时间，避免旧身份的时间残留谎报', () => {
    expect(PAGE).toContain('setLastCleanupAt(null)')
  })

  it('断言 5：页脚在 <Footer /> 之前、页面底部', () => {
    const footerIdx = PAGE.indexOf('历史自动清理：上次清理于')
    const siteFooterIdx = PAGE.indexOf('<Footer />')
    expect(footerIdx).toBeGreaterThan(0)
    expect(siteFooterIdx).toBeGreaterThan(footerIdx)
  })
})
