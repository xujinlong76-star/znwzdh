/**
 * U-145：搜索历史单条删除加两步确认（对照「清空全部」confirmClear 模式）。
 *
 * vitest 无 jsdom 写不了渲染断言，沿用 p3-13 模式做源码文本断言：
 * 读 apps/web-overlay/src/app/me/history/page.tsx 源码，锁死武装状态机、
 * 守卫顺序与按钮武装态。真点按靠 CI E2E 闭合。
 *
 * 注意：vitest 只从 apps/web/test 运行（见根 vitest.config.ts），本文件
 * 经 `pnpm mirror:web` 同步到 apps/web/test 后才生效；overlaySource 按
 * p3-13 的口径优先读 overlay 源码。
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

/** 断言若干标记在源码中按给定顺序出现（严格递增）。 */
function assertOrder(src: string, markers: string[], label: string): void {
  let prev = -1
  for (const m of markers) {
    const idx = src.indexOf(m, prev + 1)
    expect(idx, `${label}：应按顺序出现 ${JSON.stringify(m)}`).toBeGreaterThan(prev)
    prev = idx
  }
}

/** 截取 removeItem 的 useCallback 体（从声明起到其依赖数组结尾）。 */
function removeItemBody(src: string): string {
  const start = src.indexOf('const removeItem = useCallback')
  expect(start, 'removeItem 应存在').toBeGreaterThanOrEqual(0)
  const end = src.indexOf('}, [', start)
  expect(end, 'removeItem 应有依赖数组').toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('U-145：单条删除两步确认', () => {
  it('断言 1：confirmDeleteId 状态存在（null = 无武装）', () => {
    expect(PAGE).toContain('const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)')
  })

  it('断言 2：武装分支先于接口调用——第一击只武装、不调 deleteSearchHistoryItem', () => {
    const body = removeItemBody(PAGE)
    // 武装分支：条件 → 置武装 → return，且该 return 之前没有接口调用。
    assertOrder(
      body,
      ['if (confirmDeleteId !== id) {', 'setConfirmDeleteId(id)', 'return'],
      'removeItem 武装分支',
    )
    const armReturn = body.indexOf('return', body.indexOf('setConfirmDeleteId(id)'))
    const apiCall = body.indexOf('deleteSearchHistoryItem')
    expect(apiCall, '接口调用应在武装分支的 return 之后').toBeGreaterThan(armReturn)
  })

  it('断言 3：第二击才调接口，且成功/失败两路都清武装（finally 锁死竞态）', () => {
    const body = removeItemBody(PAGE)
    expect(body).toContain('deleteSearchHistoryItem(identity, id)')
    // finally 里同时清 deletingId 与 confirmDeleteId：第二击发出请求后按钮
    // disabled，武装若不两路清零，失败重试会卡死 / 确认被绕过。
    const finallyIdx = body.indexOf('finally {')
    expect(finallyIdx, 'removeItem 应有 finally').toBeGreaterThanOrEqual(0)
    const finallyBlock = body.slice(finallyIdx)
    expect(finallyBlock).toContain('setDeletingId(null)')
    expect(finallyBlock).toContain('setConfirmDeleteId(null)')
    // 成功仍过滤移除、失败仍 toast：两路行为不回归。
    expect(body).toContain("setItems((prev) => prev.filter((i) => i.id !== id))")
    expect(body).toContain("title: '删除失败'")
  })

  it('断言 4：删除按钮武装态——文案「确认删除」+ destructive + aria', () => {
    expect(PAGE).toContain("variant={confirmDeleteId === item.id ? 'destructive' : 'ghost'}")
    expect(PAGE).toContain('确认删除')
    expect(PAGE).toContain('`确认删除历史 ${item.query}`')
    expect(PAGE).toContain('aria-pressed={confirmDeleteId === item.id}')
    expect(PAGE).toContain("title={confirmDeleteId === item.id ? '确认删除' : undefined}")
    // 未武装仍是 ghost 图标按钮 + 原 aria-label；删除进行中仍 disabled + spinner。
    expect(PAGE).toContain('`删除历史 ${item.query}`')
    expect(PAGE).toContain('disabled={deletingId === item.id}')
  })

  it('断言 5：切 tab 时清武装', () => {
    const tabIdx = PAGE.indexOf('setTab(key)')
    expect(tabIdx, 'tab 切换应存在').toBeGreaterThanOrEqual(0)
    const before = PAGE.slice(Math.max(0, tabIdx - 200), tabIdx)
    expect(before).toContain('setConfirmDeleteId(null)')
  })

  it('断言 6：离线快照守卫前置到武装之前', () => {
    const body = removeItemBody(PAGE)
    assertOrder(
      body,
      ['if (!identity || offlineSnapshotAt) return', 'if (confirmDeleteId !== id) {', 'setConfirmDeleteId(id)'],
      'removeItem 守卫顺序',
    )
  })

  it('断言 7：现有接线不回归——删除仍接 deleteSearchHistoryItem，清空仍两步确认', () => {
    expect(PAGE).toContain('deleteSearchHistoryItem')
    expect(PAGE).toContain('confirmClear')
    expect(PAGE).toContain("variant={confirmClear ? 'destructive' : 'outline'}")
    expect(PAGE).toContain('确认清空全部')
    // 武装切换：confirmDeleteId 单值，点另一行自动转移旧武装。
    expect(PAGE).toContain('confirmDeleteId !== id')
  })
})
