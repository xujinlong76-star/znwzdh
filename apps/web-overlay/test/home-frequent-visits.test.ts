/**
 * 首页「我的常用」行（纯频次展示，最小切片）。
 *
 * 与 home-recent-visits.test.ts 同一测试策略（仓库 vitest 是 node 环境、无 jsdom）：
 *  - 数据半：topFrequentVisits 的频次语义（旧而高频胜过新而只点一次）直接断言；
 *    纯函数本体另有 offline-recent.test.ts 的 topFrequentVisits 专节覆盖；
 *  - 渲染半：FrequentVisitsRow 给 topFrequentVisits 排好的 6 条 → 行里 6 项都在、
 *    顺序即频次顺序，不多不少（不补推荐、不补兜底）；给空清单 → 渲染为空串；
 *  - SSR 半：renderToString(<HomeFrequentVisits />) 为空串；
 *  - 接线守卫：navigation-content 在 <HomeRecentVisits /> 之后、分类网格之前
 *    挂了该行；容器读全量快照再排频次（不是只读最近 6 条）；源码无 speedDial、
 *    无 QuickAccessTray；点击走记快照 + 上报的老链路；
 *    布局守卫：360px 两列（grid-cols-2）、触点 min-h-11（44px）。
 *
 * 真浏览器挂载后的行为与 360px 真机视觉（溢出、深色可读）无法在 node 环境测，
 * 缺口如实记在这里，等 E2E/人工验收。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  HomeFrequentVisits,
  FrequentVisitsRow,
  FREQUENT_VISITS_COUNT,
} from '../src/components/home-frequent-visits'
import { topFrequentVisits, type RecentVisit } from '../src/lib/offline-recent'

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

function visit(id: string, title: string, visitedAt: number, count = 1): RecentVisit {
  return {
    id,
    title,
    href: `https://${id}.example.com/`,
    icon: null,
    visitedAt,
    count,
  }
}

/** 昨天连点 10 次的站 vs 刚才误点 1 次的站：频次行必须排前者。 */
const MIXED: RecentVisit[] = [
  visit('once-new', '刚误点一次', 9000, 1),
  visit('often-old', '昨天连点十次', 1000, 10),
  visit('mid', '中间站', 5000, 3),
  visit('tie-new', '同频次较新', 8000, 3),
  visit('tie-old', '同频次较旧', 2000, 3),
  visit('rare', '只点两次', 7000, 2),
  visit('seventh', '第七名', 6000, 1),
]

describe('数据半：纯频次排序，旧而高频胜过新而只点一次', () => {
  it('topFrequentVisits(list, 6)：次数降序，同频次按最近访问，取前 6', () => {
    expect(FREQUENT_VISITS_COUNT).toBe(6)
    const top = topFrequentVisits(MIXED, FREQUENT_VISITS_COUNT)
    expect(top.map((v) => v.id)).toEqual([
      'often-old',
      'tie-new',
      'mid',
      'tie-old',
      'rare',
      'once-new',
    ])
    // 第 7 名（只点 1 次、旧）被截掉，不进这一行
    expect(top.map((v) => v.id)).not.toContain('seventh')
  })

  it('缺 count 的旧数据按 1 计，不丢弃', () => {
    const list = [visit('a', '甲', 1), visit('b', '乙', 2, 2)]
    const { count: _a, ...noCount } = list[0]
    void _a
    expect(topFrequentVisits([noCount, list[1]]).map((v) => v.id)).toEqual(['b', 'a'])
  })
})

describe('渲染半：FrequentVisitsRow 只渲染传入的频次 Top 6，不多不少', () => {
  it('6 条频次访问 → 行里 6 项都在且顺序即频次顺序：标题、链接、角标', () => {
    const top = topFrequentVisits(MIXED, FREQUENT_VISITS_COUNT)
    const html = renderToString(createElement(FrequentVisitsRow, { visits: top }))
    expect(html).toContain('我的常用')
    expect(html).toContain('仅保存在本机')
    // 顺序即频次顺序：高频站在 HTML 里先出现
    const positions = top.map((v) => html.indexOf(v.title))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    for (const v of top) {
      expect(html, `缺 ${v.title}`).toContain(v.title)
      expect(html, `缺 ${v.href}`).toContain(`href="${v.href}"`)
    }
    // 6 个站只有 6 条外链：没有推荐、没有兜底混入
    expect(html.match(/<a /g)?.length).toBe(6)
    expect(html).toContain('target="_blank"')
    expect(html).not.toContain('推荐')
    expect(html).toContain('6<!-- --> 个站点')
  })

  it('空清单 → 渲染为空串，整行不存在（不留“你还没逛过”占位）', () => {
    const html = renderToString(createElement(FrequentVisitsRow, { visits: [] }))
    expect(html).toBe('')
    expect(html).not.toContain('我的常用')
    expect(html).not.toContain('你还没逛过')
  })
})

describe('SSR 半：容器首帧不渲染该行（无 hydration 风险）', () => {
  it('renderToString(<HomeFrequentVisits />) 为空串：effect 在 SSR 不执行', () => {
    const html = renderToString(createElement(HomeFrequentVisits))
    expect(html).toBe('')
    expect(html).not.toContain('我的常用')
  })
})

describe('接线守卫：首页在最近访问行之后、分类网格之前挂了该行', () => {
  it('navigation-content 通过三合一 HomeQuickDock（含 topFrequentVisits）在分类网格之前呈现常用直达', () => {
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
    expect(dockSrc).toContain('topFrequentVisits(recentVisits')
  })

  it('容器读全量快照再按频次取前 6：不只读最近 6 条', () => {
    const src = readSrc('src/components/home-frequent-visits.tsx')
    expect(src, 'home-frequent-visits.tsx 读不到').not.toBeNull()
    expect(src).toContain('useEffect(() => {')
    expect(src).toContain('readOfflineVisits(OFFLINE_RECENT_LIMIT)')
    expect(src).toContain('topFrequentVisits(list, FREQUENT_VISITS_COUNT)')
    expect(src).toContain('setVisits(topFrequentVisits(list, FREQUENT_VISITS_COUNT))')
    // 空清单直接返回 null，不渲染占位
    expect(src).toContain('if (visits.length === 0) return null')
    expect(src).not.toContain('你还没逛过')
  })

  it('不读 speedDial、不碰 QuickAccessTray：数据源只有本机快照', () => {
    const src = readSrc('src/components/home-frequent-visits.tsx')
    expect(src, 'home-frequent-visits.tsx 读不到').not.toBeNull()
    expect(src).not.toContain('speedDial')
    expect(src).not.toContain('SpeedDial')
    expect(src).not.toContain('QuickAccessTray')
    expect(src).toContain("from '@/lib/offline-recent'")
    // 角标与行标题在源码里
    expect(src).toContain('仅保存在本机')
    expect(src).toContain('我的常用')
  })

  it('点击走现有链路：记快照 + 上报点击，与导航卡片同一路', () => {
    const src = readSrc('src/components/home-frequent-visits.tsx')
    expect(src, 'home-frequent-visits.tsx 读不到').not.toBeNull()
    expect(src).toContain('recordOfflineVisit(visit)')
    expect(src).toContain('reportClick(visit.id, getIdentity())')
  })

  it('布局：360px 两列、触点 ≥44px（min-h-11）、标题截断防溢出', () => {
    const src = readSrc('src/components/home-frequent-visits.tsx')
    expect(src, 'home-frequent-visits.tsx 读不到').not.toBeNull()
    // 360px < sm(640px) 断点 → grid-cols-2 生效，两列
    expect(src).toContain('grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6')
    // min-h-11 = 44px 触点；truncate 防长标题横向溢出
    expect(src).toContain('min-h-11')
    expect(src).toContain('truncate')
  })
})
