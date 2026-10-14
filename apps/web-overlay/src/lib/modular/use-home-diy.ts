'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  sortCategoryItemsWithPinned,
  togglePinnedSiteInCategory,
  reorderCategoryToTarget,
  BUILTIN_DIY_PRESETS,
  validateAndCleanDIYConfig,
  type DIYPreset,
} from '@/lib/modular/diy-presets'
import {
  encryptGenericPayload,
  decryptGenericPayload,
  type EncryptedPayloadEnvelope,
} from '@/lib/vault'
import { getIdentity } from '@/lib/identity'
import { fetchCloudVault, saveCloudVault, deleteCloudVault } from '@/lib/navhub-api'

export type HomeViewMode = 'hybrid' | 'classic' | 'workbench'
export type CardDisplayMode = 'compact' | 'standard' | 'rich'
export type CanvasBackground = 'mesh' | 'dots' | 'grid' | 'aurora' | 'clean'
export type AccentColor = 'default' | 'violet' | 'emerald' | 'amber' | 'rose'

export interface CustomCategoryItem {
  id: string
  title: string
  href: string
  icon?: string
  description?: string
}

export interface CustomCategory {
  id: string
  title: string
  icon?: string
  items: CustomCategoryItem[]
  createdAt: number
}

export interface HomeDIYConfig {
  version: 3
  viewMode: HomeViewMode
  cardDisplayMode: CardDisplayMode
  canvasBackground: CanvasBackground
  accentColor: AccentColor
  heroDeckCollapsed: boolean
  heroDeckWidgets: string[]
  enableAdaptiveRanking: boolean
  // 分类可视化编排
  categoryOrder: string[]
  pinnedCategoryIds: string[]
  hiddenCategoryIds: string[]
  pinnedSiteIdsByCategory: Record<string, string[]>
  customCategories: CustomCategory[]
  updatedAt: number
}

const STORAGE_KEY = 'navhub_home_diy_config_v3'
const LEGACY_STORAGE_KEY_V2 = 'navhub_home_diy_config_v2'
const LEGACY_STORAGE_KEY_V1 = 'navhub_home_diy_config_v1'

const DEFAULT_HERO_WIDGETS = [
  'quick-search',
  'clock-pomodoro',
  'favorites-dock',
  'quick-tools',
]

const DEFAULT_CONFIG: HomeDIYConfig = {
  version: 3,
  viewMode: 'hybrid',
  cardDisplayMode: 'standard',
  canvasBackground: 'mesh',
  accentColor: 'default',
  heroDeckCollapsed: false,
  heroDeckWidgets: DEFAULT_HERO_WIDGETS,
  enableAdaptiveRanking: false,
  categoryOrder: [],
  pinnedCategoryIds: [],
  hiddenCategoryIds: [],
  pinnedSiteIdsByCategory: {},
  customCategories: [],
  updatedAt: Date.now(),
}

export function useHomeDIY() {
  const [config, setConfig] = useState<HomeDIYConfig>(DEFAULT_CONFIG)
  const [mounted, setMounted] = useState(false)
  const [isEditingLayout, setIsEditingLayout] = useState(false)

  // 1. 客户端挂载时加载配置并平滑兼容 v1/v2
  useEffect(() => {
    try {
      let raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        // 尝试从 v2 迁移
        const v2Raw = localStorage.getItem(LEGACY_STORAGE_KEY_V2)
        if (v2Raw) {
          const parsedV2 = JSON.parse(v2Raw)
          if (parsedV2 && typeof parsedV2 === 'object') {
            const migrated: HomeDIYConfig = {
              ...DEFAULT_CONFIG,
              viewMode: ['hybrid', 'classic', 'workbench'].includes(parsedV2.viewMode) ? parsedV2.viewMode : 'hybrid',
              cardDisplayMode: ['compact', 'standard', 'rich'].includes(parsedV2.cardDisplayMode) ? parsedV2.cardDisplayMode : 'standard',
              canvasBackground: ['mesh', 'dots', 'grid', 'aurora', 'clean'].includes(parsedV2.canvasBackground) ? parsedV2.canvasBackground : 'mesh',
              heroDeckCollapsed: Boolean(parsedV2.heroDeckCollapsed),
              heroDeckWidgets: Array.isArray(parsedV2.heroDeckWidgets) ? parsedV2.heroDeckWidgets : DEFAULT_HERO_WIDGETS,
              categoryOrder: Array.isArray(parsedV2.categoryOrder) ? parsedV2.categoryOrder : [],
              pinnedCategoryIds: Array.isArray(parsedV2.pinnedCategoryIds) ? parsedV2.pinnedCategoryIds : [],
              hiddenCategoryIds: Array.isArray(parsedV2.hiddenCategoryIds) ? parsedV2.hiddenCategoryIds : [],
              customCategories: Array.isArray(parsedV2.customCategories) ? parsedV2.customCategories : [],
              updatedAt: Date.now(),
            }
            setConfig(migrated)
            localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
            setMounted(true)
            return
          }
        }

        // 尝试从 v1 迁移
        const v1Raw = localStorage.getItem(LEGACY_STORAGE_KEY_V1)
        if (v1Raw) {
          const parsedV1 = JSON.parse(v1Raw)
          if (parsedV1 && typeof parsedV1 === 'object') {
            const migrated: HomeDIYConfig = {
              ...DEFAULT_CONFIG,
              viewMode: ['hybrid', 'classic', 'workbench'].includes(parsedV1.viewMode) ? parsedV1.viewMode : 'hybrid',
              heroDeckCollapsed: Boolean(parsedV1.heroDeckCollapsed),
              heroDeckWidgets: Array.isArray(parsedV1.heroDeckWidgets) ? parsedV1.heroDeckWidgets : DEFAULT_HERO_WIDGETS,
              updatedAt: Date.now(),
            }
            setConfig(migrated)
            localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
            setMounted(true)
            return
          }
        }
      }

      if (raw) {
        const parsed = JSON.parse(raw)
        const check = validateAndCleanDIYConfig(parsed)
        if (check.valid && check.config) {
          setConfig({
            ...check.config,
            accentColor: ['default', 'violet', 'emerald', 'amber', 'rose'].includes(parsed.accentColor) ? parsed.accentColor : 'default',
          })
        }
      }
    } catch (e) {
      console.warn('加载首页 DIY 配置失败，使用默认配置', e)
    }
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

  // 3. 持久化存储与事件广播
  const persistConfig = useCallback((updater: (prev: HomeDIYConfig) => HomeDIYConfig) => {
    setConfig((prev) => {
      const next = updater(prev)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        window.dispatchEvent(new Event('navhub_home_diy_updated'))
      } catch {}
      return next
    })
  }, [])

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
  const addSiteToCustomCategory = useCallback((categoryId: string, site: CustomCategoryItem) => {
    persistConfig((prev) => {
      const nextCats = prev.customCategories.map((cat) => {
        if (cat.id !== categoryId) return cat
        if (cat.items.some((i) => i.id === site.id || i.href === site.href)) return cat
        return {
          ...cat,
          items: [site, ...cat.items],
        }
      })
      return { ...prev, customCategories: nextCats, updatedAt: Date.now() }
    })
  }, [persistConfig])

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

  // 22. 导出配置 JSON
  const exportDIYConfig = useCallback(() => {
    return JSON.stringify(config, null, 2)
  }, [config])

  // 23. 导入并清洗配置 JSON
  const importDIYConfig = useCallback((jsonString: string) => {
    try {
      const parsed = JSON.parse(jsonString)
      const res = validateAndCleanDIYConfig(parsed)
      if (!res.valid || !res.config) {
        return { ok: false, message: res.error || '无效的配置格式' }
      }
      persistConfig(() => ({ ...res.config, updatedAt: Date.now() }))
      return { ok: true, message: '配置已成功导入并生效！' }
    } catch (e: any) {
      return { ok: false, message: `JSON 解析失败: ${e.message || '格式错误'}` }
    }
  }, [persistConfig])

  // 24. 重置全量配置
  const resetDIYConfig = useCallback(() => {
    persistConfig(() => ({ ...DEFAULT_CONFIG, updatedAt: Date.now() }))
  }, [persistConfig])

  // 25. 导出并使用主密码加密 DIY 全量配置 (零知识 E2EE)
  const exportEncryptedDIYConfig = useCallback(async (passphrase: string): Promise<string> => {
    const payload = await encryptGenericPayload(config, passphrase, 'navhub_home_diy_config_v3')
    return JSON.stringify(payload, null, 2)
  }, [config])

  // 26. 解密并应用 DIY 全量配置 (零知识 E2EE)
  const importEncryptedDIYConfig = useCallback(async (encryptedJsonStr: string, passphrase: string) => {
    try {
      const parsed = JSON.parse(encryptedJsonStr)
      if (!parsed.cipherTextBase64 || !parsed.ivHex || !parsed.saltHex) {
        return { ok: false, message: '无效的零知识金库密文包格式' }
      }
      const decrypted = await decryptGenericPayload<HomeDIYConfig>(parsed, passphrase)
      const res = validateAndCleanDIYConfig(decrypted)
      if (!res.valid || !res.config) {
        return { ok: false, message: res.error || '解密数据校验失败' }
      }
      persistConfig(() => ({ ...res.config, updatedAt: Date.now() }))
      return { ok: true, message: '🎉 零知识金库验证成功，排版与专属配置已全量还原！' }
    } catch (e: any) {
      return { ok: false, message: e.message || '解密失败：主密码不匹配或密文已被篡改' }
    }
  }, [persistConfig])

  // 24. E2EE 云端金库同步：上传密文到中枢云端
  const syncToCloudVault = useCallback(async (passphrase: string): Promise<{ success: boolean; version?: number; error?: string }> => {
    if (!passphrase || passphrase.length < 6) {
      return { success: false, error: '主密码长度至少需 6 位' }
    }
    const encrypted = await exportEncryptedDIYConfig(passphrase)
    if (!encrypted) {
      return { success: false, error: '本地配置加密失败' }
    }
    const identity = getIdentity()
    if (!identity) {
      return { success: false, error: '无法获取用户身份标识' }
    }
    const res = await saveCloudVault(identity, encrypted)
    if (!res.ok) {
      return { success: false, error: '中枢云端金库同步失败，请检查网络或后端服务' }
    }
    return { success: true, version: res.version }
  }, [exportEncryptedDIYConfig])

  // 25. E2EE 云端金库同步：从云端拉取并解密
  const syncFromCloudVault = useCallback(async (passphrase: string): Promise<{ success: boolean; error?: string; updatedAt?: number }> => {
    if (!passphrase) {
      return { success: false, error: '请输入解密主密码' }
    }
    const identity = getIdentity()
    if (!identity) {
      return { success: false, error: '无法获取用户身份标识' }
    }
    const cloudRecord = await fetchCloudVault(identity)
    if (!cloudRecord || !cloudRecord.payload) {
      return { success: false, error: '云端暂未查询到该身份的备份金库' }
    }
    const res = await importEncryptedDIYConfig(cloudRecord.payload, passphrase)
    if (!res.ok) {
      return { success: false, error: res.message || '云端金库解密校验失败' }
    }
    return { success: true, updatedAt: cloudRecord.updatedAt }
  }, [importEncryptedDIYConfig])

  // 26. 查询云端金库元信息（版本与更新时间）
  const checkCloudVaultStatus = useCallback(async (): Promise<{ hasCloudVault: boolean; updatedAt?: number; version?: number }> => {
    const identity = getIdentity()
    if (!identity) return { hasCloudVault: false }
    const cloudRecord = await fetchCloudVault(identity)
    if (!cloudRecord || !cloudRecord.payload) {
      return { hasCloudVault: false }
    }
    return { hasCloudVault: true, updatedAt: cloudRecord.updatedAt, version: cloudRecord.version }
  }, [])

  // 27. 清空云端金库
  const clearCloudVault = useCallback(async (): Promise<boolean> => {
    const identity = getIdentity()
    if (!identity) return false
    return await deleteCloudVault(identity)
  }, [])

  const toggleEditingLayout = useCallback(() => {
    setIsEditingLayout((v) => !v)
  }, [])

  return {
    config,
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
    pinnedSiteIdsByCategory: config.pinnedSiteIdsByCategory,
    customCategories: config.customCategories,
    isEditingLayout,
    setIsEditingLayout,
    toggleEditingLayout,
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
