'use client'

import Link from 'next/link'
import { useRef, type ReactNode, type RefObject } from 'react'
import { GripVertical, Info } from 'lucide-react'
import type { NavigationSubItem } from '@/types/navigation'
import { resolveSiteThumbnail, type SiteThumbnail } from '@/lib/site-thumbnails'
import {
  extractDisplayHostname,
  VIEW_MODE_REGISTRY,
  type CanonicalCardDisplayMode,
  type ViewModeDiyHandleStyle,
} from '@/lib/modular/card-display-modes'
import { DIY_DRAG_INSTRUCTIONS_ID, type CardMoveDirection } from '@/lib/modular/diy-drag'
import { useDiyDragActive, useDiyDragHandleRef } from '@/components/diy/diy-drag-context'
import { DiyCardMenu } from '@/components/diy/diy-card-menu'
import { useFeatureMask } from '@/lib/modular/feature-mask-store'
import { useToast } from '@/components/ui/use-toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/registry/new-york/ui/button'
import { pinSiteToWorkbench } from '@/lib/modular/workbench-bridge'
import { useExternalLinkTarget } from '@/lib/user-preferences'
import { resolveBatchKeyboardAction } from '@/lib/batch-keyboard'
import {
  isAnyDialogOpen,
  isAnyMenuOpen,
  isDragHandleFocused,
  isEventTargetTyping,
} from '@/lib/keyboard-guards'
import { recordOfflineVisit } from '@/lib/offline-recent'
import { getIdentity } from '@/lib/identity'
import { reportClick } from '@/lib/navhub-api'
import { copyText } from '@/lib/clipboard'
import { safeHref } from '@/lib/safe-url'
import { cn } from '@/lib/utils'

export interface UseSiteItemControllerParams {
  item: NavigationSubItem
  onPeek?: (item: NavigationSubItem) => void
  isPinnedInCategory?: boolean
  onTogglePinInCategory?: (siteId: string) => void
  isDraggable?: boolean
  sourceCategoryId?: string
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (siteId: string) => void
  keyboardHintId?: string
  isEditingLayout?: boolean
  isSpeedDialPinned?: boolean
  onToggleSpeedDialPin?: (siteId: string) => void
  linkTarget?: '_blank' | '_self'
  externalRel?: string
  onMoveCard?: (cardId: string, direction: CardMoveDirection) => void
  cardIndex?: number
  cardTotal?: number
  dialDigit?: number
  quickDialDigit?: string
  siteTitleById?: ReadonlyMap<string, string>
}

export interface SiteItemController {
  item: NavigationSubItem
  hostname: string
  thumbnail: SiteThumbnail | null
  topAlternative: NonNullable<NavigationSubItem['relations']>[number] | undefined
  linkTarget: '_blank' | '_self'
  externalRel: string
  linkRef: RefObject<HTMLAnchorElement | null>
  selectable: boolean
  selected: boolean
  selectionClass: string
  isPinnedInCategory: boolean
  isEditingLayout: boolean
  isSpeedDialPinned: boolean
  hasSiteDetail: boolean
  siteDetailHref: string
  dialDigit?: number
  dialKeyshortcuts: string
  keyboardHintId?: string
  showDragHandle: boolean
  dragHandleRef: ReturnType<typeof useDiyDragHandleRef>
  keyboardDragActive: boolean
  effectiveCardElements: ReturnType<typeof useFeatureMask>['effectiveCardElements']
  tooltipsHidden: boolean
  handleLinkClick: (e: React.MouseEvent) => void
  handleDetailClick: (e: React.MouseEvent) => void
  handleTagClick: (e: React.MouseEvent) => void
  handleKeyDown: (e: React.KeyboardEvent<HTMLAnchorElement>) => void
  handleActionsKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
  handlePruneSite: (e?: React.MouseEvent | React.KeyboardEvent) => void
  handleToggleSpeedDial: (e: React.MouseEvent) => void
  handleCategoryPin?: (e: React.MouseEvent) => void
  handleWorkbenchPin: (e: React.MouseEvent) => void
  handleCopyLink: (e?: React.MouseEvent) => Promise<void>
  handleMenuMove: (direction: CardMoveDirection) => void
  onPeek?: (item: NavigationSubItem) => void
  renderDragControls: (sizeClass: string) => ReactNode
  detailAction: (sizeClass: string) => ReactNode
}

/**
 * 7 大网址展示模式共享的无头交互控制器（Headless Controller Hook）。
 *
 * 集中承载：
 *  1. 键盘无障碍模型（整卡单一 Tab 停留点：Space 速览、→ 进操作区、←/→ 漫游、Esc 返回、Delete 隐藏）；
 *  2. 点击统计埋点与离线最近访问记录；
 *  3. 收藏/分类置顶/速览坞钉选/固定工作台/复制链接/移入回收站/多选批量切换；
 *  4. 速拨位快捷键声明（`dialKeyshortcuts`）与 DIY dnd-kit 拖拽/菜单等效替代。
 *
 * 表现层渲染器只消费本 Hook 返回的语义回调与派生状态，彻底消除 7 套模式之间的交互漂移。
 */
export function useSiteItemController({
  item,
  onPeek,
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
}: UseSiteItemControllerParams): SiteItemController {
  const linkTarget = useExternalLinkTarget(propLinkTarget)
  const { toast } = useToast()
  const isEditingLayout = propIsEditingLayout ?? isDraggable
  const { effectiveCardElements, isFeatureHidden, removeFeature } = useFeatureMask()
  const dragHandleRef = useDiyDragHandleRef()
  const showDragHandle = isDraggable && dragHandleRef !== null
  const keyboardDragActive = useDiyDragActive()
  const linkRef = useRef<HTMLAnchorElement>(null)

  const hostname = extractDisplayHostname(item.href)
  const thumbnail = resolveSiteThumbnail(item)
  const topAlternative = item.relations?.find((r) => r.relationType === 'alternative')
  const hasSiteDetail = !item.id.startsWith('custom_site_')
  const siteDetailHref = `/site/${encodeURIComponent(item.id)}`

  const dialKeyshortcuts = [
    'Space',
    'ArrowRight',
    ...(dialDigit ? [String(dialDigit)] : []),
    ...(quickDialDigit ? [`Ctrl+Shift+${quickDialDigit}`] : []),
  ].join(' ')

  const selectionClass = !selectable
    ? ''
    : cn(
        'cursor-pointer ring-2 ring-primary/25 hover:ring-primary/45',
        selected && 'ring-primary/70 border-primary/60 bg-primary/5',
      )

  const handleMenuMove = (direction: CardMoveDirection) => {
    onMoveCard?.(item.id, direction)
    const directionLabel =
      direction === 'up' ? '上移' : direction === 'down' ? '下移' : direction === 'top' ? '移到顶部' : '移到末尾'
    const toPosition =
      direction === 'up' ? cardIndex : direction === 'down' ? cardIndex + 2 : direction === 'top' ? 1 : cardTotal
    toast({
      title: `已将「${item.title}」${directionLabel}，现在是第 ${toPosition} 个，共 ${cardTotal} 个`,
    })
  }

  const handlePruneSite = (e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    removeFeature({
      id: `site:${item.id}`,
      level: 'L3_SITE',
      title: item.title,
      parentTitle: sourceCategoryId ? `所属分类 (${sourceCategoryId})` : '站点卡片',
    })
    toast({
      title: `🙈 已隐藏站点「${item.title}」`,
      description: '已移入时间轴回收站，按 Ctrl/Cmd+Z 可立即撤销，或在 DIY 恢复中心随时还原。',
    })
  }

  const handleToggleSpeedDial = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (onToggleSpeedDialPin) {
      onToggleSpeedDialPin(item.id)
      toast({
        title: isSpeedDialPinned
          ? `已从速览坞移除: ${item.title}`
          : `📌 已钉入速览坞: ${item.title}`,
      })
    }
  }

  const handleLinkClick = (e: React.MouseEvent) => {
    if (!selectable) {
      recordOfflineVisit({ id: item.id, title: item.title, href: item.href, icon: item.icon })
      reportClick(item.id, getIdentity())
      return
    }
    e.preventDefault()
    e.stopPropagation()
    onToggleSelect?.(item.id)
  }

  const handleDetailClick = (e: React.MouseEvent) => {
    if (!selectable) return
    e.preventDefault()
    e.stopPropagation()
    onToggleSelect?.(item.id)
  }

  const handleTagClick = (e: React.MouseEvent) => {
    if (!selectable) return
    e.preventDefault()
    e.stopPropagation()
    onToggleSelect?.(item.id)
  }

  const handleWorkbenchPin = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const res = pinSiteToWorkbench({
      siteId: item.id,
      title: item.title,
      href: item.href,
      icon: item.icon,
      description: item.description,
    })
    toast({
      title: res.ok ? '📌 已固定到工作台' : '固定提示',
      description: res.message,
    })
  }

  const handleCategoryPin = onTogglePinInCategory
    ? (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        onTogglePinInCategory(item.id)
        toast({
          title: isPinnedInCategory ? '已取消分类内置顶' : '📌 已在当前分类置顶',
          description: isPinnedInCategory
            ? `站点「${item.title}」已恢复默认排序`
            : `站点「${item.title}」已优先排至该分类首位`,
        })
      }
    : undefined

  const handleCopyLink = async (e?: React.MouseEvent) => {
    e?.preventDefault()
    e?.stopPropagation()
    const res = await copyText(item.href)
    if (res.ok) {
      toast({
        title: '已复制网址',
        description: `「${item.title}」链接已复制到剪贴板`,
      })
    } else {
      toast({
        title: '复制失败',
        description: res.reason,
        variant: 'destructive',
      })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLAnchorElement>) => {
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
      }
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

  const handleActionsKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement | null)?.closest?.('[data-card-action]')) {
      return
    }
    if (
      keyboardDragActive &&
      (document.activeElement as HTMLElement | null)?.hasAttribute('data-diy-drag-handle')
    ) {
      return
    }
    const actions = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-card-action]'))
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
          className={cn(
            sizeClass,
            'inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
          )}
          title="拖动排序（按住拖动；键盘：聚焦后按空格开始，方向键移动，回车放下，Esc 取消）"
          aria-label={`拖动排序：${item.title}`}
          aria-describedby={DIY_DRAG_INSTRUCTIONS_ID}
        >
          <GripVertical className="h-3.5 w-3.5" />
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
          prefetch={false}
          tabIndex={-1}
          onClick={handleDetailClick}
          aria-label={`查看站点详情：${item.title}`}
        >
          <Info className="h-3.5 w-3.5" />
          <span className="sr-only">{`查看站点详情：${item.title}`}</span>
        </Link>
      </Button>
    ) : null

  return {
    item,
    hostname,
    thumbnail,
    topAlternative,
    linkTarget,
    externalRel,
    linkRef,
    selectable,
    selected,
    selectionClass,
    isPinnedInCategory,
    isEditingLayout,
    isSpeedDialPinned,
    hasSiteDetail,
    siteDetailHref,
    dialDigit,
    dialKeyshortcuts,
    keyboardHintId,
    showDragHandle,
    dragHandleRef,
    keyboardDragActive,
    effectiveCardElements,
    tooltipsHidden: isFeatureHidden('feat:tooltips'),
    handleLinkClick,
    handleDetailClick,
    handleTagClick,
    handleKeyDown,
    handleActionsKeyDown,
    handlePruneSite,
    handleToggleSpeedDial,
    handleCategoryPin,
    handleWorkbenchPin,
    handleCopyLink,
    handleMenuMove,
    onPeek,
    renderDragControls,
    detailAction,
  }
}

export interface SiteItemShellProps {
  mode: CanonicalCardDisplayMode
  controller: SiteItemController
  className?: string
  linkClassName?: string
  /** 是否包裹详情提示 Tooltip（列表/标准卡已展示简介可省略，图标/胶囊/目录开启） */
  withTooltip?: boolean
  /** 主链接聚焦时的快捷键提示浮标 */
  quickLookBadge?: ReactNode
  children: ReactNode
}

/**
 * 网址展示无头交互壳（`SiteItemShell`）。
 *
 * 统一挂载：
 * - 根容器语义属性（`data-navhub-site-id`、`data-navhub-selected`、`data-card-variant`、`data-diy-handle-style`）
 * - 操作区键盘漫游事件（`onKeyDown={controller.handleActionsKeyDown}`）
 * - 单一 Tab 停留点整卡外链覆盖层（`<a>` + `sr-only` 可读名 + 键盘事件 + 点击统计）
 * - 可选 Radix Tooltip
 */
export function SiteItemShell({
  mode,
  controller,
  className,
  linkClassName,
  withTooltip = false,
  quickLookBadge,
  children,
}: SiteItemShellProps) {
  const {
    item,
    hostname,
    linkTarget,
    externalRel,
    linkRef,
    selectable,
    selected,
    selectionClass,
    dialKeyshortcuts,
    keyboardHintId,
    tooltipsHidden,
    handleLinkClick,
    handleKeyDown,
    handleActionsKeyDown,
  } = controller

  const diyHandleStyle: ViewModeDiyHandleStyle = VIEW_MODE_REGISTRY[mode].diyCompatible.handleStyle

  const surface = (
    <div
      data-navhub-site-id={item.id}
      data-navhub-selected={selected ? 'true' : undefined}
      data-card-variant={mode}
      data-diy-handle-style={diyHandleStyle}
      className={cn(className, selectionClass)}
      onKeyDown={handleActionsKeyDown}
    >
      <a
        href={safeHref(item.href)}
        target={linkTarget}
        rel={externalRel}
        data-prefetch-target="true"
        onClick={handleLinkClick}
        ref={linkRef}
        onKeyDown={handleKeyDown}
        aria-keyshortcuts={dialKeyshortcuts}
        aria-describedby={keyboardHintId}
        aria-label={selectable ? `选择站点：${item.title}，按空格切换选中` : `访问 ${item.title}`}
        draggable={false}
        className={cn(
          'peer absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-1',
          linkClassName,
        )}
      >
        <span className="sr-only">{`访问 ${item.title}`}</span>
      </a>
      {quickLookBadge}
      {children}
    </div>
  )

  if (!withTooltip) return surface

  return (
    <Tooltip>
      <TooltipTrigger asChild>{surface}</TooltipTrigger>
      {!tooltipsHidden && (
        <TooltipContent side="bottom" align="center" className="max-w-[260px] text-xs">
          <p className="font-semibold text-foreground">{item.title}</p>
          {item.description && (
            <p className="mt-0.5 leading-relaxed text-muted-foreground">{item.description}</p>
          )}
          <p className="mt-1 border-t pt-1 font-mono text-[10px] text-muted-foreground">
            {hostname ? `${hostname} · ` : ''}按 Space 速览
          </p>
        </TooltipContent>
      )}
    </Tooltip>
  )
}

/** 共享站点标题：普通收录站可直达 `/site/{id}`，自建合成站渲染纯文本 */
export function SiteItemTitle({
  controller,
  className,
}: {
  controller: SiteItemController
  className: string
}) {
  if (controller.hasSiteDetail) {
    return (
      <Link
        href={controller.siteDetailHref}
        prefetch={false}
        onClick={controller.handleDetailClick}
        tabIndex={-1}
        title={controller.item.title}
        className={cn(
          'pointer-events-auto rounded-sm hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          className,
        )}
      >
        {controller.item.title}
      </Link>
    )
  }
  return (
    <span title={controller.item.title} className={className}>
      {controller.item.title}
    </span>
  )
}
