'use client'

/**
 * 分组入口：替代原「更多管理入口」。
 * 与顶部子导航互补——这里按「内容 / 扩展 / 偏好 / 数据」说明每组能做什么，
 * 只保留导航之外的补充说明，不重复堆链接。
 *
 * 视觉（美化批次）：条目独立成卡（不再共用一条分隔线），悬停上浮 +
 * 图标芯片染色，与概览页其它可点元素同一套交互语言。
 */
import Link from 'next/link'
import { ArrowRight, Bot, Download, FolderHeart, KeyRound, Package, Search, Settings2, ShieldCheck, Sparkles, Users } from 'lucide-react'

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
      { href: '/me/workspaces', label: '工作空间', hint: '团队协作与成员角色', icon: Users },
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
      { href: '/me/vault', label: '云端金库', hint: 'E2EE 密文状态与删除', icon: KeyRound },
      { href: '/me/data', label: '导出与删除', hint: 'JSON / 书签 / 云端删除', icon: Download },
    ],
  },
] as const

export function EntryGroups() {
  return (
    <section aria-label="分组入口" className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
      <h2 className="text-sm font-semibold">全部入口</h2>
      <div className="mt-3 grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
        {GROUPS.map((group) => (
          <div key={group.title} className="min-w-0">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <span aria-hidden className="h-px w-3 bg-primary/50" />
              {group.title}
            </p>
            <ul className="mt-2 space-y-1.5">
              {group.items.map(({ href, label, hint, icon: Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="group flex items-center justify-between gap-2.5 rounded-xl border border-border/60 bg-background/50 px-2.5 py-2 text-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm dark:hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{label}</span>
                        <span aria-hidden className="block truncate text-[10px] text-muted-foreground">{hint}</span>
                      </span>
                    </span>
                    <ArrowRight
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
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
