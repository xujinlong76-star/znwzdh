/**
 * 首页「最近访问」行（升级第 5 条：回访用户一键直达昨天去过的站）。
 *
 * 仓库 vitest 是 node 环境、无 jsdom：组件无法挂载，effect 不跑。
 * 因此「挂载后读本机 → 行渲染」拆成三半断言，外加接线守卫：
 *  - 数据半：localStorage 预置 6 条访问（LS 替身走非 IndexedDB 分支，
 *    node 环境没有 indexedDB），readOfflineVisits(6) 返回 6 条且新在前；
 *  - 渲染半：RecentVisitsRow 给 6 条 → 行里 6 项都在（标题、链接、
 *    favicon 占位）；给空清单 → 渲染为空串（整行不存在）；
 *  - SSR 半：renderToString(<HomeRecentVisits />) 为空串——effect 在 SSR
 *    不执行，首屏 HTML 里没有该行，也就不会 hydration 不一致。
 * 另有源码守卫：navigation-content 真的在 hero 与分类网格之间挂了该行，
 * 且 HomeRecentVisits 在 useEffect 里读 readOfflineVisits(6)；点击一路
 * 记快照 + 上报（与导航卡片、搜索面板同一路）。
 *
 * 真浏览器挂载后的行为（effect 跑起来、行出现、点卡片刷新快照）无法在
 * node 环境测，缺口如实记在这里，等 E2E/人工验收。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi, afterAll } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  HomeRecentVisits,
  RecentVisitsRow,
  RECENT_VISITS_COUNT,
} from '../src/components/home-recent-visits'
import { readOfflineVisits, type RecentVisit } from '../src/lib/offline-recent'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = join(HERE, '..')
const OVERLAY_ROOT = join(HERE, '..', '..', 'apps', 'web-overlay')
const readSrc = (rel: string): string | null => {
  for (const root of [WEB_ROOT, OVERLAY_ROOT]) {
    try {
      return readFileSync(join(root, rel), 'utf8')
    } catch {
      // 镜像与 overlay 双份并存时优先读镜像
    }
  }
  return null
}

function visit(id: string, title: string, visitedAt: number): RecentVisit {
  return {
    id,
    title,
    href: `https://${id}.example.com/`,
    icon: null,
    visitedAt,
    count: 1,
  }
}

/** localStorage 替身（offline-recent.test.ts 同款）：走非 IndexedDB 分支。 */
function stubLocalStorage(seed: Map<string, string>) {
  const store = {
    get length() {
      return seed.size
    },
    key: (i: number) => [...seed.keys()][i] ?? null,
    getItem: (k: string) => (seed.has(k) ? seed.get(k)! : null),
    setItem: (k: string, v: string) => {
      seed.set(k, v)
    },
    removeItem: (k: string) => {
      seed.delete(k)
    },
  }
  vi.stubGlobal('localStorage', store)
}

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock 与 process.env 改写，这里统一清掉。
afterAll(() => {
  vi.resetModules()
})

const SIX: RecentVisit[] = [
  visit('site-f', '第六站', 6000),
  visit('site-a', '第一站', 1000),
  visit('site-d', '第四站', 4000),
  visit('site-b', '第二站', 2000),
  visit('site-e', '第五站', 5000),
  visit('site-c', '第三站', 3000),
]

describe('数据半：localStorage 预置 6 条访问能读出来（新在前）', () => {
  it('readOfflineVisits(6) 返回 6 条，按 visitedAt 降序', async () => {
    const seed = new Map<string, string>([
      ['navhub:recent-offline:v1', JSON.stringify(SIX)],
    ])
    stubLocalStorage(seed)
    try {
      expect(RECENT_VISITS_COUNT).toBe(6)
      const list = await readOfflineVisits(6)
      expect(list).toHaveLength(6)
      // 存储里故意打乱顺序，读出来必须新在前
      expect(list.map((v) => v.id)).toEqual([
        'site-f',
        'site-e',
        'site-d',
        'site-c',
        'site-b',
        'site-a',
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('空 localStorage → 读出空清单（行不渲染的数据前提）', async () => {
    stubLocalStorage(new Map())
    try {
      await expect(readOfflineVisits(6)).resolves.toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('渲染半：RecentVisitsRow 给 6 条就全在，给空就整行不存在', () => {
  it('6 条访问 → 行里 6 项都在：标题、链接、最近访问标题', () => {
    const html = renderToString(createElement(RecentVisitsRow, { visits: SIX }))
    expect(html).toContain('最近访问')
    expect(html).toContain('仅保存在本机')
    for (const v of SIX) {
      expect(html, `缺 ${v.title}`).toContain(v.title)
      expect(html, `缺 ${v.href}`).toContain(`href="${v.href}"`)
    }
    // 6 个站只有 6 条外链，不多不少
    expect(html.match(/<a /g)?.length).toBe(6)
    expect(html).toContain('target="_blank"')
    // React SSR 在表达式与文本之间插 <!-- -->：`6<!-- --> 个站点`
    expect(html).toContain('6<!-- --> 个站点')
  })

  it('空清单 → 渲染为空串，整行不存在（不留“你还没逛过”占位）', () => {
    const html = renderToString(createElement(RecentVisitsRow, { visits: [] }))
    expect(html).toBe('')
    expect(html).not.toContain('最近访问')
    expect(html).not.toContain('你还没逛过')
  })
})

describe('SSR 半：容器首帧不渲染该行（无 hydration 风险）', () => {
  it('renderToString(<HomeRecentVisits />) 为空串：effect 在 SSR 不执行', () => {
    const html = renderToString(createElement(HomeRecentVisits))
    expect(html).toBe('')
    expect(html).not.toContain('最近访问')
  })
})

describe('接线守卫：首页真的在 hero 与分类网格之间挂了该行', () => {
  it('navigation-content 通过三合一 HomeQuickDock 在合并胶囊行内（工作台分支之前）、分类网格之前呈现最近访问', () => {
    const src = readSrc('src/components/navigation-content.tsx')
    const dockSrc = readSrc('src/components/home-quick-dock.tsx')
    expect(src, 'navigation-content.tsx 读不到').not.toBeNull()
    expect(dockSrc, 'home-quick-dock.tsx 读不到').not.toBeNull()
    expect(src).toContain(
      "import { HomeQuickDock } from '@/components/home-quick-dock'",
    )
    expect(src).toContain('<HomeQuickDock')
    const rowAt = src!.indexOf('<HomeQuickDock')
    const dockAt = src!.indexOf('mod:speed-dial')
    const gridAt = src!.indexOf('<DiyGridDragBoundary')
    expect(rowAt).toBeGreaterThan(dockAt)
    expect(rowAt).toBeLessThan(gridAt)
    // 29489f4c 首屏瘦身：HomeQuickDock 随运营胶囊行内联进 HomeCapsuleRow 所在的
    // 合并行（1536px+ 与胶囊行并排一行），位于 viewMode === 'workbench' 分支之前、
    // 分类网格之前；props 与 mod:speed-dial 条件不变，功能未删。
    const workbenchAt = src!.indexOf("viewMode === 'workbench'")
    expect(rowAt).toBeLessThan(workbenchAt)
    expect(dockSrc).toContain('readOfflineVisits(OFFLINE_RECENT_LIMIT)')
  })

  it('容器在 useEffect 里读 readOfflineVisits(6)，取数后才 setState', () => {
    const src = readSrc('src/components/home-recent-visits.tsx')
    expect(src, 'home-recent-visits.tsx 读不到').not.toBeNull()
    expect(src).toContain('useEffect(() => {')
    expect(src).toContain('readOfflineVisits(RECENT_VISITS_COUNT)')
    expect(src).toContain('setVisits(list)')
    // 空清单直接返回 null，不渲染占位
    expect(src).toContain('if (visits.length === 0) return null')
    expect(src).not.toContain('你还没逛过')
  })

  it('点击走现有链路：记快照 + 上报点击，与导航卡片同一路', () => {
    const src = readSrc('src/components/home-recent-visits.tsx')
    expect(src, 'home-recent-visits.tsx 读不到').not.toBeNull()
    expect(src).toContain('recordOfflineVisit(visit)')
    expect(src).toContain('reportClick(visit.id, getIdentity())')
  })
})
