'use client'

import type { WidgetInstance } from '@/types/modular'
import { STORAGE_KEY } from './layout-storage'
import type { Board } from './use-modular-layout'
import { FAVORITES_STORAGE_KEY } from '@/lib/favorites-storage'
import { addFavoritesLocal, type LocalFavorite } from '@/hooks/useFavorites'

export interface PinSitePayload {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
}

/**
 * 批量固定收据（11b）：只活内存，随撤销闭包走，不序列化。
 * addedSiteIds 只含本次新建的 siteId；pinnedCount 是 ok 的站数
 * （与 addedSiteIds 未必相等：已固定过的站 ok 但不新加）。
 */
export interface BatchPinReceipt {
  addedSiteIds: string[]
  addedItems: LocalFavorite[]
  createdDockWidgetId: string | null
  pinnedCount: number
}

/**
 * 检查站点是否已固定/收藏到工作台（只读，不写）
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
 * 将主页站点一键固定到模块化工作台快捷启动坞。
 * 收藏写走 store（addFavoritesLocal 内部做 dedup 并返回 added/skipped），
 * bridge 不再直写 navhub.favorites.v1；dock 补位逻辑原样保留。
 */
export function pinSiteToWorkbench(site: PinSitePayload): { ok: boolean; message: string; receipt: BatchPinReceipt | null } {
  if (typeof window === 'undefined') {
    return { ok: false, message: '浏览器环境不可用', receipt: null }
  }

  try {
    // 1. 收藏写走 store：dedup 在 addFavoritesLocal 内部完成。
    //    存储不可用（sharedBlocked）或写盘失败时返回 null——这次不写收藏，
    //    但下面的 dock 补位照旧（与旧行为一致：dock 是共享基础设施，
    //    一次 pin 创建后服务的是全部收藏，不只这次 pin 的站）。
    const written = addFavoritesLocal([
      {
        siteId: site.siteId,
        title: site.title,
        href: site.href,
        icon: site.icon,
        description: site.description,
        createdAt: Date.now(),
      },
    ])

    // 2. 检查多看板配置，确保活跃看板挂载了「星标启动坞」
    let createdDockWidgetId: string | null = null
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
              createdDockWidgetId = newDockWidget.id
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

    if (written === null) {
      return { ok: false, message: '本机存储写不进去，固定未完成', receipt: null }
    }
    const added = written.added
    return {
      ok: true,
      message:
        added.length > 0
          ? `已将「${site.title}」固定到模块化工作台快捷启动坞`
          : `「${site.title}」已在工作台快捷启动坞中`,
      receipt: {
        addedSiteIds: added.map((i) => i.siteId),
        addedItems: added,
        createdDockWidgetId,
        pinnedCount: 1,
      },
    }
  } catch (error) {
    console.error('固定站点到工作台失败', error)
    return { ok: false, message: '固定站点失败，请检查浏览器存储权限', receipt: null }
  }
}
