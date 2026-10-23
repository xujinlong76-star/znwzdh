'use client'

/**
 * 分组入口：替代原「更多管理入口」。
 * 与顶部子导航互补——这里按「内容 / 扩展 / 偏好 / 数据」说明每组能做什么，
 * 只保留导航之外的补充说明，不重复堆链接。
 */
import Link from 'next/link'
import { ArrowRight, Bot, Download, FolderHeart, Package, Search, Settings2, ShieldCheck, Sparkles } from 'lucide-react'

const GROUPS = [
  {
    title: '内容',
    items: [
      { href: '/favorites', label: '收藏与文件夹', hint: '分组、备注、同步、金库', icon: FolderHeart },
      { href: '/me/history', label: '搜索历史', hint: '逐条删除或清空', icon: Search },
    ],
  },
  {
    title: '扩展',
    items: [
      { href: '/me/plugins', label: '插件中心', hint: '已安装 / 我发布 / 投稿', icon: Package },
      { href: '/custom', label: '模块化工作台', hint: '拖拽与缩放首页模块', icon: Sparkles },
    ],
  },
  {
    title: '偏好',
    items: [
      { href: '/preferences', label: '偏好与 AI', hint: '画像、行为信号、个人模型', icon: Bot },
      { href: '/me/settings', label: '全局设置', hint: '搜索、密度、0-RTT、隐私', icon: Settings2 },
    ],
  },
  {
    title: '数据',
    items: [
      { href: '/me/account', label: '账号与身份', hint: '资料、匿名合并、自检', icon: ShieldCheck },
      { href: '/me/data', label: '导出与删除', hint: 'JSON / 书签 / 云端删除', icon: Download },
    ],
  },
] as const

export function EntryGroups() {
  return (
    <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
      <h2 className="text-sm font-semibold">按主题查找</h2>
      <div className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {GROUPS.map((group) => (
          <div key={group.title} className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {group.title}
            </p>
            <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
              {group.items.map(({ href, label, hint, icon: Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="group flex items-center justify-between gap-3 px-3 py-2.5 text-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate">{label}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">{hint}</span>
                      </span>
                    </span>
                    <ArrowRight
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
