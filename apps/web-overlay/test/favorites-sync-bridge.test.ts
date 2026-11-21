import { describe, expect, it } from 'vitest'
import { diffFavoritesToMutations } from '../src/hooks/useFavoritesSyncBridge'
import type { LocalFavorite } from '../src/hooks/useFavorites'

/**
 * 收藏变化 → Outbox 差异检测（2026-11-21）。
 *
 * 桥接层用快照差异把收藏变化喂给同步引擎，不侵入 useFavorites 内部。
 * 这里锁住三条：
 *  1. 新增产生 upsert、删除产生 delete
 *  2. 只有真正变化的字段进 changedFields（正交字段合并的前提）
 *  3. 同值重写不产生 op（幂等，不刷无意义请求）
 */
const fav = (id: string, over: Partial<LocalFavorite> = {}): LocalFavorite =>
  ({
    siteId: id,
    title: 'T-' + id,
    href: 'https://' + id + '.com',
    createdAt: 1,
    ...over,
  }) as LocalFavorite

describe('diffFavoritesToMutations', () => {
  it('首次加载（空→有）产生 upsert', () => {
    const out = diffFavoritesToMutations([], [fav('a')])
    expect(out).toHaveLength(1)
    expect(out[0].op).toBe('upsert')
    expect(out[0].itemId).toBe('a')
  })

  it('新增条目产生 upsert', () => {
    const out = diffFavoritesToMutations([fav('a')], [fav('a'), fav('b')])
    expect(out).toHaveLength(1)
    expect(out[0].itemId).toBe('b')
    expect(out[0].op).toBe('upsert')
  })

  it('删除条目产生 delete', () => {
    const out = diffFavoritesToMutations([fav('a'), fav('b')], [fav('a')])
    expect(out).toHaveLength(1)
    expect(out[0].itemId).toBe('b')
    expect(out[0].op).toBe('delete')
    expect(out[0].changedFields).toEqual(['deleted'])
  })

  it('只有变化的字段进 changedFields（正交合并的前提）', () => {
    const before = [fav('a', { note: 'n1', folderId: 'f1' })]
    const after = [fav('a', { note: 'n2', folderId: 'f1' })]
    const out = diffFavoritesToMutations(before, after)
    expect(out).toHaveLength(1)
    expect(out[0].changedFields).toEqual(['note'])
  })

  it('多字段同时变化全部记录', () => {
    const before = [fav('a', { note: 'n1', tags: ['x'] })]
    const after = [fav('a', { note: 'n2', tags: ['y'] })]
    const out = diffFavoritesToMutations(before, after)
    expect(out[0].changedFields).toEqual(expect.arrayContaining(['note', 'tags']))
  })

  it('tags 数组按内容比较（不是引用）', () => {
    const before = [fav('a', { tags: ['x', 'y'] })]
    const after = [fav('a', { tags: ['x', 'y'] })]
    expect(diffFavoritesToMutations(before, after)).toHaveLength(0)
  })

  it('tags 长度变化算变更', () => {
    const before = [fav('a', { tags: ['x'] })]
    const after = [fav('a', { tags: ['x', 'y'] })]
    expect(diffFavoritesToMutations(before, after)).toHaveLength(1)
  })

  it('同值重写不产生 op（幂等）', () => {
    const before = [fav('a', { note: 'same', folderId: 'f1' })]
    const after = [fav('a', { note: 'same', folderId: 'f1' })]
    expect(diffFavoritesToMutations(before, after)).toHaveLength(0)
  })

  it('null 与 undefined 等价（都表示无值）', () => {
    const before = [fav('a', { note: undefined })]
    const after = [fav('a', { note: null as never })]
    expect(diffFavoritesToMutations(before, after)).toHaveLength(0)
  })

  it('payload 带齐 title/url 供新增使用', () => {
    const out = diffFavoritesToMutations([], [fav('a')])
    expect(out[0].payload).toMatchObject({ title: 'T-a', url: 'https://a.com' })
  })

  it('空→空 不产生 op', () => {
    expect(diffFavoritesToMutations([], [])).toHaveLength(0)
  })
})
