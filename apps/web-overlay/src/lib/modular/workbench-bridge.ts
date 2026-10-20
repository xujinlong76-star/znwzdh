'use client'

import type { WidgetInstance } from '@/types/modular'
import { STORAGE_KEY } from './layout-storage'
import type { Board } from './use-modular-layout'

const FAVORITES_STORAGE_KEY = 'navhub.favorites.v1'

export interface PinSitePayload {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
}

/**
 * 检查站点是否已固定/收藏到工作台
 */
export function isSitePinnedToWorkbench(siteId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.some((item: any) => item.siteId === siteId)
    }
  } catch {
    return false
  }
  return false
}

/**
 * 只构造 favorites-dock 的最小实例，避免把 registry 及其全部 widget 组件
 * 静态拉进首页首屏；默认尺寸与 registry.ts 的 'favorites-dock' 保持一致。
 */
function createFavoritesDockInstance(): WidgetInstance {
  return {
    id: `widget-favorites-dock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'favorites-dock',
    colSpan: 4,
    rowSpan: 1,
    config: {},
    createdAt: Date.now(),
  }
}

/**
 * 将主页站点一键固定到模块化工作台快捷启动坞
 */
export function pinSiteToWorkbench(site: PinSitePayload): { ok: boolean; message: string; addedToFavorites: boolean } {
  if (typeof window === 'undefined') {
    return { ok: false, message: '浏览器环境不可用', addedToFavorites: false }
  }

  try {
    // 1. 同步加入到 favorites 存储
    let favoritesList: any[] = []
    let favoritesReadable = true
    const favRaw = localStorage.getItem(FAVORITES_STORAGE_KEY)
    if (favRaw) {
      try {
        const parsed = JSON.parse(favRaw)
        if (Array.isArray(parsed)) favoritesList = parsed
        else favoritesReadable = false
      } catch (err) {
        // 读不出来**绝不**当作「空收藏」继续写：下面那个 unshift 会把「只有这一条」的
        // 列表整个存回去，用户原有的收藏就被无声清空了。宁可这次不写，也不能覆盖掉。
        favoritesReadable = false
        console.warn('本地收藏读取失败，为免覆盖既有数据已跳过本次收藏写入', err)
      }
    }

    const alreadyInFav = favoritesReadable && favoritesList.some((item) => item.siteId === site.siteId)
    if (favoritesReadable && !alreadyInFav) {
      favoritesList.unshift({
        siteId: site.siteId,
        title: site.title,
        href: site.href,
        icon: site.icon,
        description: site.description,
        createdAt: Date.now(),
      })
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoritesList))
    }

    // 2. 检查多看板配置，确保活跃看板挂载了「星标启动坞」
    const boardRaw = localStorage.getItem(STORAGE_KEY)
    if (boardRaw) {
      try {
        const workspace = JSON.parse(boardRaw)
        if (workspace?.boards && Array.isArray(workspace.boards)) {
          const activeId = workspace.activeBoardId || workspace.boards[0]?.id
          const activeBoardIndex = workspace.boards.findIndex((b: Board) => b.id === activeId)
          if (activeBoardIndex >= 0) {
            const board = workspace.boards[activeBoardIndex]
            const hasDock = board.widgets?.some((w: any) => w.type === 'favorites-dock')
            if (!hasDock) {
              // 自动补充一个启动坞模块到第一行
              const newDockWidget = createFavoritesDockInstance()
              workspace.boards[activeBoardIndex].widgets = [newDockWidget, ...(board.widgets || [])]
              localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace))
            }
          }
        }
      } catch (err) {
        console.warn('更新工作台配置看板失败', err)
      }
    }

    // 3. 广播跨组件更新事件
    // 只派发自定义事件：同文档的 hook 监听它做热更新。
    // 跨标签页由浏览器在写入 localStorage 后自动派发真实 storage 事件（带 e.key），
    // 无需（也不应）手动派发——手动 new Event('storage') 没有 key 字段，
    // 对所有 `e.key === STORAGE_KEY` 判定都是死代码，还会误导其他 storage 监听者。
    window.dispatchEvent(new Event('navhub_workbench_updated'))

    return {
      ok: true,
      message: favoritesReadable
        ? `已将「${site.title}」固定到模块化工作台快捷启动坞`
        : `已将「${site.title}」固定到启动坞；本地收藏数据无法读取，为避免覆盖已跳过收藏`,
      addedToFavorites: favoritesReadable && !alreadyInFav,
    }
  } catch (error) {
    console.error('固定站点到工作台失败', error)
    return { ok: false, message: '固定站点失败，请检查浏览器存储权限', addedToFavorites: false }
  }
}
