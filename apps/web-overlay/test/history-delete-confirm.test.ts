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

/** 底部搜索「加载更多」块：从其渲染条件起截取到按钮闭合。 */
function bottomSearchLoadMoreBlock(src: string): string {
  const idx = src.indexOf("state === 'ready' && hasMore")
  expect(idx, '底部搜索加载更多条件应存在').toBeGreaterThanOrEqual(0)
  const start = src.lastIndexOf('{', idx)
  const end = src.indexOf('</Button>', idx)
  expect(end, '底部搜索加载更多按钮应闭合').toBeGreaterThan(idx)
  return src.slice(start, end)
}

/** 访问 tab 的「加载更多」块：从 visitHasMore 条件起截取到按钮闭合。 */
function visitLoadMoreBlock(src: string): string {
  const idx = src.indexOf('visitHasMore && (')
  expect(idx, '访问加载更多条件应存在').toBeGreaterThanOrEqual(0)
  const start = src.lastIndexOf('{', idx)
  const end = src.indexOf('</Button>', idx)
  expect(end, '访问加载更多按钮应闭合').toBeGreaterThan(idx)
  return src.slice(start, end)
}

/** tab 切换 onClick 体：从 role="tab" 的 onClick 起截到 setTab(key) 之后。 */
function tabSwitchHandler(src: string): string {
  const tabIdx = src.indexOf('setTab(key)')
  expect(tabIdx, 'tab 切换应存在').toBeGreaterThanOrEqual(0)
  const start = src.lastIndexOf('onClick', tabIdx)
  return src.slice(start, tabIdx + 'setTab(key)'.length)
}

describe('U-228：访问 tab 下不出现搜索历史「加载更多」', () => {
  it('断言 1：底部搜索加载更多块的渲染条件含 tab === \'searches\'', () => {
    const block = bottomSearchLoadMoreBlock(PAGE)
    expect(block).toContain("tab === 'searches'")
    expect(block).toContain("state === 'ready' && hasMore")
    expect(block).toContain('onClick={() => void loadMore()}')
  })

  it('断言 2：搜索 tab 下唯一加载更多——访问块守 visitHasMore 且接 loadVisits', () => {
    const visitBlock = visitLoadMoreBlock(PAGE)
    expect(visitBlock).toContain('onClick={() => void loadVisits(visitNextOffset)}')
    expect(visitBlock).not.toContain('loadMore()')
    // 访问块在 visits 分支内：其前最近的 tab 分支条件是 visits。
    const visitIdx = PAGE.indexOf('visitHasMore && (')
    const visitsBranch = PAGE.lastIndexOf("tab === 'visits'", visitIdx)
    expect(visitsBranch, '访问块应在 visits 分支内').toBeGreaterThanOrEqual(0)
    // 两按钮各守各的 hasMore：搜索块用 hasMore，访问块用 visitHasMore。
    expect(bottomSearchLoadMoreBlock(PAGE)).toContain('hasMore')
    expect(bottomSearchLoadMoreBlock(PAGE)).not.toContain('visitHasMore')
  })

  it('断言 3：切 tab 不丢另一 tab 已加载数据（只清武装 + 切 tab，无重置）', () => {
    const handler = tabSwitchHandler(PAGE)
    expect(handler).toContain('setConfirmDeleteId(null)')
    expect(handler).toContain('setTab(key)')
    expect(handler).not.toContain('setItems([])')
    expect(handler).not.toContain('setVisits([])')
    expect(handler).not.toContain('setHasMore(false)')
    expect(handler).not.toContain('setVisitHasMore(false)')
    expect(handler).not.toContain('setNextOffset(0)')
  })
})

describe('U-193 方案①：筛选态下按钮不藏、只改文案 + 检索范围说明', () => {
  it('断言 1：检索框下方有范围说明文案，N 为已加载动态条数', () => {
    expect(PAGE).toContain('仅检索已加载的 {items.length} 条，加载更多可扩大检索范围')
    // 文案在搜索 tab 分支内（检索工具栏之后、列表之前）。
    const branchIdx = PAGE.indexOf("tab === 'searches' && state === 'ready' && items.length > 0")
    const noteIdx = PAGE.indexOf('仅检索已加载的 {items.length} 条')
    expect(branchIdx, '搜索分支应存在').toBeGreaterThanOrEqual(0)
    expect(noteIdx, '范围说明应在搜索分支内').toBeGreaterThan(branchIdx)
  })

  it('断言 2：筛选态（keyword 非空或 filterMode 非 all）下按钮文案为扩大检索范围', () => {
    expect(PAGE).toContain("const isFiltering = keyword.trim() !== '' || filterMode !== 'all'")
    const block = bottomSearchLoadMoreBlock(PAGE)
    expect(block).toContain("{isFiltering ? '加载更多记录以扩大检索范围' : '加载更多'}")
  })

  it('断言 3：筛选态不藏按钮——底部按钮渲染条件里无筛选态门控', () => {
    const condIdx = PAGE.indexOf("state === 'ready' && hasMore")
    const condStart = PAGE.lastIndexOf('{', condIdx)
    const condition = PAGE.slice(condStart, condIdx + "state === 'ready' && hasMore".length)
    expect(condition).not.toContain('isFiltering')
    expect(condition).not.toContain('keyword')
    expect(condition).not.toContain('filterMode')
  })
})

describe('A2：页头清理/清空操作栏只属于搜索 tab', () => {
  it('断言 1：页头操作栏渲染条件含 tab === \'searches\'（访问 tab 下不显示）', () => {
    expect(PAGE).toContain("tab === 'searches' && items.length > 0 ? (")
    // 操作栏内仍是搜索历史专属按钮：清理零结果、清空全部。
    const actionsIdx = PAGE.indexOf("tab === 'searches' && items.length > 0 ? (")
    const actionsBlock = PAGE.slice(actionsIdx, actionsIdx + 1200)
    expect(actionsBlock).toContain('清理零结果记录')
    expect(actionsBlock).toContain('清空全部')
  })

  it('断言 2：切 tab 时清 confirmClear 武装态（与清 confirmDeleteId 同款）', () => {
    const handler = tabSwitchHandler(PAGE)
    expect(handler).toContain('setConfirmDeleteId(null)')
    expect(handler).toContain('setConfirmClear(false)')
    expect(handler).toContain('setTab(key)')
  })
})

const CAL = overlaySource('src/lib/exam-calendar.ts')

describe('U-233：11-19 今日行注释为 3 项（含天津成绩复核）', () => {
  it('断言 1：todayNodes 注释写 11-19 共 3 项，含天津成绩复核（U-162）', () => {
    expect(CAL).toContain('11-19 海南成绩查询（today）+ 天津成绩复核（today，U-162）+ 上海自考成绩查询（startsToday）3 项')
    expect(CAL).not.toContain('上海自考成绩查询（startsToday）2 项')
  })
})

const NAVHUB_API = overlaySource('src/lib/navhub-api.ts')
const RESURFACE_VISITS = overlaySource('src/lib/resurface-visits.ts')

/** 截取 fetchVisitsPage 体（从导出声明起到下一节「画像」注释之前）。 */
function fetchVisitsPageBody(src: string): string {
  const start = src.indexOf('export async function fetchVisitsPage(')
  expect(start, 'fetchVisitsPage 应存在').toBeGreaterThanOrEqual(0)
  const end = src.indexOf('/* ------------------------------ 画像 ------------------------------ */', start)
  expect(end, 'fetchVisitsPage 之后应有画像节').toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('U-239：匿名访问历史 401——fetchVisitsPage 自报 anon 身份头', () => {
  it('断言 1：fetchVisitsPage 首参是 identity（与 fetchSearchHistoryPage 同款签名）', () => {
    const body = fetchVisitsPageBody(NAVHUB_API)
    expect(body).toContain('export async function fetchVisitsPage(\n  identity: string,')
    expect(body).not.toContain('不需要自报 anonId')
  })

  it('断言 2：GET /api/me/visits 带 anonHeaders(identity)——匿名态代理才能签名转发，否则 401', () => {
    const body = fetchVisitsPageBody(NAVHUB_API)
    assertOrder(
      body,
      ["'/api/me/visits?limit=' + limit + '&offset=' + offset,", 'anonHeaders(identity)'],
      'fetchVisitsPage 取数',
    )
    // getJson 第三参就是 extraHeaders：头不到代理，verdict 即 anonymous。
    expect(body).toContain('anonHeaders(identity),')
  })

  it('断言 3：fetchCloudVisits（登录态唯一调用方）同步传 getIdentity()，登录行为不变', () => {
    expect(RESURFACE_VISITS).toContain("import { getIdentity } from './identity'")
    expect(RESURFACE_VISITS).toContain('fetchVisitsPage(getIdentity(), { limit: CLOUD_VISITS_LIMIT })')
    // 仍只在登录态发云端请求：匿名用户不产生任何云端请求。
    expect(RESURFACE_VISITS).toContain('isLoggedIn ? fetchCloudVisits() : Promise.resolve(null)')
    expect(RESURFACE_VISITS).not.toContain('走 BFF 会话身份')
  })

  it('断言 4：搜索历史取数不受影响——仍传 anonHeaders(identity)', () => {
    expect(NAVHUB_API).toContain('export async function fetchSearchHistoryPage(\n  identity: string,')
    const start = NAVHUB_API.indexOf('export async function fetchSearchHistoryPage(')
    const body = NAVHUB_API.slice(start, NAVHUB_API.indexOf('export async function deleteSearchHistoryItem', start))
    expect(body).toContain('anonHeaders(identity),')
  })
})

const WATCHLIST = overlaySource('src/app/me/watchlist/page.tsx')

describe('U-230：集数步进空值不调 onSet、不静默清零', () => {
  it('断言 1：commit 空值守卫——空/空白先恢复原值 return，onSet 只在守卫之后', () => {
    const start = WATCHLIST.indexOf('const commit = () => {')
    expect(start, 'EpisodeStepper commit 应存在').toBeGreaterThanOrEqual(0)
    const body = WATCHLIST.slice(start, WATCHLIST.indexOf('}\n  )', start))
    const guardIdx = body.indexOf("if (draft.trim() === '') {")
    expect(guardIdx, 'commit 应有空值守卫').toBeGreaterThanOrEqual(0)
    const guardBlock = body.slice(guardIdx, body.indexOf('}', guardIdx) + 1)
    expect(guardBlock).toContain('setDraft(null)')
    expect(guardBlock).toContain('return')
    expect(guardBlock).not.toContain('onSet')
    // 守卫在 Number(draft)/onSet 之前：空值到不了写盘。
    expect(body.indexOf('onSet(n)'), 'onSet 应在守卫之后').toBeGreaterThan(guardIdx)
    expect(body.indexOf('Number(draft)'), 'Number 转换应在守卫之后').toBeGreaterThan(guardIdx)
  })
})
