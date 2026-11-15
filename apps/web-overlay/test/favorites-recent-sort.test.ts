/**
 * 「最近打开」排序 + 主列表点卡记打开（2026-11-15 小时轮）。
 *
 * 背景（真实缺口，见 resurface.ts 的数据现实注释）：此前只有 ⌘K / 重温 /
 * 久未打开入口点开才记 lastOpenedAt，主列表直接点卡打开不记——「最近打开」
 * 排出来是残缺的，「好久没打开」提示也只能按不完整的本机记录算。
 * 本轮把两处一起补上：卡片点击记一次打开（本机、不进云端），排序新增
 * recent（lastOpenedAt 倒序，没打开过的沉底）。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sortFavorites } from '../src/lib/favorites-filter'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.includes('web-overlay') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

const fav = (siteId: string, createdAt: number, lastOpenedAt?: number) => ({
  siteId,
  title: siteId,
  createdAt,
  ...(lastOpenedAt === undefined ? {} : { lastOpenedAt }),
})

describe('sortFavorites：最近打开', () => {
  it('recent 按 lastOpenedAt 倒序，没打开过的沉底', () => {
    const items = [
      fav('never', 3000),
      fav('old-open', 1000, 5000),
      fav('new-open', 2000, 9000),
    ]
    expect(sortFavorites(items, 'recent').map((i) => i.siteId)).toEqual([
      'new-open',
      'old-open',
      'never',
    ])
  })

  it('recent：都没打开过时按 createdAt 倒序；打开时间相同时也按 createdAt 倒序', () => {
    const items = [fav('a', 1000), fav('b', 3000), fav('c', 2000)]
    expect(sortFavorites(items, 'recent').map((i) => i.siteId)).toEqual(['b', 'c', 'a'])
    const tied = [fav('x', 1000, 5000), fav('y', 3000, 5000)]
    expect(sortFavorites(tied, 'recent').map((i) => i.siteId)).toEqual(['y', 'x'])
  })

  it('recent：lastOpenedAt 为 0 与缺字段同等对待（都算没打开过）', () => {
    const items = [fav('zero', 3000, 0), fav('opened', 1000, 100)]
    expect(sortFavorites(items, 'recent').map((i) => i.siteId)).toEqual(['opened', 'zero'])
  })

  it('created / title 口径不变，且不改入参数组', () => {
    const items = [fav('b', 1000, 9000), fav('a', 3000, 1000)]
    expect(sortFavorites(items, 'created').map((i) => i.siteId)).toEqual(['a', 'b'])
    expect(sortFavorites(items, 'title').map((i) => i.siteId)).toEqual(['a', 'b'])
    expect(items.map((i) => i.siteId)).toEqual(['b', 'a'])
    // 未知排序值回退 created（与 URL 解析的非法回退同口径）
    expect(sortFavorites(items, 'whatever' as never).map((i) => i.siteId)).toEqual(['a', 'b'])
  })
})

describe('最近打开：页面接线', () => {
  it('页面接线：排序下拉有「最近打开」，主列表卡片点击记打开', () => {
    const page = overlaySource('src/app/favorites/page.tsx')
    expect(page).toContain('<option value="recent">最近打开</option>')
    expect(page).toContain("e.target.value === 'recent'")
    // 卡片 <a> 非批量模式下点开记一次打开；批量点选分支仍是 preventDefault + 选框
    expect(page).toContain('favorites.recordOpened(f.siteId)')
    // 中键点击不触发 click，用 onAuxClick（仅 button === 1）补记；右键不记
    expect(page).toContain('onAuxClick')
    expect(page).toContain('e.button === 1')
    expect(page).toContain('sortFavorites(byTriage, sortBy)')
  })
})
