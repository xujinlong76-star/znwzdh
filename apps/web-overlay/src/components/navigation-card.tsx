'use client'

import Link from 'next/link'
import { memo, useRef, useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/registry/new-york/ui/card'
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
import { pinSiteToWorkbench } from '@/lib/modular/workbench-bridge'
import type { CardDisplayMode } from '@/lib/modular/use-home-diy'
import { useFeatureMask } from '@/lib/modular/feature-mask-store'
import { cn } from '@/lib/utils'
import { safeHref } from '@/lib/safe-url'
import { tagSlug } from '@/lib/seo/tag-slug'
import { recordOfflineVisit } from '@/lib/offline-recent'
import { getIdentity } from '@/lib/identity'
import { reportClick } from '@/lib/navhub-api'
import { copyText } from '@/lib/clipboard'
import { useExternalLinkTarget } from '@/lib/user-preferences'

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
}: {
  thumbnail: SiteThumbnail
  title: string
  boxClassName: string
  imgClassName: string
  monogramClassName: string
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
  return (
    <div
      aria-hidden="true"
      className={cn('relative flex items-center justify-center overflow-hidden select-none', boxClassName)}
      style={{ background: gradient.cssGradient }}
    >
      {!imgFailed ? (
        <img
          src={thumbnail.src}
          alt=""
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

export interface NavigationCardProps {
  item: NavigationSubItem
  siteConfig?: SiteConfig
  onPeek?: (item: NavigationSubItem) => void
  cardDisplayMode?: CardDisplayMode
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
  onMoveCard?: (direction: CardMoveDirection) => void
  /** 该卡在当前显示列表里的序号（菜单的禁用态与播报用） */
  cardIndex?: number
  /** 当前显示列表的总卡数 */
  cardTotal?: number
}

export const NavigationCard = memo(function NavigationCard({
  item,
  onPeek,
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
}: NavigationCardProps) {
  const linkTarget = useExternalLinkTarget(propLinkTarget)
  const { toast } = useToast()
  const isEditingLayout = propIsEditingLayout ?? isDraggable
  const { effectiveCardElements, isFeatureHidden, removeFeature } = useFeatureMask()
  const isCapsuleCollapsed = !effectiveCardElements.showDescription && !effectiveCardElements.showTags

  /**
   * 死链徽标已从卡片移除（2026-11-12，research #4 收敛到详情页）：
   * 卡片数据来自静态导航 JSON，从没有任何一条带巡检 health，首页也不取
   * 中枢数据，`nav-<hex>` 的导航 id 与中枢站点的 id 之间又没有可验证的
   * 对应关系——徽标在生产里永远画不出来，留着只是死 UI。死链恢复的唯一
   * 活入口在详情页：site-detail-view 直接用中枢站点的 health + createdAt，
   * 一键打开收录时刻的 Wayback 快照（见 lib 里的 Wayback 恢复工具）。
   * 若将来有了卡片可用的巡检生产者，再把徽标与判定口径从
   * git 历史里请回来，不要凭空猜一个 id 对应关系把它焊上去。
   */

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
    onMoveCard?.(direction)
    const directionLabel =
      direction === 'up' ? '上移' : direction === 'down' ? '下移' : direction === 'top' ? '移到顶部' : '移到末尾'
    const toPosition =
      direction === 'up' ? cardIndex : direction === 'down' ? cardIndex + 2 : direction === 'top' ? 1 : cardTotal
    toast({
      title: `已将「${item.title}」${directionLabel}，现在是第 ${toPosition} 个，共 ${cardTotal} 个`,
    })
  }

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
        />
      )}
    </>
  )

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

  /**
   * 多选模式下卡片点击**不导航**，只切换选中。
   * 这是「批量操作」的入口：没有它，底部的批量操作坞永远不会出现。
   */
  const handleLinkClick = (e: React.MouseEvent) => {
    if (!selectable) {
      recordOfflineVisit({ id: item.id, title: item.title, href: item.href, icon: item.icon })
      // 快照是「我能回看」，事件是「系统能学」：少了这行，sites.visit_count 永远是 0
      reportClick(item.id, getIdentity())
      return
    }
    e.preventDefault()
    e.stopPropagation()
    onToggleSelect?.(item.id)
  }

  /**
   * 标签芯片点击语义：非多选时走 Link 默认导航（去 /tags/{slug}）；
   * 多选模式下与整卡一致——不导航，只切换选中。批量操作进行中误点
   * 标签不该把用户带离当前上下文（选择态是临时的，标签页随时能回）。
   */
  const handleTagClick = (e: React.MouseEvent) => {
    if (!selectable) return
    e.preventDefault()
    e.stopPropagation()
    onToggleSelect?.(item.id)
  }

  /**
   * HTML5 DnD 已移除（DRAG-2）：原生拖拽属性在触屏上根本不触发，
   * 也没有键盘路径。拖拽改走 dnd-kit（手柄 + PointerSensor/KeyboardSensor，
   * 见本文件顶部的 renderDragControls 与 DiyDraggableCard），
   * 不拖拽的等效操作走 ⋯ 菜单。
   */

  // 提取首个平替
  const topAlternative = item.relations?.find((r) => r.relationType === 'alternative')

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

  const handleCategoryPin = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (onTogglePinInCategory) {
      onTogglePinInCategory(item.id)
      toast({
        title: isPinnedInCategory ? '已取消分类内置顶' : '📌 已在当前分类置顶',
        description: isPinnedInCategory ? `站点「${item.title}」已恢复默认排序` : `站点「${item.title}」已优先排至该分类首位`,
      })
    }
  }

  /**
   * 多选模式的视觉态：整卡可点（不再是链接）+ 主色描边；已选中再叠一层底色。
   * 放在这里而不是每处 markup，是为了三个显示模式（紧凑 / 标准 / 丰富）完全一致。
   */
  const selectionClass = !selectable
    ? ''
    : cn(
        'cursor-pointer ring-2 ring-primary/25 hover:ring-primary/45',
        selected && 'ring-primary/70 border-primary/60 bg-primary/5',
      )

  /**
   * 合成站点（自定义站点）没有对应的中枢站点记录，`/site/{id}` 会 404 ——
   * 这类卡片只保留外链，不渲染详情内链。
   */
  const hasSiteDetail = !item.id.startsWith('custom_site_')
  const siteDetailHref = `/site/${encodeURIComponent(item.id)}`

  /**
   * 视觉缩略图（P1 #9）：只取既有图标管线的真实图片（品牌图标 / 自定义
   * icon / favicon 代理）；解析不到（非 http(s) 链接、显式默认图标）时
   * 为 null，各形态回落到现有的图标渲染。
   */
  const thumbnail = resolveSiteThumbnail(item)

  /** 标题/详情与整卡同语义：多选时不导航，只切换选中 */
  const handleDetailClick = (e: React.MouseEvent) => {
    if (!selectable) return
    e.preventDefault()
    e.stopPropagation()
    onToggleSelect?.(item.id)
  }

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

  // 1. 紧凑单行条形多态 (Compact Bar Mode)
  if (cardDisplayMode === 'compact') {
    return (
      <Tooltip>
          <TooltipTrigger asChild>
            <div
              data-navhub-site-id={item.id}
              data-navhub-selected={selected ? 'true' : undefined}
              className={cn(
                "nav-card-deferred group/card relative flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border/70 hover:border-primary/40 bg-card/85 dark:bg-card/45 backdrop-blur-xs depth-card hover:shadow-xs transition-all duration-150 transform hover:-translate-y-0.25 focus:outline-none focus:ring-1.5 focus:ring-primary/40",
                isPinnedInCategory && "ring-1 ring-amber-500/40 bg-amber-500/4 border-amber-500/30",
                selectionClass
              )}
            >
              {/* 外链覆盖层：唯一 Tab 停留点（Enter 打开站点 / Space 速览 / → 进操作区） */}
              <a
                href={safeHref(item.href)}
                target={linkTarget}
                rel={externalRel}
                data-prefetch-target="true"
                onClick={handleLinkClick}
                ref={linkRef}
                onKeyDown={handleKeyDown}
                aria-keyshortcuts="Space ArrowRight"
                aria-describedby={keyboardHintId}
                aria-label={selectable ? `选择站点：${item.title}` : `访问 ${item.title}`}
                draggable={false}
                className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
              >
                <span className="sr-only">{`访问 ${item.title}`}</span>
              </a>

              <div className="relative z-10 pointer-events-none flex items-center gap-2 min-w-0 flex-1">
                <div className="flex-shrink-0 w-6 h-6 rounded-md p-0.5 bg-muted/50 dark:bg-muted/20 border border-border/40 flex items-center justify-center transition-transform duration-150 group-hover/card:scale-105">
                  <SiteFavicon
                    title={item.title}
                    url={item.href}
                    icon={item.icon}
                    useDefaultIcon={item.useDefaultIcon}
                    className="w-full h-full object-contain rounded-xs"
                  />
                </div>
                <div className="min-w-0 flex-1 flex items-center gap-1.5">
                  {hasSiteDetail ? (
                    <Link
                      href={siteDetailHref}
                      onClick={handleDetailClick}
                      tabIndex={-1}
                      title={item.title}
                      className="pointer-events-auto truncate rounded text-xs sm:text-sm font-semibold tracking-tight text-foreground group-hover/card:text-primary hover:underline underline-offset-4 transition-colors focus-visible:outline-none min-w-0 flex-1"
                    >
                      {item.title}
                    </Link>
                  ) : (
                    <span title={item.title} className="truncate text-xs sm:text-sm font-semibold tracking-tight text-foreground group-hover/card:text-primary transition-colors min-w-0 flex-1">
                      {item.title}
                    </span>
                  )}
                  {isPinnedInCategory && (
                    <Pin className="w-2.5 h-2.5 text-amber-500 fill-amber-500 shrink-0" />
                  )}
                  {item.liveMetrics?.githubStars && (
                    <span className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-mono font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 px-1 py-0.2 rounded">
                      <Star className="w-2 h-2 text-amber-500 fill-amber-500" />
                      {(item.liveMetrics.githubStars / 1000).toFixed(0)}k
                    </span>
                  )}
                </div>
              </div>

              {/* 紧凑操作按钮：收藏星常显（留存钩子），其余操作仍悬停/聚焦/触屏才显 */}
              <div className="relative z-20 flex items-center gap-0.5" onKeyDown={handleActionsKeyDown}>
                <span className={cn(
                  "flex items-center gap-0.5 transition-opacity",
                  isEditingLayout ? "opacity-100 pointer-events-auto" : "pointer-events-none opacity-0 sm:group-hover/card:opacity-100 sm:group-hover/card:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto"
                )}>
                {renderDragControls('h-6 w-6 rounded-md')}
                <Button
                  type="button"
                  tabIndex={-1}
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-6 w-6 rounded-md transition-colors",
                    isEditingLayout
                      ? "text-rose-500 hover:text-rose-600 hover:bg-rose-500/15"
                      : "hidden sm:inline-flex text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
                  )}
                  title="🙈 隐藏此站点（移入回收站，可按 Ctrl+Z 撤销或随时还原）"
                  aria-label={`隐藏站点：${item.title}`}
                  onClick={handlePruneSite}
                >
                  <EyeOff className="w-3 h-3" />
                </Button>
                {isEditingLayout && (
                  <Button
                    type="button"
                    tabIndex={-1}
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-6 w-6 rounded-md transition-colors",
                      isSpeedDialPinned ? "text-amber-500 bg-amber-500/15" : "text-muted-foreground hover:text-amber-500"
                    )}
                    title={isSpeedDialPinned ? "从首屏速览坞取消固定" : "📌 钉入首屏速览坞"}
                    aria-label={isSpeedDialPinned ? `从速览坞取消固定：${item.title}` : `钉入速览坞：${item.title}`}
                    onClick={handleToggleSpeedDial}
                  >
                    <Zap className={cn("w-3 h-3", isSpeedDialPinned && "fill-amber-500")} />
                  </Button>
                )}
                {onTogglePinInCategory && (
                  <Button
                  tabIndex={-1}
                  data-card-action=""
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-6 w-6 rounded-md",
                      isPinnedInCategory ? "text-amber-500 bg-amber-500/10" : "text-muted-foreground hover:text-amber-500"
                    )}
                    title={isPinnedInCategory ? "取消分类内置顶" : "置顶在当前分类首位"}
                    aria-label={isPinnedInCategory ? `取消分类内置顶：${item.title}` : `置顶在当前分类首位：${item.title}`}
                    onClick={handleCategoryPin}
                  >
                    <ArrowUpToLine className={cn("w-3 h-3", isPinnedInCategory && "fill-amber-500")} />
                  </Button>
                )}
                {detailAction('h-6 w-6 rounded-md')}
                <Button
                  tabIndex={-1}
                  data-card-action=""
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
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
                  className="hidden sm:inline-flex h-6 w-6 rounded-md text-muted-foreground hover:text-emerald-500"
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
                  className="hidden sm:inline-flex h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="复制网址链接"
                  aria-label={`复制链接：${item.title}`}
                  onClick={handleCopyLink}
                >
                  <Copy className="w-3 h-3" />
                </Button>
                </span>
                <FavoriteButton
                  tabIndex={-1}
                  cardAction
                  site={{ siteId: item.id, title: item.title, href: item.href, icon: item.icon, description: item.description }}
                />
              </div>
            </div>
          </TooltipTrigger>
          {!isFeatureHidden('feat:tooltips') && (
            <TooltipContent side="bottom" align="center" className="max-w-[280px] text-xs">
              <p>{item.description || item.title}</p>
              <p className="text-[10px] text-muted-foreground pt-1 border-t mt-1">按 Space 空格键沙箱速览</p>
            </TooltipContent>
          )}
        </Tooltip>
    )
  }

  // 2. 深度丰富卡片多态 (Rich / Detailed Mode)
  if (cardDisplayMode === 'rich') {
    return (
      <Tooltip>
          <TooltipTrigger asChild>
            <Card
              data-navhub-site-id={item.id}
              data-navhub-selected={selected ? 'true' : undefined}
              className={cn(
                "nav-card-deferred group/card @container relative flex flex-col h-full overflow-hidden rounded-xl border border-border/80 hover:border-primary/50 bg-card/90 dark:bg-card/50 backdrop-blur-xs depth-card hover:shadow-lg dark:hover:shadow-primary/10 nav-card-glow transition-all duration-200 transform hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-primary/40 before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-primary/40 before:via-accent/60 before:to-primary/30",
                isPinnedInCategory && "ring-1 ring-amber-500/40 bg-amber-500/4 border-amber-500/30",
                selectionClass
              )}
            >
              {isPinnedInCategory && effectiveCardElements.showPinnedBadge && (
                <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 font-medium">
                  <Pin className="w-2.5 h-2.5 fill-amber-500" />
                  <span>已置顶</span>
                </div>
              )}

              {/* 外链覆盖层：唯一 Tab 停留点（Enter 打开站点 / Space 速览 / → 进操作区） */}
              <a
                href={safeHref(item.href)}
                target={linkTarget}
                rel={externalRel}
                data-prefetch-target="true"
                onClick={handleLinkClick}
                ref={linkRef}
                onKeyDown={handleKeyDown}
                aria-keyshortcuts="Space ArrowRight"
                aria-describedby={keyboardHintId}
                aria-label={selectable ? `选择站点：${item.title}` : `访问 ${item.title}`}
                draggable={false}
                className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
              >
                <span className="sr-only">{`访问 ${item.title}`}</span>
              </a>

              <div className="relative z-10 pointer-events-none flex flex-col flex-1">
                {/* 视觉横幅（P1 #9）：有真实缩略图时才渲染，固定 h-28，不产生布局偏移；
                    横幅已展示同一张图，下方标题行不再重复放小图标。 */}
                {thumbnail && (
                  <CardThumbnailVisual
                    thumbnail={thumbnail}
                    title={item.title}
                    boxClassName="h-28 w-full shrink-0"
                    imgClassName="h-14 w-14 object-contain drop-shadow-sm"
                    monogramClassName="text-3xl"
                  />
                )}
                <CardHeader className="p-4 sm:p-5 flex-1">
                  <div className="flex items-start gap-3.5">
                    {!thumbnail && (
                    <div className="flex-shrink-0 w-11 h-11 rounded-xl p-2 bg-muted/60 dark:bg-muted/30 border border-border/60 flex items-center justify-center transition-transform duration-200 group-hover/card:scale-105 shadow-xs">
                      <SiteFavicon
                        title={item.title}
                        url={item.href}
                        icon={item.icon}
                        useDefaultIcon={item.useDefaultIcon}
                        className="w-full h-full object-contain rounded-sm"
                      />
                    </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1.5 min-w-0 transition-all duration-150 ">
                        <CardTitle className="text-sm sm:text-base font-bold tracking-tight text-foreground group-hover/card:text-primary transition-colors min-w-0 flex-1">
                          {hasSiteDetail ? (
                            <Link
                              href={siteDetailHref}
                              onClick={handleDetailClick}
                              tabIndex={-1}
                              title={item.title} className="pointer-events-auto block text-foreground group-hover/card:text-primary hover:underline underline-offset-4 focus-visible:outline-none min-w-0 line-clamp-1 truncate leading-snug"
                            >
                              {item.title}
                            </Link>
                          ) : (
                            <span title={item.title} className="block text-foreground group-hover/card:text-primary min-w-0 line-clamp-1 truncate leading-snug">{item.title}</span>
                          )}
                        </CardTitle>
                      </div>

                      {effectiveCardElements.showDescription && (
                        <CardDescription className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mt-1.5 break-words min-h-[2.5rem]">
                          {item.description || '\u00A0'}
                        </CardDescription>
                      )}

                      {/* 徽标与指标：自适应流动折叠，绝不挤压主标题 */}
                      {effectiveCardElements.showPinnedBadge && (item.liveMetrics?.githubStars) && (
                        <div className="flex items-center gap-1.5 pt-1.5 flex-wrap">
                          {item.liveMetrics?.githubStars && (
                            <span className="inline-flex items-center gap-0.5 text-xs font-mono font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full shrink-0">
                              <Star className="w-2.5 h-2.5 text-amber-500 fill-amber-500" />
                              {(item.liveMetrics.githubStars / 1000).toFixed(0)}k
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardHeader>

                {/* 丰富标签池：mt-auto 锁定底部基线 */}
                {effectiveCardElements.showTags && (
                <div className="relative z-10 pointer-events-none flex items-center gap-1.5 px-4 sm:px-5 pb-4 sm:pb-5 flex-wrap min-h-[2rem] mt-auto">
                {item.tags?.slice(0, 3).map((tag) => (
                  <Link
                    key={tag}
                    href={'/tags/' + encodeURIComponent(tagSlug(tag))}
                    onClick={handleTagClick}
                    tabIndex={-1}
                    className="pointer-events-auto inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-muted/70 text-muted-foreground font-mono hover:bg-primary/10 hover:text-primary transition-colors min-h-6"
                  >
                    #{tag}
                  </Link>
                ))}
                {topAlternative && effectiveCardElements.showPinnedBadge && (
                  <span
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onPeek?.(item)
                    }}
                    className="pointer-events-auto inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 font-medium hover:bg-indigo-500/20 border border-indigo-500/20 transition-colors cursor-pointer"
                  >
                    <span>平替: {topAlternative.targetTitle}</span>
                  </span>
                )}
                {item.actions && item.actions.length > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 dark:text-amber-400 font-medium bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                    <Zap className="w-2.5 h-2.5" />
                    <span>深链</span>
                  </span>
                )}
              </div>
                )}
              </div>

              {/* 操作区：右上角悬浮药丸胶囊；收藏星常显（留存钩子），其余操作仍悬停/聚焦/触屏才显 */}
              <div className="absolute top-2 right-2 z-20 flex items-center gap-0.5" onKeyDown={handleActionsKeyDown}>
                <span className={cn(
                  "flex items-center gap-0.5 p-0.5 rounded-full bg-background/90 dark:bg-background/95 backdrop-blur-md border border-border/70 shadow-xs transition-all duration-150",
                  isEditingLayout ? "opacity-100 pointer-events-auto" : "pointer-events-none opacity-0 sm:group-hover/card:opacity-100 sm:group-hover/card:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto"
                )}>
                {renderDragControls('h-7 w-7 rounded-full')}
                <Button
                  type="button"
                  tabIndex={-1}
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-7 w-7 rounded-full transition-colors",
                    isEditingLayout
                      ? "text-rose-500 hover:text-rose-600 hover:bg-rose-500/15"
                      : "hidden sm:inline-flex text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
                  )}
                  title="🙈 隐藏此站点（移入回收站，可按 Ctrl+Z 撤销或随时还原）"
                  aria-label={`隐藏站点：${item.title}`}
                  onClick={handlePruneSite}
                >
                  <EyeOff className="w-3.5 h-3.5" />
                </Button>
                {isEditingLayout && (
                  <Button
                    type="button"
                    tabIndex={-1}
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-7 w-7 rounded-full transition-colors",
                      isSpeedDialPinned ? "text-amber-500 bg-amber-500/15" : "text-muted-foreground hover:text-amber-500"
                    )}
                    title={isSpeedDialPinned ? "从首屏速览坞取消固定" : "📌 钉入首屏速览坞"}
                    aria-label={isSpeedDialPinned ? `从速览坞取消固定：${item.title}` : `钉入速览坞：${item.title}`}
                    onClick={handleToggleSpeedDial}
                  >
                    <Zap className={cn("w-3.5 h-3.5", isSpeedDialPinned && "fill-amber-500")} />
                  </Button>
                )}
                {onTogglePinInCategory && (
                  <Button
                  tabIndex={-1}
                  data-card-action=""
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-7 w-7 rounded-full transition-colors",
                      isPinnedInCategory ? "text-amber-500 bg-amber-500/10" : "text-muted-foreground hover:text-amber-500"
                    )}
                    title={isPinnedInCategory ? "取消分类内置顶" : "置顶在当前分类首位"}
                    aria-label={isPinnedInCategory ? `取消分类内置顶：${item.title}` : `置顶在当前分类首位：${item.title}`}
                    onClick={handleCategoryPin}
                  >
                    <ArrowUpToLine className={cn("w-3.5 h-3.5", isPinnedInCategory && "fill-amber-500")} />
                  </Button>
                )}
                {detailAction('h-7 w-7 rounded-full')}
                <Button
                  tabIndex={-1}
                  data-card-action=""
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent"
                  title="速览与行动"
                  aria-label={`速览与行动：${item.title}`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onPeek?.(item)
                  }}
                >
                  <Eye className="w-3.5 h-3.5" />
                </Button>
                <Button
                  tabIndex={-1}
                  data-card-action=""
                  variant="ghost"
                  size="icon"
                  className="hidden sm:inline-flex h-7 w-7 rounded-full text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                  title="📌 固定到工作台"
                  aria-label={`固定到工作台：${item.title}`}
                  onClick={handleWorkbenchPin}
                >
                  <Pin className="w-3.5 h-3.5" />
                </Button>
                <Button
                  tabIndex={-1}
                  data-card-action=""
                  variant="ghost"
                  size="icon"
                  className="hidden sm:inline-flex h-7 w-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="复制网址链接"
                  aria-label={`复制链接：${item.title}`}
                  onClick={handleCopyLink}
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
                </span>
                <FavoriteButton
                  tabIndex={-1}
                  cardAction
                  className="bg-background/90 dark:bg-background/95 backdrop-blur-md border border-border/70 shadow-xs"
                  site={{ siteId: item.id, title: item.title, href: item.href, icon: item.icon, description: item.description }}
                />
              </div>
            </Card>
          </TooltipTrigger>
          {!isFeatureHidden('feat:tooltips') && (
            <TooltipContent side="bottom" align="center" className="max-w-[280px] text-xs">
              <p>{item.description || item.title}</p>
              <p className="text-[10px] text-muted-foreground pt-1 border-t mt-1">💡 按 Space 空格键呼出沙箱速览与微动作</p>
            </TooltipContent>
          )}
        </Tooltip>
    )
  }

  // 3. 标准现代卡片 (Standard Mode - 默认)
  return (
    <Tooltip>
        <TooltipTrigger asChild>
          <Card
            data-navhub-site-id={item.id}
            data-navhub-selected={selected ? 'true' : undefined}
            className={cn(
              "nav-card-deferred group/card @container relative flex flex-col h-full overflow-hidden rounded-xl border border-border/70 hover:border-primary/40 bg-card/85 dark:bg-card/45 backdrop-blur-xs depth-card hover:shadow-md dark:hover:shadow-primary/5 nav-card-glow transition-all duration-200 transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-primary/40",
              isPinnedInCategory && "ring-1 ring-amber-500/40 bg-amber-500/4 border-amber-500/30",
              selectionClass
            )}
          >
            {isPinnedInCategory && effectiveCardElements.showPinnedBadge && (
              <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 font-medium">
                <Pin className="w-2.5 h-2.5 fill-amber-500" />
                <span>已置顶</span>
              </div>
            )}

            {/* 外链覆盖层：唯一 Tab 停留点（Enter 打开站点 / Space 速览 / → 进操作区） */}
            <a
              href={safeHref(item.href)}
              target={linkTarget}
              rel={externalRel}
              data-prefetch-target="true"
              onClick={handleLinkClick}
              ref={linkRef}
              onKeyDown={handleKeyDown}
              aria-keyshortcuts="Space ArrowRight"
              aria-describedby={keyboardHintId}
              aria-label={selectable ? `选择站点：${item.title}` : `访问 ${item.title}`}
              draggable={false}
              className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
            >
              <span className="sr-only">{`访问 ${item.title}`}</span>
            </a>

            {/* 键盘聚焦显式快捷键角标 */}
            {effectiveCardElements.showQuickLookBadge && (
              <div className="absolute top-2 right-2 z-20 pointer-events-none opacity-0 group-focus-visible/card:opacity-100 sm:group-hover/card:opacity-0 transition-opacity duration-150">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-medium bg-primary text-primary-foreground rounded shadow-xs">
                  <span>Space</span>
                  <span>速览</span>
                </span>
              </div>
            )}

            <div className={cn(
              "relative z-10 pointer-events-none flex flex-col flex-1",
              isCapsuleCollapsed ? "px-3 py-2" : "p-[var(--density-card-padding,0.875rem)]"
            )}>
              {/* Header 层：图标与标题同行，释放左侧死区 */}
              <div className="flex items-center gap-2.5 min-w-0 pr-14">
                {/* 视觉大图标（P1 #9）：有真实缩略图时把 28px 小图标换成 48px
                    视觉 tile；无缩略图时保持现有渲染不变。盒子尺寸固定，
                    图片懒加载、失败回落首字母徽标，不产生布局偏移。 */}
                {thumbnail ? (
                  <CardThumbnailVisual
                    thumbnail={thumbnail}
                    title={item.title}
                    boxClassName="flex-shrink-0 w-12 h-12 rounded-xl shadow-xs transition-transform duration-200 group-hover/card:scale-105"
                    imgClassName="h-9 w-9 object-contain"
                    monogramClassName="text-lg"
                  />
                ) : (
                <div className="flex-shrink-0 w-7 h-7 @[280px]:w-8 @[280px]:h-8 rounded-lg p-1 bg-muted/50 dark:bg-muted/20 border border-border/50 flex items-center justify-center transition-transform duration-200 group-hover/card:scale-105 shadow-xs">
                  <SiteFavicon
                    title={item.title}
                    url={item.href}
                    icon={item.icon}
                    useDefaultIcon={item.useDefaultIcon}
                    className="w-full h-full object-contain rounded-xs"
                  />
                </div>
                )}
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-sm font-semibold tracking-tight text-foreground group-hover/card:text-primary transition-colors min-w-0 flex-1">
                    {hasSiteDetail ? (
                      <Link
                        href={siteDetailHref}
                        onClick={handleDetailClick}
                        tabIndex={-1}
                        title={item.title} className="pointer-events-auto block text-foreground group-hover/card:text-primary hover:underline underline-offset-4 focus-visible:outline-none min-w-0 line-clamp-1 truncate leading-snug"
                      >
                        {item.title}
                      </Link>
                    ) : (
                      <span title={item.title} className="block text-foreground group-hover/card:text-primary min-w-0 line-clamp-1 truncate leading-snug">{item.title}</span>
                    )}
                  </CardTitle>
                </div>
              </div>

              {/* Body 层：描述文字全宽流动（与图标左边缘对齐，横向宽度扩充） */}
              {effectiveCardElements.showDescription && (
                <CardDescription className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mt-2.5 break-words min-h-[2.5rem] flex-1">
                  {item.description || '\u00A0'}
                </CardDescription>
              )}

              {/* 徽标、指标与深链行：自适应折叠，绝不挤压主标题 */}
              {effectiveCardElements.showPinnedBadge && (item.liveMetrics?.githubStars || topAlternative || (item.actions && item.actions.length > 0)) && (
                <div className="flex items-center gap-1.5 pt-1.5 flex-wrap">
                  {item.liveMetrics?.githubStars && (
                    <span className="inline-flex items-center gap-0.5 text-xs font-mono font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full shrink-0">
                      <Star className="w-2.5 h-2.5 text-amber-500 fill-amber-500" />
                      {(item.liveMetrics.githubStars / 1000).toFixed(0)}k
                    </span>
                  )}
                  {topAlternative && (
                    <span
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onPeek?.(item)
                      }}
                      className="pointer-events-auto inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 font-medium hover:bg-indigo-500/20 border border-indigo-500/20 transition-colors cursor-pointer shrink-0"
                    >
                      <span>平替: {topAlternative.targetTitle}</span>
                    </span>
                  )}
                  {item.actions && item.actions.length > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-xs text-amber-700 dark:text-amber-400 font-medium bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full shrink-0">
                      <Zap className="w-2.5 h-2.5" />
                      <span>深链</span>
                    </span>
                  )}
                </div>
              )}

              {/* 标签栏：mt-auto 强制锁定卡片底部基线，同行标签严丝合缝对齐 */}
              {effectiveCardElements.showTags && (
                <div className="mt-auto pt-2.5 flex items-center gap-1 flex-wrap min-h-[1.75rem]">
                  {item.tags?.slice(0, 3).map((tag) => (
                    <Link
                      key={tag}
                      href={'/tags/' + encodeURIComponent(tagSlug(tag))}
                      onClick={handleTagClick}
                      tabIndex={-1}
                      className="pointer-events-auto inline-flex items-center text-[10px] px-1.5 py-0.2 rounded bg-muted/70 text-muted-foreground font-mono hover:bg-primary/10 hover:text-primary transition-colors"
                    >
                      #{tag}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* 操作区：右上角悬浮药丸胶囊；收藏星常显（留存钩子），其余操作仍悬停/聚焦/触屏才显 */}
            <div className="absolute top-1.5 right-1.5 z-20 @[280px]:top-2 @[280px]:right-2 flex items-center gap-0.5" onKeyDown={handleActionsKeyDown}>
              <span className={cn(
                "flex items-center gap-0.5 p-0.5 rounded-full bg-background/85 dark:bg-background/90 backdrop-blur-md border border-border/60 shadow-xs transition-all duration-150",
                isEditingLayout ? "opacity-100 pointer-events-auto" : "pointer-events-none opacity-0 sm:group-hover/card:opacity-100 sm:group-hover/card:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto"
              )}>
              {renderDragControls('h-6.5 w-6.5 rounded-full')}
              <Button
                type="button"
                tabIndex={-1}
                variant="ghost"
                size="icon"
                className={cn(
                  "h-6.5 w-6.5 rounded-full transition-colors",
                  isEditingLayout
                    ? "text-rose-500 hover:text-rose-600 hover:bg-rose-500/15"
                    : "hidden sm:inline-flex text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
                )}
                title="🙈 隐藏此站点（移入回收站，可按 Ctrl+Z 撤销或随时还原）"
                aria-label={`隐藏站点：${item.title}`}
                onClick={handlePruneSite}
              >
                <EyeOff className="w-3.5 h-3.5" />
              </Button>
              {isEditingLayout && (
                <Button
                  type="button"
                  tabIndex={-1}
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-6.5 w-6.5 rounded-full transition-colors",
                    isSpeedDialPinned ? "text-amber-500 bg-amber-500/15" : "text-muted-foreground hover:text-amber-500"
                  )}
                  title={isSpeedDialPinned ? "从首屏速览坞取消固定" : "📌 钉入首屏速览坞"}
                  aria-label={isSpeedDialPinned ? `从速览坞取消固定：${item.title}` : `钉入速览坞：${item.title}`}
                  onClick={handleToggleSpeedDial}
                >
                  <Zap className={cn("w-3.5 h-3.5", isSpeedDialPinned && "fill-amber-500")} />
                </Button>
              )}
              {onTogglePinInCategory && (
                <Button
                  tabIndex={-1}
                  data-card-action=""
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-6.5 w-6.5 rounded-full transition-colors",
                    isPinnedInCategory ? "text-amber-500 bg-amber-500/10" : "text-muted-foreground hover:text-amber-500"
                  )}
                  title={isPinnedInCategory ? "取消分类内置顶" : "置顶在当前分类首位"}
                  aria-label={isPinnedInCategory ? `取消分类内置顶：${item.title}` : `置顶在当前分类首位：${item.title}`}
                  onClick={handleCategoryPin}
                >
                  <ArrowUpToLine className={cn("w-3.5 h-3.5", isPinnedInCategory && "fill-amber-500")} />
                </Button>
              )}
              {detailAction('h-6.5 w-6.5 rounded-full')}
              <Button
                  tabIndex={-1}
                  data-card-action=""
                variant="ghost"
                size="icon"
                className="h-6.5 w-6.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent"
                title="按空格键或点击速览详情与行动"
                aria-label={`速览与行动：${item.title}`}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onPeek?.(item)
                }}
              >
                <Eye className="w-3.5 h-3.5" />
              </Button>
              <Button
                  tabIndex={-1}
                  data-card-action=""
                variant="ghost"
                size="icon"
                className="hidden sm:inline-flex h-6.5 w-6.5 rounded-full text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                title="📌 固定到模块化工作台快捷启动坞"
                aria-label={`固定到工作台：${item.title}`}
                onClick={handleWorkbenchPin}
              >
                <Pin className="w-3.5 h-3.5" />
              </Button>
              <Button
                tabIndex={-1}
                data-card-action=""
                variant="ghost"
                size="icon"
                className="hidden sm:inline-flex h-6.5 w-6.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="复制网址链接"
                aria-label={`复制链接：${item.title}`}
                onClick={handleCopyLink}
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
              </span>
              <FavoriteButton
                tabIndex={-1}
                cardAction
                className="bg-background/85 dark:bg-background/90 backdrop-blur-md border border-border/60 shadow-xs"
                site={{ siteId: item.id, title: item.title, href: item.href, icon: item.icon, description: item.description }}
              />
            </div>
          </Card>
        </TooltipTrigger>

        {!isFeatureHidden('feat:tooltips') && (
          <TooltipContent 
            side="bottom" 
            align="center"
            sideOffset={8}
            className="max-w-[280px] text-xs sm:text-sm"
          >
            <p>{item.description || item.title}</p>
            <p className="text-xs text-muted-foreground pt-1 border-t mt-1">💡 聚焦时按 Space 空格键呼出沙箱速览与微动作</p>
          </TooltipContent>
        )}
      </Tooltip>
  )
})
