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

  const saveFolderName = useCallback(async (folderId: string) => {
    const name = editingName.trim()
    setEditingFolder(null)
    if (!name) return

    if (!cloudIdentity) {
      setLocalFolders((prev) => renameLocalFolder(prev, folderId, name))
      return
    }

    const ok = await updateFavoriteFolder(cloudIdentity, folderId, { name })
    if (!ok) {
      report('重命名收藏夹失败：云端暂不可用', 'error')
      return
    }
    setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name } : f)))
  }, [cloudIdentity, editingName, setFolders, setLocalFolders, report])

  const removeFolder = useCallback(async (folderId: string) => {
    // 本地夹子：只移除分组本身，条目保留（与云端语义一致）
    if (!cloudIdentity) {
      setLocalFolders((prev) => removeLocalFolder(prev, folderId).folders)
      favorites.clearFolderForItems(favorites.items.filter((f) => f.folderId === folderId).map((f) => f.siteId))
      if (activeFolder === folderId) setActiveFolder('all')
      return
    }

    const ok = await deleteFavoriteFolder(cloudIdentity, folderId)
    if (!ok) {
      report('删除收藏夹失败：云端暂不可用', 'error')
      return
    }
    // 云端删夹事务已把夹内收藏 folder_id 置空：本地一次批量对齐即可，
    // 逐条 updateMeta 是 N 次全量序列化 + N 条冗余 PATCH 脏标记（T16 修复）
    favorites.clearFolderForItems(favorites.items.filter((f) => f.folderId === folderId).map((f) => f.siteId))
    setFolders((prev) => prev.filter((f) => f.id !== folderId))
    if (activeFolder === folderId) setActiveFolder('all')
  }, [activeFolder, cloudIdentity, favorites, setActiveFolder, setFolders, setLocalFolders, report])

  /**
   * 收藏夹上移/下移（T16）：服务端 PATCH 的 sort 字段早已建成、前端从未接线。
   * 以当前位置为准整体重排（sort = 新下标），云端只 PATCH 位置真正变化的两项。
   */
  const moveFolder = useCallback(
    async (folderId: string, dir: -1 | 1) => {
      if (!cloudIdentity) {
        const reordered = [...localFolders]
        const index = reordered.findIndex((f) => f.id === folderId)
        const target = index + dir
        if (index < 0 || target < 0 || target >= reordered.length) return
        const tmp = reordered[index]!
        reordered[index] = reordered[target]!
        reordered[target] = tmp
        setLocalFolders(reordered.map((f, i) => ({ ...f, sort: i + 1 })))
        return
      }

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
      }
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
          favorites.updateMeta(item.siteId, { folderId: mapped })
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
    saveFolderName,
    removeFolder,
    moveFolder,
    migrateLocalFolders,
  }
}

// planFolderUpload 是纯函数，从页面原本的 import 处复用
import { planFolderUpload } from '@/lib/favorites-folders'
