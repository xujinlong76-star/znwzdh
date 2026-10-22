'use client'

/**
 * 我的收藏页。
 * v1：localStorage 优先（未登录可用）；登录后自动尝试云端同步
 * （同步失败只提示，不影响本地数据）。
 */

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FavoriteButton } from '@/components/favorite-button'
import {
  readSyncStatus,
  syncFavoritesToCloud,
  useFavorites,
  type CloudSyncResult,
  type FavoritesSyncStatus,
} from '@/hooks/useFavorites'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import {
  filterFavorites,
  describeFavoritesFilter,
  favoriteFilterEmptyMessage,
} from '@/lib/favorites-filter'
import {
  encryptVault,
  decryptVault,
  type VaultItem,
  type EncryptedVaultPayload,
} from '@/lib/vault'
import { ExportPluginModal } from '@/components/plugins/export-plugin-modal'
import { UserCenterNav } from '@/components/user-center/user-center-nav'
import {
  clearCloudFavorites,
  createFavoriteFolder,
  deleteFavoriteFolder,
  listFavorites,
  updateFavoriteFolder,
  updateFavoriteMeta,
  type HubFavoriteFolder,
} from '@/lib/navhub-api'
import {
  Shield, KeyRound, Download, Upload, CheckCircle2, AlertTriangle, Eye, EyeOff,
  RefreshCw, CloudOff, Search, X, Package, Folder, FolderPlus, Pencil, Trash2, Check, LogIn,
} from 'lucide-react'

export default function FavoritesPage() {
  const favorites = useFavorites()
  // 身份就绪（N1）：不再在挂载时读一次 localStorage，登录/合并/退出都会自动重取
  const identityReady = useIdentityReady()
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<'success' | 'error' | 'info'>('info')
  const [showPluginExport, setShowPluginExport] = useState(false)
  // 云端同步是一条会失败的链路，必须有独立状态：同步失败时用户最需要的
  // 是「收藏还在本机，换设备看不到」这个事实，而不是一片沉默。
  const [cloudResult, setCloudResult] = useState<CloudSyncResult | null>(null)
  const [syncingCloud, setSyncingCloud] = useState(false)
  const [importText, setImportText] = useState('')
  const [showImport, setShowImport] = useState(false)
  // 本页收藏的本地筛选（不联网）：收藏攒到几十个以后，「用眼睛扫网格」不是一种检索方式
  const [favoriteQuery, setFavoriteQuery] = useState('')
  // 收藏管理（云端文件夹 / 备注）：只在登录身份下出现
  const [cloudIdentity, setCloudIdentity] = useState('')
  // 清空云端收藏是两步确认：第一次点击只把按钮变成「再次点击确认」
  const [confirmClearCloud, setConfirmClearCloud] = useState(false)
  const [folders, setFolders] = useState<HubFavoriteFolder[]>([])
  const [activeFolder, setActiveFolder] = useState<string>('all')
  const [newFolderName, setNewFolderName] = useState('')
  const [folderBusy, setFolderBusy] = useState(false)
  const [editingFolder, setEditingFolder] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [noteEditor, setNoteEditor] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [manageBusy, setManageBusy] = useState(false)
  // 排序与渐进渲染（N8）：收藏上千条时「一屏渲染全部」会让首屏明显变慢，
  // 这里先排好序，再只渲染前若干条，其余按需加载。
  const [sortBy, setSortBy] = useState<'created' | 'title'>('created')
  const [visibleCount, setVisibleCount] = useState(60)

  /** 只过滤本页已加载的收藏；空关键词原样返回，不做无谓的重渲染 */
  const filteredFavorites = useMemo(
    () => filterFavorites(favorites.items, favoriteQuery),
    [favorites.items, favoriteQuery],
  )
  const visibleFavorites = useMemo(() => {
    const byFolder =
      activeFolder === 'all' ? filteredFavorites : filteredFavorites.filter((f) => (f.folderId ?? '') === activeFolder)
    // 排序是纯本地操作（收藏已在内存里），不引入服务端分页——本地优先是收藏页的根基，
    // 为排序把数据源改成接口会破坏离线可用性。
    const sorted = [...byFolder]
    if (sortBy === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    return sorted
  }, [filteredFavorites, activeFolder, sortBy])
  /** 渐进渲染：只渲染前 visibleCount 条，避免上千个 DOM 同时进场 */
  const renderedFavorites = visibleFavorites.slice(0, visibleCount)
  const filterSummary = describeFavoritesFilter(
    filteredFavorites.length,
    favorites.items.length,
    favoriteQuery,
  )

  // 零知识 E2EE 金库状态
  const [showVaultExport, setShowVaultExport] = useState(false)
  const [showVaultImport, setShowVaultImport] = useState(false)
  const [vaultPassword, setVaultPassword] = useState('')
  const [vaultPasswordConfirm, setVaultPasswordConfirm] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [syncLast, setSyncLast] = useState<FavoritesSyncStatus | null>(null)
  const [importVaultPayload, setImportVaultPayload] = useState('')
  const [showPasswordText, setShowPasswordText] = useState(false)
  const [vaultLoading, setVaultLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 登录用户：进页面时尝试把本地收藏合并到云端
  const runCloudSync = useCallback(async (): Promise<CloudSyncResult> => {
    setSyncingCloud(true)
    const result = await syncFavoritesToCloud()
    setCloudResult(result)
    setSyncingCloud(false)
    return result
  }, [])

  /**
   * 云端结果落地：文件夹列表 + 本地成员集合整体替换。
   * 首挂载与「重试同步」必须走同一条路径——否则重试成功后界面仍显示旧数据，
   * 用户只能手动刷新（历史缺陷：重试按钮只更新了 cloudResult）。
   */
  const applyCloudResult = useCallback(
    (result: CloudSyncResult) => {
      // nextItems 由 syncFavoritesToCloud 按「全量=覆盖 / 增量=逐行 upsert」算好：
      // 页面层不再自己跑 mergeCloudFavorites——增量结果做全量合并会删掉本地未推送的条目。
      if (!result.ok || !result.cloud || !result.cloudFolders || !result.nextItems) return false
      setFolders(result.cloudFolders)
      favorites.replaceAll(result.nextItems)
      // 墓碑来自另一台设备的删除：必须说出来，否则用户会以为本地数据「自己消失」
      if (result.remoteRemoved > 0) {
        setSyncNote(`另一台设备删除了 ${result.remoteRemoved} 条收藏，已与云端保持一致`)
        setSyncStatus('success')
      }
      return true
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [favorites],
  )

  useEffect(() => {
    setSyncLast(readSyncStatus())
  }, [])

  // 筛选 / 排序 / 收藏夹变化时回到首屏窗口：否则沿用旧窗口会让新筛选看起来「少了内容」
  useEffect(() => {
    setVisibleCount(60)
  }, [favoriteQuery, activeFolder, sortBy])

  useEffect(() => {
    // 两个就绪条件缺一不可：本地收藏读完（favorites.ready）+ 会话同步完成（N1）。
    // 只看 favorites.ready 会在「刚登录、userId 尚未写入」时把页面按匿名渲染，
    // 且不再重试——首次登录直接进本页就永远不同步。
    if (!favorites.ready || !identityReady.ready) return
    const identity = identityReady.identity
    if (!identity || identity.startsWith('anon-')) {
      // 退出登录 / 确认匿名：撤掉云端管理区，保留本地收藏
      setCloudIdentity('')
      return
    }
    setCloudIdentity(identity)
    void (async () => {
      const result = await runCloudSync()
      applyCloudResult(result)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runCloudSync, favorites.ready, identityReady.ready, identityReady.identity])

  /** 收藏夹操作统一入口：刷新列表并给出失败提示 */
  const refreshFolders = useCallback(async () => {
    if (!cloudIdentity) return
    const data = await listFavorites(cloudIdentity)
    setFolders(data.folders)
  }, [cloudIdentity])

  const addFolder = useCallback(async () => {
    const name = newFolderName.trim()
    if (!name || !cloudIdentity || folderBusy) return
    setFolderBusy(true)
    const folder = await createFavoriteFolder(cloudIdentity, name)
    setFolderBusy(false)
    if (!folder) {
      setSyncNote('创建收藏夹失败：云端暂不可用')
      setSyncStatus('error')
      return
    }
    setNewFolderName('')
    await refreshFolders()
  }, [cloudIdentity, folderBusy, newFolderName, refreshFolders])

  const saveFolderName = useCallback(async (folderId: string) => {
    const name = editingName.trim()
    setEditingFolder(null)
    if (!cloudIdentity || !name) return
    const ok = await updateFavoriteFolder(cloudIdentity, folderId, { name })
    if (!ok) {
      setSyncNote('重命名收藏夹失败：云端暂不可用')
      setSyncStatus('error')
      return
    }
    setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name } : f)))
  }, [cloudIdentity, editingName])

  const removeFolder = useCallback(async (folderId: string) => {
    if (!cloudIdentity) return
    const ok = await deleteFavoriteFolder(cloudIdentity, folderId)
    if (!ok) {
      setSyncNote('删除收藏夹失败：云端暂不可用')
      setSyncStatus('error')
      return
    }
    // 云端会把该文件夹下的收藏置空，本地同步去掉 folderId
    favorites.items
      .filter((f) => f.folderId === folderId)
      .forEach((f) => favorites.updateMeta(f.siteId, { folderId: null }))
    setFolders((prev) => prev.filter((f) => f.id !== folderId))
    if (activeFolder === folderId) setActiveFolder('all')
  }, [activeFolder, cloudIdentity, favorites])

  /**
   * 清空云端收藏（N3 接线）：两步确认，成功后连本地缓存一起清掉。
   * 只清云端不清本地会留下「本地还有、云端没了」的分裂状态，下次同步又会推回去。
   */
  const clearCloud = useCallback(async () => {
    if (!cloudIdentity || manageBusy) return
    if (!confirmClearCloud) {
      setConfirmClearCloud(true)
      return
    }
    setConfirmClearCloud(false)
    setManageBusy(true)
    const ok = await clearCloudFavorites(cloudIdentity)
    setManageBusy(false)
    if (!ok) {
      setSyncNote('清空云端收藏失败：云端暂不可用，本地收藏未受影响')
      setSyncStatus('error')
      return
    }
    favorites.clear()
    setFolders([])
    setActiveFolder('all')
    setSyncNote('云端收藏已清空，本机缓存也已清除')
    setSyncStatus('success')
  }, [cloudIdentity, confirmClearCloud, favorites, manageBusy])

  const assignFolder = useCallback(async (siteId: string, folderId: string | null) => {
    favorites.updateMeta(siteId, { folderId })
    if (!cloudIdentity) return
    setManageBusy(true)
    const ok = await updateFavoriteMeta(cloudIdentity, siteId, { folderId })
    setManageBusy(false)
    if (!ok) {
      setSyncNote('移动收藏失败：云端暂不可用，已在本机保留位置')
      setSyncStatus('error')
    }
  }, [cloudIdentity, favorites])

  const saveNote = useCallback(async (siteId: string) => {
    const note = noteDraft.trim() || null
    favorites.updateMeta(siteId, { note })
    setNoteEditor(null)
    if (!cloudIdentity) return
    setManageBusy(true)
    const ok = await updateFavoriteMeta(cloudIdentity, siteId, { note })
    setManageBusy(false)
    if (!ok) {
      setSyncNote('保存备注失败：云端暂不可用，已保存在本机')
      setSyncStatus('error')
    }
  }, [cloudIdentity, favorites, noteDraft])

  const handleExportPlain = () => {
    const blob = new Blob([favorites.exportJson()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'navhub-favorites.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  // 一键将收藏导出为标准网址包插件清单向导 (site-pack)
  const handleExportAsPlugin = () => {
    setShowPluginExport(true)
  }

  const handleImportPlain = () => {
    const result = favorites.importJson(importText)
    if (result.ok) {
      setSyncNote('已导入 ' + result.imported + ' 条书签')
      setSyncStatus('success')
      setImportText('')
      setShowImport(false)
    } else {
      setSyncNote('导入失败：' + (result.error ?? '未知错误'))
      setSyncStatus('error')
    }
  }

  // E2EE 零知识加密导出
  const handleExportVault = async () => {
    if (!vaultPassword || vaultPassword.length < 6) {
      setSyncNote('主密码至少需要 6 个字符')
      setSyncStatus('error')
      return
    }
    if (vaultPassword !== vaultPasswordConfirm) {
      setSyncNote('两次输入的金库密码不一致')
      setSyncStatus('error')
      return
    }

    setVaultLoading(true)
    try {
      const vaultItems: VaultItem[] = favorites.items.map((f) => ({
        id: f.siteId,
        title: f.title,
        url: f.href,
        description: f.description,
        category: f.note,
        tags: f.icon ? [f.icon] : [],
        createdAt: f.createdAt,
      }))

      const payload = await encryptVault(vaultItems, vaultPassword)
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/octet-stream',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `navhub-vault-${new Date().toISOString().slice(0, 10)}.navhub.vault`
      a.click()
      URL.revokeObjectURL(url)

      setSyncNote(`🔒 成功导出已加密金库，共 ${vaultItems.length} 条收藏（AES-256-GCM 保护）`)
      setSyncStatus('success')
      setShowVaultExport(false)
      setVaultPassword('')
      setVaultPasswordConfirm('')
    } catch (err) {
      setSyncNote('加密导出失败：' + (err instanceof Error ? err.message : '未知异常'))
      setSyncStatus('error')
    } finally {
      setVaultLoading(false)
    }
  }

  // 响应文件选择
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      if (text) {
        setImportVaultPayload(text)
      }
    }
    reader.readAsText(file)
  }

  // E2EE 零知识解密导入
  const handleImportVault = async () => {
    if (!importVaultPayload.trim()) {
      setSyncNote('请选择或粘贴 .navhub.vault 加密文件内容')
      setSyncStatus('error')
      return
    }
    if (!importPassphrase) {
      setSyncNote('请输入金库解密主密码')
      setSyncStatus('error')
      return
    }

    setVaultLoading(true)
    try {
      const parsedPayload = JSON.parse(importVaultPayload) as EncryptedVaultPayload
      if (!parsedPayload.cipherTextBase64 || !parsedPayload.saltHex || !parsedPayload.ivHex) {
        throw new Error('不是合法的 NavHub E2EE 加密金库文件')
      }

      const decryptedItems = await decryptVault(parsedPayload, importPassphrase)

      // 还原为 LocalFavorite 格式
      const localItems = decryptedItems.map((item) => ({
        siteId: item.id,
        title: item.title,
        href: item.url,
        description: item.description,
        note: item.category,
        icon: item.tags?.[0],
        createdAt: item.createdAt ?? Date.now(),
      }))

      const importResult = favorites.importJson(JSON.stringify({ version: 1, items: localItems }))
      if (importResult.ok) {
        setSyncNote(`🔓 零知识金库解密成功！已恢复 ${decryptedItems.length} 条私密收藏`)
        setSyncStatus('success')
        setShowVaultImport(false)
        setImportPassphrase('')
        setImportVaultPayload('')
      } else {
        throw new Error(importResult.error ?? '合并入库失败')
      }
    } catch (err) {
      setSyncNote(err instanceof Error ? err.message : '解密失败：密码错误或密文被篡改')
      setSyncStatus('error')
    } finally {
      setVaultLoading(false)
    }
  }

  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-5 sm:space-y-6">
        <UserCenterNav />
        {/* 沉浸式 Hero 展板 */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-4 sm:p-8 shadow-xs">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -left-20 bottom-0 w-48 h-48 bg-sky-400/10 rounded-full blur-3xl" />
          <Shield
            aria-hidden
            strokeWidth={1}
            className="pointer-events-none absolute right-5 top-5 hidden sm:block w-16 h-16 text-border/70"
          />

          <div className="relative z-10 space-y-4">
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>返回主页</span>
              </Link>
              <span className="text-border">/</span>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                私密书签与 E2EE 金库
              </span>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="max-w-2xl">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-xs">
                    <Shield className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>
                  <span>我的离线收藏与零知识金库</span>
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  本地离线优先：收藏先存在本机，登录后自动与云端同步；也可用 AES-256-GCM 加密导出为 <code>.navhub.vault</code> 文件，密码不上云、不可逆、防篡改。
                </p>
              </div>

              {/* IA 收敛（N9）：主任务只留一个主操作，其余四个降级为「更多导入导出」，
                 分开摆放——它们本质是导入/导出的备选格式，与「管理收藏」不是同一层级。 */}
              <div className="flex flex-col gap-2 lg:items-end">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <Button
                  variant="default"
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 shadow-xs h-8.5 rounded-xl text-xs"
                  onClick={() => {
                    setShowVaultExport(!showVaultExport)
                    setShowVaultImport(false)
                    setShowImport(false)
                  }}
                  disabled={favorites.items.length === 0}
                >
                  <Shield className="w-3.5 h-3.5" /> 导出加密金库
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-1.5 h-8.5 rounded-xl text-xs border-border/70"
                  onClick={() => {
                    setShowVaultImport(!showVaultImport)
                    setShowVaultExport(false)
                    setShowImport(false)
                  }}
                >
                  <KeyRound className="w-3.5 h-3.5" /> 解密导入金库
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 border-t border-border/50 pt-3">
                <span className="text-[11px] text-muted-foreground">更多导入导出</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExportPlain}
                  disabled={favorites.items.length === 0}
                  className="text-xs text-muted-foreground h-8 rounded-lg hover:bg-accent"
                >
                  明文 JSON
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowImport(!showImport)
                    setShowVaultExport(false)
                    setShowVaultImport(false)
                  }}
                  className="text-xs text-muted-foreground h-8 rounded-lg hover:bg-accent"
                >
                  导入 JSON
                </Button>
                {/* 导出为插件属于「发布到市场」，不是数据管理动作：标注清楚去向 */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExportAsPlugin}
                  disabled={favorites.items.length === 0}
                  className="text-xs text-sky-600 dark:text-sky-400 h-8 rounded-lg hover:bg-sky-500/10"
                  title="把全部收藏打包成网址包插件（.json），可在插件市场发布"
                >
                  <Package className="w-3.5 h-3.5" /> 导出为插件
                </Button>
              </div>
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-border/50 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-500/25 bg-emerald-500/5 text-xs text-emerald-600 dark:text-emerald-400">
                <Shield className="w-3 h-3" />
                本地收藏 {favorites.ready ? favorites.items.length : '—'} 条
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                <KeyRound className="w-3 h-3 text-border" />
                AES-256-GCM 认证加密
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                <EyeOff className="w-3 h-3 text-border" />
                零知识：密码不上云
              </span>
            </div>
          </div>
        </div>

        {/* 云端同步状态：失败必须说出来，否则用户以为换设备也能看到 */}
        {(syncingCloud || cloudResult) && (
          <div
            className={`mb-6 p-3 rounded-lg border text-xs flex flex-wrap items-center gap-2 ${
              syncingCloud
                ? 'bg-muted border-border text-muted-foreground'
                : cloudResult?.ok
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400'
            }`}
          >
            {syncingCloud ? (
              <RefreshCw className="w-4 h-4 flex-shrink-0 animate-spin" />
            ) : cloudResult?.ok ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : (
              <CloudOff className="w-4 h-4 flex-shrink-0" />
            )}
            <span className="flex-1 min-w-0">
              {syncingCloud
                ? '正在与云端同步收藏…'
                : cloudResult?.ok
                ? cloudResult.pushed > 0
                  ? `已把本机 ${cloudResult.pushed} 条收藏合并到云端` +
                    (cloudResult.cloud ? `（云端共 ${cloudResult.cloud.length} 条）` : '')
                  : `云端同步正常` + (cloudResult.cloud ? `（云端 ${cloudResult.cloud.length} 条）` : '')
                : `云端同步失败：${cloudResult?.error ?? '未知原因'}。收藏已保存在本机浏览器，换设备登录可能看不到。`}
            </span>
            {!syncingCloud && cloudResult && !cloudResult.ok && cloudResult.retryable && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs rounded-lg gap-1.5"
                onClick={() =>
                  void (async () => {
                    const result = await runCloudSync()
                    applyCloudResult(result)
                  })()
                }
              >
                <RefreshCw className="w-3.5 h-3.5" />
                重试同步
              </Button>
            )}
          </div>
        )}

        {/* 本地收藏读不出来：写入会被拒绝（为了不覆盖原数据），必须把话说清楚并给出出口 */}
        {favorites.storageBlocked && (
          <div
            role="alert"
            className="mb-6 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p>{favorites.storageBlocked}</p>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs rounded-lg"
                onClick={() => {
                  favorites.resetLocal()
                  setSyncNote('已先把原数据备份到浏览器存储，并以空列表重置本地收藏')
                  setSyncStatus('info')
                }}
              >
                先备份原数据，再重置本地收藏
              </Button>
            </div>
          </div>
        )}

        {syncNote && (
          <div
            className={`mb-6 p-3 rounded-lg border text-xs flex items-center gap-2 ${
              syncStatus === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                : syncStatus === 'error'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                : 'bg-muted border-border text-muted-foreground'
            }`}
          >
            {syncStatus === 'success' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : syncStatus === 'error' ? (
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            ) : (
              <Shield className="w-4 h-4 flex-shrink-0" />
            )}
            <span>{syncNote}</span>
          </div>
        )}

        {syncLast && (
          <p className="mb-4 text-xs text-muted-foreground" data-testid="sync-last">
            上次同步：
            {syncLast.at > 0 ? new Date(syncLast.at).toLocaleTimeString('zh-CN', { hour12: false }) : '—'}
            {' · '}
            {syncLast.ok ? `成功（${syncLast.pushed} 条）` : `失败（${syncLast.error ?? '原因未知'}）`}
            {syncLast.remoteRemoved > 0 ? ` · 另一设备删除 ${syncLast.remoteRemoved} 条` : ''}
          </p>
        )}

        {/* 零知识加密导出面板 */}
        {showVaultExport && (
          <div className="mb-6 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                  <Shield className="w-4 h-4" /> 导出零知识加密金库 (.navhub.vault)
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  基于 PBKDF2 (100,000 次哈希迭代) 派生 256 位密钥 + AES-256-GCM 认证加密。密码不上云，不可逆，防篡改。
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowVaultExport(false)}>
                收起
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="vault-password-main" className="text-xs font-medium text-muted-foreground mb-1 block">
                  设置金库主密码 (至少 6 位)
                </label>
                <div className="relative">
                  <input aria-label="输入强主密码"
                    id="vault-password-main"
                    type={showPasswordText ? 'text' : 'password'}
                    value={vaultPassword}
                    onChange={(e) => setVaultPassword(e.target.value)}
                    placeholder="输入强主密码..."
                    className="w-full px-3 py-1.5 text-base sm:text-xs rounded-md border bg-background pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswordText(!showPasswordText)}
                    aria-label={showPasswordText ? '隐藏密码' : '显示密码'}
                    title={showPasswordText ? '隐藏密码' : '显示密码'}
                    aria-pressed={showPasswordText}
                    className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                  >
                    {showPasswordText ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="vault-password-confirm" className="text-xs font-medium text-muted-foreground mb-1 block">
                  确认金库主密码
                </label>
                <input id="vault-password-confirm"
                  type={showPasswordText ? 'text' : 'password'}
                  value={vaultPasswordConfirm}
                  onChange={(e) => setVaultPasswordConfirm(e.target.value)}
                  placeholder="再次输入相同密码..."
                  className="w-full px-3 py-1.5 text-base sm:text-xs rounded-md border bg-background"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5"
                onClick={handleExportVault}
                disabled={vaultLoading || !vaultPassword || vaultPassword.length < 6}
              >
                <Download className="w-3.5 h-3.5" />
                {vaultLoading ? '正在派生密钥加密…' : `生成并下载 .navhub.vault (${favorites.items.length} 条)`}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowVaultExport(false)}>
                取消
              </Button>
            </div>
          </div>
        )}

        {/* 零知识解密导入面板 */}
        {showVaultImport && (
          <div className="mb-6 p-4 rounded-xl border border-blue-500/30 bg-blue-500/5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
                  <KeyRound className="w-4 h-4" /> 导入并解密私密金库
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  输入主密码验证消息认证码 (GMAC)，如密码错误或密文遭到单字节篡改将立刻阻断并报警。
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowVaultImport(false)}>
                收起
              </Button>
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    选择 .navhub.vault 文件或粘贴密文
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6.5 text-xs px-2.5"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-3 h-3 mr-1" /> 选择本地金库文件
                  </Button>
                  <input aria-label="选择金库文件"
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".vault,.json"
                    className="hidden"
                  />
                </div>
                <textarea aria-label="可直接点击上方按钮选择文件，或在此粘贴密文 JSON"
                  value={importVaultPayload}
                  onChange={(e) => setImportVaultPayload(e.target.value)}
                  placeholder="可直接点击上方按钮选择文件，或在此粘贴密文 JSON..."
                  className="w-full h-24 rounded-md border bg-background p-2 text-base sm:text-xs font-mono"
                />
              </div>

              <div>
                <label htmlFor="vault-import-passphrase" className="text-xs font-medium text-muted-foreground mb-1 block">
                  输入此金库的主密码
                </label>
                <input id="vault-import-passphrase"
                  type="password"
                  value={importPassphrase}
                  onChange={(e) => setImportPassphrase(e.target.value)}
                  placeholder="输入解密密码..."
                  className="w-full sm:w-80 px-3 py-1.5 text-base sm:text-xs rounded-md border bg-background"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5"
                onClick={handleImportVault}
                disabled={vaultLoading || !importVaultPayload.trim() || !importPassphrase}
              >
                <KeyRound className="w-3.5 h-3.5" />
                {vaultLoading ? '正在解密并验证认证码…' : '验证密码并导入'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowVaultImport(false)}>
                取消
              </Button>
            </div>
          </div>
        )}

        {/* 传统明文 JSON 导入面板 */}
        {showImport && (
          <div className="mb-6 space-y-2 p-4 rounded-lg border bg-muted/20">
            <div className="text-xs font-medium text-muted-foreground">导入传统未加密 JSON</div>
            <textarea aria-label="粘贴导出的 JSON 文本"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='粘贴导出的 JSON，如 {"version":1,"items":[...]}'
              className="w-full h-24 rounded-md border bg-background p-2 text-base sm:text-xs font-mono"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleImportPlain} disabled={!importText.trim()}>
                确认导入
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowImport(false)}>
                取消
              </Button>
            </div>
          </div>
        )}

        {/* 收藏夹管理：只在登录身份下出现（文件夹是云端数据，匿名用户没有归属） */}
        {favorites.items.length > 0 && (
          <div className="mb-4 rounded-xl border border-border/70 bg-card/50 p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Folder className="h-3.5 w-3.5" />
                收藏夹
              </span>
              <button
                type="button"
                onClick={() => setActiveFolder('all')}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  activeFolder === 'all'
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border/60 bg-background/60 text-muted-foreground hover:text-foreground'
                }`}
              >
                全部 {favorites.items.length}
              </button>
              {folders.map((folder) => {
                const count = favorites.items.filter((f) => f.folderId === folder.id).length
                const active = activeFolder === folder.id
                return (
                  <span key={folder.id} className="inline-flex items-center gap-1">
                    {editingFolder === folder.id ? (
                      <>
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveFolderName(folder.id)
                            if (e.key === 'Escape') setEditingFolder(null)
                          }}
                          aria-label="收藏夹名称"
                          className="h-7 w-32 text-[11px]"
                          autoFocus
                        />
                        <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => void saveFolderName(folder.id)} aria-label="保存名称">
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setActiveFolder(active ? 'all' : folder.id)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                            active
                              ? 'border-primary/40 bg-primary/10 text-primary'
                              : 'border-border/60 bg-background/60 text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {folder.name} {count}
                        </button>
                        {active && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1 text-muted-foreground"
                              aria-label="重命名收藏夹"
                              onClick={() => {
                                setEditingFolder(folder.id)
                                setEditingName(folder.name)
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1 text-muted-foreground hover:text-destructive"
                              aria-label="删除收藏夹"
                              onClick={() => void removeFolder(folder.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                      </>
                    )}
                  </span>
                )
              })}
            </div>
            {cloudIdentity && (
              <>
                <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                  <Input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void addFolder()
                    }}
                    placeholder="新建收藏夹"
                    aria-label="新建收藏夹名称"
                    className="h-8 w-40 text-xs"
                  />
                  <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!newFolderName.trim() || folderBusy} onClick={() => void addFolder()}>
                    <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
                    创建
                  </Button>
                  {manageBusy && <span className="text-[11px] text-muted-foreground">正在同步…</span>}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
                  <span className="text-[11px] text-muted-foreground">清空只影响云端收藏；本机缓存会一并清除</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-destructive/30 text-[11px] text-destructive hover:bg-destructive/10"
                    disabled={manageBusy}
                    onClick={() => void clearCloud()}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    {confirmClearCloud ? '再次点击确认清空' : '清空云端收藏'}
                  </Button>
                </div>
              </>
            )}
            {/* 匿名态的能力边界要说清楚：能收藏、能导出，但收藏夹与备注需要登录 */}
            {!cloudIdentity && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                <LogIn className="h-3 w-3 shrink-0" />
                <span>登录后可创建收藏夹、写备注，并把本机收藏合并到账号。</span>
              </div>
            )}
          </div>
        )}

        {/* 本地筛选条：只在确实有收藏时出现（没有收藏时不需要筛选控件） */}
        {favorites.ready && favorites.items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[160px] sm:min-w-[13rem] max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={favoriteQuery}
                onChange={(e) => setFavoriteQuery(e.target.value)}
                placeholder="在收藏里筛选：标题 / 链接 / 描述"
                aria-label="筛选收藏"
                className="pl-8 h-9 text-sm"
              />
            </div>
            {filterSummary && (
              <span className="text-xs text-muted-foreground font-mono" role="status" aria-live="polite">
                {filterSummary}
              </span>
            )}
            {favoriteQuery && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 px-2 text-xs"
                onClick={() => setFavoriteQuery('')}
              >
                <X className="w-3.5 h-3.5 mr-1" />
                清除
              </Button>
            )}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value === 'title' ? 'title' : 'created')}
              aria-label="收藏排序"
              className="h-9 rounded-md border border-border/60 bg-background px-2 text-xs text-muted-foreground"
            >
              <option value="created">最近收藏</option>
              <option value="title">按标题</option>
            </select>
          </div>
        )}

        {!favorites.ready ? (
          <div aria-busy="true" aria-live="polite" aria-label="正在读取本地收藏" className="space-y-4">
            <span className="sr-only">加载中…</span>
            <div className="h-9 w-full max-w-md rounded-xl bg-muted/60 animate-pulse" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 sm:gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border/70 bg-card/50 p-4 space-y-3 animate-pulse"
                >
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-lg bg-muted shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-2/3 rounded bg-muted" />
                      <div className="h-3 w-full rounded bg-muted" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="h-5 w-16 rounded-full bg-muted" />
                    <div className="h-5 w-12 rounded-full bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : favorites.items.length === 0 ? (
          <EmptyState
            icon={Shield}
            iconTone="success"
            title="还没有收藏任何站点"
            description="在主页站点卡片或搜索结果里点击星标即可一键收藏（本地离线存储，无需登录，可随时导出为 E2EE 加密金库）。"
            action={
              <Button asChild size="sm" variant="outline" className="text-xs">
                <Link href="/">去主页探索发现</Link>
              </Button>
            }
          />
        ) : visibleFavorites.length === 0 ? (
          <EmptyState
            icon={Search}
            iconTone="muted"
            title={activeFolder === 'all' ? favoriteFilterEmptyMessage(favoriteQuery) : '这个收藏夹下还没有站点'}
            description={
              activeFolder === 'all'
                ? <>收藏并没有丢：共 {favorites.items.length} 个都还在本机，只是当前关键词没匹配到。</>
                : <>切换「全部」后可以把任意收藏移动到当前收藏夹。</>
            }
            action={
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => {
                  setFavoriteQuery('')
                  if (activeFolder !== 'all') setActiveFolder('all')
                }}
              >
                查看全部收藏
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1536px]:grid-cols-5! gap-3.5 sm:gap-4">
            {renderedFavorites.map((f) => (
              <div
                key={f.siteId}
                className="group relative overflow-hidden rounded-xl border border-border/70 hover:border-primary/40 bg-card/85 dark:bg-card/45 backdrop-blur-xs nav-card-glow transition-all duration-200 transform hover:-translate-y-0.5 p-3.5 flex flex-col justify-between"
              >
                <a href={f.href} target="_blank" rel="noopener noreferrer" className="block min-w-0">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg p-1.5 bg-muted/50 dark:bg-muted/20 border border-border/50 flex items-center justify-center transition-transform duration-200 group-hover:scale-105 shadow-xs">
                      {f.icon ? (
                        <img
                          src={f.icon}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-contain rounded-xs"
                          onError={(e) => {
                            ;(e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                      ) : (
                        <div className="w-full h-full rounded bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
                          {f.title.slice(0, 1)}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors truncate pr-8">
                        {f.title}
                      </div>
                      {f.description && (
                        <div className="text-xs text-muted-foreground/90 line-clamp-2 leading-relaxed mt-1">
                          {f.description}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground/70 font-mono mt-2">
                        {new Date(f.createdAt).toLocaleDateString('zh-CN')}
                      </div>
                    </div>
                  </div>
                </a>
                {cloudIdentity && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2">
                    <select
                      value={f.folderId ?? ''}
                      onChange={(e) => void assignFolder(f.siteId, e.target.value || null)}
                      aria-label={`移动 ${f.title} 到收藏夹`}
                      className="h-7 max-w-[8.5rem] rounded-md border border-border/60 bg-background px-1.5 text-[11px] text-muted-foreground"
                    >
                      <option value="">未分组</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>{folder.name}</option>
                      ))}
                    </select>
                    {noteEditor === f.siteId ? (
                      <span className="flex min-w-0 flex-1 items-center gap-1">
                        <Input
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveNote(f.siteId)
                            if (e.key === 'Escape') setNoteEditor(null)
                          }}
                          placeholder="备注"
                          aria-label="收藏备注"
                          className="h-7 text-[11px]"
                          autoFocus
                        />
                        <Button size="sm" variant="ghost" className="h-7 px-1" aria-label="保存备注" onClick={() => void saveNote(f.siteId)}>
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-1.5 text-[11px] text-muted-foreground"
                        onClick={() => {
                          setNoteEditor(f.siteId)
                          setNoteDraft(f.note ?? '')
                        }}
                      >
                        <Pencil className="mr-1 h-3 w-3" />
                        {f.note ? '改备注' : '备注'}
                      </Button>
                    )}
                    {f.note && noteEditor !== f.siteId && (
                      <span className="basis-full truncate text-[11px] text-muted-foreground">{f.note}</span>
                    )}
                  </div>
                )}
                <div className="absolute top-2 right-2">
                  <FavoriteButton site={f} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 渐进渲染的续载：未展示的条目仍在本地，只是不占用首屏 */}
        {visibleFavorites.length > renderedFavorites.length && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
              已显示 {renderedFavorites.length} / {visibleFavorites.length}
            </p>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setVisibleCount((n) => n + 60)}>
              加载更多收藏
            </Button>
          </div>
        )}

        <div className="mt-8 text-xs text-muted-foreground">
          {/* 数据在哪由状态决定，不再写死「只在本机」——那与上方的云端同步状态条自相矛盾 */}
          {cloudIdentity
            ? '收藏已与云端同步（换设备登录即可看到），本机缓存用于离线与快速打开。'
            : '当前为匿名身份：收藏只保存在本机浏览器，登录后可跨设备同步。'}
          <Link href="/tags" className="mx-1 text-primary hover:underline">去标签云看看</Link>
          或
          <Link href="/hot" className="mx-1 text-primary hover:underline">浏览热度榜</Link>
        </div>

        {/* 导出为插件市场清单向导弹窗 */}
        <ExportPluginModal
          open={showPluginExport}
          onOpenChange={setShowPluginExport}
          kind="site-pack"
          defaultName="我的精选收藏包"
          defaultDescription={`包含 ${favorites.items.length} 个优质网站的精选收藏包，由 NavHub 用户本地一键导出。`}
          defaultTags={['收藏', '网址包', '精选']}
          payload={{
            categories: [
              { title: '精选收藏', description: '用户个人精选网址收藏合集' },
            ],
            sites: favorites.items.map((item) => ({
              url: item.href,
              title: item.title,
              description: item.description || '',
              category: '精选收藏',
              tags: item.note ? [item.note] : ['收藏'],
            })),
          }}
        />
      </div>
      <Footer />
    </Container>
  )
}
