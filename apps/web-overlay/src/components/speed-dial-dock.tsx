'use client'

import React, { useMemo, useRef, useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { Zap, X, RotateCcw, Clock } from 'lucide-react'
import { SiteFavicon } from '@/components/site-favicon'
/**
 * 模块缩放手柄（Bundle 瘦身第三刀 a）：见 navigation-category-section.tsx
 * 同款注释——dynamic + `isEditingLayout &&` 门，首屏不渲染不拉 chunk。
 * module-resize-store.ts 零改动。
 */
const ModuleResizeHandles = dynamic(
  () =>
    import('@/components/modular/module-resize-handles').then((m) => m.ModuleResizeHandles),
  { ssr: false, loading: () => null },
)
import { useModuleWindowSize } from '@/lib/modular/module-resize-store'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import { type WorkspaceId } from '@/components/workspace-filter'
import { readOfflineVisits, type RecentVisit} from '@/lib/offline-recent'
import { cn } from '@/lib/utils'
import { safeHref } from '@/lib/safe-url'
import { useExternalLinkTarget } from '@/lib/user-preferences'
import { computeSpeedDialSites } from '@/lib/speed-dial-order'
import { NumberDialBadge } from '@/components/number-dial-badge'

interface SpeedDialDockProps {
  allSites: any[]
  activeWorkspace?: WorkspaceId
  onPeek?: (item: any) => void
  /**
   * 数字直达映射（站点 id → 数字键 1~9），由 navigation-content 的
   * buildDialMap 算出并透传：坞角标与卡片角标、键盘打开目标读同一份映射，
   * 禁止坞按自己的列表下标重算。无映射时不渲染角标（坞的最近访问与
   * navigation-content 是两次独立异步读取，顺序短暂分叉时下标回退会标错数字）。
   */
  dialDigitById?: ReadonlyMap<string, number>
}

const DOCK_COL_CLASS_MAP: Record<number, string> = {
  4: 'col-span-12 lg:col-span-4',
  5: 'col-span-12 lg:col-span-5',
  6: 'col-span-12 lg:col-span-6',
  7: 'col-span-12 lg:col-span-7',
  8: 'col-span-12 lg:col-span-8',
  9: 'col-span-12 lg:col-span-9',
  10: 'col-span-12 lg:col-span-10',
  11: 'col-span-12 lg:col-span-11',
  12: 'col-span-12',
}

export function SpeedDialDock({ allSites, activeWorkspace = 'all', dialDigitById }: SpeedDialDockProps) {
  const { mounted, speedDialEnabled, speedDialPinnedIds, unpinFromSpeedDial, isEditingLayout } = useHomeDIY()
  const linkTarget = useExternalLinkTarget('_blank')
  const dockRef = useRef<HTMLDivElement | null>(null)
  const { colSpan, heightPx, isCustomSized, setSize, resetSize } = useModuleWindowSize(
    'speed-dial-dock',
    { colSpan: 12 }
  )

  const [recentVisits, setRecentVisits] = useState<RecentVisit[]>([])

  useEffect(() => {
    let active = true
    readOfflineVisits(20)
      .then((rows) => {
        if (active && Array.isArray(rows)) {
          setRecentVisits(rows)
        }
      })
      .catch(() => {
        // 降级容错：离线高频访问读取失败时不阻塞速览坞渲染
      })
    return () => {
      active = false
    }
  }, [])

  const pinnedSites = useMemo(
    () =>
      computeSpeedDialSites({
        allSites,
        speedDialPinnedIds,
        recentVisits,
        activeWorkspace,
      }),
    [allSites, speedDialPinnedIds, recentVisits, activeWorkspace],
  )

  if (!speedDialEnabled && !isEditingLayout) return null

  const dockColClass = DOCK_COL_CLASS_MAP[colSpan] || 'col-span-12'

  return (
    <div className="grid grid-cols-12 mb-6">
      <div
        ref={dockRef}
        id="quick-access-tray"
        data-speed-dial="true"
        className={cn(
          'group relative rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/5 via-accent/10 to-primary/5 p-3 sm:p-4 backdrop-blur-md shadow-xs animate-in fade-in duration-200 transition-all',
          dockColClass
        )}
      >
        {isEditingLayout && (
          <ModuleResizeHandles
            moduleRef={dockRef}
            colSpan={colSpan}
            minColSpan={4}
            maxColSpan={12}
            heightPx={heightPx}
            minHeightPx={120}
            maxHeightPx={480}
            isEditing={isEditingLayout}
            onResizeChange={(next) => setSize(next)}
            onReset={resetSize}
          />
        )}

        <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-border/40">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Zap className="h-3.5 w-3.5 fill-primary" />
            </span>
            <h2 className="text-xs sm:text-sm font-bold tracking-tight text-foreground flex items-center gap-1.5">
              <span>⚡ 极速直达坞</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-primary/10 text-primary border border-primary/20">
                Top {pinnedSites.length}
              </span>
            </h2>
            {isEditingLayout && isCustomSized && (
              <button
                type="button"
                onClick={resetSize}
                className="inline-flex min-h-11 items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 cursor-pointer"
                title="恢复速览坞默认尺寸"
                aria-label="恢复速览坞默认尺寸"
              >
                <span>
                  {colSpan}/12列{heightPx ? `×${heightPx}px` : ''}
                </span>
                <RotateCcw className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
          {isEditingLayout && (
            <span className="text-[11px] text-muted-foreground">
              编排模式：可拖拽边框调整尺寸，点击 × 移出站点
            </span>
          )}
        </div>

        <div
          style={heightPx ? { maxHeight: `${heightPx}px` } : undefined}
          className={cn(
            'grid gap-2',
            colSpan <= 6
              ? 'grid-cols-2 sm:grid-cols-3'
              : 'grid-cols-2 min-[480px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5',
            heightPx && 'overflow-y-auto pr-1 custom-scrollbar'
          )}
        >
          {pinnedSites.map((site) => (
            <div
              key={site.id}
              className="group/chip relative flex items-center gap-2 px-2.5 py-2.5 rounded-xl border border-border/70 hover:border-primary/50 bg-background/90 dark:bg-card/90 backdrop-blur-xs hover:shadow-xs transition-all duration-150 transform hover:-translate-y-0.5"
            >
              <div className="relative flex-shrink-0 w-6 h-6 rounded-md p-0.5 bg-muted/50 dark:bg-muted/20 border border-border/40 flex items-center justify-center transition-transform group-hover/chip:scale-105">
                <SiteFavicon
                  title={site.title}
                  url={site.href}
                  icon={site.icon}
                  useDefaultIcon={site.useDefaultIcon}
                  className="w-full h-full object-contain rounded-xs"
                />
                {/*
                  数字直达角标：只在挂载后出现（SSR 与首帧无角标，避免水合分叉；
                  映射依赖 localStorage 的钉选与最近访问，服务端算不出同一份顺序）。
                  数字只取 navigation-content 透传的映射，无映射不渲染角标，
                  不用本列表下标回退（两份最近访问读取时序分叉时会标错数字）。
                */}
                {mounted && dialDigitById?.get(site.id) !== undefined && (
                  <NumberDialBadge
                    digit={dialDigitById.get(site.id)}
                    className="-bottom-1 -right-1"
                  />
                )}
              </div>
              <a
                href={safeHref(site.href)}
                target={linkTarget}
                rel="noopener noreferrer nofollow"
                className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground group-hover/chip:text-primary transition-colors focus-visible:outline-none after:absolute after:inset-0 after:z-0"
                title={site.title}
              >
                {site.title}
              </a>

              {site.isRecent && (
                <span
                  className="relative z-10 shrink-0 text-[10px] text-emerald-700 dark:text-emerald-400 font-mono px-1 py-0.2 rounded bg-emerald-500/10 border border-emerald-500/20"
                  title="最近常用 · 仅记录在本机，可在数据管理中清除"
                >
                  <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                  最近常用
                </span>
              )}

              {isEditingLayout && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    unpinFromSpeedDial(site.id)
                  }}
                  className="relative z-20 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:text-destructive-text hover:bg-destructive/15 transition-colors"
                  title="从速览坞移出"
                  aria-label={`从速览坞移出 ${site.title}`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
