import { describe, expect, it } from 'vitest'
import {
  addLocalFolder,
  countByFolder,
  FOLDER_NAME_MAX,
  isLocalFolderId,
  newLocalFolderId,
  normalizeFolderName,
  parseLocalFolders,
  planFolderUpload,
  removeLocalFolder,
  renameLocalFolder,
  serializeLocalFolders,
} from '../src/lib/favorites-folders'

/**
 * 本地收藏夹（P2：匿名用户也能分组）。
 *
 * 锁四类语义：
 *  1. 本地 id 与云端 id 可区分（同步分支靠 `local-` 前缀决定该推给谁）；
 *  2. 存储损坏时降级为空数组，而不是让收藏页打不开；
 *  3. 重名拒绝、空名拒绝、超长截断；
 *  4. 上传计划按名称复用云端夹子——否则登录后本地分组会全部重建一遍。
 */
const NOW = 1_700_000_000_000

describe('id 与名称', () => {
  it('本地 id 带前缀，可与云端 uuid 区分', () => {
    const id = newLocalFolderId()
    expect(isLocalFolderId(id)).toBe(true)
    expect(isLocalFolderId('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(false)
    expect(isLocalFolderId(null)).toBe(false)
  })

  it('名称去空白、截断到 30；空名返回 null', () => {
    expect(normalizeFolderName('  日常  ')).toBe('日常')
    expect(normalizeFolderName('x'.repeat(80))).toHaveLength(FOLDER_NAME_MAX)
    expect(normalizeFolderName('   ')).toBeNull()
    expect(normalizeFolderName(42)).toBeNull()
    expect(normalizeFolderName(undefined)).toBeNull()
  })
})

describe('本地存储解析', () => {
  it('损坏 JSON 降级为空数组', () => {
    expect(parseLocalFolders('{oops')).toEqual([])
    expect(parseLocalFolders(null)).toEqual([])
  })

  it('非数组 / 元素形态不符时逐条跳过，不整体失败', () => {
    const raw = JSON.stringify([
      { id: 'local-a', name: '开发', sort: 1, createdAt: NOW },
      { id: 'local-b', name: '  ' },
      'not-an-object',
      { name: '缺 id 的夹子' },
    ])
    const folders = parseLocalFolders(raw)
    expect(folders.map((f) => f.name)).toEqual(['开发', '缺 id 的夹子'])
    // 缺 id 的条目补一个本地 id，否则无法被引用
    expect(folders[1].id.startsWith('local-')).toBe(true)
  })

  it('序列化后可原样读回', () => {
    const created = addLocalFolder([], '工作', NOW)
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(parseLocalFolders(serializeLocalFolders(created.folders))).toEqual(created.folders)
  })
})

describe('增删改', () => {
  it('新建成功，重名与空名被拒', () => {
    const first = addLocalFolder([], '工作', NOW)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(addLocalFolder(first.folders, '工作', NOW)).toEqual({ ok: false, error: '已存在同名收藏夹' })
    expect(addLocalFolder(first.folders, '   ', NOW)).toEqual({ ok: false, error: '收藏夹名称不能为空' })
  })

  it('改名走同一套归一化（空白与长度）', () => {
    const created = addLocalFolder([], '工作', NOW)
    if (!created.ok) throw new Error('setup')
    const renamed = renameLocalFolder(created.folders, created.folder.id, '  工作台  ')
    expect(renamed[0].name).toBe('工作台')
    // 空名不改动：宁可不改，也不要造出一个叫 "" 的夹子
    expect(renameLocalFolder(created.folders, created.folder.id, '  ')[0].name).toBe('工作')
  })

  it('删除只移除夹子本身，不返回受影响条目（语义由调用方处理）', () => {
    const created = addLocalFolder([], '临时', NOW)
    if (!created.ok) throw new Error('setup')
    const removed = removeLocalFolder(created.folders, created.folder.id)
    expect(removed.folders).toEqual([])
    expect(removed.affected).toBe(0)
  })
})

describe('计数与上传计划', () => {
  it('按 folderId 计数，未分组不计入', () => {
    const counts = countByFolder([
      { folderId: 'local-a' },
      { folderId: 'local-a' },
      { folderId: null },
      { folderId: 'local-b' },
      {},
    ])
    expect(counts.get('local-a')).toBe(2)
    expect(counts.get('local-b')).toBe(1)
    expect(counts.has('')).toBe(false)
  })

  it('同名复用云端 id，异名才新建', () => {
    const created = addLocalFolder([], '工作', NOW)
    const second = addLocalFolder(created.ok ? created.folders : [], '生活', NOW)
    if (!second.ok) throw new Error('setup')

    const plan = planFolderUpload(second.folders, [
      { id: 'uuid-cloud-1', name: '工作' },
      { id: 'uuid-cloud-2', name: '其它' },
    ])
    // 同名映射到云端 id：否则登录后本地分组会被整体重建，用户的 folderId 全部失效
    expect(plan.mapping.get(second.folders[0].id)).toBe('uuid-cloud-1')
    // 异名才需要创建
    expect(plan.toCreate.map((f) => f.name)).toEqual(['生活'])
  })

  it('云端没有任何夹子时全部要新建', () => {
    const created = addLocalFolder([], '工作', NOW)
    if (!created.ok) throw new Error('setup')
    const plan = planFolderUpload(created.folders, [])
    expect(plan.mapping.size).toBe(0)
    expect(plan.toCreate).toHaveLength(1)
  })
})
