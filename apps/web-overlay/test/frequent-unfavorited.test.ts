/**
 * 「常去却未收藏」——网址管家轻版（2026-11-23 21:22 轮 W3，候选 6）。
 *
 * 与 home-frequent-visits.test.ts 同一测试策略（仓库 vitest 是 node 环境、无 jsdom）：
 *  - 数据半：selectFrequentUnfavoritedVisits 的门槛 / 排除已收藏 / MRU 排序 /
 *    上限 / 脏行跳过直接断言；时间戳用固定旧值（与 home-frequent-visits 同款），
 *    时间分与频率分趋近 0，排序由 count 主导；
 *  - 接线半：/favorites 页的建议区只做源码断言（页面本体太大，renderToString
 *    不现实；与 stale 横幅同款——它也是内联渲染、无独立渲染测试）；
 *  - R13（2026-11-24 00:22 轮 W3）：「不再提示」按站 id 持久化——纯函数半
 *    断言 filterDismissedVisits + serialize→parse 落盘重读后重算仍排除；
 *    接线半断言两处（岛 + /favorites）都读/写同一个 localStorage 键。
 *  - 真浏览器挂载后的行为（IndexedDB 回填、点「收藏」后行消失、360px 视觉）
 *    无法在 node 环境测，缺口如实记在这里，等 E2E/人工验收。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  FREQUENT_UNFAVORITED_DISMISSED_KEY,
  FREQUENT_UNFAVORITED_LIMIT,
  FREQUENT_UNFAVORITED_MIN_USES,
  filterDismissedVisits,
  selectFrequentUnfavoritedVisits,
} from '../src/lib/frequent-unfavorited'
import { addDismissedId, parseDismissedIds, serializeDismissedIds } from '../src/lib/smart-collections'
import { MRU_MIN_USES_FOR_BOOST, type RecentVisit } from '../src/lib/offline-recent'

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

function visit(id: string, title: string, visitedAt: number, count?: number): RecentVisit {
  return {
    id,
    title,
    href: `https://${id}.example.com/`,
    icon: null,
    visitedAt,
    count,
  }
}

/** 固定旧时间戳：时间分与频率分趋近 0，排序只由 count 决定（与 home-frequent-visits 同款）。 */
const MIXED: RecentVisit[] = [
  visit('once-new', '刚误点一次', 9000, 1),
  visit('often-old', '昨天连点十次', 1000, 10),
  visit('twice', '只点两次', 8000, 2),
  visit('mid', '中间站', 5000, 3),
  visit('faved-often', '已收藏的高频站', 2000, 9),
]

describe('selectFrequentUnfavoritedVisits', () => {
  it('门槛与速览坞置顶同一口径：不另写一个 3', () => {
    expect(FREQUENT_UNFAVORITED_MIN_USES).toBe(MRU_MIN_USES_FOR_BOOST)
    expect(FREQUENT_UNFAVORITED_MIN_USES).toBe(3)
  })

  it('默认只露 3 条：轻推，不是清单', () => {
    expect(FREQUENT_UNFAVORITED_LIMIT).toBe(3)
  })

  it('空输入返回 []', () => {
    expect(selectFrequentUnfavoritedVisits([], new Set())).toEqual([])
  })

  it('count < 3 不进榜：误点一次、只点两次的站都不出现', () => {
    const out = selectFrequentUnfavoritedVisits(MIXED, new Set(['faved-often']))
    expect(out.map((v) => v.id)).not.toContain('once-new')
    expect(out.map((v) => v.id)).not.toContain('twice')
  })

  it('已收藏的不进榜：再高频也不重复提醒', () => {
    const out = selectFrequentUnfavoritedVisits(MIXED, new Set(['faved-often']))
    expect(out.map((v) => v.id)).not.toContain('faved-often')
  })

  it('按 MRU 分排序：昨天连点十次排在中间站前面，且只留达标的', () => {
    const out = selectFrequentUnfavoritedVisits(MIXED, new Set(['faved-often']))
    expect(out.map((v) => v.id)).toEqual(['often-old', 'mid'])
  })

  it('上限生效：达标超过 3 条时只留前 3', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      visit(`site-${i}`, `站 ${i}`, 1000 + i, 5 + i),
    )
    expect(selectFrequentUnfavoritedVisits(many, new Set())).toHaveLength(3)
    expect(selectFrequentUnfavoritedVisits(many, new Set(), 2)).toHaveLength(2)
  })

  it('limit 0 返回 []', () => {
    expect(selectFrequentUnfavoritedVisits(MIXED, new Set(), 0)).toEqual([])
  })

  it('count 缺失按 1 计：不进榜；脏行（空 id/标题/链接）跳过', () => {
    const dirty: RecentVisit[] = [
      visit('no-count', '无 count 字段', 1000),
      { id: '', title: '空 id', href: 'https://x.example.com/', icon: null, visitedAt: 1000, count: 9 },
      { id: 'no-title', title: '   ', href: 'https://x.example.com/', icon: null, visitedAt: 1000, count: 9 },
      { id: 'no-href', title: '无链接', href: '  ', icon: null, visitedAt: 1000, count: 9 },
      visit('good', '好站', 1000, 4),
    ]
    expect(selectFrequentUnfavoritedVisits(dirty, new Set()).map((v) => v.id)).toEqual(['good'])
  })

  it('不改输入：不原地排序、不删条目', () => {
    const input = [...MIXED]
    selectFrequentUnfavoritedVisits(input, new Set(['faved-often']))
    expect(input).toEqual(MIXED)
  })
})

describe('R13：不再提示按站 id 持久化（刷新/重挂后已 dismissed 的站不再出现）', () => {
  it('键名照抄 smart-collections 范式：同命名空间、版本号后缀', () => {
    expect(FREQUENT_UNFAVORITED_DISMISSED_KEY).toBe(
      'navhub.favorites.frequent-unfavorited.dismissed.v1',
    )
  })

  it('filterDismissedVisits：只去掉被点的站，其余原样保留', () => {
    const out = filterDismissedVisits(MIXED, ['often-old'])
    expect(out.map((v) => v.id)).toEqual(['once-new', 'twice', 'mid', 'faved-often'])
  })

  it('filterDismissedVisits：空 dismissed 返回拷贝，不改输入', () => {
    const input = [...MIXED]
    expect(filterDismissedVisits(input, [])).toEqual(MIXED)
    expect(input).toEqual(MIXED)
  })

  it('刷新/重挂模拟：dismissed 经 serialize→parse 落盘重读后，该站仍不进榜', () => {
    const persisted = serializeDismissedIds(addDismissedId([], 'often-old'))
    const reloaded = parseDismissedIds(persisted)
    const out = selectFrequentUnfavoritedVisits(
      filterDismissedVisits(MIXED, reloaded),
      new Set(['faved-often']),
    )
    expect(out.map((v) => v.id)).toEqual(['mid'])
  })

  it('不整区永久屏蔽：被点掉的站腾出的名额由下一达标站补上', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      visit(`site-${i}`, `站 ${i}`, 1000 + i, 5 + i),
    )
    const out = selectFrequentUnfavoritedVisits(filterDismissedVisits(many, ['site-4']), new Set())
    expect(out).toHaveLength(3)
    expect(out.map((v) => v.id)).not.toContain('site-4')
    // 若先选榜再过滤，site-4 占掉一个名额后只剩 2 条；先过滤再选榜才补满 3 条
    expect(out.map((v) => v.id)).toContain('site-1')
  })
})

describe('/favorites 建议区接线（源码守卫）', () => {
  const page = readSrc('src/app/favorites/page.tsx')
  it('页面存在且读得到', () => {
    expect(page).not.toBeNull()
  })

  it('频率信号读本机快照，不用无 count 的合并 visits', () => {
    expect(page).toContain('readOfflineVisits(OFFLINE_RECENT_LIMIT)')
    expect(page).toContain('selectFrequentUnfavoritedVisits')
    expect(page).toContain('FREQUENT_UNFAVORITED_LIMIT')
  })

  it('建议区只在有建议时渲染，空态整区不出现', () => {
    expect(page).toContain('unfavoritedFrequent.length > 0 && (')
    expect(page).toContain('aria-label="常去却未收藏"')
  })

  it('一键收藏走现有 favorites.toggle，字段齐全', () => {
    expect(page).toContain('favorites.toggle({')
    expect(page).toContain('siteId: visit.id')
    expect(page).toContain('title: visit.title')
    expect(page).toContain('href: visit.href')
  })

  it('次数如实展示，口径写清是本机记录', () => {
    expect(page).toContain('最近常去 · {visit.count ?? 1} 次')
    expect(page).toContain('按本机记录算')
  })

  it('有点开标题的站外链走 safeHref，点开记一次访问（与首页行同链路）', () => {
    expect(page).toContain('href={safeHref(visit.href)}')
    expect(page).toContain('onClick={() => recordOfflineVisit(visit)}')
  })

  it('有「不再提示」关闭入口，不强求用户收藏', () => {
    expect(page).toContain('不再提示')
    expect(page).toContain('dismissUnfavoritedVisible')
  })

  it('R13：不再提示按站 id 持久化到 localStorage，不是当次会话布尔', () => {
    expect(page).toContain('FREQUENT_UNFAVORITED_DISMISSED_KEY')
    expect(page).toContain('readDismissedFrequentIds()')
    expect(page).toContain('writeDismissedFrequentIds(next)')
    expect(page).toContain('filterDismissedVisits(localVisits, unfavoritedDismissedIds)')
    expect(page).toContain('addDismissedId')
    expect(page).not.toContain('setUnfavoritedDismissed(true)')
    expect(page).not.toContain('const [unfavoritedDismissed, setUnfavoritedDismissed]')
  })

  it('不新增数据源、不碰红线：建议区不调任何 /api，不提 17K/书旗', () => {
    const start = page!.indexOf('aria-label="常去却未收藏"')
    const end = page!.indexOf('待读分流：结算写已移出区失败时', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const section = page!.slice(start, end)
    expect(section).not.toContain('/api/')
    expect(section).not.toContain('17K')
    expect(section).not.toContain('书旗')
  })
})
