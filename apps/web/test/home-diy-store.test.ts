/**
 * 首页 DIY：整页只有一份配置，而且「读不出来」不等于「没有配置」。
 *
 * 真实缺陷（`lib/modular/use-home-diy.ts` 原实现）：这个 hook 用 useState 存
 * config / history / isEditingLayout，而首页有 6 个组件各自调用它
 * （navigation-content / home-diy-toolbar / home-hero-deck / view-mode-toggle /
 * category-in-situ-controls / keyboard-shortcuts-dialog）—— useState 是
 * **每个组件各存一份**，于是：
 *
 *   - view-mode-toggle 里 setViewMode('classic') 只改它自己那份，
 *     navigation-content 渲染用的 viewMode 不变 → 点「经典全景流」页面没反应；
 *   - 工具栏点「DIY 排版工坊」只改工具栏那份 isEditingLayout，
 *     navigation-content 里 `{isEditingLayout && ...}` 的拖拽手柄永远不出现；
 *   - 撤销栈各存一份 → 在 A 处按 Ctrl+Z 撤的不是用户刚做的那次改动。
 *
 * 同一文件里还有第二个坑：`const parsed = JSON.parse(raw)` 一抛错就整段跳过、
 * 配置回落默认值，紧接着第一次编辑就把原布局覆盖掉（与收藏夹 #68/#69 同源）。
 *
 * 这个文件把修复后的契约钉住：
 *   1. 共享单例：任何一处提交，所有订阅者（即所有组件）都看到同一份新状态；
 *   2. 撤销/重做走同一条历史；
 *   3. 落盘失败：内存照常生效 + storageWarning 说清楚，成功后再清掉；
 *   4. 读不出来：先备份原始字节再以默认值启动，并如实提示；
 *   5. 接线守则：hook 不许再用 useState 存 config/isEditingLayout，
 *      不许别的文件自己写这个存储键，提示必须在界面上渲染出来。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  STORAGE_KEY,
  applyRemoteHomeDiyConfig,
  classifyHomeDiyStorageFailure,
  commitHomeDiyConfig,
  describeHomeDiyStorageFailure,
  dismissHomeDiyStorageWarning,
  getHomeDiySnapshot,
  hydrateHomeDiy,
  redoHomeDiy,
  resetHomeDiySharedState,
  setHomeDiyEditingLayout,
  subscribeHomeDiy,
  undoHomeDiy,
} from '@/lib/modular/use-home-diy'

/* ------------------------------------------------------------------ *
 * 假的浏览器环境（node 环境里没有 window / localStorage）
 * ------------------------------------------------------------------ */

interface FakeBrowser {
  keys: () => string[]
  get: (key: string) => string | null
  writes: string[]
  events: string[]
  failWriteWith: (err: unknown) => void
  window: Record<string, unknown>
}

function installBrowser(initial: Record<string, string> = {}): FakeBrowser {
  const store = new Map<string, string>(Object.entries(initial))
  const writes: string[] = []
  const events: string[] = []
  let writeError: unknown = null
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      if (writeError) throw writeError
      store.set(k, v)
      writes.push(k)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  }
  const window = {
    localStorage,
    sessionStorage: { getItem: () => null, setItem: () => {} },
    dispatchEvent: (e: { type: string }) => {
      events.push(e.type)
      return true
    },
    location: { hash: '', pathname: '/', search: '' },
    history: { replaceState: () => {} },
  }
  ;(globalThis as unknown as { window: unknown }).window = window
  return {
    keys: () => Array.from(store.keys()),
    get: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    writes,
    events,
    failWriteWith: (err: unknown) => {
      writeError = err
    },
    window: window as unknown as Record<string, unknown>,
  }
}

function uninstallBrowser() {
  delete (globalThis as unknown as { window?: unknown }).window
}

function storedConfig(browser: FakeBrowser) {
  const raw = browser.get(STORAGE_KEY)
  return raw ? JSON.parse(raw) : null
}

function quotaError() {
  const err = new Error('The quota has been exceeded.')
  ;(err as unknown as { name: string }).name = 'QuotaExceededError'
  return err
}

/** 记录所有订阅者看到的状态，用来模拟「另一个组件」 */
function trackView() {
  const seen: unknown[] = []
  const unsubscribe = subscribeHomeDiy(() => seen.push(getHomeDiySnapshot()))
  return { seen, unsubscribe }
}

let browser: FakeBrowser

beforeEach(() => {
  resetHomeDiySharedState()
  browser = installBrowser()
})

afterEach(() => {
  resetHomeDiySharedState()
  uninstallBrowser()
})

/* ------------------------------------------------------------------ *
 * 1. 共享单例：一处提交，所有组件都看到
 * ------------------------------------------------------------------ */

describe('共享状态：所有 useHomeDIY() 订阅者看到同一份配置', () => {
  it('任一订阅者提交后，其它订阅者都收到通知（就是「点了没反应」那个 bug）', () => {
    const a = trackView()
    const b = trackView()
    commitHomeDiyConfig((prev) => ({ ...prev, viewMode: 'classic' }))
    expect(a.seen).toHaveLength(1)
    expect(b.seen).toHaveLength(1)
    expect(getHomeDiySnapshot().config.viewMode).toBe('classic')
    a.unsubscribe()
    b.unsubscribe()
  })

  it('编排模式共享：工具栏打开后，导航区读到的也是 true', () => {
    const navigation = trackView()
    expect(getHomeDiySnapshot().isEditingLayout).toBe(false)
    // 工具栏那一侧按钮走的就是这个入口
    setHomeDiyEditingLayout(true)
    expect(navigation.seen).toHaveLength(1)
    expect(getHomeDiySnapshot().isEditingLayout).toBe(true)
    setHomeDiyEditingLayout(false)
    expect(getHomeDiySnapshot().isEditingLayout).toBe(false)
    navigation.unsubscribe()
  })

  it('状态没变时快照引用保持不变（useSyncExternalStore 的要求）', () => {
    const first = getHomeDiySnapshot()
    expect(getHomeDiySnapshot()).toBe(first)
    commitHomeDiyConfig((prev) => ({ ...prev, canvasBackground: 'dots' }))
    const second = getHomeDiySnapshot()
    expect(second).not.toBe(first)
    expect(second.config.canvasBackground).toBe('dots')
    expect(getHomeDiySnapshot()).toBe(second)
  })

  it('空操作（updater 原样返回）不写盘、不推历史、不提示', () => {
    const before = browser.writes.length
    const result = commitHomeDiyConfig((prev) => prev)
    expect(result.ok).toBe(true)
    expect(browser.writes.length).toBe(before)
    expect(getHomeDiySnapshot().history.past).toHaveLength(0)
    expect(getHomeDiySnapshot().storageWarning).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * 2. 撤销 / 重做走同一条历史（原实现每个组件各一份栈）
 * ------------------------------------------------------------------ */

describe('撤销 / 重做：一条共享历史，不是各存一份', () => {
  it('A 处改动 + B 处改动 → 撤销撤掉的是 B 的那次，而不是 A 的', () => {
    commitHomeDiyConfig((prev) => ({ ...prev, viewMode: 'workbench' }))
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'violet' }))
    expect(getHomeDiySnapshot().config.accentColor).toBe('violet')

    const undone = undoHomeDiy()
    expect(undone?.ok).toBe(true)
    expect(getHomeDiySnapshot().config.accentColor).toBe(DEFAULT_CONFIG.accentColor)
    expect(getHomeDiySnapshot().config.viewMode).toBe('workbench')

    const redone = redoHomeDiy()
    expect(redone?.ok).toBe(true)
    expect(getHomeDiySnapshot().config.accentColor).toBe('violet')
  })

  it('没有可撤销的历史时返回 null（界面据此禁用按钮）', () => {
    expect(undoHomeDiy()).toBeNull()
    expect(redoHomeDiy()).toBeNull()
  })

  it('远端合并只改配置，不污染撤销栈', () => {
    const before = getHomeDiySnapshot().history.past.length
    const result = applyRemoteHomeDiyConfig({
      config: { ...DEFAULT_CONFIG, canvasBackground: 'aurora' },
      clocks: { canvasBackground: 99 },
    })
    expect(result?.config.canvasBackground).toBe('aurora')
    expect(getHomeDiySnapshot().history.past.length).toBe(before)
    expect(undoHomeDiy()).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * 3. 落盘失败：内存照常生效，但必须说出来
 * ------------------------------------------------------------------ */

describe('落盘失败：改动仍然生效，但要有 storageWarning', () => {
  it('配额满：改动留在内存里，提示能解释「刷新会丢」', () => {
    browser.failWriteWith(quotaError())
    const result = commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'emerald' }))
    expect(result.ok).toBe(false)
    expect(getHomeDiySnapshot().config.accentColor).toBe('emerald')
    const warning = getHomeDiySnapshot().storageWarning
    expect(warning).toBeTruthy()
    expect(warning).toContain('刷新后会丢失')
    expect(warning).toContain('本地存储已满')
  })

  it('下一次写成功会清掉之前的提示（每次都是整份写回）', () => {
    browser.failWriteWith(quotaError())
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'amber' }))
    expect(getHomeDiySnapshot().storageWarning).toBeTruthy()

    browser.failWriteWith(null)
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'rose' }))
    expect(getHomeDiySnapshot().storageWarning).toBeNull()
    expect(storedConfig(browser).accentColor).toBe('rose')
  })

  it('提示可以被用户关掉', () => {
    browser.failWriteWith(quotaError())
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'amber' }))
    dismissHomeDiyStorageWarning()
    expect(getHomeDiySnapshot().storageWarning).toBeNull()
  })

  it('拿不到 localStorage（隐私模式）也算失败，且文案不说是「未知错误」', () => {
    uninstallBrowser()
    const result = commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'amber' }))
    expect(result.ok).toBe(false)
    expect(getHomeDiySnapshot().config.accentColor).toBe('amber')
    expect(getHomeDiySnapshot().storageWarning).toContain('不允许本站读写本地存储')
  })

  it('失败分类：配额 / 不可用 / 未知各自有话说', () => {
    expect(classifyHomeDiyStorageFailure(quotaError())).toBe('quota')
    expect(classifyHomeDiyStorageFailure(Object.assign(new Error('nope'), { name: 'SecurityError' }))).toBe('unavailable')
    expect(classifyHomeDiyStorageFailure(null)).toBe('unavailable')
    expect(classifyHomeDiyStorageFailure(new Error('boom'))).toBe('unknown')
    for (const err of [quotaError(), null, new Error('boom')]) {
      const note = describeHomeDiyStorageFailure(err)
      expect(note).toContain('刷新后会丢失')
      expect(note.length).toBeGreaterThan(30)
    }
  })
})

/* ------------------------------------------------------------------ *
 * 4. 读不出来 ≠ 没有配置
 * ------------------------------------------------------------------ */

describe('读本地配置：坏数据先备份，不能当「没有配置」直接覆盖', () => {
  it('半截 JSON：默认排版启动 + 备份原始字节 + 提示写出备份键', () => {
    browser = installBrowser({ [STORAGE_KEY]: '[{"version":3,"viewMode":"classi' })
    hydrateHomeDiy()
    expect(getHomeDiySnapshot().config.viewMode).toBe(DEFAULT_CONFIG.viewMode)
    const backups = browser.keys().filter((k) => k.startsWith(STORAGE_KEY + '.corrupt.'))
    expect(backups).toHaveLength(1)
    expect(browser.get(backups[0]!)).toBe('[{"version":3,"viewMode":"classi')
    const warning = getHomeDiySnapshot().storageWarning
    expect(warning).toContain('备份到')
    expect(warning).toContain(backups[0]!)
  })

  it('结构不合法（不是对象 / 缺元数据）同样算损坏，一并备份', () => {
    for (const raw of ['"just a string"', '123', '[1,2,3]', '{"cardOrder":[]}', 'null']) {
      browser = installBrowser({ [STORAGE_KEY]: raw })
      resetHomeDiySharedState()
      hydrateHomeDiy()
      expect(getHomeDiySnapshot().storageWarning, raw).toBeTruthy()
      expect(browser.keys().filter((k) => k.startsWith(STORAGE_KEY + '.corrupt.')).length, raw).toBe(1)
    }
  })

  it('备份失败也不能静默：提示说明「没能备份」', () => {
    browser = installBrowser({ [STORAGE_KEY]: 'broken' })
    resetHomeDiySharedState()
    browser.failWriteWith(quotaError())
    hydrateHomeDiy()
    expect(getHomeDiySnapshot().storageWarning).toContain('没能备份')
  })

  it('真的没有配置：用默认值且不报警（不能把「新用户」当故障）', () => {
    hydrateHomeDiy()
    expect(getHomeDiySnapshot().config.viewMode).toBe(DEFAULT_CONFIG.viewMode)
    expect(getHomeDiySnapshot().storageWarning).toBeNull()
    expect(browser.keys().filter((k) => k.startsWith(STORAGE_KEY + '.corrupt.'))).toHaveLength(0)
  })

  it('正常配置：读出来并且不报警', () => {
    browser = installBrowser({
      [STORAGE_KEY]: JSON.stringify({ ...DEFAULT_CONFIG, viewMode: 'classic', accentColor: 'violet' }),
    })
    resetHomeDiySharedState()
    hydrateHomeDiy()
    expect(getHomeDiySnapshot().config.viewMode).toBe('classic')
    expect(getHomeDiySnapshot().config.accentColor).toBe('violet')
    expect(getHomeDiySnapshot().storageWarning).toBeNull()
  })

  it('v2 迁移：保留能认的字段并写回 v3 键', () => {
    browser = installBrowser({
      navhub_home_diy_config_v2: JSON.stringify({
        viewMode: 'workbench',
        cardDisplayMode: 'compact',
        canvasBackground: 'grid',
        heroDeckWidgets: ['quick-search'],
        categoryOrder: ['a'],
      }),
    })
    resetHomeDiySharedState()
    hydrateHomeDiy()
    const config = getHomeDiySnapshot().config
    expect(config.viewMode).toBe('workbench')
    expect(config.cardDisplayMode).toBe('compact')
    expect(config.heroDeckWidgets).toEqual(['quick-search'])
    expect(config.categoryOrder).toEqual(['a'])
    expect(storedConfig(browser).viewMode).toBe('workbench')
  })

  it('v1 迁移：只迁移它认得的字段', () => {
    browser = installBrowser({
      navhub_home_diy_config_v1: JSON.stringify({ viewMode: 'classic', heroDeckCollapsed: true }),
    })
    resetHomeDiySharedState()
    hydrateHomeDiy()
    expect(getHomeDiySnapshot().config.viewMode).toBe('classic')
    expect(getHomeDiySnapshot().config.heroDeckCollapsed).toBe(true)
  })

  it('老键是坏的：不动用户数据，也不迁移', () => {
    browser = installBrowser({ navhub_home_diy_config_v2: '{oops' })
    resetHomeDiySharedState()
    hydrateHomeDiy()
    expect(getHomeDiySnapshot().config.viewMode).toBe(DEFAULT_CONFIG.viewMode)
    expect(browser.get('navhub_home_diy_config_v2')).toBe('{oops')
  })

  it('只 hydrate 一次：后挂载的组件不会把撤销栈和内存改动冲掉', () => {
    browser = installBrowser({ [STORAGE_KEY]: JSON.stringify({ ...DEFAULT_CONFIG, viewMode: 'classic' }) })
    resetHomeDiySharedState()
    hydrateHomeDiy()
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'violet' }))
    expect(getHomeDiySnapshot().history.past.length).toBe(1)

    // 模拟第二个组件挂载：它也会调 hydrateHomeDiy()
    hydrateHomeDiy()
    expect(getHomeDiySnapshot().config.accentColor).toBe('violet')
    expect(getHomeDiySnapshot().history.past.length).toBe(1)
  })
})

/* ------------------------------------------------------------------ *
 * 5. 接线守则（字符串守则抓不到语法错，语法由 tsc/build 兜底）
 * ------------------------------------------------------------------ */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, '/')
    return s.includes('/web-overlay/') || s.endsWith('/web-overlay')
  }
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p))
  if (!hit) throw new Error('无法定位 web-overlay 根目录（候选：' + candidates.join(' | ') + '）')
  return hit
}

const ROOT = overlayRoot()
const readSrc = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('接线守则：DIY 状态只能住在共享存储里，且失败必须让用户看见', () => {
  const hookSrc = readSrc('src/lib/modular/use-home-diy.ts')

  it('hook 必须用 useSyncExternalStore 订阅共享状态', () => {
    expect(hookSrc).toContain('useSyncExternalStore')
    expect(hookSrc).toContain('subscribeHomeDiy')
    expect(hookSrc).toContain('getHomeDiySnapshot')
  })

  it('hook 不许再用 useState 存 config / history / isEditingLayout（这正是一开始的 bug）', () => {
    expect(hookSrc).not.toMatch(/useState<HomeDIYConfig>/)
    expect(hookSrc).not.toMatch(/useState<LayoutHistoryState/)
    expect(hookSrc).not.toMatch(/const \[isEditingLayout, setIsEditingLayout\]/)
    expect(hookSrc).not.toMatch(/const \[config, setConfig\]/)
  })

  it('所有编辑都走共享存储：persistConfig 里不许再就地写 localStorage', () => {
    const body = hookSrc.slice(
      hookSrc.indexOf('const persistConfig = useCallback'),
      hookSrc.indexOf('// 3.1 接收远端标签页的改动'),
    )
    expect(body).toContain('commitHomeDiyConfig(')
    expect(body).not.toContain('localStorage')
    expect(hookSrc).not.toContain('window.localStorage.setItem')
  })

  it('编排模式开关必须写共享状态（否则导航区的拖拽手柄永远不出现）', () => {
    expect(hookSrc).toContain('setHomeDiyEditingLayout(')
    const body = hookSrc.slice(
      hookSrc.indexOf('const toggleEditingLayout = useCallback'),
      hookSrc.indexOf('// 28. 撤销 (Undo)'),
    )
    expect(body).toContain('setHomeDiyEditingLayout(')
  })

  it('本地存储键只能由共享存储持有（别的文件自己写这个键 = 又一份状态）', () => {
    const offenders: string[] = []
    for (const rel of [
      'src/components/navigation-content.tsx',
      'src/components/home-diy-toolbar.tsx',
      'src/components/home-hero-deck.tsx',
      'src/components/view-mode-toggle.tsx',
      'src/components/category-in-situ-controls.tsx',
      'src/components/keyboard-shortcuts-dialog.tsx',
      'src/app/page.tsx',
    ]) {
      if (!existsSync(join(ROOT, rel))) continue
      const src = readSrc(rel)
      if (src.includes('navhub_home_diy_config_v')) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('落盘失败必须在界面上渲染出来（本例：DIY 工具栏的 role=alert）', () => {
    const toolbar = readSrc('src/components/home-diy-toolbar.tsx')
    expect(toolbar).toContain('storageWarning')
    expect(toolbar).toContain('dismissStorageWarning')
    expect(toolbar).toContain('role="alert"')
  })
})
