'use client'

/**
 * 本机离线数据资产管理组件 (LocalDataManager)
 *
 * 解决用户核心痛点：
 * 1. 匿名/免登录用户担心清空浏览器缓存后丢失自建分类、自定义网址、收藏书签与排版风格；
 * 2. 跨设备或跨浏览器迁移时，无需注册账号即可一键完整打包导出与还原；
 * 3. 实时清点当前设备本地存储的真实资产数量，提供安全透明的数据主权。
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Database,
  Download,
  Upload,
  Bookmark,
  Layers,
  History,
  Palette,
  HardDriveDownload,
  Loader2,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { useFavorites } from '@/hooks/useFavorites'
import { useHomeDIY, commitHomeDiyConfig } from '@/lib/modular/use-home-diy'
import { validateAndCleanDIYConfig } from '@/lib/modular/diy-presets'
import { readLocalUserSettings, writeLocalUserSettings } from '@/lib/user-settings'
import { LOCAL_FOLDERS_STORAGE_KEY, parseLocalFolders, serializeLocalFolders } from '@/lib/favorites-folders'
import {
  readOfflineVisits,
  clearOfflineVisits,
  recordOfflineVisit,
  type RecentVisit,
} from '@/lib/offline-recent'
import {
  getOfflineCacheStats,
  clearOfflineCache,
  type OfflineCacheStats,
} from '@/lib/offline-video-cache'
import {
  browserDiySnapshotStorage,
  deleteDiySnapshot,
  listDiySnapshots,
  readDiySnapshotConfig,
  saveDiySnapshot,
  type DiySnapshot,
} from '@/lib/modular/diy-snapshots'

export interface LocalDataBackupPayload {
  format: 'navhub-local-full-backup'
  version: 1
  exportedAt: string
  meta: {
    customCategoriesCount: number
    customSitesCount: number
    favoritesCount: number
    recentVisitsCount: number
  }
  favorites: any[]
  diyConfig: any
  recentVisits: RecentVisit[]
  settings?: any
  localFolders?: any[]
}

export function LocalDataManager() {
  const { toast } = useToast()
  const { items: favorites, importJson: importFavoritesJson, ready: favoritesReady } = useFavorites()
  const { config: diyConfig } = useHomeDIY()

  const [recentVisits, setRecentVisits] = useState<RecentVisit[]>([])
  const [loadingVisits, setLoadingVisits] = useState(true)
  const [restoring, setRestoring] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 排版版本快照（8e）：与撤销栈分离的命名版本
  const [snapshots, setSnapshots] = useState<DiySnapshot[]>([])
  const [snapshotName, setSnapshotName] = useState('')
  const [restoringSnapshot, setRestoringSnapshot] = useState<string | null>(null)

  const refreshSnapshots = useCallback(() => {
    const storage = browserDiySnapshotStorage()
    setSnapshots(storage ? listDiySnapshots(storage) : [])
  }, [])

  useEffect(() => {
    refreshSnapshots()
  }, [refreshSnapshots])

  /** 手动保存当前排版为一个版本 */
  const handleSaveSnapshot = useCallback(() => {
    const storage = browserDiySnapshotStorage()
    if (!storage) {
      toast({ title: '保存失败', description: '浏览器本地存储不可用。', variant: 'destructive' })
      return
    }
    const entry = saveDiySnapshot(storage, diyConfig, snapshotName || undefined)
    if (!entry) {
      toast({
        title: '保存失败',
        description: '本地存储写入失败（可能已满或处于隐私模式）。',
        variant: 'destructive',
      })
      return
    }
    setSnapshotName('')
    refreshSnapshots()
    toast({
      title: '版本已保存',
      description: `「${entry.name}」已存入本机，可在下方列表里一键恢复。`,
    })
  }, [diyConfig, snapshotName, refreshSnapshots, toast])

  /**
   * 一键恢复某版本：恢复前先把当前排版自动存为「恢复前自动备份」，
   * 再走 commitHomeDiyConfig（压撤销栈，Ctrl/Cmd+Z 也能撤回这次恢复）。
   */
  const handleRestoreSnapshot = useCallback((id: string) => {
    const storage = browserDiySnapshotStorage()
    if (!storage) {
      toast({ title: '恢复失败', description: '浏览器本地存储不可用。', variant: 'destructive' })
      return
    }
    const res = readDiySnapshotConfig(storage, id)
    if (!res.ok) {
      toast({ title: '恢复失败', description: res.reason, variant: 'destructive' })
      return
    }
    if (
      !window.confirm(
        `确定要把首页排版恢复到「${res.snapshot.name}」（${new Date(res.snapshot.createdAt).toLocaleString()}）吗？恢复前会自动把当前排版另存为一个版本，恢复后按 Ctrl/Cmd+Z 也可撤销。`,
      )
    ) {
      return
    }
    setRestoringSnapshot(id)
    try {
      // 自动备份的返回值必须验：存不进去（配额满 / 隐私模式）时 saveDiySnapshot
      // 返回 null，之前却照样 toast「恢复前那份已自动存为版本」。
      const autoBackup = saveDiySnapshot(storage, diyConfig, '恢复前自动备份')
      const result = commitHomeDiyConfig(() => ({
        ...diyConfig,
        ...res.config,
        updatedAt: Date.now(),
      }))
      if (!result.ok) {
        // 配置已经进了内存（commit 先改共享状态、再排队落盘），「排版未改动」
        // 是假话：内存里的排版已经变了，只是刷新会丢；撤销栈里还留着旧配置。
        refreshSnapshots()
        toast({
          title: '恢复未存住',
          description: '新排版已在内存中生效，但本地存储写入失败，刷新后会丢失。按 Ctrl/Cmd+Z 可撤销这次恢复。',
          variant: 'destructive',
        })
        return
      }
      refreshSnapshots()
      toast({
        title: '已恢复到指定版本',
        description: autoBackup
          ? `当前排版已切换为「${res.snapshot.name}」，恢复前那份已自动存为版本。按 Ctrl/Cmd+Z 可撤销。`
          : `当前排版已切换为「${res.snapshot.name}」。注意：恢复前自动备份失败（本地存储写入失败），旧排版只留在撤销历史里，刷新后无法找回；按 Ctrl/Cmd+Z 可撤销。`,
      })
    } finally {
      setRestoringSnapshot(null)
    }
  }, [diyConfig, refreshSnapshots, toast])

  const handleDeleteSnapshot = useCallback((id: string) => {
    const storage = browserDiySnapshotStorage()
    if (!storage) return
    const snap = snapshots.find((s) => s.id === id)
    if (!snap) return
    if (!window.confirm(`确定要删除版本「${snap.name}」吗？删除后无法找回。`)) return
    if (deleteDiySnapshot(storage, id)) {
      refreshSnapshots()
      toast({ title: '版本已删除', description: `「${snap.name}」已从本机移除。` })
    } else {
      toast({ title: '删除失败', description: '浏览器本地存储不可用。', variant: 'destructive' })
    }
  }, [snapshots, refreshSnapshots, toast])

  // 刷新离线足迹
  const refreshVisits = useCallback(async () => {
    setLoadingVisits(true)
    try {
      const list = await readOfflineVisits(50)
      setRecentVisits(list)
    } catch {
      // 存储访问受限时静默退守为空列表，不阻断页面渲染
      setRecentVisits([])
    } finally {
      setLoadingVisits(false)
    }
  }, [])

  useEffect(() => {
    void refreshVisits()
  }, [refreshVisits])

  /**
   * 离线视频缓存（第 5 张资产卡）。
   *
   * 背景：video-card 早就能把视频存进 IndexedDB，但 `getOfflineCacheStats` /
   * `clearOfflineCache` 这两个导出**全仓无人调用** —— 用户能存、却看不到占了多少、
   * 也删不掉，缓存只能一直躺在磁盘里。这里把它们接到资产清点上，与其余四类本机数据同口径。
   */
  const [videoStats, setVideoStats] = useState<OfflineCacheStats | null>(null)
  const [loadingVideoStats, setLoadingVideoStats] = useState(true)

  const refreshVideoStats = useCallback(async () => {
    setLoadingVideoStats(true)
    try {
      setVideoStats(await getOfflineCacheStats())
    } catch {
      // 存储受限（隐私模式 / 配额满）时退守为「读不出」，不阻断页面
      setVideoStats(null)
    } finally {
      setLoadingVideoStats(false)
    }
  }, [])

  useEffect(() => {
    void refreshVideoStats()
  }, [refreshVideoStats])

  const handleClearVideoCache = useCallback(async () => {
    try {
      await clearOfflineCache()
      await refreshVideoStats()
      toast({ title: '🧹 已清空离线视频缓存', description: '下次打开视频会重新联网加载。' })
    } catch {
      toast({ title: '⚠️ 清空失败', description: '浏览器本地存储不可用。' })
    }
  }, [refreshVideoStats, toast])

  // 计算自定义分类与网址数量
  const customCategories = diyConfig.customCategories || []
  const customSitesCount = customCategories.reduce(
    (acc, cat) => acc + (cat.items?.length || 0),
    0,
  )

  // 导出全量快照
  const handleExportBackup = () => {
    try {
      const settings = readLocalUserSettings()
      const localFolders = typeof window !== 'undefined'
        ? parseLocalFolders(window.localStorage.getItem(LOCAL_FOLDERS_STORAGE_KEY))
        : []
      const payload: LocalDataBackupPayload = {
        format: 'navhub-local-full-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        meta: {
          customCategoriesCount: customCategories.length,
          customSitesCount,
          favoritesCount: favorites.length,
          recentVisitsCount: recentVisits.length,
        },
        favorites,
        diyConfig,
        recentVisits,
        settings,
        localFolders,
      }

      const jsonStr = JSON.stringify(payload, null, 2)
      const blob = new Blob([jsonStr], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const now = new Date()
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`

      const a = document.createElement('a')
      a.href = url
      a.download = `navhub-local-backup-${dateStr}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast({
        title: '已导出本机全量数据快照',
        description: `包含 ${favorites.length} 条收藏、${customSitesCount} 个自定义网址及个性化排版方案。`,
      })
    } catch (err) {
      toast({
        title: '导出失败',
        description: err instanceof Error ? err.message : '生成备份文件时遇到异常',
        variant: 'destructive',
      })
    }
  }

  // 还原本地备份
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setRestoring(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)

      let restoredFavorites = 0
      let restoredCustomSites = 0
      let restoredVisits = 0
      /** 排版配置没还原的原因（null = 已还原或备份里本来就没有）；最终 toast 据此说真话 */
      let diyRestoreFailed: string | null = null

      // 1. 恢复书签收藏
      if (Array.isArray(data.favorites) && data.favorites.length > 0) {
        const favRes = importFavoritesJson(JSON.stringify(data.favorites))
        if (favRes.ok) {
          restoredFavorites = favRes.imported
        }
      }

      // 2. 恢复 DIY 布局与专属分类：先白名单校验（validateAndCleanDIYConfig，
      // 与读盘 / 分享链接同一道闸），再看 commit 的返回值；落盘失败时改动只在
      // 内存里，绝不能按输入原样报「已恢复 N 个网址」。
      if (data.diyConfig && typeof data.diyConfig === 'object') {
        const check = validateAndCleanDIYConfig(data.diyConfig)
        if (!check.valid || !check.config) {
          diyRestoreFailed = check.error || '排版配置格式无效'
          toast({
            title: '排版配置未还原',
            description: `备份里的排版配置无效（${diyRestoreFailed}），已跳过；书签与足迹照常还原。`,
            variant: 'destructive',
          })
        } else {
          const result = commitHomeDiyConfig((prev) => ({
            ...prev,
            ...check.config,
            updatedAt: Date.now(),
          }))
          if (!result.ok) {
            diyRestoreFailed = '本地存储写入失败'
            toast({
              title: '排版配置未存住',
              description: '排版已在内存中生效，但本地存储写入失败，刷新后会丢失。',
              variant: 'destructive',
            })
          } else {
            // 个数按真正落地那份算，不按输入原样算（清洗可能丢弃整类内容）
            const landedCats = result.config.customCategories || []
            restoredCustomSites = landedCats.reduce(
              (acc: number, c: any) => acc + (c.items?.length || 0),
              0,
            )
          }
        }
      }

      // 3. 恢复离线足迹
      if (Array.isArray(data.recentVisits)) {
        for (const visit of data.recentVisits) {
          if (visit.id && visit.title && visit.href) {
            recordOfflineVisit({
              id: visit.id,
              title: visit.title,
              href: visit.href,
              icon: visit.icon,
            })
            restoredVisits++
          }
        }
        await refreshVisits()
      }

      // 4. 恢复本地偏好设置
      if (data.settings && typeof data.settings === 'object') {
        writeLocalUserSettings(data.settings)
      }

      // 5. 恢复本地收藏夹分组
      if (Array.isArray(data.localFolders) && data.localFolders.length > 0) {
        try {
          window.localStorage.setItem(LOCAL_FOLDERS_STORAGE_KEY, serializeLocalFolders(data.localFolders))
        } catch {
          /* 忽略本地存储写入异常 */
        }
      }

      toast(
        diyRestoreFailed
          ? {
              title: '本地数据已部分还原',
              description: `已恢复 ${restoredFavorites} 条书签、${restoredCustomSites} 个自定义网址与 ${restoredVisits} 条历史足迹；排版配置未还原（${diyRestoreFailed}）。`,
              variant: 'destructive' as const,
            }
          : {
              title: '本地数据还原成功',
              description: `成功恢复 ${restoredFavorites} 条书签、${restoredCustomSites} 个自定义网址与 ${restoredVisits} 条历史足迹。`,
            },
      )
    } catch (err) {
      toast({
        title: '还原失败',
        description: err instanceof Error ? err.message : '备份文件格式不合法或已损坏',
        variant: 'destructive',
      })
    } finally {
      setRestoring(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // 清空足迹缓存
  const handleClearVisits = async () => {
    if (!window.confirm('确定要清空本机的离线访问足迹吗？此操作不会影响您的书签收藏与自定义网址。')) {
      return
    }

    try {
      await clearOfflineVisits()
      await refreshVisits()
      toast({
        title: '已清空离线足迹',
        description: '本机缓存的近期访问记录已安全移除。',
      })
    } catch {
      // 容错处理：若 IndexedDB 清理受阻则向用户提示
      toast({
        title: '清空足迹失败',
        description: '请检查浏览器存储权限设置。',
        variant: 'destructive',
      })
    }
  }

  return (
    <section aria-labelledby="local-data-manager-heading" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div>
          <h2
            id="local-data-manager-heading"
            className="text-base sm:text-lg font-bold flex items-center gap-2 text-foreground"
          >
            <Database className="w-5 h-5 text-emerald-500" />
            <span>本机离线数据资产管理</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            无论是否登录，本设备的所有书签、自定义网址与个性化排版均可在此全量导出备份与跨浏览器还原。
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            aria-label="选择本地备份 JSON 文件"
            onChange={handleFileChange}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={restoring}
            className="h-8 text-xs gap-1.5 shadow-2xs font-medium cursor-pointer"
          >
            {restoring ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5 text-primary" />
            )}
            <span>从备份还原</span>
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleExportBackup}
            className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs font-medium cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>导出全量快照</span>
          </Button>
        </div>
      </div>

      {/* 资产清点卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="rounded-xl border border-border/70 bg-card p-3.5 space-y-1.5 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">专属分类与私有网址</span>
            <Layers className="w-4 h-4 text-violet-500" />
          </div>
          <div className="text-xl font-extrabold text-foreground font-mono">
            {customSitesCount}
            <span className="text-xs font-normal text-muted-foreground ml-1">个</span>
          </div>
          <p className="text-[11px] text-muted-foreground truncate">
            分布于 {customCategories.length} 个专属分类
          </p>
        </div>

        <div className="rounded-xl border border-border/70 bg-card p-3.5 space-y-1.5 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">本机收藏书签</span>
            <Bookmark className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xl font-extrabold text-foreground font-mono">
            {favorites.length}
            <span className="text-xs font-normal text-muted-foreground ml-1">条</span>
          </div>
          <p className="text-[11px] text-muted-foreground truncate">
            {favoritesReady ? '本地存储正常' : '正在读取…'}
          </p>
        </div>

        <div className="rounded-xl border border-border/70 bg-card p-3.5 space-y-1.5 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">离线历史足迹</span>
            <History className="w-4 h-4 text-sky-500" />
          </div>
          <div className="text-xl font-extrabold text-foreground font-mono">
            {recentVisits.length}
            <span className="text-xs font-normal text-muted-foreground ml-1">条</span>
          </div>
          <div className="flex items-center justify-between gap-1 pt-0.5">
            <p className="text-[11px] text-muted-foreground truncate">
              {loadingVisits ? '正在核对…' : '常用站点高频足迹'}
            </p>
            {recentVisits.length > 0 && (
              <button
                type="button"
                onClick={handleClearVisits}
                aria-label="清空离线足迹"
                className="text-[10px] text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                title="清空离线足迹缓存"
              >
                清空
              </button>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card p-3.5 space-y-1.5 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">个性化排版方案</span>
            <Palette className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-sm font-bold text-foreground truncate pt-0.5">
            {diyConfig.viewMode === 'hybrid'
              ? '极客混合流'
              : diyConfig.viewMode === 'workbench'
                ? '沉浸工作台'
                : '经典全景流'}
          </div>
          <p className="text-[11px] text-muted-foreground truncate font-mono">
            背景: {diyConfig.canvasBackground || 'mesh'} · 色系: {diyConfig.accentColor || 'default'}
          </p>
        </div>

        <div className="rounded-xl border border-border/70 bg-card p-3.5 space-y-1.5 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">离线视频缓存</span>
            <HardDriveDownload className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-xl font-extrabold text-foreground font-mono">
            {loadingVideoStats ? '—' : (videoStats?.count ?? 0)}
            <span className="text-xs font-normal text-muted-foreground ml-1">部</span>
          </div>
          <div className="flex items-center justify-between gap-1 pt-0.5">
            <p className="text-[11px] text-muted-foreground truncate">
              {loadingVideoStats
                ? '正在核对…'
                : videoStats && videoStats.count > 0
                  ? `离线可看 · ${videoStats.storageType}`
                  : '暂无离线视频'}
            </p>
            {(videoStats?.count ?? 0) > 0 && (
              <button
                type="button"
                onClick={handleClearVideoCache}
                aria-label="清空离线视频缓存"
                className="text-[10px] text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                title="清空离线视频缓存，释放本机空间"
              >
                清空
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 排版版本快照（8e）：与撤销栈分离的命名版本，可一键恢复 */}
      <div className="rounded-xl border border-border/70 bg-card p-4 space-y-3 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-2 text-foreground">
              <History className="w-4 h-4 text-violet-500" />
              <span>排版版本快照</span>
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              手动保存当前排版为一个版本，随时一键恢复；恢复前会自动把当前排版另存一份。分享链接确认前自动备份的版本也会出现在这里。
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
              placeholder="版本名称（可选）"
              aria-label="版本名称"
              className="h-8 w-40 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground"
            />
            <Button
              type="button"
              size="sm"
              onClick={handleSaveSnapshot}
              className="h-8 text-xs gap-1.5 shadow-2xs font-medium cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>保存当前版本</span>
            </Button>
          </div>
        </div>

        {snapshots.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            还没有保存过版本。点「保存当前版本」，改坏了也能一键回来。
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {snapshots.map((snap) => (
              <li key={snap.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground truncate">{snap.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                      {snap.source === 'manual' ? '手动保存' : '分享前自动备份'}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(snap.createdAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleRestoreSnapshot(snap.id)}
                  disabled={restoringSnapshot !== null}
                  className="h-7 text-xs gap-1 cursor-pointer"
                >
                  {restoringSnapshot === snap.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3 h-3" />
                  )}
                  <span>恢复</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteSnapshot(snap.id)}
                  aria-label={`删除版本 ${snap.name}`}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
