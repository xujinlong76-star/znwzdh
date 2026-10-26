'use client'

/**
 * 首页顶部工具栏（从 navigation-content.tsx 拆出，2026-10-19 P1-2）。
 *
 * 只负责渲染搜索入口、探索矩阵、视图/密度/主题开关与多选入口；
 * 选中态与工作台过滤仍由 NavigationContent 持有，通过 props 注入。
 */
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
  Github,
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
} from 'lucide-react'
import type { SiteConfig } from '@/types/site'
import { SearchPalette } from '@/components/search-palette'
import { ModeToggle } from '@/components/mode-toggle'
import { DensityToggle } from '@/components/density-toggle'
import { ViewModeToggle } from '@/components/view-mode-toggle'
import { WorkspaceFilter, type WorkspaceId } from '@/components/workspace-filter'
import { cn } from '@/lib/utils'
import { summarizeSelection } from '@/lib/selection'

export interface NavigationToolbarProps {
  siteConfig: SiteConfig
  activeWorkspace: WorkspaceId
  onWorkspaceChange: (workspace: WorkspaceId) => void
  onToggleSidebar: () => void
  onOpenTools: () => void
  onOpenShortcuts: () => void
  selectionMode: boolean
  selectedIds: string[]
  visibleSiteCount: number
  onToggleSelectMode: () => void
  onSelectAllVisible: () => void
}

export function NavigationToolbar({
  siteConfig,
  activeWorkspace,
  onWorkspaceChange,
  onToggleSidebar,
  onOpenTools,
  onOpenShortcuts,
  selectionMode,
  selectedIds,
  visibleSiteCount,
  onToggleSelectMode,
  onSelectAllVisible,
}: NavigationToolbarProps) {
  return (
        <div className="sticky top-0 bg-background/85 dark:bg-background/80 backdrop-blur-md z-30 px-3 sm:px-6 pt-[max(env(safe-area-inset-top,0px),0px)] border-b border-border/40 shadow-2xs">
          <div className="flex h-14 items-center justify-between gap-1.5 sm:gap-3">
            <div className="flex-1 min-w-0 max-w-xl">
              {/* NavHub 混合检索引擎 */}
              <SearchPalette siteConfig={siteConfig} />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {/* 开发者极速微工具箱按钮 */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8.5 w-8.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors hidden sm:inline-flex"
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
                className="h-8.5 w-8.5 rounded-lg text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors hidden sm:inline-flex"
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
                    className="h-8 w-8 sm:h-8.5 sm:w-8.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                    title="探索矩阵"
                    aria-label="探索矩阵"
                  >
                    <Compass className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 p-1.5 shadow-xl bg-popover/95 backdrop-blur-md border border-border/80">
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1">
                    认知与前沿矩阵
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => onOpenTools()} className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent sm:hidden">
                    <Wrench className="h-4 w-4 text-emerald-500 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">开发者微工具箱</span>
                      <span className="text-xs text-muted-foreground">Base64 / JSON / 正则</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="sm:hidden">
                    <Link href="/hot" className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Flame className="h-4 w-4 text-amber-500 shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">热度趋势榜</span>
                        <span className="text-xs text-muted-foreground">全站高频流行站点</span>
                      </div>
                    </Link>
                  </DropdownMenuItem>
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
                    全景与发现
                  </DropdownMenuLabel>
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
                  <DropdownMenuItem asChild>
                    <Link href="/videos" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <MonitorPlay className="h-4 w-4 text-blue-500 shrink-0" />
                      <span className="font-medium text-foreground">视频教程导航</span>
                    </Link>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator className="my-1" />

                  <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1">
                    社区与工具
                  </DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href="/import" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Upload className="h-4 w-4 text-emerald-500 shrink-0" />
                      <span className="font-medium text-foreground">导入浏览器书签</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/marketplace" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Store className="h-4 w-4 text-rose-500 shrink-0" />
                      <span className="font-medium text-foreground">插件市场（社区共享）</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/submit" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Send className="h-4 w-4 text-amber-500 shrink-0" />
                      <span className="font-medium text-foreground">收录与提交网站</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/preferences" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Sparkles className="h-4 w-4 text-violet-500 shrink-0" />
                      <span className="font-medium text-foreground">我的偏好（个性化画像）</span>
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 用户中心：账号、收藏、历史、偏好与数据管理的统一入口 */}
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-8.5 w-8.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"
              >
                <Link href="/me" title="用户中心" aria-label="用户中心">
                  <User className="h-4 w-4" />
                </Link>
              </Button>

              {/* 快捷键指南按钮 */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8.5 w-8.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors hidden sm:inline-flex"
                onClick={() => onOpenShortcuts()}
                title="快捷键全景指南 (快捷键: ?)"
                aria-label="快捷键指南"
              >
                <HelpCircle className="h-4 w-4" />
              </Button>

              {/* 多选：批量导出 / 复制 / 置顶的唯一入口（此前只有孤立的操作坞，没有任何入口） */}
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "relative h-8 w-8 sm:h-8.5 sm:w-8.5 rounded-lg transition-colors",
                  selectionMode
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
                onClick={onToggleSelectMode}
                aria-pressed={selectionMode}
                title={selectionMode ? '退出多选模式' : '多选模式：批量导出 / 复制 / 置顶'}
                aria-label="多选模式"
              >
                <CheckSquare className="h-4 w-4" />
                {selectionMode && selectedIds.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] leading-4 font-mono">
                    {selectedIds.length}
                  </span>
                )}
              </Button>

              {selectionMode && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8.5 rounded-lg gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  onClick={onSelectAllVisible}
                  title={summarizeSelection(selectedIds, visibleSiteCount) + '（点击全选当前可见站点）'}
                >
                  <ListChecks className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{summarizeSelection(selectedIds, visibleSiteCount)}</span>
                </Button>
              )}

              <div className="hidden sm:inline-flex"><ViewModeToggle /></div>
              <div className="hidden sm:inline-flex"><DensityToggle /></div>
              <ModeToggle />
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-8.5 w-8.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 hidden sm:inline-flex"
              >
                <Link
                  href="https://github.com/tianyaxiang/NavSphere"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="访问 GitHub 仓库"
                  title="GitHub 仓库"
                  className="hidden sm:inline-flex"
                >
                  <Github className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 sm:h-8.5 sm:w-8.5 rounded-lg md:hidden text-muted-foreground hover:text-foreground"
                onClick={() => onToggleSidebar()}
                aria-label="打开菜单"
              >
                <Menu className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 场景化工作台切换条 */}
          <WorkspaceFilter active={activeWorkspace} onChange={onWorkspaceChange} />
        </div>

  )
}
