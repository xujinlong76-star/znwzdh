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

/** mountedRef 守卫区：从声明起到 loadDetail 定义之前。 */
function mountedGuardRegion(): string {
  const start = VIEW.indexOf('const loadDetailSeq = useRef(0), mountedRef = useRef(true)')
  expect(start).toBeGreaterThan(-1)
  const end = VIEW.indexOf('const loadDetail = useCallback(async', start)
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
    // 序号在 await 之前取；提交版无提前 return，过期判定是写回分支的行内守卫
    // `if (res?.plugin && seq === loadDetailSeq.current && mountedRef.current)`。
    const GUARD = 'if (res?.plugin && seq === loadDetailSeq.current && mountedRef.current) {'
    expectOrder(
      body,
      'const seq = ++loadDetailSeq.current',
      'await fetchPluginDetail(',
      GUARD,
      'setStarred(Boolean(res.plugin.starred))',
    )
    expectOrder(body, GUARD, 'setStarCount(res.plugin.starCount || 0)')
    expectOrder(body, GUARD, 'setPlugin(res.plugin)')
  })

  it('旧快照的 catch 也不得写回：setPlugin(null) 同样验号；finally 只关 loading、不写回任何状态', () => {
    const body = loadDetailBody()
    // catch 分支：行内守卫 + 同行 setPlugin(null)。
    expect(body).toContain('if (!opts?.silent && seq === loadDetailSeq.current && mountedRef.current) setPlugin(null)')
    // else-if 分支：同样行内守卫，setPlugin(null) 在其后的块内。
    expectOrder(
      body,
      '} else if (!opts?.silent && seq === loadDetailSeq.current && mountedRef.current) {',
      'setPlugin(null)',
    )
    // finally：提交版只有 `if (!opts?.silent) setLoading(false)`，不写回
    // plugin/starred/starCount；草稿里的 latestNonSilentLoadSeq 守卫不存在。
    expect(body).not.toContain('latestNonSilentLoadSeq')
    const finallyBlock = body.slice(body.indexOf('} finally'))
    expect(finallyBlock).toContain('setLoading(false)')
    expect(finallyBlock).not.toContain('setPlugin')
    expect(finallyBlock).not.toContain('setStarred')
    expect(finallyBlock).not.toContain('setStarCount')
  })

  it('取消星标：unstar 成功后重申 starred、starCount 取自回包（旧刷新 starred=true 也盖不掉）', () => {
    const body = starToggleBody()
    // 成功分支：提交版是 star/unstar 共用的三元式，
    // `const res = nextStarred ? await starPlugin(...) : await unstarPlugin(...)`，
    // 其后单次 setStarred(res.starred) / setStarCount(res.starCount)。
    // 回包 starred=false 时重申即 false；starCount 为服务端值（取消后为 0 时回包即 0）。
    expectOrder(
      body,
      'const res = nextStarred ? await starPlugin(plugin.slug) : await unstarPlugin(plugin.slug)',
      'setStarred(res.starred)',
      'setStarCount(res.starCount)',
    )
    // 共用成功分支：重申恰一次，两个方向都走它，不许只剩乐观更新那一次。
    expect(body.match(/setStarred\(res\.starred\)/g)?.length).toBe(1)
  })

  it('点亮星标：star 成功后重申 starred、starCount 取自回包（旧刷新 starred=false 也盖不掉）', () => {
    const body = starToggleBody()
    expectOrder(
      body,
      'const res = nextStarred ? await starPlugin(plugin.slug) : await unstarPlugin(plugin.slug)',
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
      'setStarCount(res.starCount)',
      'loadDetailSeq.current++',
      '} catch',
    )
  })

  it('starCount 成功值只取回包：乐观增量只在 await 之前，成功分支内无乐观写法', () => {
    const body = starToggleBody()
    // 回包写回恰一次：star / unstar 共用三元成功分支。
    expect(body.match(/setStarCount\(res\.starCount\)/g)?.length).toBe(1)
    // 乐观增量恰两次：try 前的乐观更新与 catch 里的回滚；成功分支内无乐观写法。
    expect(body.match(/setStarCount\(\(prev\)/g)?.length).toBe(2)
    expectOrder(body, 'setStarCount((prev)', 'try {', 'await starPlugin(plugin.slug)')
    const tryAt = body.indexOf('try {')
    const success = body.slice(tryAt, body.indexOf('} catch'))
    expect(success).not.toContain('setStarCount((prev)')
    // 第二次乐观写回在 catch 回滚里，不在成功分支。
    expect(body.slice(body.indexOf('} catch'))).toContain('setStarCount((prev)')
  })

  it('挂载守卫重 arm：effect setup 置 true，StrictMode 双挂载的 cleanup 不会永久毒化 mountedRef', () => {
    // U-103 主根因：旧形态 `useEffect(() => () => { mountedRef.current = false }, [])`
    // 只有 cleanup 置 false、没有任何地方置回 true；CI 跑 next dev + StrictMode
    // 双挂载，cleanup 在挂载瞬间把 mountedRef 永久毒化，之后一切 loadDetail
    // 响应都被 `:277` 的守卫丢弃，plugin 永远停在 SSR 初值（installed/starred/
    // isOwner 全 false）。修复形态必须在 setup 里重 arm，改回旧形态本用例必红。
    const region = mountedGuardRegion()
    // 死钉形态：setup 置 true、cleanup 置 false，同一 effect 内、setup 在前。
    expect(region).toContain(
      'useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])',
    )
    expectOrder(region, 'mountedRef.current = true', 'mountedRef.current = false')
    // 初始化仍为 true：首个 loadDetail 响应在 effect 跑起来之前也不被丢弃。
    expect(region).toContain('mountedRef = useRef(true)')
    // C2-3：全仓计数——setup 置 true 与 cleanup 置 false 各恰一次，杜绝
    // 别处再 arm/disarm（例如 loadDetail / starToggle 里误写重 arm）。
    expect(VIEW.match(/mountedRef\.current = true/g)?.length).toBe(1)
    expect(VIEW.match(/mountedRef\.current = false/g)?.length).toBe(1)
    // C2-4：重 arm 只属于挂载 effect——loadDetail 与 starToggle 各自切片内
    // 不得出现 setup 式 `mountedRef.current = true`，出现即为误写。
    expect(loadDetailBody()).not.toContain('mountedRef.current = true')
    expect(starToggleBody()).not.toContain('mountedRef.current = true')
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
