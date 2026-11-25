'use client'

/**
 * 首页顶部工具栏（融合升级 2026-11-24）：
 *   1. 三合一唯一融合搜索窗（全站检索 × AI 找站 × 找相似）；
 *   2. 效率三合一入口（📅 今日与效率：今日专注/简报/考试/接力 + 桌面微件 + 极客微工具）；
 *   3. 探索矩阵升级为分组 2 列网格大菜单（零超长滚动，与侧栏唯一收口）；
 *   4. 外观与阅读聚合浮层（🎨 深浅主题 / 字号 / 高对比 / 长辈模式 / 密度），移动端保留一键 AA 字号与 DIY 排版。
 */
import { memo, type ReactNode } from 'react'
import Link from 'next/link'
import { Button } from '@/registry/new-york/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/registry/new-york/ui/dropdown-menu'
import {
  HelpCircle,
  MonitorPlay,
  Send,
  Flame,
  Tags,
  Wrench,
  Menu,
  Network,
  Upload,
  Cpu,
  LayoutGrid,
  Layers,
  Compass,
  Store,
  CheckSquare,
  ListChecks,
  Sparkles,
  User,
  Clapperboard,
  Newspaper,
  GraduationCap,
  CalendarDays,
  Puzzle,
  SlidersHorizontal,
  Sun,
  Moon,
  Radar,
  Search,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { GithubIcon } from '@/components/icons'
import dynamic from 'next/dynamic'
import type { SiteConfig } from '@/types/site'
import { FontSizeToggle } from '@/components/font-size-toggle'
import { AppearanceQuickPopover } from '@/components/appearance-quick-popover'
import { SiteDisplayModeSwitcher } from '@/components/site-display-mode-switcher'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { trackDiyEvent } from '@/lib/navhub-api'
import { summarizeSelection } from '@/lib/selection'

/**
 * 带 Tooltip 的图标按钮包装（顶栏收敛 2026-11-21）：用 Radix Tooltip 而不是裸 title，
 * title 有约 1s 系统延迟、键盘聚焦不显示。快捷键提示精简为「（M）」短写法。
 */
function IconTip({
  label,
  children,
  side = 'bottom',
}: {
  label: string
  children: ReactNode
  side?: 'top' | 'bottom'
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

const SearchPalette = dynamic(
  () => import('@/components/search-palette').then((m) => m.SearchPalette),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-10 items-center gap-2 rounded-xl border border-border-strong bg-background/90 pl-3 pr-2 shadow-xs"
        aria-busy="true"
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">搜索站点、标签或拼音…</span>
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground shrink-0">
          <span className="inline-flex h-6 items-center gap-0.5 rounded-full px-1.5">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            <span>AI</span>
          </span>
          <span className="inline-flex h-6 items-center gap-0.5 rounded-full px-1.5">
            <Radar className="h-3 w-3" aria-hidden="true" />
            <span>相似</span>
          </span>
        </span>
        <span className="sr-only">正在加载搜索面板…</span>
      </div>
    ),
  }
)

export interface NavigationToolbarProps {
  siteConfig: SiteConfig
  onToggleSidebar: () => void
  isSidebarOpen: boolean
  onOpenTools: () => void
  onOpenShortcuts: () => void
  selectionMode: boolean
  selectedIds: string[]
  visibleSiteCount: number
  onToggleSelectMode: () => void
  onSelectAllVisible: () => void
  todayBadge?: {
    todayCount: number
    urgentCount: number
    countdownLabel: string | null
  }
  pinnedWidgetCount?: number
  onOpenTodayCenter?: () => void
  onOpenWidgetBox?: () => void
  onOpenAppearanceGuide?: () => void
  onOpenAiFinder?: (mode?: 'ai' | 'similar', initialQuery?: string) => void
  unreadNotifications?: number
}

// P0-2：包 memo——父组件回调已全部 useCallback 化，浅比较才能生效。
export const NavigationToolbar = memo(function NavigationToolbar({
  siteConfig,
  onToggleSidebar,
  isSidebarOpen,
  onOpenTools,
  onOpenShortcuts,
  selectionMode,
  selectedIds,
  visibleSiteCount,
  onToggleSelectMode,
  onSelectAllVisible,
  todayBadge,
  pinnedWidgetCount = 0,
  onOpenTodayCenter,
  onOpenWidgetBox,
  onOpenAppearanceGuide,
  onOpenAiFinder,
}: NavigationToolbarProps) {
  const hasTodayAlert = Boolean(todayBadge && (todayBadge.urgentCount > 0 || todayBadge.todayCount > 0))
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <header className="sticky top-0 bg-background/85 dark:bg-background/80 backdrop-blur-md z-30 px-3 sm:px-6 pt-[max(env(safe-area-inset-top,0px),0px)] border-b border-border/40 shadow-2xs">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 md:h-14 lg:flex-nowrap">
        <div className="flex flex-1 min-w-[260px] max-w-[880px] items-center gap-1.5 transition-all duration-300 ease-out">
          <div className="flex-1 min-w-0">
            {/* 山羊胡三合一融合检索引擎（全站检索 × AI 找站 × 找相似） */}
            <SearchPalette
              siteConfig={siteConfig}
              placeholder="搜索站点、标签或拼音…"
              onOpenDiscoveryDialog={onOpenAiFinder}
            />
          </div>
          {/* 网址展示风格自由切换（7 大主流模式） */}
          <SiteDisplayModeSwitcher />
        </div>

        {/* 右侧工具组（2026-11-24 融合瘦身）：
            360px/390px 移动端行内固定 7 个 44px 按钮（今日 / 探索 / 热榜 / 字号 / 外观 / DIY 排版 / 菜单），
            7×44 + 6×2 = 320px ≤ 336px，宽裕零溢出；桌面端仅保留 7 组核心控台。 */}
        <div data-testid="nav-toolbar-actions" className="flex shrink-0 flex-wrap items-center justify-end">
          <div data-testid="toolbar-button-row" className="shrink-0 flex items-center gap-0.5 sm:gap-1.5">
            {/* 📅 效率三合一入口（今日中心 + 桌面小组件盒 + 极客微工具箱统一收纳） */}
            {onOpenTodayCenter ? (
              <Button
                type="button"
                variant="ghost"
                onClick={onOpenTodayCenter}
                className="relative flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg px-0 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors min-[1536px]:w-auto min-[1536px]:flex-row min-[1536px]:gap-1.5 min-[1536px]:px-2.5"
                title={
                  todayBadge?.countdownLabel
                    ? `今日与效率中心（${todayBadge.countdownLabel} · 含桌面微件与微工具 T）`
                    : '今日与效率中心：专注、简报、考试、桌面微件与极客微工具 (T)'
                }
                aria-label="打开今日中心小窗"
              >
                <CalendarDays className="h-4 w-4 shrink-0" />
                <span className="hidden whitespace-nowrap text-[10px] leading-none sm:text-xs min-[1536px]:inline">
                  {todayBadge && todayBadge.todayCount > 0 ? `今日 ${todayBadge.todayCount} 项` : '今日效率'}
                </span>
                {hasTodayAlert ? (
                  <span
                    aria-hidden="true"
                    className={
                      todayBadge && todayBadge.urgentCount > 0
                        ? 'absolute right-2 top-2 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-background'
                        : 'absolute right-2 top-2 h-2 w-2 rounded-full bg-primary ring-2 ring-background'
                    }
                  />
                ) : pinnedWidgetCount > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute right-2 top-2 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background"
                  />
                ) : null}
              </Button>
            ) : null}

            {/* 🧭 探索矩阵（2 列分组网格大菜单，与侧栏唯一收口，零超长滚动） */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                  title="探索矩阵与全站导航"
                  aria-label="探索矩阵与导航工具箱"
                >
                  <Compass className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-[min(460px,calc(100vw-1.5rem))] p-2.5 bg-popover text-popover-foreground border border-border shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {/* 左列：发现与认知 */}
                  <div className="space-y-0.5">
                    <DropdownMenuLabel className="text-[11px] text-muted-foreground font-semibold px-2 py-1">
                      发现与认知矩阵
                    </DropdownMenuLabel>
                    <DropdownMenuItem asChild>
                      <Link href="/similar" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                        <Radar className="h-4 w-4 text-primary shrink-0" />
                        <div className="min-w-0 flex flex-col">
                          <span className="font-medium text-foreground">相似网站发现</span>
                          <span className="truncate text-[11px] text-muted-foreground">输入网址秒查 5 维平替</span>
                        </div>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/hot" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                        <Flame className="h-4 w-4 text-amber-500 shrink-0" />
                        <div className="min-w-0 flex flex-col">
                          <span className="font-medium text-foreground">热度趋势榜</span>
                          <span className="truncate text-[11px] text-muted-foreground">全站高频与新品趋势</span>
                        </div>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/graph" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                        <Network className="h-4 w-4 text-pink-500 shrink-0" />
                        <div className="min-w-0 flex flex-col">
                          <span className="font-medium text-foreground">技术生态图谱</span>
                          <span className="truncate text-[11px] text-muted-foreground">架构选型与平替网络</span>
                        </div>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/algorithms" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                        <Cpu className="h-4 w-4 text-cyan-500 shrink-0" />
                        <div className="min-w-0 flex flex-col">
                          <span className="font-medium text-foreground">前沿算法实验室</span>
                          <span className="truncate text-[11px] text-muted-foreground">LinUCB / 双曲 / E2EE</span>
                        </div>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/collections" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                        <Layers className="h-4 w-4 text-violet-500 shrink-0" />
                        <span className="font-medium text-foreground">精选专题合集</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/tags" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                        <Tags className="h-4 w-4 text-indigo-500 shrink-0" />
                        <span className="font-medium text-foreground">全景标签云</span>
                      </Link>
                    </DropdownMenuItem>
                  </div>

                  {/* 右列：每日回访与生态 */}
                  <div className="space-y-0.5 sm:border-l sm:border-border/50 sm:pl-2">
                    <DropdownMenuLabel className="text-[11px] text-muted-foreground font-semibold px-2 py-1">
                      每日回访与社区生态
                    </DropdownMenuLabel>
                    <DropdownMenuItem asChild>
                      <Link href="/drama" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                        <Clapperboard className="h-4 w-4 text-rose-500 shrink-0" />
                        <div className="min-w-0 flex flex-col">
                          <span className="font-medium text-foreground">短剧专区</span>
                          <span className="truncate text-[11px] text-muted-foreground">热门短剧与追剧清单</span>
                        </div>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/brief" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                        <Newspaper className="h-4 w-4 text-sky-500 shrink-0" />
                        <div className="min-w-0 flex flex-col">
                          <span className="font-medium text-foreground">每日简报</span>
                          <span className="truncate text-[11px] text-muted-foreground">全网热点一页读完</span>
                        </div>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/exam" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                        <GraduationCap className="h-4 w-4 text-violet-500 shrink-0" />
                        <div className="min-w-0 flex flex-col">
                          <span className="font-medium text-foreground">考试日历</span>
                          <span className="truncate text-[11px] text-muted-foreground">备考节点与倒计时</span>
                        </div>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/marketplace" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                        <Store className="h-4 w-4 text-rose-500 shrink-0" />
                        <div className="min-w-0 flex flex-col">
                          <span className="font-medium text-foreground">插件市场</span>
                          <span className="truncate text-[11px] text-muted-foreground">社区网址包与扩展</span>
                        </div>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/custom" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                        <LayoutGrid className="h-4 w-4 text-emerald-500 shrink-0" />
                        <span className="font-medium text-foreground">模块化工作台</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/videos" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                        <MonitorPlay className="h-4 w-4 text-blue-500 shrink-0" />
                        <span className="font-medium text-foreground">视频教程导航</span>
                      </Link>
                    </DropdownMenuItem>
                  </div>
                </div>

                <DropdownMenuSeparator className="my-2" />

                {/* 底部快捷动作区（工具 / 书签 / 投稿 / 移动端专属项） */}
                <div className="grid grid-cols-2 gap-1">
                  <DropdownMenuItem onClick={() => onOpenTools()} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                    <Wrench className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    <span className="font-medium text-foreground truncate">微工具箱 (T)</span>
                  </DropdownMenuItem>
                  {onOpenWidgetBox ? (
                    <DropdownMenuItem onClick={() => onOpenWidgetBox()} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Puzzle className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                      <span className="font-medium text-foreground truncate">桌面小组件盒</span>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onClick={() => onOpenShortcuts()} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                    <HelpCircle className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                    <span className="font-medium text-foreground truncate">快捷键指南 (?)</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/import" className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Upload className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      <span className="font-medium text-foreground truncate">导入浏览器书签</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/submit" className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Send className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      <span className="font-medium text-foreground truncate">投稿收录网站</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/preferences" className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Sparkles className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                      <span className="font-medium text-foreground truncate">个性化偏好</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onToggleSelectMode()} aria-pressed={selectionMode} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent sm:hidden">
                    <CheckSquare className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="font-medium text-foreground truncate">多选模式 (M)</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent sm:hidden">
                    {resolvedTheme === 'dark' ? (
                      <Moon className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                    ) : (
                      <Sun className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    )}
                    <span className="font-medium text-foreground truncate">切换深色 / 浅色</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      href="https://github.com/tianyaxiang/NavSphere"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent"
                    >
                      <GithubIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="font-medium text-foreground truncate">GitHub 开源仓库</span>
                    </Link>
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 🔥 热榜直达（M-02）：首屏/顶栏可见入口。原入口只在探索下拉与页脚——
                首页 2 个 /hot 链接其一 0×0、其一在约 57k px 页底，首屏无“热榜”字样；
                手机底部 tab 按 mobile-touch-targets 锁死不放热榜，故入口放顶栏。
                宽度账：移动端行内 7×44 + 6×2 = 320px ≤ 336px（360px 档），仍在预算内。 */}
            <Button
              asChild
              variant="ghost"
              className="relative flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg px-0 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors sm:w-auto sm:flex-row sm:gap-1.5 sm:px-2.5"
              title="热榜：全站高频与新品趋势"
              aria-label="热榜"
            >
              <Link href="/hot">
                <Flame className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                <span className="text-center text-[10px] leading-none whitespace-nowrap tracking-tight sm:text-xs sm:tracking-normal">
                  热榜
                </span>
              </Link>
            </Button>

            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 hidden lg:inline-flex"
            >
              <Link href="/me" title="用户中心" aria-label="用户中心">
                <User className="h-4 w-4" />
              </Link>
            </Button>

            {/* 多选模式（桌面端常驻，移动端收进探索菜单） */}
            <IconTip label={selectionMode ? '退出多选模式（M）' : '多选模式：批量导出 / 复制 / 置顶（M）'}>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'relative h-11 w-11 rounded-lg transition-colors hidden sm:inline-flex',
                  selectionMode
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                )}
                onClick={onToggleSelectMode}
                aria-pressed={selectionMode}
                aria-label="多选模式"
              >
                <CheckSquare className="h-4 w-4" />
                {selectionMode && selectedIds.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-xs leading-4 font-mono">
                    {selectedIds.length}
                  </span>
                )}
              </Button>
            </IconTip>

            {selectionMode && (
              <Button
                variant="ghost"
                size="sm"
                className="hidden h-9 w-auto gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground sm:inline-flex"
                onClick={onSelectAllVisible}
                title={summarizeSelection(selectedIds, visibleSiteCount) + '（点击全选当前可见站点）'}
              >
                <ListChecks className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">{summarizeSelection(selectedIds, visibleSiteCount)}</span>
              </Button>
            )}

            <div className="h-4 w-px bg-border/60 mx-1 hidden lg:block" />

            {/* 移动端 <sm 保留独立一键 AA 字号放大（A13 长辈刚需）；桌面端收敛进右侧「外观与阅读」浮层 */}
            <div className="inline-flex sm:hidden">
              <FontSizeToggle />
            </div>

            {/* 🎨 外观与阅读紧凑聚合浮层（整合字号 / 高对比 / 深浅主题 / 长辈模式 / 卡片密度） */}
            <AppearanceQuickPopover onOpenAppearanceGuide={onOpenAppearanceGuide} />

            {/* DIY 排版入口（全宽度可见文字标签） */}
            {onOpenAppearanceGuide ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  trackDiyEvent('diy_appearance_click')
                  onOpenAppearanceGuide()
                }}
                className="relative flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg px-0 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors sm:w-auto sm:flex-row sm:gap-1.5 sm:px-2.5"
                title="DIY 排版、外观与皮肤（打开外观向导小窗）"
                aria-label="打开外观排版与新手向导小窗"
              >
                <SlidersHorizontal className="h-4 w-4 shrink-0" />
                <span className="text-center text-[10px] leading-none whitespace-nowrap tracking-tight sm:text-xs sm:tracking-normal">DIY 排版</span>
              </Button>
            ) : null}

            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-lg md:hidden text-muted-foreground hover:text-foreground"
              onClick={() => onToggleSidebar()}
              title="打开菜单"
              aria-label="打开菜单"
              aria-expanded={isSidebarOpen}
              aria-controls="mobile-nav-drawer"
            >
              <Menu className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
})
