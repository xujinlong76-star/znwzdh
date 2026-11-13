'use client'

/**
 * 首页 DIY hook：只保留 React 状态编排。共享状态/本地存储在同目录
 * home-diy-storage.ts，导入导出/云金库在 home-diy-io.ts（2026-10-19 P1-1 拆分）。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  BUILTIN_DIY_PRESETS,
  clampCardOpacity,
  collapseAllCategories as collapseAllCategoriesPure,
  computeSmartAutoTune,
  expandAllCategories as expandAllCategoriesPure,
  isSafeWallpaperUrl,
  reorderCategoryToTarget,
  toggleCollapsedCategory as toggleCollapsedCategoryPure,
  togglePinnedSiteInCategory,
  type DIYPreset,
} from '@/lib/modular/diy-presets'
import {
  readSlotClocks,
  type LayoutSlotClocks,
} from '@/lib/modular/layout-sync'
import { encodeVersionedShareLink, type ShareLinkOutcome } from '@/lib/diy-share-link'
import {
  DEFAULT_CONFIG,
  applyRemoteHomeDiyConfig,
  claimHomeDiyHistoryStep,
  commitHomeDiyConfig,
  confirmHomeDiyShare,
  dismissHomeDiyShare,
  dismissHomeDiyStorageWarning,
  flushHomeDiyDiskWrites,
  getEffectiveSlotClocks,
  getHomeDiySnapshot,
  hydrateHomeDiy,
  redoHomeDiy,
  setHomeDiyEditingLayout,
  stageHomeDiyPendingShare,
  STORAGE_CLOCKS_KEY,
  subscribeHomeDiy,
  undoHomeDiy,
  type AccentColor,
  type CanvasBackground,
  type CardDisplayMode,
  type CustomCategory,
  type CustomCategoryItem,
  type HomeDIYConfig,
  type HomeDiyWriteResult,
  type HomeViewMode,
} from './home-diy-storage'
import {
  asShareFields,
  checkCloudVaultStatus as checkCloudVaultStatusPure,
  clearCloudVault as clearCloudVaultPure,
  exportDIYConfig as exportDIYConfigPure,
  exportEncryptedDIYConfig as exportEncryptedDIYConfigPure,
  importDIYConfig as importDIYConfigPure,
  importEncryptedDIYConfig as importEncryptedDIYConfigPure,
  prepareHomeDiyImport,
  syncFromCloudVault as syncFromCloudVaultPure,
  syncToCloudVault as syncToCloudVaultPure,
} from './home-diy-io'
import { notifyLayoutSyncMerge } from './layout-sync-events'
import {
  publishSharedLayoutSync,
  subscribeSharedLayoutSyncChannel,
} from './use-home-diy-grid'

// 保持既有导入路径可用：所有从 '@/lib/modular/use-home-diy' 导入
// DEFAULT_CONFIG / STORAGE_KEY / 存储函数 / 类型的调用方无需改动。
export * from './home-diy-storage'

export function useHomeDIY() {
  const { config, history, isEditingLayout, storageWarning, pendingShare } = useSyncExternalStore(
    subscribeHomeDiy,
    getHomeDiySnapshot,
    getHomeDiySnapshot,
  )
  const [mounted, setMounted] = useState(false)

  // 1. 客户端挂载时读本地存储（v3 / v2 / v1 迁移 + #diy 分享链接）并填充共享状态。
  //    只让第一个挂载的组件去读：共享状态只有一份，后挂载的组件
  //    （例如切到 hybrid 才动态加载的 HomeHeroDeck）再读一遍会把撤销栈冲掉。
  useEffect(() => {
    hydrateHomeDiy()
    setMounted(true)
  }, [])

  // 2. 动态同步强调色到文档根元素属性
  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (config.accentColor && config.accentColor !== 'default') {
        document.documentElement.setAttribute('data-accent', config.accentColor)
      } else {
        document.documentElement.removeAttribute('data-accent')
      }
    }
  }, [config.accentColor])

  // 3. 持久化 + 跨标签广播（撤销历史已挪进共享状态，见本文件顶部说明）
  const publishToOtherTabs = useCallback((result: HomeDiyWriteResult) => {
    // 落盘成功才广播：本地都没存住，广播出去只会让别的标签页拿到一份
    // 本标签页刷新后就消失的布局。通道走 use-home-diy-grid.ts 的模块级
    // 单例（与网格 hook 共用一条 BroadcastChannel，见该文件顶部注释）。
    if (!result.ok) return
    publishSharedLayoutSync({ config: result.config, clocks: result.clocks })
  }, [])

  /**
   * 落盘并把结果回传给调用方。
   *
   * 原实现直接丢弃 HomeDiyWriteResult：隐私模式/配额满时写入失败，调用方
   * 仍然弹「已成功收录」，刷新后站点消失——这是最伤信任的一类假成功。
   */
  const persistConfig = useCallback((updater: (prev: HomeDIYConfig) => HomeDIYConfig) => {
    const result = commitHomeDiyConfig(updater)
    publishToOtherTabs(result)
    return result
  }, [publishToOtherTabs])

  // 3.1 接收远端标签页的改动：按插槽 LWW 合并，绝不整表覆盖
  const applyRemoteConfig = useCallback((payload: { config: HomeDIYConfig; clocks: LayoutSlotClocks }) => {
    // 合并、落盘、更新共享状态都在 lib 里做：不压撤销历史（远端改动不是本标签页的
    // 操作，进栈会让 Ctrl+Z 行为不可预测），也不再广播（否则两边互相推回声）
    const before = getHomeDiySnapshot().config
    // 合并前的本地时钟必须用有效时钟（磁盘 + 内存里尚未落盘的）：防抖期内
    // 刚提交的本地改动还在 300ms 定时器里，磁盘时钟还是旧的；只读磁盘会把
    // 这次本地改动当成「从来没改过」，远端赢下来时 discardedLocal 就漏报了。
    const beforeClocks = getEffectiveSlotClocks()
    const result = applyRemoteHomeDiyConfig(payload)
    if (result && result.ok) {
      // 只在合并确实落盘后才通知：result.ok 为 false 时合并只在内存里生效，
      // 刷新即丢，此时弹「已同步对方标签页的改动」是假成功；落盘失败本身已由
      // storageWarning 横幅（home-diy-trigger 渲染）如实告知用户。
      notifyLayoutSyncMerge({ before, after: result.config, remote: payload.config, beforeClocks })
    }
  }, [])

  // 3.2 建立 / 拆除跨标签页通道：走模块级单例（use-home-diy-grid.ts），
  // 全标签页不论挂了多少个 useHomeDIY / useHomeDiyGrid 实例都只建一条
  // BroadcastChannel；最后一个实例卸载时才关闭。
  useEffect(() => {
    if (!mounted) return
    return subscribeSharedLayoutSyncChannel(applyRemoteConfig)
  }, [mounted, applyRemoteConfig])

  // 3.3 落盘是防抖的：关标签页前把挂起的写立即刷掉，否则最后 300ms 内的
  // 改动会丢（内存里有、磁盘上没有）。只听 beforeunload 不够：
  //   - 移动端关标签 / 切后台时 beforeunload 不可靠甚至不触发；
  //   - 崩溃时 beforeunload 根本不会跑。
  // 因此同时听 visibilitychange（切后台瞬间刷盘：此时页面仍活着，
  // 写盘成功率远高于卸载那一刻）与 pagehide（卸载兜底，移动端也触发）。
  useEffect(() => {
    if (!mounted) return
    const flush = () => flushHomeDiyDiskWrites()
    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.hidden) flush()
    }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [mounted])

  // 4. 视图模态切换
  const setViewMode = useCallback((mode: HomeViewMode) => {
    persistConfig((prev) => ({ ...prev, viewMode: mode, updatedAt: Date.now() }))
  }, [persistConfig])

  // 5. 卡片视觉形态切换
  const setCardDisplayMode = useCallback((mode: CardDisplayMode) => {
    persistConfig((prev) => ({ ...prev, cardDisplayMode: mode, updatedAt: Date.now() }))
  }, [persistConfig])

  // 6. 画布背景切换
  const setCanvasBackground = useCallback((bg: CanvasBackground) => {
    persistConfig((prev) => ({ ...prev, canvasBackground: bg, updatedAt: Date.now() }))
  }, [persistConfig])

  // 7. 强调色切换
  const setAccentColor = useCallback((color: AccentColor) => {
    persistConfig((prev) => ({ ...prev, accentColor: color, updatedAt: Date.now() }))
  }, [persistConfig])

  // 8. 折叠/展开首屏组件展板
  const toggleHeroDeckCollapsed = useCallback(() => {
    persistConfig((prev) => ({ ...prev, heroDeckCollapsed: !prev.heroDeckCollapsed, updatedAt: Date.now() }))
  }, [persistConfig])

  // 9. 更新首屏挂载的组件列表
  const setHeroDeckWidgets = useCallback((widgets: string[]) => {
    persistConfig((prev) => ({ ...prev, heroDeckWidgets: widgets, updatedAt: Date.now() }))
  }, [persistConfig])

  // 10. 分类置顶/取消置顶
  const togglePinCategory = useCallback((categoryId: string) => {
    persistConfig((prev) => {
      const isPinned = prev.pinnedCategoryIds.includes(categoryId)
      const nextPinned = isPinned
        ? prev.pinnedCategoryIds.filter((id) => id !== categoryId)
        : [...prev.pinnedCategoryIds, categoryId]
      return { ...prev, pinnedCategoryIds: nextPinned, updatedAt: Date.now() }
    })
  }, [persistConfig])

  // 11. 分类隐藏/恢复
  const toggleHideCategory = useCallback((categoryId: string) => {
    persistConfig((prev) => {
      const isHidden = prev.hiddenCategoryIds.includes(categoryId)
      const nextHidden = isHidden
        ? prev.hiddenCategoryIds.filter((id) => id !== categoryId)
        : [...prev.hiddenCategoryIds, categoryId]
      return { ...prev, hiddenCategoryIds: nextHidden, updatedAt: Date.now() }
    })
  }, [persistConfig])

  // 12. 恢复单个分类
  const unhideCategory = useCallback((categoryId: string) => {
    persistConfig((prev) => ({
      ...prev,
      hiddenCategoryIds: prev.hiddenCategoryIds.filter((id) => id !== categoryId),
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  // 13. 恢复全部隐藏的分类
  const unhideAllCategories = useCallback(() => {
    persistConfig((prev) => ({ ...prev, hiddenCategoryIds: [], updatedAt: Date.now() }))
  }, [persistConfig])

  // 13.1 批量设置隐藏分类列表（供大纲预设筛选使用）
  const setHiddenCategories = useCallback((categoryIds: string[]) => {
    persistConfig((prev) => ({ ...prev, hiddenCategoryIds: categoryIds, updatedAt: Date.now() }))
  }, [persistConfig])

  // 14. 分类上下移动
  const moveCategory = useCallback((categoryId: string, direction: 'up' | 'down', currentAllIds: string[]) => {
    persistConfig((prev) => {
      const order = prev.categoryOrder.length > 0 ? [...prev.categoryOrder] : [...currentAllIds]
      for (const id of currentAllIds) {
        if (!order.includes(id)) order.push(id)
      }

      const index = order.indexOf(categoryId)
      if (index === -1) return prev

      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= order.length) return prev

      const [removed] = order.splice(index, 1)
      if (removed !== undefined) {
        order.splice(targetIndex, 0, removed)
      }

      return { ...prev, categoryOrder: order, updatedAt: Date.now() }
    })
  }, [persistConfig])

  // 14.1 拖拽定向重排分类次序
  const reorderCategory = useCallback((
    sourceId: string,
    targetId: string,
    position: 'before' | 'after' = 'before',
    currentAllIds: string[] = []
  ) => {
    persistConfig((prev) => {
      const nextOrder = reorderCategoryToTarget(
        prev.categoryOrder,
        sourceId,
        targetId,
        position,
        currentAllIds
      )
      return { ...prev, categoryOrder: nextOrder, updatedAt: Date.now() }
    })
  }, [persistConfig])

  // 15. 分类内站点置顶切换
  const togglePinSiteInCategory = useCallback((categoryId: string, siteId: string) => {
    persistConfig((prev) => {
      const updatedMap = togglePinnedSiteInCategory(prev.pinnedSiteIdsByCategory, categoryId, siteId)
      return { ...prev, pinnedSiteIdsByCategory: updatedMap, updatedAt: Date.now() }
    })
  }, [persistConfig])

  // 15.1 单分类卡片形态单独覆盖
  const setCategoryDensityOverride = useCallback((categoryId: string, mode?: CardDisplayMode) => {
    persistConfig((prev) => {
      const current = { ...(prev.categoryDensityOverrides || {}) }
      if (!mode) {
        delete current[categoryId]
      } else {
        current[categoryId] = mode
      }
      return { ...prev, categoryDensityOverrides: current, updatedAt: Date.now() }
    })
  }, [persistConfig])

  // 15.2 首屏速览星标坞开关与增删
  const toggleSpeedDial = useCallback(() => {
    persistConfig((prev) => ({
      ...prev,
      speedDialEnabled: !prev.speedDialEnabled,
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  const pinToSpeedDial = useCallback((siteId: string) => {
    persistConfig((prev) => {
      const current = prev.speedDialPinnedIds || []
      if (current.includes(siteId)) return prev
      return { ...prev, speedDialPinnedIds: [...current, siteId], updatedAt: Date.now() }
    })
  }, [persistConfig])

  const unpinFromSpeedDial = useCallback((siteId: string) => {
    persistConfig((prev) => ({
      ...prev,
      speedDialPinnedIds: (prev.speedDialPinnedIds || []).filter((id) => id !== siteId),
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  // 15.4 智能自适应一键调优
  const applySmartAutoTune = useCallback((sites: any[], categories: any[]) => {
    let visitStats: Record<string, { count: number }> = {}
    try {
      if (typeof window !== 'undefined') {
        const rawVisits = localStorage.getItem('navhub_visit_counts_v1')
        if (rawVisits) visitStats = JSON.parse(rawVisits)
      }
    } catch {
      // 理由：解析本地访问计数失败时静默降级为空，不阻断主流程
    }

    let favoriteIds: string[] = []
    try {
      if (typeof window !== 'undefined') {
        const rawFavs = localStorage.getItem('navhub_favorite_sites_v1')
        if (rawFavs) {
          const parsed = JSON.parse(rawFavs)
          favoriteIds = Array.isArray(parsed)
            ? parsed.map((item: any) => (typeof item === 'string' ? item : item?.siteId || item?.id)).filter(Boolean)
            : []
        }
      }
    } catch {
      // 理由：解析本地收藏站点失败时静默降级为空，不阻断主流程
    }

    const result = computeSmartAutoTune(sites, categories, visitStats, favoriteIds)
    persistConfig((prev) => ({
      ...prev,
      speedDialPinnedIds: result.speedDialPinnedIds,
      speedDialEnabled: result.speedDialEnabled,
      categoryOrder: result.categoryOrder,
      collapsedCategoryIds: result.collapsedCategoryIds,
      enableAdaptiveRanking: result.enableAdaptiveRanking,
      updatedAt: Date.now(),
    }))
    return result
  }, [persistConfig])

  // 16. 重置分类排序与显隐
  const resetCategoryLayout = useCallback(() => {
    persistConfig((prev) => ({
      ...prev,
      categoryOrder: [],
      pinnedCategoryIds: [],
      hiddenCategoryIds: [],
      pinnedSiteIdsByCategory: {},
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  // 16.1 智能自适应热度半衰期推荐排序开关
  const toggleAdaptiveRanking = useCallback(() => {
    persistConfig((prev) => ({
      ...prev,
      enableAdaptiveRanking: !prev.enableAdaptiveRanking,
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  // 17. 添加自定义专属分类
  const addCustomCategory = useCallback((title: string, icon?: string) => {
    if (!title.trim()) return
    const newCat: CustomCategory = {
      id: `custom_cat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: title.trim(),
      icon: icon || 'FolderHeart',
      items: [],
      createdAt: Date.now(),
    }
    persistConfig((prev) => ({
      ...prev,
      customCategories: [newCat, ...prev.customCategories],
      updatedAt: Date.now(),
    }))
    return newCat.id
  }, [persistConfig])

  // 18. 删除自定义分类
  const deleteCustomCategory = useCallback((categoryId: string) => {
    persistConfig((prev) => ({
      ...prev,
      customCategories: prev.customCategories.filter((c) => c.id !== categoryId),
      pinnedCategoryIds: prev.pinnedCategoryIds.filter((id) => id !== categoryId),
      hiddenCategoryIds: prev.hiddenCategoryIds.filter((id) => id !== categoryId),
      categoryOrder: prev.categoryOrder.filter((id) => id !== categoryId),
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  // 19. 添加站点到自建专属分类
  /**
   * 把站点收录进自建分类。
   *
   * 返回值是调用方弹提示的唯一依据：
   *  - `added`：真的写进了分类；
   *  - `duplicate`：分类里已有同 id / 同 href 的条目（不是失败，但不该说「已添加」）；
   *  - `failed`：写盘失败（隐私模式 / 配额满），改动只在内存里，刷新即消失。
   */
  const addSiteToCustomCategory = useCallback(
    (categoryId: string, site: CustomCategoryItem): 'added' | 'duplicate' | 'failed' => {
      let outcome: 'added' | 'duplicate' = 'added'
      const result = persistConfig((prev) => {
        const nextCats = prev.customCategories.map((cat) => {
          if (cat.id !== categoryId) return cat
          if (cat.items.some((i) => i.id === site.id || i.href === site.href)) {
            outcome = 'duplicate'
            return cat
          }
          return {
            ...cat,
            items: [site, ...cat.items],
          }
        })
        return { ...prev, customCategories: nextCats, updatedAt: Date.now() }
      })
      if (!result.ok) return 'failed'
      return outcome
    },
    [persistConfig],
  )

  // 20. 从自建分类移除站点
  const removeSiteFromCustomCategory = useCallback((categoryId: string, siteId: string) => {
    persistConfig((prev) => {
      const nextCats = prev.customCategories.map((cat) => {
        if (cat.id !== categoryId) return cat
        return {
          ...cat,
          items: cat.items.filter((i) => i.id !== siteId),
        }
      })
      return { ...prev, customCategories: nextCats, updatedAt: Date.now() }
    })
  }, [persistConfig])

  // 21. 一键应用预设情境模版
  const applyDIYPreset = useCallback((presetId: string, setDensityCallback?: (density: string) => void) => {
    const target = BUILTIN_DIY_PRESETS.find((p: DIYPreset) => p.id === presetId)
    if (!target) return false

    persistConfig((prev) => ({
      ...prev,
      viewMode: target.config.viewMode,
      cardDisplayMode: target.config.cardDisplayMode,
      canvasBackground: target.config.canvasBackground,
      heroDeckCollapsed: target.config.heroDeckCollapsed,
      heroDeckWidgets: target.config.heroDeckWidgets,
      // 预设自带的速览星标坞开关：speed-dial-dock 直接读 config.speedDialEnabled，
      // 以前这里不写它，四个预设文案里承诺的速览坞一个都没生效。没写该字段的
      // 旧预设保持本地值，不拿默认值压掉。
      speedDialEnabled: target.config.speedDialEnabled ?? prev.speedDialEnabled,
      updatedAt: Date.now(),
    }))

    if (setDensityCallback) {
      setDensityCallback(target.config.density)
    }
    return true
  }, [persistConfig])

  // 22-27. 导入/导出与云端金库：纯逻辑在同目录 home-diy-io.ts，这里只做状态接线。
  const exportDIYConfig = useCallback(() => exportDIYConfigPure(config), [config])

  const importDIYConfig = useCallback(
    (jsonString: string) => importDIYConfigPure(jsonString, persistConfig),
    [persistConfig],
  )

  /**
   * 导入第一步（挂起待确认）：先验证 + 生成 diff 预览，把结果挂到
   * pendingShare（source: 'import'），由分享确认对话框确认/忽略；
   * 不直接写盘。备份对话框有这个 prop 时走这条路，没传时回落直接导入。
   * 异步：验证要动态加载 zod 模块（约 103 KB，不进首屏）。
   */
  const stageImportForConfirm = useCallback(
    async (jsonString: string): Promise<{ ok: boolean; message: string }> => {
      const prepared = await prepareHomeDiyImport(jsonString, config)
      if (!prepared.ok) {
        return { ok: false, message: prepared.message }
      }
      // pending 是导入形（carriedFields 为 keyof 全集），确认对话框与
      // merge 只认分享字段集：asShareFields 只是过类型（见 home-diy-io.ts）。
      stageHomeDiyPendingShare({
        imported: prepared.pending.imported,
        diff: prepared.pending.diff,
        warning: prepared.pending.warning,
        carriedFields: [...asShareFields(prepared.pending.carriedFields)],
        source: 'import',
      })
      return { ok: true, message: '' }
    },
    [config],
  )

  // 24. 重置全量配置
  const resetDIYConfig = useCallback(() => {
    persistConfig(() => ({ ...DEFAULT_CONFIG, updatedAt: Date.now() }))
  }, [persistConfig])

  const exportEncryptedDIYConfig = useCallback(
    (passphrase: string) => exportEncryptedDIYConfigPure(config, passphrase),
    [config],
  )

  const importEncryptedDIYConfig = useCallback(
    (encryptedJsonStr: string, passphrase: string) =>
      importEncryptedDIYConfigPure(encryptedJsonStr, passphrase, persistConfig),
    [persistConfig],
  )

  const syncToCloudVault = useCallback(
    (passphrase: string, expectedVersion: number) => syncToCloudVaultPure(config, passphrase, expectedVersion),
    [config],
  )

  const syncFromCloudVault = useCallback(
    (passphrase: string) => syncFromCloudVaultPure(passphrase, persistConfig),
    [persistConfig],
  )

  const checkCloudVaultStatus = useCallback(() => checkCloudVaultStatusPure(), [])
  const clearCloudVault = useCallback(() => clearCloudVaultPure(), [])

  const setIsEditingLayout = useCallback((next: boolean) => {
    setHomeDiyEditingLayout(next)
  }, [])

  // #diy= 分享第二阶段：挂起的分享由确认对话框消费。
  // 确认 = 先自动备份当前本地配置、再按字段级合并应用（只写链接实际携带的
  // 字段，没携带的字段保持本地值；可 Ctrl+Z 撤销），并广播给其它标签页；
  // 忽略 = 只清 pendingShare，本地排版一概不动。两者都经共享状态，任何挂载的
  // useHomeDIY() 实例看到的都是同一份 pendingShare。
  const confirmPendingShare = useCallback((): { applied: boolean; backupKey: string | null } => {
    const result = confirmHomeDiyShare()
    if (result.applied) {
      // Ryan 版 home-diy-storage 的 confirm 只返回 { applied, backupKey }，
      // 不返回 writeResult：跨标签广播改从共享快照取新配置，落盘成败以
      // storageWarning 为准。但 confirm 内的写盘只是排队了 300ms 防抖定时器，
      // 不先刷掉就读到的是上一次写入的旧 warning，ok 会撒谎（上次成功、
      // 这次配额满也会报 ok）。先把挂起的写立即刷掉，再读 warning，
      // 读到的才是这次确认真正的落盘结果。
      flushHomeDiyDiskWrites()
      const snapshot = getHomeDiySnapshot()
      publishToOtherTabs({
        config: snapshot.config,
        clocks: readSlotClocks(STORAGE_CLOCKS_KEY),
        ok: snapshot.storageWarning === null,
      })
    }
    return result
  }, [publishToOtherTabs])

  const dismissPendingShare = useCallback((): boolean => dismissHomeDiyShare(), [])

  /** 编排模式开关：工具栏与导航区读同一份状态，拖拽手柄才会真的出现 */
  const toggleEditingLayout = useCallback(() => {
    setHomeDiyEditingLayout(!getHomeDiySnapshot().isEditingLayout)
  }, [])

  // 28. 撤销 (Undo) / 重做 (Redo)：栈在共享状态里，谁按 Ctrl+Z 撤的都是同一条历史
  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0

  const undo = useCallback(() => {
    // 同一按键只撤销一步（W2-9）：先认领，认领失败说明别的监听（画布）
    // 已处理了这次按键，直接返回，不再撤第二步。
    if (!claimHomeDiyHistoryStep()) return
    const result = undoHomeDiy()
    if (result) publishToOtherTabs(result)
  }, [publishToOtherTabs])

  const redo = useCallback(() => {
    if (!claimHomeDiyHistoryStep()) return
    const result = redoHomeDiy()
    if (result) publishToOtherTabs(result)
  }, [publishToOtherTabs])

  // 30. 全局快捷键监听 (编排模式下支持 Ctrl+Z / Cmd+Z 撤销, Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y 重做)
  useEffect(() => {
    if (!isEditingLayout) return
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
      const metaOrCtrl = isMac ? e.metaKey : e.ctrlKey
      if (!metaOrCtrl) return

      // 避免在输入框/文本域中拦截原生撤销
      const activeEl = document.activeElement
      const isInput =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      if (isInput) return

      if (e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          // 没得重做就放行：让事件继续走到回收站监听（它只认无 Shift 的 Z，
          // 这里放行也只是不拦浏览器默认行为，不会误恢复）。
          if (!canRedo) return
          e.preventDefault()
          e.stopImmediatePropagation()
          redo()
        } else {
          // 没得撤销就放行：事件继续走到回收站监听，这次按键改为恢复
          // 回收站（一次按键恰好只做一件事）。
          if (!canUndo) return
          e.preventDefault()
          e.stopImmediatePropagation()
          undo()
        }
      } else if (e.key.toLowerCase() === 'y' && !isMac) {
        if (!canRedo) return
        e.preventDefault()
        e.stopImmediatePropagation()
        redo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEditingLayout, undo, redo, canUndo, canRedo])

  // 31. 分类手风琴折叠展开操作
  const toggleCollapseCategory = useCallback((categoryId: string) => {
    persistConfig((prev) => {
      const next = toggleCollapsedCategoryPure(prev.collapsedCategoryIds || [], categoryId)
      return { ...prev, collapsedCategoryIds: next, updatedAt: Date.now() }
    })
  }, [persistConfig])

  const collapseAllCategories = useCallback((allCategoryIds: string[]) => {
    persistConfig((prev) => ({
      ...prev,
      collapsedCategoryIds: collapseAllCategoriesPure(allCategoryIds),
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  const expandAllCategories = useCallback(() => {
    persistConfig((prev) => ({
      ...prev,
      collapsedCategoryIds: expandAllCategoriesPure(),
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  const expandCategory = useCallback((categoryId: string) => {
    persistConfig((prev) => {
      if (!prev.collapsedCategoryIds || !prev.collapsedCategoryIds.includes(categoryId)) return prev
      return {
        ...prev,
        collapsedCategoryIds: prev.collapsedCategoryIds.filter((id) => id !== categoryId),
        updatedAt: Date.now(),
      }
    })
  }, [persistConfig])

  const setCollapsedCategoryIds = useCallback((ids: string[]) => {
    persistConfig((prev) => ({
      ...prev,
      collapsedCategoryIds: ids,
      updatedAt: Date.now(),
    }))
  }, [persistConfig])


  // 跨分类重归类卡片 (Cross-Category Reclassification)
  const reclassifySite = useCallback((siteId: string, targetCategoryId: string) => {
    persistConfig((prev) => ({
      ...prev,
      siteCategoryOverrides: { ...prev.siteCategoryOverrides, [siteId]: targetCategoryId },
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  const resetSiteCategoryOverrides = useCallback(() => {
    persistConfig((prev) => ({
      ...prev,
      siteCategoryOverrides: {},
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  // 自定义壁纸与毛玻璃美学调节
  // 安全：入口即校验，非法直接置空（由 diy-presets 的白名单口径决定，避免脏数据入库）
  const setCustomWallpaper = useCallback((url: string) => {
    persistConfig((prev) => {
      const raw = (url || '').trim().slice(0, 2048)
      // 与 diy-presets 的清洗器 / 渲染层同口径：只认共享的 isSafeWallpaperUrl，
      // 不在这里再抄一份正则（两处正则一旦分叉，入口放行、渲染拦截或反过来）。
      const next = isSafeWallpaperUrl(raw) ? raw : ''
      return { ...prev, customWallpaperUrl: next, updatedAt: Date.now() };
    });
  }, [persistConfig]);

  const setAestheticSliders = useCallback((blur: number, opacity: number) => {
    persistConfig((prev) => ({
      ...prev,
      glassmorphismBlur: Math.min(30, Math.max(0, blur)),
      // P1 可读性下限：卡片不透明度 ≥0.88，写入端就地兜住（0.85 时黑壁纸描述文字外推 ≈4.4:1 跌破 AA；
      // 0.88 为实测达标值 4.60:1。旧配置 0.2 读到同样抬升，见读取端）
      cardOpacity: clampCardOpacity(opacity),
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  // URL Hash 免登预设分享。编码逻辑在 lib/diy-share-link.ts：失败会带上原因，
  // 不再像以前那样返回空串让调用方静默吞掉。
  // 发 v1 信封（{ diy: 1, config } + Zod 校验）：旧 #diy= 链接仍可读，
  // 新链接带显式版本号与丢弃清单。
  const exportPresetToUrlHash = useCallback((): ShareLinkOutcome => {
    if (typeof window === 'undefined') {
      return { ok: false, reason: '当前页面还没有准备好，稍后再试' }
    }
    return encodeVersionedShareLink(config, {
      origin: window.location.origin,
      pathname: window.location.pathname,
    })
  }, [config]);

  // 注：以前这里还有一个 importPresetFromUrlHash，从没被调用过
  // （唯一来源是 home-diy-toolbar 的解构，那边只用 exportPresetToUrlHash），
  // 而且匹配条件比真正生效的 applyHomeDiyShareHash() 更宽（includes vs startsWith），
  // 已删除：免登导入只保留上面那一条实现。

  return {
    config,
    reclassifySite,
    resetSiteCategoryOverrides,
    setCustomWallpaper,
    setAestheticSliders,
    exportPresetToUrlHash,
    siteCategoryOverrides: config.siteCategoryOverrides || {},
    customWallpaperUrl: config.customWallpaperUrl || '',
    glassmorphismBlur: config.glassmorphismBlur ?? 12,
    // P1 可读性下限：读取端同样 clamp 0.88——旧配置/旧分享链接可能存着 0.2 或 0.85，读到即抬到 0.88
    //（与写入端 setAestheticSliders 同口径，分享方/接收方观感一致无分叉）
    cardOpacity: clampCardOpacity(config.cardOpacity),

    mounted,
    viewMode: config.viewMode,
    cardDisplayMode: config.cardDisplayMode,
    canvasBackground: config.canvasBackground,
    accentColor: config.accentColor,
    isHeroDeckCollapsed: config.heroDeckCollapsed,
    heroDeckWidgets: config.heroDeckWidgets,
    categoryOrder: config.categoryOrder,
    pinnedCategoryIds: config.pinnedCategoryIds,
    hiddenCategoryIds: config.hiddenCategoryIds,
    collapsedCategoryIds: config.collapsedCategoryIds || [],
    pinnedSiteIdsByCategory: config.pinnedSiteIdsByCategory,
    categoryDensityOverrides: config.categoryDensityOverrides || {},
    speedDialEnabled: Boolean(config.speedDialEnabled),
    speedDialPinnedIds: config.speedDialPinnedIds || [],
    customCategories: config.customCategories,
    isEditingLayout,
    setIsEditingLayout,
    toggleEditingLayout,
    /** 非 null = 上次落盘失败（改动已生效但刷新会丢）：界面必须显示出来 */
    storageWarning,
    /** 非 null = 有一条 #diy= 分享链接挂起待确认：本地排版尚未改动 */
    pendingShare,
    dismissStorageWarning: dismissHomeDiyStorageWarning,
    confirmPendingShare,
    dismissPendingShare,
    confirmHomeDiyShare,
    dismissHomeDiyShare,
    canUndo,
    canRedo,
    undo,
    redo,
    toggleCollapseCategory,
    collapseAllCategories,
    expandAllCategories,
    expandCategory,
    setCollapsedCategoryIds,
    setViewMode,
    setCardDisplayMode,
    setCategoryDensityOverride,
    toggleSpeedDial,
    pinToSpeedDial,
    unpinFromSpeedDial,
    applySmartAutoTune,
    setCanvasBackground,
    setAccentColor,
    toggleHeroDeckCollapsed,
    setHeroDeckWidgets,
    togglePinCategory,
    toggleHideCategory,
    unhideCategory,
    unhideAllCategories,
    setHiddenCategories,
    moveCategory,
    reorderCategory,
    togglePinSiteInCategory,
    resetCategoryLayout,
    addCustomCategory,
    deleteCustomCategory,
    addSiteToCustomCategory,
    removeSiteFromCustomCategory,
    isAdaptiveRankingEnabled: Boolean(config.enableAdaptiveRanking),
    toggleAdaptiveRanking,
    applyDIYPreset,
    exportDIYConfig,
    importDIYConfig,
    stageImportForConfirm,
    exportEncryptedDIYConfig,
    importEncryptedDIYConfig,
    syncToCloudVault,
    syncFromCloudVault,
    checkCloudVaultStatus,
    clearCloudVault,
    resetDIYConfig,
  }
}
