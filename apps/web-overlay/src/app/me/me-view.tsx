'use client'

/**
 * 用户中心概览（第一批：身份 + 计数 + 快捷入口 + 合并状态）。
 *
 * 身份来自 /api/me：Web 侧 BFF 从 NextAuth 会话派生并签名转发，
 * 客户端不需要也不应该自报 userId。未登录时展示匿名状态与登录入口。
 *
 * M5 起这里是「客户端岛」：服务端壳（app/me/page.tsx）在会话可用时把概览
 * 首屏数据作为 `initialOverview` 注入，于是登录用户直接 ready，不再
 * 「骨架 → /api/auth/session → /api/me」两跳。注入为 null（未登录、中枢抖动、
 * 超时）时完全维持原行为：自己探会话、自己取数、该落 anonymous / error 就落。
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Footer } from '@/components/footer'
import { useToast } from '@/components/ui/use-toast'
import { useFavorites } from '@/hooks/useFavorites'
import { getAnonId } from '@/lib/identity'
import { clearProfileSignals, fetchProfileExplain, type HubProfileExplain } from '@/lib/navhub-api'
import { CenterPageHeader } from '@/components/user-center/center-page-header'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Database,
  Heart,
  LogIn,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  User,
  Wand2,
} from 'lucide-react'

export interface Overview {
  identity: string
  user: { id: string; username: string; email: string | null; avatar: string | null; source: string } | null
  counts: {
    favorites: number
    folders: number
    searches: number
    activePluginInstalls: number
    pluginStars: number
    authoredPlugins: number
    recentEvents: number
  }
  profile: { exists: boolean; updatedAt: number | null }
  vault: { exists: boolean; version: number | null; updatedAt: number | null }
  llmConfig: { exists: boolean }
  settings: { personalizationEnabled: boolean; favoriteSignalCutoff: number; updatedAt: number }
  aliases: string[]
}

type ViewState = 'loading' | 'anonymous' | 'ready' | 'error'

/** 操作记录的中文映射：未知 action 原样展示，不吞掉新事件 */
const ACTIVITY_LABELS: Record<string, string> = {
  'user.export': '导出个人数据',
  'user.delete': '删除云端个人数据',
  'identity.merge': '合并匿名身份',
  'identity.sync': '同步登录身份',
  'workspace:create': '创建工作空间',
  'workspace:member_update': '更新空间成员',
  'workspace:member_remove': '移除空间成员',
}

interface ActivityItem {
  action: string
  target: string
  at: number
}

function activityLabel(action: string): string {
  return ACTIVITY_LABELS[action] ?? action
}

function relativeTime(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

const STAT_ITEMS: Array<{
  key: keyof Overview['counts']
  label: string
  icon: typeof Heart
  href: string
}> = [
  { key: 'favorites', label: '收藏站点', icon: Heart, href: '/favorites' },
  { key: 'searches', label: '搜索历史', icon: Search, href: '/me/history' },
  { key: 'activePluginInstalls', label: '已装插件', icon: Plug, href: '/marketplace/installed' },
  { key: 'authoredPlugins', label: '我的插件', icon: Sparkles, href: '/marketplace/mine' },
  { key: 'pluginStars', label: '星标插件', icon: Star, href: '/marketplace' },
  { key: 'recentEvents', label: '近 30 天行为', icon: User, href: '/me/data' },
]

export function MeView({ initialOverview }: { initialOverview: Overview | null }) {
  const favorites = useFavorites()
  const { toast } = useToast()
  // 服务端注入了概览：首屏就是 ready；否则维持原来的 loading 起步
  const [state, setState] = useState<ViewState>(initialOverview ? 'ready' : 'loading')
  const [overview, setOverview] = useState<Overview | null>(initialOverview)
  const [explain, setExplain] = useState<HubProfileExplain | null>(null)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [anonId, setAnonId] = useState('')
  const [activity, setActivity] = useState<ActivityItem[]>([])

  const load = useCallback(async () => {
    setState('loading')
    setError(null)
    try {
      const sessionRes = await fetch('/api/auth/session', { cache: 'no-store' })
      // 会话探测失败 ≠ 匿名：非 2xx / 解析失败都按"暂时无法确认"处理，
      // 否则已登录用户会被明确告知"你是匿名，登录后可同步"——把故障说成事实。
      if (!sessionRes.ok) {
        setError('登录状态暂时无法确认，请稍后重试')
        setState('error')
        return
      }
      // NextAuth 未登录时返回的是**字面量 null**（200）——它是「没有会话」的正常回答，
      // 不是故障。把 null 当成解析失败，会让每一个匿名访客都看到「登录状态暂时无法确认」，
      // 比原来的「把故障说成匿名」更糟：这次是把事实说成了故障。
      // 因此只用「解析抛错」当故障，body 为 null / {} 一律走匿名分支。
      let parsed: unknown
      try {
        parsed = await sessionRes.json()
      } catch {
        parsed = undefined
      }
      if (parsed === undefined) {
        setError('登录状态暂时无法确认，请稍后重试')
        setState('error')
        return
      }
      const session = (parsed ?? {}) as { user?: { id?: string } }
      if (!session.user?.id) {
        setAnonId(getAnonId())
        setState('anonymous')
        return
      }

      const res = await fetch('/api/me', { cache: 'no-store' })
      if (res.status === 401) {
        setState('anonymous')
        return
      }
      if (!res.ok) {
        setError('用户中心暂时不可用')
        setState('error')
        return
      }
      const data = (await res.json()) as Overview
      setOverview(data)
      setState('ready')
      void fetchProfileExplain(data.identity).then(setExplain)
    } catch {
      setError('网络不可用，未能加载用户中心')
      setState('error')
    }
  }, [])

  useEffect(() => {
    if (initialOverview) {
      // 概览已由服务端给出，省掉两跳；画像解释依赖中枢 explain 接口，仍按
      // 原逻辑异步补一次（它只影响那一行小字，不该拖住首屏）
      void fetchProfileExplain(initialOverview.identity).then(setExplain)
    } else {
      void load()
    }
    // 身份合并/切换后必须重取：注入的概览是登录态快照，事件一到就作废
    const onMerged = () => void load()
    window.addEventListener('navhub_identity_merged', onMerged)
    window.addEventListener('navhub_identity_changed', onMerged)
    return () => {
      window.removeEventListener('navhub_identity_merged', onMerged)
      window.removeEventListener('navhub_identity_changed', onMerged)
    }
  }, [initialOverview, load])

  // 最近操作（M10 接线）：辅助信息，失败保持静默，绝不打断主面板
  useEffect(() => {
    if (state !== 'ready') return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/me/activity?limit=10', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { items?: ActivityItem[] }
        if (!cancelled && Array.isArray(data.items)) setActivity(data.items)
      } catch {
        // 辅助信息取不到就不展示：用户中心的错误条只留给关键区块
      }
    })()
    return () => {
      cancelled = true
    }
  }, [state])

  const togglePersonalization = useCallback(async () => {
    if (!overview || settingsBusy) return
    setSettingsBusy(true)
    try {
      const res = await fetch('/api/me/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personalizationEnabled: !overview.settings.personalizationEnabled }),
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('设置保存失败')
      const data = (await res.json()) as { settings: Overview['settings'] }
      setOverview({ ...overview, settings: data.settings })
      toast({ title: data.settings.personalizationEnabled ? '已开启个性化' : '已关闭个性化' })
    } catch {
      toast({ title: '设置保存失败', description: '中枢暂不可用，请稍后重试', variant: 'destructive' })
    } finally {
      setSettingsBusy(false)
    }
  }, [overview, settingsBusy, toast])

  const clearSignal = useCallback(async (kind: 'click' | 'search' | 'favorite') => {
    if (!overview) return
    const labels = { click: '点击', search: '搜索', favorite: '收藏' } as const
    setSettingsBusy(true)
    const ok = await clearProfileSignals(overview.identity, kind)
    setSettingsBusy(false)
    if (!ok) {
      toast({ title: `清理${labels[kind]}信号失败`, description: '中枢暂不可用，请稍后重试', variant: 'destructive' })
      return
    }
    toast({ title: `已清理${labels[kind]}信号`, description: '画像已按剩余行为重建。' })
    void fetchProfileExplain(overview.identity).then(setExplain)
  }, [overview, toast])

  return (
    <Container as="main" id="main-content" className="space-y-6 pt-3 pb-8 sm:pt-4 sm:pb-10">
      <CenterPageHeader
        title="用户中心"
        eyebrow="账户与数据"
        icon={User}
        description="账号身份、收藏、历史、个性化偏好与数据管理，从这里统一进入。"
        actions={
          <Button variant="outline" size="sm" className="w-full text-xs sm:w-auto" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            刷新
          </Button>
        }
      />

      {state === 'loading' && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl border border-border/70 bg-card/50" />
          ))}
        </div>
      )}

      {state === 'anonymous' && (
        <section className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-4 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LogIn className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 space-y-1">
              <h2 className="text-sm font-semibold">当前是匿名身份</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                收藏与画像已保存在本机（{favorites.items.length} 个收藏，匿名标识{' '}
                <span className="font-mono">{anonId.slice(0, 14)}…</span>）。登录后可跨设备同步，并把本机匿名数据合并到账号。
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button asChild size="sm" className="w-full text-xs sm:w-auto">
              <Link href="/auth/signin?callbackUrl=/me">登录 / 创建账号</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="w-full text-xs sm:w-auto">
              <Link href="/favorites">查看本机收藏</Link>
            </Button>
          </div>
        </section>
      )}

      {state === 'error' && (
        <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 sm:p-6" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">用户中心加载失败</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" className="mt-3 w-full text-xs sm:w-auto" onClick={() => void load()}>
                重试
              </Button>
            </div>
          </div>
        </section>
      )}

      {state === 'ready' && overview && (
        <>
          <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                {overview.user?.avatar ? (
                  <img
                    src={overview.user.avatar}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded-full border border-border object-cover"
                  />
                ) : (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-sm font-bold">
                    {(overview.user?.username || 'U').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 space-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-semibold" title={overview.user?.username || '已登录用户'}>
                      {overview.user?.username || '已登录用户'}
                    </p>
                    <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      {overview.user?.source || 'account'}
                    </span>
                  </div>
                  <p
                    className="truncate text-[11px] text-muted-foreground sm:text-xs"
                    title={overview.user?.email || overview.identity}
                  >
                    {overview.user?.email || overview.identity}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-muted-foreground">
                  <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden /> 身份已同步
                </span>
                {overview.profile.exists && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-muted-foreground">
                    <Sparkles className="h-3 w-3 shrink-0 text-violet-500" aria-hidden /> 画像已生成
                  </span>
                )}
                {overview.vault.exists && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-muted-foreground">
                    <Database className="h-3 w-3 shrink-0 text-sky-500" aria-hidden /> 云端金库 v{overview.vault.version ?? 1}
                  </span>
                )}
                {overview.llmConfig.exists && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-muted-foreground">
                    <Bot className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden /> 个人 AI 已配置
                  </span>
                )}
              </div>
            </div>
            {overview.aliases.length > 0 && (
              <p className="mt-3 border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground">
                已合并 {overview.aliases.length} 个匿名身份（旧数据已归入当前账号）。
              </p>
            )}
          </section>

          <section aria-label="用户数据概览" className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {STAT_ITEMS.map((item) => {
              const Icon = item.icon
              const value = overview.counts[item.key]
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className="group flex flex-col justify-between gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <Icon className="h-4 w-4 shrink-0 transition-colors group-hover:text-primary" aria-hidden />
                      <span className="truncate">{item.label}</span>
                    </span>
                    <ArrowRight
                      className="h-3.5 w-3.5 shrink-0 text-border transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                      aria-hidden
                    />
                  </div>
                  <p className="text-2xl font-semibold leading-none tracking-tight tabular-nums sm:text-[26px]">{value}</p>
                </Link>
              )
            })}
          </section>

          <div className="grid gap-4 lg:grid-cols-12">
            <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5 lg:col-span-7">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <Wand2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    个性化
                  </h2>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    决定搜索结果排序与画像是否继续更新
                  </p>
                </div>
                <Button
                  variant={overview.settings.personalizationEnabled ? 'outline' : 'default'}
                  size="sm"
                  className="w-full text-xs sm:w-auto"
                  disabled={settingsBusy}
                  onClick={() => void togglePersonalization()}
                >
                  {overview.settings.personalizationEnabled ? '已开启 · 点击关闭' : '已关闭 · 点击开启'}
                </Button>
              </div>
              <p className="mt-3 max-w-prose text-xs leading-relaxed text-muted-foreground">
                关闭后搜索结果不再按你的点击/收藏偏好排序，也不再更新画像；收藏与历史本身不受影响。
              </p>
              {explain?.explain && (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
                  <span>近 {explain.explain.windowDays} 天信号</span>
                  <span>
                    点击{' '}
                    <span className="font-medium tabular-nums text-foreground">{explain.explain.signalCounts.click}</span>
                  </span>
                  <span>
                    收藏{' '}
                    <span className="font-medium tabular-nums text-foreground">{explain.explain.signalCounts.favorite}</span>
                  </span>
                  <span>
                    搜索{' '}
                    <span className="font-medium tabular-nums text-foreground">{explain.explain.signalCounts.searches}</span>
                  </span>
                  {explain.profile?.topTags.length ? (
                    <span className="min-w-0 max-w-full truncate" title={explain.profile.topTags.slice(0, 3).join('、')}>
                      偏好标签 {explain.profile.topTags.slice(0, 3).join('、')}
                    </span>
                  ) : null}
                </div>
              )}
              <div className="mt-4 border-t border-border/60 pt-3">
                <p className="text-[11px] font-medium text-muted-foreground">按信号类型清理（画像会按剩余行为重建）</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(
                    [
                      ['click', '清理点击信号'],
                      ['search', '清理搜索信号'],
                      ['favorite', '清理收藏信号'],
                    ] as const
                  ).map(([kind, label]) => (
                    <Button
                      key={kind}
                      variant="outline"
                      size="sm"
                      className="text-[11px]"
                      disabled={settingsBusy}
                      onClick={() => void clearSignal(kind)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            </section>

            <section className="flex flex-col rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5 lg:col-span-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-sm font-semibold">最近操作</h2>
                <span className="text-[11px] text-muted-foreground">只显示动作与时间，不含 IP 与内部差异</span>
              </div>
              {activity.length === 0 ? (
                <p className="mt-3 rounded-xl border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
                  最近没有可展示的操作记录。
                </p>
              ) : (
                <ul className="mt-1 divide-y divide-border/60">
                  {activity.map((item, index) => (
                    <li
                      key={`${item.action}-${item.target}-${item.at}-${index}`}
                      className="flex items-start justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground">{activityLabel(item.action)}</p>
                        {item.target ? (
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={item.target}>
                            {item.target}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {relativeTime(item.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold">更多管理入口</h2>
              <span className="text-[11px] text-muted-foreground">按主题分组</span>
            </div>
            <div className="mt-3 grid gap-5 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">数据与隐私</p>
                <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
                  <li>
                    <Link
                      href="/favorites"
                      className="group flex items-center justify-between gap-3 px-3 py-2.5 text-xs transition-colors hover:bg-muted/40"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Heart className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate">收藏管理（文件夹 / 备注 / E2EE 金库）</span>
                      </span>
                      <ArrowRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/me/history"
                      className="group flex items-center justify-between gap-3 px-3 py-2.5 text-xs transition-colors hover:bg-muted/40"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate">搜索历史管理</span>
                      </span>
                      <ArrowRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/me/data"
                      className="group flex items-center justify-between gap-3 px-3 py-2.5 text-xs transition-colors hover:bg-muted/40"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                        <span className="truncate">数据导出与删除</span>
                      </span>
                      <ArrowRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </Link>
                  </li>
                </ul>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">扩展与 AI</p>
                <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
                  <li>
                    <Link
                      href="/preferences"
                      className="group flex items-center justify-between gap-3 px-3 py-2.5 text-xs transition-colors hover:bg-muted/40"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Wand2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate">我的偏好与个人 AI</span>
                      </span>
                      <ArrowRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/marketplace/installed"
                      className="group flex items-center justify-between gap-3 px-3 py-2.5 text-xs transition-colors hover:bg-muted/40"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Plug className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate">已安装插件</span>
                      </span>
                      <ArrowRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/marketplace/mine"
                      className="group flex items-center justify-between gap-3 px-3 py-2.5 text-xs transition-colors hover:bg-muted/40"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate">插件作者中心</span>
                      </span>
                      <ArrowRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
          </section>
        </>
      )}

      <Footer />
    </Container>
  )
}
