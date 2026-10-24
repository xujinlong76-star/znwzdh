'use client'

/**
 * 首页 DIY hook：只保留 React 状态编排。共享状态/本地存储在同目录
 * home-diy-storage.ts，导入导出/云金库在 home-diy-io.ts（2026-10-19 P1-1 拆分）。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  BUILTIN_DIY_PRESETS,
  collapseAllCategories as collapseAllCategoriesPure,
  expandAllCategories as expandAllCategoriesPure,
  reorderCategoryToTarget,
  toggleCollapsedCategory as toggleCollapsedCategoryPure,
  togglePinnedSiteInCategory,
  type DIYPreset,
} from '@/lib/modular/diy-presets'
import {
  createLayoutSyncChannel,
  getLayoutClientId,
  type LayoutSlotClocks,
  type LayoutSyncChannel,
} from '@/lib/modular/layout-sync'
import { encodeShareLink, type ShareLinkOutcome } from '@/lib/diy-share-link'
import {
  DEFAULT_CONFIG,
  applyRemoteHomeDiyConfig,
  commitHomeDiyConfig,
  dismissHomeDiyStorageWarning,
  getHomeDiySnapshot,
  hydrateHomeDiy,
  redoHomeDiy,
  setHomeDiyEditingLayout,
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
  checkCloudVaultStatus as checkCloudVaultStatusPure,
  clearCloudVault as clearCloudVaultPure,
  exportDIYConfig as exportDIYConfigPure,
  exportEncryptedDIYConfig as exportEncryptedDIYConfigPure,
  importDIYConfig as importDIYConfigPure,
  importEncryptedDIYConfig as importEncryptedDIYConfigPure,
  syncFromCloudVault as syncFromCloudVaultPure,
  syncToCloudVault as syncToCloudVaultPure,
} from './home-diy-io'

// 保持既有导入路径可用：所有从 '@/lib/modular/use-home-diy' 导入
// DEFAULT_CONFIG / STORAGE_KEY / 存储函数 / 类型的调用方无需改动。
export * from './home-diy-storage'

export function useHomeDIY() {
  const { config, history, isEditingLayout, storageWarning } = useSyncExternalStore(
    subscribeHomeDiy,
    getHomeDiySnapshot,
    getHomeDiySnapshot,
  )
  const [mounted, setMounted] = useState(false)
  // 跨标签页通道（挂载后才建立，SSR 阶段为 null）
  const syncChannelRef = useRef<LayoutSyncChannel<HomeDIYConfig> | null>(null)

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
    // 本标签页刷新后就消失的布局
    if (!result.ok) return
    syncChannelRef.current?.publish({
      clientId: getLayoutClientId(),
      config: result.config,
      clocks: result.clocks,
    })
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
    applyRemoteHomeDiyConfig(payload)
  }, [])

  // 3.2 建立 / 拆除跨标签页通道
  useEffect(() => {
    if (!mounted) return
    const channel = createLayoutSyncChannel<HomeDIYConfig>(applyRemoteConfig)
    syncChannelRef.current = channel
    return () => {
      channel.close()
      syncChannelRef.current = null
    }
  }, [mounted, applyRemoteConfig])

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
    (passphrase: string, expectedVersion?: number) => syncToCloudVaultPure(config, passphrase, expectedVersion),
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

  /** 编排模式开关：工具栏与导航区读同一份状态，拖拽手柄才会真的出现 */
  const toggleEditingLayout = useCallback(() => {
    setHomeDiyEditingLayout(!getHomeDiySnapshot().isEditingLayout)
  }, [])

  // 28. 撤销 (Undo) / 重做 (Redo)：栈在共享状态里，谁按 Ctrl+Z 撤的都是同一条历史
  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0

  const undo = useCallback(() => {
    const result = undoHomeDiy()
    if (result) publishToOtherTabs(result)
  }, [publishToOtherTabs])

  const redo = useCallback(() => {
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
          e.preventDefault()
          redo()
        } else {
          e.preventDefault()
          undo()
        }
      } else if (e.key.toLowerCase() === 'y' && !isMac) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEditingLayout, undo, redo])

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
      let next = ''
      try {
        // 动态 import 会增加包体，直接用轻量正则（与 diy-presets 同口径）
        if (/^(https?:\/\/[^'"()\s]+|\/[^'"()\s]*|data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$/i.test(raw)) next = raw
      } catch { next = '' }
      return { ...prev, customWallpaperUrl: next, updatedAt: Date.now() };
    });
  }, [persistConfig]);

  const setAestheticSliders = useCallback((blur: number, opacity: number) => {
    persistConfig((prev) => ({
      ...prev,
      glassmorphismBlur: Math.min(30, Math.max(0, blur)),
      cardOpacity: Math.min(1.0, Math.max(0.2, opacity)),
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  // URL Hash 免登预设分享。编码逻辑在 lib/diy-share-link.ts：失败会带上原因，
  // 不再像以前那样返回空串让调用方静默吞掉。
  const exportPresetToUrlHash = useCallback((): ShareLinkOutcome => {
    if (typeof window === 'undefined') {
      return { ok: false, reason: '当前页面还没有准备好，稍后再试' }
    }
    return encodeShareLink(
      {
        v: config.version,
        vm: config.viewMode,
        cdm: config.cardDisplayMode,
        bg: config.canvasBackground,
        ac: config.accentColor,
        co: config.categoryOrder,
        pco: config.pinnedCategoryIds,
        hco: config.hiddenCategoryIds,
        sco: config.siteCategoryOverrides,
        wp: config.customWallpaperUrl,
        gb: config.glassmorphismBlur,
        co_op: config.cardOpacity,
      },
      { origin: window.location.origin, pathname: window.location.pathname },
    )
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
    cardOpacity: config.cardOpacity ?? 0.9,

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
    customCategories: config.customCategories,
    isEditingLayout,
    setIsEditingLayout,
    toggleEditingLayout,
    /** 非 null = 上次落盘失败（改动已生效但刷新会丢）：界面必须显示出来 */
    storageWarning,
    dismissStorageWarning: dismissHomeDiyStorageWarning,
    canUndo,
    canRedo,
    undo,
    redo,
    toggleCollapseCategory,
    collapseAllCategories,
    expandAllCategories,
    setViewMode,
    setCardDisplayMode,
    setCanvasBackground,
    setAccentColor,
    toggleHeroDeckCollapsed,
    setHeroDeckWidgets,
    togglePinCategory,
    toggleHideCategory,
    unhideCategory,
    unhideAllCategories,
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
    exportEncryptedDIYConfig,
    importEncryptedDIYConfig,
    syncToCloudVault,
    syncFromCloudVault,
    checkCloudVaultStatus,
    clearCloudVault,
    resetDIYConfig,
  }
}
