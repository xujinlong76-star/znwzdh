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
      const session = (await sessionRes.json().catch(() => {
        // 非 JSON / 解析中断：返回 null，由下方统一按「暂时无法确认」处理——
        // 不能把故障当成匿名状态告知用户
        return null
      })) as
        | { user?: { id?: string } }
        | null
      if (session === null) {
        setError('登录状态暂时无法确认，请稍后重试')
        setState('error')
        return
      }
      if (!session?.user?.id) {
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
    <Container as="main" id="main-content" className="py-4 sm:py-8 space-y-5 sm:space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero p-4 sm:p-8 shadow-xs">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
              <User className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight truncate">用户中心</h1>
              <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
                账号身份、收藏、历史、个性化偏好与数据管理，从这里统一进入。
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full sm:w-auto text-xs" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            刷新
          </Button>
        </div>
      </section>

      {state === 'loading' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 rounded-xl border border-border/70 bg-card/50 animate-pulse" />
          ))}
        </div>
      )}

      {state === 'anonymous' && (
        <section className="rounded-xl border border-dashed border-border/70 bg-card/40 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <LogIn className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <h2 className="text-sm font-semibold">当前是匿名身份</h2>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                收藏与画像已保存在本机（{favorites.items.length} 个收藏，匿名标识 {anonId.slice(0, 14)}…）。
                登录后可跨设备同步，并把本机匿名数据合并到账号。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" className="text-xs">
              <Link href="/auth/signin?callbackUrl=/me">登录 / 创建账号</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="text-xs">
              <Link href="/favorites">查看本机收藏</Link>
            </Button>
          </div>
        </section>
      )}

      {state === 'error' && (
        <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <h2 className="text-sm font-semibold">用户中心加载失败</h2>
              <p className="mt-1 text-xs text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" className="mt-3 text-xs" onClick={() => void load()}>
                重试
              </Button>
            </div>
          </div>
        </section>
      )}

      {state === 'ready' && overview && (
        <>
          <section className="rounded-xl border border-border/70 bg-card/60 p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                {overview.user?.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={overview.user.avatar} alt="" className="h-11 w-11 rounded-full border border-border object-cover" />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted text-sm font-bold">
                    {(overview.user?.username || 'U').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {overview.user?.username || '已登录用户'}
                    <span className="ml-2 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      {overview.user?.source || 'account'}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {overview.user?.email || overview.identity}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-muted-foreground">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" /> 身份已同步
                </span>
                {overview.profile.exists && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-muted-foreground">
                    <Sparkles className="h-3 w-3 text-violet-500" /> 画像已生成
                  </span>
                )}
                {overview.vault.exists && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-muted-foreground">
                    <Database className="h-3 w-3 text-sky-500" /> 云端金库 v{overview.vault.version ?? 1}
                  </span>
                )}
                {overview.llmConfig.exists && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-muted-foreground">
                    <Bot className="h-3 w-3 text-emerald-500" /> 个人 AI 已配置
                  </span>
                )}
              </div>
            </div>
            {overview.aliases.length > 0 && (
              <p className="mt-3 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                已合并 {overview.aliases.length} 个匿名身份（旧数据已归入当前账号）。
              </p>
            )}
          </section>

          <section aria-label="用户数据概览" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STAT_ITEMS.map((item) => {
              const Icon = item.icon
              const value = overview.counts[item.key]
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className="group rounded-xl border border-border/70 bg-card/60 p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                      {item.label}
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-border group-hover:text-primary" />
                  </div>
                  <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
                </Link>
              )
            })}
          </section>

          <section className="rounded-xl border border-border/70 bg-card/50 p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">个性化</h2>
              </div>
              <Button
                variant={overview.settings.personalizationEnabled ? 'outline' : 'default'}
                size="sm"
                className="text-xs"
                disabled={settingsBusy}
                onClick={() => void togglePersonalization()}
              >
                {overview.settings.personalizationEnabled ? '已开启 · 点击关闭' : '已关闭 · 点击开启'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              关闭后搜索结果不再按你的点击/收藏偏好排序，也不再更新画像；收藏与历史本身不受影响。
            </p>
            {explain?.explain && (
              <p className="text-[11px] text-muted-foreground">
                近 {explain.explain.windowDays} 天信号：点击 {explain.explain.signalCounts.click} · 收藏{' '}
                {explain.explain.signalCounts.favorite} · 搜索 {explain.explain.signalCounts.searches}
                {explain.profile?.topTags.length ? ` · 偏好标签 ${explain.profile.topTags.slice(0, 3).join('、')}` : ''}
              </p>
            )}
            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
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
          </section>

          <section className="rounded-xl border border-border/70 bg-card/50 p-4 sm:p-5 space-y-3">
            <h2 className="text-sm font-semibold">更多管理入口</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <Link href="/favorites" className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-xs hover:bg-muted/40">
                <span>收藏管理（文件夹 / 备注 / E2EE 金库）</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
              <Link href="/me/history" className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-xs hover:bg-muted/40">
                <span>搜索历史管理</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
              <Link href="/me/data" className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-xs hover:bg-muted/40">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  数据导出与删除
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
              <Link href="/preferences" className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-xs hover:bg-muted/40">
                <span>我的偏好与个人 AI</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
              <Link href="/marketplace/installed" className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-xs hover:bg-muted/40">
                <span>已安装插件</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
              <Link href="/marketplace/mine" className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-xs hover:bg-muted/40">
                <span>插件作者中心</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            </div>
          </section>
        </>
      )}

      <Footer />
    </Container>
  )
}
