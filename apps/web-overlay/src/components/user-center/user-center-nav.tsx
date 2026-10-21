'use client'

/**
 * 用户中心统一子导航。
 *
 * 第二批之后用户数据分散在 /me、/favorites、/me/history、/me/data、/preferences，
 * 各页此前只有零散的「返回用户中心」链接，入口不一致。这里用一条导航把它们收拢，
 * 当前页高亮；不改变任何既有 URL（避免旧链接失效）。
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const ITEMS = [
  { href: '/me', label: '概览' },
  { href: '/favorites', label: '收藏' },
  { href: '/me/history', label: '搜索历史' },
  { href: '/me/data', label: '数据与隐私' },
  { href: '/preferences', label: '偏好与 AI' },
] as const

export function UserCenterNav() {
  const pathname = usePathname() || '/me'
  return (
    <nav aria-label="用户中心导航" className="flex flex-wrap gap-1.5">
      {ITEMS.map((item) => {
        const active = item.href === '/me' ? pathname === '/me' : pathname === item.href || pathname.startsWith(item.href + '/')
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-[11px] font-medium transition-colors',
              active
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border/60 bg-background/60 text-muted-foreground hover:text-foreground hover:bg-muted/40',
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
