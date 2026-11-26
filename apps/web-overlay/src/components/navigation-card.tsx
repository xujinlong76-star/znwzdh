'use client'

import Link from 'next/link'
import { memo, useRef, useState } from 'react'
import type { NavigationSubItem } from '@/types/navigation'
import { SiteFavicon, extractFaviconMonogram, getDeterministicGradient } from '@/components/site-favicon'
import { resolveSiteThumbnail, type SiteThumbnail } from '@/lib/site-thumbnails'
import { FavoriteButton } from '@/components/favorite-button'
import type { SiteConfig } from '@/types/site'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Eye, EyeOff, Star, Zap, Pin, Info, Copy, ArrowUpToLine, GripVertical } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { DiyCardMenu } from '@/components/diy/diy-card-menu'
import { DIY_DRAG_INSTRUCTIONS_ID, type CardMoveDirection } from '@/lib/modular/diy-drag'
import { useDiyDragHandleRef, useDiyDragActive } from '@/components/diy/diy-drag-context'
import { useToast } from "@/components/ui/use-toast"
import type { CardDisplayMode } from '@/lib/modular/use-home-diy'
import { normalizeCardDisplayMode } from '@/lib/modular/card-display-modes'
import { NavigationCardVariant } from '@/components/navigation-card-variants'
import { useSiteItemController } from '@/components/site-item-shell'
import { useFeatureMask } from '@/lib/modular/feature-mask-store'
import { cn } from '@/lib/utils'
import { safeHref } from '@/lib/safe-url'
import { SiteCard } from '@/components/site-card'
import { buildDeadLinkWaybackUrl } from '@/lib/dead-link'
import { getSiteNotice } from '@/lib/site-notices'
import {
  healthDotClass,
  isFailingHealthState,
  siteHealthState,
  siteHealthTitle,
  type SiteHealthState,
} from '@/lib/site-health'
import { tagSlug } from '@/lib/seo/tag-slug'
import { recordOfflineVisit } from '@/lib/offline-recent'
import { getIdentity } from '@/lib/identity'
import { reportClick } from '@/lib/navhub-api'
import { useExternalLinkTarget } from '@/lib/user-preferences'
import { NumberDialBadge } from '@/components/number-dial-badge'
import { resolveBatchKeyboardAction } from '@/lib/batch-keyboard'
import {
  isAnyDialogOpen,
  isAnyMenuOpen,
  isDragHandleFocused,
  isEventTargetTyping,
} from '@/lib/keyboard-guards'

/**
 * 视觉缩略图（P1 #9：视觉卡片——缩略图一半）。
 *
 * 只渲染解析器已经确认的真实图片（品牌图标 / 自定义 icon / favicon 代理，
 * 见 lib/site-thumbnails.ts），不编造、不接截图服务。盒子尺寸由调用方
 * 固定（横幅 h-28 / 标准卡大图标 w-12 h-12），图片懒加载、加载失败时
 * 回落为与图标管线同款的确定性渐变首字母徽标——盒子尺寸不变，所以
 * 图片无论成功、失败还是还在加载，卡片都不会发生布局偏移。
 * 图片本身是装饰性的（标题已是链接文本），aria-hidden，不进读屏。
 */
function CardThumbnailVisual({
  thumbnail,
  title,
  boxClassName,
  imgClassName,
  monogramClassName,
  // P2-11：与 imgClassName 的 CSS 显示尺寸一致（rich 56 / 默认 36），让 <img>
  // 自带宽高、盒子尺寸不依赖父级 class；object-contain 下图片按原比例缩放，
  // 宽高属性只定纵横比预留、不拉伸图片。
  imgWidth,
  imgHeight,
  noBackdrop = false,
}: {
  thumbnail: SiteThumbnail
  title: string
  boxClassName: string
  imgClassName: string
  monogramClassName: string
  imgWidth: number
  imgHeight: number
  noBackdrop?: boolean
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const prevSrcRef = useRef(thumbnail.src)
  // 与 SiteFavicon 同款的换源复位：同一位置复用给另一站点时，
  // 旧图的失败态不能把新图也钉死成首字母徽标。
  if (prevSrcRef.current !== thumbnail.src) {
    prevSrcRef.current = thumbnail.src
    if (imgFailed) setImgFailed(false)
  }
  const gradient = getDeterministicGradient(title || 'navhub')
  const monogram = extractFaviconMonogram(title || '')
  const showBackdrop = !noBackdrop || imgFailed
  return (
    <div
      aria-hidden="true"
      className={cn('relative flex items-center justify-center overflow-hidden select-none', boxClassName)}
      style={showBackdrop ? { background: gradient.cssGradient } : undefined}
    >
      {!imgFailed ? (
        <img
          src={thumbnail.src}
          alt=""
          width={imgWidth}
          height={imgHeight}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={cn('relative z-10', imgClassName)}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span
          className={cn('font-bold leading-none drop-shadow-xs', monogramClassName)}
          style={{ color: gradient.textColor }}
        >
          {monogram}
        </span>
      )}
    </div>
  )
}

/**
 * 健康徽标（03 §4.2：与速览弹窗同款式——圆点 + 文案）。
 *
 * 渲染用 `siteHealthState()` 的分级（不用旧二元口径）；`state` 为 null
 * （未巡检）时调用方不渲染本组件——徽标只在有巡检事实时出现，不占位、
 * 不写“检测中”。徽标是纯展示信息，不做成按钮；`title` 悬停是补充信息，
 * 种类文案本身已在可见文本里（§7）。零新增请求：health 随分片静态下发。
 *
 * 2026-11-25 UI 评审 P1-4：① 圆点配色走 healthDotClass() 的 Token
 * （bg-success / bg-pinned / bg-destructive），不再用 raw emerald/amber/rose；
 * ② 静态快照不再 animate-pulse（脉动暗示实时监控，数据其实随分片下发）；
 * ③ 延迟数字不再进徽标正文（可访问 7035ms 与绿灯并列是矛盾信号），
 * 完整「HTTP code · latency · 巡检日期」留在 title；>1s 延迟由文案分档
 * （响应较慢/缓慢）并转琥珀警示档，详见 site-health.ts。
 *
 * “看存档”只在疑似失效 / 已失效时出现：卡片没有 `createdAt`（导航 JSON
 * 无此字段），一律用 `*` 回落（最新快照），`title` 写明“查看最近存档快照”，
 * 不编一个假时间戳（§4.3）。徽标本体留在 pointer-events-none 的内容层里
 * （点徽标仍是点卡片、打开原站），只有“看存档”链接本身可点。
 */
function CardHealthBadge({
  href,
  health,
  state,
}: {
  href: string
  health: NavigationSubItem['health']
  state: SiteHealthState
}) {
  const title = siteHealthTitle(health, state)
  const showArchive = state.state === 'dead' || state.state === 'suspect-soft404'
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground"
      title={title ?? undefined}
    >
      <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', healthDotClass(state))} />
      <span>{state.label}</span>
      {showArchive && (
        <a
          href={buildDeadLinkWaybackUrl(href)}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title="查看最近存档快照"
          className="pointer-events-auto underline underline-offset-2 hover:text-foreground"
        >
          看存档
        </a>
      )}
    </span>
  )
}

/**
 * 「只看失效」开关（03 §7，show-failing-only）：默认关闭，只在用户主动
 * 打开时生效；开关状态不进 URL、不持久化（纯视图筛选，刷新即复位）。
 * 列表方持有 `checked` 状态、把 `showFailingOnly` 透传给每张卡片；
 * 开关打开且无失败时，列表方显示空态文案 `ALL_SITES_ACCESSIBLE_EMPTY_TEXT`。
 */
export function FailingOnlyToggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="只看失效站点"
      title="只显示巡检异常的站点"
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/60 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      <span
        aria-hidden="true"
        className={cn('h-2 w-2 rounded-full', checked ? 'bg-rose-500' : 'bg-muted-foreground/50')}
      />
      <span>只看失效</span>
    </button>
  )
}

/** 「只看失效」开关打开且无失败时的空态文案（03 §7）。 */
export const ALL_SITES_ACCESSIBLE_EMPTY_TEXT = '全部站点均可访问'

export interface NavigationCardProps {
  item: NavigationSubItem
  siteConfig?: SiteConfig
  onPeek?: (item: NavigationSubItem) => void
  cardDisplayMode?: CardDisplayMode
  /**
   * 「只看失效」开关（03 §7）：打开时只留失效侧卡片，其余整卡不渲染、不占位。
   * 默认关闭；开关状态不进 URL、不持久化（纯视图筛选，刷新即复位），
   * 状态由列表方持有（见 FailingOnlyToggle），卡片只按它过滤自己。
   */
  showFailingOnly?: boolean
  isPinnedInCategory?: boolean
  onTogglePinInCategory?: (siteId: string) => void
  isDraggable?: boolean
  sourceCategoryId?: string
  /** 多选模式：点击卡片 = 切换选中，而不是打开站点 */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (siteId: string) => void
  /** 指向页面里唯一的键盘操作说明元素（sr-only），避免每张卡各渲染一份 */
  keyboardHintId?: string
  isEditingLayout?: boolean
  isSpeedDialPinned?: boolean
  onToggleSpeedDialPin?: (siteId: string) => void
  linkTarget?: '_blank' | '_self'
  externalRel?: string
  /**
   * 卡片 ⋯ 菜单的移动回调（编辑态由 navigation-category-section 传入，
   * 走 use-home-diy-grid 的置顶列表重排；不传则不渲染菜单）。
   * 与拖拽互为等效替代（WCAG 2.2 2.5.7），不依赖任何拖拽库。
   */
  onMoveCard?: (cardId: string, direction: CardMoveDirection) => void
  /** 该卡在当前显示列表里的序号（菜单的禁用态与播报用） */
  cardIndex?: number
  /** 当前显示列表的总卡数 */
  cardTotal?: number
  /**
   * 数字直达坞映射位（1~9）：由 navigation-content 的 buildDialMap 算出并透传，
   * 挂载前为 undefined（SSR 与首帧不渲染角标）。有值时卡片图标右下角画角标，
   * 主锚点的 aria-keyshortcuts 追加该数字。
   */
  dialDigit?: number
  /** 该站绑定的自定义快拨位（'1'~'0'，Ctrl+Shift+数字）：只进 aria-keyshortcuts，不画角标 */
  quickDialDigit?: string
  /** 全站标题索引：卡片 ⋯ 菜单绑定快拨位时，报出被顶掉站点的站名 */
  siteTitleById?: ReadonlyMap<string, string>
}

export const NavigationCard = memo(function NavigationCard({
  item,
  onPeek,
  showFailingOnly = false,
  cardDisplayMode = 'standard',
  isPinnedInCategory = false,
  onTogglePinInCategory,
  isDraggable = false,
  sourceCategoryId,
  selectable = false,
  selected = false,
  onToggleSelect,
  keyboardHintId,
  isEditingLayout: propIsEditingLayout,
  isSpeedDialPinned = false,
  onToggleSpeedDialPin,
  linkTarget: propLinkTarget = '_blank',
  externalRel = 'noopener noreferrer nofollow',
  onMoveCard,
  cardIndex = 0,
  cardTotal = 1,
  dialDigit,
  quickDialDigit,
  siteTitleById,
}: NavigationCardProps) {
  const controller = useSiteItemController({
    item,
    onPeek,
    isPinnedInCategory,
    onTogglePinInCategory,
    isDraggable,
    sourceCategoryId,
    selectable,
    selected,
    onToggleSelect,
    keyboardHintId,
    isEditingLayout: propIsEditingLayout,
    isSpeedDialPinned,
    onToggleSpeedDialPin,
    linkTarget: propLinkTarget,
    externalRel,
    onMoveCard,
    cardIndex,
    cardTotal,
    dialDigit,
    quickDialDigit,
    siteTitleById,
  })
  const linkTarget = useExternalLinkTarget(propLinkTarget)
  const { toast } = useToast()
  const isEditingLayout = controller.isEditingLayout
  const { effectiveCardElements, isFeatureHidden } = useFeatureMask()
  const isCapsuleCollapsed = !effectiveCardElements.showDescription && !effectiveCardElements.showTags

  /**
   * 健康徽标已恢复（2026-11-12 移除，hubId 打通后恢复，见 03 §4.1）：
   * 卡片数据来自静态导航 JSON，hubId 打通后分片自带巡检 health，
   * 徽标按 siteHealthState() 的分级渲染；未巡检（healthState 为 null）
   * 时不渲染任何徽标位、不占位、不写“检测中”——与移除前的无徽标视觉一致。
   */
  const healthState = siteHealthState(item.health, getSiteNotice(item.hubId))

  /**
   * dnd-kit 拖拽手柄的 ref 回调（轻量 context，不 import dnd-kit）。
   * 祖先里没有 DiyDraggableCard（provider 未接线或非编辑态）时为 null，
   * 手柄不渲染——卡片退化为「仅 ⋯ 菜单可移动」，功能不丢。
   */
  const dragHandleRef = useDiyDragHandleRef()
  const showDragHandle = isDraggable && dragHandleRef !== null
  // dnd-kit 键盘拖拽是否正在进行（Space 已拿起卡片）：进行中方向键归传感器
  const keyboardDragActive = useDiyDragActive()

  /**
   * 卡片 ⋯ 菜单的移动：菜单只负责选方向，播报在这里（调用点）做——
   * 这里知道卡片标题、移动方向与移动后的序号；菜单的禁用态已保证
   * 只有合法移动才会调到这里，播报可以按成功写。
   */
  const handleMenuMove = (direction: CardMoveDirection) => {
    // P0-2：onMoveCard 改为（cardId, direction）——调用方传一个稳定回调，
    // 卡片把自己的 id 带上，不再每轮在调用点新建闭包击穿 memo。
    onMoveCard?.(item.id, direction)
    const directionLabel =
      direction === 'up' ? '上移' : direction === 'down' ? '下移' : direction === 'top' ? '移到顶部' : '移到末尾'
    const toPosition =
      direction === 'up' ? cardIndex : direction === 'down' ? cardIndex + 2 : direction === 'top' ? 1 : cardTotal
    toast({
      title: `已将「${item.title}」${directionLabel}，现在是第 ${toPosition} 个，共 ${cardTotal} 个`,
    })
  }

  /**
   * 主锚点的键盘快捷键说明（读屏播报）：基础是 Space 速览 + → 进操作区；
   * 有数字直达位时追加该数字，有自定义快拨位时追加 Ctrl+Shift+数字。
   * 角标本体是 aria-hidden 的装饰，快捷键信息只走这一处。
   */
  const dialKeyshortcuts = [
    'Space',
    'ArrowRight',
    ...(dialDigit ? [String(dialDigit)] : []),
    ...(quickDialDigit ? [`Ctrl+Shift+${quickDialDigit}`] : []),
  ].join(' ')

  /**
   * 拖拽手柄 + ⋯ 菜单：三处卡片形态共用。
   *
   * 手柄是 dnd-kit 的 handle（touch-action:none，激活阈值走
   * PointerSensor 库默认值：鼠标按下即激活，触屏 250ms + 5px 容差）：
   * 鼠标、触屏、键盘（Space 拿起 → 方向键 → Enter 放下 → Esc 取消）
   * 都从它出发；菜单是完全不依赖拖拽库的等效替代。
   * 两个按钮都带 data-card-action，进卡片操作区的方向键漫游。
   */
  const renderDragControls = (sizeClass: string) => (
    <>
      {showDragHandle && dragHandleRef && (
        <button
          type="button"
          tabIndex={-1}
          data-card-action=""
          data-diy-drag-handle=""
          ref={dragHandleRef}
          style={{ touchAction: 'none' }}
          className={cn(sizeClass, 'text-muted-foreground hover:text-foreground hover:bg-accent cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60')}
          title="拖动排序（按住拖动；键盘：聚焦后按空格开始，方向键移动，回车放下，Esc 取消）"
          aria-label={`拖动排序：${item.title}`}
          aria-describedby={DIY_DRAG_INSTRUCTIONS_ID}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
      )}
      {isEditingLayout && onMoveCard && (
        <DiyCardMenu
          title={item.title}
          index={cardIndex}
          total={cardTotal}
          onMove={handleMenuMove}
          onCopy={() => void handleCopyLink()}
          onDelete={() => handlePruneSite()}
          sizeClass={sizeClass}
          siteId={item.id}
          siteTitleById={siteTitleById}
        />
      )}
    </>
  )

  const handlePruneSite = controller.handlePruneSite
  const handleToggleSpeedDial = controller.handleToggleSpeedDial
  const handleLinkClick = (e: React.MouseEvent) => {
    if (isEditingLayout) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (!selectable) {
      recordOfflineVisit({ id: item.id, title: item.title, href: item.href, icon: item.icon })
      reportClick(item.id, getIdentity())
      return
    }
    e.preventDefault()
    e.stopPropagation()
    onToggleSelect?.(item.id)
  }
  const handleTagClick = (e: React.MouseEvent) => {
    if (isEditingLayout) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (!selectable) return
    e.preventDefault()
    e.stopPropagation()
    onToggleSelect?.(item.id)
  }
  const topAlternative = controller.topAlternative

  /**
   * 卡片的键盘模型：**整卡只有一个 Tab 停留点**（主链接）。
   *
   * 原实现给卡片根节点 tabIndex=0，加上主链接、置顶、速览、工作台、收藏
   * 五个按钮，一张卡有 6 个停留点——千站首页要按约 6000 次 Tab 才能走完，
   * 键盘用户实际上到不了页尾。现在：
   *   - 主链接是唯一 Tab 停留点（Enter 打开，Space 速览）；
   *   - → 键进入卡片操作区，操作区内 ←/→ 切换、Esc 回到主链接；
   *   - 操作按钮 tabIndex=-1，仍可被读屏浏览模式访问，也保留鼠标行为。
   * 这是 WAI-ARIA 复合控件（toolbar/grid）的常规做法：一个入口 + 方向键内部导航。
   */
  const linkRef = useRef<HTMLAnchorElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLAnchorElement>) => {
    // 多选模式：Space/Enter 切换选中（不再 Peek/导航），Delete/Backspace
    // 走批量移除（11b，带撤销）：判定走 lib/batch-keyboard.ts 的纯函数，与
    // window 层 useBatchKeyboard 同源，卡片级只处理 toggle-focused，其余
    // kind 不拦冒泡、由 window 层执行；单卡隐藏 handlePruneSite 只在
    // 非多选态走（下面的分支不在本 if 块内）。
    // <a> 的 Enter 原生激活拦不住，window 冒泡 preventDefault 来不及，必须卡片级拦截。
    // 拖拽进行中一律让位给 dnd-kit；守卫放行（弹窗/菜单打开等）时也不落回旧逻辑，
    // 多选态下 Space/Enter 永不 Peek、永不导航；Delete/Backspace 走批量移除，
    // 不走单卡隐藏 handlePruneSite。
    if (
      selectable &&
      (e.key === ' ' || e.code === 'Space' || e.key === 'Enter' || e.key === 'Delete' || e.key === 'Backspace')
    ) {
      if (keyboardDragActive) return
      const action = resolveBatchKeyboardAction(
        {
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          isComposing: e.nativeEvent.isComposing,
        },
        {
          composing: e.nativeEvent.isComposing ?? false,
          typing: isEventTargetTyping(e.nativeEvent),
          dialogOpen: isAnyDialogOpen(),
          menuOpen: isAnyMenuOpen(),
          editingLayout: isEditingLayout,
          dragHandleFocused: isDragHandleFocused(),
        },
        { surface: 'home', inBatchMode: true, focusedSiteId: item.id },
      )
      if (action?.kind === 'toggle-focused') {
        e.preventDefault()
        e.stopPropagation()
        onToggleSelect?.(item.id)
        return
      }
      // 11b：Delete/Backspace 在多选态已是批量移除（带撤销），不再是 ignore。
      // 非 toggle-focused 的 kind 一律直接 return，不拦冒泡，window 层
      // use-batch-keyboard 接到 batch-remove 后执行真正的批量移除。
      return
    }
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault()
      onPeek?.(item)
      return
    }
    if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey || isEditingLayout))) {
      e.preventDefault()
      handlePruneSite(e)
      return
    }
    if (e.key === 'ArrowRight') {
      const card = (e.currentTarget as HTMLElement).closest('[data-navhub-site-id]')
      const first = card?.querySelector<HTMLElement>('[data-card-action]')
      if (first) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  /** 操作区内方向键导航：←/→ 移动，Esc 回到主链接 */
  const handleActionsKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // P0-3/P0-4：漫游处理器挂在卡片根节点（覆盖内容层的标签/平替与底栏按钮），
    // 事件会从卡片内所有可聚焦元素冒泡上来；只有事件源本身就是某个
    // [data-card-action]（或其子节点）时才处理。否则——例如焦点在覆盖层 <a> 上
    // 按 →，它自己的 handleKeyDown 已把焦点挪到首个动作——这里再处理就会
    // 连挪两次。守卫保证每个按键只被处理一次。
    if (!(e.target as HTMLElement | null)?.closest?.('[data-card-action]')) {
      return
    }
    // 键盘拖拽进行中（Space 已拿起卡片）且焦点就在拖拽手柄上：
    // ←/→/Esc 归 dnd-kit KeyboardSensor——它在 document 捕获阶段监听，
    // 先于这里收到事件；这里再 preventDefault + 挪焦点，方向键就只动
    // 焦点、拖不动卡片，Esc 还会把焦点抢回主链接。所以直接放行，
    // 一个键也不拦；拖拽结束（放下/取消）后漫游自动恢复。
    if (
      keyboardDragActive &&
      (document.activeElement as HTMLElement | null)?.hasAttribute('data-diy-drag-handle')
    ) {
      return
    }
    const actions = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('[data-card-action]'),
    )
    const index = actions.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      actions[index + 1 < actions.length ? index + 1 : 0]?.focus()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (index <= 0) linkRef.current?.focus()
      else actions[index - 1]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      linkRef.current?.focus()
    }
  }

  const handleWorkbenchPin = controller.handleWorkbenchPin
  const handleCategoryPin = (e: React.MouseEvent) => {
    controller.handleCategoryPin?.(e)
  }
  const selectionClass = controller.selectionClass
  const hasSiteDetail = !item.id.startsWith('custom_site_')
  const siteDetailHref = `/site/${encodeURIComponent(item.id)}`
  const thumbnail = resolveSiteThumbnail(item)

  /** 标题/详情与整卡同语义：多选时不导航，只切换选中 */
  const handleDetailClick = (e: React.MouseEvent) => {
    if (isEditingLayout) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (!selectable) return
    e.preventDefault()
    e.stopPropagation()
    onToggleSelect?.(item.id)
  }

  const handleCopyLink = controller.handleCopyLink

  /**
   * 卡片的内容层：外链覆盖层之下/之上的兄弟层。
   *
   * 结构纪律（与 tag-results-board 同一套）：**外链 <a>、标题内链、操作按钮
   * 三者是兄弟节点，任何 `<a>` 都不嵌套 `<a>`**。外链是空锚覆盖整卡，
   * 内容层整体 pointer-events-none，只有真正可点的元素（标题内链、
   * 平替徽标、标签）单独 pointer-events-auto —— 否则描述与空白处
   * 的点击会被内容层吞掉，「点卡片开官网」的默认行为当场失效。
   */
  const detailAction = (sizeClass: string) =>
    hasSiteDetail ? (
      <Button
        asChild
        tabIndex={-1}
        data-card-action=""
        variant="ghost"
        size="icon"
        className={cn(sizeClass, 'text-muted-foreground hover:text-foreground hover:bg-accent')}
        title="查看站点详情"
      >
        <Link
          href={siteDetailHref}
          tabIndex={-1}
          onClick={handleDetailClick}
          aria-label={`查看站点详情：${item.title}`}
        >
          <Info className="w-3.5 h-3.5" />
          <span className="sr-only">{`查看站点详情：${item.title}`}</span>
        </Link>
      </Button>
    ) : null

  // 「只看失效」开关（03 §7）：打开时只留失效侧卡片，其余整卡不渲染、不占位。
  // 放在全部 Hook 调用之后、各形态返回之前：Hook 顺序不受开关影响。
  if (showFailingOnly && !isFailingHealthState(healthState)) return null

  const normalizedDisplayMode = normalizeCardDisplayMode(cardDisplayMode)
  if (
    normalizedDisplayMode === 'icon-wall' ||
    normalizedDisplayMode === 'list' ||
    normalizedDisplayMode === 'minimal' ||
    normalizedDisplayMode === 'directory' ||
    normalizedDisplayMode === 'bento' ||
    normalizedDisplayMode === 'glass-dock' ||
    normalizedDisplayMode === 'magazine' ||
    normalizedDisplayMode === 'terminal'
  ) {
    return (
      <NavigationCardVariant
        mode={normalizedDisplayMode}
        controller={controller}
      />
    )
  }

  // 1. 紧凑单行条形多态 (Compact Bar Mode)
  // S3 纯解剖迁移（2026-11-26 施工单 P0-1）：条形壳/图标盒/标题解剖收进
  // SiteCard compact（overlay 兄弟分支 S1 已备）；键盘漫游、多选、隐藏/置顶、
  // 收藏、Tooltip 全部经槽位留在本文件，行为零改动。操作簇渐隐浮层的
  // absolute right-7 定位相对卡片根（SiteCard ACTIONS 容器不设 relative），
  // pointer-coarse 触屏常显规则原样保留。
  if (cardDisplayMode === 'compact') {
  return (
    <Tooltip>
        <TooltipTrigger asChild>
          <SiteCard
            variant="compact"
            overlayHref={item.href}
            overlayTarget={linkTarget}
            overlayRel={externalRel}
            overlayLabel={selectable ? `选择站点：${item.title}，按空格切换选中` : `访问 ${item.title}`}
            overlayProps={{
              ref: linkRef,
              onClick: handleLinkClick,
              onKeyDown: handleKeyDown,
              'data-prefetch-target': 'true',
              'aria-keyshortcuts': dialKeyshortcuts,
              'aria-describedby': keyboardHintId,
              'aria-label': selectable ? `选择站点：${item.title}，按空格切换选中` : `访问 ${item.title}`,
              draggable: false,
              className: 'peer focus-visible:ring-primary/40 focus-visible:ring-offset-1',
            }}
            rootProps={{
              'data-testid': 'site-card',
              'data-site-id': item.id,
              'data-navhub-site-id': item.id,
              'data-navhub-selected': selected ? 'true' : undefined,
              'data-card-variant': 'compact',
              onKeyDown: handleActionsKeyDown,
              className: cn(
                // group/card 命名组：操作簇渐隐浮层（sm:group-hover/card）与 dial
                // 角标隐匿（pointer-fine:group-hover/card）都挂在它上面（SiteCard
                // 根自带无名 group 供内部 scale hover 用，两者并存）。
                'group/card',
                isPinnedInCategory && 'ring-1 ring-pinned/40 bg-pinned/4 border-pinned/30',
                isEditingLayout && 'border-dashed border-border/75',
                selectionClass,
              ),
            }}
            icon={
              <>
                <SiteFavicon
                  title={item.title}
                  url={item.href}
                  icon={item.icon}
                  useDefaultIcon={item.useDefaultIcon}
                  className="w-full h-full object-contain rounded-sm"
                />
                <NumberDialBadge digit={dialDigit} className="-bottom-1 -right-1" />
              </>
            }
            iconWrapClassName="relative flex-shrink-0 w-5 h-5 flex items-center justify-center transition-transform duration-[--duration-fast] group-hover/card:scale-105"
            title={item.title}
            href={hasSiteDetail ? siteDetailHref : undefined}
            onTitleClick={handleDetailClick}
            titleLinkProps={{ tabIndex: -1, title: item.title, className: 'truncate rounded-sm text-sm sm:text-base font-semibold tracking-tight text-foreground group-hover/card:text-primary min-w-0 flex-1' }}
            titleExtra={
              <>
                {isPinnedInCategory && (
                  <Pin className="w-2.5 h-2.5 text-pinned fill-pinned shrink-0" />
                )}
                {item.liveMetrics?.githubStars && (
                  <span className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-mono font-medium text-pinned-foreground bg-pinned/10 px-1 py-0.2 rounded-sm">
                    <Star className="w-2 h-2 text-pinned fill-pinned" />
                    {(item.liveMetrics.githubStars / 1000).toFixed(0)}k
                  </span>
                )}
                {healthState && (
                  <CardHealthBadge href={item.href} health={item.health} state={healthState} />
                )}
              </>
            }
            decorations={
              effectiveCardElements.showQuickLookBadge && (
                /* 键盘聚焦可见提示（P1-19）：主链接聚焦时显式给出快捷键（peer 由 overlayProps
                    传给覆盖层锚点），按 → 进操作区后自动隐去、不遮按钮。 */
                <div className="absolute top-2 right-2 z-20 pointer-events-none opacity-0 peer-focus-visible:opacity-100 sm:group-hover/card:opacity-0 transition-opacity duration-[--duration-fast]">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-medium bg-primary text-primary-foreground rounded-sm shadow-xs">
                    <span>Space 速览</span>
                    <span aria-hidden="true">·</span>
                    <span>→ 操作</span>
                  </span>
                </div>
              )
            }
            actions={
              <>
                {/* 紧凑操作按钮：常态走右侧绝对渐隐浮层；Phase 1 编辑态彻底去除常驻内联挤字图标，
                    改为右上角悬停/聚焦浮现迷你胶囊操作条（零挤占标题宽度）。 */}
                {isEditingLayout ? (
                  controller.renderEditCapsule()
                ) : (
                <span className="absolute right-7 top-1/2 -translate-y-1/2 z-30 flex items-center gap-0.5 rounded-r-lg bg-gradient-to-l from-card via-card to-transparent pl-7 pr-1 py-0.5 transition-opacity pointer-events-none opacity-0 sm:group-hover/card:opacity-100 sm:group-hover/card:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto">
                {renderDragControls('h-6 w-6 rounded-lg')}
                <Button
                  type="button"
                  tabIndex={-1}
                  variant="ghost"
                  size="icon"
                  className="hidden sm:inline-flex h-6 w-6 rounded-lg text-muted-foreground hover:text-destructive-text hover:bg-destructive/15 transition-colors"
                  title="🙈 隐藏此站点（移入回收站，可按 Ctrl+Z 撤销或随时还原）"
                  aria-label={`隐藏站点：${item.title}`}
                  onClick={handlePruneSite}
                >
                  <EyeOff className="w-3 h-3" />
                </Button>
                {onTogglePinInCategory && (
                  <Button
                  tabIndex={-1}
                  data-card-action=""
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-6 w-6 rounded-lg",
                      isPinnedInCategory ? "text-pinned bg-pinned/10" : "text-muted-foreground hover:text-pinned"
                    )}
                    title={isPinnedInCategory ? "取消分类内置顶" : "置顶在当前分类首位"}
                    aria-label={isPinnedInCategory ? `取消分类内置顶：${item.title}` : `置顶在当前分类首位：${item.title}`}
                    onClick={handleCategoryPin}
                  >
                    <ArrowUpToLine className={cn("w-3 h-3", isPinnedInCategory && "fill-pinned")} />
                  </Button>
                )}
                {detailAction('h-6 w-6 rounded-lg')}
                <Button
                  tabIndex={-1}
                  data-card-action=""
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-lg text-muted-foreground hover:text-foreground"
                  title="速览与行动"
                  aria-label={`速览与行动：${item.title}`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onPeek?.(item)
                  }}
                >
                  <Eye className="w-3 h-3" />
                </Button>
                <Button
                  tabIndex={-1}
                  data-card-action=""
                  variant="ghost"
                  size="icon"
                  className="hidden sm:inline-flex h-6 w-6 rounded-lg text-muted-foreground hover:text-success"
                  title="📌 固定到工作台"
                  aria-label={`固定到工作台：${item.title}`}
                  onClick={handleWorkbenchPin}
                >
                  <Pin className="w-3 h-3" />
                </Button>
                <Button
                  tabIndex={-1}
                  data-card-action=""
                  variant="ghost"
                  size="icon"
                  className="hidden sm:inline-flex h-6 w-6 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="复制网址链接"
                  aria-label={`复制链接：${item.title}`}
                  onClick={handleCopyLink}
                >
                  <Copy className="w-3 h-3" />
                </Button>
                </span>
                )}
                {/* 收藏星标（卡片悬浮修复 2026-11-20）：常驻可见可点，不再随悬停
                    显隐；旧 opacity-0 + pointer-events-none 致非悬浮态点星标无反应。 */}
                <span className="transition-opacity opacity-100 pointer-events-auto">
                  <FavoriteButton
                    tabIndex={-1}
                    cardAction
                    site={{ siteId: item.id, title: item.title, href: item.href, icon: item.icon, description: item.description }}
                  />
                </span>
              </>
            }
          />
        </TooltipTrigger>
          {!isFeatureHidden('feat:tooltips') && (
            <TooltipContent side="bottom" align="center" className="max-w-[280px] max-h-40 overflow-y-auto text-xs">
              <p>{item.description || item.title}</p>
              <p className="text-[10px] text-muted-foreground pt-1 border-t mt-1">按 Space 空格键沙箱速览</p>
            </TooltipContent>
          )}
        </Tooltip>
    )
  }

  // 2. 深度丰富卡片多态 (Rich / Detailed Mode)
  // S4 纯解剖迁移（2026-11-26 施工单 P0-1）：壳/横幅/标题/描述解剖收进
  // SiteCard grid（rich 通过 banner 槽落 grid，不新增第四变体）；键盘漫游、
  // 埋点、多选、隐藏/置顶、收藏、Tooltip、健康徽标全部经槽位留在本文件，
  // 行为零改动。顶部渐变装饰条（before:h-1）与描边档位（80/50）经 rootProps
  // className 覆盖；操作栏保留 absolute 自定位字面量（贴 SiteCard 贴底容器）。
  if (cardDisplayMode === 'rich') {
  return (
    <Tooltip>
        <TooltipTrigger asChild>
          <SiteCard
            variant="grid"
            overlayHref={item.href}
            overlayTarget={linkTarget}
            overlayRel={externalRel}
            overlayLabel={selectable ? `选择站点：${item.title}，按空格切换选中` : `访问 ${item.title}`}
            overlayProps={{
              ref: linkRef,
              onClick: handleLinkClick,
              onKeyDown: handleKeyDown,
              'data-prefetch-target': 'true',
              'aria-keyshortcuts': dialKeyshortcuts,
              'aria-describedby': keyboardHintId,
              'aria-label': selectable ? `选择站点：${item.title}，按空格切换选中` : `访问 ${item.title}`,
              draggable: false,
              className: 'peer focus-visible:ring-primary/40 focus-visible:ring-offset-1',
            }}
            rootProps={{
              'data-testid': 'site-card',
              'data-site-id': item.id,
              'data-navhub-site-id': item.id,
              'data-navhub-selected': selected ? 'true' : undefined,
              'data-card-variant': 'rich',
              onKeyDown: handleActionsKeyDown,
              className: cn(
                'h-full overflow-hidden group/card',
                // rich 描边档位与顶部渐变装饰条（P1 #9）覆盖 grid 默认
                'border-border/80 hover:border-primary/50 before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-primary/40 before:via-accent/60 before:to-primary/30',
                // P2-22：置顶角标会压住无缩略图时的图标左上角；置顶且无缩略图时
                // 上内边距改为 28px（pt-7）。有缩略图时角标压在横幅上，不加。
                isPinnedInCategory && !thumbnail && 'pt-7',
                isPinnedInCategory && 'ring-1 ring-pinned/40 bg-pinned/4 border-pinned/30',
                selectionClass,
              ),
            }}
            banner={
              thumbnail ? (
                <CardThumbnailVisual
                  thumbnail={thumbnail}
                  title={item.title}
                  boxClassName="h-28 w-full shrink-0"
                  /* 2026-11-21：横幅卡内图 56 → 44px（要求 40–44 区间）。 */
                  imgClassName="h-11 w-11 object-contain drop-shadow-sm"
                  monogramClassName="text-3xl"
                  imgWidth={56}
                  imgHeight={56}
                />
              ) : undefined
            }
            icon={!thumbnail && (
                <SiteFavicon
                  title={item.title}
                  url={item.href}
                  icon={item.icon}
                  useDefaultIcon={item.useDefaultIcon}
                  className="w-full h-full object-contain rounded-lg"
                />
              )}
            iconWrapClassName="relative flex-shrink-0 w-9 h-9 flex items-center justify-center transition-transform duration-[--duration-base] group-hover/card:scale-105 p-0 bg-transparent dark:bg-transparent border-0 shadow-none"
            title={item.title}
            href={hasSiteDetail ? siteDetailHref : undefined}
            onTitleClick={handleDetailClick}
            titleLinkProps={{ tabIndex: -1, title: item.title, className: 'line-clamp-1 leading-snug min-w-0' }}
            titleExtra={
              healthState ? (
                <CardHealthBadge href={item.href} health={item.health} state={healthState} />
              ) : undefined
            }
            description={effectiveCardElements.showDescription ? item.description || '\u00A0' : undefined}
            decorations={
              <>
                {isPinnedInCategory && effectiveCardElements.showPinnedBadge && (
                  <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-pinned/15 text-pinned-foreground border border-pinned/30 font-medium">
                    <Pin className="w-2.5 h-2.5 fill-pinned" />
                    <span>已置顶</span>
                  </div>
                )}

                {/* 数字快捷键角标（卡片悬浮修复 2026-11-20）：星标改为常驻后，
                    角标改放星标左侧（right-11）。
                    悬停/聚焦时隐去让位给右上角操作区。digit 为空时组件
                    自身返回 null；sm 以下隐藏（见 number-dial-badge）。 */}
                <NumberDialBadge
                  digit={dialDigit}
                  className="top-2 right-11 z-20 transition-opacity duration-[--duration-fast] pointer-fine:group-hover/card:opacity-0 pointer-fine:group-focus-within/card:opacity-0"
                />

                {/* 键盘聚焦可见提示（P1-19）：主链接聚焦时显式给出快捷键（peer 由 overlayProps
                    传给覆盖层锚点），按 → 进操作区后自动隐去、不遮按钮。 */}
                {effectiveCardElements.showQuickLookBadge && (
                  <div className="absolute top-2 right-2 z-20 pointer-events-none opacity-0 peer-focus-visible:opacity-100 sm:group-hover/card:opacity-0 transition-opacity duration-[--duration-fast]">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-medium bg-primary text-primary-foreground rounded-sm shadow-xs">
                      <span>Space 速览</span>
                      <span aria-hidden="true">·</span>
                      <span>→ 操作</span>
                    </span>
                  </div>
                )}
              </>
            }
            meta={
              <>
                {/* 徽标与指标：自适应流动折叠，绝不挤压主标题（原样保留） */}
                {effectiveCardElements.showPinnedBadge && (item.liveMetrics?.githubStars) && (
                  <div className="flex items-center gap-1.5 pt-1.5 flex-wrap">
                    {item.liveMetrics?.githubStars && (
                      <span className="inline-flex items-center gap-0.5 text-xs font-mono font-medium text-pinned-foreground bg-pinned/10 border border-pinned/20 px-1.5 py-0.5 rounded-full shrink-0">
                        <Star className="w-2.5 h-2.5 text-pinned fill-pinned" />
                        {(item.liveMetrics.githubStars / 1000).toFixed(0)}k
                      </span>
                    )}
                  </div>
                )}

                {/* 丰富标签池 + 平替 + 深链（原样保留；原 mt-auto 锁底改由 SiteCard 排布接管） */}
                {effectiveCardElements.showTags && (
                  <div className="pt-2.5 flex items-center gap-1.5 flex-wrap min-h-[2rem]">
                    {item.tags?.slice(0, 2).map((tag) => (
                      <Link
                        key={tag}
                        href={'/tags/' + encodeURIComponent(tagSlug(tag))}
                        onClick={handleTagClick}
                        tabIndex={-1}
                        data-card-action
                        className="pointer-events-auto inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-muted/70 text-muted-foreground font-mono hover:bg-primary/10 hover:text-primary transition-colors min-h-6"
                      >
                        #{tag}
                      </Link>
                    ))}
                    {topAlternative && effectiveCardElements.showPinnedBadge && (
                      <button
                        type="button"
                        data-card-action
                        tabIndex={-1}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          onPeek?.(item)
                        }}
                        aria-label={`查看平替：${topAlternative.targetTitle}`}
                        className="pointer-events-auto inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-category/10 text-category-foreground font-medium hover:bg-category/20 border border-category/20 transition-colors cursor-pointer"
                      >
                        <span>平替: {topAlternative.targetTitle}</span>
                      </button>
                    )}
                    {item.actions && item.actions.length > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-pinned-foreground font-medium bg-pinned/10 border border-pinned/20 px-1.5 py-0.5 rounded-full">
                        <Zap className="w-2.5 h-2.5" />
                        <span>深链</span>
                      </span>
                    )}
                  </div>
                )}
              </>
            }
            actionBar={
              <div
                className={cn(
                  "nav-card-actionbar absolute bottom-0 left-0 right-0 z-10 flex items-center gap-0.5 px-1.5 pt-1.5 pb-1 bg-card/95 dark:bg-card/90 backdrop-blur-md before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-border before:to-transparent transition-opacity duration-[--duration-fast]",
                  isEditingLayout ? "opacity-100 pointer-events-auto" : "pointer-events-none opacity-0 group-hover/card:opacity-100 group-hover/card:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto"
                )}
              >
                <span className="flex flex-1 items-center gap-0.5">
                {renderDragControls('h-11 w-11 rounded-lg')}
                <Button
                  type="button"
                  tabIndex={-1}
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-11 min-w-11 flex-1 rounded-lg transition-colors",
                    isEditingLayout
                      ? "text-destructive-text hover:text-destructive-text hover:bg-destructive/15"
                      : "hidden sm:inline-flex text-muted-foreground hover:text-destructive-text hover:bg-destructive/15"
                  )}
                  title="🙈 隐藏此站点（移入回收站，可按 Ctrl+Z 撤销或随时还原）"
                  aria-label={`隐藏站点：${item.title}`}
                  onClick={handlePruneSite}
                >
                  <EyeOff className="w-4 h-4" />
                </Button>
                {isEditingLayout && (
                  <Button
                    type="button"
                    tabIndex={-1}
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-11 min-w-11 flex-1 rounded-lg transition-colors",
                      isSpeedDialPinned ? "text-pinned bg-pinned/15" : "text-muted-foreground hover:text-pinned"
                    )}
                    title={isSpeedDialPinned ? "从首屏速览坞取消固定" : "📌 钉入首屏速览坞"}
                    aria-label={isSpeedDialPinned ? `从速览坞取消固定：${item.title}` : `钉入速览坞：${item.title}`}
                    onClick={handleToggleSpeedDial}
                  >
                    <Zap className={cn("w-4 h-4", isSpeedDialPinned && "fill-pinned")} />
                  </Button>
                )}
                {onTogglePinInCategory && (
                  <Button
                  tabIndex={-1}
                  data-card-action=""
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-11 min-w-11 flex-1 rounded-lg transition-colors",
                      isPinnedInCategory ? "text-pinned bg-pinned/10" : "text-muted-foreground hover:text-pinned"
                    )}
                    title={isPinnedInCategory ? "取消分类内置顶" : "置顶在当前分类首位"}
                    aria-label={isPinnedInCategory ? `取消分类内置顶：${item.title}` : `置顶在当前分类首位：${item.title}`}
                    onClick={handleCategoryPin}
                  >
                    <ArrowUpToLine className={cn("w-4 h-4", isPinnedInCategory && "fill-pinned")} />
                  </Button>
                )}
                {detailAction('h-11 min-w-11 flex-1 rounded-lg')}
                <Button
                  tabIndex={-1}
                  data-card-action=""
                  variant="ghost"
                  size="icon"
                  className="h-11 min-w-11 flex-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
                  title="速览与行动"
                  aria-label={`速览与行动：${item.title}`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onPeek?.(item)
                  }}
                >
                  <Eye className="w-4 h-4" />
                </Button>
                <Button
                  tabIndex={-1}
                  data-card-action=""
                  variant="ghost"
                  size="icon"
                  className="hidden sm:inline-flex h-11 min-w-11 flex-1 rounded-lg text-muted-foreground hover:text-success hover:bg-success/10 transition-colors"
                  title="📌 固定到工作台"
                  aria-label={`固定到工作台：${item.title}`}
                  onClick={handleWorkbenchPin}
                >
                  <Pin className="w-4 h-4" />
                </Button>
                <Button
                  tabIndex={-1}
                  data-card-action=""
                  variant="ghost"
                  size="icon"
                  className="hidden sm:inline-flex h-11 min-w-11 flex-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="复制网址链接"
                  aria-label={`复制链接：${item.title}`}
                  onClick={handleCopyLink}
                >
                  <Copy className="w-4 h-4" />
                </Button>
                </span>
              </div>
            }
            actions={
              /* 收藏星标（卡片悬浮修复 2026-11-20）：常驻右上角、恒可见可点，
                  SiteCard actions 槽经 actionsAlwaysVisible 保持常驻。 */
              <FavoriteButton
                tabIndex={-1}
                cardAction
                className="pointer-events-auto bg-background/90 dark:bg-background/95 backdrop-blur-md border border-border/70 shadow-xs"
                site={{ siteId: item.id, title: item.title, href: item.href, icon: item.icon, description: item.description }}
              />
            }
            actionsAlwaysVisible
          />
        </TooltipTrigger>
          {!isFeatureHidden('feat:tooltips') && (
            <TooltipContent side="bottom" align="center" className="max-w-[280px] max-h-40 overflow-y-auto text-xs">
              <p>{item.description || item.title}</p>
              <p className="text-[10px] text-muted-foreground pt-1 border-t mt-1">💡 按 Space 空格键呼出沙箱速览与微动作</p>
            </TooltipContent>
          )}
        </Tooltip>
    )
  }

  // 3. 标准现代卡片 (Standard Mode - 默认)
  // S2 纯解剖迁移（2026-11-26 施工单 P0-1）：壳/图标盒/标题/描述解剖收进
  // SiteCard grid（D1 接受 grid 默认排布，不逐像素对齐旧标准卡）；键盘漫游、
  // 埋点、多选、隐藏/置顶/钉坞、收藏、Tooltip、健康徽标全部经槽位留在本文件，
  // 行为零改动。覆盖层附加属性（ref/键盘/快捷键/预取/peer）经 overlayProps 透传。
  return (
    <Tooltip>
        <TooltipTrigger asChild>
          <SiteCard
            variant="grid"
            overlayHref={item.href}
            overlayTarget={linkTarget}
            overlayRel={externalRel}
            overlayLabel={selectable ? `选择站点：${item.title}，按空格切换选中` : `访问 ${item.title}`}
            overlayProps={{
              ref: linkRef,
              onClick: handleLinkClick,
              onKeyDown: handleKeyDown,
              'data-prefetch-target': 'true',
              'aria-keyshortcuts': dialKeyshortcuts,
              'aria-describedby': keyboardHintId,
              'aria-label': selectable ? `选择站点：${item.title}，按空格切换选中` : `访问 ${item.title}`,
              draggable: false,
              className: 'peer focus-visible:ring-primary/40 focus-visible:ring-offset-1',
            }}
            rootProps={{
              'data-testid': 'site-card',
              'data-site-id': item.id,
              'data-navhub-site-id': item.id,
              'data-navhub-selected': selected ? 'true' : undefined,
              'data-card-variant': 'standard',
              onKeyDown: handleActionsKeyDown,
              className: cn(
                'h-full overflow-hidden group/card',
                isCapsuleCollapsed
                  ? isPinnedInCategory
                    ? 'px-3 pb-2 pt-7'
                    : 'px-3 py-2'
                  : isPinnedInCategory
                    ? 'pt-7'
                    : undefined,
                isPinnedInCategory && 'ring-1 ring-pinned/40 bg-pinned/4 border-pinned/30',
                selectionClass,
              ),
            }}
            icon={
              thumbnail ? (
                <CardThumbnailVisual
                  thumbnail={thumbnail}
                  title={item.title}
                  noBackdrop
                  boxClassName="flex-shrink-0 w-9 h-9 rounded-lg transition-transform duration-[--duration-base] group-hover/card:scale-105"
                  imgClassName="h-9 w-9 rounded-lg object-contain"
                  monogramClassName="text-base"
                  imgWidth={36}
                  imgHeight={36}
                />
              ) : (
                <SiteFavicon
                  title={item.title}
                  url={item.href}
                  icon={item.icon}
                  useDefaultIcon={item.useDefaultIcon}
                  className="w-full h-full object-contain rounded-lg"
                />
              )
            }
            iconWrapClassName="relative flex-shrink-0 w-7 h-7 @[280px]:w-8 @[280px]:h-8 flex items-center justify-center transition-transform duration-[--duration-base] group-hover/card:scale-105 p-0 bg-transparent dark:bg-transparent border-0 shadow-none"
            title={item.title}
            href={hasSiteDetail ? siteDetailHref : undefined}
            onTitleClick={handleDetailClick}
            titleLinkProps={{ tabIndex: -1, title: item.title, className: 'line-clamp-1 leading-snug min-w-0' }}
            titleExtra={
              healthState ? (
                <CardHealthBadge href={item.href} health={item.health} state={healthState} />
              ) : undefined
            }
            description={effectiveCardElements.showDescription ? item.description || '\u00A0' : undefined}
            decorations={
              <>
                {isPinnedInCategory && effectiveCardElements.showPinnedBadge && (
                  <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-pinned/15 text-pinned-foreground border border-pinned/30 font-medium">
                    <Pin className="w-2.5 h-2.5 fill-pinned" />
                    <span>已置顶</span>
                  </div>
                )}

                {/* 键盘聚焦可见提示（P1-19）：主链接聚焦时显式给出快捷键，复用 Space 徽章样式；
                    仅主链接聚焦时显示（peer-focus-visible，peer 由 overlayProps 传给覆盖层锚点），
                    按 → 进操作区后自动隐去、不遮按钮。 */}
                {effectiveCardElements.showQuickLookBadge && (
                  <div className="absolute top-2 right-2 z-20 pointer-events-none opacity-0 peer-focus-visible:opacity-100 sm:group-hover/card:opacity-0 transition-opacity duration-[--duration-fast]">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-medium bg-primary text-primary-foreground rounded-sm shadow-xs">
                      <span>Space 速览</span>
                      <span aria-hidden="true">·</span>
                      <span>→ 操作</span>
                    </span>
                  </div>
                )}

                {/* 数字快捷键角标（卡片悬浮修复 2026-11-20）：星标改为常驻后，
                    角标不能再与星标同位（top-2 right-2）——会被星标盖住；
                    改放星标左侧（right-11）。
                    默认显示，Tab 聚焦时隐去让位给 Space 徽章，悬停/聚焦时隐去。
                    digit 为空时组件自身返回 null；sm 以下隐藏。 */}
                <NumberDialBadge
                  digit={dialDigit}
                  className="top-2 right-11 transition-opacity duration-[--duration-fast] pointer-fine:group-hover/card:opacity-0 pointer-fine:group-focus-within/card:opacity-0"
                />
              </>
            }
            meta={
              <>
                {/* 徽标、指标与深链行：自适应折叠，绝不挤压主标题（原样保留） */}
                {effectiveCardElements.showPinnedBadge && (item.liveMetrics?.githubStars || topAlternative || (item.actions && item.actions.length > 0)) && (
                  <div className="flex items-center gap-1.5 pt-1.5 flex-wrap">
                    {item.liveMetrics?.githubStars && (
                      <span className="inline-flex items-center gap-0.5 text-xs font-mono font-medium text-pinned-foreground bg-pinned/10 border border-pinned/20 px-1.5 py-0.5 rounded-full shrink-0">
                        <Star className="w-2.5 h-2.5 text-pinned fill-pinned" />
                        {(item.liveMetrics.githubStars / 1000).toFixed(0)}k
                      </span>
                    )}
                    {topAlternative && (
                      <button
                        type="button"
                        data-card-action
                        tabIndex={-1}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          onPeek?.(item)
                        }}
                        aria-label={`查看平替：${topAlternative.targetTitle}`}
                        className="pointer-events-auto inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-category/10 text-category-foreground font-medium hover:bg-category/20 border border-category/20 transition-colors cursor-pointer shrink-0"
                      >
                        <span>平替: {topAlternative.targetTitle}</span>
                      </button>
                    )}
                    {item.actions && item.actions.length > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-pinned-foreground font-medium bg-pinned/10 border border-pinned/20 px-1.5 py-0.5 rounded-full shrink-0">
                        <Zap className="w-2.5 h-2.5" />
                        <span>深链</span>
                      </span>
                    )}
                  </div>
                )}

                {/* 标签栏（原样保留；原 mt-auto 锁底改由 SiteCard 统一排布接管） */}
                {effectiveCardElements.showTags && (
                  <div className="pt-2.5 flex items-center gap-1 flex-wrap min-h-[1.75rem]">
                    {item.tags?.slice(0, 2).map((tag) => (
                      <Link
                        key={tag}
                        href={'/tags/' + encodeURIComponent(tagSlug(tag))}
                        onClick={handleTagClick}
                        tabIndex={-1}
                        data-card-action
                        className="pointer-events-auto inline-flex items-center text-[10px] px-1.5 py-0.2 rounded-full bg-muted/70 text-muted-foreground font-mono hover:bg-primary/10 hover:text-primary transition-colors"
                      >
                        #{tag}
                      </Link>
                    ))}
                  </div>
                )}
              </>
            }
            actionBar={
              isEditingLayout ? undefined : (
              <div
                className="nav-card-actionbar flex items-center gap-0.5 px-1.5 pt-1.5 pb-1 bg-card/95 dark:bg-card/90 backdrop-blur-md before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-border before:to-transparent transition-opacity duration-[--duration-fast] pointer-events-none opacity-0 group-hover/card:opacity-100 group-hover/card:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto"
              >
                <span className="flex flex-1 items-center gap-0.5">
                {renderDragControls('h-11 w-11 rounded-lg')}
                <Button
                  type="button"
                  tabIndex={-1}
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-11 min-w-11 flex-1 rounded-lg transition-colors",
                    isEditingLayout
                      ? "text-destructive-text hover:text-destructive-text hover:bg-destructive/15"
                      : "hidden sm:inline-flex text-muted-foreground hover:text-destructive-text hover:bg-destructive/15"
                  )}
                  title="🙈 隐藏此站点（移入回收站，可按 Ctrl+Z 撤销或随时还原）"
                  aria-label={`隐藏站点：${item.title}`}
                  onClick={handlePruneSite}
                >
                  <EyeOff className="w-4 h-4" />
                </Button>
                {isEditingLayout && (
                  <Button
                    type="button"
                    tabIndex={-1}
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-11 min-w-11 flex-1 rounded-lg transition-colors",
                      isSpeedDialPinned ? "text-pinned bg-pinned/15" : "text-muted-foreground hover:text-pinned"
                    )}
                    title={isSpeedDialPinned ? "从首屏速览坞取消固定" : "📌 钉入首屏速览坞"}
                    aria-label={isSpeedDialPinned ? `从速览坞取消固定：${item.title}` : `钉入速览坞：${item.title}`}
                    onClick={handleToggleSpeedDial}
                  >
                    <Zap className={cn("w-4 h-4", isSpeedDialPinned && "fill-pinned")} />
                  </Button>
                )}
                {onTogglePinInCategory && (
                  <Button
                    tabIndex={-1}
                    data-card-action=""
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-11 min-w-11 flex-1 rounded-lg transition-colors",
                      isPinnedInCategory ? "text-pinned bg-pinned/10" : "text-muted-foreground hover:text-pinned"
                    )}
                    title={isPinnedInCategory ? "取消分类内置顶" : "置顶在当前分类首位"}
                    aria-label={isPinnedInCategory ? `取消分类内置顶：${item.title}` : `置顶在当前分类首位：${item.title}`}
                    onClick={handleCategoryPin}
                  >
                    <ArrowUpToLine className={cn("w-4 h-4", isPinnedInCategory && "fill-pinned")} />
                  </Button>
                )}
                {detailAction('h-11 min-w-11 flex-1 rounded-lg')}
                <Button
                    tabIndex={-1}
                    data-card-action=""
                  variant="ghost"
                  size="icon"
                  className="h-11 min-w-11 flex-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
                  title="按空格键或点击速览详情与行动"
                  aria-label={`速览与行动：${item.title}`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onPeek?.(item)
                  }}
                >
                  <Eye className="w-4 h-4" />
                </Button>
                <Button
                    tabIndex={-1}
                    data-card-action=""
                  variant="ghost"
                  size="icon"
                  className="hidden sm:inline-flex h-11 min-w-11 flex-1 rounded-lg text-muted-foreground hover:text-success hover:bg-success/10 transition-colors"
                  title="📌 固定到模块化工作台快捷启动坞"
                  aria-label={`固定到工作台：${item.title}`}
                  onClick={handleWorkbenchPin}
                >
                  <Pin className="w-4 h-4" />
                </Button>
                <Button
                  tabIndex={-1}
                  data-card-action=""
                  variant="ghost"
                  size="icon"
                  className="hidden sm:inline-flex h-11 min-w-11 flex-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="复制网址链接"
                  aria-label={`复制链接：${item.title}`}
                  onClick={handleCopyLink}
                >
                  <Copy className="w-4 h-4" />
                </Button>
                </span>
              </div>
              )
            }
            actions={
              isEditingLayout ? (
                controller.renderEditCapsule()
              ) : (
                <FavoriteButton
                  tabIndex={-1}
                  cardAction
                  className="pointer-events-auto bg-background/85 dark:bg-background/90 backdrop-blur-md border border-border/60 shadow-xs"
                  site={{ siteId: item.id, title: item.title, href: item.href, icon: item.icon, description: item.description }}
                />
              )
            }
            actionsAlwaysVisible
          />
        </TooltipTrigger>

        {!isFeatureHidden('feat:tooltips') && (
          <TooltipContent
            side="bottom"
            align="center"
            sideOffset={8}
            className="max-w-[280px] max-h-40 overflow-y-auto text-xs sm:text-sm"
          >
            <p>{item.description || item.title}</p>
            <p className="text-xs text-muted-foreground pt-1 border-t mt-1">💡 聚焦时按 Space 空格键呼出沙箱速览与微动作</p>
          </TooltipContent>
        )}
      </Tooltip>
  )
})
