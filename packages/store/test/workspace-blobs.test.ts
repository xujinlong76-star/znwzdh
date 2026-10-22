import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/driver'
import { Repository } from '../src/repository'

/**
 * M3：工作区明文迁出 E2EE 表。
 *
 * 旧版本把 `workspaces:<id>` / `ws_members:<id>:<wsId>` 明文写进 user_vault_sync
 * （该表建表注释声明「仅存密文」）。迁移必须幂等且不得丢数据：
 * 打开旧库 → 明文键复制进 user_workspace_blobs → vault 里的旧行删除。
 */
describe('工作区明文迁移（M3）', () => {
  let dir = ''
  let db: Db

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'navhub-ws-'))
  })

  afterAll(async () => {
    await db?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('旧 vault 键被搬进专用表，vault 回归纯密文；迁移幂等', async () => {
    const path = join(dir, 'legacy.db')
    // 第一次打开：建库 + 迁移（此时无数据）
    db = await openDb({ dialect: 'sqlite', sqlitePath: path })
    const repo = new Repository(db)
    // 模拟旧版本写入：workspaces 明文落在 vault 表
    const now = Date.now()
    await repo.run('INSERT INTO user_vault_sync (user_id, payload, version, updated_at) VALUES (?,?,?,?)', [
      'workspaces:github:legacy',
      JSON.stringify([{ id: 'ws-x', name: '旧空间' }]),
      1,
      now,
    ])
    await repo.run('INSERT INTO user_vault_sync (user_id, payload, version, updated_at) VALUES (?,?,?,?)', [
      'ws_members:github:legacy:ws-x',
      JSON.stringify([{ identity: 'github:legacy', role: 'owner' }]),
      1,
      now,
    ])
    // 真金库（密文）必须原样保留
    await repo.run('INSERT INTO user_vault_sync (user_id, payload, version, updated_at) VALUES (?,?,?,?)', [
      'github:legacy',
      'ciphertext-blob',
      1,
      now,
    ])
    await db.close()

    // 第二次打开：触发迁移
    db = await openDb({ dialect: 'sqlite', sqlitePath: path })
    const repo2 = new Repository(db)
    const blobs = await repo2.raw(
      "SELECT user_id, payload FROM user_workspace_blobs ORDER BY user_id",
    )
    expect(blobs.map((b) => String(b.user_id))).toEqual([
      'workspaces:github:legacy',
      'ws_members:github:legacy:ws-x',
    ])
    expect(String(blobs[1].payload)).toContain('owner')
    // vault 只剩密文本体
    const vaultRows = await repo2.raw('SELECT user_id FROM user_vault_sync')
    expect(vaultRows.map((r) => String(r.user_id))).toEqual(['github:legacy'])
    await db.close()

    // 第三次打开：迁移幂等（不重复、不报错、数据不变）
    db = await openDb({ dialect: 'sqlite', sqlitePath: path })
    const repo3 = new Repository(db)
    const again = await repo3.raw('SELECT COUNT(*) AS c FROM user_workspace_blobs')
    expect(Number(again[0].c)).toBe(2)
    const vaultAgain = await repo3.raw('SELECT COUNT(*) AS c FROM user_vault_sync')
    expect(Number(vaultAgain[0].c)).toBe(1)
  })
})
