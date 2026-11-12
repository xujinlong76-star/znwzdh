/**
 * M1：跨标签页合并 toast 永远弹不出来 —— 裸订阅先跑，把通知吞掉了。
 *
 * 根因（共享通道按订阅插入顺序扇出，见 use-home-diy-grid.ts 顶部的
 * subscribeSharedLayoutSyncChannel）：useHomeDiyGrid 曾另订一份裸
 * applyRemoteHomeDiyConfig，而它调用的 useHomeDIY() 要等 mounted=true
 * 才订带通知的 applyRemoteConfig（use-home-diy.ts 3.2）。挂载顺序上裸处理
 * 永远先插进处理集；一条远端消息进来，裸处理先跑 LWW 合并，合并本身正确，
 * 但后到的 applyRemoteConfig 再调 applyRemoteHomeDiyConfig 时
 * merged.changed 已是 false、返回 null，notifyLayoutSyncMerge 永远调不到。
 *
 * 修复：远端接收只剩唯一订阅（use-home-diy.ts 的 applyRemoteConfig），
 * use-home-diy-grid.ts 不再订阅，只管广播。本文件三层钉住它：
 *   1. 源码守则：grid 文件里没有任何订阅调用，hook 文件里恰好一处订阅；
 *   2. 行为（修复后的接线）：只订 applyRemoteConfig，走共享通道收一条远端
 *      消息，合并生效且通知订阅者（toast 的上游）被调到；
 *   3. 旧接线复现：裸处理先订、再订 applyRemoteConfig，合并仍生效但通知
 *      一次也不发 —— 证明顺序就是根因，裸订阅回来 bug 就回来。
 *
 * 注意：仓库的 vitest 是 node 环境、没有 jsdom / @testing-library/react，
 * 挂载 hook 本体跑不出 useEffect；applyRemoteConfig 在这里是按
 * use-home-diy.ts 3.1 逐行照抄的本地复刻（同一份 applyRemoteHomeDiyConfig
 * + getEffectiveSlotClocks + notifyLayoutSyncMerge），它的本体由
 * home-diy-store.test.ts 的「W2：跨 Tab 合并只在落盘成功后才通知」守则
 * 钉住（result.ok 把门、读有效时钟），本文件的源码守则再钉住「它是唯一
 * 的订阅者」——两者合起来才等价于「生产接线下通知会发」。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CONFIG,
  applyRemoteHomeDiyConfig,
  getEffectiveSlotClocks,
  getHomeDiySnapshot,
  resetHomeDiySharedState,
  type HomeDIYConfig,
} from '@/lib/modular/use-home-diy'
import { subscribeSharedLayoutSyncChannel } from '@/lib/modular/use-home-diy-grid'
import {
  notifyLayoutSyncMerge,
  subscribeLayoutSyncEvents,
} from '@/lib/modular/layout-sync-events'
import type { LayoutSlotClocks } from '@/lib/modular/layout-sync'

/* ------------------------------------------------------------------ *
 * 源码定位：与 home-diy-store.test.ts 同款（镜像跑时也要读到 overlay）
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

/* ------------------------------------------------------------------ *
 * 假的浏览器环境 + 假的 BroadcastChannel（与 home-diy-store.test.ts 同款）
 * ------------------------------------------------------------------ */

function installBrowser(): void {
  const store = new Map<string, string>()
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
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
    // getLayoutClientId 只读 getItem / 写 setItem，读不到就随机生成一个 id
    sessionStorage: { getItem: () => null, setItem: () => {} },
    dispatchEvent: () => true,
    location: { hash: '', pathname: '/', search: '' },
    history: { replaceState: () => {} },
  }
  ;(globalThis as unknown as { window: unknown }).window = window
}

function uninstallBrowser() {
  delete (globalThis as unknown as { window?: unknown }).window
}

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

let prevBroadcastChannel: unknown

function installFakeBroadcastChannel() {
  const g = globalThis as unknown as Record<string, unknown>
  prevBroadcastChannel = g.BroadcastChannel
  g.BroadcastChannel = FakeBroadcastChannel
  FakeBroadcastChannel.instances = []
  FakeBroadcastChannel.closed = 0
}

function uninstallFakeBroadcastChannel() {
  const g = globalThis as unknown as Record<string, unknown>
  if (prevBroadcastChannel === undefined) delete g.BroadcastChannel
  else g.BroadcastChannel = prevBroadcastChannel
}

/**
 * use-home-diy.ts 3.1 的 applyRemoteConfig，逐行照抄（见文件头注释）：
 * 合并、落盘、更新共享状态都在 applyRemoteHomeDiyConfig 里做，只在合并
 * 确实落盘（result.ok）后才通知。
 */
function applyRemoteConfig(payload: { config: HomeDIYConfig; clocks: LayoutSlotClocks }) {
  const before = getHomeDiySnapshot().config
  const beforeClocks = getEffectiveSlotClocks()
  const result = applyRemoteHomeDiyConfig(payload)
  if (result && result.ok) {
    notifyLayoutSyncMerge({ before, after: result.config, remote: payload.config, beforeClocks })
  }
}

/** 另一标签页发来的改动：viewMode 从默认 hybrid 改成 classic，时钟更新 */
function remotePayload() {
  return {
    config: { ...DEFAULT_CONFIG, viewMode: 'classic' as const, updatedAt: 2 },
    clocks: { viewMode: 2 },
  }
}

/** 经共享通道投递一条远端消息（clientId 不是自己，不会被回声过滤吃掉） */
function deliverRemote() {
  expect(FakeBroadcastChannel.instances).toHaveLength(1)
  FakeBroadcastChannel.instances[0]!.deliver({ clientId: 'other-tab', ...remotePayload() })
}

const cleanups: Array<() => void> = []

beforeEach(() => {
  resetHomeDiySharedState()
  installBrowser()
  installFakeBroadcastChannel()
})

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
  resetHomeDiySharedState()
  uninstallFakeBroadcastChannel()
  uninstallBrowser()
})

describe('M1：远端接收只剩唯一订阅（use-home-diy.ts 的 applyRemoteConfig）', () => {
  it('接线守则：grid 不再订阅裸处理，hook 恰好订一次 applyRemoteConfig', () => {
    const grid = readSrc('src/lib/modular/use-home-diy-grid.ts')
    const hook = readSrc('src/lib/modular/use-home-diy.ts')
    const events = readSrc('src/lib/modular/layout-sync-events.ts')
    // 旧代码的死因：这两行让裸处理先插进共享处理集，先跑合并、吞掉通知
    expect(grid).not.toContain('subscribeSharedLayoutSyncChannel(applyRemoteHomeDiyConfig)')
    expect(grid).not.toContain('return subscribeSharedLayoutSyncChannel(')
    // 远端接收仍在：grid 调 useHomeDIY()，挂载后由它订上唯一订阅
    expect(grid).toContain('useHomeDIY()')
    expect(hook.match(/subscribeSharedLayoutSyncChannel\(applyRemoteConfig\)/g)?.length).toBe(1)
    // 接线注释也要说清单订阅是刻意的，不许后人「补」一个裸订阅回来
    expect(events).toContain('单订阅是刻意的')
  })

  it('单订阅：走共享通道收远端改动，合并生效且通知订阅者', () => {
    const listener = vi.fn()
    cleanups.push(subscribeLayoutSyncEvents(listener))
    cleanups.push(subscribeSharedLayoutSyncChannel(applyRemoteConfig))

    deliverRemote()

    expect(getHomeDiySnapshot().config.viewMode).toBe('classic')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]![0].remoteWon).toContain('viewMode')
    expect(listener.mock.calls[0]![0].changedSlots).toContain('viewMode')
  })

  it('旧接线复现：裸处理先订，合并仍生效但通知一次也不发', () => {
    const listener = vi.fn()
    cleanups.push(subscribeLayoutSyncEvents(listener))
    // 旧生产顺序：grid 的裸订阅（useEffect，无 mounted 门）先插进处理集，
    // use-home-diy 的 applyRemoteConfig（mounted 后）后插进来
    cleanups.push(subscribeSharedLayoutSyncChannel(applyRemoteHomeDiyConfig))
    cleanups.push(subscribeSharedLayoutSyncChannel(applyRemoteConfig))

    deliverRemote()

    // 合并本身没错：这正是 M1 难查的原因 —— 状态对了，只是没人告诉用户
    expect(getHomeDiySnapshot().config.viewMode).toBe('classic')
    expect(listener).not.toHaveBeenCalled()
  })
})
