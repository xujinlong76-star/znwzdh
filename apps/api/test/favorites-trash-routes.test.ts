/**
 * 收藏回收站路由（apps/api/src/routes/favorites.ts）：
 *  GET /api/me/favorites/trash、POST .../trash/:siteId/restore、
 *  POST .../trash/restore-batch、DELETE .../trash/:siteId、DELETE .../trash。
 *
 * 钉死：
 *  - 未登录（有 userId 无签名）GET → 401；完全无身份 → 400；
 *  - 只读令牌写回收站 → 403；
 *  - 恢复不存在的 siteId → 404「回收站里没有这条收藏」；
 *  - 恢复原站点已被硬删时 404「原站点已不存在，无法恢复」，且不谎报成功
 *    （回收站里仍留着这条，GET 还能看到它）；
 *  - 批量恢复部分失败时返回成功数与失败清单（逐条独立生效，不整批回滚）；
 *  - 清空回收站需要 confirm: true（沿用 purge_trash 的口径），缺了 → 400；
 *  - 恢复后 GET /trash 里没有了、收藏列表里回来了；原夹被删时 folderLost=true
 *    且收藏回到未分组。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../src/server.ts'
import { createContext, type AppContext } from '../src/context.ts'
import { loadConfig } from '../src/config.ts'
import { signIdentity } from '../src/identity-signature.ts'

const SECRET = 'test-secret-please-rotate'
const USER = 'github:u-trash-api'
const OTHER = 'github:u-trash-api-other'

const base = {
  mode: 'lite' as const,
  embedding: {
    model: 'Xenova/bge-small-zh-v1.5',
    endpoint: 'https://hf-mirror.com',
    dtype: 'q8',
    dim: 512,
    enabled: false,
  },
  llm: { baseUrl: 'https://api.deepseek.com', apiKey: null, model: 'deepseek-chat', timeoutMs: 5000 },
  fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: 'NavHubTest/0.1' },
  corsOrigins: ['*'],
}

let dir: string
let ctx: AppContext
let app: Awaited<ReturnType<typeof buildServer>>
let catId = ''

const headersFor = (identity: string) => ({
  'x-navhub-user-id': identity,
  'x-navhub-identity-signature': signIdentity(SECRET, identity),
})

type TrashItem = {
  siteId: string
  title?: string | null
  deletedAt?: number | null
  folderName?: string | null
  site: { id: string; url: string; title: string } | null
}

type TrashList = { ok: boolean; items: TrashItem[]; total: number }

async function createToken(write: boolean): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/me/tokens',
    headers: headersFor(USER),
    payload: { name: write ? 'trash-write' : 'trash-read', write },
  })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { token: string }
  return body.token
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'navhub-trash-'))
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, 'trash.db'), identitySecret: SECRET }),
  )
  app = await buildServer(ctx)
  await app.ready()
  // 类目同级标题唯一：全文件共用一个，trashRealSite 每次建新类目会撞名
  catId = (await ctx.repo.createCategory({ title: '回收站测试' })).id
})

afterAll(async () => {
  await app.close()
  await ctx.close()
  rmSync(dir, { recursive: true, force: true })
})

/** 建一个真实站点并收藏、再删进回收站，返回 siteId */
async function trashRealSite(identity: string, url: string): Promise<string> {
  const site = await ctx.repo.createSite({ url, title: '站 ' + url, categoryId: catId })
  await ctx.repo.addFavorite({ userId: identity, siteId: site.id })
  expect(await ctx.repo.removeFavorite(identity, site.id)).toBe(true)
  return site.id
}

/** 造一条「站点已不存在」的墓碑：同步 ops 不校验站点存在（add 直接落行），
 * 所以墓碑可以指向一个从未有过站点的 siteId。purgeSite 会级联删收藏行，
 * 造不出这种状态——这是路由里 getSite 404 分支真正能命中的路径。 */
async function trashGhostSite(identity: string, siteId: string): Promise<string> {
  const at = Date.now()
  await ctx.repo.applyFavoriteOps(identity, [{ op: 'add', siteId, at }])
  await ctx.repo.applyFavoriteOps(identity, [{ op: 'remove', siteId, at: at + 1 }])
  expect((await ctx.repo.listTrashedFavorites(identity)).some((f) => f.siteId === siteId)).toBe(true)
  return siteId
}

describe('GET /api/me/favorites/trash：读墓碑列表', () => {
  it('未登录（有 userId 无签名）→ 401；完全无身份 → 400', async () => {
    const noSig = await app.inject({
      method: 'GET',
      url: '/api/me/favorites/trash',
      headers: { 'x-navhub-user-id': USER },
    })
    expect(noSig.statusCode).toBe(401)

    const noIdentity = await app.inject({ method: 'GET', url: '/api/me/favorites/trash' })
    expect(noIdentity.statusCode).toBe(400)
  })

  it('空回收站 → items []、total 0', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/favorites/trash',
      headers: headersFor(USER),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as TrashList
    expect(body.ok).toBe(true)
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
  })

  it('删除进回收站后能读到：带 site join 与 folderName；别人的回收站看不到', async () => {
    const siteId = await trashRealSite(USER, 'https://trash-a.example.com')
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/favorites/trash',
      headers: headersFor(USER),
    })
    const body = res.json() as TrashList
    expect(body.total).toBe(1)
    expect(body.items[0]!.siteId).toBe(siteId)
    expect(body.items[0]!.site?.url).toBe('https://trash-a.example.com')
    expect(body.items[0]!.deletedAt).toBeGreaterThan(0)

    const other = await app.inject({
      method: 'GET',
      url: '/api/me/favorites/trash',
      headers: headersFor(OTHER),
    })
    expect((other.json() as TrashList).total).toBe(0)

    // 清理：恢复回去，不影响后续用例
    const restored = await app.inject({
      method: 'POST',
      url: `/api/me/favorites/trash/${siteId}/restore`,
      headers: headersFor(USER),
      payload: {},
    })
    expect(restored.statusCode).toBe(200)
  })
})

describe('POST /api/me/favorites/trash/:siteId/restore：复活单条', () => {
  it('恢复不存在的 siteId → 404「回收站里没有这条收藏」', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/favorites/trash/no-such-site/restore',
      headers: headersFor(USER),
      payload: {},
    })
    expect(res.statusCode).toBe(404)
    expect((res.json() as { error: string }).error).toContain('回收站里没有这条收藏')
  })

  it('恢复后收藏列表里回来了、回收站里没了', async () => {
    const siteId = await trashRealSite(USER, 'https://trash-b.example.com')
    const res = await app.inject({
      method: 'POST',
      url: `/api/me/favorites/trash/${siteId}/restore`,
      headers: headersFor(USER),
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { ok: boolean; folderLost: boolean }
    expect(body.ok).toBe(true)
    expect(body.folderLost).toBe(false)
    expect((await ctx.repo.listFavorites(USER)).some((f) => f.siteId === siteId)).toBe(true)
    expect((await ctx.repo.listTrashedFavorites(USER)).some((f) => f.siteId === siteId)).toBe(false)
  })

  it('原收藏夹被删时恢复到未分组、folderLost=true，并在文案口径上与批量同步一致', async () => {
    const cat = await ctx.repo.createCategory({ title: '夹测试' })
    const site = await ctx.repo.createSite({
      url: 'https://trash-folder.example.com',
      title: '夹内站',
      categoryId: cat.id,
    })
    const folder = await ctx.repo.createFavoriteFolder(USER, '临时夹')
    await ctx.repo.addFavorite({ userId: USER, siteId: site.id, folderId: folder.id })
    await ctx.repo.removeFavorite(USER, site.id)
    // 直接删夹行，不走 deleteFavoriteFolder——后者会先把夹内收藏（含墓碑）
    // 的 folder_id 置 NULL，墓碑就指不到旧夹了。裸删模拟「夹行没了、
    // 墓碑还指着它」的状态，正是 restoreTrashedFavorite 里
    // FavoriteFolderNotOwnedError → folderLost 的分支。
    await ctx.repo.run('DELETE FROM favorite_folders WHERE id = ?', [folder.id])

    const res = await app.inject({
      method: 'POST',
      url: `/api/me/favorites/trash/${site.id}/restore`,
      headers: headersFor(USER),
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { folderLost: boolean }).folderLost).toBe(true)
    const alive = (await ctx.repo.listFavorites(USER)).find((f) => f.siteId === site.id)
    expect(alive).toBeDefined()
    expect(alive!.folderId).toBeNull()
  })

  it('原站点已被硬删时 404 且不谎报成功；回收站里仍留着这条', async () => {
    const siteId = await trashGhostSite(USER, 'ghost-site-gone')
    const res = await app.inject({
      method: 'POST',
      url: `/api/me/favorites/trash/${siteId}/restore`,
      headers: headersFor(USER),
      payload: {},
    })
    expect(res.statusCode).toBe(404)
    expect((res.json() as { error: string }).error).toContain('原站点已不存在，无法恢复')
    // 没谎报成功：墓碑还在，GET 还能看到它（前端据此标"原站点已不存在，无法恢复"）
    const list = await app.inject({
      method: 'GET',
      url: '/api/me/favorites/trash',
      headers: headersFor(USER),
    })
    expect((list.json() as TrashList).items.some((i) => i.siteId === siteId)).toBe(true)
    // 清理：物理删掉这条墓碑
    const purged = await app.inject({
      method: 'DELETE',
      url: `/api/me/favorites/trash/${siteId}`,
      headers: headersFor(USER),
    })
    expect(purged.statusCode).toBe(200)
  })

  it('只读令牌恢复 → 403', async () => {
    const siteId = await trashRealSite(USER, 'https://trash-ro.example.com')
    const token = await createToken(false)
    const res = await app.inject({
      method: 'POST',
      url: `/api/me/favorites/trash/${siteId}/restore`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {},
    })
    expect(res.statusCode).toBe(403)
    // 恢复回去清理
    const restored = await app.inject({
      method: 'POST',
      url: `/api/me/favorites/trash/${siteId}/restore`,
      headers: headersFor(USER),
      payload: {},
    })
    expect(restored.statusCode).toBe(200)
  })
})

describe('POST /api/me/favorites/trash/restore-batch：批量恢复（部分成功）', () => {
  it('一条能恢复、一条原站点已硬删、一条不在回收站 → 返回成功数与失败清单', async () => {
    const good = await trashRealSite(USER, 'https://trash-batch-good.example.com')
    const gone = await trashGhostSite(USER, 'ghost-site-batch-gone')
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/favorites/trash/restore-batch',
      headers: headersFor(USER),
      payload: { siteIds: [good, gone, 'never-trashed'] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      ok: boolean
      restored: string[]
      failed: Array<{ siteId: string; error: string }>
    }
    expect(body.ok).toBe(true)
    // 逐条独立生效：能恢复的回来了，失败的不整批回滚
    expect(body.restored).toEqual([good])
    expect(body.failed.map((f) => f.siteId).sort()).toEqual([gone, 'never-trashed'].sort())
    expect(body.failed.find((f) => f.siteId === gone)!.error).toContain('原站点已不存在')
    expect(body.failed.find((f) => f.siteId === 'never-trashed')!.error).toContain(
      '回收站里没有这条收藏',
    )
    expect((await ctx.repo.listFavorites(USER)).some((f) => f.siteId === good)).toBe(true)
    // 清理 gone 的墓碑
    await app.inject({
      method: 'DELETE',
      url: `/api/me/favorites/trash/${gone}`,
      headers: headersFor(USER),
    })
  })

  it('siteIds 为空 → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/favorites/trash/restore-batch',
      headers: headersFor(USER),
      payload: { siteIds: [] },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /api/me/favorites/trash/:siteId 与 DELETE /api/me/favorites/trash', () => {
  it('彻底删除不存在的墓碑 → 404；能删的删完 GET 里没了', async () => {
    const missing = await app.inject({
      method: 'DELETE',
      url: '/api/me/favorites/trash/no-such-site',
      headers: headersFor(USER),
    })
    expect(missing.statusCode).toBe(404)

    const siteId = await trashRealSite(USER, 'https://trash-purge.example.com')
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/me/favorites/trash/${siteId}`,
      headers: headersFor(USER),
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { ok: boolean; purged: boolean }).purged).toBe(true)
    expect((await ctx.repo.listTrashedFavorites(USER)).some((f) => f.siteId === siteId)).toBe(false)
  })

  it('清空回收站需要 confirm: true（沿用 purge_trash 的口径），缺了 → 400', async () => {
    const a = await trashRealSite(USER, 'https://trash-clear-a.example.com')
    const b = await trashRealSite(USER, 'https://trash-clear-b.example.com')

    const noBody = await app.inject({
      method: 'DELETE',
      url: '/api/me/favorites/trash',
      headers: headersFor(USER),
    })
    expect(noBody.statusCode).toBe(400)
    const wrong = await app.inject({
      method: 'DELETE',
      url: '/api/me/favorites/trash',
      headers: headersFor(USER),
      payload: { confirm: false },
    })
    expect(wrong.statusCode).toBe(400)
    // 没清掉
    expect((await ctx.repo.listTrashedFavorites(USER)).length).toBeGreaterThanOrEqual(2)

    const ok = await app.inject({
      method: 'DELETE',
      url: '/api/me/favorites/trash',
      headers: headersFor(USER),
      payload: { confirm: true },
    })
    expect(ok.statusCode).toBe(200)
    expect((ok.json() as { ok: boolean; purged: number }).purged).toBeGreaterThanOrEqual(2)
    expect(await ctx.repo.listTrashedFavorites(USER)).toHaveLength(0)
    void a
    void b
  })

  it('只读令牌清空回收站 → 403', async () => {
    const token = await createToken(false)
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/me/favorites/trash',
      headers: { Authorization: `Bearer ${token}` },
      payload: { confirm: true },
    })
    expect(res.statusCode).toBe(403)
  })
})
