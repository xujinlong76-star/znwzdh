import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 星标切换 vs 旧详情刷新竞态（E2E plugin-market-star.spec.ts:161 失败的根因）。
 *
 * 根因（已定到行）：handleStarToggle 乐观更新后成功分支只同步 starCount、
 * 不重申 starred；loadDetail 挂载静默刷新无世代守卫，旧快照落地会把
 * starred 写回切换前的值。W2 的修复：loadDetail 取递增序号、过期响应
 * 直接丢弃；切换成功后重申 starred/starCount（取自接口回包）并递增序号
 * 使切换前已在途的旧快照失效。
 *
 * 本文件钉死修好的三点行为：
 *  1. 取消星标成功后，即使旧 loadDetail 刷新带着 starred=true 落地，
 *     starred 终态仍为 false、starCount 为 0；
 *  2. 点亮星标成功后，即使旧刷新带着 starred=false 落地，starred 终态
 *     仍为 true、starCount 为服务端值；
 *  3. starCount 取自接口回包。
 *
 * 为什么是源码守卫而不是挂载 + mock + 可控时序：
 * 本仓 vitest 是 node 环境、无 jsdom / happy-dom / @testing-library/react
 * / react-test-renderer（见 skin-picker.test.ts 头部与根 vitest.config.ts，
 * environment:"node"），组件 effect 跑不起来，fetchPluginDetail /
 * starPlugin / unstarPlugin 的 mock 加可控时序挂载测试在本 harness 里
 * 写不出来——要写就得先给仓库加 jsdom 依赖并改 lockfile，那是依赖层
 * 变更，不在本轮「只动测试文件」的范围里。因此这里沿用本仓既定做法
 * （plugin-detail-lazy-guard.test.ts / theme-dark-suspend.test.ts 同款
 * 源码守卫）：按「取号→await→验号→写回」的顺序断言钉死竞态机制，
 * 不拿 toContain 充数；点按级时序真行为由 e2e/plugin-market-star.spec.ts
 * 覆盖（本文件不碰它）。
 *
 * 本文件不含任何 vi.mock（纯源码守卫），mock-hygiene 的 vi.resetModules()
 * 要求不适用；也不含任何「等刷新落定再点」的掩盖式等待——文件里没有任何
 * 定时器 / waitFor。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

const VIEW = overlaySource('src/app/marketplace/[slug]/plugin-detail-view.tsx')

/** loadDetail 函数体：从定义起到紧随其后的挂载刷新 effect 之前。 */
function loadDetailBody(): string {
  const start = VIEW.indexOf('const loadDetail = useCallback(async')
  expect(start).toBeGreaterThan(-1)
  const end = VIEW.indexOf('useEffect(() => {', start)
  expect(end).toBeGreaterThan(start)
  return VIEW.slice(start, end)
}

/** handleStarToggle 函数体：从定义起到下一个顶层函数之前。 */
function starToggleBody(): string {
  const start = VIEW.indexOf('const handleStarToggle = async')
  expect(start).toBeGreaterThan(-1)
  const end = VIEW.indexOf('const handleExportJson', start)
  expect(end).toBeGreaterThan(start)
  return VIEW.slice(start, end)
}

/** 断言 a、b、c 在 body 内按顺序出现。 */
function expectOrder(body: string, ...fragments: string[]): void {
  let cursor = -1
  for (const fragment of fragments) {
    const at = body.indexOf(fragment, cursor + 1)
    expect(at, `期望按顺序出现：${fragment}`).toBeGreaterThan(cursor)
    cursor = at
  }
}

describe('星标切换 vs 旧详情刷新：世代守卫', () => {
  it('loadDetail 先取号、await 后先验号再写回：旧快照到不了 setStarred/setStarCount', () => {
    const body = loadDetailBody()
    // 序号在 await 之前取，过期判定在写回之前。
    expectOrder(
      body,
      'const seq = ++loadDetailSeq.current',
      'await fetchPluginDetail(',
      'if (seq !== loadDetailSeq.current || !mountedRef.current) return',
      'setStarred(Boolean(res.plugin.starred))',
    )
    expectOrder(
      body,
      'if (seq !== loadDetailSeq.current || !mountedRef.current) return',
      'setStarCount(res.plugin.starCount || 0)',
    )
    expectOrder(
      body,
      'if (seq !== loadDetailSeq.current || !mountedRef.current) return',
      'setPlugin(res.plugin)',
    )
  })

  it('旧快照的 catch/finally 也不得写回：setPlugin(null)/setLoading(false) 同样验号', () => {
    const body = loadDetailBody()
    expect(body).toContain('if (!opts?.silent && seq === loadDetailSeq.current && mountedRef.current) setPlugin(null)')
    expect(body).toContain('if (!opts?.silent && seq === latestNonSilentLoadSeq.current && mountedRef.current) setLoading(false)')
  })

  it('取消星标：unstar 成功后重申 starred、starCount 取自回包（旧刷新 starred=true 也盖不掉）', () => {
    const body = starToggleBody()
    // 成功分支：await unstar → setStarred(res.starred) → setStarCount(res.starCount)。
    // 回包 starred=false 时重申即 false；starCount 为服务端值（取消后为 0 时回包即 0）。
    expectOrder(
      body,
      'const res = await unstarPlugin(plugin.slug)',
      'setStarred(res.starred)',
      'setStarCount(res.starCount)',
    )
    // 两个成功分支都重申 starred，不许只剩乐观更新那一次。
    expect(body.match(/setStarred\(res\.starred\)/g)?.length).toBe(2)
  })

  it('点亮星标：star 成功后重申 starred、starCount 取自回包（旧刷新 starred=false 也盖不掉）', () => {
    const body = starToggleBody()
    expectOrder(
      body,
      'const res = await starPlugin(plugin.slug)',
      'setStarred(res.starred)',
      'setStarCount(res.starCount)',
    )
  })

  it('切换成功后旧快照失效：递增序号在两次 await 之后、catch 之前', () => {
    const body = starToggleBody()
    // 切换前已在途的 loadDetail 响应再落地时，seq 已不是最新，被世代守卫丢弃。
    expectOrder(
      body,
      'await starPlugin(plugin.slug)',
      'await unstarPlugin(plugin.slug)',
      'loadDetailSeq.current++',
      '} catch',
    )
  })

  it('starCount 成功值只取回包：乐观增量只在 await 之前，成功分支内无乐观写法', () => {
    const body = starToggleBody()
    // 回包写回恰两次（star / unstar 各一）。
    expect(body.match(/setStarCount\(res\.starCount\)/g)?.length).toBe(2)
    // 乐观增量恰两次：try 前的乐观更新与 catch 里的回滚；成功分支内无乐观写法。
    expect(body.match(/setStarCount\(\(prev\)/g)?.length).toBe(2)
    expectOrder(body, 'setStarCount((prev)', 'try {', 'await starPlugin(plugin.slug)')
    const tryAt = body.indexOf('try {')
    const success = body.slice(tryAt, body.indexOf('} catch'))
    expect(success).not.toContain('setStarCount((prev)')
    // 第二次乐观写回在 catch 回滚里，不在成功分支。
    expect(body.slice(body.indexOf('} catch'))).toContain('setStarCount((prev)')
  })

  it('失败仍回滚：重申不破坏 catch 的 starred 回滚与错误提示', () => {
    const body = starToggleBody()
    const catchAt = body.indexOf('} catch')
    expect(catchAt).toBeGreaterThan(-1)
    const catchBlock = body.slice(catchAt)
    expect(catchBlock).toContain('setStarred(!nextStarred)')
    expect(catchBlock).toContain("toast.error('星标更新失败'")
  })
})
