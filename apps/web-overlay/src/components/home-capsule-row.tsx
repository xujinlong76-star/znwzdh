'use client'

/**
 * 首页首屏精简工作区行（2026-11-24 P1-3 + P2-5 深度融合升级）：
 *
 * - 桌面端（md+）：彻底移除与顶栏/DIY 弹窗重复的运营胶囊（插件精选、向导与设首页），
 *   回归纯粹的「5 大工作区角色切换 + 时段推荐」，紧凑到在 xl (1280px+) 即可与高频直达坞
 *   HomeQuickDock 并排单行，直接再省一整行 ~48px 首屏高度；
 * - 移动端（<md）：将独立的「山羊胡导航」标题行与「全部探索 / 更多」胶囊行融合成
 *   单行紧致顶栏（左品牌标题 role="heading" aria-level={1}，右工作区与快捷下拉），
 *   立省 ~48px 首屏垂直空间，且全页仍严格维持单 h1 SEO 契约；
 * - 三个按需小窗（短剧 / 插件 / AI 找站）仍走 dynamic({ ssr: false })，不进首屏包。
 */
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { ArrowRight, ChevronDown, Clapperboard, Compass, Puzzle, Sparkles } from 'lucide-react'
import { useWatchlist } from '@/hooks/useWatchlist'
import { HorizontalScrollFade } from '@/components/horizontal-scroll-fade'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/registry/new-york/ui/dropdown-menu'
import { WORKSPACES, type WorkspaceId } from '@/lib/workspaces'
import {
  dramaExposureAllowed,
  isDramaContextCategory,
} from '@/lib/modular/workspace-presets'
import { useDramaHotlistOptIn } from '@/hooks/useDramaHotlistOptIn'
import {
  DAYPART_PLACEHOLDER,
  daypartText,
  describeDaypart,
  recommendDaypartWorkspace,
  useClientHour,
} from '@/lib/daypart'
import { useUserPreference } from '@/lib/user-preferences'
import type { CinemaInitialData } from '@/components/home-drama-cinema'
import type { HubPluginItem } from '@/lib/navhub-api'
import { ONBOARDING_DISMISSED_VALUE, ONBOARDING_STORAGE_KEY } from '@/lib/onboarding'
import { HOMEPAGE_BANNER_DISMISSED_KEY } from '@/lib/growth-lazy'
import { cn } from '@/lib/utils'

const DramaMiniDialog = dynamic(
  () => import('@/components/home-windows/drama-mini-dialog').then((m) => m.DramaMiniDialog),
  { ssr: false, loading: () => null },
)
const PluginSpotlightDialog = dynamic(
  () => import('@/components/home-windows/plugin-spotlight-dialog').then((m) => m.PluginSpotlightDialog),
  { ssr: false, loading: () => null },
)
const AiFinderDialog = dynamic(
  () => import('@/components/home-windows/ai-finder-dialog').then((m) => m.AiFinderDialog),
  { ssr: false, loading: () => null },
)

export interface HomeCapsuleRowProps {
  cinemaInitial?: CinemaInitialData
  pluginItems: HubPluginItem[] | null
  showDramaCapsule?: boolean
  showAiCapsule?: boolean
  showGuideBadge?: boolean
  onOpenGuideTab?: () => void
  activeWorkspace?: string
  initialSceneParam?: string | null
  onWorkspaceChange: (id: WorkspaceId) => void
}

export function HomeCapsuleRow({
  cinemaInitial,
  pluginItems,
  showDramaCapsule = true,
  showAiCapsule: _showAiCapsule = true,
  showGuideBadge = true,
  onOpenGuideTab,
  activeWorkspace,
  initialSceneParam = null,
  onWorkspaceChange,
}: HomeCapsuleRowProps) {
  const { ready: watchlistReady, entries: watchlistEntries } = useWatchlist()
  const [dramaOpen, setDramaOpen] = useState(false)
  const [pluginsOpen, setPluginsOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [guidePending, setGuidePending] = useState(false)

  // 时段推荐（水合安全：小时仅客户端计算）
  const daypartSceneEnabled = useUserPreference('daypartSceneEnabled')
  const hour = useClientHour()
  const daypart = useMemo(() => {
    if (hour === null || !daypartSceneEnabled) return null
    return { hint: describeDaypart(hour), suggested: recommendDaypartWorkspace(hour) }
  }, [hour, daypartSceneEnabled])
  const suggestedWorkspace =
    daypart?.suggested && daypart.suggested !== activeWorkspace
      ? WORKSPACES.find((ws) => ws.id === daypart.suggested) ?? null
      : null

  useEffect(() => {
    try {
      const onboardingDismissed =
        window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === ONBOARDING_DISMISSED_VALUE
      const homepageClaimed = window.localStorage.getItem(HOMEPAGE_BANNER_DISMISSED_KEY) === '1'
      setGuidePending(!(onboardingDismissed && homepageClaimed))
    } catch {
      setGuidePending(true)
    }
  }, [])

  useEffect(() => {
    if (initialSceneParam) {
      setAiOpen(true)
    }
  }, [initialSceneParam])

  const latestWatch = watchlistReady && watchlistEntries.length > 0 ? watchlistEntries[0] : null
  const diyOptIn = useDramaHotlistOptIn()
  const inDramaCategoryContext =
    isDramaContextCategory(String(activeWorkspace ?? '')) ||
    activeWorkspace === 'short-drama'
  const showDrama =
    showDramaCapsule && dramaExposureAllowed({ inDramaCategoryContext, diyOptIn })

  const currentWorkspace =
    WORKSPACES.find((ws) => ws.id === activeWorkspace) ?? WORKSPACES[0]!
  const ActiveWsIcon = currentWorkspace.icon

  // 工作区 Tab 键盘漫游（roving tabindex，←/→ 切换）
  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const currentIndex = tabs.findIndex((tab) => tab === document.activeElement)
    if (currentIndex === -1) return
    e.preventDefault()
    const nextIndex =
      e.key === 'ArrowRight'
        ? (currentIndex + 1) % tabs.length
        : (currentIndex - 1 + tabs.length) % tabs.length
    tabs[nextIndex]?.focus()
    tabs[nextIndex]?.click()
  }

  return (
    <>
      {/* P2-5 移动端首屏瘦身融合（<md）：品牌主标题与工作区/快捷下拉合为单行，立省 ~48px */}
      <div className="flex items-center justify-between gap-2 pb-1.5 md:hidden">
        <p role="heading" aria-level={1} className="truncate text-lg font-bold tracking-tight text-foreground">
          山羊胡导航
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-2xs transition-opacity hover:opacity-95 cursor-pointer"
              aria-label="切换工作区与快捷功能"
            >
              <ActiveWsIcon className="h-3.5 w-3.5 shrink-0" />
              <span>{currentWorkspace.label}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-1.5 bg-popover text-popover-foreground border border-border shadow-2xl ring-1 ring-black/5 dark:ring-white/10">
            <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1">
              工作区视图
            </DropdownMenuLabel>
            {WORKSPACES.map((ws) => {
              const Icon = ws.icon
              const isActive = activeWorkspace === ws.id
              return (
                <DropdownMenuItem
                  key={ws.id}
                  onClick={() => onWorkspaceChange(ws.id)}
                  className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent"
                >
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium text-foreground">{ws.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{ws.desc}</span>
                  {isActive ? <span className="ml-auto text-primary text-xs shrink-0">当前</span> : null}
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1">
              快捷入口
            </DropdownMenuLabel>
            {showDrama ? (
              <DropdownMenuItem
                onClick={() => setDramaOpen(true)}
                className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent"
              >
                <Clapperboard className="h-4 w-4 text-amber-500 shrink-0" />
                <span className="font-medium text-foreground">
                  {latestWatch ? `继续追《${latestWatch.title}》` : '今日短剧热榜'}
                </span>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onClick={() => setPluginsOpen(true)}
              className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent"
            >
              <Puzzle className="h-4 w-4 text-primary shrink-0" />
              <span className="font-medium text-foreground">插件精选</span>
            </DropdownMenuItem>
            {showGuideBadge && guidePending && onOpenGuideTab ? (
              <DropdownMenuItem
                onClick={onOpenGuideTab}
                className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent"
              >
                <Compass className="h-4 w-4 text-emerald-500 shrink-0" />
                <span className="font-medium text-foreground">向导与设首页</span>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 桌面端（md+）：纯粹的 5 大工作区角色切换 + 宽屏时段推荐（无重复运营胶囊，xl 起与高频直达坞并排单行） */}
      <div className="hidden md:flex min-w-0 items-center gap-2">
        <HorizontalScrollFade
          className="min-w-0 flex-1"
          scrollClassName="flex items-center gap-1.5 py-0.5 text-xs"
          ariaLabel="工作区视图切换"
          showArrows
        >
          <div
            role="tablist"
            aria-label="工作区视图切换"
            onKeyDown={handleTabKeyDown}
            className="flex items-center gap-1.5 shrink-0"
          >
            {WORKSPACES.map((ws) => {
              const Icon = ws.icon
              const isActive = activeWorkspace === ws.id
              return (
                <button
                  key={ws.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => onWorkspaceChange(ws.id)}
                  title={ws.desc}
                  className={cn(
                    'flex min-h-9 items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all shrink-0 whitespace-nowrap cursor-pointer',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                      : 'bg-muted/40 hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border/50 hover:border-border',
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{ws.label}</span>
                </button>
              )
            })}
          </div>

          {/* 时段场景推荐：≥1536px 宽屏空间充裕时呈现，1280–1535px 让位给同行的工作区与高频直达坞 */}
          <div className="hidden min-w-0 shrink-0 items-center gap-2 whitespace-nowrap pl-1 text-xs text-muted-foreground min-[1536px]:flex">
            {daypartSceneEnabled ? (
              suggestedWorkspace ? (
                <button
                  type="button"
                  onClick={() => onWorkspaceChange(suggestedWorkspace.id)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors shrink-0 whitespace-nowrap cursor-pointer"
                  title={`切换到「${suggestedWorkspace.label}」`}
                >
                  <Sparkles className="w-3.5 h-3.5" aria-hidden />
                  <span className="font-semibold whitespace-nowrap">{daypartText(daypart?.hint ?? DAYPART_PLACEHOLDER)}</span>
                  <span className="flex items-center gap-0.5 whitespace-nowrap">
                    {suggestedWorkspace.label}
                    <ArrowRight className="w-3 h-3" aria-hidden />
                  </span>
                </button>
              ) : (
                <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-muted/40 border border-border/40 shrink-0 whitespace-nowrap">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span className="font-semibold text-foreground text-xs whitespace-nowrap">
                    {daypartText(daypart?.hint ?? DAYPART_PLACEHOLDER)}
                  </span>
                </div>
              )
            ) : (
              <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-muted/40 border border-border/40 text-muted-foreground shrink-0 whitespace-nowrap">
                <span className="text-xs whitespace-nowrap">时段场景推荐已关闭</span>
              </div>
            )}
          </div>
        </HorizontalScrollFade>
      </div>

      {dramaOpen ? (
        <DramaMiniDialog open={dramaOpen} onOpenChange={setDramaOpen} initial={cinemaInitial} />
      ) : null}
      {pluginsOpen ? (
        <PluginSpotlightDialog open={pluginsOpen} onOpenChange={setPluginsOpen} items={pluginItems} />
      ) : null}
      {aiOpen ? (
        <AiFinderDialog open={aiOpen} onOpenChange={setAiOpen} sceneTrigger={initialSceneParam} />
      ) : null}
    </>
  )
}
