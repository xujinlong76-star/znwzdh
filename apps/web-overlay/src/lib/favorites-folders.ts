/**
 * 本地收藏夹（P2：匿名用户也能组织收藏）。
 *
 * 背景：收藏夹此前**只有云端一份**——`/favorites` 的文件夹面板在 `cloudIdentity`
 * 为空时整块不渲染。于是匿名用户能收藏、能导出，却不能分组，而页面文案一直说着
 * "无需登录"（能力与承诺不对等）。
 *
 * 设计约束（都很硬）：
 *  1. **只能加新 localStorage 键**：`navhub.favorites.v1` 等既有键名与结构不可改
 *     （仓库注释明示"改了等于丢老用户收藏"）。这里用全新的
 *     `navhub.favorites.folders.v1`，与收藏本体分开存，互不影响。
 *  2. **登录后云端是事实源**：本地夹子在同步时按名称推送到云端（同名复用、异名新建），
 *     之后以云端 id 为准；本地表只作为匿名期与离线的缓存。
 *  3. **id 必须可区分来源**：本地 id 带 `local-` 前缀，云端 id 是 uuid。
 *     混用会让"这个 folderId 到底该推给谁"变得不可判定——同步分支正是靠这个区分。
 */
/** 与 lib/identity.ts 同一套降级：没有 crypto.randomUUID 的环境仍要能建夹子 */
function randomId(): string {
  const c = globalThis as { crypto?: { randomUUID?: () => string } }
  if (typeof c.crypto?.randomUUID === 'function') return c.crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export const LOCAL_FOLDER_PREFIX = 'local-'

export interface LocalFolder {
  id: string
  name: string
  sort: number
  createdAt: number
}

/** 收藏夹名：与云端一致的上限（30），前后空白不算长度 */
export const FOLDER_NAME_MAX = 30

/** 生成本地收藏夹 id（前缀 + uuid，便于与云端 id 区分） */
export function newLocalFolderId(): string {
  return LOCAL_FOLDER_PREFIX + randomId()
}

/** 是否为本地收藏夹 id */
export function isLocalFolderId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(LOCAL_FOLDER_PREFIX)
}

/** 名称归一化：去空白 + 截断；空名称返回 null（调用方据此拒绝创建） */
export function normalizeFolderName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim().slice(0, FOLDER_NAME_MAX)
  return name.length > 0 ? name : null
}

/**
 * 解析本地存储里的收藏夹列表。
 *
 * 存储损坏 / 结构不符时返回空数组而不是抛错：与收藏本体的 `loadLocal` 不同，
 * 这里没有"原样保留坏数据等用户决定"的必要——夹子是衍生数据，最坏结果是用户
 * 重新建几个分组，而抛错会让整个收藏页打不开。
 */
export function parseLocalFolders(raw: string | null): LocalFolder[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: LocalFolder[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const name = normalizeFolderName(row.name)
    if (!name) continue
    const id = typeof row.id === 'string' && row.id ? row.id : newLocalFolderId()
    out.push({
      id,
      name,
      sort: Number.isFinite(row.sort) ? Number(row.sort) : 0,
      createdAt: Number.isFinite(row.createdAt) ? Number(row.createdAt) : 0,
    })
  }
  return out
}

export function serializeLocalFolders(folders: LocalFolder[]): string {
  return JSON.stringify(folders)
}

/** 新建：重名直接拒绝（云端也没有 (user_id,name) 唯一约束，但 UI 上重名无法区分） */
export function addLocalFolder(
  folders: LocalFolder[],
  name: string,
  now: number,
): { ok: true; folders: LocalFolder[]; folder: LocalFolder } | { ok: false; error: string } {
  const normalized = normalizeFolderName(name)
  if (!normalized) return { ok: false, error: '收藏夹名称不能为空' }
  if (folders.some((f) => f.name === normalized)) return { ok: false, error: '已存在同名收藏夹' }
  const folder: LocalFolder = {
    id: newLocalFolderId(),
    name: normalized,
    sort: folders.length,
    createdAt: now,
  }
  return { ok: true, folders: [...folders, folder], folder }
}

export function renameLocalFolder(folders: LocalFolder[], id: string, name: string): LocalFolder[] {
  const normalized = normalizeFolderName(name)
  if (!normalized) return folders
  return folders.map((f) => (f.id === id ? { ...f, name: normalized } : f))
}

/**
 * 删除收藏夹：返回新列表 + 受影响的收藏数。
 * 与云端语义一致——文件夹下的收藏**不删**，只是失去分组（folderId 置空）。
 */
export function removeLocalFolder(
  folders: LocalFolder[],
  id: string,
): { folders: LocalFolder[]; affected: number } {
  return { folders: folders.filter((f) => f.id !== id), affected: 0 }
}

/** 每个收藏夹下的条目数（用于文件夹胶囊上的计数） */
export function countByFolder<T extends { folderId?: string | null }>(
  items: T[],
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = item.folderId ?? ''
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * 本地夹子 → 云端推送计划（登录同步时用）。
 *
 * 规则：按名称匹配云端已有夹子——同名则复用其 id（本地引用改指向云端 id），
 * 异名则新建。返回 `mapping`（本地 id → 云端 id）供调用方改写收藏的 folderId。
 */
export function planFolderUpload(
  local: LocalFolder[],
  remote: Array<{ id: string; name: string }>,
): { mapping: Map<string, string>; toCreate: LocalFolder[] } {
  const mapping = new Map<string, string>()
  const remoteByName = new Map(remote.map((r) => [r.name, r]))
  const toCreate: LocalFolder[] = []
  for (const folder of local) {
    const hit = remoteByName.get(folder.name)
    if (hit) mapping.set(folder.id, hit.id)
    else toCreate.push(folder)
  }
  return { mapping, toCreate }
}
