import { safeHref } from '@/lib/safe-url'
import type { SiteSettings } from '@/lib/site-settings'

/**
 * 全站公告条（后台「站点设置 → 公告与功能」控制）。
 *
 * 渲染与否由 layout 在服务端按 `isAnnouncementVisible`（开关 + 定时窗口）
 * 判断后决定，本组件只负责呈现：关掉/过期时 layout 根本不挂它，
 * 不占位、不留空条。链接经 safeHref 收口（伪协议降级为不可点）。
 */
export function AnnouncementBar({ announcement }: { announcement: SiteSettings['announcement'] }) {
  const href = announcement.linkUrl ? safeHref(announcement.linkUrl, '') : ''
  return (
    <div
      role="region"
      aria-label="站点公告"
      className="w-full bg-primary text-primary-foreground"
      data-testid="announcement-bar"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-4 py-2 text-center text-xs sm:text-sm">
        <span className="font-medium">{announcement.text}</span>
        {href ? (
          <a
            href={href}
            {...(href.startsWith('http')
              ? { target: '_blank', rel: 'nofollow noopener noreferrer' }
              : {})}
            className="font-semibold underline underline-offset-2 hover:opacity-90"
          >
            {announcement.linkLabel || '查看详情'}
          </a>
        ) : null}
      </div>
    </div>
  )
}
