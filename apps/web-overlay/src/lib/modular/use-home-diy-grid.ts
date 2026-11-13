/**
 * 首页 DIY 网格 hook：use-home-diy 的网格视图层。
 *
 * 约束（任务要求）：不改 home-diy-storage.ts / use-home-diy.ts /
 * home-diy-toolbar.tsx / diy-presets.ts。所有写盘只走两条已公开的路：
 *   - 已有动作（reorderCategory / moveCategory / togglePinSiteInCategory
 *     等）直接复用 useHomeDIY()；
 *   - 置顶列表重排没有现成动作：用 home-diy-storage 导出的
 *     commitHomeDiyConfig 直接提交（与 use-home-diy 的 persistConfig
 *     同一个入口、同一份撤销栈），再用本文件顶部的共享单例通道
 *     （publishSharedLayoutSync，与 use-home-diy 共用一条 BroadcastChannel）
 *     广播给其它标签页。频道会过滤自己发出的回声；远端改动只由 use-home-diy
 *     那边的 applyRemoteConfig 订阅处理（本 hook 调 useHomeDIY() 时已经挂上，
 *     见 use-home-diy.ts 3.1/3.2）：它做同一份 LWW 合并，合并成功后再调
 *     notifyLayoutSyncMerge 弹「另一标签页更新了排版」toast。本 hook 绝不能再
 *     另订一份裸 applyRemoteHomeDiyConfig——共享通道按订阅顺序扇出，裸处理
 *     先跑会把合并吃掉，后到的 applyRemoteConfig 再算 merged.changed 已是
 *     false、返回 null，通知就永远发不出来（M1）。
 *
 * 网格布局本身是读时派生（migrateConfigToGrid，纯函数）：不写回
 * storage，不存在「迁移一半」的状态；迁移失败回退默认布局。
 */
'use client'

import { useCallback, useMemo } from 'react'
import { useHomeDIY } from './use-home-diy'
import {
  commitHomeDiyConfig,
  getHomeDiySnapshot,
  type HomeDIYConfig,
} from './home-diy-storage'
import {
  createLayoutSyncChannel,
  getLayoutClientId,
  readSlotClocks,
  type LayoutSlotClocks,
  type LayoutSyncChannel,
} from './layout-sync'
import {
  gridToCategoryOrder,
  migrateConfigToGrid,
  reorderGridItems,
  type GridItem,
} from './grid-layout'
import { isDiyDragActive, moveCardInDisplayedOrder, resolveCategoryDropIndex, type CardMoveDirection } from './diy-drag'

type LayoutSyncRemoteHandler = (payload: {
  config: HomeDIYConfig
  clocks: LayoutSlotClocks
}) => void

/**
 * 跨标签页广播通道的模块级懒单例（W2 fix 10）。
 *
 * 背景：以前 use-home-diy 与本 hook 各自 new 一个 BroadcastChannel，
 * 而 navigation-category-section 每个分类都挂一个 useHomeDiyGrid，
 * 一个标签页里同时活着 ~20 条通道，每条都收广播、各做一次 LWW 合并。
 * 两边用的其实是同一个通道名（layout-sync 的 LAYOUT_SYNC_CHANNEL，
 * createLayoutSyncChannel 写死的 'navhub_home_diy_sync_v1'），收到的也是
 * 同一份消息：一条底层通道 + 订阅者多播就够了。
 *
 * 语义与之前一致：底层仍是 createLayoutSyncChannel（按 clientId 过滤自己
 * 发出的回声），每个订阅者照常收到每条远端消息；单个订阅者抛错不影响其它
 * 订阅者。最后一个订阅者离开时关闭底层通道，下次订阅再建（懒创建，SSR 下
 * createLayoutSyncChannel 本身返回空操作桩，不建真通道）。
 * use-home-diy.ts 的通道也改走这里（循环引用是安全的：两边只在函数体里
 * 用对方的绑定，模块顶层没有任何副作用）。
 */
interface SharedLayoutSyncChannel {
  channel: LayoutSyncChannel<HomeDIYConfig>
  handlers: Set<LayoutSyncRemoteHandler>
}

let sharedLayoutSyncChannel: SharedLayoutSyncChannel | null = null

/**
 * 拖拽中排队的远端改动（W2-6）：拖拽中途直接合并会把正在拖的分类/卡片
 * 顶走，拖拽结束的本地提交再按旧位置写回，等于把远端改动悄悄丢掉。
 * 只留最新一份：每份广播都带全量 config + clocks，后到的覆盖前面的，
 * 合最新一份与先合旧的再合新的结果一致。拖拽结束由 DiyDragProvider
 * 调 flushPendingLayoutSyncMessages() 放出来（见 diy-drag-kit）。
 */
let pendingRemotePayload: { config: HomeDIYConfig; clocks: LayoutSlotClocks } | null = null

/** 把一份远端改动扇出给所有订阅者（单个订阅者抛错不影响其它订阅者） */
function deliverSharedLayoutSync(payload: { config: HomeDIYConfig; clocks: LayoutSlotClocks }): void {
  const entry = sharedLayoutSyncChannel
  if (!entry) return
  for (const h of [...entry.handlers]) {
    try {
      h(payload)
    } catch {
      // 单个订阅者抛错不影响其它订阅者与主流程
    }
  }
}

/**
 * 放出拖拽中排队的远端改动（没有排队时什么都不做）。由 DiyDragProvider
 * 在拖拽结束时调用——此时本地的落点提交已完成，合并发生在最终本地
 * 状态之上，不会再被拖拽提交盖掉。
 */
export function flushPendingLayoutSyncMessages(): void {
  if (!pendingRemotePayload) return
  const payload = pendingRemotePayload
  pendingRemotePayload = null
  deliverSharedLayoutSync(payload)
}

/** 订阅远端消息：返回取消订阅函数；最后一个订阅者离开时关闭底层通道。 */
export function subscribeSharedLayoutSyncChannel(handler: LayoutSyncRemoteHandler): () => void {
  if (!sharedLayoutSyncChannel) {
    const handlers = new Set<LayoutSyncRemoteHandler>()
    const channel = createLayoutSyncChannel<HomeDIYConfig>((payload) => {
      if (isDiyDragActive()) {
        // 拖拽中：先排队，不合并、不通知；拖完由 flush 一次性放出。
        pendingRemotePayload = payload
        return
      }
      deliverSharedLayoutSync(payload)
    })
    sharedLayoutSyncChannel = { channel, handlers }
  }
  sharedLayoutSyncChannel.handlers.add(handler)
  return () => {
    const entry = sharedLayoutSyncChannel
    if (!entry) return
    entry.handlers.delete(handler)
    if (entry.handlers.size === 0) {
      entry.channel.close()
      sharedLayoutSyncChannel = null
    }
  }
}

/**
 * 向其它标签页广播：只有在已有订阅者（即底层通道活着）时才发，
 * 与旧实现「syncChannelRef 为 null 时不发」同口径，不为一次广播单独建通道。
 */
export function publishSharedLayoutSync(payload: {
  config: HomeDIYConfig
  clocks: LayoutSlotClocks
}): void {
  sharedLayoutSyncChannel?.channel.publish({
    clientId: getLayoutClientId(),
    config: payload.config,
    clocks: payload.clocks,
  })
}

export interface UseHomeDiyGridResult {
  /** 当前网格坐标（读时迁移，失败回退默认） */
  gridLayout: GridItem[]
  /** 分类顺序（一维，与 gridLayout 同义的不同视图） */
  categoryOrder: string[]
  isEditingLayout: boolean
  /**
   * 卡片 ⋯ 菜单的移动：按显示列表算出新置顶列表后一次提交。
   * displayedIds = 该分类当前渲染出来的卡片 id（置顶在前）。
   * 返回 false = 移到边界外或卡片不在列表里（菜单据此禁用）。
   */
  moveCard: (
    categoryId: string,
    displayedIds: string[],
    siteId: string,
    direction: CardMoveDirection,
  ) => boolean
  /** 直接写回某分类的置顶列表（菜单之外的调用方用） */
  reorderPinnedSites: (categoryId: string, pinnedIds: string[]) => boolean
  /**
   * 按网格序号移动分类（grid 视图的拖拽落点换算后调它）。
   * toIndex 是移动前列表里的目标序号；afterTarget 是指针在目标内的半区
   * （true = 下半区→插到目标之后，false = 上半区→插到目标之前），
   * 不传 = 键盘拖拽，沿用旧语义（顺移动方向落远端）。见 resolveCategoryDropIndex。
   */
  moveCategoryToIndex: (categoryId: string, toIndex: number, afterTarget?: boolean) => void
}

export function useHomeDiyGrid(allCategoryIds: string[]): UseHomeDiyGridResult {
  const { config, categoryOrder, isEditingLayout, reorderCategory } = useHomeDIY()

  // 跨标签页广播通道：走模块级单例（本文件顶部），不再每实例 new 一条
  // BroadcastChannel；与 use-home-diy 的通道是同一条。
  // 注意：这里故意不订阅远端消息。useHomeDIY()（上行）挂载后已经订了唯一的
  // applyRemoteConfig（use-home-diy.ts 3.2，mounted 后才订）；它做同一份 LWW
  // 合并 + 成功后调 notifyLayoutSyncMerge。再订一份裸 applyRemoteHomeDiyConfig
  // 会先插进共享处理集、按顺序先跑，合并被它吃掉后 applyRemoteConfig 看到的
  // merged.changed 就是 false、返回 null，跨标签合并 toast 永远弹不出来（M1）。
  // 各自过滤自己发出的回声（createLayoutSyncChannel 按 clientId 过滤）。

  const publish = useCallback((config: HomeDIYConfig, clocks: ReturnType<typeof readSlotClocks>) => {
    publishSharedLayoutSync({ config, clocks })
  }, [])

  const grid = useMemo(() => migrateConfigToGrid(config, allCategoryIds), [config, allCategoryIds])

  const reorderPinnedSites = useCallback(
    (categoryId: string, pinnedIds: string[]) => {
      const result = commitHomeDiyConfig((prev) => {
        const current = prev.pinnedSiteIdsByCategory[categoryId] || []
        if (current.length === pinnedIds.length && current.every((id, i) => id === pinnedIds[i])) {
          return prev
        }
        return {
          ...prev,
          pinnedSiteIdsByCategory: { ...prev.pinnedSiteIdsByCategory, [categoryId]: [...pinnedIds] },
          updatedAt: Date.now(),
        }
      })
      // 落盘失败时改动仍在内存、storageWarning 已进共享状态：
      // 与 use-home-diy 的口径一致，只在 ok 时广播。
      if (result.ok) publish(result.config, result.clocks)
      return result.ok
    },
    [publish],
  )

  const moveCard = useCallback(
    (
      categoryId: string,
      displayedIds: string[],
      siteId: string,
      direction: CardMoveDirection,
    ): boolean => {
      const snapshot = getHomeDiySnapshot()
      const pinnedIds = snapshot.config.pinnedSiteIdsByCategory[categoryId] || []
      const decision = moveCardInDisplayedOrder({ displayedIds, pinnedIds, siteId, direction })
      if (!decision) return false
      return reorderPinnedSites(categoryId, decision.pinnedIds)
    },
    [reorderPinnedSites],
  )

  const moveCategoryToIndex = useCallback(
    (categoryId: string, toIndex: number, afterTarget?: boolean) => {
      const order = gridToCategoryOrder(grid.layout, allCategoryIds)
      const fromIndex = order.indexOf(categoryId)
      const clamped = Math.min(Math.max(0, toIndex), order.length - 1)
      if (fromIndex === -1) return
      // 插入序号按指针半区换算（W2-7）：旧实现直接拿目标序号当插入序号，
      // 上移/下移同一落点两种结果；resolveCategoryDropIndex 把它算对称，
      // 键盘拖拽（afterTarget 不传）保持旧语义。
      const insertion = resolveCategoryDropIndex({ fromIndex, targetIndex: clamped, afterTarget })
      if (fromIndex === insertion) return
      const reordered = reorderGridItems(grid.layout, categoryId, insertion)
      const nextOrder = gridToCategoryOrder(reordered, allCategoryIds)
      // 锚点：最终顺序里紧挨着它的下一项（没有就取上一项、插到它后面）。
      // reorderCategory 只认「插到某项前/后」，用锚点翻译一次即等价。
      const afterId = nextOrder[insertion + 1]
      if (afterId) {
        reorderCategory(categoryId, afterId, 'before', allCategoryIds)
        return
      }
      const beforeId = nextOrder[insertion - 1]
      if (beforeId) reorderCategory(categoryId, beforeId, 'after', allCategoryIds)
    },
    [grid.layout, allCategoryIds, reorderCategory],
  )

  return {
    gridLayout: grid.layout,
    categoryOrder,
    isEditingLayout,
    moveCard,
    reorderPinnedSites,
    moveCategoryToIndex,
  }
}
