/**
 * 首屏数字直达：纯函数与按键判定。
 *
 * 锁住的契约（见 lib/number-dial.ts）：
 *   1. 解析只看 e.code：Shift+1 的 e.key 是 '!'、Alt+1 在 macOS 上是 '¡'，
 *      仍解析为 1；字母键 / F 键返回 null；Numpad 同样命中。
 *   2. 映射取坞前 9：钉选顺序优先、超过 9 的截断、digitById 反查。
 *   3. 自定义位三态：命中 / 空位 / 失效 id（保留原值、解析时按空位处理）。
 *   4. 守卫按序短路：总开关、组字中、输入态、弹窗打开、拖拽手柄聚焦、
 *      多选态、编辑态——任一命中都不打开。
 *   5. 修饰键分流：裸数字 → 坞映射位（按偏好打开）；Shift+数字 → 强制新标签；
 *      Ctrl+Shift+数字 → 自定义位；Alt/Ctrl/Meta+数字一律放行；
 *      数字 0 没有坞映射位。
 *   6. 打开：安全闸先行——javascript: 被拦住且不调 reportClick；
 *      成功打开时 reportClick 与 recordOfflineVisit 各调一次。
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('@/lib/navhub-api', () => ({ reportClick: vi.fn() }))
vi.mock('@/lib/offline-recent', () => ({ recordOfflineVisit: vi.fn() }))
vi.mock('@/lib/identity', () => ({ getIdentity: () => 'test-identity' }))

import { reportClick } from '@/lib/navhub-api'
import { recordOfflineVisit } from '@/lib/offline-recent'
import {
  buildDialMap,
  isQuickDialDigit,
  openDialTarget,
  parseDigitCode,
  QUICK_DIAL_DIGITS,
  resolveNumberDialAction,
  resolveQuickDialSlot,
  type DialSite,
  type NumberDialGuardState,
} from '@/lib/number-dial'

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

afterAll(() => {
  vi.resetModules()
})

const reportClickMock = reportClick as unknown as ReturnType<typeof vi.fn>
const recordOfflineVisitMock = recordOfflineVisit as unknown as ReturnType<typeof vi.fn>

function site(id: string, title = `站点 ${id}`): DialSite {
  return { id, title, href: `https://example.com/${id}` }
}

function guards(overrides: Partial<NumberDialGuardState> = {}): NumberDialGuardState {
  return {
    enabled: true,
    composing: false,
    typing: false,
    dialogOpen: false,
    dragHandleFocused: false,
    selectionMode: false,
    editingLayout: false,
    ...overrides,
  }
}

function dockInput(dialSites: DialSite[], guardOverrides: Partial<NumberDialGuardState> = {}) {
  return {
    guards: guards(guardOverrides),
    dialMap: buildDialMap(dialSites),
    quickDialSlots: {},
    siteIndex: new Map(dialSites.map((s) => [s.id, s] as const)),
  }
}

describe('parseDigitCode（只看 e.code）', () => {
  it('Digit1~Digit0 命中 1~0', () => {
    expect(parseDigitCode({ code: 'Digit1' })).toBe('1')
    expect(parseDigitCode({ code: 'Digit9' })).toBe('9')
    expect(parseDigitCode({ code: 'Digit0' })).toBe('0')
  })

  it('Numpad1~Numpad0 同样命中', () => {
    expect(parseDigitCode({ code: 'Numpad1' })).toBe('1')
    expect(parseDigitCode({ code: 'Numpad0' })).toBe('0')
  })

  it("Shift+Digit1 的 e.key 是 '!'，仍解析为 1", () => {
    expect(parseDigitCode({ code: 'Digit1' })).toBe('1')
  })

  it("Alt+Digit1 在 macOS 上的 e.key 是 '¡'，仍解析为 1", () => {
    expect(parseDigitCode({ code: 'Digit1' })).toBe('1')
  })

  it('字母键 / F 键 / 空 code 返回 null', () => {
    expect(parseDigitCode({ code: 'KeyA' })).toBeNull()
    expect(parseDigitCode({ code: 'F5' })).toBeNull()
    expect(parseDigitCode({ code: 'Space' })).toBeNull()
    expect(parseDigitCode({})).toBeNull()
  })

  it('十个快拨位键齐全，顺序 1~9、0 在最后', () => {
    expect([...QUICK_DIAL_DIGITS]).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
    for (const d of QUICK_DIAL_DIGITS) expect(isQuickDialDigit(d)).toBe(true)
    expect(isQuickDialDigit('a')).toBe(false)
    expect(isQuickDialDigit('10')).toBe(false)
  })
})

describe('buildDialMap（坞前 9 映射）', () => {
  it('取前 9 个，钉选顺序优先', () => {
    const sites = [site('a'), site('b'), site('c')]
    const { byDigit, digitById } = buildDialMap(sites)
    expect(byDigit[0]).toBe(sites[0])
    expect(byDigit[1]).toBe(sites[1])
    expect(byDigit[2]).toBe(sites[2])
    expect(digitById.get('a')).toBe(1)
    expect(digitById.get('c')).toBe(3)
  })

  it('超过 9 的截断，第 10 个没有数字', () => {
    const sites = Array.from({ length: 12 }, (_, i) => site(`s${i + 1}`))
    const { byDigit, digitById } = buildDialMap(sites)
    expect(byDigit).toHaveLength(9)
    expect(byDigit[8]?.id).toBe('s9')
    expect(digitById.has('s10')).toBe(false)
  })

  it('不足 9 位补 null', () => {
    const { byDigit } = buildDialMap([site('only')])
    expect(byDigit[0]?.id).toBe('only')
    expect(byDigit.slice(1).every((s) => s === null)).toBe(true)
  })
})

describe('resolveQuickDialSlot（自定义位三态）', () => {
  const index = new Map([['a', site('a')], ['b', site('b')]])

  it('命中返回站点', () => {
    expect(resolveQuickDialSlot({ '3': 'a' }, '3', index)?.id).toBe('a')
    expect(resolveQuickDialSlot({ '0': 'b' }, '0', index)?.id).toBe('b')
  })

  it('空位返回 null', () => {
    expect(resolveQuickDialSlot({}, '1', index)).toBeNull()
    expect(resolveQuickDialSlot({ '2': 'a' }, '1', index)).toBeNull()
  })

  it('失效 id（站点已删）按空位处理，不抛错', () => {
    expect(resolveQuickDialSlot({ '5': 'gone' }, '5', index)).toBeNull()
  })
})

describe('resolveNumberDialAction（守卫与修饰键分流）', () => {
  const sites = [site('a'), site('b'), site('c')]

  it('裸数字 1~9 打开坞映射位，按偏好打开（不强制新标签）', () => {
    const action = resolveNumberDialAction({ code: 'Digit2' }, dockInput(sites))
    expect(action).toEqual({ kind: 'dock', digit: 2, site: sites[1], forceNewTab: false })
  })

  it('Shift+数字强制新标签', () => {
    const action = resolveNumberDialAction({ code: 'Digit1', shiftKey: true }, dockInput(sites))
    expect(action).toEqual({ kind: 'dock', digit: 1, site: sites[0], forceNewTab: true })
  })

  it('Ctrl+Shift+数字走自定义位', () => {
    const input = dockInput(sites)
    input.quickDialSlots = { '3': 'c' }
    const action = resolveNumberDialAction(
      { code: 'Digit3', ctrlKey: true, shiftKey: true },
      input,
    )
    expect(action).toEqual({ kind: 'quick', digit: '3', site: sites[2], forceNewTab: false })
  })

  it('Ctrl+Shift+数字空位 / 失效 id 静默无操作', () => {
    expect(
      resolveNumberDialAction({ code: 'Digit4', ctrlKey: true, shiftKey: true }, dockInput(sites)),
    ).toBeNull()
    const input = dockInput(sites)
    input.quickDialSlots = { '4': 'gone' }
    expect(
      resolveNumberDialAction({ code: 'Digit4', ctrlKey: true, shiftKey: true }, input),
    ).toBeNull()
  })

  it('裸数字 0 没有坞映射位；空位按键静默无操作', () => {
    expect(resolveNumberDialAction({ code: 'Digit0' }, dockInput(sites))).toBeNull()
    expect(resolveNumberDialAction({ code: 'Digit9' }, dockInput(sites))).toBeNull()
  })

  it('Alt+数字放行（Alt+1~3 是视图切换）；Ctrl/Meta+数字放行（浏览器保留）', () => {
    expect(resolveNumberDialAction({ code: 'Digit1', altKey: true }, dockInput(sites))).toBeNull()
    expect(resolveNumberDialAction({ code: 'Digit2', ctrlKey: true }, dockInput(sites))).toBeNull()
    expect(resolveNumberDialAction({ code: 'Digit2', metaKey: true }, dockInput(sites))).toBeNull()
    expect(
      resolveNumberDialAction({ code: 'Digit1', ctrlKey: true, shiftKey: true, altKey: true }, dockInput(sites)),
    ).toBeNull()
  })

  it('守卫：总开关关 / 组字中 / 输入态 / 弹窗打开 / 拖拽手柄聚焦 / 多选态 / 编辑态一律不打开', () => {
    const event = { code: 'Digit1' }
    const cases: Array<Partial<NumberDialGuardState>> = [
      { enabled: false },
      { composing: true },
      { typing: true },
      { dialogOpen: true },
      { dragHandleFocused: true },
      { selectionMode: true },
      { editingLayout: true },
    ]
    for (const c of cases) {
      expect(resolveNumberDialAction(event, dockInput(sites, c))).toBeNull()
    }
  })

  it('非数字键不打开', () => {
    expect(resolveNumberDialAction({ code: 'KeyD' }, dockInput(sites))).toBeNull()
    expect(resolveNumberDialAction({ code: 'Enter' }, dockInput(sites))).toBeNull()
  })
})

describe('openDialTarget（安全闸 + 副作用）', () => {
  function stubWindow(openImpl: () => Window | null = () => ({}) as unknown as Window) {
    const open = vi.fn(openImpl)
    const location = { href: '' }
    vi.stubGlobal('window', { open, location })
    return { open, location }
  }

  it('javascript: href 被安全闸拦住，且不调 reportClick / recordOfflineVisit', () => {
    const { open, location } = stubWindow()
    const ok = openDialTarget(
      { id: 'x', title: '脏站', href: 'javascript:alert(1)' },
      { forceNewTab: false, linkTarget: '_blank' },
    )
    expect(ok).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(location.href).toBe('')
    expect(reportClickMock).not.toHaveBeenCalled()
    expect(recordOfflineVisitMock).not.toHaveBeenCalled()
  })

  it('裸键按 linkTarget：_self 走 location.href，成功时 reportClick 与 recordOfflineVisit 各调一次', () => {
    const { open, location } = stubWindow()
    const ok = openDialTarget(site('a'), { forceNewTab: false, linkTarget: '_self' })
    expect(ok).toBe(true)
    expect(open).not.toHaveBeenCalled()
    expect(location.href).toBe('https://example.com/a')
    expect(reportClickMock).toHaveBeenCalledTimes(1)
    expect(reportClickMock).toHaveBeenCalledWith('a', 'test-identity')
    expect(recordOfflineVisitMock).toHaveBeenCalledTimes(1)
    expect(recordOfflineVisitMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', href: 'https://example.com/a' }),
    )
  })

  it('Shift 强制新标签：window.open(url, _blank, noopener,noreferrer)', () => {
    const { open } = stubWindow()
    const ok = openDialTarget(site('b'), { forceNewTab: true, linkTarget: '_self' })
    expect(ok).toBe(true)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://example.com/b', '_blank', 'noopener,noreferrer')
    expect(reportClickMock).toHaveBeenCalledTimes(1)
    expect(recordOfflineVisitMock).toHaveBeenCalledTimes(1)
  })

  it('偏好 _blank 时裸键也走 window.open', () => {
    const { open } = stubWindow()
    expect(openDialTarget(site('c'), { forceNewTab: false, linkTarget: '_blank' })).toBe(true)
    expect(open).toHaveBeenCalledWith('https://example.com/c', '_blank', 'noopener,noreferrer')
  })
})

describe('接线守卫（源码级：hook 与共享守卫）', () => {
  // 与 search-keyboard.test.ts 同款定位：测试在 apps/web/test 里跑（镜像），
  // overlay 里直接跑时也找得到源文件。
  function overlaySource(rel: string): string {
    const here = dirname(fileURLToPath(import.meta.url))
    const candidates = [resolve(here, '..', rel), resolve(here, '..', '..', 'web-overlay', rel)]
    const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
    if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
    return readFileSync(hit, 'utf8')
  }

  it('useNumberDial 用捕获阶段监听，命中后截停并同步打开', () => {
    const src = overlaySource('src/hooks/use-number-dial.ts')
    expect(src).toContain("window.addEventListener('keydown', handler, { capture: true })")
    expect(src).toContain('e.stopImmediatePropagation()')
    expect(src).toContain('e.preventDefault()')
    expect(src).toContain('openDialTarget(action.site')
    expect(src).toContain('resolveNumberDialAction')
  })

  it('键盘守卫是共享的强判定（输入态双查 + 弹窗判定），dialog 与 hook 共用同一份', () => {
    const guards = overlaySource('src/lib/keyboard-guards.ts')
    expect(guards).toContain("=== 'textbox'")
    expect(guards).toContain("=== 'combobox'")
    expect(guards).toContain("=== 'searchbox'")
    // SELECT 视为输入态的覆盖：下拉框里的 type-ahead 选词也不能劫持数字键
    expect(guards).toContain("tag === 'SELECT'")
    expect(guards).toContain('[role="dialog"]:not([aria-hidden="true"])')
    const dialog = overlaySource('src/components/keyboard-shortcuts-dialog.tsx')
    expect(dialog).toContain("from '@/lib/keyboard-guards'")
    expect(dialog).toContain('isEventTargetTyping(e)')
    expect(dialog).toContain('isAnyDialogOpen()')
    const hook = overlaySource('src/hooks/use-number-dial.ts')
    expect(hook).toContain("from '@/lib/keyboard-guards'")
  })
})
