'use client'

/**
 * 分组入口：替代原「更多管理入口」。
 * 与顶部子导航互补——这里按「内容 / 扩展 / 偏好 / 数据」说明每组能做什么。
 *
 * 栅格重构（V5）：
 * 1. 4 组 13 张卡片：U-62a 起内容组 4 项（含追剧清单），其余三组各 3 项，
 *    接受不对称，不再强求 12 张对称矩阵；
 * 2. 补齐「智能书签导入 (/import)」与「快捷键与命令面板 (/me/settings#shortcuts)」；
 * 3. 注入实时遥测胶囊徽章（Live Telemetry Badges），直观展示当前状态与容量。
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Bot,
  Clapperboard,
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
import { CARD_DENSITY_OPTIONS, readLocalUserSettings, type UserSettingsModel } from '@/lib/user-settings'
import { FAVORITES_STORAGE_KEY, parseFavorites } from '@/lib/favorites-storage'
import { WATCHLIST_STORAGE_KEY, sanitizeWatchEntry } from '@/lib/watchlist'
import { fetchPlugins } from '@/lib/navhub-api'

/** U-92：插件徽章中性文案。失败 / total<=0 / 未取到数时都落这里，永不回落硬编码总数。 */
export const PLUGIN_CATALOG_NEUTRAL_BADGE = '插件生态'

/**
 * U-92：插件徽章纯解析。已装优先于目录总数；total<=0/缺失都落中性文案。
 * 首漆（telemetry 未就绪）与取数失败都走同一条中性分支，不写 0、不写死总数。
 */
export function resolvePluginBadge(
  installedCount: number | undefined,
  catalogTotal: number | null | undefined,
): string {
  if (typeof installedCount === 'number' && installedCount > 0) return `${installedCount} 已安装`
  if (typeof catalogTotal === 'number' && catalogTotal > 0) return `${catalogTotal} 款生态`
  return PLUGIN_CATALOG_NEUTRAL_BADGE
}

/** U-62a：追剧清单默认徽章（空清单/损坏存储时落这里，链接仍在）。 */
export const WATCHLIST_DEFAULT_BADGE = '进度账本'

/**
 * U-62a：追剧清单条数（与 useWatchlist.loadLocal 同口径）。
 * parseFavorites 整份读不出来算 0；逐条过 sanitizeWatchEntry，坏一条丢一条。
 * 只读、不写、不隔离损坏数据——损坏时界面只显示默认徽章，绝不覆盖原数据。
 */
export function countWatchlistEntries(raw: string | null | undefined): number {
  const { items, corrupt } = parseFavorites<unknown>(raw)
  if (corrupt) return 0
  let count = 0
  for (const item of items) {
    if (sanitizeWatchEntry(item)) count += 1
  }
  return count
}

/** U-62a：追剧清单徽章。>0 显示「N 部在追」，否则默认徽章。 */
export function resolveWatchlistBadge(count: number): string {
  return count > 0 ? `${count} 部在追` : WATCHLIST_DEFAULT_BADGE
}
export type PluginCatalogFetcher = (params: { limit: number }) => Promise<{ total: number }>

/**
 * U-92：插件徽章取数（effect 侧调这里，首漆不阻塞）。
 * 已装>0 直接回「N 已安装」，不发请求；否则 fetchPlugins({ limit: 1 }) 取 total；
 * 失败或 total<=0 回中性文案。fetchPlugins 内部 degrade 失败时已回 total:0
 * 兜底，这里的 try/catch 只防非预期抛错。
 */
export async function loadPluginCatalogBadge(
  fetchCatalog: PluginCatalogFetcher,
  installedCount: number | undefined,
): Promise<string> {
  if (typeof installedCount === 'number' && installedCount > 0) return `${installedCount} 已安装`
  try {
    const res = await fetchCatalog({ limit: 1 })
    const total = typeof res?.total === 'number' ? res.total : 0
    return total > 0 ? `${total} 款生态` : PLUGIN_CATALOG_NEUTRAL_BADGE
  } catch {
    return PLUGIN_CATALOG_NEUTRAL_BADGE
  }
}

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
  subtitle: string
  chip: string
  items: readonly EntryItem[]
}

const GROUPS: readonly GroupDefinition[] = [
  {
    title: '内容',
    subtitle: '收藏、书签与追剧记录',
    chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
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
      {
        href: '/me/watchlist',
        label: '追剧清单',
        hint: '在追进度 · 更新提醒',
        icon: Clapperboard,
        badgeKey: 'watchlist',
        defaultBadge: WATCHLIST_DEFAULT_BADGE,
      },
    ],
  },
  {
    title: '扩展',
    subtitle: '插件、团队空间与 DIY',
    chip: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
    items: [
      {
        href: '/me/plugins',
        label: '插件中心',
        hint: '已安装 / 我发布 / 投稿',
        icon: Package,
        badgeKey: 'plugins',
        defaultBadge: PLUGIN_CATALOG_NEUTRAL_BADGE,
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
    subtitle: 'AI 画像、布局与快捷键',
    chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
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
    subtitle: '身份安全、加密金库与导出',
    chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
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

export interface EntryGroupsProps {
  favoritesCount?: number
  installedPluginsCount?: number
  searchesCount?: number
  vaultExists?: boolean
  profileReady?: boolean
  anonymous?: boolean
  settings?: UserSettingsModel
}

export function EntryGroups({
  favoritesCount,
  installedPluginsCount,
  searchesCount,
  vaultExists,
  profileReady,
  anonymous,
  settings,
}: EntryGroupsProps) {
  const [telemetry, setTelemetry] = useState<Record<string, string>>({})
  // U-92：插件徽章由独立 effect 拥有（不进 telemetry，避免主 effect
  // 重跑时把已取到的「N 款生态」盖回中性）。null = 未取到，渲染落默认徽章。
  const [pluginBadge, setPluginBadge] = useState<string | null>(null)

  // U-92：插件徽章取数——已装>0 不发请求（loader 内直接回「N 已安装」），
  // 否则 hydration 后取目录总数；失败/total<=0 都落中性文案。
  useEffect(() => {
    let cancelled = false
    void loadPluginCatalogBadge(fetchPlugins, installedPluginsCount).then((badge) => {
      if (!cancelled) setPluginBadge(badge)
    })
    return () => {
      cancelled = true
    }
  }, [installedPluginsCount])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const s = settings ?? readLocalUserSettings()
    const densityOpt = CARD_DENSITY_OPTIONS.find((o) => o.value === s.cardDensity)
    const densityLabel = densityOpt ? densityOpt.label.split(' (')[0] : '舒适'

    // 读取本地收藏数量（若未传入）
    let favCount = favoritesCount
    if (typeof favCount !== 'number') {
      try {
        const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY)
        if (raw) {
          const parsed = parseFavorites(raw)
          favCount = parsed.items.length
        }
      } catch {
        // LocalStorage unavailable in SSR or strict privacy mode
        favCount = 0
      }
    }

    // U-62a：追剧清单条数（本地读，坏数据算 0、不覆盖；localStorage 不可用也算 0）。
    let watchlistCount = 0
    try {
      watchlistCount = countWatchlistEntries(window.localStorage.getItem(WATCHLIST_STORAGE_KEY))
    } catch {
      watchlistCount = 0
    }

    setTelemetry({
      favorites: typeof favCount === 'number' && favCount > 0 ? `${favCount} 个站点` : 'E2EE 加密',
      watchlist: resolveWatchlistBadge(watchlistCount),
      settings: `${densityLabel}密度`,
      history: typeof searchesCount === 'number' && searchesCount > 0
        ? `${searchesCount} 条记录`
        : (s.searchHistoryEnabled ? '已开启记录' : '已暂停记录'),
      shortcuts: s.spotlightShortcut === 'slash' ? '仅 / 键' : s.spotlightShortcut === 'mod+k' ? '⌘K' : '⌘K 或 /',
      account: anonymous ? '未登录(临时)' : (profileReady ? '已同步' : 'Local-First'),
      vault: vaultExists ? '已初始化' : 'AES-GCM',
      preferences: profileReady ? '画像已就绪' : '本地偏好',
      data: '自主可控',
      import: '0-RTT 解析',
      workspaces: '个人空间',
      custom: '自由排版',
    })
  }, [favoritesCount, installedPluginsCount, searchesCount, vaultExists, profileReady, anonymous, settings])

  return (
    <section aria-label="分组入口" className="rounded-2xl border border-border/70 bg-card/75 p-4 shadow-xs sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight">全部入口</h2>
          <span className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
            4 组 13 个功能域
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">点击直达各管理分区</span>
      </div>

      {/* 2×2 象限平衡卡片组：彻底消除原先 4-3-3-3 四列排布右侧底部留空不齐的问题 */}
      <div className="mt-3.5 grid gap-3 md:grid-cols-2">
        {GROUPS.map((group) => (
          <div
            key={group.title}
            className="flex min-w-0 flex-col rounded-xl border border-border/60 bg-background/55 p-3"
          >
            <div className="flex items-center justify-between gap-2 pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${group.chip}`}>
                  {group.title}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">{group.subtitle}</span>
              </div>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{group.items.length} 项</span>
            </div>
            <ul className="grid flex-1 gap-1.5 sm:grid-cols-2">
              {group.items.map(({ href, label, hint, icon: Icon, badgeKey, defaultBadge }, idx) => {
                // U-92：插件徽章走独立 state（首漆 null → 默认中性文案），其余仍走 telemetry。
                const liveBadge = badgeKey === 'plugins' ? (pluginBadge ?? defaultBadge) : (telemetry[badgeKey] || defaultBadge)
                const spanFull = group.items.length === 3 && idx === 2
                return (
                  <li key={href} className={spanFull ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
                    <Link
                      href={href}
                      className="group flex h-full items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/80 px-2.5 py-2 text-xs transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:shadow-xs dark:hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${group.chip}`}>
                          <Icon className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{label}</span>
                          <span aria-hidden className="block truncate text-[10px] text-muted-foreground">
                            {hint}
                          </span>
                        </span>
                      </span>

                      <div className="flex shrink-0 items-center gap-1">
                        <span
                          data-telemetry={badgeKey}
                          className="rounded-md border border-border/50 bg-muted/50 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary"
                        >
                          {liveBadge}
                        </span>
                        <ArrowRight
                          className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-40 transition-all group-hover:translate-x-0.5 group-hover:text-primary group-hover:opacity-100"
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
