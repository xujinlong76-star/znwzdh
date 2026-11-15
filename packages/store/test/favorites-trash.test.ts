/**
 * 收藏回收站（仓储层）：favorites.deleted_at 就是云端回收站，不新增表。
 *
 * 钉死：
 *  - removeFavorite 写墓碑后 listTrashedFavorites 能读到、listFavorites 读不到；
 *  - addFavorite 复活墓碑（deleted_at 清掉）；
 *  - purgeExpiredDeletedFavorites(30d) 只清过期、不过期不动
 *    （仓储口径是 deleted_at < 阈值：恰好 30 天整的那条暂不清理，比前端
 *    的 <= 晚 1ms，宁可多留一刻不误删）；
 *  - purgeFavorite 物理删且不留墓碑；clearTrashedFavorites 只清墓碑；
 *  - applyFavoriteOps 的 remove 后 add（at 更晚）复活、at 更早被 LWW 挡掉。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../src/driver.ts'
import { Repository } from '../src/repository.ts'

const DAY = 24 * 60 * 60 * 1000

describe('收藏回收站：墓碑即回收站', () => {
  let db: Db
  let repo: Repository
  const user = 'github:u-trash'

  beforeAll(async () => {
    db = await openDb({ dialect: 'sqlite', sqlitePath: ':memory:' })
    repo = new Repository(db)
  })

  afterAll(async () => {
    await db.close()
  })

  it('removeFavorite 写墓碑后：listTrashedFavorites 能读到、listFavorites 读不到', async () => {
    const u = user + '-list'
    await repo.addFavorite({ userId: u, siteId: 'site-1', note: '备注一' })
    await repo.addFavorite({ userId: u, siteId: 'site-2' })
    expect(await repo.listFavorites(u)).toHaveLength(2)
    expect(await repo.listTrashedFavorites(u)).toHaveLength(0)

    expect(await repo.removeFavorite(u, 'site-1')).toBe(true)
    expect((await repo.listFavorites(u)).map((f) => f.siteId)).toEqual(['site-2'])
    const trashed = await repo.listTrashedFavorites(u)
    expect(trashed).toHaveLength(1)
    expect(trashed[0]!.siteId).toBe('site-1')
    expect(trashed[0]!.deletedAt).toBeGreaterThan(0)
    // 墓碑保留全字段（备注在恢复时要原样带回）
    expect(trashed[0]!.note).toBe('备注一')
    // 单条读：墓碑在；未删的读不到
    expect((await repo.getTrashedFavorite(u, 'site-1'))?.siteId).toBe('site-1')
    expect(await repo.getTrashedFavorite(u, 'site-2')).toBeNull()
  })

  it('listTrashedFavorites 按 deletedAt 倒序、limit 钳制', async () => {
    const u = user + '-order'
    await repo.applyFavoriteOps(u, [
      { op: 'add', siteId: 's1', at: 1000 },
      { op: 'add', siteId: 's2', at: 2000 },
      { op: 'add', siteId: 's3', at: 3000 },
    ])
    await repo.applyFavoriteOps(u, [
      { op: 'remove', siteId: 's1', at: 4000 },
      { op: 'remove', siteId: 's2', at: 5000 },
      { op: 'remove', siteId: 's3', at: 6000 },
    ])
    const all = await repo.listTrashedFavorites(u)
    expect(all.map((f) => f.siteId)).toEqual(['s3', 's2', 's1'])
    const one = await repo.listTrashedFavorites(u, 1)
    expect(one).toHaveLength(1)
    expect(one[0]!.siteId).toBe('s3')
  })

  it('addFavorite 复活墓碑：deleted_at 清掉，字段按新值覆盖', async () => {
    const u = user + '-revive'
    await repo.addFavorite({ userId: u, siteId: 'site-x', note: '旧备注' })
    await repo.removeFavorite(u, 'site-x')
    expect(await repo.listTrashedFavorites(u)).toHaveLength(1)

    await repo.addFavorite({ userId: u, siteId: 'site-x', note: '新备注' })
    expect(await repo.listTrashedFavorites(u)).toHaveLength(0)
    const alive = await repo.listFavorites(u)
    expect(alive).toHaveLength(1)
    expect(alive[0]!.deletedAt).toBeNull()
    expect(alive[0]!.note).toBe('新备注')
  })

  it('purgeFavorite 物理删且不留墓碑；非墓碑删不动', async () => {
    const u = user + '-purge'
    await repo.addFavorite({ userId: u, siteId: 'p1' })
    await repo.addFavorite({ userId: u, siteId: 'p2' })
    await repo.removeFavorite(u, 'p1')
    // 未删的 p2 不在回收站，物理删返回 false
    expect(await repo.purgeFavorite(u, 'p2')).toBe(false)
    expect(await repo.purgeFavorite(u, 'p1')).toBe(true)
    expect(await repo.purgeFavorite(u, 'p1')).toBe(false)
    expect(await repo.listTrashedFavorites(u)).toHaveLength(0)
    // 物理删后行彻底消失：增量拉取也看不到它
    expect((await repo.listFavoritesSince(u, 0)).items).toHaveLength(1)
    expect((await repo.listFavoritesSince(u, 0)).items[0]!.siteId).toBe('p2')
  })

  it('clearTrashedFavorites 只清墓碑，不动活着的收藏', async () => {
    const u = user + '-clear'
    await repo.addFavorite({ userId: u, siteId: 'c1' })
    await repo.addFavorite({ userId: u, siteId: 'c2' })
    await repo.addFavorite({ userId: u, siteId: 'c3' })
    await repo.removeFavorite(u, 'c1')
    await repo.removeFavorite(u, 'c2')
    expect(await repo.clearTrashedFavorites(u)).toBe(2)
    expect(await repo.listTrashedFavorites(u)).toHaveLength(0)
    expect((await repo.listFavorites(u)).map((f) => f.siteId)).toEqual(['c3'])
    expect(await repo.clearTrashedFavorites(u)).toBe(0)
  })

  it('applyFavoriteOps：remove 后 add（at 更晚）复活、at 更早被 LWW 挡掉', async () => {
    const u = user + '-lww'
    await repo.applyFavoriteOps(u, [{ op: 'add', siteId: 'w', at: 1000 }])
    await repo.applyFavoriteOps(u, [{ op: 'remove', siteId: 'w', at: 2000 }])
    expect((await repo.listTrashedFavorites(u)).map((f) => f.siteId)).toEqual(['w'])

    // at 更早的 add 被墓碑 updated_at 挡掉：不复活
    const blocked = await repo.applyFavoriteOps(u, [{ op: 'add', siteId: 'w', at: 1500 }])
    expect(blocked.applied).toBe(0)
    expect((await repo.listTrashedFavorites(u)).map((f) => f.siteId)).toEqual(['w'])

    // at 更晚的 add 复活（撤销推 add op 时 at 必须用撤销时刻，否则会被挡掉）
    const revived = await repo.applyFavoriteOps(u, [{ op: 'add', siteId: 'w', at: 3000 }])
    expect(revived.applied).toBe(1)
    expect(await repo.listTrashedFavorites(u)).toHaveLength(0)
    expect((await repo.listFavorites(u)).map((f) => f.siteId)).toEqual(['w'])
  })
})

/**
 * purgeExpiredDeletedFavorites 单独开一个库：
 * 方法是全局清理（不按 userId 过滤，将来定时任务一次清全库），
 * 且上一个 describe 里有 1970 年时间戳的墓碑（deletedAt 4000/5000/6000），
 * 共用库会把它们也算进来。隔离后断言才干净。
 */
describe('purgeExpiredDeletedFavorites(30d)：只清过期、不过期不动', () => {
  let db: Db
  let repo: Repository

  beforeAll(async () => {
    db = await openDb({ dialect: 'sqlite', sqlitePath: ':memory:' })
    repo = new Repository(db)
  })

  afterAll(async () => {
    await db.close()
  })

  it('只清 30 天前的墓碑；窗口内侧 60 秒（deletedAt = 30 天前 + 60 秒）暂不清理；活着的不动；跨用户一起清', async () => {
    const u = 'github:u-trash-expire'
    const other = 'github:u-trash-expire-other'
    const now = Date.now()
    await repo.applyFavoriteOps(u, [
      { op: 'add', siteId: 'old', at: now - 40 * DAY },
      { op: 'add', siteId: 'edge', at: now - 30 * DAY },
      { op: 'add', siteId: 'fresh', at: now - 1 * DAY },
      { op: 'add', siteId: 'alive', at: now },
    ])
    await repo.applyFavoriteOps(other, [{ op: 'add', siteId: 'other-old', at: now - 50 * DAY }])
    // remove 的 at 必须严格大于 add 的 at（LWW：at <= updated_at 跳过）；
    // edge 的删除时刻取「30 天整 + 60 秒」：它只钉死了「窗口内侧 60 秒
    // 不清理」，恰好整点的严格 < 语义由下面 fake-timer 的用例单独钉死
    // （真实时钟下恰好整点会被几毫秒的推进误判，测不准）。
    await repo.applyFavoriteOps(u, [
      { op: 'remove', siteId: 'old', at: now - 40 * DAY + 1 },
      { op: 'remove', siteId: 'edge', at: now - 30 * DAY + 60_000 },
      { op: 'remove', siteId: 'fresh', at: now - 1 * DAY + 1 },
    ])
    await repo.applyFavoriteOps(other, [{ op: 'remove', siteId: 'other-old', at: now - 50 * DAY + 1 }])
    expect((await repo.listTrashedFavorites(u)).map((f) => f.siteId).sort()).toEqual([
      'edge',
      'fresh',
      'old',
    ])

    const res = await repo.purgeExpiredDeletedFavorites(30 * DAY)
    // 40 天前的 old + 50 天前的 other-old；窗口内侧 60 秒的 edge
    // 暂不清理（严格 < 阈值），1 天前的不动
    expect(res.purged).toBe(2)
    expect((await repo.listTrashedFavorites(u)).map((f) => f.siteId).sort()).toEqual([
      'edge',
      'fresh',
    ])
    expect(await repo.listTrashedFavorites(other)).toHaveLength(0)
    // 未删的 alive 不受影响
    expect((await repo.listFavorites(u)).map((f) => f.siteId)).toEqual(['alive'])
  })

  it('严格 < 边界（fake-timer 定死时钟）：deleted_at 恰好等于阈值不清理，早 1ms 才清理', async () => {
    // 仓储口径是 deleted_at < 阈值（不是 <=）：恰好 30 天整的那条暂不清理。
    // 真实时钟下「恰好整点」会被 purge 调用时的几毫秒推进误判，只能用
    // fake-timer 把 Date.now() 钉死在 T0 才测得准。
    const T0 = Date.now()
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0)
      const u = 'github:u-trash-expire-exact'
      await repo.applyFavoriteOps(u, [
        { op: 'add', siteId: 'exact', at: T0 - 40 * DAY },
        { op: 'add', siteId: 'over', at: T0 - 40 * DAY },
      ])
      await repo.applyFavoriteOps(u, [
        { op: 'remove', siteId: 'exact', at: T0 - 30 * DAY },
        { op: 'remove', siteId: 'over', at: T0 - 30 * DAY - 1 },
      ])
      const res = await repo.purgeExpiredDeletedFavorites(30 * DAY)
      expect(res.purged).toBe(1)
      expect((await repo.listTrashedFavorites(u)).map((f) => f.siteId)).toEqual(['exact'])
    } finally {
      vi.useRealTimers()
    }
  })
})
