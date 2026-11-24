'use client'

/**
 * 首页顶部工具栏（从 navigation-content.tsx 拆出，2026-10-19 P1-2）。
 *
 * 只负责渲染搜索入口、探索矩阵、视图/密度/主题开关与多选入口；
 * 工作区过滤已迁至 HomeCapsuleRow（本文件不再接收 activeWorkspace /
 * onWorkspaceChange，2026-11-21 U-358 门禁修复：两者曾声明却从未使用）。
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
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { GithubIcon } from '@/components/icons'
import dynamic from 'next/dynamic'
import type { SiteConfig } from '@/types/site'
import { ModeToggle } from '@/components/mode-toggle'
import { FontSizeToggle } from '@/components/font-size-toggle'
import { HighContrastToggle } from '@/components/high-contrast-toggle'
import { SiteDisplayModeSwitcher } from '@/components/site-display-mode-switcher'
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
  onOpenAiFinder?: () => void
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
  // W8（2026-11-23 00:22 轮）：探索菜单内「切换主题」条目用，与 ModeToggle 同款三元式
  // （必须用 resolvedTheme：defaultTheme="system" 时 theme 是 'system'，见 mode-toggle.tsx）。
  const { resolvedTheme, setTheme } = useTheme()
  return (
        <header className="sticky top-0 bg-background/85 dark:bg-background/80 backdrop-blur-md z-30 px-3 sm:px-6 pt-[max(env(safe-area-inset-top,0px),0px)] border-b border-border/40 shadow-2xs">
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 md:h-14 md:flex-nowrap">
            <div className="flex flex-1 min-w-[260px] max-w-[620px] items-center gap-1.5 transition-all duration-300 ease-out">
              <div className="flex-1 min-w-0">
                {/* 山羊胡混合检索引擎：placeholder 保持精炼，`/` 快捷键改由独立 <kbd>/</kbd> 徽标提示，避免中窄屏被 [AI] 按钮劈断 */}
                <SearchPalette siteConfig={siteConfig} placeholder="搜索站点、标签或拼音…" />
              </div>
              {onOpenAiFinder ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onOpenAiFinder}
                  className="hidden sm:inline-flex h-10 shrink-0 items-center gap-1 rounded-lg border-primary/30 bg-primary/8 px-2.5 text-xs font-medium text-primary hover:bg-primary/15"
                  title="打开 AI 智能找站小窗"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>AI 找站</span>
                </Button>
              ) : null}
              {/* 网址展示风格自由切换（7 大主流模式：标准卡片 / 图标启动台 / 极客清单 / 极速胶囊 / 紧凑条形 / 视觉画廊 / 书签目录） */}
              <SiteDisplayModeSwitcher />
            </div>
            {/* U-382（2026-11-21）：行容器供 e2e/toolbar-360-overflow.spec.ts 直接量宽
                （data-testid）；旧探针 closest('div.overflow-hidden') 在 8ebc4b08
                重构后恒为 null。布局本身不改：gap-1.5 保留，窄屏溢出由
                d28b4b84（多选按钮 <sm 收进探索菜单）解决。 */}
            <div data-testid="toolbar-button-row" className="shrink-0 flex items-center gap-1.5">
              {/* 📅 今日中心小窗入口（A2：专注、考试提醒、简报、接力连胜统一收纳） */}
              {onOpenTodayCenter ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onOpenTodayCenter}
                  className="relative flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg px-0 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors min-[1536px]:w-auto min-[1536px]:flex-row min-[1536px]:gap-1.5 min-[1536px]:px-2.5"
                  title={todayBadge?.countdownLabel ? `今日中心（${todayBadge.countdownLabel}）` : '今日中心：专注、考试提醒、简报与连胜'}
                  aria-label="打开今日中心小窗"
                >
                  <CalendarDays className="h-4 w-4 shrink-0" />
                  {/* 可见文字标签（复用已 SSR 的 todayBadge.todayCount，0 新增请求/JS）：
                      <1536px 只留图标 + title Tooltip + 红点徽章，文字标签隐藏——
                      1280px 档文字标签 49px 会把搜索容器压窄、输入框只剩 18px（复核
                      2026-11-20 实测）；≥1536px 横排，与「AI 找站」按钮同式。todayCount
                      为 0 时只写「今日」，不谎报计数。 */}
                  <span className="hidden whitespace-nowrap text-[10px] leading-none sm:text-xs min-[1536px]:inline">
                    {todayBadge && todayBadge.todayCount > 0 ? `今日 ${todayBadge.todayCount} 项` : '今日'}
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
                  ) : null}
                </Button>
              ) : null}

              {/* 🧩 桌面小组件盒小窗入口（A3：按需小窗与角落固定微件） */}
              {/* U-155（2026-11-19）：<390px 时收进探索菜单（下方「桌面小组件盒」条目），
                  只为给外观/DIY 按钮腾出 44px；≥390px 恢复显示。小组件盒是桌面向功能
                  （钉到桌面角落），小屏低频，且菜单条目保留入口，不丢功能。
                  U-382（2026-11-21）订正：上文旧注「8×44px + 7×2px 间隙 = 366px」
                  「8×44px + 14px = 366px 恰好占满」与代码不符——右组 gap-1.5 = 6px，
                  且 d28b4b84 已把多选按钮 <sm 收进探索菜单；现宽度账：360px 行内
                  6 钮 6×44+5×6 = 294px ≤ 336px、390px 行内 7 钮 7×44+6×6 = 344px
                  ≤ 366px，菜单按钮不再被挤出。 */}
              {onOpenWidgetBox ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onOpenWidgetBox}
                  className="relative hidden h-11 w-11 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors min-[390px]:inline-flex"
                  title="打开桌面小组件盒（支持钉到桌面角落）"
                  aria-label="打开桌面小组件盒"
                >
                  <Puzzle className="h-4 w-4" />
                  {pinnedWidgetCount > 0 ? (
                    <span
                      aria-hidden="true"
                      className="absolute right-2 top-2 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background"
                    />
                  ) : null}
                </Button>
              ) : null}
              {/* 发现与热度：1280–1535px 收进探索菜单以保障搜索框充裕可读宽度，≥1536px 独立展示 */}
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-11 w-11 rounded-lg text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors hidden min-[1536px]:inline-flex"
              >
                <Link href="/hot" aria-label="热度榜" title="热度趋势与新品榜">
                  <Flame className="h-4 w-4" />
                </Link>
              </Button>

              {/* 探索功能矩阵下拉菜单 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                    title="探索矩阵与导航工具箱"
                    aria-label="探索矩阵与导航工具箱"
                  >
                    <Compass className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 p-1.5 shadow-xl bg-popover/95 backdrop-blur-md border border-border/80">
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1 min-[1536px]:hidden">
                    工具与效率
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => onOpenTools()} className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent min-[1536px]:hidden">
                    <Wrench className="h-4 w-4 text-emerald-500 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">开发者微工具箱</span>
                      <span className="text-xs text-muted-foreground">Base64 / JSON / 正则 (T)</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenShortcuts()} className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent min-[1536px]:hidden">
                    <HelpCircle className="h-4 w-4 text-sky-500 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">快捷键指南</span>
                      <span className="text-xs text-muted-foreground">全景快捷键列表 (?)</span>
                    </div>
                  </DropdownMenuItem>
                  {/* C-W7-5（2026-11-21，待雷达落号）：多选按钮 <sm 收进探索菜单（工具栏内
                      按钮 <640px 隐藏，见下方多选按钮注释）；≥sm 该条目隐藏，
                      按钮恢复显示。点击路径与工具栏按钮一致。 */}
                  <DropdownMenuItem onClick={() => onToggleSelectMode()} aria-pressed={selectionMode} className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent sm:hidden">
                    <CheckSquare className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">多选模式</span>
                      <span className="text-xs text-muted-foreground">批量导出 / 复制 / 置顶 (M)</span>
                    </div>
                  </DropdownMenuItem>
                  {/* W8（2026-11-23 00:22 轮，协调员裁决）：主题切换 <sm 收进探索菜单
                      （工具栏内按钮 <640px 隐藏，见下方 ModeToggle 注释）；≥sm 该条目
                      隐藏，按钮恢复显示。点击路径与 ModeToggle 一致：resolvedTheme
                      深色↔浅色互切；图标按当前主题用 Sun（浅色）/ Moon（深色）。 */}
                  <DropdownMenuItem onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')} className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent sm:hidden">
                    {resolvedTheme === 'dark' ? (
                      <Moon className="h-4 w-4 text-indigo-500 shrink-0" />
                    ) : (
                      <Sun className="h-4 w-4 text-amber-500 shrink-0" />
                    )}
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">切换主题</span>
                      <span className="text-xs text-muted-foreground">深色 / 浅色</span>
                    </div>
                  </DropdownMenuItem>
                  {/* U-155（2026-11-19）：小组件盒 <390px 的工具栏内替代入口（工具栏按钮
                      在该宽度下隐藏，见上方注释）；≥390px 该条目隐藏，按钮恢复显示。 */}
                  {onOpenWidgetBox ? (
                    <DropdownMenuItem onClick={() => onOpenWidgetBox()} className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent min-[390px]:hidden">
                      <Puzzle className="h-4 w-4 text-violet-500 shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">桌面小组件盒</span>
                        <span className="text-xs text-muted-foreground">按需小窗与角落固定微件</span>
                      </div>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem asChild className="min-[1536px]:hidden">
                    <Link href="/hot" className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Flame className="h-4 w-4 text-amber-500 shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">热度趋势榜</span>
                        <span className="text-xs text-muted-foreground">全站高频流行站点</span>
                      </div>
                    </Link>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator className="my-1 min-[1536px]:hidden" />

                  <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1">
                    认知与前沿矩阵
                  </DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href="/graph" className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Network className="h-4 w-4 text-pink-500 shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">技术生态图谱</span>
                        <span className="text-xs text-muted-foreground">架构选型与平替网络</span>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/algorithms" className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Cpu className="h-4 w-4 text-cyan-500 shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">前沿算法实验室</span>
                        <span className="text-xs text-muted-foreground">LinUCB / 双曲 / E2EE</span>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/custom" className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <LayoutGrid className="h-4 w-4 text-emerald-500 shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">模块化工作台</span>
                        <span className="text-xs text-muted-foreground">自由拖拽与小组件排版</span>
                      </div>
                    </Link>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator className="my-1" />

                  <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1">
                    每日回访
                  </DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href="/drama" className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Clapperboard className="h-4 w-4 text-rose-500 shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">短剧专区</span>
                        <span className="text-xs text-muted-foreground">热门短剧与追剧清单</span>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/brief" className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Newspaper className="h-4 w-4 text-sky-500 shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">每日简报</span>
                        <span className="text-xs text-muted-foreground">全网热点一页读完</span>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/exam" className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <GraduationCap className="h-4 w-4 text-violet-500 shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">考试日历</span>
                        <span className="text-xs text-muted-foreground">国考倒计时与备考提醒</span>
                      </div>
                    </Link>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator className="my-1" />

                  <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1">
                    全景与发现
                  </DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href="/collections" className="flex items-center gap-2.5 min-h-11 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Layers className="h-4 w-4 text-violet-500 shrink-0" />
                      <span className="font-medium text-foreground">精选专题合集</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/tags" className="flex items-center gap-2.5 min-h-11 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Tags className="h-4 w-4 text-indigo-500 shrink-0" />
                      <span className="font-medium text-foreground">全景标签云</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/videos" className="flex items-center gap-2.5 min-h-11 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <MonitorPlay className="h-4 w-4 text-blue-500 shrink-0" />
                      <span className="font-medium text-foreground">视频教程导航</span>
                    </Link>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator className="my-1" />

                  <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1">
                    社区与工具
                  </DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href="/import" className="flex items-center gap-2.5 min-h-11 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Upload className="h-4 w-4 text-emerald-500 shrink-0" />
                      <span className="font-medium text-foreground">导入浏览器书签</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/marketplace" className="flex items-center gap-2.5 min-h-11 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Store className="h-4 w-4 text-rose-500 shrink-0" />
                      <span className="font-medium text-foreground">插件市场（社区共享）</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/submit" className="flex items-center gap-2.5 min-h-11 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Send className="h-4 w-4 text-amber-500 shrink-0" />
                      <span className="font-medium text-foreground">收录与提交网站</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/preferences" className="flex items-center gap-2.5 min-h-11 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Sparkles className="h-4 w-4 text-violet-500 shrink-0" />
                      <span className="font-medium text-foreground">我的偏好（个性化画像）</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="min-[1536px]:hidden">
                    <Link
                      href="https://github.com/tianyaxiang/NavSphere"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2.5 min-h-11 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent"
                    >
                      <GithubIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium text-foreground">GitHub 开源仓库</span>
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="h-4 w-px bg-border/60 mx-1 hidden min-[1536px]:block" />

              {/* 开发者极速微工具箱按钮：1280–1535px 收进探索菜单，≥1536px 独立展示 */}
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors hidden min-[1536px]:inline-flex"
                onClick={() => onOpenTools()}
                title="打开内置微工具箱 (快捷键: T)"
                aria-label="微工具箱"
              >
                <Wrench className="h-4 w-4" />
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

              {/* 快捷键指南按钮：1280–1535px 收进探索菜单，≥1536px 独立展示 */}
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors hidden min-[1536px]:inline-flex"
                onClick={() => onOpenShortcuts()}
                title="快捷键全景指南 (快捷键: ?)"
                aria-label="快捷键指南"
              >
                <HelpCircle className="h-4 w-4" />
              </Button>

              {/* 多选：批量导出 / 复制 / 置顶的入口（此前只有孤立的操作坞，没有任何入口）。
                  C-W7-5（2026-11-21，待雷达落号）：<sm 时按钮收进探索菜单（同文件上方「多选模式」
                  条目），行宽 344px → 294px ≤ 336px；≥sm 按钮恢复显示。 */}
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "relative h-11 w-11 rounded-lg transition-colors hidden sm:inline-flex",
                  selectionMode
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
                onClick={onToggleSelectMode}
                aria-pressed={selectionMode}
                title={selectionMode ? '退出多选模式（快捷键 M）' : '多选模式：批量导出 / 复制 / 置顶（快捷键 M）'}
                aria-label="多选模式"
              >
                <CheckSquare className="h-4 w-4" />
                {selectionMode && selectedIds.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-xs leading-4 font-mono">
                    {selectedIds.length}
                  </span>
                )}
              </Button>

              {/* C-W7-5（2026-11-21，待雷达落号）：全选按钮 <sm 隐藏（否则多选态下 360px
                  行宽仍为 344px）；全选入口保留在多选操作坞（BatchOperationDock「全选 (N)」）。 */}
              {selectionMode && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden h-9 w-auto rounded-lg gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground sm:inline-flex"
                  onClick={onSelectAllVisible}
                  title={summarizeSelection(selectedIds, visibleSiteCount) + '（点击全选当前可见站点）'}
                >
                  <ListChecks className="h-3.5 w-3.5" />
                  <span className="hidden xl:inline">{summarizeSelection(selectedIds, visibleSiteCount)}</span>
                </Button>
              )}

              <div className="h-4 w-px bg-border/60 mx-1 hidden lg:block" />
              {/* 字号切换全尺寸可见（A13）：保留手机 1 键放大，不把长辈高频需求埋深 */}
              <div className="inline-flex"><FontSizeToggle /></div>
              {/* 高对比开关（2026-11-23 00:22 轮 W3）：与字号开关并排，全尺寸可见，
                  不收进探索菜单。W8 同轮裁决（协调员定）：高对比加入后 360px 行由
                  6 钮 294px 变 7 钮 344px，超 336px 可用宽 8px；腾出的 44px 来自
                  主题按钮——ModeToggle 在 <sm 收进探索菜单（上方「切换主题」
                  条目），≥sm 恢复显示；主题不是长辈高频需求，且外观向导弹窗内
                  已有 ModeToggle（appearance-guide-dialog.tsx:225），功能不丢。
                  宽度账回到 360px 行 6 钮 6×44+5×6 = 294px ≤ 336px，
                  390px 行 7 钮 7×44+6×6 = 344px ≤ 366px；e2e/toolbar-360-overflow.spec.ts 的
                  「行不溢出」断言不再红，C-W7-5 修掉的菜单按钮裁切不回归。 */}
              <div className="inline-flex"><HighContrastToggle /></div>
              {/* W8（2026-11-23 00:22 轮）：主题切换 <sm 收进探索菜单（菜单内「切换主题」
                  条目），≥sm 恢复显示。ModeToggle 仍在 HighContrastToggle 之后
                  （test/high-contrast.test.ts 的挂载顺序守卫依赖此顺序）。 */}
              <div className="hidden sm:inline-flex"><ModeToggle /></div>
              {/* U-155 方案 A（2026-11-19）：纯图标改为图标 + 可见文字标签「DIY 排版」，
                  让 DIY 入口首屏可见可识别；<sm 沿用「今日」按钮的上下叠排（图标上、
                  文字下），仍占 44px 宽；≥sm 横排，与「AI 找站」按钮同式。
                  360px 宽度账（2026-11-23 00:22 轮 W8 更新：右组 gap-1.5 = 6px）：
                  高对比开关加入后 360px 行一度 7×44px + 6×6px = 344px > 360−24px
                  可用宽，菜单按钮右缘会被裁掉 8px；W8 裁决把主题按钮 <sm 收进
                  探索菜单，360px 行回到 6×44px + 5×6px = 294px ≤ 336px；
                  390px 时小组件盒恢复显示，7×44px + 6×6px = 344px ≤ 366px。
                  C-W7-5：多选按钮 <sm 收进探索菜单。点击路径不动：仍打开
                  外观向导小窗（默认 appearance 页签），底部「开启 DIY」进编排态。 */}
              {onOpenAppearanceGuide ? (
                <Button
                  type="button"
                  variant="ghost"
                  // U-155：先报后开（fire-and-forget，绝不阻塞向导打开）
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
              <div className="h-4 w-px bg-border/60 mx-1 hidden min-[1536px]:block" />
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-11 w-11 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 hidden min-[1536px]:inline-flex"
              >
                <Link
                  href="https://github.com/tianyaxiang/NavSphere"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="访问 GitHub 仓库"
                  title="GitHub 仓库"
                  className="hidden min-[1536px]:inline-flex"
                >
                  <GithubIcon className="h-4 w-4" />
                </Link>
              </Button>
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
        </header>

  )
})
