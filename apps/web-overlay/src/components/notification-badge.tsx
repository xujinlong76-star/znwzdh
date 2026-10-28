'use client'

import Link from 'next/link'
import { Bell } from 'lucide-react'
import { useNotificationUnread } from '@/hooks/use-notification-unread'
import { cn } from '@/lib/utils'

export function notificationUnreadLabel(unread: number | null, error = false): string {
  if (unread === null) return error ? '未读通知数暂不可用' : ''
  if (error) return `上次更新有 ${unread} 条未读通知，刷新失败`
  return unread > 0 ? `${unread} 条未读通知` : ''
}

export function NotificationBadge({ unread, error = false, className }: {
  unread: number | null
  error?: boolean
  className?: string
}) {
  const label = notificationUnreadLabel(unread, error)
  if (!label) return null
  return (
    <span className={cn('inline-flex shrink-0 items-center', className)} title={label}>
      <span className="sr-only">，{label}</span>
      {(error || (unread !== null && unread > 0)) && (
        <span aria-hidden="true" className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground tabular-nums">
          {unread !== null && unread > 0 ? (unread > 9 ? '9+' : unread) : '!'}
        </span>
      )}
    </span>
  )
}

export function NotificationBellLink({ onClick }: { onClick?: () => void }) {
  const { unread, error } = useNotificationUnread()
  return (
    <Link
      href="/me/notifications"
      onClick={onClick}
      className="relative inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Bell className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">通知</span>
      <NotificationBadge unread={unread} error={error} className="absolute right-0 top-0" />
    </Link>
  )
}
