import { describe, expect, it } from 'vitest'
import { mergeCloudFavorites, type CloudFavoriteLike, type LocalFavoriteLike } from '../src/lib/favorites-merge'

/**
 * 云端权威合并：成员集合以云端为准，本地只补展示字段。
 * 回归重点：其它设备删掉的收藏不能因为本地缓存还在而被并回来。
 */
const local = (over: Partial<LocalFavoriteLike> & { siteId: string }): LocalFavoriteLike => ({
  title: `本地-${over.siteId}`,
  href: `https://local/${over.siteId}`,
  icon: `https://icon/${over.siteId}.png`,
  createdAt: 100,
  ...over,
})

const remote = (over: Partial<CloudFavoriteLike> & { siteId: string }): CloudFavoriteLike => ({
  folderId: null,
  note: null,
  createdAt: 200,
  site: { title: `云端-${over.siteId}`, url: `https://cloud/${over.siteId}`, description: '云端描述' },
  ...over,
})

describe('mergeCloudFavorites', () => {
  it('成员集合以云端为准：本机多出来的收藏被丢弃', () => {
    const merged = mergeCloudFavorites(
      [local({ siteId: 'a' }), local({ siteId: 'gone' })],
      [remote({ siteId: 'a' })],
    )
    expect(merged.map((i) => i.siteId)).toEqual(['a'])
  })

  it('云端新增收藏会出现在本地，并用云端标题/地址', () => {
    const merged = mergeCloudFavorites([], [remote({ siteId: 'new' })])
    expect(merged[0]).toMatchObject({
      siteId: 'new',
      title: '云端-new',
      href: 'https://cloud/new',
      description: '云端描述',
    })
  })

  it('图标保留本地值（云端列表不返回图标）', () => {
    const merged = mergeCloudFavorites([local({ siteId: 'a' })], [remote({ siteId: 'a' })])
    expect(merged[0]?.icon).toBe('https://icon/a.png')
  })

  it('备注与文件夹严格采用云端值：云端 null 表示已清空，不回退本地', () => {
    const merged = mergeCloudFavorites(
      [local({ siteId: 'a', note: '旧备注', folderId: 'folder-old' })],
      [remote({ siteId: 'a', note: null, folderId: null })],
    )
    expect(merged[0]?.note).toBeUndefined()
    expect(merged[0]?.folderId).toBeNull()
  })

  it('站点已删但本地仍有缓存时保留可渲染信息', () => {
    const merged = mergeCloudFavorites(
      [local({ siteId: 'a', note: '本地备注' })],
      [remote({ siteId: 'a', site: null })],
    )
    expect(merged[0]).toMatchObject({ siteId: 'a', title: '本地-a', href: 'https://local/a' })
  })

  it('站点与本地缓存都没有时跳过，不产出空卡片', () => {
    const merged = mergeCloudFavorites([], [remote({ siteId: 'ghost', site: null })])
    expect(merged).toEqual([])
  })
})
