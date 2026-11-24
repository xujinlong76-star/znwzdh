'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import type { NavigationSubItem } from '@/types/navigation'
import { SiteFavicon, extractFaviconMonogram, getDeterministicGradient } from '@/components/site-favicon'
import type { SiteThumbnail } from '@/lib/site-thumbnails'
import { FavoriteButton } from '@/components/favorite-button'
import { Button } from '@/registry/new-york/ui/button'
import { NumberDialBadge } from '@/components/number-dial-badge'
import {
  SiteItemShell,
  SiteItemTitle,
  type SiteItemController,
} from '@/components/site-item-shell'
import { Eye, EyeOff, Star, Zap, Pin, Copy, ArrowUpToLine, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { tagSlug } from '@/lib/seo/tag-slug'
import type { CanonicalCardDisplayMode } from '@/lib/modular/card-display-modes'

export type ExtendedCardVariantMode = Extract<
  CanonicalCardDisplayMode,
  'icon-wall' | 'list' | 'minimal' | 'directory'
>

export interface NavigationCardVariantProps {
  mode: ExtendedCardVariantMode
  controller: SiteItemController
}

/**
 * 图标启动台专用的 56×56 Squircle 品牌图标底座（iTab / macOS Launchpad 质感）。
 * 优先渲染高清缩略图或品牌图标，失败时无闪烁回落为确定性渐变首字母徽标。
 */
function LaunchpadSquircleIcon({
  item,
  thumbnail,
}: {
  item: NavigationSubItem
  thumbnail: SiteThumbnail | null
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const prevSrcRef = useRef(thumbnail?.src)
  if (prevSrcRef.current !== thumbnail?.src) {
    prevSrcRef.current = thumbnail?.src
    if (imgFailed) setImgFailed(false)
  }

  const gradient = getDeterministicGradient(item.title || 'navhub')
  const monogram = extractFaviconMonogram(item.title || '')

  if (thumbnail && !imgFailed) {
    return (
      <div
        aria-hidden="true"
        className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-[16px] shadow-sm ring-1 ring-inset ring-black/[0.06] transition-all duration-200 group-hover/card:scale-[1.06] group-hover/card:shadow-md dark:ring-white/[0.12]"
        style={{ background: gradient.cssGradient }}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/25 via-transparent to-black/10" />
        <img
          src={thumbnail.src}
          alt=""
          width={36}
          height={36}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="relative z-10 h-9 w-9 object-contain drop-shadow-xs"
          onError={() => setImgFailed(true)}
        />
      </div>
    )
  }

  if (thumbnail && imgFailed) {
    return (
      <div
        aria-hidden="true"
        className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-[16px] shadow-sm ring-1 ring-inset ring-black/[0.06] transition-all duration-200 group-hover/card:scale-[1.06] group-hover/card:shadow-md dark:ring-white/[0.12]"
        style={{ background: gradient.cssGradient }}
      >
        <span
          className="text-xl font-bold leading-none drop-shadow-xs"
          style={{ color: gradient.textColor }}
        >
          {monogram}
        </span>
      </div>
    )
  }

  return (
    <div className="relative flex h-14 w-14 items-center justify-center rounded-[16px] border border-border/60 bg-background/95 p-2.5 shadow-sm transition-all duration-200 group-hover/card:scale-[1.06] group-hover/card:shadow-md dark:bg-card/80">
      <SiteFavicon
        title={item.title}
        url={item.href}
        icon={item.icon}
        useDefaultIcon={item.useDefaultIcon}
        className="h-full w-full rounded-md object-contain"
      />
    </div>
  )
}

/**
 * 模式 A：图标启动台（`icon-wall` — iTab / macOS Launchpad 纯 UI 表现层）
 */
function IconWallItemView({ controller }: { controller: SiteItemController }) {
  const {
    item,
    hostname,
    thumbnail,
    isPinnedInCategory,
    isEditingLayout,
    dialDigit,
    effectiveCardElements,
    onPeek,
    handlePruneSite,
    renderDragControls,
  } = controller

  return (
    <SiteItemShell
      mode="icon-wall"
      controller={controller}
      withTooltip
      linkClassName="rounded-2xl"
      className={cn(
        'group/card relative flex min-w-0 flex-col items-center rounded-2xl border border-transparent px-2 pt-3 pb-2.5 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-border/70 hover:bg-card/85 hover:shadow-[var(--depth-float)] dark:hover:bg-card/65',
        isPinnedInCategory && 'border-pinned/35 bg-pinned/[0.06] ring-1 ring-inset ring-pinned/30',
        isEditingLayout && 'border-dashed border-border/70 bg-card/55',
      )}
      quickLookBadge={
        effectiveCardElements.showQuickLookBadge ? (
          <div className="pointer-events-none absolute top-1 left-1/2 z-30 -translate-x-1/2 opacity-0 transition-opacity duration-[--duration-fast] peer-focus-visible:opacity-100 sm:group-hover/card:opacity-0">
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-sm bg-primary px-1.5 py-0.5 font-mono text-[9px] font-medium text-primary-foreground shadow-xs">
              Space 速览
            </span>
          </div>
        ) : null
      }
    >
      {/* 左上角轻量微操作（DIY `overlay-corner` 紧凑手柄，永不遮挡图标与站名） */}
      <div
        className={cn(
          'absolute top-1 left-1 z-20 flex items-center gap-0.5 transition-opacity duration-150',
          isEditingLayout
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0 group-hover/card:pointer-events-auto group-hover/card:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
        )}
      >
        {isEditingLayout ? (
          <>
            {renderDragControls('h-6 w-6 rounded-md bg-background/90 border border-border/60 shadow-2xs')}
            <Button
              type="button"
              tabIndex={-1}
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-md border border-border/60 bg-background/90 text-destructive-text shadow-2xs hover:bg-destructive/15"
              title="🙈 隐藏此站点（移入回收站）"
              aria-label={`隐藏站点：${item.title}`}
              onClick={handlePruneSite}
            >
              <EyeOff className="h-3 w-3" />
            </Button>
          </>
        ) : (
          <Button
            type="button"
            tabIndex={-1}
            data-card-action=""
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-full border border-border/60 bg-background/90 text-muted-foreground shadow-2xs backdrop-blur-sm hover:text-foreground"
            title="速览与行动 (Space)"
            aria-label={`速览与行动：${item.title}`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onPeek?.(item)
            }}
          >
            <Eye className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* 右上角收藏星标 */}
      <div
        className={cn(
          'absolute top-1 right-1 z-20 transition-opacity duration-150',
          isEditingLayout
            ? 'opacity-100'
            : 'opacity-0 group-hover/card:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100',
        )}
      >
        <FavoriteButton
          tabIndex={-1}
          cardAction
          className="pointer-events-auto border border-border/60 bg-background/90 shadow-2xs backdrop-blur-sm"
          site={{ siteId: item.id, title: item.title, href: item.href, icon: item.icon, description: item.description }}
        />
      </div>

      {/* 核心视觉焦点：56×56 圆角方块图标 */}
      <div className="pointer-events-none relative z-10 mt-1">
        <LaunchpadSquircleIcon item={item} thumbnail={thumbnail} />
        {isPinnedInCategory && (
          <span
            title="当前分类已置顶"
            className="absolute -top-1.5 -left-1.5 z-20 flex h-4 w-4 items-center justify-center rounded-full border border-pinned/40 bg-background shadow-xs"
          >
            <Pin className="h-2.5 w-2.5 fill-pinned text-pinned" />
          </span>
        )}
        <NumberDialBadge digit={dialDigit} className="-right-1.5 -bottom-1.5 z-20" />
      </div>

      {/* 居中站点名称（点击文字可进详情页） */}
      <div className="pointer-events-none relative z-10 mt-2 w-full min-w-0 px-0.5">
        <SiteItemTitle
          controller={controller}
          className="block truncate text-xs font-semibold tracking-tight text-foreground/95 transition-colors group-hover/card:text-primary"
        />
        {hostname && (
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {hostname}
          </p>
        )}
      </div>
    </SiteItemShell>
  )
}

/**
 * 模式 B：极客清单（`list` — Raindrop / Linear 表格明细行纯 UI 表现层）
 */
function ListRowItemView({ controller }: { controller: SiteItemController }) {
  const {
    item,
    hostname,
    isPinnedInCategory,
    isEditingLayout,
    isSpeedDialPinned,
    dialDigit,
    effectiveCardElements,
    handleTagClick,
    handlePruneSite,
    handleToggleSpeedDial,
    handleCategoryPin,
    handleWorkbenchPin,
    handleCopyLink,
    onPeek,
    renderDragControls,
    detailAction,
  } = controller

  return (
    <SiteItemShell
      mode="list"
      controller={controller}
      linkClassName="rounded-xl"
      className={cn(
        'nav-card-deferred group/card relative flex min-h-[50px] items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/85 px-3 py-2 transition-all duration-[--duration-fast] hover:border-primary/45 hover:bg-card hover:shadow-xs dark:bg-card/50',
        isPinnedInCategory && 'border-pinned/35 bg-pinned/[0.04] ring-1 ring-inset ring-pinned/30',
        isEditingLayout && 'border-dashed border-border/75',
      )}
      quickLookBadge={
        effectiveCardElements.showQuickLookBadge ? (
          <div className="pointer-events-none absolute top-1.5 right-12 z-20 opacity-0 transition-opacity duration-[--duration-fast] peer-focus-visible:opacity-100 sm:group-hover/card:opacity-0">
            <span className="inline-flex items-center gap-1 rounded-sm bg-primary px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary-foreground shadow-xs">
              <span>Space 速览</span>
              <span aria-hidden="true">·</span>
              <span>→ 操作</span>
            </span>
          </div>
        ) : null
      }
    >
      {/* 左侧信息列：图标 + 站名 + 横向简介 + 域名胶囊 + 标签 */}
      <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-3">
        <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/50 p-1 transition-transform duration-150 group-hover/card:scale-105 dark:bg-muted/25">
          <SiteFavicon
            title={item.title}
            url={item.href}
            icon={item.icon}
            useDefaultIcon={item.useDefaultIcon}
            className="h-full w-full rounded-xs object-contain"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
          {/* 站点名 + 快拨数字 + 置顶/星数 */}
          <div className="flex min-w-0 shrink-0 items-center gap-1.5 sm:w-[190px] lg:w-[210px]">
            <SiteItemTitle
              controller={controller}
              className="truncate text-sm font-semibold tracking-tight text-foreground transition-colors group-hover/card:text-primary"
            />
            <NumberDialBadge digit={dialDigit} inline />
            {isPinnedInCategory && (
              <Pin className="h-3 w-3 shrink-0 fill-pinned text-pinned" />
            )}
            {item.liveMetrics?.githubStars && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-pinned/10 px-1 py-0.2 font-mono text-[10px] font-medium text-pinned-foreground">
                <Star className="h-2.5 w-2.5 fill-pinned text-pinned" />
                {(item.liveMetrics.githubStars / 1000).toFixed(0)}k
              </span>
            )}
          </div>

          {/* 横向完整单行简介 */}
          {effectiveCardElements.showDescription && (
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {item.description || hostname}
            </p>
          )}

          {/* 等宽域名胶囊 */}
          {hostname && !isEditingLayout && (
            <span className="hidden max-w-[165px] shrink-0 items-center gap-1 truncate rounded-md border border-border/45 bg-muted/45 px-2 py-0.5 font-mono text-[11px] text-muted-foreground md:inline-flex">
              <Globe className="h-2.5 w-2.5 shrink-0 opacity-65" />
              <span className="truncate">{hostname}</span>
            </span>
          )}

          {/* 宽屏展示最多 2 个标签 */}
          {effectiveCardElements.showTags && !isEditingLayout && item.tags && item.tags.length > 0 && (
            <div className="hidden shrink-0 items-center gap-1 xl:flex">
              {item.tags.slice(0, 2).map((tag) => (
                <Link
                  key={tag}
                  href={'/tags/' + encodeURIComponent(tagSlug(tag))}
                  onClick={handleTagClick}
                  tabIndex={-1}
                  data-card-action=""
                  className="pointer-events-auto inline-flex items-center rounded-full bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                >
                  #{tag}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右侧操作区：
          - DIY 编辑态（`inline-compact`）：紧凑内联拖拽手柄 + 菜单 + 隐藏，绝不悬浮遮挡标题与简介；
          - 常态浏览：右侧绝对定位渐隐浮层，平时释放 100% 横向宽度给内容。 */}
      <div className="relative z-20 flex shrink-0 items-center gap-0.5">
        {isEditingLayout ? (
          <div
            data-diy-inline-controls="list"
            className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border/60 bg-background/85 px-0.5 py-0.5"
          >
            {renderDragControls('h-6 w-6 rounded-md')}
            <Button
              type="button"
              tabIndex={-1}
              variant="ghost"
              size="icon"
              className={cn(
                'h-6 w-6 rounded-md transition-colors',
                isSpeedDialPinned ? 'bg-pinned/15 text-pinned' : 'text-muted-foreground hover:text-pinned',
              )}
              title={isSpeedDialPinned ? '从首屏速览坞取消固定' : '📌 钉入首屏速览坞'}
              aria-label={isSpeedDialPinned ? `从速览坞取消固定：${item.title}` : `钉入速览坞：${item.title}`}
              onClick={handleToggleSpeedDial}
            >
              <Zap className={cn('h-3 w-3', isSpeedDialPinned && 'fill-pinned')} />
            </Button>
            <Button
              type="button"
              tabIndex={-1}
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-md text-destructive-text hover:bg-destructive/15"
              title="🙈 隐藏此站点（移入回收站）"
              aria-label={`隐藏站点：${item.title}`}
              onClick={handlePruneSite}
            >
              <EyeOff className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <span className="pointer-events-none absolute right-8 top-1/2 z-30 flex -translate-y-1/2 items-center gap-0.5 rounded-r-lg bg-gradient-to-l from-card via-card to-transparent pl-8 pr-1 py-0.5 opacity-0 transition-opacity sm:group-hover/card:pointer-events-auto sm:group-hover/card:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
            <Button
              type="button"
              tabIndex={-1}
              variant="ghost"
              size="icon"
              className="hidden h-7 w-7 rounded-lg text-muted-foreground hover:bg-destructive/15 hover:text-destructive-text sm:inline-flex"
              title="🙈 隐藏此站点（移入回收站）"
              aria-label={`隐藏站点：${item.title}`}
              onClick={handlePruneSite}
            >
              <EyeOff className="h-3.5 w-3.5" />
            </Button>
            {handleCategoryPin && (
              <Button
                type="button"
                tabIndex={-1}
                data-card-action=""
                variant="ghost"
                size="icon"
                className={cn(
                  'h-7 w-7 rounded-lg',
                  isPinnedInCategory ? 'bg-pinned/10 text-pinned' : 'text-muted-foreground hover:text-pinned',
                )}
                title={isPinnedInCategory ? '取消分类内置顶' : '置顶在当前分类首位'}
                aria-label={isPinnedInCategory ? `取消分类内置顶：${item.title}` : `置顶在当前分类首位：${item.title}`}
                onClick={handleCategoryPin}
              >
                <ArrowUpToLine className={cn('h-3.5 w-3.5', isPinnedInCategory && 'fill-pinned')} />
              </Button>
            )}
            {detailAction('h-7 w-7 rounded-lg')}
            <Button
              type="button"
              tabIndex={-1}
              data-card-action=""
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              title="速览与行动"
              aria-label={`速览与行动：${item.title}`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onPeek?.(item)
              }}
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              tabIndex={-1}
              data-card-action=""
              variant="ghost"
              size="icon"
              className="hidden h-7 w-7 rounded-lg text-muted-foreground hover:text-success sm:inline-flex"
              title="📌 固定到工作台"
              aria-label={`固定到工作台：${item.title}`}
              onClick={handleWorkbenchPin}
            >
              <Pin className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              tabIndex={-1}
              data-card-action=""
              variant="ghost"
              size="icon"
              className="hidden h-7 w-7 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground sm:inline-flex"
              title="复制网址链接"
              aria-label={`复制链接：${item.title}`}
              onClick={handleCopyLink}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </span>
        )}
        <span className="pointer-events-auto opacity-100">
          <FavoriteButton
            tabIndex={-1}
            cardAction
            site={{ siteId: item.id, title: item.title, href: item.href, icon: item.icon, description: item.description }}
          />
        </span>
      </div>
    </SiteItemShell>
  )
}

/**
 * 模式 C：极速胶囊（`minimal` — Chrome 书签 / 超高密药丸流纯 UI 表现层）
 */
function MinimalChipItemView({ controller }: { controller: SiteItemController }) {
  const {
    item,
    isPinnedInCategory,
    isEditingLayout,
    dialDigit,
    handlePruneSite,
    onPeek,
    renderDragControls,
  } = controller

  return (
    <SiteItemShell
      mode="minimal"
      controller={controller}
      withTooltip
      linkClassName="rounded-full"
      className={cn(
        'nav-card-deferred group/card relative flex h-10 min-w-0 items-center justify-between gap-1.5 rounded-full border border-border/70 bg-card/85 px-2.5 transition-all duration-[--duration-fast] hover:-translate-y-0.5 hover:border-primary/45 hover:bg-primary/[0.04] hover:shadow-xs dark:bg-card/50',
        isPinnedInCategory && 'border-pinned/40 bg-pinned/[0.06] ring-1 ring-inset ring-pinned/30',
        isEditingLayout && 'border-dashed border-border/75',
      )}
    >
      <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-2">
        <div className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted/50 p-0.5 transition-transform duration-150 group-hover/card:scale-110">
          <SiteFavicon
            title={item.title}
            url={item.href}
            icon={item.icon}
            useDefaultIcon={item.useDefaultIcon}
            className="h-full w-full rounded-full object-contain"
          />
        </div>
        <SiteItemTitle
          controller={controller}
          className="min-w-0 flex-1 truncate text-xs font-medium text-foreground transition-colors group-hover/card:text-primary sm:text-[13px]"
        />
        <NumberDialBadge digit={dialDigit} inline />
        {isPinnedInCategory && (
          <Pin className="h-2.5 w-2.5 shrink-0 fill-pinned text-pinned" />
        )}
      </div>

      {/* DIY 编辑态采用胶囊尾部紧凑内联手柄（`inline-compact`），绝不用大悬浮条遮挡标题 */}
      <div className="relative z-20 flex shrink-0 items-center gap-0.5">
        {isEditingLayout ? (
          <span
            data-diy-inline-controls="minimal"
            className="flex shrink-0 items-center gap-0.5"
          >
            {renderDragControls('h-6 w-6 rounded-full')}
            <Button
              type="button"
              tabIndex={-1}
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-full text-destructive-text hover:bg-destructive/15"
              title="🙈 隐藏此站点"
              aria-label={`隐藏站点：${item.title}`}
              onClick={handlePruneSite}
            >
              <EyeOff className="h-3 w-3" />
            </Button>
          </span>
        ) : (
          <>
            <Button
              type="button"
              tabIndex={-1}
              data-card-action=""
              variant="ghost"
              size="icon"
              className="pointer-events-none absolute right-7 top-1/2 z-30 hidden h-6 w-6 -translate-y-1/2 rounded-full border border-border/60 bg-card/95 text-muted-foreground opacity-0 shadow-xs backdrop-blur-md transition-opacity hover:bg-accent hover:text-foreground sm:inline-flex sm:group-hover/card:pointer-events-auto sm:group-hover/card:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
              title="速览与行动 (Space)"
              aria-label={`速览与行动：${item.title}`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onPeek?.(item)
              }}
            >
              <Eye className="h-3 w-3" />
            </Button>
            <FavoriteButton
              tabIndex={-1}
              cardAction
              site={{ siteId: item.id, title: item.title, href: item.href, icon: item.icon, description: item.description }}
            />
          </>
        )}
      </div>
    </SiteItemShell>
  )
}

/**
 * 模式 D：书签目录（`directory` — Pinboard / Swiss 去框化极简文本索引纯 UI 表现层）
 */
function DirectoryRowItemView({ controller }: { controller: SiteItemController }) {
  const {
    item,
    hostname,
    isPinnedInCategory,
    isEditingLayout,
    dialDigit,
    effectiveCardElements,
    handlePruneSite,
    handleCopyLink,
    onPeek,
    renderDragControls,
    detailAction,
  } = controller

  return (
    <SiteItemShell
      mode="directory"
      controller={controller}
      withTooltip
      linkClassName="rounded-lg"
      className={cn(
        'group/card relative flex min-w-0 items-center justify-between gap-2 rounded-lg border border-transparent border-b-border/35 px-2.5 py-2 transition-colors duration-150 hover:border-border/60 hover:bg-card/95 dark:hover:bg-card/75',
        isPinnedInCategory && 'border-b-pinned/45 bg-pinned/[0.04]',
        isEditingLayout && 'border-dashed border-border/60 bg-card/40',
      )}
    >
      {/* 常态下吃满 100% 列宽（零幽灵留白）；DIY 编辑态与右侧紧凑内联手柄无缝共存 */}
      <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-start gap-2.5">
        <div className="relative mt-0.5 h-[18px] w-[18px] shrink-0">
          <SiteFavicon
            title={item.title}
            url={item.href}
            icon={item.icon}
            useDefaultIcon={item.useDefaultIcon}
            className="h-full w-full rounded-xs object-contain"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <SiteItemTitle
              controller={controller}
              className="truncate text-[13px] font-medium leading-snug text-foreground transition-colors group-hover/card:text-primary group-hover/card:underline underline-offset-4"
            />
            <NumberDialBadge digit={dialDigit} inline />
            {isPinnedInCategory && (
              <Pin className="h-2.5 w-2.5 shrink-0 fill-pinned text-pinned" />
            )}
          </div>
          <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
            {effectiveCardElements.showDescription && item.description
              ? item.description
              : hostname || '\u00A0'}
          </p>
        </div>
      </div>

      {/* DIY 编辑态采用紧凑内联拖拽手柄（`inline-compact`），常态采用右侧渐隐浮层 */}
      {isEditingLayout ? (
        <div
          data-diy-inline-controls="directory"
          className="relative z-20 flex shrink-0 items-center gap-0.5"
        >
          {renderDragControls('h-6 w-6 rounded-md')}
          <Button
            type="button"
            tabIndex={-1}
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md text-destructive-text hover:bg-destructive/15"
            title="🙈 隐藏此站点"
            aria-label={`隐藏站点：${item.title}`}
            onClick={handlePruneSite}
          >
            <EyeOff className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="pointer-events-none absolute right-1.5 top-1/2 z-20 flex -translate-y-1/2 items-center gap-0.5 rounded-r-lg bg-gradient-to-l from-card via-card to-transparent pl-8 pr-1 py-0.5 opacity-0 transition-opacity sm:group-hover/card:pointer-events-auto sm:group-hover/card:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
          {detailAction('h-6 w-6 rounded-md')}
          <Button
            type="button"
            tabIndex={-1}
            data-card-action=""
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            title="速览与行动"
            aria-label={`速览与行动：${item.title}`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onPeek?.(item)
            }}
          >
            <Eye className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            tabIndex={-1}
            data-card-action=""
            variant="ghost"
            size="icon"
            className="hidden h-6 w-6 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground sm:inline-flex"
            title="复制网址链接"
            aria-label={`复制链接：${item.title}`}
            onClick={handleCopyLink}
          >
            <Copy className="h-3 w-3" />
          </Button>
          <FavoriteButton
            tabIndex={-1}
            cardAction
            site={{ siteId: item.id, title: item.title, href: item.href, icon: item.icon, description: item.description }}
          />
        </div>
      )}
    </SiteItemShell>
  )
}

/**
 * 4 种扩展网址展示范式的纯 UI 分发入口：全部共享 `SiteItemShell` 无头交互壳。
 */
export function NavigationCardVariant({ mode, controller }: NavigationCardVariantProps) {
  switch (mode) {
    case 'icon-wall':
      return <IconWallItemView controller={controller} />
    case 'list':
      return <ListRowItemView controller={controller} />
    case 'minimal':
      return <MinimalChipItemView controller={controller} />
    case 'directory':
    default:
      return <DirectoryRowItemView controller={controller} />
  }
}
