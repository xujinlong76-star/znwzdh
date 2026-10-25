'use client'

/**
 * 用户中心统一子导航。
 *
 * 第二批之后用户数据分散在 /me、/favorites、/me/history、/me/data、/preferences，
 * 各页此前只有零散的「返回用户中心」链接，入口不一致。这里用一条导航把它们收拢，
 * 当前页高亮；不改变任何既有 URL（避免旧链接失效）。
 *
 * 视觉（美化批次）：玻璃胶囊容器 + 选中实心胶囊；窄屏仍横向滚动（折行会让
 * 点击目标挤在一起），滚动条隐藏、右缘渐隐暗示可继续滑动。
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const ITEMS = [
  { href: '/me', label: '概览' },
  { href: '/me/account', label: '账号' },
  { href: '/me/workspaces', label: '工作空间' },
  { href: '/favorites', label: '收藏' },
  { href: '/me/history', label: '搜索历史' },
  { href: '/me/plugins', label: '插件' },
  { href: '/preferences', label: '偏好与 AI' },
  { href: '/me/settings', label: '设置' },
  { href: '/me/vault', label: '金库' },
  { href: '/me/data', label: '数据与隐私' },
  { href: '/me/notifications', label: '通知' },
] as const

export function UserCenterNav() {
  const pathname = usePathname() || '/me'
  // 窄屏不再折成两行（折行后高度翻倍、点击目标挤在一起）：改为横向滚动，
  // 一屏内滑动切换；桌面端宽度足够，不会出现滚动条。
  return (
    <nav
      aria-label="用户中心导航"
      className="relative flex flex-nowrap items-center gap-1 overflow-x-auto rounded-2xl border border-border/60 bg-card/70 p-1.5 shadow-sm backdrop-blur-md [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-md:[mask-image:linear-gradient(to_right,black_88%,transparent_100%)]"
    >
      {ITEMS.map((item) => {
        const active = item.href === '/me' ? pathname === '/me' : pathname === item.href || pathname.startsWith(item.href + '/')
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
                // 未激活项用 foreground/70（muted-foreground 实测 ~3:1，低于正文 AA）：可扫视但不牺牲对比
                : 'text-foreground/70 hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
