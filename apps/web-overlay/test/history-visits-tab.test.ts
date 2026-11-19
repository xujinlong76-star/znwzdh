/**
 * /me/history 遗留簇（W6，12:19 轮）：A4 / A5 / A6 / A7 + U-192。
 *
 * vitest 无 jsdom 写不了渲染断言，沿用 history-delete-confirm.test.ts 的
 * 源码文本断言体例：读 apps/web-overlay/src/app/me/history/page.tsx 源码，
 * 锁死 tab/身份/失败态接线。真点按靠 CI E2E 闭合。
 *
 * 注意：vitest 只从 apps/web/test 运行（见根 vitest.config.ts），本文件
 * 经 `pnpm mirror:web` 同步到 apps/web/test 后才生效；overlaySource 按
 * history-delete-confirm.test.ts 的口径优先读 overlay 源码。
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

/** 截取指定 useCallback 体（从声明起到其依赖数组结尾）。 */
function callbackBody(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = useCallback`)
  expect(start, `${name} 应存在`).toBeGreaterThanOrEqual(0)
  const end = src.indexOf('}, [', start)
  expect(end, `${name} 应有依赖数组`).toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('A4：访问 tab 不被搜索 state 绑架', () => {
  it('断言 1：访问分支只认 tab，不再要求搜索 state === ready', () => {
    expect(PAGE).toContain("{tab === 'visits' && (")
    expect(PAGE).not.toContain("{tab === 'visits' && state === 'ready' && (")
  })

  it('断言 2：搜索 loading 骨架只在搜索 tab 下出现', () => {
    expect(PAGE).toContain("{tab === 'searches' && state === 'loading' && <SectionState")
    expect(PAGE).toContain('loadingLabel="正在加载搜索历史"')
  })

  it('断言 3：搜索 error 分支只在搜索 tab 下出现，重试仍接搜索 load', () => {
    expect(PAGE).toContain("{tab === 'searches' && state === 'error' && (")
    // 访问分支自有 error 态 + loadVisits 重试，不共用搜索的重试入口。
    const visitIdx = PAGE.indexOf("{tab === 'visits' && (")
    const visitBlock = PAGE.slice(visitIdx, visitIdx + 4000)
    expect(visitBlock).toContain("visitState === 'error'")
    expect(visitBlock).toContain('onRetry={() => void loadVisits(0)}')
  })

  it('断言 4：搜索空态与搜索列表仍只在搜索 tab 下（不回归）', () => {
    expect(PAGE).toContain("{tab === 'searches' && state === 'ready' && items.length === 0 && (")
    expect(PAGE).toContain("{tab === 'searches' && state === 'ready' && items.length > 0 && (")
    expect(PAGE).toContain("{tab === 'searches' && state === 'ready' && hasMore && (")
  })
})

describe('A5：身份变化后访问历史不重取、旧身份残留', () => {
  it('断言 1：3c2470e3 未覆盖——本轮补身份变化 effect，清列表并回 idle', () => {
    const start = PAGE.indexOf('// A5：身份变化后访问历史必须失效')
    expect(start, 'A5 身份变化 effect 应存在').toBeGreaterThanOrEqual(0)
    const body = PAGE.slice(start, PAGE.indexOf('// 切到访问 tab 时首次加载', start))
    // 未变直接 return；变了才更新 ref + 清空。
    assertOrder(
      body,
      ['if (identityRef.current === identity) return', 'identityRef.current = identity'],
      'A5 身份变化守卫',
    )
    expect(body).toContain('setVisits([])')
    expect(body).toContain('setVisitTotal(0)')
    expect(body).toContain('setVisitHasMore(false)')
    expect(body).toContain('setVisitNextOffset(0)')
    expect(body).toContain("setVisitState('idle')")
    // effect 只认 identity：切 tab 不触发清空，已加载列表不被误删。
    const depStart = body.indexOf('}, [', body.indexOf('useEffect'))
    expect(body.slice(depStart, depStart + 20)).toContain('[identity]')
  })

  it('断言 2：旧身份在途响应到达时丢弃，不写回列表', () => {
    const body = callbackBody(PAGE, 'loadVisits')
    assertOrder(
      body,
      ['const requestIdentity = identity', 'fetchVisitsPage(identity,', 'setVisitBusy(false)', 'if (identityRef.current !== requestIdentity) return', 'setVisits('],
      'loadVisits 归属比对顺序',
    )
  })

  it('断言 3：回 idle 后下次切入按新身份重取（切 tab effect 不变）', () => {
    const start = PAGE.indexOf('// 切到访问 tab 时首次加载')
    expect(start, '切 tab effect 应存在').toBeGreaterThanOrEqual(0)
    const body = PAGE.slice(start, PAGE.indexOf('const clearVisits', start))
    expect(body).toContain("if (tab !== 'visits') return")
    expect(body).toContain("if (visitState === 'idle') void Promise.resolve().then(() => loadVisits(0))")
  })
})

describe('A6：搜索加载更多失败静默消失', () => {
  it('断言 1：loadMore 传降级回调——失败事实不再被 degrade 吞掉', () => {
    const body = callbackBody(PAGE, 'loadMore')
    expect(body).toContain('fetchSearchHistoryPage(identity, { limit: PAGE_SIZE, offset: nextOffset }, () => {')
    expect(body).toContain('let degraded = false')
    expect(body).toContain('degraded = true')
  })

  it('断言 2：降级分支先 toast、再 return——setHasMore/setItems 到不了', () => {
    const body = callbackBody(PAGE, 'loadMore')
    const degIdx = body.indexOf('if (degraded) {')
    expect(degIdx, 'loadMore 应有降级分支').toBeGreaterThanOrEqual(0)
    const degBlock = body.slice(degIdx, body.indexOf('}', body.indexOf('return', degIdx)) + 1)
    expect(degBlock).toContain("title: '加载失败'")
    expect(degBlock).toContain('return')
    expect(degBlock).not.toContain('setHasMore')
    expect(degBlock).not.toContain('setItems')
    expect(degBlock).not.toContain('setNextOffset')
    // 成功路径仍追加 + 更新分页：失败保留与成功推进是两条互斥分支。
    const okIdx = body.indexOf('setItems((prev) => [...prev, ...page.items])')
    expect(okIdx, '成功路径仍追加').toBeGreaterThan(degIdx)
    expect(body.slice(okIdx)).toContain('setHasMore(page.hasMore)')
    expect(body.slice(okIdx)).toContain('setNextOffset(page.nextOffset)')
  })

  it('断言 3：降级分支在 finally 之前——失败后 loadingMore 仍复位，按钮可再点', () => {
    const body = callbackBody(PAGE, 'loadMore')
    expect(body).toContain('} finally {')
    expect(body).toContain('setLoadingMore(false)')
    expect(body.indexOf('if (degraded) {')).toBeLessThan(body.indexOf('} finally {'))
  })
})

describe('U-192：历史「再次搜索」只带 q——根因在数据模型，web 侧修不好', () => {
  it('断言 1：两处「再次搜索」都只拼 q（现状如实保留，不硬凑 scope）', () => {
    expect(PAGE).toContain("href={`/search?q=${encodeURIComponent(item.query)}`}")
    // 标题链接与图标按钮各一处，共两处；没有第三处拼 category/tag 的链接。
    expect(PAGE.split("href={`/search?q=${encodeURIComponent(item.query)}`}").length - 1).toBe(2)
    expect(PAGE).not.toContain('category=${')
    expect(PAGE).not.toContain('tag=${')
  })

  it('断言 2：旧条目如实标「仅关键词」降级展示，不伪装完整', () => {
    expect(PAGE).toContain('再次搜索仅按关键词重搜，不保留当时的分类/标签筛选')
  })

  it('断言 3：GET 契约 items 无 scope 具名字段——没值可拼，不是链接写漏了', () => {
    const contracts = overlaySource('src/lib/rest-contracts.generated.ts')
    const start = contracts.indexOf('export interface SearchHistoryPageResponse {')
    expect(start, 'SearchHistoryPageResponse 应存在').toBeGreaterThanOrEqual(0)
    const block = contracts.slice(start, contracts.indexOf('\n}\n', start))
    expect(block).toContain('id: number')
    expect(block).toContain('query: string')
    expect(block).toContain('resultCount: number')
    expect(block).toContain('createdAt: number')
    expect(block).not.toContain('category')
    expect(block).not.toContain('tag')
    expect(block).not.toContain('facet')
  })

  it('断言 4：写入侧 POST 体无 scope——recordLocalSearchHistory 只发 q/结果数/开关', () => {
    const writer = overlaySource('src/lib/search-history-record.ts')
    const start = writer.indexOf("'/api/search-history',")
    expect(start, 'POST /api/search-history 调用应存在').toBeGreaterThanOrEqual(0)
    const call = writer.slice(start, start + 600)
    expect(call).toContain('q,')
    expect(call).toContain('resultCount:')
    expect(call).toContain('searchHistoryEnabled:')
    expect(call).not.toContain('category')
    expect(call).not.toContain('facets')
  })
})

describe('A7：访问 tab 无检索', () => {
  it('断言 1：filteredVisits 只筛已加载页（站名/链接），空关键词返回全部', () => {
    const start = PAGE.indexOf('const filteredVisits = useMemo')
    expect(start, 'filteredVisits 应存在').toBeGreaterThanOrEqual(0)
    const body = PAGE.slice(start, PAGE.indexOf('const isVisitFiltering', start))
    expect(body).toContain("if (!q) return visits")
    expect(body).toContain("(v.site?.title ?? '').toLowerCase().includes(q)")
    expect(body).toContain("(v.site?.url ?? '').toLowerCase().includes(q)")
    expect(PAGE).toContain("const [visitKeyword, setVisitKeyword] = useState('')")
    expect(PAGE).toContain("const isVisitFiltering = visitKeyword.trim() !== ''")
  })

  it('断言 2：检索框 + 范围说明——与 U-193 方案①同口径', () => {
    expect(PAGE).toContain('aria-label="筛选访问历史"')
    expect(PAGE).toContain('placeholder="输入站名或链接筛选访问记录…"')
    expect(PAGE).toContain('仅检索已加载的 {visits.length} 条，加载更多可扩大检索范围')
  })

  it('断言 3：列表渲染 filteredVisits；筛空与无记录是两个互斥空态', () => {
    const visitIdx = PAGE.indexOf("{tab === 'visits' && (")
    const visitBlock = PAGE.slice(visitIdx)
    expect(visitBlock).toContain('{filteredVisits.map((v) => (')
    expect(visitBlock).toContain('当前筛选条件下没有匹配的访问记录。')
    expect(visitBlock).toContain('还没有站点访问记录')
    // 筛空分支在无记录分支之后、列表之前：顺序即语义。
    assertOrder(
      visitBlock,
      ['visits.length === 0 ?', '还没有站点访问记录', 'filteredVisits.length === 0 ?', '当前筛选条件下没有匹配的访问记录。', '{filteredVisits.map((v) => ('],
      '访问 tab 空态顺序',
    )
  })

  it('断言 4：筛选态不藏「加载更多」——仍接 loadVisits，可扩大检索范围', () => {
    const visitIdx = PAGE.indexOf("{tab === 'visits' && (")
    const visitBlock = PAGE.slice(visitIdx)
    expect(visitBlock).toContain('onClick={() => void loadVisits(visitNextOffset)}')
    expect(visitBlock).toContain('{visitHasMore && (')
  })
})
