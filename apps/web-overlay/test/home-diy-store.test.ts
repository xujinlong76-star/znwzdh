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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CONFIG,
  DIY_SHARE_BACKUP_MAX_COUNT,
  STORAGE_CLOCKS_KEY,
  STORAGE_KEY,
  applyRemoteHomeDiyConfig,
  backupHomeDiyShareConfig,
  classifyHomeDiyStorageFailure,
  commitHomeDiyConfig,
  describeHomeDiyStorageFailure,
  dismissHomeDiyStorageWarning,
  flushHomeDiyDiskWrites,
  getEffectiveSlotClocks,
  getHomeDiySnapshot,
  hydrateHomeDiy,
  migrateLegacyHomeDiyConfig,
  pruneHomeDiyShareBackups,
  redoHomeDiy,
  resetHomeDiySharedState,
  setHomeDiyEditingLayout,
  setHomeDiyPreview,
  subscribeHomeDiy,
  undoHomeDiy,
  type DiyPreviewPatch,
  type HomeDiyStorage,
} from '@/lib/modular/use-home-diy'
import { readSlotClocks } from '@/lib/modular/layout-sync'

import {
  publishSharedLayoutSync,
  subscribeSharedLayoutSyncChannel,
} from '@/lib/modular/use-home-diy-grid'

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
  it('配额满：改动留在内存里，落盘失败后提示能解释「刷新会丢」', () => {
    browser.failWriteWith(quotaError())
    const result = commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'emerald' }))
    // 内存立即生效；落盘是防抖异步的，ok 只表示「已接纳并排队落盘」，
    // 配额满只有真正 setItem 那一刻才知道，所以这里还不能断言失败。
    expect(result.ok).toBe(true)
    expect(getHomeDiySnapshot().config.accentColor).toBe('emerald')
    expect(getHomeDiySnapshot().storageWarning).toBeNull()
    flushHomeDiyDiskWrites()
    const warning = getHomeDiySnapshot().storageWarning
    expect(warning).toBeTruthy()
    expect(warning).toContain('刷新后会丢失')
    expect(warning).toContain('本地存储已满')
  })

  it('下一次写成功会清掉之前的提示（每次都是整份写回）', () => {
    browser.failWriteWith(quotaError())
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'amber' }))
    flushHomeDiyDiskWrites()
    expect(getHomeDiySnapshot().storageWarning).toBeTruthy()

    browser.failWriteWith(null)
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'rose' }))
    flushHomeDiyDiskWrites()
    expect(getHomeDiySnapshot().storageWarning).toBeNull()
    expect(storedConfig(browser).accentColor).toBe('rose')
  })

  it('提示可以被用户关掉', () => {
    browser.failWriteWith(quotaError())
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'amber' }))
    flushHomeDiyDiskWrites()
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
    const trigger = readSrc('src/components/home-diy-trigger.tsx')
    expect(trigger).toContain('storageWarning')
    expect(trigger).toContain('dismissStorageWarning')
    expect(trigger).toContain('role="alert"')
  })
})

/* ------------------------------------------------------------------ *
 * 6. 落盘防抖：内存立即生效，磁盘写 300ms 后才执行一次
 *    （假时钟：断言不依赖真实等待，不会 flaky）
 * ------------------------------------------------------------------ */

describe('落盘防抖：内存立即生效，磁盘写 300ms 后才执行一次', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('提交后内存立即变，但 300ms 内不写盘', () => {
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'violet' }))
    expect(getHomeDiySnapshot().config.accentColor).toBe('violet')
    expect(browser.writes).not.toContain(STORAGE_KEY)
    expect(storedConfig(browser)).toBeNull()

    vi.advanceTimersByTime(299)
    expect(browser.writes).not.toContain(STORAGE_KEY)
    vi.advanceTimersByTime(1)
    expect(browser.writes).toContain(STORAGE_KEY)
    expect(storedConfig(browser).accentColor).toBe('violet')
  })

  it('300ms 内的连续提交只写一次盘，且是最后一份', () => {
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'violet' }))
    vi.advanceTimersByTime(100)
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'emerald' }))
    vi.advanceTimersByTime(100)
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'amber' }))
    expect(browser.writes.filter((k) => k === STORAGE_KEY)).toHaveLength(0)

    vi.advanceTimersByTime(300)
    expect(browser.writes.filter((k) => k === STORAGE_KEY)).toHaveLength(1)
    expect(storedConfig(browser).accentColor).toBe('amber')
  })

  it('flushHomeDiyDiskWrites 立即刷掉挂起的写（页面卸载兜底），且不重复写', () => {
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'rose' }))
    expect(browser.writes).not.toContain(STORAGE_KEY)
    flushHomeDiyDiskWrites()
    expect(storedConfig(browser).accentColor).toBe('rose')
    vi.advanceTimersByTime(1000)
    expect(browser.writes.filter((k) => k === STORAGE_KEY)).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ *
 * 7. 撤销合并：同字段 500ms 内的连续编辑只留一条记录
 * ------------------------------------------------------------------ */

describe('撤销合并：同字段 500ms 内的连续编辑只留一条记录', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('滑杆连续拖动：3 次同字段提交只留 1 条撤销记录，一次 Ctrl+Z 回到起点', () => {
    commitHomeDiyConfig((prev) => ({ ...prev, cardOpacity: 0.91 }))
    vi.advanceTimersByTime(100)
    commitHomeDiyConfig((prev) => ({ ...prev, cardOpacity: 0.92 }))
    vi.advanceTimersByTime(100)
    commitHomeDiyConfig((prev) => ({ ...prev, cardOpacity: 0.93 }))
    expect(getHomeDiySnapshot().config.cardOpacity).toBe(0.93)
    expect(getHomeDiySnapshot().history.past).toHaveLength(1)

    undoHomeDiy()
    expect(getHomeDiySnapshot().config.cardOpacity).toBe(0.9)
    expect(getHomeDiySnapshot().history.past).toHaveLength(0)
  })

  it('不同字段不合并', () => {
    commitHomeDiyConfig((prev) => ({ ...prev, cardOpacity: 0.91 }))
    vi.advanceTimersByTime(100)
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'violet' }))
    expect(getHomeDiySnapshot().history.past).toHaveLength(2)
  })

  it('超出 500ms 窗口不合并', () => {
    commitHomeDiyConfig((prev) => ({ ...prev, cardOpacity: 0.91 }))
    vi.advanceTimersByTime(600)
    commitHomeDiyConfig((prev) => ({ ...prev, cardOpacity: 0.92 }))
    expect(getHomeDiySnapshot().history.past).toHaveLength(2)
  })

  it('窗口内拖回起点：整段合并直接撤销，不留一条「撤销了个寂寞」的记录', () => {
    commitHomeDiyConfig((prev) => ({ ...prev, cardOpacity: 0.91 }))
    vi.advanceTimersByTime(100)
    commitHomeDiyConfig((prev) => ({ ...prev, cardOpacity: 0.9 }))
    expect(getHomeDiySnapshot().config.cardOpacity).toBe(0.9)
    expect(getHomeDiySnapshot().history.past).toHaveLength(0)
    expect(undoHomeDiy()).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * 8. 撤销深度：25 → 50（合并节流后 50 条才够用）
 * ------------------------------------------------------------------ */

describe('撤销深度：25 → 50', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('连续 55 次提交只保留最近 50 条', () => {
    for (let i = 0; i < 55; i++) {
      commitHomeDiyConfig((prev) => ({ ...prev, customWallpaperUrl: `https://example.test/${i}` }))
      // 每次间隔 600ms：既破合并窗口，又让防抖写有机会落盘
      vi.advanceTimersByTime(600)
    }
    const { past, present } = getHomeDiySnapshot().history
    expect(past).toHaveLength(50)
    // 丢掉的是最旧 5 条：第 1 条保留的是第 5 次提交后的状态（i=4）
    expect(past[0]!.customWallpaperUrl).toBe('https://example.test/4')
    expect(present.customWallpaperUrl).toBe('https://example.test/54')
  })
})

/* ------------------------------------------------------------------ *
 * 9. 预设悬停预览：只改快照，不落盘、不进撤销栈
 * ------------------------------------------------------------------ */

describe('预设悬停预览：只改快照，不落盘、不进撤销栈', () => {
  it('预览覆盖快照里的渲染字段，真实配置纹丝不动', () => {
    setHomeDiyPreview({ cardDisplayMode: 'minimal', canvasBackground: 'aurora' })
    expect(getHomeDiySnapshot().config.cardDisplayMode).toBe('minimal')
    expect(getHomeDiySnapshot().config.canvasBackground).toBe('aurora')
    expect(getHomeDiySnapshot().history.past).toHaveLength(0)
    expect(browser.writes).not.toContain(STORAGE_KEY)

    setHomeDiyPreview(null)
    expect(getHomeDiySnapshot().config.cardDisplayMode).toBe('standard')
    expect(getHomeDiySnapshot().config.canvasBackground).toBe('mesh')
  })

  it('悬停 3 个预设：撤销栈与磁盘都不动', () => {
    const previews: DiyPreviewPatch[] = [
      { cardDisplayMode: 'minimal', canvasBackground: 'grid', viewMode: 'classic', heroDeckCollapsed: true, heroDeckWidgets: ['quick-search'] },
      { cardDisplayMode: 'rich', canvasBackground: 'aurora', viewMode: 'hybrid', heroDeckCollapsed: false, heroDeckWidgets: ['quick-search', 'favorites-dock'] },
      { cardDisplayMode: 'compact', canvasBackground: 'clean', viewMode: 'workbench', heroDeckCollapsed: false, heroDeckWidgets: ['quick-search', 'clock-pomodoro', 'favorites-dock', 'quick-tools'] },
    ]
    for (const preview of previews) {
      setHomeDiyPreview(preview)
      setHomeDiyPreview(null)
    }
    expect(getHomeDiySnapshot().history.past).toHaveLength(0)
    expect(browser.writes).not.toContain(STORAGE_KEY)
    expect(getHomeDiySnapshot().config.cardDisplayMode).toBe('standard')
  })

  it('预览覆盖视图模式与展板：快照变、真实配置不动（W5：patch 扩到 viewMode / heroDeckCollapsed / heroDeckWidgets）', () => {
    // zen-focus 悬停：classic + 折叠展板 + 只剩 quick-search，点下去之前真实配置还是 hybrid
    setHomeDiyPreview({
      cardDisplayMode: 'standard',
      canvasBackground: 'clean',
      viewMode: 'classic',
      heroDeckCollapsed: true,
      heroDeckWidgets: ['quick-search'],
    })
    const snap = getHomeDiySnapshot().config
    expect(snap.viewMode).toBe('classic')
    expect(snap.heroDeckCollapsed).toBe(true)
    expect(snap.heroDeckWidgets).toEqual(['quick-search'])
    expect(snap.cardDisplayMode).toBe('standard')
    expect(snap.canvasBackground).toBe('clean')
    expect(getHomeDiySnapshot().history.past).toHaveLength(0)
    expect(browser.writes).not.toContain(STORAGE_KEY)

    setHomeDiyPreview(null)
    const real = getHomeDiySnapshot().config
    expect(real.viewMode).toBe('hybrid')
    expect(real.heroDeckCollapsed).toBe(false)
    expect(real.heroDeckWidgets).toEqual(['quick-search', 'clock-pomodoro', 'favorites-dock', 'quick-tools'])
  })

  it('拖拽式提交不碰预览字段：预览继续盖着快照，只有改到预览字段才清那一项', () => {
    setHomeDiyPreview({ cardDisplayMode: 'minimal', canvasBackground: 'aurora' })
    // 拖拽改分类顺序：没碰 cardDisplayMode / canvasBackground，预览原样保留
    commitHomeDiyConfig((prev) => ({ ...prev, categoryOrder: ['cat-a', 'cat-b'] }))
    expect(getHomeDiySnapshot().config.cardDisplayMode).toBe('minimal')
    expect(getHomeDiySnapshot().config.canvasBackground).toBe('aurora')
    expect(getHomeDiySnapshot().config.categoryOrder).toEqual(['cat-a', 'cat-b'])
    // 改强调色同样不碰预览字段
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'violet' }))
    expect(getHomeDiySnapshot().config.cardDisplayMode).toBe('minimal')
    expect(getHomeDiySnapshot().config.accentColor).toBe('violet')
    // 改了 cardDisplayMode：只清这一项，背景预览继续盖着
    commitHomeDiyConfig((prev) => ({ ...prev, cardDisplayMode: 'rich' }))
    expect(getHomeDiySnapshot().config.cardDisplayMode).toBe('rich')
    expect(getHomeDiySnapshot().config.canvasBackground).toBe('aurora')
    // 再改 canvasBackground：预览彻底清掉，快照回到真实值
    commitHomeDiyConfig((prev) => ({ ...prev, canvasBackground: 'grid' }))
    expect(getHomeDiySnapshot().config.canvasBackground).toBe('grid')
    expect(getHomeDiySnapshot().config.cardDisplayMode).toBe('rich')
  })

  it('提交改到视图/展板预览字段时只清那一项（W5：previewAfterCommit 跟随 patch 扩字段）', () => {
    setHomeDiyPreview({
      viewMode: 'classic',
      heroDeckCollapsed: true,
      heroDeckWidgets: ['quick-search'],
      canvasBackground: 'aurora',
    })
    // 拖拽改分类顺序：视图/展板预览原样保留
    commitHomeDiyConfig((prev) => ({ ...prev, categoryOrder: ['cat-a', 'cat-b'] }))
    expect(getHomeDiySnapshot().config.viewMode).toBe('classic')
    expect(getHomeDiySnapshot().config.heroDeckCollapsed).toBe(true)
    expect(getHomeDiySnapshot().config.heroDeckWidgets).toEqual(['quick-search'])
    expect(getHomeDiySnapshot().config.canvasBackground).toBe('aurora')
    // 真实提交改了 viewMode：只清 viewMode 一项，展板/背景预览继续盖着
    commitHomeDiyConfig((prev) => ({ ...prev, viewMode: 'workbench' }))
    expect(getHomeDiySnapshot().config.viewMode).toBe('workbench')
    expect(getHomeDiySnapshot().config.heroDeckCollapsed).toBe(true)
    expect(getHomeDiySnapshot().config.heroDeckWidgets).toEqual(['quick-search'])
    expect(getHomeDiySnapshot().config.canvasBackground).toBe('aurora')
    // 再改 heroDeckCollapsed 与 heroDeckWidgets：必须真改动（默认 false→true、
    // 默认 4 个组件→2 个）才算碰到预览字段，两项都清，只剩背景预览
    commitHomeDiyConfig((prev) => ({ ...prev, heroDeckCollapsed: true, heroDeckWidgets: ['quick-search', 'quick-tools'] }))
    expect(getHomeDiySnapshot().config.heroDeckCollapsed).toBe(true)
    expect(getHomeDiySnapshot().config.heroDeckWidgets).toEqual(['quick-search', 'quick-tools'])
    expect(getHomeDiySnapshot().config.canvasBackground).toBe('aurora')
    // 最后改背景：预览彻底清掉；展板两项仍是刚才提交的真实值，证明它们
    // 不是预览盖着的（若是预览，清掉后会跳回默认值 false / 4 个组件）
    commitHomeDiyConfig((prev) => ({ ...prev, canvasBackground: 'grid' }))
    expect(getHomeDiySnapshot().config.canvasBackground).toBe('grid')
    expect(getHomeDiySnapshot().config.viewMode).toBe('workbench')
    expect(getHomeDiySnapshot().config.heroDeckCollapsed).toBe(true)
    expect(getHomeDiySnapshot().config.heroDeckWidgets).toEqual(['quick-search', 'quick-tools'])
  })

  it('点击应用只产生 1 条历史记录（预览本身不占坑）', () => {
    setHomeDiyPreview({ cardDisplayMode: 'minimal', canvasBackground: 'grid' })
    setHomeDiyPreview(null)
    // 点击预设走一次真实提交（applyDIYPreset 的 persistConfig）
    commitHomeDiyConfig((prev) => ({
      ...prev,
      cardDisplayMode: 'minimal',
      canvasBackground: 'grid',
      updatedAt: Date.now(),
    }))
    expect(getHomeDiySnapshot().history.past).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ *
 * 10. 工具栏接线守则：死开关已删、悬停不污染、快捷键与滑杆
 * ------------------------------------------------------------------ */

describe('工具栏接线守则：死开关已删、悬停不污染、快捷键与滑杆', () => {
  const toolbar = readSrc('src/components/home-diy-toolbar.tsx')
  const hook = readSrc('src/lib/modular/use-home-diy.ts')
  const storage = readSrc('src/lib/modular/home-diy-storage.ts')

  it('死掉的工作区切换器已删除（UI、setter、字段、白名单都不剩）', () => {
    for (const needle of [
      'setCurrentWorkspace',
      'currentWorkspace',
      'workspaceLayouts',
      '排版生效作用域',
      '研发全栈',
      'AI 实验室',
      '全局默认',
    ]) {
      expect(toolbar, needle).not.toContain(needle)
    }
    expect(hook).not.toContain('setCurrentWorkspace')
    expect(hook).not.toContain('currentWorkspace')
    expect(storage).not.toContain('workspaceLayouts')
    expect(storage).not.toContain('currentWorkspace')
  })

  it('预设悬停走预览，不走提交：hover 里不许出现提交型 setter', () => {
    const body = toolbar.slice(
      toolbar.indexOf('const handlePresetHover'),
      toolbar.indexOf('const handleApplyPresetAndClearPreview'),
    )
    expect(body).toContain('setHomeDiyPreview')
    expect(body).not.toContain('setCardDisplayMode(')
    expect(body).not.toContain('setCanvasBackground(')
    expect(body).not.toContain('setDensity(')
    // 密度预览只改 data-density 属性，不写偏好
    expect(body).toContain("setAttribute('data-density'")
  })

  it('编排开关不再由工具栏处理 Ctrl/Cmd+E：单源在快捷键对话框，工具栏只剩 Esc', () => {
    const body = toolbar.slice(
      toolbar.indexOf('const handleGlobalKey'),
      toolbar.indexOf("window.addEventListener('keydown', handleGlobalKey)"),
    )
    // 工具栏曾经也挂一份 Ctrl/Cmd+E：两处同时 preventDefault + toggle 会互相抵消
    expect(body).not.toContain("toLowerCase() === 'e'")
    expect(body).not.toContain('toggleEditingLayout()')
    expect(body).toContain("e.key === 'Escape'")
    // 单源：keyboard-shortcuts-dialog.tsx:140
    const dialog = readSrc('src/components/keyboard-shortcuts-dialog.tsx')
    expect(dialog).toContain("(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e'")
  })

  it('不透明度滑杆拖动时不提交：onChange 只写本地草稿，松开才提交', () => {
    expect(toolbar).toContain('setOpacityDraft(Number(e.target.value))')
    expect(toolbar).not.toContain('onChange={(e) => setAestheticSliders(')
    expect(toolbar).toContain('onPointerUp={commitOpacityDraft}')
    expect(toolbar).toContain('onTouchEnd={commitOpacityDraft}')
    expect(toolbar).toContain('onBlur={commitOpacityDraft}')
    expect(toolbar).toContain('onKeyUp={commitOpacityDraft}')
  })

  it('「一句话排版」已改名快捷指令，文案只列能识别的关键词', () => {
    expect(toolbar).not.toContain('一句话排版')
    expect(toolbar).not.toContain('自然语言')
    expect(toolbar).toContain('快捷指令')
    expect(toolbar).toContain('parseDiyShortcut(')
    expect(toolbar).toContain('只认这些关键词')
  })
})

/* ------------------------------------------------------------------ *
 * 11. 工具栏细化修复（DIY detail round W3）：预设预览、toast 诚实度、
 *    长辈模式密度提示、无障碍与焦点、落盘警告在编排态可见
 *    （源码守卫：组件需 DOM 挂载，node 环境测不了行为，见 skin-picker
 *    文件头的同款说明；这里钉住「写了什么」，挂载行为未覆盖）
 * ------------------------------------------------------------------ */

describe('工具栏细化修复：预设预览与 toast 诚实度', () => {
  const toolbar = readSrc('src/components/home-diy-toolbar.tsx')
  const storage = readSrc('src/lib/modular/home-diy-storage.ts')

  it('预设聚焦与悬停同等预览：键盘聚焦也要调 handlePresetHover', () => {
    expect(toolbar).toContain('onMouseEnter={() => handlePresetHover(preset)}')
    expect(toolbar).toContain('onFocus={() => handlePresetHover(preset)}')
    expect(toolbar).toContain('onBlur={() => handlePresetHover(null)}')
  })

  it('预览覆盖面已补全（W5）：DiyPreviewPatch 含视图模式与展板，悬停即预览', () => {
    // W3 钉住的缺口已补：setHomeDiyPreview 的 patch 类型扩成五项——
    // cardDisplayMode / canvasBackground / viewMode / heroDeckCollapsed /
    // heroDeckWidgets（密度仍走 data-density）。渲染层读的是快照 config
    //（真实配置 + 预览覆盖），扩类型即生效，无需改渲染。
    const patchStart = storage.indexOf('export type DiyPreviewPatch')
    const patch = storage.slice(patchStart, patchStart + 400)
    expect(patch).toContain("'cardDisplayMode' | 'canvasBackground' | 'viewMode' | 'heroDeckCollapsed' | 'heroDeckWidgets'")
    // 工具栏悬停时把预设的五项都推进预览（不是只推形态/背景）
    const hover = toolbar.slice(
      toolbar.indexOf('const handlePresetHover'),
      toolbar.indexOf('const handlePresetHover') + 800,
    )
    expect(hover).toContain('viewMode: preset.config.viewMode')
    expect(hover).toContain('heroDeckCollapsed: preset.config.heroDeckCollapsed')
    expect(hover).toContain('heroDeckWidgets: preset.config.heroDeckWidgets')
    // 菜单文案不再说「视图与首屏展板点击才生效」：悬停已经能预览它们
    expect(toolbar).not.toContain('视图与首屏展板点击才生效')
    expect(toolbar).toContain('悬停或聚焦即时预览：卡片形态、背景、密度、视图与首屏展板')
  })

  it('「智能调优」toast 不再编数字与密度：按真实结果说', () => {
    expect(toolbar).not.toContain('顶部 8 大')
    expect(toolbar).not.toContain('优化网格密度')
    expect(toolbar).not.toContain('核心技术类目')
    const body = toolbar.slice(
      toolbar.indexOf('const handleRunSmartAutoTune'),
      toolbar.indexOf('const handleRunSmartAutoTune') + 1500,
    )
    expect(body).toContain('const result = applySmartAutoTune(allSites, categories)')
    expect(body).toContain('result.appliedCounts')
    expect(body).toContain('counts.speedDialCount')
    expect(body).toContain('按访问频次与星标')
    expect(body).toContain('按访问热度重排分类')
    expect(body).toContain('开启自适应排序')
  })

  it('已删的一键整理不再出现：handleAutoTidyLayout 与 layout-tidy.ts 已一并删除', () => {
    expect(toolbar).not.toContain('handleAutoTidyLayout')
    expect(toolbar).not.toContain('computeLayoutTidyPlan')
    expect(toolbar).not.toContain('算法智能自愈整理已完成')
  })

  it('长辈模式开着时应用预设：toast 必须说明密度没生效', () => {
    const body = toolbar.slice(
      toolbar.indexOf('const handleApplyPreset = '),
      toolbar.indexOf('const handlePresetHover'),
    )
    expect(body).toContain("getAttribute('data-elder-mode') === 'on'")
    expect(body).toContain('长辈模式开启中，密度仍保持宽松间距')
  })
})

describe('工具栏细化修复：无障碍、焦点与编排态落盘警告', () => {
  const toolbar = readSrc('src/components/home-diy-toolbar.tsx')

  it('图标按钮都有 aria-label，不再只剩 title', () => {
    expect(toolbar).toContain('aria-label="撤销"')
    expect(toolbar).toContain('aria-label="重做"')
    expect(toolbar).toContain('aria-label="排版蓝图 JSON 导入与导出"')
    expect(toolbar).toContain('aria-label="恢复系统默认排版"')
  })

  it('撤销/重做标题按平台走：Mac 是 ⌘Z / ⌘⇧Z，Win/Linux 才是 Ctrl+Z / Ctrl+Y', () => {
    expect(toolbar).toContain('isAppleDevice()')
    expect(toolbar).toContain("'撤销 (↩ ⌘Z)'")
    expect(toolbar).toContain("'重做 (↪ ⌘⇧Z)'")
    expect(toolbar).toContain("'重做 (↪ Ctrl+Y)'")
    // 旧写法：静态 title 写死 Ctrl+Y，Mac 上根本按不出来
    expect(toolbar).not.toContain('title="重做 (↪ Ctrl+Y)"')
    expect(toolbar).not.toContain('title="撤销 (↩ Ctrl+Z)"')
  })

  it('焦点：进编排移进工具栏首个控件，退出还给进编排前聚焦的元素', () => {
    expect(toolbar).toContain('previouslyFocusedRef')
    expect(toolbar).toContain('toolbarRootRef')
    expect(toolbar).toContain("querySelector<HTMLElement>('button:not([disabled])")
    expect(toolbar).toContain('prev.isConnected')
    // 触发按钮在编排态不渲染：原元素已卸载时回退到重新出现的触发按钮
    expect(toolbar).toContain('button[title^="开启 DIY 排版"]')
  })

  it('编排态的落盘警告画在工具栏里（触发器在编排态隐藏，警告不能跟着消失）', () => {
    expect(toolbar).toContain('storageWarning')
    expect(toolbar).toContain('dismissStorageWarning')
    expect(toolbar).toContain('role="alert"')
  })
})

describe('大纲与备份弹窗细化修复（W3）', () => {
  it('大纲搜索无匹配时有明确空态，不画空白列表', () => {
    const dialog = readSrc('src/components/home-diy-outline-dialog.tsx')
    expect(dialog).toContain('filteredCategoryIds.length === 0')
    expect(dialog).toContain('无匹配')
  })

  it('备份弹窗读文件失败有 onerror 与用户可见提示，不再静默', () => {
    const dialog = readSrc('src/components/home-diy-backup-dialog.tsx')
    expect(dialog).toContain('reader.onerror')
    expect(dialog).toContain('读取文件失败')
  })
})

/* ------------------------------------------------------------------ *
 * 11. W2：Ctrl/Cmd+E 单一入口、预设速览坞、分享确认落盘、跨 Tab 合并诚实通知、共享通道
 * ------------------------------------------------------------------ */

describe('W2：Ctrl/Cmd+E 只有一个入口（安全阀与工具栏的重复绑定已删）', () => {
  it('全仓只剩 keyboard-shortcuts-dialog 里一处 Ctrl/Cmd+E 开关', () => {
    const needle = "toLowerCase() === 'e'"
    const dialog = readSrc('src/components/keyboard-shortcuts-dialog.tsx')
    const nav = readSrc('src/components/navigation-content.tsx')
    const toolbarSrc = readSrc('src/components/home-diy-toolbar.tsx')
    const count = [dialog, nav, toolbarSrc].reduce(
      (n, s) => n + s.split(needle).length - 1,
      0,
    )
    expect(count).toBe(1)
    expect(dialog).toContain(needle)
    expect(dialog).toContain("if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e')")
    expect(nav).not.toContain('已通过安全阀快捷键')
    expect(nav).not.toContain('安全阀兜底响应')
  })
})

describe('W2：预设的 speedDialEnabled 真的写进配置（速览坞读得到）', () => {
  it('applyDIYPreset 把预设的 speedDialEnabled 写进 persistConfig', () => {
    const hook = readSrc('src/lib/modular/use-home-diy.ts')
    const body = hook.slice(hook.indexOf('const applyDIYPreset'), hook.indexOf('// 22-27'))
    expect(body).toContain('speedDialEnabled: target.config.speedDialEnabled ?? prev.speedDialEnabled')
  })

  it('速览坞的读口就是 config.speedDialEnabled，接线到此为止', () => {
    const dock = readSrc('src/components/speed-dial-dock.tsx')
    expect(dock).toContain('speedDialEnabled')
    expect(dock).toContain('if (!speedDialEnabled && !isEditingLayout) return null')
  })
})

describe('W2：confirmPendingShare 先刷盘再读 warning（不读上一次的旧状态）', () => {
  it('confirmPendingShare 里 flush 在 getHomeDiySnapshot 之前', () => {
    const hook = readSrc('src/lib/modular/use-home-diy.ts')
    const body = hook.slice(
      hook.indexOf('const confirmPendingShare'),
      hook.indexOf('const dismissPendingShare'),
    )
    expect(body).toContain('flushHomeDiyDiskWrites()')
    expect(body.indexOf('flushHomeDiyDiskWrites()')).toBeLessThan(body.indexOf('getHomeDiySnapshot()'))
    expect(body).toContain('ok: snapshot.storageWarning === null')
  })
})

describe('W2：跨 Tab 合并只在落盘成功后才通知', () => {
  it('applyRemoteConfig 里 notify 被 result.ok 把门', () => {
    const hook = readSrc('src/lib/modular/use-home-diy.ts')
    const body = hook.slice(hook.indexOf('const applyRemoteConfig'), hook.indexOf('// 3.2 建立'))
    expect(body).toContain('if (result && result.ok)')
    expect(body).toContain('notifyLayoutSyncMerge(')
    // 合并前的本地时钟读有效时钟（磁盘 + 内存未落盘部分），不只读磁盘：
    // 300ms 防抖期内刚提交的本地改动还没上盘，只读磁盘会漏报 discardedLocal
    expect(body).toContain('const beforeClocks = getEffectiveSlotClocks()')
    expect(body).not.toContain('readSlotClocks(STORAGE_CLOCKS_KEY)')
    // 内存-only 的合并（ok 为 false）不许再走同一句「已同步」通知
    expect(body).not.toMatch(/if \(result\) \{\s*\n?\s*\/\/ 跨 Tab 合并必须让用户看见/)
  })
})

describe('W2：共享 BroadcastChannel 单例', () => {
  it('两个 hook 各自不再 new 通道：createLayoutSyncChannel 只在单例工厂里出现一次', () => {
    const hook = readSrc('src/lib/modular/use-home-diy.ts')
    const grid = readSrc('src/lib/modular/use-home-diy-grid.ts')
    expect(hook).not.toContain('createLayoutSyncChannel')
    expect(hook).not.toContain('syncChannelRef')
    expect(grid).not.toContain('const syncChannelRef')
    expect(grid).not.toContain('useRef<LayoutSyncChannel')
    // 真正建通道的调用点只有单例工厂里一处（注释里的提及不算）
    expect(grid.match(/createLayoutSyncChannel</g)?.length).toBe(1)
    expect(grid).toContain('subscribeSharedLayoutSyncChannel')
    expect(grid).toContain('publishSharedLayoutSync')
    expect(hook).toContain('subscribeSharedLayoutSyncChannel(applyRemoteConfig)')
    expect(hook).toContain('publishSharedLayoutSync(')
  })

  it('多订阅者只建一条底层通道，消息多播给每一方，最后一个离开时关闭', () => {
    class FakeBroadcastChannel {
      static instances: FakeBroadcastChannel[] = []
      static closed = 0
      name: string
      onmessage: ((ev: { data: unknown }) => void) | null = null
      posted: unknown[] = []
      constructor(name: string) {
        this.name = name
        FakeBroadcastChannel.instances.push(this)
      }
      postMessage(data: unknown) {
        this.posted.push(data)
      }
      close() {
        FakeBroadcastChannel.closed += 1
      }
      deliver(data: unknown) {
        this.onmessage?.({ data })
      }
    }
    const g = globalThis as unknown as Record<string, unknown>
    const prevBroadcastChannel = g.BroadcastChannel
    g.BroadcastChannel = FakeBroadcastChannel
    try {
      FakeBroadcastChannel.instances = []
      FakeBroadcastChannel.closed = 0
      const seenA: unknown[] = []
      const seenB: unknown[] = []
      const handlerA = (p: { config: unknown; clocks: unknown }) => {
        seenA.push(p)
      }
      const handlerB = (p: { config: unknown; clocks: unknown }) => {
        seenB.push(p)
      }
      const offA = subscribeSharedLayoutSyncChannel(handlerA)
      const offB = subscribeSharedLayoutSyncChannel(handlerB)
      // 同一个 handler 再订一次：Set 去重，不多收
      const offA2 = subscribeSharedLayoutSyncChannel(handlerA)
      expect(FakeBroadcastChannel.instances).toHaveLength(1)
      expect(FakeBroadcastChannel.instances[0]!.name).toBe('navhub_home_diy_sync_v1')

      FakeBroadcastChannel.instances[0]!.deliver({
        clientId: 'other-tab',
        config: { viewMode: 'hybrid' },
        clocks: { viewMode: 2 },
      })
      expect(seenA).toHaveLength(1)
      expect(seenB).toHaveLength(1)

      publishSharedLayoutSync({
        config: { ...DEFAULT_CONFIG, viewMode: 'classic' },
        clocks: { viewMode: 1 },
      })
      expect(FakeBroadcastChannel.instances).toHaveLength(1)
      expect(FakeBroadcastChannel.instances[0]!.posted).toHaveLength(1)

      offA()
      offA2()
      // 还有 B 活着，底层通道不能关
      expect(FakeBroadcastChannel.closed).toBe(0)
      offB()
      expect(FakeBroadcastChannel.closed).toBe(1)

      // 全退订后下次订阅懒重建一条新通道
      const offC = subscribeSharedLayoutSyncChannel(handlerA)
      expect(FakeBroadcastChannel.instances).toHaveLength(2)
      offC()
      expect(FakeBroadcastChannel.closed).toBe(2)
    } finally {
      if (prevBroadcastChannel === undefined) delete g.BroadcastChannel
      else g.BroadcastChannel = prevBroadcastChannel
    }
  })
})

describe('W2：触发器在编辑态也得让存储告警露出来', () => {
  it('编辑态只在无告警时才 return null；FAB 仍只在静息态渲染', () => {
    const trigger = readSrc('src/components/home-diy-trigger.tsx')
    expect(trigger).toContain('if (isEditingLayout && !storageWarning) return null')
    expect(trigger).not.toContain('if (isEditingLayout) return null')
    expect(trigger).toContain('{storageWarning && (')
    // FAB 被包进 !isEditingLayout：编辑态不渲染 FAB，但告警横幅不在这个条件里
    const fabIndex = trigger.indexOf('DIY 排版工坊</span>')
    const guardIndex = trigger.lastIndexOf('{!isEditingLayout && (', fabIndex)
    expect(guardIndex).toBeGreaterThan(-1)
  })
})

/* ------------------------------------------------------------------ *
 * W1-2. 旧版迁移：只迁一次，且只合老键里带的字段（不再整表覆盖 v3）
 * ------------------------------------------------------------------ */

describe('v2/v1 迁移：只迁一次，且只合老键里带的字段', () => {
  it('v3 已有的字段不被打回默认：老键缺的字段保持 v3 值，老键随即删除', () => {
    browser = installBrowser({
      [STORAGE_KEY]: JSON.stringify({
        ...DEFAULT_CONFIG,
        viewMode: 'classic',
        accentColor: 'violet',
        customWallpaperUrl: 'https://example.com/w.jpg',
        cardOpacity: 0.95,
        speedDialEnabled: true,
        pinnedSiteIdsByCategory: { 'cat-a': ['s1'] },
        siteCategoryOverrides: { 'site-1': 'cat-a' },
      }),
      navhub_home_diy_config_v2: JSON.stringify({ viewMode: 'workbench', cardDisplayMode: 'compact' }),
    })
    resetHomeDiySharedState()
    hydrateHomeDiy()
    const config = getHomeDiySnapshot().config
    expect(config.viewMode).toBe('workbench')
    expect(config.cardDisplayMode).toBe('compact')
    expect(config.accentColor).toBe('violet')
    expect(config.customWallpaperUrl).toBe('https://example.com/w.jpg')
    expect(config.cardOpacity).toBe(0.95)
    expect(config.speedDialEnabled).toBe(true)
    expect(config.pinnedSiteIdsByCategory).toEqual({ 'cat-a': ['s1'] })
    expect(config.siteCategoryOverrides).toEqual({ 'site-1': 'cat-a' })
    // 老键已删：只迁一次；迁移结果已写回 v3 键
    expect(browser.get('navhub_home_diy_config_v2')).toBeNull()
    expect(storedConfig(browser).viewMode).toBe('workbench')
    expect(storedConfig(browser).accentColor).toBe('violet')
  })

  it('老键里带的字段会覆盖：v2 的强调色 / 壁纸 / 不透明度 / 速览坞也认', () => {
    browser = installBrowser({
      [STORAGE_KEY]: JSON.stringify({ ...DEFAULT_CONFIG, accentColor: 'violet', cardOpacity: 0.95 }),
      navhub_home_diy_config_v2: JSON.stringify({
        viewMode: 'classic',
        accentColor: 'rose',
        customWallpaperUrl: 'https://example.com/legacy.jpg',
        cardOpacity: 0.2,
        speedDialEnabled: true,
        glassmorphismBlur: 20,
      }),
    })
    resetHomeDiySharedState()
    hydrateHomeDiy()
    const config = getHomeDiySnapshot().config
    expect(config.accentColor).toBe('rose')
    expect(config.customWallpaperUrl).toBe('https://example.com/legacy.jpg')
    // 0.2 按可读性下限抬升到 0.88（与清洗器同口径）
    expect(config.cardOpacity).toBe(0.88)
    expect(config.speedDialEnabled).toBe(true)
    expect(config.glassmorphismBlur).toBe(20)
    expect(browser.get('navhub_home_diy_config_v2')).toBeNull()
  })

  it('第二次加载不再重跑迁移：老键没了，v3 值原样保留', () => {
    browser = installBrowser({
      [STORAGE_KEY]: JSON.stringify({ ...DEFAULT_CONFIG, viewMode: 'classic', accentColor: 'violet' }),
      navhub_home_diy_config_v2: JSON.stringify({ viewMode: 'workbench' }),
    })
    resetHomeDiySharedState()
    hydrateHomeDiy()
    expect(getHomeDiySnapshot().config.viewMode).toBe('workbench')
    // 模拟刷新：共享状态重置后重新 hydrate，老键已删，不会再盖一次
    resetHomeDiySharedState()
    hydrateHomeDiy()
    expect(getHomeDiySnapshot().config.viewMode).toBe('workbench')
    expect(getHomeDiySnapshot().config.accentColor).toBe('violet')
  })

  it('migrateLegacyHomeDiyConfig 直接调：合到传入的 current 上，不动没带的字段', () => {
    const storage: HomeDiyStorage = {
      getItem: (k) => (k === 'navhub_home_diy_config_v2' ? JSON.stringify({ viewMode: 'classic' }) : null),
      setItem: () => {},
      removeItem: () => {},
    }
    const current = { ...DEFAULT_CONFIG, accentColor: 'violet' as const, cardOpacity: 0.95 }
    const merged = migrateLegacyHomeDiyConfig(storage, current)
    expect(merged).not.toBeNull()
    expect(merged?.viewMode).toBe('classic')
    expect(merged?.accentColor).toBe('violet')
    expect(merged?.cardOpacity).toBe(0.95)
  })
})

/* ------------------------------------------------------------------ *
 * W1-3. 远端合并：300ms 内还没落盘的本地改动不能丢
 * （磁盘时钟 + 内存时钟一起参与合并）
 * ------------------------------------------------------------------ */

describe('远端合并：300ms 内还没落盘的本地改动不能丢', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('本地刚改完还没落盘（磁盘时钟仍是旧的），远端同名时钟追平也不能覆盖', () => {
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'violet' }))
    // 还没到 300ms：磁盘上既没有新配置也没有新时钟，但内存时钟已有
    expect(readSlotClocks(STORAGE_CLOCKS_KEY)).toEqual({})
    expect(getEffectiveSlotClocks().accentColor).toBe(1)
    const result = applyRemoteHomeDiyConfig({
      config: { ...DEFAULT_CONFIG, accentColor: 'emerald' },
      clocks: { accentColor: 1 },
    })
    expect(result).toBeNull()
    expect(getHomeDiySnapshot().config.accentColor).toBe('violet')
    // 落盘后磁盘上也是本地这份
    vi.advanceTimersByTime(300)
    expect(storedConfig(browser).accentColor).toBe('violet')
  })

  it('远端时钟更新：本地没改过的插槽照常被远端赢下', () => {
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'violet' }))
    const result = applyRemoteHomeDiyConfig({
      config: { ...DEFAULT_CONFIG, canvasBackground: 'aurora' },
      clocks: { canvasBackground: 5 },
    })
    expect(result?.config.canvasBackground).toBe('aurora')
    expect(getHomeDiySnapshot().config.accentColor).toBe('violet')
  })

  it('getEffectiveSlotClocks：磁盘时钟与内存时钟取各自最大值', () => {
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'violet' }))
    vi.advanceTimersByTime(300)
    expect(readSlotClocks(STORAGE_CLOCKS_KEY).accentColor).toBe(1)
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'emerald' }))
    // 第二次改动还没落盘：磁盘是 1，内存是 2，合并值取 2
    expect(readSlotClocks(STORAGE_CLOCKS_KEY).accentColor).toBe(1)
    expect(getEffectiveSlotClocks().accentColor).toBe(2)
  })
})

/* ------------------------------------------------------------------ *
 * W1-4. 提示按来源登记：后来者不顶掉前一条，落盘成功只清落盘那一路
 * ------------------------------------------------------------------ */

describe('提示按来源登记：后来者不顶掉前一条，落盘成功只清落盘那一路', () => {
  it('损坏提示 + 分享提示同时在：两条都看得见', async () => {
    browser = installBrowser({ [STORAGE_KEY]: '[{"version":3,"viewMode":"classi' })
    resetHomeDiySharedState()
    const location = browser.window.location as { hash: string }
    location.hash =
      '#diy=' + btoa(encodeURIComponent(JSON.stringify({ vm: 'hybrid', co: ['cat-a', 'cat-b', 5] })))
    await hydrateHomeDiy()
    const warning = getHomeDiySnapshot().storageWarning
    expect(warning).toContain('备份到')
    expect(warning).toContain('分享链接待你确认')
    expect(getHomeDiySnapshot().pendingShare).not.toBeNull()
  })

  it('落盘成功只清落盘失败的提示，损坏提示留着', () => {
    browser = installBrowser({ [STORAGE_KEY]: 'broken' })
    resetHomeDiySharedState()
    hydrateHomeDiy()
    const corruptWarning = getHomeDiySnapshot().storageWarning
    expect(corruptWarning).toContain('备份到')
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'violet' }))
    flushHomeDiyDiskWrites()
    expect(getHomeDiySnapshot().storageWarning).toBe(corruptWarning)
    expect(storedConfig(browser).accentColor).toBe('violet')
  })

  it('落盘失败的提示仍会在下一次写成功时清掉（只清 disk 这一路）', () => {
    browser.failWriteWith(quotaError())
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'amber' }))
    flushHomeDiyDiskWrites()
    expect(getHomeDiySnapshot().storageWarning).toContain('本地存储已满')

    browser.failWriteWith(null)
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'rose' }))
    flushHomeDiyDiskWrites()
    expect(getHomeDiySnapshot().storageWarning).toBeNull()
    expect(storedConfig(browser).accentColor).toBe('rose')
  })
})

/* ------------------------------------------------------------------ *
 * W1-6. 分享备份键有上限：新建备份时剪掉更旧的
 * ------------------------------------------------------------------ */

describe('分享备份键有上限：新建备份时剪掉更旧的', () => {
  function makeBackupStorage(count: number): {
    map: Map<string, string>
    storage: HomeDiyStorage
  } {
    const map = new Map<string, string>()
    for (let i = 0; i < count; i++) {
      map.set(
        `${STORAGE_KEY}.share-backup.${1000 + i}`,
        JSON.stringify({ ...DEFAULT_CONFIG, viewMode: 'classic' }),
      )
    }
    return {
      map,
      storage: {
        getItem: (k) => map.get(k) ?? null,
        setItem: (k, v) => {
          map.set(k, v)
        },
        removeItem: (k) => {
          map.delete(k)
        },
        keys: () => [...map.keys()],
      },
    }
  }

  const backupKeys = (map: Map<string, string>) =>
    [...map.keys()].filter((k) => k.startsWith(`${STORAGE_KEY}.share-backup.`))

  it('已有 12 份旧备份：新建一份后只留最新 10 份，最旧的 3 份被剪掉', () => {
    const { map, storage } = makeBackupStorage(12)
    const key = backupHomeDiyShareConfig(storage, DEFAULT_CONFIG)
    expect(key).not.toBeNull()
    const keys = backupKeys(map)
    expect(keys).toHaveLength(DIY_SHARE_BACKUP_MAX_COUNT)
    expect(keys).toContain(key as string)
    expect(map.get(`${STORAGE_KEY}.share-backup.1000`)).toBeUndefined()
    expect(map.get(`${STORAGE_KEY}.share-backup.1001`)).toBeUndefined()
    expect(map.get(`${STORAGE_KEY}.share-backup.1002`)).toBeUndefined()
    expect(map.get(`${STORAGE_KEY}.share-backup.1011`)).toBeDefined()
  })

  it('不到上限时不剪；prune 返回删掉的份数', () => {
    const { map, storage } = makeBackupStorage(3)
    expect(pruneHomeDiyShareBackups(storage)).toBe(0)
    expect(backupKeys(map)).toHaveLength(3)
    const key = backupHomeDiyShareConfig(storage, DEFAULT_CONFIG)
    expect(key).not.toBeNull()
    expect(backupKeys(map)).toHaveLength(4)
  })

  it('没有 keys() 的存储（原生 localStorage 形态）走 length/key(i) 枚举剪枝', () => {
    const initial: Record<string, string> = {}
    for (let i = 0; i < 12; i++) {
      initial[`${STORAGE_KEY}.share-backup.${1000 + i}`] = '{}'
    }
    browser = installBrowser(initial)
    resetHomeDiySharedState()
    const removed = pruneHomeDiyShareBackups(browser.window.localStorage as unknown as HomeDiyStorage)
    expect(removed).toBe(2)
    expect(browser.keys().filter((k) => k.startsWith(`${STORAGE_KEY}.share-backup.`))).toHaveLength(10)
    expect(browser.get(`${STORAGE_KEY}.share-backup.1000`)).toBeNull()
    expect(browser.get(`${STORAGE_KEY}.share-backup.1011`)).toBe('{}')
  })
})
