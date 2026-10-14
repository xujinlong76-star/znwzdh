'use client'

import { STORAGE_KEY, type Board } from './use-modular-layout'
import { createWidgetInstance } from './registry'

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
 * 将主页站点一键固定到模块化工作台快捷启动坞
 */
export function pinSiteToWorkbench(site: PinSitePayload): { ok: boolean; message: string; addedToFavorites: boolean } {
  if (typeof window === 'undefined') {
    return { ok: false, message: '浏览器环境不可用', addedToFavorites: false }
  }

  try {
    // 1. 同步加入到 favorites 存储
    let favoritesList: any[] = []
    const favRaw = localStorage.getItem(FAVORITES_STORAGE_KEY)
    if (favRaw) {
      try {
        const parsed = JSON.parse(favRaw)
        if (Array.isArray(parsed)) favoritesList = parsed
      } catch {}
    }

    const alreadyInFav = favoritesList.some((item) => item.siteId === site.siteId)
    if (!alreadyInFav) {
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
              const newDockWidget = createWidgetInstance('favorites-dock')
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
      message: `已将「${site.title}」固定到模块化工作台快捷启动坞`,
      addedToFavorites: !alreadyInFav,
    }
  } catch (error) {
    console.error('固定站点到工作台失败', error)
    return { ok: false, message: '固定站点失败，请检查浏览器存储权限', addedToFavorites: false }
  }
}
