'use client'

/**
 * 首页首屏合并胶囊行（2026-11-20 首屏瘦身）：
 * 将「工作区胶囊行（WorkspaceFilter）」与「运营胶囊行（HomeMicroStrip）」
 * 合并为一行，替代原来上下两行（~63px + ~46px），单行约 44px。
 *
 * - 工作区 5 个 Tab（全部探索 / 研发全栈 / UI & 设计 / AI 实验室 / 效率创作）
 *   与运营 4 个胶囊（短剧 / AI 找站 / 插件精选 / 向导）同处一个
 *   HorizontalScrollFade 横向滚动行（滚轮横滚、mask 渐隐、左右箭头）；
 * - <1024px（lg 以下）只留「全部探索」＋「AI 找站」两个入口 inline，
 *   其余进「更多」折叠菜单（DropdownMenu，点击触发与 inline 同款动作）；
 * - 时段场景推荐（daypart）沿用 WorkspaceFilter 同款逻辑（useClientHour，
 *   服务端快照恒 null，水合安全），仅 lg+ 显示；
 * - 三个小窗（短剧 / 插件 / AI 找站）仍 dynamic({ ssr: false }) 按需加载，
 *   不进首屏包。
 *
 * 旧组件 workspace-filter.tsx / home-micro-strip.tsx 保留（daypart 与
 * 横向渐隐守卫读其源码），首页不再直接渲染它们。
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
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
  collectDramaContextSectionIds,
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
import { MARKETPLACE_CATEGORIES_PATH } from '@/lib/plugins/marketplace-categories'
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

  // 时段推荐（与 workspace-filter.tsx 同款接线，水合安全）：
  // 小时只在客户端算，服务端快照恒 null，首帧两边都渲染占位。
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
  const topPlugins = pluginItems?.slice(0, 2) ?? []
  /*
   * 短剧热榜默认移出全局首屏（2026-11-22）：
   * 只有影音/短剧分类上下文或 DIY 显式开启才放行。
   */
  const diyOptIn = useDramaHotlistOptIn()
  const dramaContextIds = collectDramaContextSectionIds([])
  const inDramaCategoryContext =
    dramaContextIds.size > 0 ||
    isDramaContextCategory(String(activeWorkspace ?? '')) ||
    activeWorkspace === 'short-drama'
  const showDrama =
    showDramaCapsule && dramaExposureAllowed({ inDramaCategoryContext, diyOptIn })

  // 工作区 Tab 键盘漫游（roving tabindex，←/→ 切换）——与 WorkspaceFilter 同款。
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

  // <1024px 折叠进「更多」的条目：除「全部探索」外的 4 个工作区 Tab，
  // 与除「AI 找站」外的运营胶囊（短剧 / 插件精选 / 向导）。
  const foldedWorkspaces = WORKSPACES.filter((ws) => ws.id !== 'all')

  return (
    <>
      {/* 2026-11-21 修横向溢出（1024px 实测 scrollWidth 1069 > 1024）：
          本行是 flex 容器，子项里有 shrink-0 的胶囊；根节点缺 min-w-0 时
          flex 子项不能收缩到容器宽，滚动行的 overflow-x-auto 就永不触发，
          整行把文档顶宽。补 min-w-0 后 scrollClassName 的横向滚动才真正生效。 */}
      <div className="flex min-w-0 items-center gap-2">
        <HorizontalScrollFade
          className="min-w-0 flex-1"
          scrollClassName="flex items-center gap-1.5 py-0.5 text-xs"
          ariaLabel="工作区与首页快捷功能"
          showArrows
        >
          {/* 工作区 Tab（roving tabindex） */}
          <div
            role="tablist"
            aria-label="工作区视图切换"
            onKeyDown={handleTabKeyDown}
            className="flex items-center gap-1.5 shrink-0"
          >
            {WORKSPACES.map((ws) => {
              const Icon = ws.icon
              const isActive = activeWorkspace === ws.id
              const isAll = ws.id === 'all'
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
                    !isAll && 'hidden lg:inline-flex',
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

          <span aria-hidden className="hidden lg:block h-4 w-px bg-border/60 shrink-0" />

          {/* 2026-11-21 清理重复入口（P0-3）：
              - 「AI 找站 | 场景」胶囊删除：搜索框内已有 [AI] 模式切换按钮
                （SearchPalette 的 aiMode 双模式），同一入口不该一屏出现两次。
              - 「今日短剧热榜 | 专区」胶囊移出本行：它是运营内容，不是「角色视角
                切换」，混在专业角色切换栏里让第二行语义变浑并被迫横向滚动。
                短剧入口已收口到左侧边栏底部「探索与专题」下拉（/drama 直达）。
              本行因此回归纯粹的工作区（角色）切换 + 插件/向导。 */}

          <div className="hidden lg:inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/45 px-2.5 text-foreground">
            <button
              type="button"
              onClick={() => setPluginsOpen(true)}
              className="inline-flex items-center gap-1 font-medium hover:text-primary cursor-pointer"
            >
              <Puzzle className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span>插件精选</span>
            </button>
            {topPlugins.map((plugin) => (
              <Link
                key={plugin.slug}
                href={`/marketplace/${encodeURIComponent(plugin.slug)}`}
                className="hidden sm:inline-block max-w-[110px] truncate rounded-full bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-primary"
              >
                {plugin.name}
              </Link>
            ))}
            <span aria-hidden="true" className="opacity-35">|</span>
            <Link
              href="/marketplace"
              className="shrink-0 text-[11px] font-medium text-muted-foreground hover:text-primary"
            >
              市场
            </Link>
            <Link
              href={MARKETPLACE_CATEGORIES_PATH}
              className="sr-only"
            >
              插件分类目录
            </Link>
          </div>

          {showGuideBadge && guidePending && onOpenGuideTab ? (
            <button
              type="button"
              onClick={onOpenGuideTab}
              className="hidden lg:inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/8 px-2.5 font-medium text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300 cursor-pointer"
            >
              <Compass className="h-3.5 w-3.5 shrink-0" />
              <span>向导与设首页</span>
            </button>
          ) : null}

          {/* 时段场景推荐（lg+ 才显示，与旧工作区行同款文案与动作） */}
          {/* 1024–1279px 是这一行最挤的档位。此前这段在 lg 起常驻且 shrink-0 +
            whitespace-nowrap，会把整行顶出视口（实测 1024px 时 scrollWidth 1069）。
            窄档直接不渲染它（与插件/向导胶囊同一策略），≥1280px 才显示完整文案；
            时段建议本身是锦上添花，不该以撑破布局为代价。 */}
        <div className="hidden min-w-0 shrink-0 items-center gap-2 whitespace-nowrap pl-1 text-xs text-muted-foreground xl:flex">
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

        {/* 「更多」折叠菜单：只在 <1024px（lg 以下）出现，收纳被折叠的入口 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex lg:hidden h-8 shrink-0 items-center gap-0.5 rounded-full border border-border/70 bg-muted/45 px-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer"
              aria-label="更多工作区与快捷功能"
            >
              <span>更多</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-1.5 shadow-xl bg-popover/95 backdrop-blur-md border border-border/80">
            <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1">
              工作区
            </DropdownMenuLabel>
            {foldedWorkspaces.map((ws) => {
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
                  <span className="text-xs text-muted-foreground">{ws.desc}</span>
                  {isActive ? <span className="ml-auto text-primary text-xs">当前</span> : null}
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1">
              快捷功能
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
