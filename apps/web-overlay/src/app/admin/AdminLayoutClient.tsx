'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { Button } from "@/registry/new-york/ui/button"
import { Separator } from "@/registry/new-york/ui/separator"
import {
  LayoutDashboard,
  ListTodo,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LogOut,
  Home,
  Moon,
  Sun,
  Monitor,
  Database,
  Inbox,
  History,
  Trash2,
  Menu,
  BarChart3,
  ListChecks,
  KeyRound,
  Tags,
  SlidersHorizontal,
  Star,
  Package,
  Bot,
  DatabaseBackup,
} from "lucide-react"
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/registry/new-york/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/registry/new-york/ui/sheet"
import { Avatar, AvatarImage, AvatarFallback } from "@/registry/new-york/ui/avatar"
import { useTheme } from "next-themes"

interface AdminLayoutClientProps {
  children: React.ReactNode
  user: {
    name?: string | null
    email?: string | null
    image?: string | null
  }
}

const menuItems = [
  {
    title: "仪表盘",
    href: "/admin",
    icon: LayoutDashboard
  },
  {
    title: "导航管理",
    href: "/admin/navigation",
    icon: ListTodo,
    subItems: [
      {
        title: "分类管理",
        href: "/admin/categories"
      },
      {
        title: "分类治理",
        href: "/admin/taxonomy"
      },
      {
        title: "站点管理",
        href: "/admin/sitelist"
      }
    ]
  },
  {
    title: "标签管理",
    href: "/admin/tags",
    icon: Tags
  },
  {
    title: "分面属性",
    href: "/admin/facets",
    icon: SlidersHorizontal
  },
  {
    title: "精选专题",
    href: "/admin/collections",
    icon: Star
  },
  {
    title: "视频管理",
    href: "/admin/videos",
    icon: Monitor
  },
  {
    title: "投稿审核",
    href: "/admin/submissions",
    icon: Inbox
  },
  {
    title: "插件市场",
    href: "/admin/plugins",
    icon: Package,
    subItems: [
      {
        title: "插件审核",
        href: "/admin/plugins"
      },
      {
        title: "网址体检",
        href: "/admin/plugin-health"
      }
    ]
  },
  {
    title: "AI 模型",
    href: "/admin/ai",
    icon: Bot
  },
  {
    title: "运营数据",
    href: "/admin/stats",
    icon: BarChart3
  },
  {
    title: "任务队列",
    href: "/admin/jobs",
    icon: ListChecks
  },
  {
    title: "审计日志",
    href: "/admin/audit",
    icon: History
  },
  {
    title: "回收站",
    href: "/admin/trash",
    icon: Trash2
  },
  {
    title: "API Token",
    href: "/admin/tokens",
    icon: KeyRound
  },
  {
    title: "资源管理",
    href: "/admin/resources",
    icon: Settings,
    subItems: [
      {
        title: "资源管理",
        href: "/admin/resources"
      }, {
        title: "网站图标下载",
        href: "/admin/resources/download"
      }
    ]
  },
  {
    title: "数据管理",
    href: "/admin/data",
    icon: Database
  },
  {
    /**
     * 冷备恢复单独占一项，而不是塞进「数据管理」的 subItems：
     * 后者是上游页面、点一下直接跳转；改成 subItems 会把它的行为从「跳转」
     * 变成「展开」，连带影响高亮逻辑（`pathname === item.href`）。
     * 恢复是低频但高风险的入口，独立一项也更容易在菜单里被找到。
     */
    title: "冷备恢复",
    href: "/admin/data/restore",
    icon: DatabaseBackup
  },
  {
    title: "站点设置",
    href: "/admin/site",
    icon: Settings,
    onClick: undefined
  }
]

export function AdminLayoutClient({ children, user }: AdminLayoutClientProps) {
  const pathname = usePathname()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expandedItems, setExpandedItems] = useState<string[]>([])
  const { setTheme } = useTheme()

  const toggleMenuItem = (href: string) => {
    setExpandedItems(prev =>
      prev.includes(href)
        ? prev.filter(item => item !== href)
        : [...prev, href]
    )
  }

  const renderNavLinks = (isMobile = false) => (
    <nav className="grid gap-[2px]">
      {menuItems.map((item) => (
        <div key={item.href}>
          <Button
            variant="ghost"
            className={cn(
              "w-full justify-start text-xs",
              pathname === item.href && "bg-muted font-semibold text-primary"
            )}
            onClick={() => item.subItems && toggleMenuItem(item.href)}
            asChild={!item.subItems}
          >
            {!item.subItems ? (
              <Link
                href={item.href}
                onClick={() => {
                  if (isMobile) setMobileOpen(false)
                }}
              >
                <item.icon className="mr-2 h-4 w-4" />
                {(!isSidebarCollapsed || isMobile) && <span>{item.title}</span>}
              </Link>
            ) : (
              <>
                <item.icon className="mr-2 h-4 w-4" />
                {(!isSidebarCollapsed || isMobile) && (
                  <>
                    <span>{item.title}</span>
                    <ChevronDown
                      className={cn(
                        "ml-auto h-4 w-4 transition-transform",
                        expandedItems.includes(item.href) && "rotate-180"
                      )}
                    />
                  </>
                )}
              </>
            )}
          </Button>
          {item.subItems && expandedItems.includes(item.href) && (!isSidebarCollapsed || isMobile) && (
            <div className="ml-4 mt-1 space-y-1">
              {item.subItems.map((subItem) => (
                <Button
                  key={subItem.href}
                  variant="ghost"
                  className={cn(
                    "w-full justify-start pl-6 text-xs",
                    pathname === subItem.href && "bg-muted font-semibold text-primary"
                  )}
                  asChild
                >
                  <Link
                    href={subItem.href}
                    onClick={() => {
                      if (isMobile) setMobileOpen(false)
                    }}
                  >
                    {subItem.title}
                  </Link>
                </Button>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  )

  const renderUserDropdown = (align: "center" | "start" | "end" = "start") => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "w-full h-auto p-2 hover:bg-muted transition-colors",
            isSidebarCollapsed ? "justify-center" : "justify-start"
          )}
        >
          <div className="flex items-center gap-2.5 w-full">
            <Avatar className="h-7 w-7">
              <AvatarImage src={user.image || ''} alt={user.name || ''} />
              <AvatarFallback className="text-xs">
                {user.name?.charAt(0).toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            {(!isSidebarCollapsed) && (
              <div className="flex items-center flex-1 min-w-0 text-left">
                <span className="text-xs font-medium leading-none truncate">
                  {user.name}
                </span>
                <div className="flex flex-col gap-[3px] ml-auto pl-2">
                  <div className="h-[3px] w-[2px] rounded-full bg-muted-foreground/40" />
                  <div className="h-[3px] w-[2px] rounded-full bg-muted-foreground/40" />
                  <div className="h-[3px] w-[2px] rounded-full bg-muted-foreground/40" />
                </div>
              </div>
            )}
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align={align} side="top">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user.name}</p>
            <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/" className="cursor-pointer" target="_blank" rel="noopener noreferrer">
            <Home className="mr-2 h-4 w-4" />
            前台首页
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Sun className="h-4 w-4 mr-2 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 mr-2 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="ml-2 text-xs">主题</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => setTheme("light")} className="text-xs">
              <Sun className="h-4 w-4 mr-2" />
              浅色
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")} className="text-xs">
              <Moon className="h-4 w-4 mr-2" />
              深色
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")} className="text-xs">
              <Monitor className="h-4 w-4 mr-2" />
              跟随系统
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer flex items-center text-red-600 focus:text-red-600 focus:bg-red-100 text-xs"
          onClick={() => signOut({ callbackUrl: '/' })}
        >
          <LogOut className="mr-2 h-4 w-4" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* 移动端与平板顶部栏 (<lg) */}
      <header className="lg:hidden flex items-center justify-between px-3.5 pt-[max(env(safe-area-inset-top,0px),0.625rem)] pb-2.5 border-b border-border/60 bg-background/95 backdrop-blur-md sticky top-0 z-30 shadow-2xs">
        <div className="flex items-center gap-2">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg">
                <Menu className="h-4 w-4" />
                <span className="sr-only">打开管理菜单</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[260px] p-0 flex flex-col">
              <SheetHeader className="p-4 border-b border-border/50 text-left">
                <SheetTitle className="flex items-center gap-2">
                  <div className="relative w-7 h-7 overflow-hidden rounded-md">
                    <img src="/assets/images/alogo.webp" alt="Logo" className="object-cover" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold leading-none">山羊胡</span>
                    <span className="text-xs text-muted-foreground mt-1">管理控制台</span>
                  </div>
                </SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto p-3">
                {renderNavLinks(true)}
              </div>
              <div className="p-3 border-t border-border/50">
                {renderUserDropdown("start")}
              </div>
            </SheetContent>
          </Sheet>

          <Link href="/admin" className="flex items-center gap-2">
            <div className="relative w-6 h-6 overflow-hidden rounded-md">
              <img src="/assets/images/alogo.webp" alt="Logo" className="object-cover" />
            </div>
            <span className="text-xs sm:text-sm font-bold tracking-tight">山羊胡控制台</span>
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {/* 链接要当按钮用时：Button asChild 把样式/语义交给 <Link>，
              而不是 <Link> 里套一个 <Button>（嵌套可交互元素，读屏会念两遍） */}
          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
            <Link href="/" target="_blank" rel="noopener noreferrer">
              <Home className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">前台</span>
            </Link>
          </Button>
          <div className="w-7 h-7">
            <Avatar className="h-7 w-7">
              <AvatarImage src={user.image || ''} alt={user.name || ''} />
              <AvatarFallback className="text-xs">
                {user.name?.charAt(0).toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>
      </header>

      {/* 桌面端与主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 桌面端常驻侧边栏 (>=lg) */}
        <aside
          className={cn(
            "relative hidden lg:flex flex-col border-r border-border/60 bg-background transition-all duration-300 shrink-0",
            isSidebarCollapsed ? "w-[72px]" : "w-[240px]"
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="absolute -right-3 top-[60px] z-50 border shadow-xs bg-background rounded-full hover:bg-muted w-6 h-6"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {isSidebarCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" />
            )}
          </Button>

          <div className="flex flex-col flex-1 min-h-0">
            <div className="p-3.5">
              <div className="mb-4">
                <Link
                  href="/admin"
                  className={cn(
                    "flex items-center",
                    isSidebarCollapsed ? "justify-center" : "px-2"
                  )}
                >
                  <div className={cn(
                    "flex items-center gap-2",
                    isSidebarCollapsed && "flex-col"
                  )}>
                    <div className="relative w-8 h-8 overflow-hidden rounded-md">
                      <img src="/assets/images/alogo.webp" alt="Logo" className="object-cover" />
                    </div>
                    {!isSidebarCollapsed && (
                      <div className="flex flex-col">
                        <span className="text-base font-bold leading-none tracking-tight">
                          山羊胡
                        </span>
                        <span className="text-xs text-muted-foreground mt-1">
                          管理控制台
                        </span>
                      </div>
                    )}
                  </div>
                </Link>
              </div>

              <Separator className="mb-4" />

              <div className="flex-1 overflow-y-auto">
                {!isSidebarCollapsed && (
                  <h2 className="mb-2 px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                    管理菜单
                  </h2>
                )}
                {renderNavLinks(false)}
              </div>
            </div>
          </div>

          <div className="p-3 border-t border-border/50">
            {renderUserDropdown(isSidebarCollapsed ? "center" : "start")}
          </div>
        </aside>

        {/* 主内容区域 */}
        <main id="main-content" className="flex-1 min-w-0 overflow-y-auto">
          <div className="p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
} 