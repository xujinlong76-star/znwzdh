/**
 * 工作区选择持久化 + `?workspace=` 深链（U-362）。
 *
 * 覆盖：
 *  1. 刷新后仍在：挂载解析优先读 URL 参数，其次 localStorage（模拟"上次选完刷新"），
 *     缺失/非法一律回落默认 'all'；
 *  2. URL 参数读入：`?workspace=dev` 恢复 dev；非法值（`bogus`、空串）回落默认；
 *  3. 切换写 URL：`buildWorkspaceSearch` 在非默认时写参、切回 'all' 时删参，
 *     其它 query 参数原样保留；
 *  4. 非法参数回落：不抛错、不白屏（解析层只返回默认，规范化由组件侧完成）。
 *
 * 存储读写用注入的 fake Storage（vitest 默认 node 环境，无 window/localStorage）；
 * `syncWorkspaceToUrl` 的 history 写盘用桩 window 测（用完恢复全局）。
 * 接线一半（navigation-content 真的在挂载恢复、选择变化时同步）用源码断言锁住，
 * 与 workspace-storage.test.ts 同款做法；真实浏览器行为由 CDP 探针验
 * （见 B2-WORKSPACE-PERSIST/evidence/after-probe.json）。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WORKSPACE_STORAGE_KEY,
  buildWorkspaceSearch,
  isValidWorkspaceId,
  readStoredWorkspace,
  readWorkspaceParam,
  resolveWorkspace,
  syncWorkspaceToUrl,
  writeStoredWorkspace,
  type WorkspaceStorage,
} from '../src/lib/workspace-persist'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const NAV_CONTENT = resolve(ROOT, 'src', 'components', 'navigation-content.tsx')

function fakeStorage(initial: Record<string, string> = {}): { store: Map<string, string>; storage: WorkspaceStorage } {
  const store = new Map(Object.entries(initial))
  return {
    store,
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
    },
  }
}

describe('isValidWorkspaceId：只认 5 个已知 id', () => {
  it.each(['all', 'dev', 'design', 'ai', 'efficiency'])('认 %s', (id) => {
    expect(isValidWorkspaceId(id)).toBe(true)
  })

  it.each(['bogus', '', 'ALL', 'Dev', 'all ', null, undefined, 42, {}, []])('不认 %s', (v) => {
    expect(isValidWorkspaceId(v)).toBe(false)
  })
})

describe('resolveWorkspace：URL 参数 > localStorage > 默认', () => {
  it('URL 参数有效时优先，哪怕 localStorage 里是另一个有效值', () => {
    expect(resolveWorkspace({ param: 'ai', stored: 'dev' })).toBe('ai')
  })

  it('URL 参数缺失时用 localStorage（刷新后仍在：上次选完、这次没带参）', () => {
    expect(resolveWorkspace({ param: null, stored: 'dev' })).toBe('dev')
  })

  it('URL 参数非法时不信任它，回落 localStorage', () => {
    expect(resolveWorkspace({ param: 'bogus', stored: 'design' })).toBe('design')
  })

  it('两边都非法/缺失时回落默认 all，不抛错', () => {
    expect(resolveWorkspace({ param: 'bogus', stored: 'nope' })).toBe('all')
    expect(resolveWorkspace({ param: null, stored: null })).toBe('all')
    expect(resolveWorkspace({ param: '', stored: '' })).toBe('all')
  })
})

describe('readWorkspaceParam：只读 workspace 参', () => {
  it('读到 ?workspace=dev', () => {
    expect(readWorkspaceParam('?workspace=dev')).toBe('dev')
  })

  it('其它参数不干扰，空串与非法串都返回 null', () => {
    expect(readWorkspaceParam('?from=growth_task&workspace=ai')).toBe('ai')
    expect(readWorkspaceParam('')).toBeNull()
    expect(readWorkspaceParam('?q=hello')).toBeNull()
  })
})

describe('buildWorkspaceSearch：切换写参、切回默认删参、其它参数保留', () => {
  it('非默认写参', () => {
    expect(buildWorkspaceSearch('', 'dev')).toBe('?workspace=dev')
    expect(buildWorkspaceSearch('?workspace=all', 'ai')).toBe('?workspace=ai')
  })

  it("切回 'all' 时删参（缺参即默认），不留空 ? ", () => {
    expect(buildWorkspaceSearch('?workspace=dev', 'all')).toBe('')
    expect(buildWorkspaceSearch('?workspace=dev&from=growth_task', 'all')).toBe('?from=growth_task')
  })

  it('其它参数原样保留', () => {
    expect(buildWorkspaceSearch('?from=growth_task&hint=ai', 'design')).toBe(
      '?from=growth_task&hint=ai&workspace=design',
    )
    expect(buildWorkspaceSearch('?workspace=dev&scene=x', 'ai')).toBe('?workspace=ai&scene=x')
  })
})

describe('readStoredWorkspace / writeStoredWorkspace：存储层尽力而为', () => {
  it('写入后读回同一值（刷新后仍在的存储一半）', () => {
    const { store, storage } = fakeStorage()
    writeStoredWorkspace('efficiency', storage)
    expect(store.get(WORKSPACE_STORAGE_KEY)).toBe('efficiency')
    expect(readStoredWorkspace(storage)).toBe('efficiency')
  })

  it('存里是非法值时读回 null（不把脏值当选择）', () => {
    const { storage } = fakeStorage({ [WORKSPACE_STORAGE_KEY]: 'bogus' })
    expect(readStoredWorkspace(storage)).toBeNull()
  })

  it('存储抛错（隐私模式 / 配额耗尽）时读写都不抛', () => {
    const throwing: WorkspaceStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(() => readStoredWorkspace(throwing)).not.toThrow()
    expect(readStoredWorkspace(throwing)).toBeNull()
    expect(() => writeStoredWorkspace('dev', throwing)).not.toThrow()
  })

  it('无存储（SSR / 存储不可用）时读写都不抛', () => {
    expect(readStoredWorkspace(null)).toBeNull()
    expect(() => writeStoredWorkspace('dev', null)).not.toThrow()
  })
})

describe('syncWorkspaceToUrl：replaceState 写参，不动 hash 与其它参数', () => {
  const realWindow = (globalThis as unknown as { window?: unknown }).window
  afterEach(() => {
    if (realWindow === undefined) delete (globalThis as unknown as { window?: unknown }).window
    else (globalThis as unknown as { window?: unknown }).window = realWindow
  })

  function stubWindow(href: string) {
    const calls: string[] = []
    const win = {
      location: new URL(href),
      history: {
        state: null,
        replaceState(_state: unknown, _title: string, url: string) {
          calls.push(url)
          // 像浏览器一样：replaceState 后 location 跟着变
          win.location = new URL(url, href)
        },
      },
    }
    ;(globalThis as unknown as { window?: unknown }).window = win
    return { win, calls }
  }

  it('非默认写参并保留其它参数与 hash', () => {
    const { win, calls } = stubWindow('http://127.0.0.1:18332/?from=growth_task#top')
    syncWorkspaceToUrl('dev')
    expect(calls).toEqual(['/?from=growth_task&workspace=dev#top'])
    expect(win.location.search).toBe('?from=growth_task&workspace=dev')
  })

  it("切回 'all' 时删参", () => {
    const { calls } = stubWindow('http://127.0.0.1:18332/?workspace=dev')
    syncWorkspaceToUrl('all')
    expect(calls).toEqual(['/'])
  })

  it('已是目标值时不写 history（避免无谓 replaceState）', () => {
    const { calls } = stubWindow('http://127.0.0.1:18332/?workspace=ai')
    syncWorkspaceToUrl('ai')
    expect(calls).toEqual([])
  })

  it('history 抛错时不抛给调用方', () => {
    const win = {
      location: new URL('http://127.0.0.1:18332/'),
      history: {
        state: null,
        replaceState() {
          throw new Error('denied')
        },
      },
    }
    ;(globalThis as unknown as { window?: unknown }).window = win
    expect(() => syncWorkspaceToUrl('dev')).not.toThrow()
  })
})

describe('接线：navigation-content 挂载恢复、变化同步', () => {
  const src = readFileSync(NAV_CONTENT, 'utf8')

  it('挂载时读 URL 参数 + localStorage，按优先级解析', () => {
    expect(src).toContain('readWorkspaceParam(window.location.search)')
    expect(src).toContain('readStoredWorkspace()')
    expect(src).toContain('resolveWorkspace({')
  })

  it('初始化把解析结果写回存储与 URL（非法参被规范化、恢复值补进 URL）', () => {
    expect(src).toContain('writeStoredWorkspace(resolved)')
    expect(src).toContain('syncWorkspaceToUrl(resolved)')
  })

  it('恢复只跑一次（did-init 守卫），不被 handleWorkspaceChange 身份变化重触发', () => {
    expect(src).toContain('workspaceInitDoneRef')
    expect(src).toMatch(/if \(workspaceInitDoneRef\.current\) return/)
  })

  it('选择变化时（任何 setActiveWorkspace 路径）写盘 + 同步 URL', () => {
    expect(src).toContain('writeStoredWorkspace(activeWorkspace)')
    expect(src).toContain('syncWorkspaceToUrl(activeWorkspace)')
  })

  it('同步跳过挂载那一轮（避免启动态 all 回写覆盖恢复值）', () => {
    expect(src).toContain('workspaceFirstSyncRef')
  })

  it('用 replaceState，不用 pushState（切换不污染后退历史），且接线走 workspace-persist', () => {
    expect(src).not.toMatch(/history\.pushState\(/)
    expect(src).toContain("from '@/lib/workspace-persist'")
    expect(src).toContain('syncWorkspaceToUrl')
  })
})
