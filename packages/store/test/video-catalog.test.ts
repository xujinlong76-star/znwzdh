import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/driver.ts'
import { Repository } from '../src/repository.ts'
import {
  countVideoItems,
  getVideoItem,
  listVideoReplacements,
  listVideoItems,
  logVideoReplacement,
  replaceVideoCatalog,
  replaceVideoReplacements,
  type VideoCategoryInput,
  type VideoItemInput,
} from '../src/repository/videos.ts'

/**
 * 视频库关系化的基础设施测试（C6 第一步）。
 *
 * 只测 sqlite：PG 分支的 SQL 与 sqlite 同构（仅占位符与布尔表示不同），
 * 真正的 PG 验证属于 `test:pg:suite` 的职责，本地没有实例时不假装跑过。
 */

let dir = ''
let db: Db
let repo: Repository

const categories: VideoCategoryInput[] = [
  { id: 'cat_ai', title: 'AI 与大模型', enabled: true, harvestPolicy: { enabled: true, keywords: ['LLM'] } },
  { id: 'cat_fe', title: '现代全栈', enabled: true },
]

function item(over: Partial<VideoItemInput> & { id: string; categoryId: string }): VideoItemInput {
  return {
    title: `标题 ${over.id}`,
    href: `https://www.bilibili.com/video/BV${over.id}`,
    platform: 'bilibili',
    externalId: `BV${over.id}`,
    payload: { chapters: [{ title: '第一章', startTime: 0 }], transcript: [] },
    ...over,
  }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'navhub-video-'))
  db = await openDb({ dialect: 'sqlite', sqlitePath: join(dir, 'test.db') })
  repo = new Repository(db)
})

afterEach(() => {
  try { db.sqlite?.close() } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true })
})

describe('replaceVideoCatalog', () => {
  it('写入分类与条目，并能按分类统计', async () => {
    const res = await replaceVideoCatalog(repo, categories, [
      item({ id: 'a1', categoryId: 'cat_ai' }),
      item({ id: 'a2', categoryId: 'cat_ai' }),
      item({ id: 'f1', categoryId: 'cat_fe' }),
    ])

    expect(res).toEqual({ categories: 2, items: 3 })
    expect(await countVideoItems(repo)).toBe(3)
    expect(await countVideoItems(repo, 'cat_ai')).toBe(2)
  })

  it('是「全量替换」语义：未出现的条目会被删除', async () => {
    await replaceVideoCatalog(repo, categories, [
      item({ id: 'a1', categoryId: 'cat_ai' }),
      item({ id: 'a2', categoryId: 'cat_ai' }),
    ])
    await replaceVideoCatalog(repo, categories, [item({ id: 'a1', categoryId: 'cat_ai' })])

    expect(await countVideoItems(repo)).toBe(1)
    expect(await getVideoItem(repo, 'a2')).toBeNull()
  })

  it('幂等：同样输入重复调用结果一致', async () => {
    const items = [item({ id: 'a1', categoryId: 'cat_ai' })]
    await replaceVideoCatalog(repo, categories, items)
    await replaceVideoCatalog(repo, categories, items)
    expect(await countVideoItems(repo)).toBe(1)
  })

  it('保留完整 payload（章节/字幕不丢）', async () => {
    await replaceVideoCatalog(repo, categories, [item({ id: 'a1', categoryId: 'cat_ai' })])
    const row = await getVideoItem(repo, 'a1')
    expect(row).not.toBeNull()
    const payload = row!.payload as { chapters?: unknown[] }
    expect(Array.isArray(payload.chapters)).toBe(true)
    expect(payload.chapters).toHaveLength(1)
  })

  it('布尔字段在 sqlite 下读回来仍是 boolean', async () => {
    await replaceVideoCatalog(repo, categories, [
      item({ id: 'a1', categoryId: 'cat_ai', enabled: false, pinned: true }),
    ])
    const row = await getVideoItem(repo, 'a1')
    expect(row!.enabled).toBe(false)
    expect(row!.pinned).toBe(true)
  })

  it('同一 platform+externalId 不允许出现两行（跨平台同名 ID 不冲突）', async () => {
    // 先写入一条
    await replaceVideoCatalog(repo, categories, [item({ id: 'x1', categoryId: 'cat_ai', externalId: 'same-id' })])

    // 追加一条同 platform 同 externalId、但 id 不同 —— 唯一索引应拒绝
    const direct = () =>
      db.sqlite!.prepare(
        "INSERT INTO video_items (id,category_id,title,href,platform,external_id,enabled,sort,pinned,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run('x2', 'cat_fe', 't', 'h', 'bilibili', 'same-id', 1, 0, 0, '{}', 1, 1)

    expect(direct).toThrow()

    // 换平台则允许（ID 空间不同）
    expect(() =>
      db.sqlite!.prepare(
        "INSERT INTO video_items (id,category_id,title,href,platform,external_id,enabled,sort,pinned,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run('y1', 'cat_fe', 't', 'h', 'youtube', 'same-id', 1, 0, 0, '{}', 1, 1),
    ).not.toThrow()
  })
})

describe('listVideoItems', () => {
  it('按分类过滤并分页', async () => {
    await replaceVideoCatalog(repo, categories, [
      item({ id: 'a1', categoryId: 'cat_ai', sort: 0 }),
      item({ id: 'a2', categoryId: 'cat_ai', sort: 1 }),
      item({ id: 'a3', categoryId: 'cat_ai', sort: 2 }),
      item({ id: 'f1', categoryId: 'cat_fe', sort: 0 }),
    ])

    const page1 = await listVideoItems(repo, { categoryId: 'cat_ai', limit: 2, offset: 0 })
    expect(page1.map(r => r.id)).toEqual(['a1', 'a2'])

    const page2 = await listVideoItems(repo, { categoryId: 'cat_ai', limit: 2, offset: 2 })
    expect(page2.map(r => r.id)).toEqual(['a3'])
  })

  it('可按健康状态过滤（死链巡检的查询入口）', async () => {
    await replaceVideoCatalog(repo, categories, [
      item({ id: 'a1', categoryId: 'cat_ai', healthStatus: 'broken' }),
      item({ id: 'a2', categoryId: 'cat_ai', healthStatus: 'unverified' }),
      item({ id: 'a3', categoryId: 'cat_ai', healthStatus: 'healthy' }),
    ])
    const broken = await listVideoItems(repo, { healthStatus: 'broken' })
    expect(broken.map(r => r.id)).toEqual(['a1'])
  })

  it('limit 有上限，避免一次拉爆整表', async () => {
    await replaceVideoCatalog(repo, categories, [item({ id: 'a1', categoryId: 'cat_ai' })])
    const rows = await listVideoItems(repo, { limit: 99999 })
    expect(rows.length).toBe(1) // 上限 500，但表里只有 1 条
  })
})

describe('替换审计', () => {
  it('写入并按时间倒序列出，重复写入同 id 只更新 rolled_back', async () => {
    await replaceVideoCatalog(repo, categories, [item({ id: 'a1', categoryId: 'cat_ai' })])

    await logVideoReplacement(repo, {
      id: 'rep1',
      categoryId: 'cat_ai',
      categoryTitle: 'AI 与大模型',
      oldItem: { id: 'old' },
      newItem: { id: 'new' },
      reason: 'freshness_decay',
      scoreDiff: 18,
      createdAt: 1000,
    })
    await logVideoReplacement(repo, {
      id: 'rep2',
      categoryId: 'cat_ai',
      oldItem: {},
      newItem: {},
      createdAt: 2000,
    })

    let rows = await listVideoReplacements(repo, { categoryId: 'cat_ai' })
    expect(rows.map(r => r.id)).toEqual(['rep2', 'rep1'])

    // 回滚标记：同 id 再写一次只改 rolled_back，不产生新行
    await logVideoReplacement(repo, {
      id: 'rep1',
      categoryId: 'cat_ai',
      oldItem: { id: 'old' },
      newItem: { id: 'new' },
      rolledBack: true,
      createdAt: 1000,
    })
    rows = await listVideoReplacements(repo, { categoryId: 'cat_ai' })
    expect(rows).toHaveLength(2)
    expect(rows.find(r => r.id === 'rep1')!.rolledBack).toBe(true)
  })
})

describe('replaceVideoReplacements（外置审计文档的全量同步）', () => {
  const rec = (id: string, createdAt: number) => ({
    id,
    categoryId: 'cat_ai',
    categoryTitle: 'AI 与大模型',
    oldItem: { id: 'old-' + id },
    newItem: { id: 'new-' + id },
    reason: 'freshness_decay',
    scoreDiff: 5,
    createdAt,
  })

  it('全量替换语义：未出现在入参里的记录会被删除', async () => {
    await replaceVideoReplacements(repo, [rec('r1', 1000), rec('r2', 2000)])
    expect(await listVideoReplacements(repo)).toHaveLength(2)

    // 权威文档里删掉了 r1（例如运维清理），表必须跟着删 —— 只 upsert 会留下幽灵行
    const n = await replaceVideoReplacements(repo, [rec('r2', 2000)])
    expect(n).toBe(1)
    const rows = await listVideoReplacements(repo)
    expect(rows.map(r => r.id)).toEqual(['r2'])
  })

  it('幂等：同样输入重复调用结果一致（不会翻倍）', async () => {
    await replaceVideoReplacements(repo, [rec('r1', 1000), rec('r2', 2000)])
    await replaceVideoReplacements(repo, [rec('r1', 1000), rec('r2', 2000)])
    expect(await listVideoReplacements(repo)).toHaveLength(2)
  })

  it('入参有重复 id 时只保留第一条（否则主键冲突会让整批失败）', async () => {
    const n = await replaceVideoReplacements(repo, [rec('dup', 1000), rec('dup', 9000)])
    expect(n).toBe(1)
    const rows = await listVideoReplacements(repo)
    expect(rows).toHaveLength(1)
    // 保留第一条：文档里同一 id 出现两次属于上游脏数据，取先出现的更可预测
    expect(rows[0].createdAt).toBe(1000)
  })

  it('空数组表示「确实没有记录」：会把表清空', async () => {
    await replaceVideoReplacements(repo, [rec('r1', 1000)])
    expect(await replaceVideoReplacements(repo, [])).toBe(0)
    expect(await listVideoReplacements(repo)).toHaveLength(0)
  })

  it('不设条数上限：120 条全量写入后仍能全部读出（内联数组只留 100 是另一层的事）', async () => {
    const many = Array.from({ length: 120 }, (_, i) => rec('bulk-' + i, 1000 + i))
    expect(await replaceVideoReplacements(repo, many)).toBe(120)
    // listVideoReplacements 默认 limit 50、上限 500，这里显式要 500
    expect(await listVideoReplacements(repo, { limit: 500 })).toHaveLength(120)
  })
})
