import type {
  AnchorHTMLAttributes,
  ClassAttributes,
  HTMLAttributes,
  MouseEvent,
  ReactNode,
} from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { safeHref } from '@/lib/safe-url'

/**
 * 站点卡片原语（2026-11-25 UI 评审 P0-1 阶段 B）：三变体共享同一套
 * 「图标区 — 标题 — 描述 — 元数据行」解剖，页面只填槽位、不再各自发明卡形。
 *
 * 变体（对应评审规格 grid / row / compact）：
 *   - `grid`    网格卡（热榜等 4–5 列栅格）：40px 图标、两行描述、悬浮操作区
 *               浮于右上角；壳配方与首页 NavigationCard 标准档对齐
 *               （nav-card-deferred / nav-card-glow / depth-card / hover 浮起），
 *               首页卡片后续迁移可直接落座。
 *   - `row`     列表行（/sites 目录 2 列行）：24px 图标、单行描述、右侧操作区。
 *   - `compact` 紧凑行（首页「紧凑单行」模式的迁移目标）：24px 图标 + 单行标题，
 *               壳与 NavigationCard compact 档同配方；当前暂无页面消费方，由
 *               site-card.test.ts 钉住渲染契约。
 *
 * 槽位设计（行为全留在调用方）：
 *   - `icon`     图标节点（SiteFavicon 等），尺寸/圆角/底由变体负责；
 *   - `href`     标题内链（站内详情），不传则标题是纯文本；
 *   - `meta`     元数据行（热度 / 标签 / 健康徽标 / 计数…）；
 *   - `actions`  操作区（外链 / 收藏 / 更多…）。
 *
 * 整卡外链覆盖层（`overlayHref`，grid / compact 双变体支持）：tag 结果页与首页
 * NavigationCard 迁移共用。覆盖层 `<a>` 与标题内链、操作钮互为兄弟节点，
 * 覆盖层附加属性（ref / 键盘 / 预取 / peer）经 `overlayProps` 透传。
 */

export type SiteCardVariant = 'grid' | 'row' | 'compact'

/** 调用方透传 data-* 属性的统一口（TS 不认 HTMLAttributes 里的任意 data-*） */
type DataAttrs = { [key: `data-${string}`]: string | number | boolean | undefined }

const SHELL: Record<'row' | 'compact', string> = {
  row: 'group relative flex items-center justify-between rounded-xl border border-border/70 p-2.5 hover:bg-muted/40 transition-colors',
  compact:
    'nav-card-deferred group relative flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border/70 hover:border-primary/40 bg-card/85 dark:bg-card/45 backdrop-blur-xs depth-card hover:shadow-[var(--depth-float)] transition-all duration-[--duration-fast] transform hover:-translate-y-0.5',
}

/** grid 壳的公共段（形态/描边/悬浮位移），面层由 surface 决定 */
const SHELL_GRID_BASE =
  'relative group @container flex flex-col justify-between rounded-xl border border-border/70 hover:border-primary/40 transition-all duration-200 transform hover:-translate-y-0.5'

/**
 * grid 面层：
 *   - `card`  默认卡片面（首页/热榜同款：nav-card-deferred 支持卡片透明度、depth-card 阴影、密度内边距）
 *   - `glass` 玻璃面（tag 结果页等专题列表：glass-surface + subtle-mesh，固定 p-4，不叠 nav-card-glow）
 */
const SHELL_GRID_SURFACE: Record<'card' | 'glass', string> = {
  card: 'bg-card/85 dark:bg-card/45 backdrop-blur-xs depth-card nav-card-glow nav-card-deferred hover:shadow-[var(--depth-float)] shadow-2xs p-[var(--density-card-padding,0.875rem)]',
  glass: 'glass-surface subtle-mesh hover:shadow-md p-4',
}

const ICON_WRAP: Record<SiteCardVariant, string> = {
  grid: 'shrink-0 w-10 h-10 rounded-lg p-1.5 bg-muted/50 dark:bg-muted/20 border border-border/50 flex items-center justify-center transition-transform duration-200 group-hover:scale-105 shadow-xs overflow-hidden',
  row: 'shrink-0 w-6 h-6 rounded-md overflow-hidden flex items-center justify-center',
  compact: 'shrink-0 w-6 h-6 rounded-md overflow-hidden flex items-center justify-center',
}

const TITLE: Record<SiteCardVariant, string> = {
  grid: 'block text-sm font-semibold tracking-tight text-foreground group-hover:text-link transition-colors truncate pr-8',
  row: 'block text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors',
  compact: 'block text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors',
}

/**
 * 整卡外链模式下的标题内链样式（tag 页原口径）：
 * 卡片主体已被 overlay <a> 接管（整卡点空白＝直达外站），标题另有自己的
 * 站内详情目的地，hover 用 primary + 下划线把它和「整卡外站」区分开。
 */
const TITLE_INNER_LINK =
  'block text-sm font-semibold tracking-tight text-foreground truncate pr-8 pointer-events-auto transition-colors hover:text-primary hover:underline underline-offset-4'

const DESC: Record<SiteCardVariant, string> = {
  grid: 'text-xs text-muted-foreground line-clamp-2 leading-relaxed mt-1',
  row: 'block text-xs text-muted-foreground truncate',
  compact: 'block text-xs text-muted-foreground truncate',
}

const LINK: Record<SiteCardVariant, string> = {
  grid: 'block min-w-0 flex-1',
  row: 'flex items-center gap-3 min-w-0 flex-1 py-0.5',
  compact: 'flex items-center gap-2 min-w-0 flex-1',
}

const ACTIONS: Record<'row' | 'compact', string> = {
  row: 'shrink-0 ml-2 flex items-center gap-1',
  // 注意：不设 relative——compact 操作簇的渐隐浮层（absolute right-7…）定位
  // 须相对卡片根（SHELL.compact 的 relative），容器一旦 relative 浮层就会错位。
  compact: 'z-10 flex items-center gap-0.5 shrink-0',
}

export function SiteCard({
  variant = 'grid',
  href,
  onTitleClick,
  title,
  description,
  icon,
  meta,
  actions,
  className,
  titleClassName,
  overlayHref,
  overlayLabel,
  overlayRel,
  overlayTarget,
  surface = 'card',
  rootProps,
  overlayProps,
  banner,
  iconWrapClassName,
  titleExtra,
  actionBar,
  actionsAlwaysVisible,
  decorations,
  titleLinkProps,
  ...rest
}: {
  variant?: SiteCardVariant
  /** 标题内链（站内详情）；不传则标题是纯文本 */
  href?: string
  onTitleClick?: (e: MouseEvent<HTMLAnchorElement>) => void
  title: string
  description?: string | null
  icon?: ReactNode
  /** 元数据行：热度 / 标签 / 健康徽标 / 计数…（样式由调用方节点自带） */
  meta?: ReactNode
  /** 操作区：外链 / 收藏 / 更多… */
  actions?: ReactNode
  className?: string
  titleClassName?: string
  /**
   * 整卡外链覆盖层（grid / compact）：铺满整卡的 `<a>`（z-0 + sr-only 文本），
   * 与标题内链、操作钮是**兄弟节点**——`<a>` 里绝不嵌 `<a>`。
   * 设置后：内容层自动 z-10 + pointer-events-none，只有标题内链可点，
   * 空白/描述/图标点击落到整卡外链上（tag 结果页的点击语义）。
   */
  overlayHref?: string
  /** 覆盖层无障碍名，默认「访问 {title} 官网」 */
  overlayLabel?: string
  /** 覆盖层 rel，如 noopener noreferrer nofollow */
  overlayRel?: string
  /** 覆盖层 target，如 _blank */
  overlayTarget?: string
  /** grid 面层：card=默认卡片面 / glass=玻璃面（tag 页等专题列表） */
  surface?: 'card' | 'glass'
  /**
   * 首页迁移槽（S0 施工单 §3，2026-11-26）：展开到壳 div 上。
   * 承载 data-navhub-site-id / data-card-variant / 根节点 onKeyDown（键盘漫游）等。
   * className 会被单独合入壳类，不会被覆盖。
   */
  rootProps?: HTMLAttributes<HTMLDivElement> & DataAttrs
  /**
   * 覆盖层锚点附加属性（在 overlayHref 之外）：ref / onClick / onKeyDown /
   * aria-keyshortcuts / aria-describedby / 动态 aria-label / data-prefetch-target /
   * peer 类 / draggable={false} 全部由调用方传，组件只补 href/target/rel/默认类。
   * className 会合入覆盖层默认类；其余属性覆盖同名默认值。
   */
  overlayProps?: ClassAttributes<HTMLAnchorElement> &
    AnchorHTMLAttributes<HTMLAnchorElement> &
    DataAttrs
  /**
   * grid 专用：rich 档的 h-28 缩略图横幅。插在覆盖层之后、内容之前，
   * 包一层 pointer-events-none z-10（横幅内不承接点击，点击落回覆盖层）。
   */
  banner?: ReactNode
  /** 覆盖默认图标盒尺寸类（compact 20px 行内图标等场景），cn 合入不替换 */
  iconWrapClassName?: string
  /** 标题右侧附加槽（健康徽标「看存档」等）；默认不传时标题 DOM 结构不变 */
  titleExtra?: ReactNode
  /** grid 专用：底部通栏操作区（nav-card-actionbar），mt-auto 落底，位置由组件统一 */
  actionBar?: ReactNode
  /** grid 专用：操作区跳过 hover 渐隐（首页收藏星标必须非悬浮可点） */
  actionsAlwaysVisible?: boolean
  /** 装饰层（置顶徽标 / dial 角标 / 快捷键提示）：absolute inset-0 z-10 + pointer-events-none，不吞点击 */
  decorations?: ReactNode
  /**
   * 标题内链附加属性（tabIndex={-1} / title 等）：grid 的标题 Link 上合并。
   * className 会合入标题默认类；其余属性覆盖同名默认值。
   */
  titleLinkProps?: AnchorHTMLAttributes<HTMLAnchorElement>
}) {
  const iconNode = icon ? <span className={cn(ICON_WRAP[variant], iconWrapClassName)}>{icon}</span> : null

  const { className: rootClassName, ...rootRest } = rootProps ?? {}
  const { className: titleLinkClassName, ...titleLinkRest } = titleLinkProps ?? {}

  /** 覆盖层锚点（兄弟节点模型）：调用方 overlayProps 只补差异，默认类不丢 */
  const renderOverlayAnchor = (radiusClass: string) => {
    if (!overlayHref) return null
    const { className: overlayClassName, ...overlayRest } = overlayProps ?? {}
    return (
      <a
        href={safeHref(overlayHref)}
        target={overlayTarget}
        rel={overlayRel}
        aria-label={overlayLabel ?? `访问 ${title} 官网`}
        {...overlayRest}
        className={cn(
          'absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          radiusClass,
          overlayClassName,
        )}
      >
        <span className="sr-only">{overlayLabel ?? `访问 ${title} 官网`}</span>
      </a>
    )
  }

  if (variant === 'grid') {
    const hasOverlay = Boolean(overlayHref)
    const titleNode = hasOverlay ? (
      href ? (
        <Link
          href={safeHref(href)}
          onClick={onTitleClick}
          {...titleLinkRest}
          className={cn(TITLE_INNER_LINK, titleClassName, titleLinkClassName)}
        >
          {title}
        </Link>
      ) : (
        <span className={cn(TITLE_INNER_LINK, 'pointer-events-none', titleClassName)}>{title}</span>
      )
    ) : (
      <div className={cn(TITLE.grid, titleClassName)}>{title}</div>
    )
    // 标题右侧附加槽（健康徽标等）：默认不传时保持原 DOM 结构不变
    const titleRow = titleExtra ? (
      <div className="flex min-w-0 items-start gap-1.5">
        {titleNode}
        <div className="shrink-0">{titleExtra}</div>
      </div>
    ) : (
      titleNode
    )
    const contentInner = (
      <div className="flex items-start gap-2.5">
        {iconNode}
        <div className="min-w-0 flex-1">
          {titleRow}
          {description ? <div className={DESC.grid}>{description}</div> : null}
          {meta ? (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground font-mono flex-wrap">
              {meta}
            </div>
          ) : null}
        </div>
      </div>
    )
    return (
      <div {...rest} {...rootRest} className={cn(SHELL_GRID_BASE, SHELL_GRID_SURFACE[surface], rootClassName, className)}>
        {renderOverlayAnchor('rounded-xl')}
        {banner ? <div className="pointer-events-none relative z-10">{banner}</div> : null}
        {hasOverlay ? (
          <div className="relative z-10 pointer-events-none">{contentInner}</div>
        ) : href ? (
          <Link href={safeHref(href)} onClick={onTitleClick} className={LINK.grid}>
            {contentInner}
          </Link>
        ) : (
          contentInner
        )}
        {/* 底部通栏操作区（位置由组件统一）：覆盖层式贴底全宽，容器不吞点击，
            按钮可见性/pointer-events 规则由调用方内容自管（悬浮渐隐或触屏常显）。 */}
        {actionBar ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">{actionBar}</div>
        ) : null}
        {decorations ? (
          <div className="pointer-events-none absolute inset-0 z-10">{decorations}</div>
        ) : null}
        {actions ? (
          <div
            className={cn(
              'absolute top-2 right-2 flex items-center gap-1 transition-opacity',
              actionsAlwaysVisible
                ? 'opacity-100'
                : 'opacity-80 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100',
              hasOverlay ? 'z-20' : 'z-10',
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
    )
  }

  if (variant === 'row') {
    return (
      <div {...rest} {...rootRest} className={cn(SHELL.row, rootClassName, className)}>
        {href ? (
          <Link href={safeHref(href)} onClick={onTitleClick} className={LINK.row}>
            {iconNode}
            <span className="min-w-0 flex-1">
              <span className={cn(TITLE.row, titleClassName)}>{title}</span>
              {description ? <span className={DESC.row}>{description}</span> : null}
              {meta ? <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">{meta}</span> : null}
            </span>
          </Link>
        ) : (
          <span className="flex items-center gap-3 min-w-0 flex-1 py-0.5">
            {iconNode}
            <span className="min-w-0 flex-1">
              <span className={cn(TITLE.row, titleClassName)}>{title}</span>
              {description ? <span className={DESC.row}>{description}</span> : null}
              {meta ? <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">{meta}</span> : null}
            </span>
          </span>
        )}
        {actions ? <div className={ACTIONS.row}>{actions}</div> : null}
      </div>
    )
  }

  // compact
  const compactHasOverlay = Boolean(overlayHref)
  if (compactHasOverlay) {
    // 紧凑行整卡外链模式：覆盖层 z-0 与内容互为兄弟；内容层 pointer-events-none，
    // 只有标题内链 pointer-events-auto 可点（与 grid overlay 同一套兄弟节点模型）。
    return (
      <div {...rest} {...rootRest} className={cn(SHELL.compact, rootClassName, className)}>
        {renderOverlayAnchor('rounded-lg')}
        <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-2">
          {iconNode}
          {href ? (
            <Link
              href={safeHref(href)}
              onClick={onTitleClick}
              {...titleLinkRest}
              className={cn(LINK.compact, 'pointer-events-auto', titleLinkClassName)}
            >
              {title}
            </Link>
          ) : (
            <span className={cn(TITLE.compact, titleClassName)}>{title}</span>
          )}
          {/* 标题右侧附属槽（置顶 Pin / 星数 / 健康徽标）：容器不吞点击，内容自理 */}
          {titleExtra ? <div className="flex shrink-0 items-center gap-1.5">{titleExtra}</div> : null}
        </div>
        {meta ? (
          <span className="pointer-events-none relative z-10 shrink-0 text-xs text-muted-foreground">{meta}</span>
        ) : null}
        {actions ? <div className={ACTIONS.compact}>{actions}</div> : null}
      </div>
    )
  }
  return (
    <div {...rest} {...rootRest} className={cn(SHELL.compact, rootClassName, className)}>
      {href ? (
        <Link href={safeHref(href)} onClick={onTitleClick} className={LINK.compact}>
          {iconNode}
          <span className={cn(TITLE.compact, titleClassName)}>{title}</span>
        </Link>
      ) : (
        <span className="flex items-center gap-2 min-w-0 flex-1">
          {iconNode}
          <span className={cn(TITLE.compact, titleClassName)}>{title}</span>
        </span>
      )}
      {meta ? <span className="shrink-0 text-xs text-muted-foreground">{meta}</span> : null}
      {actions ? <div className={ACTIONS.compact}>{actions}</div> : null}
    </div>
  )
}
