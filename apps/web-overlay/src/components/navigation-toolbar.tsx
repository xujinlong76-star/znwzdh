'use client'

/**
 * 首页顶部工具栏（从 navigation-content.tsx 拆出，2026-10-19 P1-2）。
 *
 * 只负责渲染搜索入口、探索矩阵、视图/密度/主题开关与多选入口。
 * 工作区过滤已迁至 HomeCapsuleRow（本文件不再接收 activeWorkspace /
 * onWorkspaceChange，2026-11-21 U-358 门禁修复：两者曾声明却从未使用）。
 *
 * 2026-11-21 顶栏收敛（原始需求第 1 条）：改造前右侧有 11 个纯图标按钮
 * （今日/小组件盒/热度/探索矩阵/工具箱/用户/快捷键/多选/字号/主题/DIY/GitHub），
 * 多数只有 title 没有可见标签，对新用户就是一排无字方块。
 *
 * 按「用得有多频繁」重分三层，**一个功能都没丢**：
 *  ① 主栏常驻：多选（批量唯一出口，不能埋）、DIY 排版（保留可见文字）、
 *     主题、通知+插件聚合；
 *  ② 通知聚合：今日中心 / 通知中心 / 小组件盒 / 插件市场 → 带红点的铃铛；
 *  ③ 个人菜单：用户中心 / 字号 / 工具箱 / 快捷键 / 签到 / 工作台 / GitHub。
 *
 * 所有纯图标入口一律补 Radix Tooltip（不是裸 title：title 有约 1s 系统延迟、
 * 键盘聚焦不显示，对可发现性帮助接近于零）。
 *
 * 「AI 找站」独立按钮已删除：SearchPalette 内部本就有 aiMode 双模式
 * （lib/search-ai-mode.ts 持久化），同一入口不该在一屏出现两次。
 *
 * 保留不变：选中态仍由 NavigationContent 持有，props 注入。
 */
import { memo } from 'react'
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
  Store,
  CheckSquare,
  ListChecks,
  Sparkles,
  User,
  CalendarDays,
  Puzzle,
  SlidersHorizontal,
  Bell,
  MoreHorizontal,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { GithubIcon } from '@/components/icons'
import dynamic from 'next/dynamic'
import type { SiteConfig } from '@/types/site'
import { ModeToggle } from '@/components/mode-toggle'
import { FontSizeToggle } from '@/components/font-size-toggle'
import { cn } from '@/lib/utils'
import { trackDiyEvent } from '@/lib/navhub-api'
import { summarizeSelection } from '@/lib/selection'

/**
 * 搜索面板按需加载（与 not-found.tsx 同一范式）：SearchPalette 本体约 1,500 行、
 * 还拖着收藏/偏好/语义等依赖，静态引入会随首页首屏一起下发并超首屏预算，
 * 故只在客户端按需加载，加载期间用同高占位保持布局不跳。
 * 工具栏本身是客户端组件，可以内联 dynamic；服务端壳页面（分类页等）
 * 无法内联 ssr:false，仍走 @/components/search-palette-lazy 客户端包装。
 */
const SearchPalette = dynamic(
  () => import('@/components/search-palette').then((m) => m.SearchPalette),
  {
    ssr: false,
    loading: () => (
      <div className="h-11 rounded-xl border border-border/60 bg-muted/30" aria-busy="true">
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
  /** @deprecated AI 找站入口已并入 SearchPalette 的 AI 双模式，保留形参仅为兼容调用方 */
  onOpenAiFinder?: () => void
  /** 未读通知数（铃铛红点）；0 或缺省时只按 todayBadge 决定是否亮红点 */
  unreadNotifications?: number
}

/**
 * 带 Tooltip 的图标按钮包装。
 * 用 Radix Tooltip 而不是裸 title：后者有约 1s 系统延迟、样式不可控、
 * 键盘聚焦时不显示，对「一排无字图标」的可发现性帮助接近于零。
 */
function IconTip({
  label,
  children,
  side = 'bottom',
}: {
  label: string
  children: React.ReactNode
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
  unreadNotifications = 0,
}: NavigationToolbarProps) {
  const hasTodayAlert = Boolean(todayBadge && (todayBadge.urgentCount > 0 || todayBadge.todayCount > 0))
  // 采用上游把根节点从 <div> 改为语义化 <header>（可访问性改进）。
  return (
        <header className="sticky top-0 z-30 border-b border-border/40 bg-background/85 px-3 pt-[max(env(safe-area-inset-top,0px),0px)] shadow-2xs backdrop-blur-md dark:bg-background/80 sm:px-6">
          {/* 2026-11-21：md:flex-nowrap 在 768px 档会把「搜索 260px 最小宽 +
              右侧按钮簇 388px」硬塞进 768-48px 的可用宽里，整行顶出文档
              （实测 scrollWidth 940 > 768）。改为在 <1024px 允许换行：
              搜索框独占一行、按钮簇折到第二行，1024px 起恢复单行。 */}
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 lg:h-14 lg:flex-nowrap">
            {/* max-w 560 → 880：1440px 下搜索框右侧原有约 300px 死区
                （搜索框到 560 就截断、右侧按钮从 1151 才开始），顶栏像断开的两半。 */}
            <div className="flex flex-1 min-w-[260px] max-w-[880px] items-center gap-1.5 transition-all duration-300 ease-out">
              <div className="flex-1 min-w-0">
                {/* 山羊胡混合检索引擎 */}
                <SearchPalette siteConfig={siteConfig} placeholder="搜索站点、标签或拼音…（按 / 快速搜索）" />
              </div>
            </div>
            {/* 2026-11-21 顶栏收敛：11 个纯图标 → 4 个核心入口 + 2 个聚合菜单。
                每一项功能都还在，只是按使用频次分了层（见文件头注释）。 */}
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">

              {/* ① 多选模式：批量导出 / 复制 / 置顶的唯一出口，不能埋进菜单。 */}
              <IconTip label={selectionMode ? '退出多选模式（M）' : '多选模式：批量导出 / 复制 / 置顶（M）'}>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'relative hidden h-9 w-9 rounded-lg transition-colors sm:inline-flex',
                    selectionMode
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                  onClick={onToggleSelectMode}
                  aria-pressed={selectionMode}
                  aria-label="多选模式"
                >
                  <CheckSquare className="h-4 w-4" />
                  {selectionMode && selectedIds.length > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 rounded-full bg-primary px-1 font-mono text-xs leading-4 text-primary-foreground">
                      {selectedIds.length}
                    </span>
                  )}
                </Button>
              </IconTip>

              {selectionMode && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-auto gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  onClick={onSelectAllVisible}
                  title={summarizeSelection(selectedIds, visibleSiteCount) + '（点击全选当前可见站点）'}
                >
                  <ListChecks className="h-3.5 w-3.5" />
                  <span className="hidden xl:inline">{summarizeSelection(selectedIds, visibleSiteCount)}</span>
                </Button>
              )}

              <div className="mx-1 hidden h-4 w-px bg-border/60 sm:block" />

              {/* ② DIY 排版：保留可见文字。这是首屏最重要的个性化入口，
                  纯图标会让新用户找不到「怎么改这一页」（U-155 的结论不能推翻）。 */}
              {onOpenAppearanceGuide ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    trackDiyEvent('diy_appearance_click')
                    onOpenAppearanceGuide()
                  }}
                  className="relative flex h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  title="DIY 排版、外观与皮肤（打开外观向导小窗）"
                  aria-label="打开外观排版与新手向导小窗"
                >
                  <SlidersHorizontal className="h-4 w-4 shrink-0" />
                  <span className="hidden whitespace-nowrap text-xs leading-none sm:inline">DIY 排版</span>
                </Button>
              ) : null}

              {/* ③ 主题切换 */}
              <IconTip label="切换深浅主题">
                <div className="inline-flex">
                  <ModeToggle />
                </div>
              </IconTip>

              {/* ④ 通知 + 插件聚合（带红点）：把原先散落的「今日中心 / 小组件盒 /
                  通知」三项收成一个入口，避免它们各占一个图标位。 */}
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="relative h-9 w-9 rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                        aria-label={
                          unreadNotifications > 0
                            ? `通知与插件聚合，${unreadNotifications} 条未读`
                            : '通知与插件聚合'
                        }
                      >
                        <Bell className="h-4 w-4" />
                        {unreadNotifications > 0 || hasTodayAlert ? (
                          <span
                            aria-hidden="true"
                            className={cn(
                              'absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-background',
                              todayBadge && todayBadge.urgentCount > 0 ? 'bg-amber-500' : 'bg-primary',
                            )}
                          />
                        ) : null}
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6}>
                    {hasTodayAlert ? `通知与插件（今日 ${todayBadge?.todayCount ?? 0} 项）` : '通知与插件聚合'}
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-60 p-1.5">
                  <DropdownMenuLabel className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                    今日与通知
                  </DropdownMenuLabel>
                  {onOpenTodayCenter ? (
                    <DropdownMenuItem
                      onClick={onOpenTodayCenter}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-xs hover:bg-accent"
                    >
                      <CalendarDays className="h-4 w-4 shrink-0 text-sky-500" />
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">今日中心</span>
                        <span className="text-xs text-muted-foreground">
                          {todayBadge?.countdownLabel
                            ? `倒计时 ${todayBadge.countdownLabel}`
                            : todayBadge && todayBadge.todayCount > 0
                              ? `今日 ${todayBadge.todayCount} 项`
                              : '专注、简报、考试与连胜'}
                        </span>
                      </div>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem asChild className="min-h-10">
                    <Link href="/me/notifications" className="flex items-center gap-2.5 px-2 py-1.5 text-xs">
                      <Bell className="h-4 w-4 shrink-0 text-primary" />
                      <span className="font-medium text-foreground">
                        通知中心{unreadNotifications > 0 ? `（${unreadNotifications} 条未读）` : ''}
                      </span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1" />
                  <DropdownMenuLabel className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                    插件与组件
                  </DropdownMenuLabel>
                  {onOpenWidgetBox ? (
                    <DropdownMenuItem
                      onClick={onOpenWidgetBox}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-xs hover:bg-accent"
                    >
                      <Puzzle className="h-4 w-4 shrink-0 text-violet-500" />
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">桌面小组件盒</span>
                        <span className="text-xs text-muted-foreground">
                          {pinnedWidgetCount > 0 ? `已固定 ${pinnedWidgetCount} 个` : '按需小窗与角落固定微件'}
                        </span>
                      </div>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem asChild className="min-h-10">
                    <Link href="/marketplace" className="flex items-center gap-2.5 px-2 py-1.5 text-xs">
                      <Store className="h-4 w-4 shrink-0 text-rose-500" />
                      <span className="font-medium text-foreground">插件市场</span>
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* ⑤ 个人菜单：低频项（用户中心 / 字号 / 工具箱 / 快捷键 / 签到 /
                  偏好 / 工作台 / GitHub）全部下沉到这里。 */}
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full bg-muted/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label="个人菜单"
                      >
                        <User className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6}>
                    个人菜单（用户中心 / 字号 / 工具）
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-60 p-1.5">
                  <DropdownMenuLabel className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                    我的
                  </DropdownMenuLabel>
                  <DropdownMenuItem asChild className="min-h-10">
                    <Link href="/me" className="flex items-center gap-2.5 px-2 py-1.5 text-xs">
                      <User className="h-4 w-4 shrink-0 text-primary" />
                      <span className="font-medium text-foreground">用户中心</span>
                    </Link>
                  </DropdownMenuItem>
                  {/* 字号切换：设置一次就不再动的偏好，但可发现性不能丢——
                      放个人菜单第一屏并带说明文字。onSelect 阻止关闭，方便连点。 */}
                  <DropdownMenuItem
                    onSelect={(e) => e.preventDefault()}
                    className="flex cursor-default items-center gap-2.5 px-2 py-1.5 text-xs"
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center font-mono text-[10px] font-bold text-muted-foreground">
                      Aa
                    </span>
                    <div className="flex flex-1 items-center justify-between gap-2">
                      <span className="font-medium text-foreground">字号</span>
                      <FontSizeToggle />
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1" />
                  <DropdownMenuLabel className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                    工具
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={onOpenTools}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-xs hover:bg-accent"
                  >
                    <Wrench className="h-4 w-4 shrink-0 text-emerald-500" />
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">开发者微工具箱</span>
                      <span className="text-xs text-muted-foreground">Base64 / JSON / 正则（T）</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={onOpenShortcuts}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-xs hover:bg-accent"
                  >
                    <HelpCircle className="h-4 w-4 shrink-0 text-sky-500" />
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">快捷键指南</span>
                      <span className="text-xs text-muted-foreground">全景快捷键列表（?）</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1" />
                  <DropdownMenuItem asChild className="min-h-10">
                    <Link href="/me/growth" className="flex items-center gap-2.5 px-2 py-1.5 text-xs">
                      <Sparkles className="h-4 w-4 shrink-0 text-amber-500" />
                      <span className="font-medium text-foreground">签到与成长任务</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="min-h-10">
                    <Link href="/custom" className="flex items-center gap-2.5 px-2 py-1.5 text-xs">
                      <LayoutGrid className="h-4 w-4 shrink-0 text-emerald-500" />
                      <span className="font-medium text-foreground">模块化工作台</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="min-h-10">
                    <Link
                      href="https://github.com/tianyaxiang/NavSphere"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2.5 px-2 py-1.5 text-xs"
                    >
                      <GithubIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="font-medium text-foreground">GitHub 开源仓库</span>
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* ⑥ 「更多」窄屏折叠：<lg 时主栏放不下的探索入口收在这里。
                  ≥lg 时图标隐藏，但菜单内容在主栏与聚合菜单里都可达。 */}
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground lg:hidden"
                        aria-label="更多导航与探索"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6}>
                    更多导航与探索
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-56 p-1.5">
                  <DropdownMenuItem asChild className="min-h-10">
                    <Link href="/hot" className="flex items-center gap-2.5 px-2 py-1.5 text-xs">
                      <Flame className="h-4 w-4 shrink-0 text-amber-500" />
                      <span className="font-medium text-foreground">热度趋势榜</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="min-h-10">
                    <Link href="/graph" className="flex items-center gap-2.5 px-2 py-1.5 text-xs">
                      <Network className="h-4 w-4 shrink-0 text-pink-500" />
                      <span className="font-medium text-foreground">技术生态图谱</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="min-h-10">
                    <Link href="/algorithms" className="flex items-center gap-2.5 px-2 py-1.5 text-xs">
                      <Cpu className="h-4 w-4 shrink-0 text-cyan-500" />
                      <span className="font-medium text-foreground">前沿算法实验室</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1" />
                  <DropdownMenuItem asChild className="min-h-10">
                    <Link href="/tags" className="flex items-center gap-2.5 px-2 py-1.5 text-xs">
                      <Tags className="h-4 w-4 shrink-0 text-indigo-500" />
                      <span className="font-medium text-foreground">全景标签云</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="min-h-10">
                    <Link href="/videos" className="flex items-center gap-2.5 px-2 py-1.5 text-xs">
                      <MonitorPlay className="h-4 w-4 shrink-0 text-blue-500" />
                      <span className="font-medium text-foreground">视频教程导航</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="min-h-10">
                    <Link href="/import" className="flex items-center gap-2.5 px-2 py-1.5 text-xs">
                      <Upload className="h-4 w-4 shrink-0 text-emerald-500" />
                      <span className="font-medium text-foreground">导入浏览器书签</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="min-h-10">
                    <Link href="/submit" className="flex items-center gap-2.5 px-2 py-1.5 text-xs">
                      <Send className="h-4 w-4 shrink-0 text-amber-500" />
                      <span className="font-medium text-foreground">收录与提交网站</span>
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 移动端菜单 */}
              <IconTip label="打开菜单">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground md:hidden"
                  onClick={onToggleSidebar}
                  aria-label="打开菜单"
                  /* 上游（github/main）新增的门禁无障碍属性：让读屏知道抽屉
                     当前开/关、控制的是哪一个区域。保留。 */
                  aria-expanded={isSidebarOpen}
                  aria-controls="mobile-nav-drawer"
                >
                  <Menu className="h-4 w-4" />
                </Button>
              </IconTip>
            </div>
          </div>
        </header>

  )
})
