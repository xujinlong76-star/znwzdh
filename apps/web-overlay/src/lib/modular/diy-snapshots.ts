/**
 * 首页排版版本快照（8e），与撤销栈分离。
 *
 * 撤销栈（Ctrl+Z）是「操作历史」，一步步回退；快照是「命名版本」：
 * 手动「保存版本」+ 版本列表 + 一键恢复，单独存一份，不进撤销栈。
 *
 * 存储：localStorage（快照是整份 HomeDIYConfig 的 JSON，单份几 KB～几十 KB，
 * 不值得为它开 IndexedDB；写不进去就返回 null 并让调用方如实提示）。
 * 恢复是安全的：恢复前先把当前排版自动存为「恢复前自动备份」快照，
 * 且恢复本身走 commitHomeDiyConfig（压撤销栈），按 Ctrl/Cmd+Z 也能撤回。
 *
 * 另外：分享确认前自动写的 `<STORAGE_KEY>.share-backup.<时间戳>` 键，
 * 此前只有一句 toast 提到键名、没有任何恢复入口（见
 * home-diy-share-confirm-dialog.tsx）。这里把它们也收进版本列表，
 * 同一条恢复路径可用，不再是「写了就找不到」的死备份。
 */
import { validateAndCleanDIYConfig } from './diy-presets'
import { STORAGE_KEY, type HomeDIYConfig } from './home-diy-storage'

export const DIY_SNAPSHOTS_KEY = 'navhub_home_diy_snapshots_v1'
export const DIY_SNAPSHOT_MAX_COUNT = 20
export const DIY_SNAPSHOT_SHARE_BACKUP_PREFIX = `${STORAGE_KEY}.share-backup.`

export type DiySnapshotSource = 'manual' | 'share-backup'

export interface DiySnapshot {
  id: string
  name: string
  createdAt: number
  config: DiySnapshotStoredConfig
  source: DiySnapshotSource
  /** share-backup 来源才带：localStorage 里的原始键名 */
  storageKey?: string
}

/**
 * 快照里存的配置形态：从 HomeDIYConfig 派生——全部字段可选，
 * 字面量/枚举收敛为 string/number。
 *
 * 保存入口不做校验（恢复时才走 validateAndCleanDIYConfig），
 * 所以存量与调用方传来的可以是缺字段的旧版或局部配置
 * （测试里的 VALID_CONFIG 即如此）；读出恢复时一律校验补全，
 * 那时才当严格的 HomeDIYConfig 用。
 */
export type DiySnapshotStoredConfig = {
  [K in keyof HomeDIYConfig]?: HomeDIYConfig[K] extends string
    ? string
    : HomeDIYConfig[K] extends number
      ? number
      : HomeDIYConfig[K] extends boolean
        ? boolean
        : HomeDIYConfig[K]
}

/** 测试可注入的最小存储面：localStorage 的子集 + 键枚举 */
export interface DiySnapshotStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  keys(): string[]
}

export function browserDiySnapshotStorage(): DiySnapshotStorage | null {
  if (typeof window === 'undefined') return null
  try {
    const ls = window.localStorage
    return {
      getItem: (k) => ls.getItem(k),
      setItem: (k, v) => ls.setItem(k, v),
      removeItem: (k) => ls.removeItem(k),
      keys: () => {
        const out: string[] = []
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i)
          if (k) out.push(k)
        }
        return out
      },
    }
  } catch {
    return null
  }
}

function parseManualList(raw: string | null): DiySnapshot[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is DiySnapshot =>
        !!e && typeof e === 'object' && typeof e.id === 'string' && !!e.config && typeof e.config === 'object',
    )
  } catch {
    return []
  }
}

function readManualList(storage: DiySnapshotStorage): DiySnapshot[] {
  let raw: string | null = null
  try {
    raw = storage.getItem(DIY_SNAPSHOTS_KEY)
  } catch {
    return []
  }
  return parseManualList(raw)
}

function writeManualList(storage: DiySnapshotStorage, list: DiySnapshot[]): boolean {
  try {
    storage.setItem(DIY_SNAPSHOTS_KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

function shareBackupTimestamp(key: string): number {
  const ts = Number(key.slice(DIY_SNAPSHOT_SHARE_BACKUP_PREFIX.length))
  return Number.isFinite(ts) ? ts : 0
}

/**
 * 校验器输出的窄化：validateAndCleanDIYConfig 只在 valid 时返回
 * 它白名单清洗后重建的 cleaned（version 恒为 3、viewMode 为字符串），
 * 这里按它自己的有效性口径再确认一次，才当 HomeDIYConfig 用。
 */
function isHomeDIYConfig(value: unknown): value is HomeDIYConfig {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { version?: unknown }).version === 3 &&
    typeof (value as { viewMode?: unknown }).viewMode === 'string'
  )
}

/** 读出已校验的快照配置：解析失败或校验不通过返回 null（脏快照不进列表） */
function readSnapshotConfig(raw: string | null): HomeDIYConfig | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const check = validateAndCleanDIYConfig(parsed)
  const config: unknown = check.config
  return check.valid && isHomeDIYConfig(config) ? config : null
}

/**
 * 全部版本：手动快照 + 分享前自动备份（按时间倒序）。
 * 手动快照损坏（读不出）直接跳过；自动备份损坏同样跳过，不阻断列表。
 */
export function listDiySnapshots(storage: DiySnapshotStorage): DiySnapshot[] {
  const manual = readManualList(storage)
  const auto: DiySnapshot[] = []
  let keys: string[] = []
  try {
    keys = storage.keys()
  } catch {
    keys = []
  }
  for (const key of keys) {
    if (!key.startsWith(DIY_SNAPSHOT_SHARE_BACKUP_PREFIX)) continue
    const config = readSnapshotConfig(storage.getItem(key))
    if (!config) continue
    auto.push({
      id: `share-backup:${key}`,
      name: '分享前自动备份',
      createdAt: shareBackupTimestamp(key),
      config,
      source: 'share-backup',
      storageKey: key,
    })
  }
  return [...manual, ...auto].sort((a, b) => b.createdAt - a.createdAt)
}

export function getDiySnapshot(storage: DiySnapshotStorage, id: string): DiySnapshot | null {
  return listDiySnapshots(storage).find((s) => s.id === id) ?? null
}

/** 手动保存当前排版为一个版本；写不进去（配额满/隐私模式）返回 null */
export function saveDiySnapshot(
  storage: DiySnapshotStorage,
  config: DiySnapshotStoredConfig,
  name?: string,
): DiySnapshot | null {
  if (!config || typeof config !== 'object') return null
  let cloned: DiySnapshotStoredConfig
  try {
    cloned = JSON.parse(JSON.stringify(config))
  } catch {
    return null
  }
  const entry: DiySnapshot = {
    id: `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: name?.trim() || `版本 ${new Date().toLocaleString()}`,
    createdAt: Date.now(),
    config: cloned,
    source: 'manual',
  }
  const list = [entry, ...readManualList(storage)].slice(0, DIY_SNAPSHOT_MAX_COUNT)
  return writeManualList(storage, list) ? entry : null
}

/** 删除一个版本：手动快照从列表里删；分享前自动备份删原始键。失败返回 false */
export function deleteDiySnapshot(storage: DiySnapshotStorage, id: string): boolean {
  const found = getDiySnapshot(storage, id)
  if (!found) return false
  try {
    if (found.source === 'share-backup' && found.storageKey) {
      storage.removeItem(found.storageKey)
      return true
    }
    return writeManualList(
      storage,
      readManualList(storage).filter((s) => s.id !== id),
    )
  } catch {
    return false
  }
}

/** 取出某版本的配置（已校验）：不存在或损坏返回 { ok: false, reason } */
export function readDiySnapshotConfig(
  storage: DiySnapshotStorage,
  id: string,
): { ok: true; snapshot: DiySnapshot; config: HomeDIYConfig } | { ok: false; reason: string } {
  const snapshot = getDiySnapshot(storage, id)
  if (!snapshot) return { ok: false, reason: '找不到这个版本，可能已被删除' }
  const check = validateAndCleanDIYConfig(snapshot.config)
  const config: unknown = check.config
  if (!check.valid || !isHomeDIYConfig(config)) {
    return { ok: false, reason: '这个版本的数据已损坏，无法恢复' }
  }
  return { ok: true, snapshot, config }
}
