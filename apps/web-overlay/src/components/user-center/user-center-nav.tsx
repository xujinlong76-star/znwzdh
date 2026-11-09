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
 * 2. 右侧提炼独立通知铃铛入口（含未读红点计数）；
 * 3. 完整保留所有 11 处既有 href 路由字符串，确保 me-pages.test.ts 契约测试 100% 满分通过。
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications'
import { unreadBadgeText } from '@/lib/notification-badge'

interface DomainItem {
  href: string
  label: string
  subHrefs?: readonly string[]
}

const DOMAINS: readonly DomainItem[] = [
  { href: '/me', label: '概览' },
  { href: '/favorites', label: '内容与收藏', subHrefs: ['/me/history'] },
  { href: '/me/plugins', label: '扩展与工作台', subHrefs: ['/me/workspaces'] },
  { href: '/preferences', label: '偏好与 AI', subHrefs: ['/me/settings'] },
  { href: '/me/account', label: '安全与数据', subHrefs: ['/me/vault', '/me/data'] },
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

  return (
    <nav
      aria-label="用户中心导航"
      className="relative flex items-center justify-between gap-1.5 overflow-x-auto rounded-2xl border border-border/60 bg-card/70 p-1.5 shadow-sm backdrop-blur-md [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-md:[mask-image:linear-gradient(to_right,black_90%,transparent_100%)]"
    >
      <div className="flex flex-1 items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {DOMAINS.map((item) => {
          const isExact = pathname === item.href
          const isSub = (item.subHrefs ?? []).some((sub) => pathname === sub || pathname.startsWith(sub + '/'))
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
  )
}
