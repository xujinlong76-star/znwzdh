/**
 * HomeQuickDock 默认 tab（D-W3-Tier1，选项 ii 钉选优先）+ 最近 tab 相对时间 meta。
 *
 * 仓库 vitest 是 node 环境、无 jsdom：组件无法挂载，effect 不跑。
 * 因此规则拆成纯函数单测 + SSR 首帧断言 + 源码接线守卫：
 *  - 纯函数半：resolveDefaultDockTab / recentVisitMeta 直接单测；
 *  - SSR 半：renderToString 首帧仍是「极速置顶」选中（自动切「最近」只发生在
 *    客户端回填后，不污染 SSR/首帧）；空站表仍渲染为空串；
 *  - 守卫半：默认 tab effect 只做一次、手动切 tab 后不再覆盖、最近分支用
 *    recentVisitMeta、数字角标只在极速置顶分支、三 tab 顺序固定。
 * 真浏览器挂载后的行为（回填后 tab 自动切到「最近」、首屏无闪跳、focus 回填
 * 不中途翻 tab）无法在 node 环境测，缺口如实记在这里，等 E2E/人工验收。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  HomeQuickDock,
  recentVisitMeta,
  resolveDefaultDockTab,
} from '../src/components/home-quick-dock'
import { formatRelativeTime } from '../src/lib/format-relative-time'
import type { DialSite } from '../src/lib/number-dial'
import type { RecentVisit } from '../src/lib/offline-recent'

const HERE = dirname(fileURLToPath(import.meta.url))
const DOCK_SRC = readFileSync(join(HERE, '..', 'src', 'components', 'home-quick-dock.tsx'), 'utf8')

const NOW = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function visit(id: string, visitedAt: number): RecentVisit {
  return { id, title: id, href: `https://${id}.example.com/`, icon: null, visitedAt, count: 1 }
}

function site(id: string): DialSite {
  return { id, title: `${id}站`, href: `https://${id}.example.com/`, icon: null }
}

describe('默认 tab 规则（选项 ii 钉选优先）：只有无钉选回访用户才默认「最近」', () => {
  it('无钉选 + 有最近访问 → recent', () => {
    expect(resolveDefaultDockTab(0, 1)).toBe('recent')
    expect(resolveDefaultDockTab(0, 9)).toBe('recent')
  })

  it('钉选过 → speed（首屏不变，显式选择不被覆盖）', () => {
    expect(resolveDefaultDockTab(1, 9)).toBe('speed')
    expect(resolveDefaultDockTab(9, 9)).toBe('speed')
  })

  it('无最近访问 → speed（新用户首屏不受影响）', () => {
    expect(resolveDefaultDockTab(0, 0)).toBe('speed')
    expect(resolveDefaultDockTab(3, 0)).toBe('speed')
  })
})

describe('最近 tab meta：合法时间给相对时间，非法值留空（不渲染“—”或 1970 年）', () => {
  it('合法 visitedAt → 相对时间', () => {
    expect(recentVisitMeta(visit('a', NOW - 30_000))).toBe('刚刚')
    expect(recentVisitMeta(visit('a', NOW - 5 * MIN))).toBe('5分钟前')
    expect(recentVisitMeta(visit('a', NOW - 2 * HOUR))).toBe('2小时前')
    expect(recentVisitMeta(visit('a', NOW - 3 * DAY))).toBe('3天前')
  })

  it('非法 visitedAt → undefined（脏数据不进 meta）', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity, 0, -1000]) {
      expect(recentVisitMeta(visit('a', bad)), `visitedAt=${bad}`).toBeUndefined()
    }
    expect(recentVisitMeta({ ...visit('a', NOW), visitedAt: null as unknown as number })).toBeUndefined()
    expect(recentVisitMeta({ ...visit('a', NOW), visitedAt: undefined as unknown as number })).toBeUndefined()
  })

  it('formatRelativeTime 本身：0 / 负数返回“—”，合法值不受影响', () => {
    expect(formatRelativeTime(0, NOW)).toBe('—')
    expect(formatRelativeTime(-1, NOW)).toBe('—')
    expect(formatRelativeTime(null, NOW)).toBe('—')
    expect(formatRelativeTime(NOW - 3 * DAY, NOW)).toBe('3天前')
  })
})

describe('SSR 半：首帧仍默认「极速置顶」，空站表仍为空串', () => {
  it('有站表 → 首帧只有「极速置顶」被选中', () => {
    const html = renderToString(
      createElement(HomeQuickDock, {
        // P2-14（main 线）：速拨顺序由父级算好经 speedSites 透传；测试按新契约传参。
        // U-358：allSites/activeWorkspace 已从 HomeQuickDockProps 删除（坞内从未使用）。
        speedSites: [site('site-a'), site('site-b'), site('site-c')],
      }),
    )
    expect(html).toContain('id="quick-access-tray"')
    expect(html).toContain('极速置顶')
    expect(html.match(/aria-selected="true"/g)?.length).toBe(1)
    expect(html.indexOf('aria-selected="true"')).toBeLessThan(html.indexOf('极速置顶'))
    for (const s of ['site-a', 'site-b', 'site-c']) expect(html).toContain(`${s}站`)
  })

  it('空站表 → 渲染为空串（整坞不存在）', () => {
    const html = renderToString(
      createElement(HomeQuickDock, { speedSites: [] }),
    )
    expect(html).toBe('')
  })
})

describe('接线守卫：默认 tab 只做一次、手动选择不被覆盖、角标不越 tab', () => {
  it('默认 tab 用规则函数算，且只在首次回填后决定一次', () => {
    expect(DOCK_SRC).toContain('useState<DockTab>(\'speed\')')
    expect(DOCK_SRC).toContain('resolveDefaultDockTab(speedDialPinnedIds.length, recentVisits.length)')
    expect(DOCK_SRC).toContain('if (!mounted || !recentLoaded || defaultTabAppliedRef.current) return')
    expect(DOCK_SRC).toContain('defaultTabAppliedRef.current = true')
    expect(DOCK_SRC).toContain('[mounted, recentLoaded, recentVisits, speedDialPinnedIds]')
    expect(DOCK_SRC).toContain('setRecentLoaded(true)')
  })

  it('手动切 tab 记下来：三个按钮都走 chooseTab，不再直接 setActiveTab', () => {
    expect(DOCK_SRC).toContain("onClick={() => chooseTab('speed')}")
    expect(DOCK_SRC).toContain("onClick={() => chooseTab('frequent')}")
    expect(DOCK_SRC).toContain("onClick={() => chooseTab('recent')}")
    expect(DOCK_SRC).toContain('userChoseTabRef.current = true')
    expect(DOCK_SRC).toContain('if (userChoseTabRef.current) return')
    // setActiveTab( 只剩两处：chooseTab 内 + 默认 tab effect 内，不再有直接写死 tab 的调用
    expect(DOCK_SRC.match(/setActiveTab\(/g)?.length).toBe(2)
    expect(DOCK_SRC).not.toContain("setActiveTab('speed')")
  })

  it('最近分支 meta 走 recentVisitMeta；数字角标只在极速置顶分支', () => {
    expect(DOCK_SRC).toContain('meta: recentVisitMeta(v)')
    expect(DOCK_SRC).toContain('digit: dialDigitById?.get(s.id)')
    expect(DOCK_SRC.match(/digit: undefined as number \| string \| undefined/g)?.length).toBe(2)
  })

  it('三 tab 顺序固定：极速置顶 / 常用 / 最近', () => {
    const speedAt = DOCK_SRC.indexOf("aria-selected={activeTab === 'speed'}")
    const frequentAt = DOCK_SRC.indexOf("aria-selected={activeTab === 'frequent'}")
    const recentAt = DOCK_SRC.indexOf("aria-selected={activeTab === 'recent'}")
    expect(speedAt).toBeGreaterThan(0)
    expect(speedAt).toBeLessThan(frequentAt)
    expect(frequentAt).toBeLessThan(recentAt)
  })
})
