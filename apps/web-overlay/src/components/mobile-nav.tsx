'use client'

/**
 * M6 移动端底部导航。
 *
 * 背景：窄屏下「我的 / 收藏」等用户中心入口只剩页脚文字链，用户要点好几屏
 * 才够得着。这里给全站补一条常驻底栏，四个入口：首页 / 分类 / 收藏 / 我的。
 *
 * 与 Footer 的契约（改前必读）：
 *   components/footer.tsx 的 `pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] sm:pb-8`
 *   就是为这条底栏预留的 5.5rem 空位——本组件**不要**再加会让那块空隙失效的
 *   负 margin（如 -mb-*），自身占地就是 h-14 + 安全区，footer 的预留即为其让位。
 *
 * 可见断点取 sm:hidden 而不是桌面布局的 md：footer 的 5.5rem 预留下方只到 sm，
 * 若底栏跟侧栏/汉堡菜单一样宽到 md，640–768px 区间它会压住 footer 的 pb-8
 * 内容区。想把覆盖面对齐到 md，需先把 footer 改成 md:pb-8，超出本次授权。
 *
 * 避让 /videos：该路由不渲染 Footer（没有预留坑），/videos/player 更自带
 * 一条 fixed bottom-0 的移动端播放列表面板（components/video-player-page.tsx），
 * 全局底栏过去只会互相压盖，故在 /videos 前缀下整体不渲染。
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Heart, Home, LayoutGrid, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications'
import { unreadBadgeText } from '@/lib/notification-badge'

const ITEMS = [
  { href: '/', label: '首页', Icon: Home },
  // 分类总览的真实路由是 /category（app/category/page.tsx），不是 /categories
  { href: '/category', label: '分类', Icon: LayoutGrid },
  { href: '/favorites', label: '收藏', Icon: Heart },
  { href: '/me', label: '我的', Icon: User },
] as const

/** 高亮判定：根路径只认精确匹配；其余精确或前缀匹配（/category/xxx 也点亮分类） */
function isActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(href + '/')
}

export default function MobileNav() {
  const pathname = usePathname() || '/'
  // hooks 必须在 /videos 早退之前调用，否则路由切换时 hook 数量变化会炸 React。
  const identityState = useIdentityReady()
  const unread = useUnreadNotifications(identityState)
  const unreadText = unreadBadgeText(unread)
  // /videos 与 /videos/player：无 footer 预留位，且播放器路由自带 fixed bottom-0 面板
  if (pathname.startsWith('/videos')) return null

  return (
    <nav
      aria-label="移动端主导航"
      className="fixed bottom-0 left-0 right-0 z-40 sm:hidden h-14 border-t border-border/40 bg-background/95 backdrop-blur pb-[env(safe-area-inset-bottom,0px)]"
    >
      <ul className="flex h-full items-center justify-around">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = isActive(href, pathname)
          const showBadge = href === '/me' && unreadText !== null
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-label={href === '/me' && unread > 0 ? `${label}，${unread} 条未读通知` : label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-full w-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="relative inline-flex">
                  <Icon className="h-5 w-5" aria-hidden />
                  {showBadge && (
                    <span
                      aria-hidden
                      className="absolute -right-2 -top-1.5 min-w-[14px] rounded-full bg-primary px-0.5 text-center text-[8px] font-semibold leading-[14px] text-primary-foreground tabular-nums"
                    >
                      {unreadText}
                    </span>
                  )}
                </span>
                <span>{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
