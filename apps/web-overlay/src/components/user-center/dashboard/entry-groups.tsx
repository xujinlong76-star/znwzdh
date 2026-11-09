'use client'

/**
 * 分组入口：替代原「更多管理入口」。
 * 与顶部子导航互补——这里按「内容 / 扩展 / 偏好 / 数据」说明每组能做什么。
 *
 * 栅格重构（V5）：
 * 1. 严格 4 组 × 3 项 = 12 张卡片对称 Bento 矩阵，消除原先「左二右三」造成的底部留白凹陷；
 * 2. 补齐「智能书签导入 (/import)」与「快捷键与命令面板 (/me/settings#shortcuts)」；
 * 3. 注入实时遥测胶囊徽章（Live Telemetry Badges），直观展示当前状态与容量。
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Bot,
  Command,
  Download,
  FileUp,
  FolderHeart,
  KeyRound,
  Package,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import { CARD_DENSITY_OPTIONS, readLocalUserSettings } from '@/lib/user-settings'

interface EntryItem {
  href: string
  label: string
  hint: string
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>
  badgeKey: string
  defaultBadge: string
}

interface GroupDefinition {
  title: string
  items: readonly EntryItem[]
}

const GROUPS: readonly GroupDefinition[] = [
  {
    title: '内容',
    items: [
      {
        href: '/favorites',
        label: '收藏与文件夹',
        hint: '分组、备注、同步、金库',
        icon: FolderHeart,
        badgeKey: 'favorites',
        defaultBadge: 'E2EE 加密',
      },
      {
        href: '/me/history',
        label: '搜索历史',
        hint: '逐条删除或清空',
        icon: Search,
        badgeKey: 'history',
        defaultBadge: '本地保留',
      },
      {
        href: '/import',
        label: '智能书签导入',
        hint: 'HTML / 浏览器书签',
        icon: FileUp,
        badgeKey: 'import',
        defaultBadge: '0-RTT 解析',
      },
    ],
  },
  {
    title: '扩展',
    items: [
      {
        href: '/me/plugins',
        label: '插件中心',
        hint: '已安装 / 我发布 / 投稿',
        icon: Package,
        badgeKey: 'plugins',
        defaultBadge: '77 款生态',
      },
      {
        href: '/me/workspaces',
        label: '工作空间',
        hint: '团队协作与成员角色',
        icon: Users,
        badgeKey: 'workspaces',
        defaultBadge: '个人空间',
      },
      {
        href: '/custom',
        label: '模块化工作台',
        hint: '拖拽与缩放首页模块',
        icon: Sparkles,
        badgeKey: 'custom',
        defaultBadge: '自由排版',
      },
    ],
  },
  {
    title: '偏好',
    items: [
      {
        href: '/preferences',
        label: '偏好与 AI',
        hint: '画像、行为信号、个人模型',
        icon: Bot,
        badgeKey: 'preferences',
        defaultBadge: '画像就绪',
      },
      {
        href: '/me/settings',
        label: '全局设置',
        hint: '搜索、密度、0-RTT、隐私',
        icon: Settings2,
        badgeKey: 'settings',
        defaultBadge: '舒适密度',
      },
      {
        href: '/me/settings#shortcuts',
        label: '快捷键与命令面板',
        hint: 'Ctrl+K / 键盘微动作',
        icon: Command,
        badgeKey: 'shortcuts',
        defaultBadge: '⌘K /',
      },
    ],
  },
  {
    title: '数据',
    items: [
      {
        href: '/me/account',
        label: '账号与身份',
        hint: '资料、匿名合并、自检',
        icon: ShieldCheck,
        badgeKey: 'account',
        defaultBadge: 'Local-First',
      },
      {
        href: '/me/vault',
        label: '云端金库',
        hint: 'E2EE 密文状态与删除',
        icon: KeyRound,
        badgeKey: 'vault',
        defaultBadge: 'AES-GCM',
      },
      {
        href: '/me/data',
        label: '导出与删除',
        hint: 'JSON / 书签 / 云端删除',
        icon: Download,
        badgeKey: 'data',
        defaultBadge: '自主可控',
      },
    ],
  },
] as const

export function EntryGroups({
  favoritesCount,
  installedPluginsCount,
}: {
  favoritesCount?: number
  installedPluginsCount?: number
}) {
  const [telemetry, setTelemetry] = useState<Record<string, string>>({})

  useEffect(() => {
    if (typeof window === 'undefined') return
    const s = readLocalUserSettings()
    const densityOpt = CARD_DENSITY_OPTIONS.find((o) => o.value === s.cardDensity)
    const densityLabel = densityOpt ? densityOpt.label.split(' (')[0] : '舒适'

    // 读取本地收藏数量（若未传入）
    let favCount = favoritesCount
    if (typeof favCount !== 'number') {
      try {
        const raw = window.localStorage.getItem('navhub_favorites')
        if (raw) {
          const parsed = JSON.parse(raw) as unknown
          favCount = Array.isArray(parsed) ? parsed.length : 0
        }
      } catch {
        favCount = 0
      }
    }

    setTelemetry({
      favorites: typeof favCount === 'number' && favCount > 0 ? `${favCount} 个站点` : 'E2EE 加密',
      plugins: typeof installedPluginsCount === 'number' && installedPluginsCount > 0 ? `${installedPluginsCount} 已安装` : '77 款生态',
      settings: `${densityLabel}密度`,
      history: s.searchHistoryEnabled ? '已开启记录' : '已暂停记录',
      shortcuts: s.spotlightShortcut === 'slash' ? '仅 / 键' : s.spotlightShortcut === 'mod+k' ? '⌘K' : '⌘K 或 /',
    })
  }, [favoritesCount, installedPluginsCount])

  return (
    <section aria-label="分组入口" className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">全部入口</h2>
        <span className="text-[11px] text-muted-foreground">4 组 12 个功能域</span>
      </div>

      <div className="mt-3.5 grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
        {GROUPS.map((group) => (
          <div key={group.title} className="min-w-0">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <span aria-hidden className="h-px w-3 bg-primary/50" />
              {group.title}
            </p>
            <ul className="mt-2 space-y-1.5">
              {group.items.map(({ href, label, hint, icon: Icon, badgeKey, defaultBadge }) => {
                const liveBadge = telemetry[badgeKey] || defaultBadge
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className="group flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/50 px-2.5 py-2 text-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm dark:hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                          <Icon className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{label}</span>
                          <span aria-hidden className="block truncate text-[10px] text-muted-foreground">
                            {hint}
                          </span>
                        </span>
                      </span>

                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary">
                          {liveBadge}
                        </span>
                        <ArrowRight
                          className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                          aria-hidden
                        />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
