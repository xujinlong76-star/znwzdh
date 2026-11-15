'use client'

/**
 * 收藏夹 v1：localStorage 优先，不依赖登录。
 *
 * 演进路径（Phase 2 已就绪的服务端）：登录后把本地收藏合并到云端
 * （POST /api/favorites），之后以云端为准、本地只作离线缓存。
 * 合并策略：按 siteId 取并集，createdAt 新者胜。
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  addFavorite,
  listFavorites,
  removeFavorite,
  syncFavoritesBatch,
  type FavoriteSyncOp,
  type HubFavorite,
  type HubFavoriteFolder,
  type HubFavoriteSyncItem,
  type HubFavoritesSyncPayload,
} from '@/lib/navhub-api'
import { describeDegrade } from '@/lib/degrade'
import { recordGrowthEvent } from '@/lib/growth-lazy'
import { mergeCloudFavorites } from '@/lib/favorites-merge'
import { fingerprintUrl } from '@/lib/import-workbench'
import { normalizeQuicklinkPrefix, validateQuicklink } from '@/lib/quicklinks'
import { getIdentity } from '@/lib/identity'
import {
  FAVORITES_STORAGE_KEY,
  corruptBackupKey,
  describeCorruptFavorites,
  parseFavorites,
} from '@/lib/favorites-storage'
import {
  enterInbox,
  markTriageRead,
  promoteToPermanent,
  readTriageSettings,
  renewInbox,
  resolveTriageStatus,
  settleTriage,
  type TriageSettings,
} from '@/lib/favorites-triage'
import {
  readShelvedFavorites,
  shelveItems,
  unshelveItems,
  writeShelvedFavorites,
} from '@/lib/favorites-shelved'
import {
  addManualHibernated,
  readManualHibernated,
  removeManualHibernated,
  writeManualHibernated,
} from '@/lib/favorites-hibernation'
/**
 * 全局撤销（第 1 层：8 秒内存撤销）+ 回收站（第 2 层：30 天持久快照）。
 * 删除与写回收站同一次 persist 语义内完成：先改 navhub.favorites.v1，
 * persist 成功后再把快照推进回收站键——persist 失败时回收站里不留
 * 「没删成」的快照；写回收站失败时删除仍执行，但 trashError
 * 会把失败报出来（该条只能靠云端墓碑恢复，文案需诚实）。
 */
import {
  UNDO_WINDOW_MS,
  clearGlobalUndo,
  newUndoBatchId,
  newUndoId,
  popGlobalUndo,
  pushGlobalUndo,
  type UndoEntry,
} from '@/lib/undo-stack'
import {
  addToTrash,
  insertRestoredFavorites,
  pruneExpiredTrash,
  readTrash,
  removeFromTrash,
  writeTrash,
  type TrashedFavorite,
  type TrashSource,
} from '@/lib/favorites-trash'

const KEY = FAVORITES_STORAGE_KEY

export interface LocalFavorite {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  note?: string
  /** 标签（T22）：≤8 个、各 ≤24 字符（写入端截断归一）；undefined = 未打标签 */
  tags?: string[]
  /** 云端收藏夹 id（匿名/离线时为空，登录后由云端元数据合并） */
  folderId?: string | null
  createdAt: number
  /**
   * 上次从「重温」入口打开的时间（本机私有，见 lib/resurface）。
   * 只由 recordOpened 写：不置脏、不推云端——同步 ops 只带
   * folderId/note/tags，打开时间不是收藏内容；云端合并（mergeCloudFavorites /
   * applyFavoriteDelta）都从本地缓存 spread 保留它，同步不会把它洗掉。
   */
  lastOpenedAt?: number
  /**
   * 参数化快捷链接（Quicklink，v1 本地 only）：
   * quickPrefix 是归一后的前缀（小写、不含 `!`，如 gh），templateUrl 是
   * 含恰好一个 `{q}` 的绝对 http(s) URL。href 保持站点本身地址，
   * 不要把模板塞进 href。判定：templateUrl 存在当且仅当是 quicklink。
   * 云端同步不带这两个字段（FavoriteSyncOp 与服务端 zod 只有
   * siteId/folderId/note/tags），换设备会丢模板——已定，Phase 2 再做。
   */
  quickPrefix?: string
  templateUrl?: string
  /**
   * 待读分流（v1 本地 only，不进同步 ops、不进云端）：
   * triageStatus 缺失 = permanent（祖父规则：老收藏没有分流字段，
   * 绝不能把存量收藏扫进 24 小时箱）；triageAt 是进入当前状态的毫秒时间戳，
   * 缺失时回退 createdAt。云端合并（mergeCloudFavorites / applyFavoriteDelta）
   * 都从本地缓存 spread 保留它，同步不会把它洗掉；云端新条目没有它 → permanent。
   */
  triageStatus?: 'inbox' | 'read' | 'permanent'
  triageAt?: number
}

/**
 * 读本地收藏。**必须把「读不出来」和「没有数据」分开**：
 * 以前的 `catch { return [] }` 让「存储坏了」和「还没收藏过」看起来一模一样，
 * 紧接着任何一次写入就会把用户的收藏覆盖成一条新记录。
 */
function loadLocal(): { items: LocalFavorite[]; blocked: string | null } {
  if (typeof window === 'undefined') return { items: [], blocked: null }
  let raw: string | null
  try {
    raw = window.localStorage.getItem(KEY)
  } catch {
    // 连读都不让读（隐私模式 / 权限被拒）：同样不能拿空列表去覆盖，
    // 但要说清楚是「存储不可用」，而不是「数据损坏」
    return {
      items: [],
      blocked: '浏览器不允许读写本地存储（隐私模式或权限被拒），本次收藏改动无法保存。',
    }
  }
  const { items, corrupt } = parseFavorites<LocalFavorite>(raw)
  return { items, blocked: corrupt ? describeCorruptFavorites() : null }
}

function saveLocal(items: LocalFavorite[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items))
    return true
  } catch {
    // 存储满 / 隐私模式：内存态仍然有效，刷新丢失。
    // 返回 false 让调用方按「写盘失败」处理——绝不能让调用方以为已落盘，
    // 否则本机与云端会静默分叉（见 settleFavoritesOnLoad）。
    return false
  }
}

export interface UpdateMetaOpts {
  /** false = 不推撤销条（登录迁移重映射、删夹恢复等内部调用） */
  pushUndo?: boolean
  /** 撤销时刻（毫秒）：同步 add op 的 at 用它而不是 createdAt，否则 LWW
   *  会被墓碑的 updated_at 挡掉，撤销在云端活不过来 */
  restoreAt?: number
  /** 移夹撤销条的主文案（调用方知道目标夹名时传，如 "已将 1 条收藏移至「X」"） */
  undoLabel?: string
  /** 移夹撤销条合并用的目标夹名（批量移夹合并后重算文案用） */
  undoDetail?: string
}

export interface ClearOpts {
  /** false = 不推撤销条（账号删除：云端已清空，撤销无意义）。
   *  同时也不写回收站快照——账号删除只清收藏本体，绝不碰回收站键
   *  navhub.favorites.trash.v1；trash 键本身绝不被清掉，旧快照保留。 */
  pushUndo?: boolean
  /** 清空时一并被清掉的夹子快照（clearCloud 还 setFolders([]) 时传） */
  folders?: Array<{ id: string; name: string; sort: number; createdAt: number }>
  /** 撤销清空时把夹子恢复回去（调用方提供 setFolders/setLocalFolders 闭包） */
  restoreFolders?: (folders: Array<{ id: string; name: string; sort: number; createdAt: number }>) => void
}

export interface FavoritesApi {
  items: LocalFavorite[]
  ready: boolean
  /**
   * 非 null 时表示**存储读不出来**：此时所有写入都会被拒绝（原样保留坏数据，
   * 等着用户决定是备份重置还是另作处理）。界面必须把这句话显示出来，
   * 否则用户点收藏会「没反应」—— 那比原来的静默覆盖更让人困惑。
   */
  storageBlocked: string | null
  isFavorite: (siteId: string) => boolean
  toggle: (site: Omit<LocalFavorite, 'createdAt'>) => Promise<boolean>
  remove: (siteId: string) => void
  /**
   * 撤销最近一次可撤销操作（栈顶，8 秒窗口内）。
   * 无条目 / 已过期时 ok=false；条消失 = 撤销失效（D1），后备是回收站 30 天。
   */
  undoLast: () => Promise<{ ok: boolean; message?: string }>
  /** 回收站里的条目（本机，订阅 navhub_trash_updated 刷新） */
  trashItems: TrashedFavorite[]
  /** 回收站条数（收藏页角标用） */
  trashCount: number
  /** 最近一次写回收站失败的原因（配额满等）；有值时页面必须显示出来 */
  trashError: string | null
  /**
   * 从回收站恢复：按原位插回（已有同站时跳过），置脏并记恢复时刻供同步
   * LWW 用。返回实际恢复 / 跳过的 siteId（写不进去时 restored 为空）。
   */
  restoreFavorites: (
    items: Array<LocalFavorite & { index?: number }>,
  ) => { restored: string[]; skipped: string[] }
  /** 收藏管理：更新本地缓存的文件夹/备注（云端写入由调用方 best-effort 处理） */
  updateMeta: (siteId: string, patch: { folderId?: string | null; note?: string | null; tags?: string[] | null; quickPrefix?: string | null; templateUrl?: string | null }, opts?: UpdateMetaOpts) => boolean
  /**
   * 记一次「从重温入口打开」：只写本机 lastOpenedAt，不置脏、不调云端。
   * 打开时间是本机行为记录，不是收藏内容——推上云端没有消费方，还会让
   * 每次重温都产生一次无意义的同步 op。now 可注入（测试用确定时钟）。
   * 待读分流：inbox 条目同时完成 inbox → read 跃迁（triageAt = now）；
   * read 再打开不动（不续 30 天），permanent 打开不变。
   */
  recordOpened: (siteId: string, now?: number) => boolean
  /** 待读分流：把一条收藏晋升到永久库（inbox/read → permanent，不可逆向自动降级） */
  promoteFavorite: (siteId: string, now?: number) => boolean
  /** 待读分流：待读箱内一键续期（triageAt = now，重新获得完整窗口，仍在 inbox） */
  renewInbox: (siteId: string, now?: number) => boolean
  /** 待读分流：手动移出（仅 inbox/read 进已移出区；写已移出区失败时不移出） */
  shelveFavorite: (siteId: string, now?: number) => boolean
  /**
   * 待读分流：从已移出区恢复一条收藏。destination 默认 permanent；
   * 选 inbox 时重新打上待读戳（分流开关关着时回落到 permanent）。
   */
  restoreShelved: (
    siteId: string,
    destination?: 'inbox' | 'permanent',
    now?: number,
  ) => { ok: boolean; error?: string }
  /** 待读分流：从已移出区逐条真删除（调用方先二次确认） */
  deleteShelved: (siteId: string) => boolean
  /** 待读分流：清空已移出区（调用方先二次确认，文案写明不可恢复） */
  clearShelved: () => boolean
  /**
   * 冬眠收藏：手动冬眠一条永久收藏（只写本机手动集合，不移出、不删除、
   * 不置脏、不推云端）。待读箱 / 已读不参与——它们有自己的到期流转。
   * 写不进去返回 false，收藏留在原处。
   */
  hibernateFavorite: (siteId: string, now?: number) => boolean
  /**
   * 冬眠收藏：唤醒一条收藏（移出手动集合 + 记一次打开，天数归零，
   * 自动冬眠的同样靠打开唤醒）。写不进去返回 false，不留半截状态。
   */
  wakeFavorite: (siteId: string, now?: number) => boolean
  /**
   * 本次打开时结算移出的条数（>0 时页面要给用户一次可见提示，绝不静默）。
   * 后续写入不重置它——横幅由页面自己的「知道了」状态关掉。
   */
  settledExpiredCount: number
  /** 结算时写已移出区失败的原因（有值时收藏留在原处，页面要把原因显示出来） */
  triageSettleError: string | null
  /** 删除收藏夹后批量置空 folderId（一次持久化 + 一次脏标记，T16） */
  clearFolderForItems: (siteIds: string[]) => boolean
  /** 登录同步成功后用云端列表整体替换本地（云端是事实源，避免删除被本地缓存复活） */
  replaceAll: (items: LocalFavorite[]) => boolean
  /**
   * 清空全部收藏：进撤销条 + 回收站（D7：清空保留两步按钮确认，但确认后
   * 同样进撤销条 + 回收站）。账号删除时传 { pushUndo: false }（云端已
   * 清空，撤销无意义）；回收站快照照写，trash 键本身绝不被清掉。
   */
  clear: (opts?: ClearOpts) => void
  /**
   * 为下一次 clear() 登记「撤销时连夹子一起恢复」的快照。
   *
   * 为什么要拆成两次调用：清空云端入口的接线被 identity-ready 守卫钉死为
   * 无参 `favorites.clear()`（见 app/favorites/page.tsx 的 clearCloud），
   * 夹子快照不能再走 clear 的 opts 参数；改由本方法在 clear() 之前同步
   * 登记，clear() 消费一次后即失效（与 opts 混用时 opts 优先）。
   * 登记与 clear() 之间不许 await：否则别的 clear 可能先把它消费掉。
   */
  prepareClearRestore: (
    folders: NonNullable<ClearOpts['folders']>,
    restoreFolders: NonNullable<ClearOpts['restoreFolders']>,
  ) => void
  /**
   * 用户显式重置：先把读不出来的原数据备份到隔离键，再写空列表。
   * 返回值说明备份到底成没成 —— 调用方要照着它措辞，不能一律说「已备份」
   * （配额满时原数据其实没留住，那句承诺会让用户以为还能找回）。
   */
  resetLocal: () => { backedUp: boolean }
  exportJson: () => string
  /**
   * `imported` 是本次实际新增数（第 2 批第 11 项诚实性修复：旧语义把
   * “通过校验的条数”都算成新增，已存在 100 条再导同一文件也会报
   * “已导入 100 条”）；`updated` 是指纹已存在、字段不同而被更新的
   * 已存条目数；`alreadyExisted` 是已存在且内容一致被跳过的条数；
   * `addedSiteIds` 是本次新增的 siteId，供导入撤销（favorite.import-batch）用。
   * 合并键是指纹（fingerprintUrl，SSOT），siteId 生成本身不动。
   */
  importJson: (json: string) => {
    ok: boolean
    imported: number
    updated: number
    alreadyExisted: number
    addedSiteIds: string[]
    skippedInvalid: number
    error?: string
  }
}

/* ---------------------------- 模块级共享状态 ---------------------------- */

type FavoritesSnapshot = {
  items: LocalFavorite[]
  blocked: string | null
  settledExpiredCount: number
  triageSettleError: string | null
  /** 最近一次写回收站失败的原因；null = 最近一次写回收站成功（或未写过） */
  trashError: string | null
}

let sharedFavorites: LocalFavorite[] = []
let sharedBlocked: string | null = null
let favoritesSnapshot: FavoritesSnapshot = {
  items: sharedFavorites,
  blocked: sharedBlocked,
  settledExpiredCount: 0,
  triageSettleError: null,
  trashError: null,
}
let favoritesInitialized = false
const favoritesListeners = new Set<() => void>()

/**
 * 唯一写入口：更新模块状态并同步通知所有订阅实例。
 * snapshot 必须换新引用，useSyncExternalStore 才会判定为变更。
 * settledExpiredCount / triageSettleError 不传时沿用旧值——日常写入
 * （toggle / recordOpened …）不该把「本次打开结算移出了 N 条」的横幅悄悄清掉。
 */
function applyLocalFavorites(next: {
  items: LocalFavorite[]
  blocked: string | null
  settledExpiredCount?: number
  triageSettleError?: string | null
  trashError?: string | null
}) {
  sharedFavorites = next.items
  sharedBlocked = next.blocked
  favoritesSnapshot = {
    items: next.items,
    blocked: next.blocked,
    settledExpiredCount: next.settledExpiredCount ?? favoritesSnapshot.settledExpiredCount,
    triageSettleError: next.triageSettleError ?? favoritesSnapshot.triageSettleError,
    trashError: next.trashError ?? favoritesSnapshot.trashError,
  }
  for (const listener of favoritesListeners) listener()
}

/** 写回收站失败时把原因记进快照（页面必须显示出来，不能静默） */
function reportTrashError(message: string | null): void {
  applyLocalFavorites({ items: sharedFavorites, blocked: sharedBlocked, trashError: message })
}

/**
 * 恢复时刻覆盖（撤销的 at 专用）。
 *
 * 为什么需要：同步 add op 的 at 默认取 f.createdAt；撤销恢复的条目在云端
 * 是一块 updated_at=删除时刻的墓碑，createdAt 一定比它旧，LWW 会把这次
 * add 直接跳过——撤销在云端活不过来，下次拉取又把本地恢复删掉。
 * 所以撤销恢复时把 at 记成撤销时刻（Date.now()），同步时优先用它；
 * 一次成功同步后清掉（已获云端确认，不再需要覆盖）。
 * 落 localStorage：刷新后同步仍要靠它，内存态不够。
 */
const RESTORE_AT_KEY = 'navhub.favorites.restore-at.v1'

export function readRestoreAtOverrides(): Record<string, number> {
  try {
    if (typeof window === 'undefined') return {}
    const raw = window.localStorage.getItem(RESTORE_AT_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeRestoreAtOverrides(next: Record<string, number>): void {
  try {
    if (typeof window === 'undefined') return
    if (Object.keys(next).length === 0) window.localStorage.removeItem(RESTORE_AT_KEY)
    else window.localStorage.setItem(RESTORE_AT_KEY, JSON.stringify(next))
  } catch {
    // 写不进去只影响「撤销后同步的 LWW 胜负」，本次会话内存态仍可用——
    // 内存态没有第二份，所以这里不留内存后备：失败即按无覆盖处理，
    // 调用方（同步）不会因此谎报成功。
  }
}

function setRestoreAt(siteIds: string[], at: number): void {
  if (siteIds.length === 0) return
  const next = readRestoreAtOverrides()
  for (const id of siteIds) next[id] = at
  writeRestoreAtOverrides(next)
}

function clearRestoreAt(siteIds: string[]): void {
  if (siteIds.length === 0) return
  const next = readRestoreAtOverrides()
  let changed = false
  for (const id of siteIds) {
    if (id in next) {
      delete next[id]
      changed = true
    }
  }
  if (changed) writeRestoreAtOverrides(next)
}

/** 仅供测试隔离（生产代码不要调用） */
export function __resetRestoreAtForTests(): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(RESTORE_AT_KEY)
  } catch {
    // 忽略
  }
}

/**
 * 模块级持久化（hook 的 persist 与撤销闭包共用同一份）：
 * storageBlocked 时拒绝一切写入（含撤销写入），绝不覆盖原数据。
 */
function persistLocalFavorites(next: LocalFavorite[]): boolean {
  if (sharedBlocked) return false
  applyLocalFavorites({ items: next, blocked: sharedBlocked })
  return saveLocal(next)
}

/**
 * 删除前快照进回收站（写回收站先剪枝；失败只报 trashError，不拦删除）。
 * 返回 false = 写回收站失败（删除本身仍继续，调用方不得因此回滚）。
 */
function snapshotToTrash(
  removed: Array<{ item: LocalFavorite; index: number }>,
  source: TrashSource,
  batchId: string,
  now: number,
): boolean {
  if (removed.length === 0) return true
  const current = pruneExpiredTrash(readTrash(), now)
  const next = addToTrash(
    current,
    removed.map((r) => ({ ...r.item, index: r.index, source })),
    batchId,
    now,
    source,
  )
  if (!writeTrash(next)) {
    reportTrashError('回收站写不进去（本机存储写不进去），这次删除只能靠云端墓碑恢复')
    return false
  }
  reportTrashError(null)
  return true
}

/** 把一批 siteId 从回收站里清掉（恢复成功后调用；失败不影响恢复本身） */
function dropFromTrash(siteIds: string[]): void {
  if (siteIds.length === 0) return
  const state = readTrash()
  let next = state
  for (const id of siteIds) {
    next = removeFromTrash(next, id).state
  }
  if (next !== state) writeTrash(next)
}

export type RemovedFavoriteSnapshot = { item: LocalFavorite; index: number }

/** 仅供测试：直接设定模块级共享收藏（不走 React hook、不写盘） */
export function __setSharedFavoritesForTests(items: LocalFavorite[], blocked: string | null = null): void {
  applyLocalFavorites({ items, blocked, trashError: null })
}

/** 仅供测试：读模块级共享收藏 */
export function __getSharedFavoritesForTests(): LocalFavorite[] {
  return sharedFavorites
}

/** 仅供测试隔离：清空共享收藏 + 脏标记 + 恢复时刻覆盖 + 全局撤销栈 */
export function __resetFavoritesForTests(): void {
  sharedFavorites = []
  sharedBlocked = null
  favoritesSnapshot = { items: [], blocked: null, settledExpiredCount: 0, triageSettleError: null, trashError: null }
  memoryDirty = null
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(DIRTY_KEY)
      window.localStorage.removeItem(RESTORE_AT_KEY)
    }
  } catch {
    // 忽略
  }
  clearGlobalUndo()
}

/**
 * 删除的本地核心（remove / toggle 取消分支 / clear 共用）：
 * 先改 navhub.favorites.v1，persist 成功后再把快照推进回收站键。
 * persist 失败返回 null（调用方按「没删成」处理，不推云端、不推撤销条），
 * 且回收站里不留「没删成」的快照；写回收站失败仍按现有设计报 trashError
 * 不拦删除（该条只能靠云端墓碑恢复）。
 * opts.expectedCreatedAt（11b CAS）：只删 createdAt 与期望一致的条目；
 * 不一致的跳过（不删、不进 trash），计入返回值 skippedSiteIds。
 * 无 opts 时与原来完全一致。
 * 11b：persist 成功后内部 markDirty（实际删掉的 siteId 集）——脏标记
 * 不能只靠 hook 的 remove / toggle 在外层补：pin 撤销（lib/home-batch-undo
 * 的闭包）与导入撤销（bookmark-importer 的 undoRun）都直接调本函数，
 * 调不到模块私有的 markDirty；若 pin 与撤销之间已发生过一次云端同步，
 * 外层不补、内部不置脏，撤销的 remove op 就不会再派生、云端残留该收藏。
 * 内部置脏对已有调用方无害：markDirty 是 Set 并集、幂等（重复调同一批
 * id 不产生新 op）；hook 的 remove / toggle 在外层再调一次只是重复并集。
 * 同步/恢复流程不调本函数（syncFavoritesToCloud、restoreRemovedFavorites、
 * replaceAll 都不经过这里），不存在回声或脏标记污染；persist 失败返回
 * null 之前不置脏（本地没变，绝不能推 remove 把云端收藏误删）。
 * CAS 跳过的条目不置脏（只对 removedIds 置脏）。
 */
export function snapshotAndRemoveLocal(
  siteIds: string[],
  source: TrashSource,
  opts?: { expectedCreatedAt?: ReadonlyMap<string, number> },
): { removed: RemovedFavoriteSnapshot[]; batchId: string; skippedSiteIds: string[] } | null {
  const now = Date.now()
  const batchId = newUndoBatchId()
  const ids = new Set(siteIds)
  const expected = opts?.expectedCreatedAt
  const removed: RemovedFavoriteSnapshot[] = []
  const skippedSiteIds: string[] = []
  sharedFavorites.forEach((item, index) => {
    if (!ids.has(item.siteId)) return
    // CAS：期望 createdAt 与现条目不一致 = 8 秒内该站已被删后重建，
    // 删旧条目的撤销不能误删新条目，跳过（不删、不进 trash）。
    if (expected?.has(item.siteId) && expected.get(item.siteId) !== item.createdAt) {
      skippedSiteIds.push(item.siteId)
      return
    }
    removed.push({ item, index })
  })
  const removedIds = new Set(removed.map((r) => r.item.siteId))
  const next = sharedFavorites.filter((i) => !removedIds.has(i.siteId))
  if (!persistLocalFavorites(next)) return null
  // 11b：内部置脏（见本函数头注释）——只对实际删掉的 id 置脏，CAS 跳过的
  // 不置脏；外层调用方再调一次 markDirty 是幂等重复并集，无害。
  markDirty([...removedIds])
  snapshotToTrash(removed, source, batchId, now)
  return { removed, batchId, skippedSiteIds }
}

/**
 * 批量新增的本地核心（pin 改走 store 的写入口，11b）：
 * 按 siteId 对 sharedFavorites 做 dedup——已存在 → skipped，不写；
 * 传入列表内重复的 siteId 同样只留第一次出现（先出现者胜）。
 * 再按 URL 指纹（fingerprintUrl，SSOT，与导入路径同口径）做第二层 dedup：
 * 同一站点经不同 URL 写法到达（如带 www / 带 utm 参数 / 尾斜杠 /
 * http 与 https）指纹相同，只留第一次出现，其余进 skippedSiteIds。
 * 指纹为空（非 http(s) 或非法 href，fingerprintUrl 返回 ''）时绝不按指纹去重，
 * 只按 siteId dedup——空指纹之间不能互相撞上。
 * 新条目整块前插（保持传入顺序在前，与旧逐站 unshift 的“后 pin 者在前”
 * 不同：批量 pin 的展示顺序应与选中顺序一致）。
 * 成功后 markDirty(addedIds)，下次同步自动推 add op；无新增时不写盘、
 * 直接返回空 added（no-op 不应因存储不可用而失败）；persist 失败返回 null。
 */
export function addFavoritesLocal(
  items: LocalFavorite[],
): { added: LocalFavorite[]; skippedSiteIds: string[] } | null {
  const existing = new Set(sharedFavorites.map((i) => i.siteId))
  const existingFingerprints = new Set(
    sharedFavorites.map((i) => fingerprintUrl(i.href)).filter((fp) => fp !== ''),
  )
  const added: LocalFavorite[] = []
  const skippedSiteIds: string[] = []
  for (const item of items) {
    if (existing.has(item.siteId)) {
      skippedSiteIds.push(item.siteId)
      continue
    }
    const fp = fingerprintUrl(item.href)
    if (fp !== '' && existingFingerprints.has(fp)) {
      skippedSiteIds.push(item.siteId)
      continue
    }
    existing.add(item.siteId)
    if (fp !== '') existingFingerprints.add(fp)
    added.push(item)
  }
  if (added.length === 0) return { added, skippedSiteIds }
  const next = [...added, ...sharedFavorites]
  if (!persistLocalFavorites(next)) return null
  markDirty(added.map((i) => i.siteId))
  return { added, skippedSiteIds }
}

/**
 * 清空的本地核心（模块级：hook 的 clear 与测试共用同一份）：
 * 顺序与 snapshotAndRemoveLocal 同款——先 persist([]) 清本体，成功后
 * 再写回收站快照；persist 失败返回 null（调用方按「没清成」处理，
 * 不推撤销条），回收站里不留「没清成」的快照。
 * opts.pushUndo === false（账号删除）时绝不写回收站键：只清本体 +
 * 置脏，回收站里的旧快照原样保留（清账号是另一回事）。
 * 返回的 now 是快照与撤销条共用的时刻（createdAt/expiresAt 用它）。
 */
export function clearFavoritesLocal(
  opts?: Pick<ClearOpts, 'pushUndo'>,
): { removed: RemovedFavoriteSnapshot[]; batchId: string; now: number } | null {
  const current = sharedFavorites
  const siteIds = current.map((i) => i.siteId)
  const removed: RemovedFavoriteSnapshot[] = current.map((item, index) => ({ item, index }))
  const batchId = newUndoBatchId()
  const now = Date.now()
  // persist 成功才置脏：写不进说明本地没变，此时推 remove 会把云端收藏误删
  if (!persistLocalFavorites([])) return null
  markDirty(siteIds)
  if (opts?.pushUndo !== false) snapshotToTrash(removed, 'clear', batchId, now)
  return { removed, batchId, now }
}

/**
 * 把一批已删收藏按原位插回（撤销 / 回收站恢复共用）。
 * at 一律取撤销时刻 Date.now()，不能用原 createdAt（见 RESTORE_AT_KEY 注释）。
 */
export function restoreRemovedFavorites(
  removed: RemovedFavoriteSnapshot[],
  source: 'undo' | 'trash',
): { ok: boolean; message?: string } {
  if (sharedBlocked) return { ok: false, message: '本机存储不可用，恢复未完成' }
  const next = insertRestoredFavorites(sharedFavorites, removed)
  if (!persistLocalFavorites(next)) return { ok: false, message: '本机存储写不进去，恢复未完成' }
  const ids = removed.map((r) => r.item.siteId)
  markDirty(ids)
  setRestoreAt(ids, Date.now())
  if (source === 'undo') dropFromTrash(ids)
  return { ok: true }
}

/** 构造一条删除撤销条目（单条 / 批量共用；0 条返回 null） */
export function buildRemoveUndoEntry(
  removed: RemovedFavoriteSnapshot[],
  batchId: string,
): UndoEntry | null {
  if (removed.length === 0) return null
  const now = Date.now()
  const kind = removed.length === 1 ? 'favorite.remove' : 'favorite.remove-batch'
  const label =
    removed.length === 1
      ? `已删除「${removed[0]!.item.title}」`
      : `已删除 ${removed.length} 条收藏`
  return {
    id: newUndoId(),
    batchId,
    kind,
    label,
    createdAt: now,
    expiresAt: now + UNDO_WINDOW_MS,
    count: removed.length,
    trashRef: { batchId, count: removed.length },
    undo: async () => restoreRemovedFavorites(removed, 'undo'),
  }
}

/**
 * 更新一条收藏的 meta（模块级：hook 的 updateMeta 与撤销闭包共用同一份，
 * 不捕获 hook 闭包——撤销闭包可能在若干次渲染后才执行，hook 的 persist
 * 会过期，模块级的 persistLocalFavorites 读的是实时 sharedBlocked）。
 *
 * folderId 变化时推一条 move-folder 撤销（D3：改名进栈、备注/标签不进栈；
 * quicklink 同样不进栈）。opts.pushUndo=false 供内部调用（登录迁移重
 * 映射、删夹恢复）——那些不是用户的"移动"动作，推了反而污染撤销栈。
 */
export function applyMetaUpdate(
  siteId: string,
  patch: { folderId?: string | null; note?: string | null; tags?: string[] | null; quickPrefix?: string | null; templateUrl?: string | null },
  opts?: UpdateMetaOpts,
): boolean {
  const current = sharedFavorites
  const target = current.find((i) => i.siteId === siteId)
  if (!target) return false
  const fromFolderId = target.folderId ?? null
  const folderChanged = patch.folderId !== undefined && patch.folderId !== fromFolderId
  const next = current.map((i) => {
    if (i.siteId !== siteId) return i
    const merged: LocalFavorite = { ...i }
    if (patch.folderId !== undefined) merged.folderId = patch.folderId
    // note 允许显式传 null（清空备注），落盘统一成 undefined 保持旧数据形状；
    // ≤200 字是云端契约，超长在写入端就截断（输入框另有 maxLength 双保险）
    if (patch.note !== undefined) {
      const note = patch.note ?? undefined
      merged.note = note && note.length > 200 ? note.slice(0, 200) : note
    }
    // 标签（T22）：null = 清除；数组做与云端同口径的归一（≤8 个、各 ≤24 字符、去重）
    if (patch.tags !== undefined) {
      const tags = patch.tags ?? undefined
      if (!tags || tags.length === 0) {
        merged.tags = undefined
      } else {
        const seen = new Set<string>()
        for (const raw of tags) {
          if (typeof raw !== 'string') continue
          const tag = raw.trim().slice(0, 24)
          if (!tag) continue
          seen.add(tag)
          if (seen.size >= 8) break
        }
        merged.tags = seen.size > 0 ? [...seen] : undefined
      }
    }
    // 快捷链接（v1 本地 only，不推云端）：null = 清除；前缀写入即归一
    // （trim → 去首个 `!` → 小写），与 validateQuicklink 同口径。
    // 模板合法性不在这里拦：录入 UI（/favorites）与 importJson 在写入前
    // 已校验，quicklinkFromFavorite 在读取时还会再验一次。
    if (patch.quickPrefix !== undefined) {
      const normalized = patch.quickPrefix == null ? '' : normalizeQuicklinkPrefix(patch.quickPrefix)
      merged.quickPrefix = normalized || undefined
    }
    if (patch.templateUrl !== undefined) {
      const template = patch.templateUrl == null ? '' : patch.templateUrl.trim()
      merged.templateUrl = template || undefined
    }
    return merged
  })
  const ok = persistLocalFavorites(next)
  // 文件夹 / 备注也是待推变更：页面会 best-effort 直连云端，失败时批量同步是兜底通道
  if (!ok) return false
  markDirty([siteId])
  // 撤销恢复的条目在云端是"刚被改过的行"：同步 add op 的 at 必须用撤销
  // 时刻，否则 LWW 会把这次恢复当旧事件跳过。
  if (opts?.restoreAt !== undefined) setRestoreAt([siteId], opts.restoreAt)
  if (folderChanged && opts?.pushUndo !== false) {
    const now = Date.now()
    pushGlobalUndo({
      id: newUndoId(),
      batchId: newUndoBatchId(),
      kind: 'favorite.move-folder',
      label: opts?.undoLabel ?? '已移动 1 条收藏',
      detail: opts?.undoDetail,
      createdAt: now,
      expiresAt: now + UNDO_WINDOW_MS,
      count: 1,
      undo: async () => {
        const restored = applyMetaUpdate(siteId, { folderId: fromFolderId }, { pushUndo: false, restoreAt: Date.now() })
        return restored
          ? { ok: true }
          : { ok: false, message: '这条收藏找不到了，移夹撤销未完成' }
      },
    })
  }
  return true
}

/** 已移出区有变化时通知订阅它的页面（收藏页角标、已移出视图）刷新计数 */
function dispatchShelvedUpdated(): void {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('navhub_shelved_updated'))
  } catch {
    // 事件派发失败不阻断移出本身：页面下次挂载时会重读
  }
}

/**
 * 到期结算的编排（打开时跑一次，不靠后台任务；SSR 不跑——只在客户端 effect 里调用）：
 * settleTriage 分区 → expired 逐条 shelveItems 进已移出区并写盘 →
 * 每条走现有 remove 的墓碑路（置脏 + 云端 remove）→ survivors 一次 persist。
 * 写已移出区失败时整批不移出：收藏留在原处，并把原因交回（页面要显示出来）。
 * survivors 写盘失败时同样整批不移出：已移出区已写、云端 remove 尚未发出，
 * 此时若返回 survivors，本机仍留过期项——与已移出区写失败同口径。
 * 用户不开站就不过期——接受的语义，文案不承诺「准时」。
 */
function settleFavoritesOnLoad(
  items: LocalFavorite[],
  blocked: string | null,
  now: number = Date.now(),
  settings: TriageSettings = readTriageSettings(),
): { items: LocalFavorite[]; expiredCount: number; error: string | null } {
  // 存储读不出来时绝不能拿空列表/部分列表去覆盖：结算的前提是「读到了全量」
  if (blocked) return { items, expiredCount: 0, error: null }
  const { items: survivors, expired } = settleTriage(items, settings, now)
  if (expired.length === 0) return { items, expiredCount: 0, error: null }
  let shelved = readShelvedFavorites()
  for (const item of expired) {
    const originStatus = resolveTriageStatus(item, now)
    shelved = shelveItems(
      shelved,
      item,
      now,
      originStatus === 'read' ? 'read' : 'inbox',
      item.triageAt,
    )
  }
  if (!writeShelvedFavorites(shelved)) {
    return {
      items,
      expiredCount: 0,
      error: '已移出区写不进去，过期待读还留在原处（本机存储写不进去，稍后再试）',
    }
  }
  // survivors 一次 persist（不走逐条 remove：那会把同一份列表序列化 N 次）。
  // 写盘失败时整批不移出：返回原列表 + 原因，跳过 markDirty / 云端 remove——
  // 否则已移出区已写、云端已删，本机却仍留过期项，三端分叉。
  if (!saveLocal(survivors)) {
    return {
      items,
      expiredCount: 0,
      error: '本机收藏写不进去，过期待读还留在原处（本机存储写不进去，稍后再试）',
    }
  }
  // 到期是「移走」不是静默删除：云端也要删（墓碑路），否则换设备登录会把它复活
  markDirty(expired.map((i) => i.siteId))
  const identity = getIdentity()
  if (identity) {
    for (const item of expired) void removeFavorite(identity, item.siteId)
  }
  dispatchShelvedUpdated()
  return { items: survivors, expiredCount: expired.length, error: null }
}

function subscribeFavorites(listener: () => void): () => void {
  favoritesListeners.add(listener)
  return () => {
    favoritesListeners.delete(listener)
  }
}

function getFavoritesSnapshot(): FavoritesSnapshot {
  return favoritesSnapshot
}

export function useFavorites(): FavoritesApi {
  /**
   * 模块级共享状态（useSyncExternalStore）。
   *
   * 为什么不再用每实例 useState：同文档内的 `storage` 事件不会触发（浏览器规范），
   * 而 `persist` 原先也不派发任何事件——收藏页里每张卡的 <FavoriteButton> 是
   * 独立实例，点星取消收藏后卡片不消失、筛选计数不同步，只能刷新页面。
   * 现在所有实例订阅同一份模块状态，任何一次写入都通知全体重渲染。
   */
  const snap = useSyncExternalStore(subscribeFavorites, getFavoritesSnapshot, getFavoritesSnapshot)
  const { items, blocked: storageBlocked } = snap
  const [ready, setReady] = useState(() => favoritesInitialized)
  /** 回收站版本号：navhub_trash_updated / storage 事件来时刷新 trashItems */
  const [trashVersion, setTrashVersion] = useState(0)
  const trashItems = useMemo(() => readTrash().items, [trashVersion])
  const trashCount = trashItems.length

  useEffect(() => {
    if (!favoritesInitialized) {
      favoritesInitialized = true
      // 初始化读盘后跑一次到期结算（打开时结算，不靠后台任务；SSR 不跑）：
      // 过期项分区进已移出区、survivors 原样返回，一次 persist。
      // 所有消费方共用同一份已结算的模块状态。
      const loaded = loadLocal()
      const settled = settleFavoritesOnLoad(loaded.items, loaded.blocked)
      applyLocalFavorites({
        items: settled.items,
        blocked: loaded.blocked,
        settledExpiredCount: settled.expiredCount,
        triageSettleError: settled.error,
      })
      // 回收站启动剪枝一次（写回即删，不弹确认；只剪本地视图，
      // 云端墓碑的物理清理 v1 不做，D6）。
      const trash = readTrash()
      const pruned = pruneExpiredTrash(trash)
      if (pruned.items.length !== trash.items.length || pruned.folders.length !== trash.folders.length) {
        writeTrash(pruned)
      }
    }
    setReady(true)
    const refresh = () => applyLocalFavorites(loadLocal())
    const refreshTrash = () => setTrashVersion((v) => v + 1)
    window.addEventListener('navhub_workbench_updated', refresh)
    window.addEventListener('storage', refresh)
    window.addEventListener('storage', refreshTrash)
    window.addEventListener('navhub_trash_updated', refreshTrash)
    return () => {
      window.removeEventListener('navhub_workbench_updated', refresh)
      window.removeEventListener('storage', refresh)
      window.removeEventListener('storage', refreshTrash)
      window.removeEventListener('navhub_trash_updated', refreshTrash)
    }
  }, [])

  const persist = useCallback(
    (next: LocalFavorite[]) => {
      // 读不出来就不写：宁可这次改动不生效，也不能覆盖掉用户原有的收藏
      if (storageBlocked) return false
      applyLocalFavorites({ items: next, blocked: storageBlocked })
      // 写盘失败也要如实返回 false：调用方据此决定是否置脏 / 调云端，
      // 否则本机没落盘却推了云端变更，两端分叉。
      return saveLocal(next)
    },
    [storageBlocked],
  )

  /** 用户显式重置：原数据先备份到 `.corrupt.<时间戳>`，再落到空列表 */
  const resetLocal = useCallback((): { backedUp: boolean } => {
    let backedUp = false
    try {
      const raw = window.localStorage.getItem(KEY)
      if (raw) {
        const backupKey = corruptBackupKey(Date.now())
        window.localStorage.setItem(backupKey, raw)
        // 回读比对：setItem 在配额满时会抛（或静默失败），只按“调用过了”就宣称已备份，
        // 就是替用户把一个找不回数据的决定说成安全的。
        backedUp = window.localStorage.getItem(backupKey) === raw
      } else {
        // 本来就没有原文（存储里是空的）：没什么可备份的，重置依然是安全的
        backedUp = true
      }
    } catch {
      backedUp = false
    }
    // 重置意味着本地记录被丢弃：游标也必须一起清，否则下次增量会从「旧水位」
    // 开始，被清空的那段云端数据永远拉不回来（重拉全量是幂等的）。
    try {
      const identity = getIdentity()
      if (identity) window.localStorage.removeItem(SYNC_CURSOR_PREFIX + identity)
    } catch {
      // 清不掉游标不阻断重置；下次成功同步时会被新版本覆盖
    }
    applyLocalFavorites({ items: [], blocked: null })
    saveLocal([])
    // 重置 = 本地记录整体丢弃：脏标记一起清（游标上面已经清了，下次同步重拉全量，
    // 拉回来的内容就是云端事实源，没有「待推」可言）
    clearDirty()
    return { backedUp }
  }, [])

  const isFavorite = useCallback((siteId: string) => items.some((i) => i.siteId === siteId), [items])

  /** 切换收藏状态，返回切换后是否已收藏 */
  const toggle = useCallback(async (site: Omit<LocalFavorite, 'createdAt'>): Promise<boolean> => {
    // 读共享状态（同步更新，包含本帧内已发生的写入），避免快速双击时两次都读到旧状态
    const current = sharedFavorites
    const existed = current.some((i) => i.siteId === site.siteId)
    const now = Date.now()
    // 待读分流：分流开关开着时新收进待读箱（inbox 戳 + triageAt = now）；
    // 关掉时新收藏直接进 permanent；老收藏不受影响（祖父规则）。
    const fresh: LocalFavorite = readTriageSettings().enabled
      ? enterInbox({ ...site, createdAt: now }, now)
      : { ...site, createdAt: now }
    if (existed) {
      // 取消收藏 = 删除：先快照进回收站、再改本地、再推撤销条（与 remove 同路）
      const removed = snapshotAndRemoveLocal([site.siteId], 'single')
      // 写不进去就返回未改变的状态：调用方据此提示，界面不会出现「点了但没变化」
      if (!removed) return existed
      const entry = buildRemoveUndoEntry(removed.removed, removed.batchId)
      if (entry) pushGlobalUndo(entry)
      markDirty([site.siteId])
      const identity = getIdentity()
      if (identity) await removeFavorite(identity, site.siteId)
      return !existed
    }
    const next = [fresh, ...current]
    // 写不进去就返回未改变的状态：调用方据此提示，界面不会出现「点了但没变化」
    if (!persist(next)) return existed

    // 真的新增收藏时记一次成长经验（取消收藏不记）；siteId 进收藏净增锁，同站终身只给 1 次
    recordGrowthEvent('favorite_add', { siteId: site.siteId })

    // 新增与取消都是待推变更：新增在本地列表里（同步推 add），
    // 取消后已不在本地列表（同步推 remove）——同一条置脏路径覆盖两种 op
    markDirty([site.siteId])

    // 异步尝试同步到云端（失败不影响本地态——离线优先）
    const identity = getIdentity()
    if (identity) {
      await addFavorite(identity, site.siteId)
    }
    return !existed
  }, [persist])

  const remove = useCallback((siteId: string) => {
    // 删除：先快照进回收站、再改本地、再推撤销条；写不进去整步不执行
    const removed = snapshotAndRemoveLocal([siteId], 'single')
    if (!removed) return
    const entry = buildRemoveUndoEntry(removed.removed, removed.batchId)
    if (entry) pushGlobalUndo(entry)
    // 本地已删：siteId 留在脏集合里、已不在本地列表，同步时生成 remove op 让云端也删
    markDirty([siteId])
    const identity = getIdentity()
    if (identity) void removeFavorite(identity, siteId)
  }, [])

  const recordOpened = useCallback((siteId: string, now: number = Date.now()) => {
    const current = sharedFavorites
    if (!current.some((i) => i.siteId === siteId)) return false
    // 只有「打开时间」变了：persist 写本机即可，刻意不 markDirty、不调云端
    //（见接口注释）。写不进去（存储被拦）时返回 false，调用方不假装记下了。
    // 待读分流：inbox 条目同时 inbox → read（markTriageRead）；read 再打开不动，
    // permanent 打开不变。调用点包括 /favorites 主列表卡片点击（2026-11-15 起）：
    // 在待读筛选视图下点一张 inbox 卡会使其立即变为 read、从当前视图消失——
    // 有意的语义（打开 = 读过），见 lib/favorites-triage。
    return persist(
      current.map((i) => (i.siteId === siteId ? { ...markTriageRead(i, now), lastOpenedAt: now } : i)),
    )
  }, [persist])

  /** 待读分流：晋升到永久库（本机私有字段变化，不置脏、不推云端） */
  const promoteFavorite = useCallback((siteId: string, now: number = Date.now()) => {
    const current = sharedFavorites
    const target = current.find((i) => i.siteId === siteId)
    if (!target || resolveTriageStatus(target, now) === 'permanent') return false
    return persist(current.map((i) => (i.siteId === siteId ? promoteToPermanent(i) : i)))
  }, [persist])

  /** 待读分流：待读箱内一键续期（本机私有字段变化，不置脏、不推云端） */
  const renewInboxItem = useCallback((siteId: string, now: number = Date.now()) => {
    const current = sharedFavorites
    const target = current.find((i) => i.siteId === siteId)
    if (!target || resolveTriageStatus(target, now) !== 'inbox') return false
    return persist(current.map((i) => (i.siteId === siteId ? renewInbox(i, now) : i)))
  }, [persist])

  /**
   * 待读分流：手动移出（仅 inbox/read）。编排与到期结算同款：
   * 先写已移出区，写不进去就不移出；再从活跃列表移除并走 remove 墓碑路。
   * persist 写不进去时把刚写入的已移出记录撤回，避免两边不一致。
   */
  const shelveFavorite = useCallback((siteId: string, now: number = Date.now()) => {
    const current = sharedFavorites
    const target = current.find((i) => i.siteId === siteId)
    if (!target) return false
    const status = resolveTriageStatus(target, now)
    if (status !== 'inbox' && status !== 'read') return false
    const nextShelved = shelveItems(readShelvedFavorites(), target, now, status, target.triageAt)
    if (!writeShelvedFavorites(nextShelved)) return false
    if (!persist(current.filter((i) => i.siteId !== siteId))) {
      writeShelvedFavorites(readShelvedFavorites().filter((i) => i.siteId !== siteId))
      return false
    }
    markDirty([siteId])
    const identity = getIdentity()
    if (identity) void removeFavorite(identity, siteId)
    dispatchShelvedUpdated()
    return true
  }, [persist])

  /**
   * 待读分流：从已移出区恢复。先把记录从已移出区取出并写盘，
   * 再把收藏原文放回活跃列表（恢复默认进永久库；选 inbox 时重新打待读戳，
   * 分流开关关着时回落到 permanent）。放回写不进去时把记录写回已移出区。
   */
  const restoreShelved = useCallback((
    siteId: string,
    destination: 'inbox' | 'permanent' = 'permanent',
    now: number = Date.now(),
  ): { ok: boolean; error?: string } => {
    const { items: remaining, restored } = unshelveItems(readShelvedFavorites(), siteId)
    if (!restored) return { ok: false, error: '这条已移出记录找不到了' }
    if (!writeShelvedFavorites(remaining)) {
      return { ok: false, error: '已移出区写不进去，恢复未完成' }
    }
    const base: LocalFavorite = {
      siteId: restored.siteId,
      title: restored.title,
      href: restored.href,
      icon: restored.icon,
      description: restored.description,
      note: restored.note,
      tags: restored.tags,
      folderId: restored.folderId,
      createdAt: restored.createdAt,
      quickPrefix: restored.quickPrefix,
      templateUrl: restored.templateUrl,
    }
    const entry =
      destination === 'inbox' && readTriageSettings().enabled ? enterInbox(base, now) : base
    const current = sharedFavorites
    const next = current.some((i) => i.siteId === siteId)
      ? current.map((i) => (i.siteId === siteId ? entry : i))
      : [entry, ...current]
    if (!persist(next)) {
      // 放回失败：把记录写回已移出区，收藏没有丢
      writeShelvedFavorites(shelveItems(remaining, restored, now, restored.originStatus, restored.originTriageAt))
      return { ok: false, error: '收藏写不进去，恢复未完成（本机存储写不进去）' }
    }
    markDirty([siteId])
    dispatchShelvedUpdated()
    return { ok: true }
  }, [persist])

  /** 待读分流：从已移出区逐条真删除（调用方先二次确认） */
  const deleteShelved = useCallback((siteId: string) => {
    const current = readShelvedFavorites()
    if (!current.some((i) => i.siteId === siteId)) return false
    const ok = writeShelvedFavorites(current.filter((i) => i.siteId !== siteId))
    if (ok) dispatchShelvedUpdated()
    return ok
  }, [])

  /** 待读分流：清空已移出区（调用方先二次确认，文案写明不可恢复） */
  const clearShelved = useCallback(() => {
    const ok = writeShelvedFavorites([])
    if (ok) dispatchShelvedUpdated()
    return ok
  }, [])

  /**
   * 冬眠收藏：手动冬眠一条永久收藏。只写本机手动集合（lib/favorites-hibernation），
   * 不碰收藏本体、不置脏、不推云端——冬眠是状态，不是删除也不是移出。
   * 待读箱 / 已读不参与（有自己的到期流转）；写不进去返回 false。
   */
  const hibernateFavorite = useCallback((siteId: string, now: number = Date.now()) => {
    const current = sharedFavorites
    const target = current.find((i) => i.siteId === siteId)
    if (!target) return false
    if (resolveTriageStatus(target, now) !== 'permanent') return false
    return writeManualHibernated(addManualHibernated(readManualHibernated(), siteId, now))
  }, [])

  /**
   * 冬眠收藏：唤醒一条收藏。先移出手动集合，再记一次打开（recordOpened，
   * 天数归零——自动冬眠的同样靠这一次打开脱离冬眠）。打开写不进去时把
   * 手动冬眠写回去，避免「集合里没了、打开又没记上」的半截状态。
   */
  const wakeFavorite = useCallback((siteId: string, now: number = Date.now()) => {
    const current = sharedFavorites
    if (!current.some((i) => i.siteId === siteId)) return false
    const { items: remaining, removed } = removeManualHibernated(readManualHibernated(), siteId)
    if (removed && !writeManualHibernated(remaining)) return false
    if (!recordOpened(siteId, now)) {
      if (removed) writeManualHibernated(addManualHibernated(remaining, siteId, now))
      return false
    }
    return true
  }, [recordOpened])

  /**
   * 更新一条收藏的 meta（实现在模块级 applyMetaUpdate：撤销闭包共用，
   * 不捕获 hook 闭包）。folderId 变化推 move-folder 撤销；备注/标签/
   * quicklink 不进栈（D3）。opts.pushUndo=false 供内部调用。
   */
  const updateMeta = useCallback((siteId: string, patch: { folderId?: string | null; note?: string | null; tags?: string[] | null; quickPrefix?: string | null; templateUrl?: string | null }, opts?: UpdateMetaOpts) => {
    return applyMetaUpdate(siteId, patch, opts)
  }, [])

  /**
   * 从回收站恢复：按原位插回（index 是删除前下标；已有同站时跳过），
   * 置脏并记恢复时刻供同步 LWW 用。写不进去时 restored 为空。
   */
  const restoreFavorites = useCallback((items: Array<LocalFavorite & { index?: number }>) => {
    if (items.length === 0) return { restored: [] as string[], skipped: [] as string[] }
    const current = sharedFavorites
    const restored = items.filter((i) => !current.some((c) => c.siteId === i.siteId))
    const next = insertRestoredFavorites(
      current,
      items.map((item, k) => ({ item, index: item.index ?? current.length + k })),
    )
    if (!persist(next)) {
      return { restored: [] as string[], skipped: items.map((i) => i.siteId) }
    }
    const ids = restored.map((i) => i.siteId)
    markDirty(ids)
    setRestoreAt(ids, Date.now())
    return {
      restored: ids,
      skipped: items.filter((i) => !ids.includes(i.siteId)).map((i) => i.siteId),
    }
  }, [persist])

  /** 撤销最近一次可撤销操作（栈顶，8 秒窗口内；过期/无条目时 ok=false） */
  const undoLast = useCallback(async (): Promise<{ ok: boolean; message?: string }> => {
    const entry = popGlobalUndo()
    if (!entry) return { ok: false, message: '没有可撤销的操作' }
    try {
      return await entry.undo()
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '撤销失败' }
    }
  }, [])

  /**
   * 删除收藏夹后批量置空 folderId（T16）：一次 persist + 一次脏标记，
   * 替代此前「逐条 updateMeta」的 N 次全量序列化（每次 persist 都把整份收藏
   * 重新写一遍 localStorage，条数多时是 O(N²) 字节写入）。
   */
  const clearFolderForItems = useCallback((siteIds: string[]): boolean => {
    const ids = new Set(siteIds)
    const next = sharedFavorites.map((i) => (ids.has(i.siteId) ? { ...i, folderId: null } : i))
    const ok = persist(next)
    if (ok && ids.size > 0) markDirty([...ids])
    return ok
  }, [persist])

  const replaceAll = useCallback((next: LocalFavorite[]) => {
    // replaceAll 的入参来自云端同步结果（或用户显式整体替换）：本地整体已被
    // 「云端版本」取代，不存在待云端确认的变更——清空全部脏标记，
    // 否则下次同步会把刚确认的内容原样推回去（LWW 虽会跳过，但 ops 白跑）
    const ok = persist(next)
    if (ok) clearDirty()
    return ok
  }, [persist])

  /** 下一次 clear() 时随撤销恢复的夹子快照（prepareClearRestore 登记，clear 消费一次）。 */
  const pendingClearFolderRestoreRef = useRef<{
    folders: NonNullable<ClearOpts['folders']>
    restoreFolders: NonNullable<ClearOpts['restoreFolders']>
  } | null>(null)
  const prepareClearRestore = useCallback(
    (
      folders: NonNullable<ClearOpts['folders']>,
      restoreFolders: NonNullable<ClearOpts['restoreFolders']>,
    ) => {
      pendingClearFolderRestoreRef.current = { folders, restoreFolders }
    },
    [],
  )

  const clear = useCallback((opts?: ClearOpts) => {
    // 与 replaceAll 的区别：clear 是「收藏被清空」，云端也必须删掉。
    // 把当前所有 siteId 置脏——它们随即不在本地列表，同步时走 remove ops
    // （与 toggle 取消收藏同一条路径）。本地清空（persist + 置脏 + 回收站
    // 快照）走模块级 clearFavoritesLocal：pushUndo:false（账号删除）时
    // 绝不写回收站键；persist 失败时回收站里不留「没清成」的快照。
    // trash 键本身绝不被清掉：账号删除清的是收藏本体，清账号是另一回事。
    // 夹子快照：opts 优先，否则取 prepareClearRestore 登记的一次性快照。
    const pendingFolderRestore = pendingClearFolderRestoreRef.current
    pendingClearFolderRestoreRef.current = null
    const result = clearFavoritesLocal(opts)
    if (!result) return
    const { removed, batchId, now } = result
    if (opts?.pushUndo === false || removed.length === 0) return
    const foldersSnapshot = opts?.folders ?? pendingFolderRestore?.folders
    const restoreFolders = opts?.restoreFolders ?? pendingFolderRestore?.restoreFolders
    pushGlobalUndo({
      id: newUndoId(),
      batchId,
      kind: 'favorite.remove-batch',
      label: `已清空全部收藏（${removed.length} 条）`,
      createdAt: now,
      expiresAt: now + UNDO_WINDOW_MS,
      count: removed.length,
      trashRef: { batchId, count: removed.length },
      undo: async () => {
        const restoreResult = restoreRemovedFavorites(removed, 'undo')
        if (!restoreResult.ok) return restoreResult
        if (foldersSnapshot && restoreFolders) restoreFolders(foldersSnapshot)
        return { ok: true }
      },
    })
  }, [])

  /**
   * 导出 v1 不带分流字段（已定）：triageStatus / triageAt 是本机流转状态，
   * 导出文件是旧存量——导入时一律进 permanent，带出去没有意义。
   */
  const exportJson = useCallback(() => {
    const items = sharedFavorites.map((f) => {
      const copy = { ...f }
      delete copy.triageStatus
      delete copy.triageAt
      return copy
    })
    return JSON.stringify({ version: 1, items }, null, 2)
  }, [])

  const importJson = useCallback((json: string) => {
    // 存储读不出来时导入同样是写入：先拦住，并把原因作为错误返回（页面会显示）
    if (storageBlocked) return { ok: false, imported: 0, updated: 0, alreadyExisted: 0, addedSiteIds: [], skippedInvalid: 0, error: storageBlocked }
    try {
      const parsed = JSON.parse(json)
      const incoming: LocalFavorite[] = Array.isArray(parsed) ? parsed : parsed?.items
      if (!Array.isArray(incoming)) return { ok: false, imported: 0, updated: 0, alreadyExisted: 0, addedSiteIds: [], skippedInvalid: 0, error: '格式不正确' }
      const accepted = incoming.filter((i) => {
        if (!i || typeof i.siteId !== 'string' || typeof i.href !== 'string') return false
        // 模板非法整条计入 skippedInvalid：带 templateUrl 就必须配有效前缀
        // 且模板本身过 validateQuicklink（缺 {q} / javascript: / 域名里有
        // {q} / 超长 / 含控制字符都算非法），而不是悄悄丢掉模板留一条
        // 「看起来导入成功」的收藏。无模板的条目不受影响。
        const templateUrl = typeof i.templateUrl === 'string' ? i.templateUrl.trim() : ''
        if (!templateUrl) return true
        if (typeof i.quickPrefix !== 'string') return false
        return validateQuicklink({ prefix: i.quickPrefix, templateUrl }).ok
      })
      const skippedInvalid = incoming.length - accepted.length
      const valid = accepted
        // note 契约 ≤200 字（云端与服务端 zod 同口径）：导入文件可能带更长的
        // 历史备注，落库前截断，避免同步时才被服务端兜底截断造成两端不一致。
        // 显式标注返回类型：否则 map 出来的对象把 note 变成「必填的 string|undefined」，
        // 下面 merge 云端条目（note 可选）时就对不上类型了。
        // 标签（T22）：导入文件可能带超限标签，落库前归一（≤8 个、各 ≤24 字符）
        .map((i): LocalFavorite => {
          const note = typeof i.note === 'string' && i.note.length > 200 ? i.note.slice(0, 200) : i.note
          // 快捷链接：无模板时孤零零的前缀没有意义，直接去掉；
          // 有模板时前缀归一（与 updateMeta 同口径），模板原样保留
          //（合法性已在 accepted 过滤器里验过）。
          const templateUrl = typeof i.templateUrl === 'string' ? i.templateUrl.trim() : ''
          const quickPrefix = templateUrl ? normalizeQuicklinkPrefix(i.quickPrefix ?? '') : ''
          const quicklinkFields = {
            quickPrefix: quickPrefix || undefined,
            templateUrl: templateUrl || undefined,
          }
          if (!Array.isArray(i.tags) || i.tags.length === 0) return { ...i, note, tags: undefined, ...quicklinkFields, triageStatus: undefined, triageAt: undefined }
          const seen = new Set<string>()
          for (const raw of i.tags) {
            if (typeof raw !== 'string') continue
            const tag = raw.trim().slice(0, 24)
            if (!tag) continue
            seen.add(tag)
            if (seen.size >= 8) break
          }
          // 导入的条目是旧存量，一律进 permanent：文件里带的分流字段
          // （哪怕是别的设备导出的）也不能把一条旧收藏塞进 24 小时箱。
          return { ...i, note, tags: seen.size > 0 ? [...seen] : undefined, ...quicklinkFields, triageStatus: undefined, triageAt: undefined }
        })
      // 合并键是指纹（SSOT）：同一站带 utm / www / http 与不带判同一条，
      // 绝不按 siteId（原始 href 的 djb2）重复入库。siteId 生成本身不动。
      // 同指纹已存在时：字段一致算 alreadyExisted；标题/标签/文件夹等
      // 不同算 updated（原地更新已存条目，保留其 siteId/createdAt）。
      const merged: LocalFavorite[] = [...sharedFavorites]
      const byFingerprint = new Map<string, number>()
      const bySiteId = new Map<string, number>()
      sharedFavorites.forEach((ex, index) => {
        const fp = fingerprintUrl(ex.href)
        if (fp && !byFingerprint.has(fp)) byFingerprint.set(fp, index)
        if (!bySiteId.has(ex.siteId)) bySiteId.set(ex.siteId, index)
      })
      let imported = 0
      let updated = 0
      let alreadyExisted = 0
      // 指纹算不出来的条目（非 http(s)）也计入 skippedInvalid，但不改上面的 const
      let extraSkippedInvalid = 0
      const addedSiteIds: string[] = []
      const sameFields = (a: LocalFavorite, b: LocalFavorite) =>
        a.title === b.title &&
        fingerprintUrl(a.href) === fingerprintUrl(b.href) &&
        (a.description ?? '') === (b.description ?? '') &&
        (a.note ?? '') === (b.note ?? '') &&
        (a.folderId ?? null) === (b.folderId ?? null) &&
        (a.tags ?? []).join('\u0001') === (b.tags ?? []).join('\u0001') &&
        (a.quickPrefix ?? '') === (b.quickPrefix ?? '') &&
        (a.templateUrl ?? '') === (b.templateUrl ?? '')
      for (const item of valid) {
        const fp = fingerprintUrl(item.href)
        if (!fp) {
          extraSkippedInvalid++
          continue
        }
        const at = byFingerprint.get(fp) ?? bySiteId.get(item.siteId)
        if (at !== undefined) {
          const existing = merged[at]!
          if (sameFields(existing, item)) {
            alreadyExisted++
          } else {
            merged[at] = { ...existing, ...item, siteId: existing.siteId, createdAt: existing.createdAt }
            updated++
          }
          continue
        }
        merged.push(item)
        byFingerprint.set(fp, merged.length - 1)
        bySiteId.set(item.siteId, merged.length - 1)
        imported++
        addedSiteIds.push(item.siteId)
      }
      // persist 失败（quota / 存储不可用）必须如实返回 ok:false：
      // 未落盘的 chunk 绝不能被汇总报成成功；且失败时不置脏——没存进
      // 去的条目没有待推变更，置脏只会让同步去推一批本地没有的收藏。
      // （persist 内部先更新内存态再写盘：返回 false 时调用方按“没写成”
      // 处理，不把这批计入成功，内存态与磁盘的不一致由下次读盘纠正。）
      if (!persist(merged)) {
        return { ok: false, imported: 0, updated: 0, alreadyExisted: 0, addedSiteIds: [], skippedInvalid: skippedInvalid + extraSkippedInvalid, error: '本地存储不可用' }
      }
      // 导入进来的条目都是待推变更：云端多半没有它们（换设备导入的场景），
      // 或本地这份是更新版——不进脏集合的话同步永远不会推
      markDirty(valid.map((i) => i.siteId))
      return { ok: true, imported, updated, alreadyExisted, addedSiteIds, skippedInvalid: skippedInvalid + extraSkippedInvalid }
    } catch (err) {
      return { ok: false, imported: 0, updated: 0, alreadyExisted: 0, addedSiteIds: [], skippedInvalid: 0, error: err instanceof Error ? err.message : '解析失败' }
    }
  }, [persist, storageBlocked])

  return {
    items,
    ready,
    storageBlocked,
    isFavorite,
    toggle,
    remove,
    undoLast,
    trashItems,
    trashCount,
    trashError: snap.trashError,
    restoreFavorites,
    updateMeta,
    recordOpened,
    promoteFavorite,
    renewInbox: renewInboxItem,
    shelveFavorite,
    restoreShelved,
    deleteShelved,
    clearShelved,
    hibernateFavorite,
    wakeFavorite,
    settledExpiredCount: snap.settledExpiredCount,
    triageSettleError: snap.triageSettleError,
    clearFolderForItems,
    replaceAll,
    clear,
    prepareClearRestore,
    resetLocal,
    exportJson,
    importJson,
  }
}

/** 同步游标：仅记录「一次成功同步之后」的版本，失败时绝不推进 */
const SYNC_CURSOR_PREFIX = 'navhub.favorites.sync.v1.'

/** 最近一次同步结果（只写不删：用户能看到「上次同步是什么时候、成没成」） */
const SYNC_STATUS_KEY = 'navhub.favorites.sync.last'

export interface FavoritesSyncStatus {
  at: number
  ok: boolean
  pushed: number
  remoteRemoved: number
  error?: string
}

function writeSyncStatus(status: FavoritesSyncStatus): void {
  try {
    window.localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(status))
  } catch {
    // 写不进状态只是少一行提示，不影响同步本身
  }
}

export function readSyncStatus(): FavoritesSyncStatus | null {
  try {
    const raw = window.localStorage.getItem(SYNC_STATUS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FavoritesSyncStatus>
    return {
      at: Number(parsed.at) || 0,
      ok: Boolean(parsed.ok),
      pushed: Number(parsed.pushed) || 0,
      remoteRemoved: Number(parsed.remoteRemoved) || 0,
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
    }
  } catch {
    return null
  }
}

/**
 * 脏标记（M1 三期「只推脏条目」）：本地变更过、云端还没确认的 siteId 集合。
 *
 * 为什么需要它：批量同步早期把「本地全量」当 ops 重发，服务端 LWW 会跳过绝大多数
 * ——正确但不经济（收藏 500 条就是 500 个 ops/次）。现在只推脏集合：
 * 变更点（toggle / remove / updateMeta / importJson / clear）置脏，
 * 一次成功同步后全部确认（清脏），失败则保留（下次重试仍会推）。
 */
const DIRTY_KEY = 'navhub.favorites.dirty.v1'

/**
 * 内存里持一份脏集合，避免每次同步都读 localStorage。
 * 写入一定双写（内存 + 存储）；「重新挂载」（刷新页面 / 新标签页）时内存丢失，
 * 从 localStorage 恢复——只要标记还在，下次同步仍会推这些条目。
 */
let memoryDirty: Set<string> | null = null

/** 读脏集合：内存优先，未加载过才落 localStorage。读失败按空集合（下次多推几条，不影响正确性） */
function readDirty(): Set<string> {
  if (memoryDirty) return memoryDirty
  let ids: string[] = []
  try {
    const raw = window.localStorage.getItem(DIRTY_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === 'string')
    }
  } catch {
    // 读不出（隐私模式 / 数据坏了）就当没有待推条目：最坏结果是下次同步少推几条，
    // 而「读失败」与「没有数据」的区分由收藏本体的 loadLocal 负责，这里不需要拦
    ids = []
  }
  memoryDirty = new Set(ids)
  return memoryDirty
}

/** 写脏集合：内存 + localStorage 双写。存储写不进只是下次多推几条，不影响正确性 */
function writeDirty(ids: Set<string>): void {
  memoryDirty = new Set(ids)
  try {
    window.localStorage.setItem(DIRTY_KEY, JSON.stringify([...memoryDirty]))
  } catch {
    // 配额满 / 隐私模式：内存态仍然生效（本次会话内的同步逻辑照常工作），
    // 刷新后标记丢失——代价是下次多推几条全量，不会推错
  }
}

/** 把一批 siteId 置脏（新增待推变更） */
/** 脏键是否曾被写过（一次性迁移判定：从未写过 = 机制上线前的存量本地收藏） */
function dirtyKeyEverWritten(): boolean {
  try {
    return window.localStorage.getItem(DIRTY_KEY) !== null
  } catch {
    // 读不到就当写过：不触发全量迁移（存储不可用时同步本来也走不远）
    return true
  }
}

function markDirty(siteIds: string[]): void {
  if (siteIds.length === 0) return
  const next = readDirty()
  for (const id of siteIds) next.add(id)
  writeDirty(next)
}

/**
 * 清除脏标记：不传 ids = 全部确认（一次成功同步后调用）；
 * 传 ids = 只确认这几条（当前没有调用方按条清，保留给将来的按条确认）。
 */
function clearDirty(ids?: string[]): void {
  const current = readDirty()
  if (!ids) {
    writeDirty(new Set<string>())
    return
  }
  if (ids.length === 0) return
  for (const id of ids) current.delete(id)
  writeDirty(current)
}

/** 批量同步有限重试：只对可重试错误退避（300ms / 900ms），404 之类不重试 */
async function syncBatchWithRetry(
  ops: FavoriteSyncOp[],
  since: number,
  onFail: (error: unknown) => void,
): Promise<HubFavoritesSyncPayload | null> {
  let retryable = false
  const mark = (error: unknown) => {
    onFail(error)
    retryable = describeDegrade(error, '云端收藏').retryable
  }
  const first = await syncFavoritesBatch(ops, since, mark)
  if (first) return first
  for (const delay of [300, 900]) {
    if (!retryable) return null
    await new Promise((resolve) => setTimeout(resolve, delay))
    const retried = await syncFavoritesBatch(ops, since, mark)
    if (retried) return retried
  }
  return null
}

function readSyncCursor(identity: string): number {
  try {
    const raw = window.localStorage.getItem(SYNC_CURSOR_PREFIX + identity)
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    // 读不到游标就按 0（全量）处理：宁可多拉一次全集，也不能跳过增量
    return 0
  }
}

function writeSyncCursor(identity: string, version: number): void {
  if (!(version > 0)) return
  try {
    window.localStorage.setItem(SYNC_CURSOR_PREFIX + identity, String(version))
  } catch {
    // 写不进游标不影响本次结果，只是下次仍走全量（全量是幂等的）
  }
}

/**
 * 增量应用（M1）：服务端返回「自 since 以来变化的行，含墓碑」。
 *
 * 与 mergeCloudFavorites 的关键差别：后者是「云端全集覆盖本地」，用在增量上
 * 会把本地尚未推送的条目误删。这里只按 siteId upsert / delete，绝不整体替换。
 * 落本地走白名单字段：墓碑行残留的 note/folderId 是删除前的旧值，不能写回。
 */
export function applyFavoriteDelta(
  local: LocalFavorite[],
  delta: HubFavoriteSyncItem[],
): LocalFavorite[] {
  const map = new Map(local.map((item) => [item.siteId, item]))
  const fresh: LocalFavorite[] = []
  for (const remote of delta) {
    if (remote.deletedAt != null) {
      map.delete(remote.siteId)
      continue
    }
    const cached = map.get(remote.siteId)
    const href = remote.site?.url ?? cached?.href ?? ''
    // 站点已被硬删除且本地也没有展示信息：无法渲染，跳过
    if (!href) continue
    const next: LocalFavorite = {
      ...(cached ?? { siteId: remote.siteId }),
      siteId: remote.siteId,
      title: remote.site?.title ?? cached?.title ?? remote.siteId,
      href,
      icon: cached?.icon,
      description: remote.site?.description ?? cached?.description,
      note: remote.note ?? undefined,
      tags: remote.tags ?? undefined,
      folderId: remote.folderId,
      createdAt: remote.createdAt || cached?.createdAt || Date.now(),
    }
    if (cached) map.set(remote.siteId, next)
    else fresh.push(next)
  }
  return fresh.length > 0 ? [...fresh, ...map.values()] : [...map.values()]
}

/**
 * 登录后调用一次：把本地**变更过、云端还没确认**的收藏推到云端（M1 三期起只推
 * 脏条目，不再重发全量），再拉回云端增量/全集。成员集合最终以云端为准——否则
 * 其它设备删掉的收藏会被本机缓存复活。
 *
 * 返回值刻意不是「数组或 null」——那让调用方无法区分两件事：
 *   - 云端**确实**没有收藏（空数组，正常）
 *   - 根本没同步成功（浏览器里的收藏还没上去，用户以为已经在云端了）
 * 旧实现两者都返回 `[]`/`null` 且**完全静默**，于是：
 *   1. 中枢不可达时仍会为**每一条**本地收藏各发一次请求，每次都要等满超时
 *      （收藏 30 个站 + 中枢已停 = 页面卡在「同步」状态十几分钟，毫无提示）；
 *   2. 用户换设备登录发现收藏全没了 —— 才意识到从没同步成功过。
 *
 * 因此这里：首条推送失败即中止（同一时刻的中枢故障是共因，继续推只是重复等待），
 * 并把「同步了几条 / 失败原因 / 值不值得重试」如实交回调用方。
 */
export interface CloudSyncResult {
  /** 整条链路没有出错 */
  ok: boolean
  /** 本机收藏条数 */
  localCount: number
  /** 本次实际提交到云端的 ops 数（M1 三期起只推脏条目：0 = 纯拉取） */
  pushed: number
  /** 合并后的云端收藏；**失败时为 null**（空数组表示云端确实没有收藏） */
  cloud: HubFavorite[] | null
  /** 云端收藏夹；失败时为 null（与 cloud 同生命周期，页面无需再发一次请求） */
  cloudFolders: HubFavoriteFolder[] | null
  /** 失败原因（可直接渲染）；ok 时为 undefined */
  error?: string
  /** 是否值得给用户一个「重试」 */
  retryable: boolean
  /**
   * 已算好的「本地应变成什么」。页面必须用它 replaceAll，而不是自己再跑一次
   * mergeCloudFavorites——增量场景下全量合并会把本地未推送的条目误删。
   * 失败时为 null（不许落库）。
   */
  nextItems: LocalFavorite[] | null
  /** 本次同步中被「另一台设备」删除的条数（墓碑），用于给用户可见提示 */
  remoteRemoved: number
}

export async function syncFavoritesToCloud(): Promise<CloudSyncResult> {
  const { items: local, blocked } = loadLocal()
  const identity = getIdentity()
  if (blocked) {
    // 读不出来时**不要**上报「本地 0 条」：那会让用户以为收藏本来就没有
    return {
      ok: false,
      localCount: 0,
      pushed: 0,
      cloud: null,
      cloudFolders: null,
      error: blocked,
      retryable: false,
      nextItems: null,
      remoteRemoved: 0,
    }
  }
  if (!identity) {
    return {
      ok: false,
      localCount: local.length,
      pushed: 0,
      cloud: null,
      cloudFolders: null,
      error: '未登录：收藏只保存在本机浏览器',
      retryable: false,
      nextItems: null,
      remoteRemoved: 0,
    }
  }

  const failure: { message?: string; retryable: boolean } = { retryable: true }
  const onFail = (error: unknown) => {
    const notice = describeDegrade(error, '云端收藏')
    failure.message = notice.message
    failure.retryable = notice.retryable
    // 批量端点走 BFF 会话：401 是「登录过期」，不是 API Token 问题
    if ((error as { status?: number } | null)?.status === 401) {
      failure.message = '登录已过期，请重新登录后同步收藏'
      failure.retryable = true
    }
  }

  // 登录用户走批量同步：一次请求提交 ops 并取回增量（含墓碑）。
  // 匿名用户保持旧的逐条端点——新端点只接受会话派生身份，匿名调它必然 401。
  if (!identity.startsWith('anon-')) {
    const since = readSyncCursor(identity)
    /**
     * 一次性迁移：脏键从未写过且本地非空 → 本次按全量推一次。
     * 否则 since=0 的全量合并会把「云端没有的本地条目」从本地删掉、
     * 且它们永远推不上去——匿名收藏转登录的主路径会静默丢数据。
     * 写过空数组（用户确实清过脏）不触发，避免每次同步都全量重发。
     */
    if (local.length > 0 && !dirtyKeyEverWritten()) {
      markDirty(local.map((f) => f.siteId))
    }
    /**
     * M1 三期：只推「本地变更过、云端还没确认」的条目（脏集合），
     * 不再把本地全量当 ops 重发（LWW 会跳过绝大多数——正确但不经济）。
     * ops 两类来源：
     *   1. 脏集合 ∩ 当前本地列表 → add。服务端 add 是 upsert（缺失则插入、
     *      存量则整行覆盖），不能用 update 替代——服务端对「缺失行上的 update」
     *      直接跳过，新增永远上不去；
     *   2. 脏集合里已不在本地列表的 siteId → remove（本地删掉的条目要推删除）。
     */
    const dirty = readDirty()
    // 撤销恢复的条目：add op 的 at 必须用撤销时刻而不是 createdAt，
    // 否则 LWW 会被云端墓碑的 updated_at 挡掉，撤销在云端活不过来。
    const restoreAt = readRestoreAtOverrides()
    const ops: FavoriteSyncOp[] = []
    for (const f of local) {
      if (!dirty.has(f.siteId)) continue
      ops.push({
        op: 'add',
        siteId: f.siteId,
        folderId: f.folderId ?? null,
        note: f.note && f.note.length > 200 ? f.note.slice(0, 200) : f.note ?? null,
        tags: f.tags ?? null,
        at: restoreAt[f.siteId] ?? f.createdAt,
      })
    }
    for (const siteId of dirty) {
      if (local.some((f) => f.siteId === siteId)) continue
      ops.push({ op: 'remove', siteId, at: Date.now() })
    }
    /** 服务端单批 ops 上限 500；超出必须分片，否则 400 会让 >500 条收藏的账号永久同步失败 */
    const OP_BATCH = 500
    const chunks: FavoriteSyncOp[][] = []
    for (let i = 0; i < ops.length; i += OP_BATCH) chunks.push(ops.slice(i, i + OP_BATCH))

    let version = since
    let aggregated: HubFavoriteSyncItem[] = []
    let folders: HubFavoriteFolder[] = []

    // 所有分片都用同一个 since：这样每片的响应都覆盖「自游标以来的全部变化」，
    // 不会因为逐片推进游标而漏掉「at 早于新游标」的条目（拼接后按 siteId 去重）。
    for (const chunk of chunks) {
      const result = await syncBatchWithRetry(chunk, since, onFail)
      if (!result) {
        writeSyncStatus({ at: Date.now(), ok: false, pushed: 0, remoteRemoved: 0, error: failure.message })
        return {
          ok: false,
          localCount: local.length,
          pushed: 0,
          cloud: null,
          cloudFolders: null,
          error: failure.message,
          retryable: failure.retryable,
          nextItems: null,
          remoteRemoved: 0,
        }
      }
      version = Math.max(version, result.version)
      aggregated.push(...result.items)
      folders = result.folders
    }

    // 本机没有可推条目时仍需拉取：首拉（since=0）要全集，已有游标时要知道云端新增与墓碑
    if (chunks.length === 0) {
      const pulled = await syncBatchWithRetry([], since, onFail)
      if (!pulled) {
        writeSyncStatus({ at: Date.now(), ok: false, pushed: 0, remoteRemoved: 0, error: failure.message })
        return {
          ok: false,
          localCount: local.length,
          pushed: 0,
          cloud: null,
          cloudFolders: null,
          error: failure.message,
          retryable: failure.retryable,
          nextItems: null,
          remoteRemoved: 0,
        }
      }
      aggregated = pulled.items
      version = pulled.version
      folders = pulled.folders
    }

    // 游标只在全部请求成功后推进一次（失败时保持原值，重试仍覆盖这段区间，幂等）
    writeSyncCursor(identity, version)

    const alive = aggregated.filter((item) => item.deletedAt == null)
    const remoteRemoved = aggregated.length - alive.length
    // since=0 是全集，可以走「云端覆盖本地」；since>0 是增量，必须按行 upsert，
    // 否则本地尚未推送的条目会被整体替换误删。
    const nextItems =
      since === 0 ? mergeCloudFavorites(local, alive) : applyFavoriteDelta(local, aggregated)
    // 全部请求成功：本次脏条目已获云端确认，清空标记。
    // 失败路径（上面几处 return）故意不清——下次重试仍会推这些条目。
    clearDirty()
    // 撤销时刻覆盖也随之清掉：已获云端确认，不再需要覆盖
    clearRestoreAt(ops.map((o) => o.siteId))
    writeSyncStatus({
      at: Date.now(),
      ok: true,
      pushed: ops.length,
      remoteRemoved,
    })
    return {
      ok: true,
      localCount: local.length,
      // pushed = 本次实际提交的 ops 数（0 = 纯拉取，什么都没有推）；
      // localCount 仍是本机条数，两者语义不同，别混
      pushed: ops.length,
      cloud: alive,
      cloudFolders: folders,
      retryable: false,
      nextItems,
      remoteRemoved,
    }
  }

  let pushed = 0
  for (const f of local) {
    const ok = await addFavorite(identity, f.siteId, onFail)
    // 首条就失败时继续推没有意义：同一次中枢故障会让每条都等满超时
    if (!ok) break
    pushed++
  }

  if (failure.message) {
    return {
      ok: false,
      localCount: local.length,
      pushed,
      cloud: null,
      cloudFolders: null,
      error: failure.message,
      retryable: failure.retryable,
      nextItems: null,
      remoteRemoved: 0,
    }
  }

  let cloudFailed = false
  const list = await listFavorites(identity, (error) => {
    cloudFailed = true
    onFail(error)
  })

  return {
    ok: !cloudFailed,
    localCount: local.length,
    pushed,
    cloud: cloudFailed ? null : list.items,
    cloudFolders: cloudFailed ? null : list.folders,
    error: failure.message,
    retryable: failure.retryable,
    nextItems: cloudFailed ? null : mergeCloudFavorites(local, list.items ?? []),
    // 匿名通道没有墓碑概念：云端不返回删除记录，本地合并也不会删任何条目
    remoteRemoved: 0,
  }
}
