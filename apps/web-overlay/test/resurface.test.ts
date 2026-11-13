/**
 * 「今日重温」红线测试：选择逻辑、徽标规则、归档，以及接线守卫。
 *
 * 全部用注入的固定时钟（NOW），不读真实日期：同一份输入在任何一天跑
 * 都必须得到同一份输出。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  RESURFACE_DAILY_LIMIT,
  STALE_THRESHOLD_DAYS,
  describeResurfaced,
  describeStale,
  daysSinceOpen,
  isStale,
  latestVisitsById,
  resolveLastOpened,
  selectDailyResurface,
  selectStaleFavorites,
  staleBadgeLabel,
  type ResurfaceFavoriteLike,
} from '../src/lib/resurface'
import {
  archiveItems,
  parseArchived,
  serializeArchived,
  unarchiveItems,
  type ArchivedFavoriteItem,
} from '../src/lib/favorites-archive'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

/** 固定时钟：2026-11-12 12:00 UTC */
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0)

function fav(
  siteId: string,
  createdDaysAgo: number,
  lastOpenedDaysAgo?: number,
): ResurfaceFavoriteLike {
  return {
    siteId,
    title: `站点 ${siteId}`,
    href: `https://example.com/${siteId}`,
    createdAt: NOW - createdDaysAgo * DAY_MS,
    ...(lastOpenedDaysAgo === undefined ? {} : { lastOpenedAt: NOW - lastOpenedDaysAgo * DAY_MS }),
  }
}

describe('stale 阈值：90 天', () => {
  it('正好 90 天不算旧，第 91 天才算（严格大于）', () => {
    const visits = latestVisitsById([])
    expect(isStale(fav('a', 200, 90), visits, NOW)).toBe(false)
    expect(isStale(fav('b', 200, 91), visits, NOW)).toBe(true)
    expect(STALE_THRESHOLD_DAYS).toBe(90)
  })

  it('从未记录到打开：按收藏当天算天数', () => {
    const visits = latestVisitsById([])
    const old = fav('old', 100)
    expect(daysSinceOpen(old, visits, NOW)).toBe(100)
    expect(isStale(old, visits, NOW)).toBe(true)
    expect(resolveLastOpened(old, visits, NOW)).toBeNull()
    const fresh = fav('fresh', 10)
    expect(daysSinceOpen(fresh, visits, NOW)).toBe(10)
    expect(isStale(fresh, visits, NOW)).toBe(false)
  })
})

describe('上次打开的解析：两处记录取较新者', () => {
  it('最近访问能救回一条旧收藏（只按收藏时间算会误判）', () => {
    const visits = latestVisitsById([{ id: 'a', visitedAt: NOW - 5 * DAY_MS }])
    expect(isStale(fav('a', 200), visits, NOW)).toBe(false)
    expect(resolveLastOpened(fav('a', 200), visits, NOW)).toBe(NOW - 5 * DAY_MS)
  })

  it('lastOpenedAt 与最近访问取较新的一方', () => {
    const visits = latestVisitsById([{ id: 'a', visitedAt: NOW - 100 * DAY_MS }])
    // lastOpenedAt 5 天前比 100 天前的访问新
    expect(isStale(fav('a', 200, 5), visits, NOW)).toBe(false)
    // 反过来：访问 2 天前比 lastOpenedAt 100 天前新
    const visits2 = latestVisitsById([{ id: 'a', visitedAt: NOW - 2 * DAY_MS }])
    expect(isStale(fav('a', 200, 100), visits2, NOW)).toBe(false)
  })

  it('其它站点的访问记录不影响本条', () => {
    const visits = latestVisitsById([{ id: 'other', visitedAt: NOW - DAY_MS }])
    expect(isStale(fav('a', 200), visits, NOW)).toBe(true)
  })

  it('晚于 now 的时间戳（时钟回拨 / 脏数据）一律忽略', () => {
    const visits = latestVisitsById([{ id: 'a', visitedAt: NOW + DAY_MS }])
    expect(resolveLastOpened(fav('a', 200, 95), visits, NOW)).toBe(NOW - 95 * DAY_MS)
    const futureFav = fav('b', 200)
    futureFav.lastOpenedAt = NOW + DAY_MS
    expect(resolveLastOpened(futureFav, latestVisitsById([]), NOW)).toBeNull()
    expect(isStale(futureFav, latestVisitsById([]), NOW)).toBe(true)
  })
})

describe('选择与排序', () => {
  it('最久没打开的排前面；并列时先收藏的排前面；输出确定', () => {
    const list = [fav('mid', 300, 120), fav('oldest', 400, 200), fav('new', 150, 95), fav('fresh', 10, 2)]
    const stale = selectStaleFavorites(list, [], NOW)
    expect(stale.map((s) => s.siteId)).toEqual(['oldest', 'mid', 'new'])
    // 同一份输入再跑一次，结果完全一致
    expect(selectStaleFavorites(list, [], NOW).map((s) => s.siteId)).toEqual(['oldest', 'mid', 'new'])
  })

  it('同 siteId 只留一条（最久没打开的那条），不重复出现', () => {
    const list = [fav('dup', 300, 100), fav('dup', 300, 150)]
    const stale = selectStaleFavorites(list, [], NOW)
    expect(stale).toHaveLength(1)
    expect(stale[0].daysSinceOpen).toBe(150)
  })

  it('每日重温只取前 3 条', () => {
    expect(RESURFACE_DAILY_LIMIT).toBe(3)
    const list = [1, 2, 3, 4, 5].map((n) => fav(`s${n}`, 300, 100 + n))
    expect(selectDailyResurface(list, [], NOW)).toHaveLength(3)
    expect(selectDailyResurface(list, [], NOW).map((s) => s.siteId)).toEqual(['s5', 's4', 's3'])
  })

  it('一条都没有旧的时候，每日重温为空（岛安静消失，不放空盒子）', () => {
    expect(selectDailyResurface([fav('fresh', 10, 2)], [], NOW)).toEqual([])
    expect(selectStaleFavorites([], [], NOW)).toEqual([])
  })
})

describe('徽标与文案：诚实口径', () => {
  it('徽标只写天数，不渲染指责', () => {
    expect(staleBadgeLabel(120)).toBe('好久没打开 · 120天')
  })

  it('从未记录到打开：说「收藏 N 天了，还没重温过」，不说「你 N 天没看」', () => {
    const text = describeStale(fav('a', 100), latestVisitsById([]), NOW)
    expect(text).toBe('收藏 100 天了，还没从这里重温过')
    expect(text).not.toContain('没看')
  })

  it('打开过：说「上次打开是 N 天前」', () => {
    expect(describeStale(fav('a', 200, 120), latestVisitsById([]), NOW)).toBe('上次打开是 120 天前')
  })

  it('已选出的条目直接按解析好的天数取文案，不重算（靠访问记录救回的条目天数不能算错）', () => {
    const [item] = selectStaleFavorites([fav('a', 200, 150)], [], NOW)
    expect(describeResurfaced(item)).toBe('上次打开是 150 天前')
    const [never] = selectStaleFavorites([fav('b', 200)], [], NOW)
    expect(never.lastOpenedAtResolved).toBeNull()
    expect(describeResurfaced(never)).toBe('收藏 200 天了，还没从这里重温过')
  })
})

describe('归档柜', () => {
  const item = (siteId: string): ArchivedFavoriteItem => ({
    siteId,
    title: `站点 ${siteId}`,
    href: `https://example.com/${siteId}`,
    createdAt: NOW - 200 * DAY_MS,
    archivedAt: NOW,
  })

  it('归档放最前；重复归档同站不占两个格子，只刷新时间', () => {
    const once = archiveItems([], fav('a', 200), NOW)
    expect(once).toHaveLength(1)
    expect(once[0].archivedAt).toBe(NOW)
    const twice = archiveItems(once, fav('a', 200), NOW + DAY_MS)
    expect(twice).toHaveLength(1)
    expect(twice[0].archivedAt).toBe(NOW + DAY_MS)
  })

  it('取出返回条目并从列表移除；取不到的返回 null 且列表不动', () => {
    const list = [item('a'), item('b')]
    const { items, restored } = unarchiveItems(list, 'a')
    expect(restored?.siteId).toBe('a')
    expect(items.map((i) => i.siteId)).toEqual(['b'])
    const miss = unarchiveItems(list, 'zzz')
    expect(miss.restored).toBeNull()
    expect(miss.items).toEqual(list)
  })

  it('序列化往返不丢字段；坏 JSON / 非数组按空列表，不抛', () => {
    const list = [item('a')]
    expect(parseArchived(serializeArchived(list))).toEqual(list)
    expect(parseArchived('{"broken')).toEqual([])
    expect(parseArchived('{"version":1}')).toEqual([])
    expect(parseArchived(null)).toEqual([])
    expect(parseArchived('')).toEqual([])
  })

  it('解析时丢弃缺字段的残行、同站重复只留第一条', () => {
    const raw = JSON.stringify([item('a'), { siteId: 'a', title: 'x', href: 'y', createdAt: 1, archivedAt: 2 }, { siteId: 'bad' }])
    expect(parseArchived(raw)).toEqual([item('a')])
  })

  it('带备注 / 标签 / 收藏夹的收藏归档再恢复，三样原样回来（不静默洗掉）', () => {
    const decorated: ResurfaceFavoriteLike = {
      ...fav('a', 200),
      note: '周末慢慢读',
      tags: ['教程', '待读'],
      folderId: 'folder-1',
    }
    // 重温选择先把三样带进归档入口的条目（两个归档入口都走这条路）
    const [picked] = selectStaleFavorites([decorated], [], NOW)
    expect(picked.note).toBe('周末慢慢读')
    expect(picked.tags).toEqual(['教程', '待读'])
    expect(picked.folderId).toBe('folder-1')
    // 归档 → 落盘序列化 → 读回 → 取出，全程不丢
    const archived = archiveItems([], picked, NOW)
    const roundTripped = parseArchived(serializeArchived(archived))
    expect(roundTripped).toHaveLength(1)
    expect(roundTripped[0].note).toBe('周末慢慢读')
    expect(roundTripped[0].tags).toEqual(['教程', '待读'])
    expect(roundTripped[0].folderId).toBe('folder-1')
    const { items, restored } = unarchiveItems(roundTripped, 'a')
    expect(items).toEqual([])
    expect(restored?.note).toBe('周末慢慢读')
    expect(restored?.tags).toEqual(['教程', '待读'])
    expect(restored?.folderId).toBe('folder-1')
  })

  it('解析时备注 / 标签 / 收藏夹只认形状对的值，脏值丢字段不丢整条', () => {
    const raw = JSON.stringify([
      {
        ...item('a'),
        note: 42,
        tags: ['有效', 7, null, '标签'],
        folderId: 123,
      },
      { ...item('b'), note: '保留', tags: [], folderId: null },
    ])
    const [a, b] = parseArchived(raw)
    expect(a.note).toBeUndefined()
    expect(a.tags).toEqual(['有效', '标签'])
    expect(a.folderId).toBeUndefined()
    expect(b.note).toBe('保留')
    expect(b.tags).toBeUndefined()
    expect(b.folderId).toBeNull()
  })
})

describe('接线守卫', () => {
  it('/brief 挂了今日重温岛（在 BriefWatch 之后），SSR 壳本身不带用户数据', () => {
    const page = read('src/app/brief/page.tsx')
    expect(page).toContain("import BriefResurface from './brief-resurface'")
    expect(page).toContain('<BriefResurface />')
    expect(page.indexOf('<BriefResurface />')).toBeGreaterThan(page.indexOf('<BriefWatch />'))
    const island = read('src/app/brief/brief-resurface.tsx')
    expect(island).toContain('selectDailyResurface')
    expect(island).toContain('/favorites/stale')
    expect(island).not.toContain('localStorage.getItem')
  })

  it('/favorites/stale 是完整分拣台：重开记打开、归档可恢复、删除二次确认', () => {
    const stale = read('src/app/favorites/stale/page.tsx')
    expect(stale).toContain('selectStaleFavorites')
    expect(stale).toContain('recordOpened')
    expect(stale).toContain('已归档')
    expect(stale).toContain('恢复')
    expect(stale).toContain('window.confirm')
    expect(stale).toContain("href=\"/favorites\"")
  })

  it('恢复的 importJson 负载带备注 / 标签 / 收藏夹：归档过的收藏恢复后不丢装饰', () => {
    const stale = read('src/app/favorites/stale/page.tsx')
    const restore = stale.slice(stale.indexOf('handleRestore'))
    expect(restore).toContain('note: item.note')
    expect(restore).toContain('tags: item.tags')
    expect(restore).toContain('folderId: item.folderId')
  })

  it('/favorites 列表有旧徽标与去重温的横幅入口', () => {
    const page = read('src/app/favorites/page.tsx')
    expect(page).toContain('staleBadgeLabel')
    expect(page).toContain('staleById')
    expect(page).toContain('href="/favorites/stale"')
    expect(page).toContain('去重温')
  })

  it('重温行共用组件：标题即重开链接，归档/删除带无障碍标签', () => {
    const row = read('src/components/resurface-row.tsx')
    expect(row).toContain('onReopen(item.siteId)')
    expect(row).toContain('aria-label={`归档')
    expect(row).toContain('aria-label={`删除')
    expect(row).toContain('safeHref(item.href)')
  })

  it('新代码没有显式 any，且选择逻辑不读真实时钟（now 一律注入）', () => {
    for (const rel of [
      'src/lib/resurface.ts',
      'src/lib/favorites-archive.ts',
      'src/components/resurface-row.tsx',
      'src/app/brief/brief-resurface.tsx',
      'src/app/favorites/stale/page.tsx',
    ]) {
      expect(read(rel)).not.toContain(': any')
    }
    expect(read('src/lib/resurface.ts')).not.toContain('Date.now()')
  })
})
