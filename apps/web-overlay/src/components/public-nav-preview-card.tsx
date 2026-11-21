import { Globe, Lock, RefreshCw } from 'lucide-react'

/**
 * 只读公开页迷你骨架预览卡（/favorites「公开导航页」区，匿名态）。
 *
 * 作用：把「发布成 /pub/xxx 公开页」从一句话变成一张看得见的成片——
 * 浏览器框 + 标题 + 12 个站点 + 实时更新脚注，让匿名用户一眼看懂
 * 「我也能拥有这样一页」。纯展示组件，无状态、无请求，可直接 renderToString 测试。
 *
 * 演示内容是写死的骨架示例（标题/站数/后缀可由调用方覆盖），不是用户真实数据：
 * 用户没登录时本来就没有可发布的收藏，用示例讲清形态、不用真实数据冒充。
 */

export interface PublicNavPreviewCardProps {
  /** 公开页标题（默认：你的专属技术栈导航） */
  title?: string
  /** 展示的精选站点数（默认 12，取演示列表前 N 条） */
  siteCount?: number
  /** 公开页链接后缀（默认 your-name） */
  slug?: string
}

interface PreviewSite {
  name: string
  domain: string
  color: string
}

const PREVIEW_SITES: PreviewSite[] = [
  { name: 'GitHub', domain: 'github.com', color: '#24292f' },
  { name: 'Figma', domain: 'figma.com', color: '#a259ff' },
  { name: 'Vercel', domain: 'vercel.com', color: '#000000' },
  { name: 'MDN Web Docs', domain: 'developer.mozilla.org', color: '#1b1b1f' },
  { name: 'Stack Overflow', domain: 'stackoverflow.com', color: '#ef8236' },
  { name: 'Notion', domain: 'notion.so', color: '#37352f' },
  { name: 'ChatGPT', domain: 'chatgpt.com', color: '#10a37f' },
  { name: 'Dribbble', domain: 'dribbble.com', color: '#ea4c89' },
  { name: 'CodePen', domain: 'codepen.io', color: '#1e1f26' },
  { name: 'Tailwind CSS', domain: 'tailwindcss.com', color: '#06b6d4' },
  { name: 'npm', domain: 'npmjs.com', color: '#cb3837' },
  { name: 'Linear', domain: 'linear.app', color: '#5e6ad2' },
]

export function PublicNavPreviewCard({
  title = '你的专属技术栈导航',
  siteCount = 12,
  slug = 'your-name',
}: PublicNavPreviewCardProps) {
  const sites = PREVIEW_SITES.slice(0, Math.max(0, Math.min(siteCount, PREVIEW_SITES.length)))
  const shownCount = sites.length
  return (
    <div
      aria-label="公开页预览：只读公开页示例"
      className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm"
    >
      {/* 浏览器框：三点 + 地址栏，点明“这就是别人打开后看到的页面” */}
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/50 px-3 py-2">
        <span className="flex gap-1" aria-hidden>
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1 truncate rounded-md bg-background px-2 py-1 text-[11px] text-muted-foreground">
          <Lock className="size-3 shrink-0" aria-hidden />
          <span className="truncate">shanyanghu.com/pub/{slug}</span>
        </span>
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          只读公开页
        </span>
      </div>

      {/* 成片头图：标题 + 站数 */}
      <div className="bg-gradient-to-br from-emerald-500/15 via-card to-sky-500/10 px-3.5 py-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold leading-snug">
          <Globe className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
          <span className="truncate">{title}</span>
        </p>
        <p className="mt-0.5 pl-[22px] text-[11px] text-muted-foreground">
          {shownCount} 个精选站点 · 免登录可看
        </p>
      </div>

      {/* 站点骨架：两列迷你行，色点 + 站名 + 域名 */}
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3.5 py-3">
        {sites.map((site) => (
          <li key={site.domain} className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden
              className="flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
              style={{ backgroundColor: site.color }}
            >
              {site.name.slice(0, 1)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium leading-tight">{site.name}</span>
              <span className="block truncate text-[10px] leading-tight text-muted-foreground">
                {site.domain}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {/* 脚注：随收藏实时更新 */}
      <p className="flex items-center gap-1.5 border-t border-border/60 bg-muted/30 px-3.5 py-2 text-[11px] text-muted-foreground">
        <RefreshCw className="size-3 shrink-0" aria-hidden />
        随收藏实时更新 · 随时可下线
      </p>
    </div>
  )
}
