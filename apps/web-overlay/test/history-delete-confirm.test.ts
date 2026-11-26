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
    // U-375 起用 tabSwitchHandler 全量截取：切 tab 处理器随武装复位项增多
    // 而变长（访问侧 setConfirmClearVisits(false) + setConfirmDeleteVisitId(null)），
    // 固定 400 字符窗口已装不下首项 setConfirmDeleteId(null)；窗口仍只覆盖本处理器。
    const handler = tabSwitchHandler(PAGE)
    expect(handler).toContain('setConfirmDeleteId(null)')
    expect(handler).toContain('setTab(key)')
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
    // U-400 起窗口 1600：零结果按钮加了武装态 title/aria 与两态文案，块变长；
    // 窗口只覆盖页头操作栏，仍不断言操作栏之外的文案。
    const actionsBlock = PAGE.slice(actionsIdx, actionsIdx + 1600)
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

/** 截取 loadVisits 的 useCallback 体（从声明起到其依赖数组结尾）。 */
function loadVisitsBody(src: string): string {
  const start = src.indexOf('const loadVisits = useCallback')
  expect(start, 'loadVisits 应存在').toBeGreaterThanOrEqual(0)
  const end = src.indexOf('}, [', start)
  expect(end, 'loadVisits 应有依赖数组').toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('U-239（页面接线）：历史页访问 tab 用当前身份取数', () => {
  it('断言 1：loadVisits 传 identity 调 fetchVisitsPage，身份未就绪不发请求', () => {
    const body = loadVisitsBody(PAGE)
    expect(body).toContain('fetchVisitsPage(identity, { limit: 20, offset }')
    // 守卫先于取数：visitBusy 或 identity 为空直接 return，不产生 401。
    assertOrder(
      body,
      ['if (visitBusy || !identity) return', 'fetchVisitsPage(identity,'],
      'loadVisits 守卫顺序',
    )
  })

  it('断言 2：loadVisits 依赖 identity——身份就绪后 effect 重跑再取', () => {
    const start = PAGE.indexOf('const loadVisits = useCallback')
    const depStart = PAGE.indexOf('}, [', start)
    const depEnd = PAGE.indexOf('])', depStart)
    const deps = PAGE.slice(depStart, depEnd)
    expect(deps).toContain('visitBusy')
    expect(deps).toContain('identity')
  })

  it('断言 3：搜索 tab 取数不受影响——仍用 fetchSearchHistoryPage(identity, …)', () => {
    expect(PAGE).toContain('fetchSearchHistoryPage(id, { limit: PAGE_SIZE, offset: 0 }')
    // A6 起 loadMore 传降级回调（失败 toast + 保留 hasMore）：调用仍是同一
    // 函数/同一身份/同一分页，回调只接失败事实，不改变取数口径。
    expect(PAGE).toContain('fetchSearchHistoryPage(identity, { limit: PAGE_SIZE, offset: nextOffset }, () => {')
    // 访问取数不走搜索接口、不复用搜索分页状态。
    const body = loadVisitsBody(PAGE)
    expect(body).not.toContain('fetchSearchHistoryPage')
    expect(body).not.toContain('setItems(')
  })
})

/** 截取 clearVisits 的 useCallback 体（从声明起到其依赖数组结尾）。 */
function clearVisitsBody(src: string): string {
  const start = src.indexOf('const clearVisits = useCallback')
  expect(start, 'clearVisits 应存在').toBeGreaterThanOrEqual(0)
  const end = src.indexOf('}, [', start)
  expect(end, 'clearVisits 应有依赖数组').toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('访问历史清空两步确认（clearVisits 与 clearAll 同构）', () => {
  it('断言 1：confirmClearVisits 状态存在（false = 无武装）', () => {
    expect(PAGE).toContain('const [confirmClearVisits, setConfirmClearVisits] = useState(false)')
    // 武装调用必须存在且仅在武装分支——此前全仓零调用 setConfirmClearVisits(true)，
    // 「确认清空访问记录」文案是死代码，首击即删。
    expect(PAGE).toContain('setConfirmClearVisits(true)')
  })

  it('断言 2：武装分支先于接口调用——第一击只武装、不调 clearCloudVisits', () => {
    const body = clearVisitsBody(PAGE)
    // 武装分支：条件 → 置武装 → return，且该 return 之前没有接口调用。
    assertOrder(
      body,
      ['if (!confirmClearVisits) {', 'setConfirmClearVisits(true)', 'return'],
      'clearVisits 武装分支',
    )
    const armReturn = body.indexOf('return', body.indexOf('setConfirmClearVisits(true)'))
    // U-375：清空改走 DELETE /api/me/visits（clearCloudVisits），不再走
    // clearProfileSignals(identity, 'click')——后者会删画像信号并立即重建
    // 画像，「清空访问记录」不等于「清空画像」。两步确认结构本身不变。
    const apiCall = body.indexOf('clearCloudVisits')
    expect(apiCall, '接口调用应在武装分支的 return 之后').toBeGreaterThan(armReturn)
    // 武装分支内无删除调用：第一击零网络请求。
    expect(body.slice(0, armReturn)).not.toContain('clearCloudVisits')
    // 依赖数组含武装态，否则闭包读到旧值、第二击仍走武装分支。
    const depStart = PAGE.indexOf('}, [', PAGE.indexOf('const clearVisits = useCallback'))
    const depEnd = PAGE.indexOf('])', depStart)
    expect(PAGE.slice(depStart, depEnd)).toContain('confirmClearVisits')
  })

  it('断言 3：第二击才调接口清空访问流水，成功清空列表、失败保留记录', () => {
    const body = clearVisitsBody(PAGE)
    // U-375：接口改走 clearCloudVisits(identity)（DELETE /api/me/visits，
    // 只删访问流水、不动画像行）；两步确认与成功/失败两路结构不变。
    expect(body).toContain('clearCloudVisits(identity)')
    // 成功/失败两路：失败先 toast 并 return，列表清空只在成功之后。
    assertOrder(
      body,
      [
        'clearCloudVisits(identity)',
        'setConfirmClearVisits(false)',
        "title: '清空访问记录失败'",
        'setVisits([])',
        "title: '访问记录已清空'",
      ],
      'clearVisits 成功/失败两路',
    )
    expect(body).toContain('setVisitTotal(0)')
    expect(body).toContain('setVisitHasMore(false)')
    // 失败不清空、不重建画像提示：失败 toast 后 return，setVisits 在其后。
    const failReturn = body.indexOf('return', body.indexOf("title: '清空访问记录失败'"))
    expect(body.indexOf('setVisits([])'), '失败 return 之后才清空列表').toBeGreaterThan(failReturn)
  })

  it('断言 4：清空按钮武装态——文案「确认清空访问记录」+ destructive，执行中 disabled', () => {
    expect(PAGE).toContain("variant={confirmClearVisits ? 'destructive' : 'outline'}")
    expect(PAGE).toContain('确认清空访问记录')
    expect(PAGE).toContain('disabled={visitBusy}')
    expect(PAGE).toContain('清空访问记录')
  })

  it('断言 5：切 tab 时清 confirmClearVisits 武装（与 A2 的 confirmClear 同款）', () => {
    const handler = tabSwitchHandler(PAGE)
    expect(handler).toContain('setConfirmDeleteId(null)')
    expect(handler).toContain('setConfirmClear(false)')
    expect(handler).toContain('setConfirmClearVisits(false)')
    expect(handler).toContain('setTab(key)')
  })

  it('断言 6：回归面——搜索清空 clearAll 与单条删除仍是两步确认', () => {
    // 搜索历史清空：武装分支仍在，接口仍在武装 return 之后。
    const clearAllStart = PAGE.indexOf('const clearAll = useCallback')
    expect(clearAllStart, 'clearAll 应存在').toBeGreaterThanOrEqual(0)
    const clearAllBody = PAGE.slice(clearAllStart, PAGE.indexOf('}, [', clearAllStart))
    assertOrder(
      clearAllBody,
      ['if (!confirmClear) {', 'setConfirmClear(true)', 'return'],
      'clearAll 武装分支',
    )
    expect(clearAllBody).toContain('clearCloudSearchHistory(identity)')
    // 单条删除：武装分支仍在（U-145）。
    const body = removeItemBody(PAGE)
    expect(body).toContain('if (confirmDeleteId !== id) {')
    expect(body).toContain('setConfirmDeleteId(id)')
    expect(body).toContain('deleteSearchHistoryItem(identity, id)')
  })
})

/** 截取 handleCleanZeroResults 的 useCallback 体（从声明起到其依赖数组结尾）。 */
function cleanZeroBody(src: string): string {
  const start = src.indexOf('const handleCleanZeroResults = useCallback')
  expect(start, 'handleCleanZeroResults 应存在').toBeGreaterThanOrEqual(0)
  const end = src.indexOf('}, [', start)
  expect(end, 'handleCleanZeroResults 应有依赖数组').toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('U-400：零结果批量清理两步确认 + 全账号范围文案', () => {
  it('断言 1：confirmCleanZero 状态存在（false = 无武装）', () => {
    expect(PAGE).toContain('const [confirmCleanZero, setConfirmCleanZero] = useState(false)')
  })

  it('断言 2：武装分支先于接口调用——第一击只武装、不调 batchCleanZeroResultSearchHistory', () => {
    const body = cleanZeroBody(PAGE)
    assertOrder(
      body,
      ['if (!confirmCleanZero) {', 'setConfirmCleanZero(true)', 'return'],
      'handleCleanZeroResults 武装分支',
    )
    const armReturn = body.indexOf('return', body.indexOf('setConfirmCleanZero(true)'))
    const apiCall = body.indexOf('batchCleanZeroResultSearchHistory')
    expect(apiCall, '接口调用应在武装分支的 return 之后').toBeGreaterThan(armReturn)
    // 武装分支内无删除调用：第一击零网络请求。
    expect(body.slice(0, armReturn)).not.toContain('batchCleanZeroResultSearchHistory')
    // 依赖数组含武装态，否则闭包读到旧值、第二击仍走武装分支。
    const depStart = PAGE.indexOf('}, [', PAGE.indexOf('const handleCleanZeroResults = useCallback'))
    const depEnd = PAGE.indexOf('])', depStart)
    expect(PAGE.slice(depStart, depEnd)).toContain('confirmCleanZero')
  })

  it('断言 3：第二击才调接口，且成功/失败两路都清武装（finally 锁死竞态）', () => {
    const body = cleanZeroBody(PAGE)
    expect(body).toContain('batchCleanZeroResultSearchHistory(identity)')
    const finallyIdx = body.indexOf('finally {')
    expect(finallyIdx, 'handleCleanZeroResults 应有 finally').toBeGreaterThanOrEqual(0)
    const finallyBlock = body.slice(finallyIdx)
    expect(finallyBlock).toContain('setCleaningZero(false)')
    expect(finallyBlock).toContain('setConfirmCleanZero(false)')
    // 删后 toast 报服务端真实数，不报按钮上的已加载页条数。
    expect(body).toContain("title: `已清理 ${removed} 条零结果无效搜索记录`")
  })

  it('断言 4：按钮默认文案只认已加载条数，武装态写明「全部」+ 全账号范围', () => {
    // 默认态：N 的口径写清是「已加载」，不再裸标 (N) 让人误以为是总数。
    expect(PAGE).toContain('`清理零结果记录（已加载 ${zeroResultItems.length} 条）`')
    // 武装态：文案写「全部」，title 写清删除范围是该账号全部零结果记录、
    // 不限于已加载条数，且不可撤销；两态 title 都写范围，悬停即见。
    expect(PAGE).toContain('确认清理全部零结果记录')
    expect(PAGE).toContain('将删除该账号全部零结果记录（不限于已加载的条数），此操作不可撤销')
    expect(PAGE).toContain('将删除该账号全部零结果记录（不限于已加载的条数），需再次点击确认')
    // 武装态 destructive + aria-pressed，与单条删除/清空全部同口径。
    expect(PAGE).toContain("variant={confirmCleanZero ? 'destructive' : 'outline'}")
    expect(PAGE).toContain('aria-pressed={confirmCleanZero}')
    // 执行中仍 disabled + spinner。
    expect(PAGE).toContain('disabled={cleaningZero}')
  })

  it('断言 5：切 tab 时清 confirmCleanZero 武装（与 confirmClear 同款）', () => {
    const handler = tabSwitchHandler(PAGE)
    expect(handler).toContain('setConfirmCleanZero(false)')
    expect(handler).toContain('setConfirmClear(false)')
    expect(handler).toContain('setTab(key)')
  })

  it('断言 6：服务端语义不变——仍走 filter=zero_results 全账号清理，不加 LIMIT', () => {
    // U-400 只修前端确认与文案：服务端全量清理是该功能的既定语义
    // （T4 一次往返），加 LIMIT 会静默留存、让 toast 反向撒谎；只删
    // 零结果、不误删有结果记录由 apps/api/test/me-data-api.test.ts 的
    // batch-delete 用例覆盖（removed 数 + 剩余全 resultCount > 0）。
    expect(NAVHUB_API).toContain("filter: 'zero_results'")
    expect(PAGE).toContain('batchCleanZeroResultSearchHistory(identity)')
  })
})
