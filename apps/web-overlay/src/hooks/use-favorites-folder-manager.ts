'use client'

/**
 * 收藏夹管理（T14 拆分）：把 /favorites 页里约 120 行的夹子 CRUD + 重排 +
 * 本地夹上云迁移，从 1250 行的页面里抽成独立 hook。
 *
 * 页面保留：夹子列表的渲染、activeFolder 筛选状态、卡片级操作（assignFolder）。
 * 本 hook 负责：全部「改夹子」的回调与它们自己的输入状态（新建名、行内编辑名）。
 *
 * 双数据源约定不变：登录态 = 云端夹子（事实源），匿名/离线 = 本地夹子
 * （lib/favorites-folders 的 local- 前缀键）。
 */
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import {
  createFavoriteFolder,
  deleteFavoriteFolder,
  listFavorites,
  updateFavoriteFolder,
  type HubFavoriteFolder,
} from '@/lib/navhub-api'
import { addLocalFolder, removeLocalFolder, renameLocalFolder, type LocalFolder } from '@/lib/favorites-folders'
import {
  UNDO_WINDOW_MS,
  newUndoBatchId,
  newUndoId,
  pushGlobalUndo,
} from '@/lib/undo-stack'
import {
  addFolderToTrash,
  readTrash,
  removeFolderFromTrash,
  writeTrash,
} from '@/lib/favorites-trash'
import type { FavoritesApi } from '@/hooks/useFavorites'

export interface FavoritesFolderManager {
  newFolderName: string
  setNewFolderName: Dispatch<SetStateAction<string>>
  folderBusy: boolean
  editingFolder: string | null
  setEditingFolder: Dispatch<SetStateAction<string | null>>
  editingName: string
  setEditingName: Dispatch<SetStateAction<string>>
  refreshFolders: () => Promise<void>
  addFolder: () => Promise<void>
  createFolderDirectly: (name: string) => Promise<string | null>
  saveFolderName: (folderId: string) => Promise<void>
  removeFolder: (folderId: string) => Promise<void>
  moveFolder: (folderId: string, dir: -1 | 1) => Promise<void>
  migrateLocalFolders: (remoteFolders: HubFavoriteFolder[], nextItems: import('@/hooks/useFavorites').LocalFavorite[]) => Promise<void>
}

export function useFavoritesFolderManager(opts: {
  cloudIdentity: string | null
  folders: HubFavoriteFolder[]
  setFolders: Dispatch<SetStateAction<HubFavoriteFolder[]>>
  localFolders: LocalFolder[]
  setLocalFolders: Dispatch<SetStateAction<LocalFolder[]>>
  activeFolder: string
  setActiveFolder: (v: string) => void
  favorites: FavoritesApi
  /** 页面级同步提示条（note + success/error） */
  report: (note: string, status: 'success' | 'error') => void
}): FavoritesFolderManager {
  const { cloudIdentity, folders, setFolders, localFolders, setLocalFolders, activeFolder, setActiveFolder, favorites, report } = opts
  const [newFolderName, setNewFolderName] = useState('')
  const [folderBusy, setFolderBusy] = useState(false)
  const [editingFolder, setEditingFolder] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  /** 收藏夹操作统一入口：刷新列表并给出失败提示 */
  const refreshFolders = useCallback(async () => {
    if (!cloudIdentity) return
    const data = await listFavorites(cloudIdentity)
    setFolders(data.folders)
  }, [cloudIdentity, setFolders])

  const addFolder = useCallback(async () => {
    const name = newFolderName.trim()
    if (!name || folderBusy) return

    // 匿名 / 离线：建本地夹子（P2）。失败只可能是重名或空名，属于用户可自纠的输入问题
    if (!cloudIdentity) {
      const result = addLocalFolder(localFolders, name, Date.now())
      if (!result.ok) {
        report(result.error, 'error')
        return
      }
      setLocalFolders(result.folders)
      setNewFolderName('')
      return
    }

    setFolderBusy(true)
    const folder = await createFavoriteFolder(cloudIdentity, name)
    setFolderBusy(false)
    if (!folder) {
      report('创建收藏夹失败：云端暂不可用', 'error')
      return
    }
    setNewFolderName('')
    await refreshFolders()
  }, [cloudIdentity, folderBusy, localFolders, newFolderName, refreshFolders, report, setLocalFolders])

  const createFolderDirectly = useCallback(async (rawName: string): Promise<string | null> => {
    const name = rawName.trim()
    if (!name) return null

    // 检查是否已有同名文件夹
    const currentList = cloudIdentity ? folders : localFolders
    const existing = currentList.find((f) => f.name === name)
    if (existing) return existing.id

    if (!cloudIdentity) {
      const result = addLocalFolder(localFolders, name, Date.now())
      if (!result.ok) {
        return null
      }
      setLocalFolders(result.folders)
      const created = result.folders.find((f) => f.name === name)
      return created ? created.id : null
    }

    const folder = await createFavoriteFolder(cloudIdentity, name)
    if (folder) {
      await refreshFolders()
      return folder.id
    }
    return null
  }, [cloudIdentity, folders, localFolders, refreshFolders, setLocalFolders])

  const saveFolderName = useCallback(async (folderId: string) => {
    const name = editingName.trim()
    setEditingFolder(null)
    if (!name) return
    await renameFolderDirect(folderId, name)
  }, [editingName])

  /**
   * 改名直达（saveFolderName 与撤销闭包共用）：改名进撤销栈（D3），
   * 撤销时反向调它（pushUndo=false），不再推新条目。
   */
  const renameFolderDirect = useCallback(async (folderId: string, name: string, pushUndo = true): Promise<boolean> => {
    const currentList = cloudIdentity ? folders : localFolders
    const prev = currentList.find((f) => f.id === folderId)
    const fromName = prev?.name ?? ''
    if (!name || name === fromName) return false

    if (!cloudIdentity) {
      setLocalFolders((prevList) => renameLocalFolder(prevList, folderId, name))
    } else {
      const ok = await updateFavoriteFolder(cloudIdentity, folderId, { name })
      if (!ok) {
        report('重命名收藏夹失败：云端暂不可用', 'error')
        return false
      }
      setFolders((prevList) => prevList.map((f) => (f.id === folderId ? { ...f, name } : f)))
    }
    if (!pushUndo) return true
    // 改名进栈（D3）：撤销 = 改回原名
    const now = Date.now()
    pushGlobalUndo({
      id: newUndoId(),
      batchId: newUndoBatchId(),
      kind: 'folder.rename',
      label: `已将收藏夹重命名为「${name}」`,
      createdAt: now,
      expiresAt: now + UNDO_WINDOW_MS,
      undo: async () => {
        const restored = await renameFolderDirect(folderId, fromName, false)
        return restored
          ? { ok: true }
          : { ok: false, message: '收藏夹找不到了，重命名撤销未完成' }
      },
    })
    return true
  }, [cloudIdentity, folders, localFolders, setFolders, setLocalFolders, report])

  const removeFolder = useCallback(async (folderId: string) => {
    // 删夹前快照：夹子 + 夹内成员 siteId 列表（恢复要把成员 folderId 指回去）。
    // 云端 POST /folders 生成新 id，无法保留原 id → 恢复后成员重映射到新 id；
    // 本地夹直接按原 id 恢复（D4）。
    const currentList = cloudIdentity ? folders : localFolders
    const folder = currentList.find((f) => f.id === folderId)
    if (!folder) return
    const now = Date.now()
    const batchId = newUndoBatchId()
    const folderSnapshot = {
      id: folder.id,
      name: folder.name,
      sort: folder.sort ?? 0,
      createdAt: folder.createdAt ?? now,
    }
    const memberSiteIds = favorites.items
      .filter((f) => f.folderId === folderId)
      .map((f) => f.siteId)

    // 本地夹子：只移除分组本身，条目保留（与云端语义一致）
    if (!cloudIdentity) {
      setLocalFolders((prev) => removeLocalFolder(prev, folderId, favorites.items).folders)
      favorites.clearFolderForItems(memberSiteIds)
      if (activeFolder === folderId) setActiveFolder('all')
    } else {
      const ok = await deleteFavoriteFolder(cloudIdentity, folderId)
      if (!ok) {
        report('删除收藏夹失败：云端暂不可用', 'error')
        return
      }
      // 云端删夹事务已把夹内收藏 folder_id 置空：本地一次批量对齐即可，
      // 逐条 updateMeta 是 N 次全量序列化 + N 条冗余 PATCH 脏标记（T16 修复）
      favorites.clearFolderForItems(memberSiteIds)
      setFolders((prev) => prev.filter((f) => f.id !== folderId))
      if (activeFolder === folderId) setActiveFolder('all')
    }

    // 删夹快照进回收站（夹 + 成员列表）；写不进去只报出来，不拦删除本身
    const trashed = addFolderToTrash(readTrash(), { ...folderSnapshot, memberSiteIds }, batchId, now)
    if (!writeTrash(trashed)) {
      report('回收站写不进去，删掉的收藏夹只能靠重新创建恢复', 'error')
    }

    // 删夹进栈：撤销 = 恢复夹子 + 成员 folderId 指回去（云端是新 id）
    pushGlobalUndo({
      id: newUndoId(),
      batchId,
      kind: 'folder.delete',
      label: `已删除收藏夹「${folder.name}」（${memberSiteIds.length} 条收藏已移至未分组）`,
      createdAt: now,
      expiresAt: now + UNDO_WINDOW_MS,
      trashRef: { batchId, count: memberSiteIds.length },
      undo: async () => {
        const at = Date.now()
        if (!cloudIdentity) {
          setLocalFolders((prev) =>
            prev.some((f) => f.id === folderSnapshot.id) ? prev : [...prev, folderSnapshot],
          )
          for (const siteId of memberSiteIds) {
            favorites.updateMeta(siteId, { folderId: folderSnapshot.id }, { pushUndo: false, restoreAt: at })
          }
        } else {
          const created = await createFavoriteFolder(cloudIdentity, folderSnapshot.name)
          if (!created) {
            return { ok: false, message: '云端暂不可用，收藏夹恢复未完成' }
          }
          setFolders((prev) =>
            prev.some((f) => f.id === created.id) ? prev : [...prev, created],
          )
          for (const siteId of memberSiteIds) {
            favorites.updateMeta(siteId, { folderId: created.id }, { pushUndo: false, restoreAt: at })
          }
        }
        const state = removeFolderFromTrash(readTrash(), folderSnapshot.id).state
        writeTrash(state)
        return { ok: true }
      },
    })
  }, [activeFolder, cloudIdentity, favorites, folders, localFolders, setActiveFolder, setFolders, setLocalFolders, report])

  /**
   * 收藏夹上移/下移（T16）：服务端 PATCH 的 sort 字段早已建成、前端从未接线。
   * 以当前位置为准整体重排（sort = 新下标），云端只 PATCH 位置真正变化的两项。
   * 移夹进栈：撤销 = 反向移一步（pushUndo=false 时不推新条目）。
   */
  const moveFolder = useCallback(
    async (folderId: string, dir: -1 | 1, opts?: { pushUndo?: boolean }) => {
      const currentList = cloudIdentity ? folders : localFolders
      const folder = currentList.find((f) => f.id === folderId)
      if (!folder) return
      if (!cloudIdentity) {
        const reordered = [...localFolders]
        const index = reordered.findIndex((f) => f.id === folderId)
        const target = index + dir
        if (index < 0 || target < 0 || target >= reordered.length) return
        const tmp = reordered[index]!
        reordered[index] = reordered[target]!
        reordered[target] = tmp
        setLocalFolders(reordered.map((f, i) => ({ ...f, sort: i + 1 })))
      } else {
        const list = [...folders]
        const index = list.findIndex((f) => f.id === folderId)
        const target = index + dir
        if (index < 0 || target < 0 || target >= list.length) return
        const tmp = list[index]!
        list[index] = list[target]!
        list[target] = tmp
        const renumbered = list.map((f, i) => ({ ...f, sort: i + 1 }))
        // 先本地生效（乐观），再持久化位置真正变化的两项（用重排后的新 sort）；失败时刷新回云端事实源
        setFolders(renumbered)
        const changed = [renumbered[index]!, renumbered[target]!]
        const results = await Promise.all(
          changed.map((f) => updateFavoriteFolder(cloudIdentity, f.id, { sort: f.sort ?? 0 })),
        )
        if (results.some((ok) => !ok)) {
          report('收藏夹排序保存失败：云端暂不可用，稍后同步会还原', 'error')
          await refreshFolders()
          return
        }
      }
      if (opts?.pushUndo === false) return
      const now = Date.now()
      const opposite = (dir * -1) as -1 | 1
      pushGlobalUndo({
        id: newUndoId(),
        batchId: newUndoBatchId(),
        kind: 'folder.move',
        label: `已移动收藏夹「${folder.name}」`,
        createdAt: now,
        expiresAt: now + UNDO_WINDOW_MS,
        undo: async () => {
          await moveFolder(folderId, opposite, { pushUndo: false })
          return { ok: true }
        },
      })
    },
    [cloudIdentity, folders, localFolders, refreshFolders, setFolders, setLocalFolders, report],
  )

  /**
   * 本地收藏夹上云（P2 收尾）：登录同步成功后调用。
   *
   * 步骤：按名称把本地夹子合并到云端（同名复用、异名新建）→ 把本地条目里的
   * folderId 重映射到云端 id → 清空本地表。
   *
   * 两个容易错的点：
   *  - 重映射必须走 `updateMeta`（逐条置脏），**不能**用 `replaceAll`：后者会清掉
   *    全部脏标记，把还没推送成功的收藏变更一起丢掉；
   *  - 条目不从 `favorites.items` 读：那可能是同步前的旧闭包。用同步结果里的
   *    `nextItems`（已经是云端合并后的新列表），否则重映射会作用在过期数据上。
   */
  const migrateLocalFolders = useCallback(
    async (remoteFolders: HubFavoriteFolder[], nextItems: import('@/hooks/useFavorites').LocalFavorite[]) => {
      if (!cloudIdentity || localFolders.length === 0) return
      const { mapping, toCreate } = planFolderUpload(localFolders, remoteFolders)
      for (const folder of toCreate) {
        const created = await createFavoriteFolder(cloudIdentity, folder.name)
        if (created) mapping.set(folder.id, created.id)
      }
      let remapped = 0
      for (const item of nextItems) {
        const mapped = item.folderId ? mapping.get(item.folderId) : undefined
        if (mapped && mapped !== item.folderId) {
          // 迁移重映射不是用户的"移动"动作：不推撤销条
          favorites.updateMeta(item.siteId, { folderId: mapped }, { pushUndo: false })
          remapped += 1
        }
      }
      if (mapping.size > 0) {
        setLocalFolders([])
        report(`已把 ${mapping.size} 个本机收藏夹合并到云端` + (remapped > 0 ? `，${remapped} 条收藏的分组已更新` : ''), 'success')
      }
    },
    [cloudIdentity, favorites, localFolders, setLocalFolders, report],
  )

  return {
    newFolderName,
    setNewFolderName,
    folderBusy,
    editingFolder,
    setEditingFolder,
    editingName,
    setEditingName,
    refreshFolders,
    addFolder,
    createFolderDirectly,
    saveFolderName,
    removeFolder,
    moveFolder,
    migrateLocalFolders,
  }
}

// planFolderUpload 是纯函数，从页面原本的 import 处复用
import { planFolderUpload } from '@/lib/favorites-folders'
