/**
 * 8e：版本快照（与撤销栈分离）—— 保存 / 列表 / 恢复 / 删除，
 * 以及「恢复在重载后仍有效」（同一份存储换一个读取方仍能读到）。
 * 只测纯存储层 lib/modular/diy-snapshots.ts；UI 接线在 local-data-manager.tsx。
 */
import { describe, expect, it } from 'vitest'
import {
  DIY_SNAPSHOTS_KEY,
  DIY_SNAPSHOT_MAX_COUNT,
  DIY_SNAPSHOT_SHARE_BACKUP_PREFIX,
  DIY_SNAPSHOT_SWITCH_AUTO_BACKUP_KEEP,
  DIY_SNAPSHOT_SWITCH_AUTO_BACKUP_PREFIX,
  deleteDiySnapshot,
  getDiySnapshot,
  listDiySnapshots,
  readDiySnapshotConfig,
  saveDiySnapshot,
  type DiySnapshotStorage,
} from '@/lib/modular/diy-snapshots'
import { STORAGE_KEY } from '@/lib/modular/home-diy-storage'

const VALID_CONFIG = {
  version: 3,
  viewMode: 'classic',
  cardDisplayMode: 'compact',
  canvasBackground: 'mesh',
  accentColor: 'default',
  categoryOrder: [],
  pinnedCategoryIds: [],
  hiddenCategoryIds: [],
  customCategories: [],
}

function makeStorage(initial: Record<string, string> = {}): DiySnapshotStorage {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
    keys: () => [...map.keys()],
  }
}

describe('diy-snapshots', () => {
  it('保存后列得出；换一个读取方（模拟重载）仍能读到同一份', () => {
    const storage = makeStorage()
    const saved = saveDiySnapshot(storage, VALID_CONFIG, '改版前')
    expect(saved).not.toBeNull()
    expect(saved!.name).toBe('改版前')
    expect(saved!.source).toBe('manual')

    // 模拟重载：全新读取，只认 storage 里的内容
    const reloaded = listDiySnapshots(storage)
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0]!.id).toBe(saved!.id)
    expect(reloaded[0]!.config.viewMode).toBe('classic')
  })

  it('恢复：读出已校验的配置；恢复后原数据仍在（可反复恢复）', () => {
    const storage = makeStorage()
    const saved = saveDiySnapshot(storage, { ...VALID_CONFIG, viewMode: 'hybrid' }, 'v1')!
    const res = readDiySnapshotConfig(storage, saved.id)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.config.viewMode).toBe('hybrid')
      expect(res.snapshot.id).toBe(saved.id)
    }
    // 恢复不删除快照
    expect(getDiySnapshot(storage, saved.id)).not.toBeNull()
  })

  it('删除：手动快照从列表里消失；不存在的 id 返回 false', () => {
    const storage = makeStorage()
    const a = saveDiySnapshot(storage, VALID_CONFIG, 'a')!
    const b = saveDiySnapshot(storage, VALID_CONFIG, 'b')!
    expect(deleteDiySnapshot(storage, a.id)).toBe(true)
    expect(listDiySnapshots(storage).map((s) => s.id)).toEqual([b.id])
    expect(deleteDiySnapshot(storage, 'no-such-id')).toBe(false)
    expect(readDiySnapshotConfig(storage, a.id).ok).toBe(false)
  })

  it('超过上限时只保留最新的 20 个', () => {
    const storage = makeStorage()
    for (let i = 0; i < DIY_SNAPSHOT_MAX_COUNT + 1; i++) {
      saveDiySnapshot(storage, VALID_CONFIG, `v${i}`)
    }
    const list = listDiySnapshots(storage)
    expect(list).toHaveLength(DIY_SNAPSHOT_MAX_COUNT)
    expect(list[0]!.name).toBe(`v${DIY_SNAPSHOT_MAX_COUNT}`)
  })

  it('写不进去（配额满）返回 null，不抛错', () => {
    const storage = makeStorage()
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(saveDiySnapshot(storage, VALID_CONFIG, 'x')).toBeNull()
  })

  it('分享前自动备份键出现在版本列表里，可恢复、可删除；损坏的跳过', () => {
    const backupKey = `${DIY_SNAPSHOT_SHARE_BACKUP_PREFIX}1780000000000`
    const corruptKey = `${DIY_SNAPSHOT_SHARE_BACKUP_PREFIX}1780000000001`
    const storage = makeStorage({
      [backupKey]: JSON.stringify({ ...VALID_CONFIG, viewMode: 'workbench' }),
      [corruptKey]: '{not json',
    })
    const list = listDiySnapshots(storage)
    expect(list).toHaveLength(1)
    expect(list[0]!.source).toBe('share-backup')
    expect(list[0]!.name).toBe('分享前自动备份')
    expect(list[0]!.createdAt).toBe(1780000000000)

    const res = readDiySnapshotConfig(storage, list[0]!.id)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.config.viewMode).toBe('workbench')

    expect(deleteDiySnapshot(storage, list[0]!.id)).toBe(true)
    expect(listDiySnapshots(storage)).toHaveLength(0)
    expect(storage.getItem(backupKey)).toBeNull()
  })

  it('手动快照列表损坏时返回空列表，不抛错', () => {
    const storage = makeStorage({ [DIY_SNAPSHOTS_KEY]: '{broken' })
    expect(listDiySnapshots(storage)).toEqual([])
  })

  it('切换前自动备份单独记账：连续 5 次切换后自动备份 ≤2 份，手动版本 1 份仍在', () => {
    const storage = makeStorage()
    const manual = saveDiySnapshot(storage, VALID_CONFIG, '手动版本')!
    for (let i = 0; i < 5; i++) {
      saveDiySnapshot(storage, VALID_CONFIG, DIY_SNAPSHOT_SWITCH_AUTO_BACKUP_PREFIX)
    }
    const list = listDiySnapshots(storage)
    const auto = list.filter((s) => s.name.startsWith(DIY_SNAPSHOT_SWITCH_AUTO_BACKUP_PREFIX))
    expect(auto.length).toBeLessThanOrEqual(DIY_SNAPSHOT_SWITCH_AUTO_BACKUP_KEEP)
    expect(auto).toHaveLength(DIY_SNAPSHOT_SWITCH_AUTO_BACKUP_KEEP)
    expect(list.some((s) => s.id === manual.id)).toBe(true)
    expect(list).toHaveLength(DIY_SNAPSHOT_SWITCH_AUTO_BACKUP_KEEP + 1)
  })

  it('手动保存不触发自动备份清理：自动备份已有 2 份时再存手动版本，自动备份不动', () => {
    const storage = makeStorage()
    for (let i = 0; i < 2; i++) {
      saveDiySnapshot(storage, VALID_CONFIG, DIY_SNAPSHOT_SWITCH_AUTO_BACKUP_PREFIX)
    }
    saveDiySnapshot(storage, VALID_CONFIG, '手动版本')
    const list = listDiySnapshots(storage)
    expect(list.filter((s) => s.name.startsWith(DIY_SNAPSHOT_SWITCH_AUTO_BACKUP_PREFIX))).toHaveLength(2)
    expect(list).toHaveLength(3)
  })

  it('STORAGE_KEY 前缀与 home-diy-storage 的分享备份键一致', () => {
    expect(DIY_SNAPSHOT_SHARE_BACKUP_PREFIX).toBe(`${STORAGE_KEY}.share-backup.`)
  })
})
