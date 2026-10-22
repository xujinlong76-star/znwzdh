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
  // 窄屏不再折成两行（折行后高度翻倍、点击目标挤在一起）：改为横向滚动，
  // 一屏内滑动切换；桌面端宽度足够，不会出现滚动条。
  return (
    <nav
      aria-label="用户中心导航"
      className="flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {ITEMS.map((item) => {
        const active = item.href === '/me' ? pathname === '/me' : pathname === item.href || pathname.startsWith(item.href + '/')
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              active
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border/60 bg-background/60 text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
