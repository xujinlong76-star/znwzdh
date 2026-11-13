/**
 * DIY 拖拽决策：纯函数，不依赖 React / dnd-kit。
 *
 * dnd-kit 只负责「指针/键盘事件 → source/target」这一段；「落到目标上
 * 应该发生什么」收在这里单测。所有需要写盘的操作都由调用方
 * （DiyDragProvider / use-home-diy-grid）拿着这里的决策去执行，
 * 本文件永远不碰 storage。
 *
 * 触控口径说明：旧的 touch-reorder.ts 用「长按 180ms + 移动 8px」才激活，
 * 是因为当时拖拽手柄就是整张卡片，必须和滚动抢指针。新系统改成
 * 「专用拖拽手柄 + touch-action: none」，手柄上的指针流根本不会触发
 * 页面滚动，所以不再需要长按延迟。旧的 180ms 常量随 touch-reorder.ts
 * 一起退役，不再沿用。
 *
 * 激活阈值用 PointerSensor 库默认值（configure({})）：鼠标在手柄上
 * 按下即激活（手柄是专用拖拽目标，没有点按动作可保护）；触屏默认
 * 250ms 延迟 + 5px 容差，点按不会误触发拖拽。没有显式配 Distance
 * 约束——构造它要用的 PointerActivationConstraints 没有被
 * @dnd-kit/react 重新导出，而 @dnd-kit/dom 不是直接依赖，pnpm 下
 * 直接 import 它会让构建失败。点按手柄不产生副作用：零位移的拖拽
 * 在落点处理里一律 noop（卡片走 resolveCardDrop，画布小组件有
 * widgetId 不等守卫），不会写盘也不会多一条撤销历史。
 */

/** 读屏拖拽说明元素的 id（provider 渲染一份，卡片手柄 aria-describedby 指它） */
export const DIY_DRAG_INSTRUCTIONS_ID = 'diy-drag-instructions'

/**
 * 一次 dnd-kit 拖拽是否正在进行（指针/键盘皆算）——模块级标记。
 *
 * 为什么不能只用 React 的 DiyDragActiveContext（diy-drag-context.tsx）：
 * 跨标签合并的订阅回调（use-home-diy-grid 的共享 BroadcastChannel）跑在
 * React 渲染之外，而且 useHomeDIY 的订阅实例里有挂在 provider 外面的
 * （navigation-content 自己的那份）——context 在那里永远是 false，
 * 拖拽中途的远端合并照样直接落盘。所以 provider 在拖拽起止时同步写这份
 * 模块级标记，通道回调读它来决定「合还是排队」；React context 仍留给
 * 需要重渲染的组件（卡片方向键漫游），两边由 DiyDragProvider 一起维护。
 */
let diyDragActive = false

/** DiyDragProvider 在拖拽开始/结束时调用，与 isDragging 状态同步 */
export function setDiyDragActive(active: boolean): void {
  diyDragActive = active
}

/** 跨标签通道回调调用：拖拽中收到的远端改动要排队，不能直接合并 */
export function isDiyDragActive(): boolean {
  return diyDragActive
}

/** 键盘拖拽流程说明（Tab → Space 拿起 → 方向键移动 → Enter 放下 → Esc 取消） */
export const KEYBOARD_DRAG_INSTRUCTIONS =
  '拖拽排序：聚焦拖拽手柄后按空格键开始拖动，方向键移动，回车键放下，Esc 取消。卡片拖到分类上是收录或重归类，不改变它在分类内的位置；要调整卡片在分类内的顺序，用卡片右上角的更多操作菜单（上移、下移、移到顶部、移到末尾）。'

/** dnd-kit draggable 上挂的卡片载荷（与 provider / section 两边的 data 同形） */
export interface DiyCardDragData {
  kind: 'card'
  siteId: string
  title: string
  href: string
  description?: string
  icon?: string
  sourceCategoryId?: string
}

/** dnd-kit droppable 上挂的分类落点（拖拽源的分类手柄也挂同一形状） */
export interface DiyCategoryDropData {
  kind: 'category'
  categoryId: string
  isCustom: boolean
  /** 分类显示名：播报用（没有就回退 categoryId，别把 id 念给读屏用户） */
  title?: string
}

/** dnd-kit sortable 上挂的小组件 */
export interface DiyWidgetDragData {
  kind: 'widget'
  widgetId: string
  index: number
  title: string
}

/** 工具库调色板拖入画布的载荷（调色板弹窗后续按此约定挂 data 即可） */
export interface DiyPaletteDragData {
  kind: 'palette-widget'
  widgetType: string
  title: string
}

export type DiyDragData =
  | DiyCardDragData
  | DiyCategoryDropData
  | DiyWidgetDragData
  | DiyPaletteDragData

/**
 * 从 operation.source/target 上读出我们挂的 data（非法形状 → null）。
 * 纯函数、零拖拽依赖：放在轻量层，供 navigation-content 这类不能静态
 * import 重型 diy-drag-kit.tsx 的文件用；重型层 re-export 它以保持
 * 单一来源（coordinator 合并时从 kit 里移过来）。
 */
export function readDiyDragData(entity: { data?: unknown } | null | undefined): DiyDragData | null {
  const data = entity?.data
  if (!data || typeof data !== 'object') return null
  const kind = (data as { kind?: unknown }).kind
  if (kind !== 'card' && kind !== 'category' && kind !== 'widget' && kind !== 'palette-widget') {
    return null
  }
  return data as DiyDragData
}

export interface ResolveCardDropInput {
  source: DiyCardDragData | null | undefined
  target: DiyCategoryDropData | null | undefined
  /** 排版编辑模式是否开启（跨分类重归类只在编辑态允许） */
  isEditing: boolean
  /** 目标自定义分类里是否已有同 href / 同 title 的站点 */
  targetHasSite: boolean
}

export type ResolveCardDropResult =
  | { action: 'collect'; reason: string }
  | { action: 'reclassify'; reason: string }
  | { action: 'noop'; reason: string }

/**
 * 卡片落到分类上的决策。
 *
 * - 自定义分类：收录（已存在 → noop，不弹「已收录成功」的假成功）；
 * - 编辑态 + 跨分类：重归类；
 * - 其余（同分类内落下、非编辑态落到普通分类）一律 noop。
 *
 * 刻意不做位置落点：卡片拖拽没有「插到第几个」——
 *   - collect 是收录进该分类、插到站点列表最前面
 *     （addSiteToCustomCategory 是 prepend）；
 *   - reclassify 只换归属分类，在目标分类内的顺序不变（置顶列表与原序都不动）；
 *   - 同分类内落下不改顺序，移动请用卡片 ⋯ 菜单（上移/下移/移到顶部/移到末尾）。
 * 所以不要给卡片建「位置型」落点（before/after 指示条只属于分类重排，
 * 见 resolveCategoryDropIndex）；界面文案也不许暗示拖动能排位置。
 */
export function resolveCardDrop(input: ResolveCardDropInput): ResolveCardDropResult {
  const { source, target, isEditing, targetHasSite } = input
  if (!source || !target) return { action: 'noop', reason: '拖拽没有有效的起点或落点' }
  if (target.isCustom) {
    if (targetHasSite) return { action: 'noop', reason: '目标分类里已有该站点' }
    return { action: 'collect', reason: '收录进自定义分类' }
  }
  if (isEditing && source.sourceCategoryId && source.sourceCategoryId !== target.categoryId) {
    return { action: 'reclassify', reason: '跨分类重归类' }
  }
  return { action: 'noop', reason: '同分类内拖动不改变顺序，请用卡片菜单移动' }
}

export interface ResolveCategoryDropIndexInput {
  /** 拖拽源在移动前列表里的序号 */
  fromIndex: number
  /** 落点目标在移动前列表里的序号 */
  targetIndex: number
  /**
   * 指针在目标内的纵向位置：true = 下半区（插到目标之后），
   * false = 上半区（插到目标之前）。不传 = 键盘拖拽（没有指针位置），
   * 沿用旧语义：顺着移动方向落在目标的远端（下移→目标之后，上移→目标之前）。
   */
  afterTarget?: boolean
}

/**
 * 分类拖拽的落点换算：返回「先移除源、再插入」的序号（即 reorderGridItems
 * 要的 toIndex，也是 moveCategoryToIndex 的插入语义）。
 *
 * 旧实现直接拿移动前列表里的目标序号当插入序号：先移除再插入会让同一
 * 个序号在上移时等于「目标之前」、下移时等于「目标之后」——同一个落点
 * 两种结果（W2-7）。这里按指针在目标内的上下半区决定插哪边，两边对称：
 * 上半区永远插到目标之前，下半区永远插到目标之后，与移动方向无关。
 * 键盘拖拽没有指针位置：保持旧语义（顺移动方向落远端），键盘是按步
 * 移动、落点即当前位置，旧语义与视觉一致。
 */
export function resolveCategoryDropIndex(input: ResolveCategoryDropIndexInput): number {
  const { fromIndex, targetIndex, afterTarget } = input
  if (afterTarget === undefined) return targetIndex
  // 先移除源：目标在缩短后列表里的序号（源在目标上方时前移一位）
  const targetInReduced = targetIndex > fromIndex ? targetIndex - 1 : targetIndex
  return afterTarget ? targetInReduced + 1 : targetInReduced
}

export type CardMoveDirection = 'up' | 'down' | 'top' | 'bottom'

export interface MoveCardInDisplayedOrderInput {
  /** 当前分类渲染出来的卡片 id（置顶在前，其余按原序） */
  displayedIds: string[]
  /** 当前分类的置顶 id 列表（顺序即置顶区内的显示顺序） */
  pinnedIds: string[]
  siteId: string
  direction: CardMoveDirection
}

export interface MoveCardInDisplayedOrderResult {
  /** 写回 pinnedSiteIdsByCategory[categoryId] 的新列表 */
  pinnedIds: string[]
  /** 移动后该卡在显示列表里的序号（供播报与焦点还原） */
  toIndex: number
}

/**
 * 卡片 ⋯ 菜单「移动」的纯决策。
 *
 * 难点：分类内卡片顺序不是存下来的，是「置顶列表在前 + 其余原序」
 * 算出来的。唯一能写盘的只有 pinnedSiteIdsByCategory，所以移动
 * 只能翻译成「新的置顶列表」：
 *   - 新显示顺序由 displayedIds 移动一位算出；
 *   - 置顶集合只动被移的那张卡：目标位置落在置顶区内（序号 <
 *     原置顶数）→ 它进置顶；落在置顶区外 → 它出置顶；
 *     其它卡的置顶状态一律不动；
 *   - 新置顶列表按新显示顺序过滤出来（相对顺序与显示一致）。
 * 移到边界外返回 null（菜单据此禁用对应项，不弹错误）。
 */
export function moveCardInDisplayedOrder(
  input: MoveCardInDisplayedOrderInput,
): MoveCardInDisplayedOrderResult | null {
  const { displayedIds, pinnedIds, siteId, direction } = input
  const fromIndex = displayedIds.indexOf(siteId)
  if (fromIndex === -1) return null
  const pinnedCount = Math.min(pinnedIds.length, displayedIds.length)
  let toIndex: number
  if (direction === 'up') toIndex = fromIndex - 1
  else if (direction === 'down') toIndex = fromIndex + 1
  else if (direction === 'top') toIndex = 0
  else toIndex = displayedIds.length - 1
  if (toIndex < 0 || toIndex >= displayedIds.length || toIndex === fromIndex) return null

  const nextDisplayed = [...displayedIds]
  const [moved] = nextDisplayed.splice(fromIndex, 1)
  if (moved === undefined) return null
  nextDisplayed.splice(toIndex, 0, moved)

  const pinnedSet = new Set(pinnedIds)
  if (toIndex < pinnedCount) pinnedSet.add(siteId)
  else pinnedSet.delete(siteId)
  const nextPinned = nextDisplayed.filter((id) => pinnedSet.has(id))
  return { pinnedIds: nextPinned, toIndex }
}

export type DragAnnouncementPhase = 'start' | 'over' | 'end' | 'cancel' | 'nochange'

/**
 * 从 dnd-kit 默认插件里去掉 Accessibility（W2-8）：它的英文播报与这里的
 * 中文 live-region 是两套播报，读屏用户会先听到英文再听到中文。
 * 决定：只留中文播报（界面是中文），插件的英文播报不要。
 *
 * 实现细节：不 import @dnd-kit/dom（它不是直接依赖，pnpm 下直接 import
 * 会让构建失败），只按结构认插件——插件条目要么是构造器本身，要么是
 * `{ plugin, options? }` 描述符；构造器的 `.name` 就是类名，Accessibility
 * 是从 @dnd-kit/dom 导出的类，导出名在打包后仍叫 Accessibility。
 * 其余插件（AutoScroller / Cursor / Feedback / PreventSelection）原样保留。
 */
export function withoutAccessibilityPlugin<T>(plugins: readonly T[]): T[] {
  return plugins.filter((entry) => {
    const ctor =
      (entry as { plugin?: unknown } | null | undefined)?.plugin ?? (entry as unknown)
    if (typeof ctor === 'function') return ctor.name !== 'Accessibility'
    return true
  })
}

export interface DragAnnouncementInput {
  title: string
  fromLabel?: string
  toLabel?: string
  /** 移动后的位置（如「第 3 个，共 12 个」），有就播报 */
  positionLabel?: string
}

/**
 * 拖拽 live-region 播报文案（aria-live="polite"）。
 *
 * 这是唯一的播报：dnd-kit 的 Accessibility 插件自带一套英文播报，
 * provider 用 withoutAccessibilityPlugin 把它排除掉了（见 W2-8），
 * 中文界面里读屏用户只听到这一份中文。
 */
export function buildDragAnnouncement(
  phase: DragAnnouncementPhase,
  input: DragAnnouncementInput,
): string {
  const { title, fromLabel, toLabel, positionLabel } = input
  if (phase === 'start') {
    return fromLabel
      ? `开始拖动「${title}」，当前位置：${fromLabel}。方向键移动，回车放下，Esc 取消。`
      : `开始拖动「${title}」。方向键移动，回车放下，Esc 取消。`
  }
  if (phase === 'over') {
    // 不说「上方」：卡片落到分类上是收录/重归类，不是放到分类上面；
    // 分类重排的落点也是「移到该分类」，上下半区才决定前后（播报不报半区）。
    return toLabel ? `「${title}」移到${toLabel}。` : `「${title}」正在移动。`
  }
  if (phase === 'end') {
    const at = positionLabel ?? toLabel
    return at ? `已将「${title}」移到${at}。` : `已放下「${title}」。`
  }
  if (phase === 'nochange') {
    // 拖拽确实放下了、只是目标不产生变化（同分类内落下、目标里已有该站）：
    // 不能说「已取消」——用户没有按 Esc，也没有失败。
    return `「${title}」位置没有变化。`
  }
  return `已取消拖动「${title}」，位置没有变化。`
}
