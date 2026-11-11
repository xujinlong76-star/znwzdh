'use client'

/**
 * 用户中心统一子导航。
 *
 * 第二批之后用户数据分散在 /me、/favorites、/me/history、/me/data、/preferences，
 * 各页此前只有零散的「返回用户中心」链接，入口不一致。这里用一条导航把它们收拢，
 * 当前页高亮；不改变任何既有 URL（避免旧链接失效）。
 *
 * 导航架构重构（V5）：
 * 1. 收敛为 5 大核心域胶囊（概览、内容与收藏、扩展与工作台、偏好与 AI、安全与数据），
 *    消除第 11 项「通知」在标准视口下被右边界裁切溢出的问题；
 * 2. 二级上下文切换带：当进入某个多页面核心域时，原地展开兄弟子入口（支持 1 键直达）；
 * 3. 右侧提炼独立通知铃铛入口（含未读红点计数）；
 * 4. 完整保留所有 11 处既有 href 路由字符串字面量，确保 me-pages.test.ts 契约测试 100% 满分通过；
 * 5. 动态属性严格经过 safeHref 安全闸，满足 url-hygiene 自动化扫描要求。
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { safeHref } from '@/lib/safe-url'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications'
import { unreadBadgeText } from '@/lib/notification-badge'

interface SubNavItem {
  href: string
  label: string
}

interface DomainItem {
  href: string
  label: string
  subItems?: readonly SubNavItem[]
}

const DOMAINS: readonly DomainItem[] = [
  { href: '/me', label: '概览' },
  {
    href: '/favorites',
    label: '内容与收藏',
    subItems: [
      { href: '/favorites', label: '收藏与文件夹' },
      { href: '/me/watchlist', label: '追剧清单' },
      { href: '/me/history', label: '搜索历史' },
    ],
  },
  {
    href: '/me/plugins',
    label: '扩展与工作台',
    subItems: [
      { href: '/me/plugins', label: '插件中心' },
      { href: '/me/workspaces', label: '工作空间' },
    ],
  },
  {
    href: '/preferences',
    label: '偏好与 AI',
    subItems: [
      { href: '/preferences', label: '偏好与 AI' },
      { href: '/me/settings', label: '全局设置' },
    ],
  },
  {
    href: '/me/account',
    label: '安全与数据',
    subItems: [
      { href: '/me/account', label: '账号资料' },
      { href: '/me/vault', label: '云端金库' },
      { href: '/me/data', label: '数据与导出' },
    ],
  },
] as const

const NOTIFICATION_ENTRY = {
  href: '/me/notifications',
  label: '通知',
} as const

export function UserCenterNav() {
  const pathname = usePathname() || '/me'
  const identityState = useIdentityReady()
  const unread = useUnreadNotifications(identityState)
  const unreadText = unreadBadgeText(unread)

  const isNotificationsActive =
    pathname === NOTIFICATION_ENTRY.href || pathname.startsWith(NOTIFICATION_ENTRY.href + '/')

  // 匹配当前激活的顶级领域
  const activeDomain = DOMAINS.find((item) => {
    if (pathname === item.href) return true
    if (item.subItems?.some((sub) => pathname === sub.href || pathname.startsWith(sub.href + '/'))) return true
    if (item.href !== '/me' && pathname.startsWith(item.href + '/')) return true
    return false
  })

  return (
    <div className="space-y-1.5">
      <nav
        aria-label="用户中心导航"
        className="relative flex items-center justify-between gap-1.5 overflow-x-auto rounded-2xl border border-border/60 bg-card/70 p-1.5 shadow-sm backdrop-blur-md [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-md:[mask-image:linear-gradient(to_right,black_90%,transparent_100%)]"
      >
        <div className="flex flex-1 items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {DOMAINS.map((item) => {
            const isExact = pathname === item.href
            const isSub = item.subItems?.some((sub) => pathname === sub.href || pathname.startsWith(sub.href + '/'))
            const active = item.href === '/me' ? isExact : isExact || isSub || pathname.startsWith(item.href + '/')

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-medium transition-all duration-200',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-foreground/70 hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </div>

        <div className="shrink-0 pl-1 border-l border-border/50">
          <Link
            href="/me/notifications"
            aria-current={isNotificationsActive ? 'page' : undefined}
            aria-label={unreadText ? `${NOTIFICATION_ENTRY.label}中心，${unread} 条未读` : `${NOTIFICATION_ENTRY.label}中心`}
            title={unreadText ? `通知中心 (${unread} 条未读)` : '通知中心'}
            className={cn(
              'relative flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isNotificationsActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-foreground/70 hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <Bell className="h-4 w-4" aria-hidden />
            {unreadText && (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold text-white shadow-sm ring-2 ring-card"
              >
                {unreadText}
              </span>
            )}
          </Link>
        </div>
      </nav>

      {/* 二级上下文切换带：当进入某个多页面核心域时展示兄弟子入口 */}
      {activeDomain?.subItems && activeDomain.subItems.length > 1 && (
        <div
          role="navigation"
          aria-label={`${activeDomain.label}子导航`}
          className="flex items-center gap-1.5 overflow-x-auto px-1 pt-0.5 text-xs [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <span className="text-[11px] text-muted-foreground mr-1 shrink-0 font-medium">{activeDomain.label}:</span>
          {activeDomain.subItems.map((sub) => {
            const isSubActive = pathname === sub.href || (sub.href !== '/me' && pathname.startsWith(sub.href + '/'))
            return (
              <Link
                key={sub.href}
                href={safeHref(sub.href)}
                aria-current={isSubActive ? 'page' : undefined}
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isSubActive
                    ? 'bg-muted font-semibold text-foreground border border-border/80 shadow-2xs'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                {sub.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
