'use client'

/**
 * 用户中心概览与全量个人设置中枢（身份 + 计数 + 个人资料编辑 + 全景偏好设置 + 自动自检修复）。
 *
 * 身份来自 /api/me：Web 侧 BFF 从 NextAuth 会话派生并签名转发，
 * 客户端不需要也不应该自报 userId。未登录时展示匿名状态、登录入口与本机偏好设置。
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
import { Input } from '@/components/ui/input'
import { Footer } from '@/components/footer'
import { useToast } from '@/components/ui/use-toast'
import { useFavorites } from '@/hooks/useFavorites'
import { getAnonId } from '@/lib/identity'
import { clearProfileSignals, fetchProfileExplain, type HubProfileExplain } from '@/lib/navhub-api'
import {
  CARD_DENSITY_OPTIONS,
  DEFAULT_USER_SETTINGS,
  RETENTION_DAY_OPTIONS,
  SEARCH_ENGINE_OPTIONS,
  SPOTLIGHT_SHORTCUT_OPTIONS,
  normalizeUserSettings,
  readLocalUserSettings,
  runClientStorageDiagnostics,
  verifySettingsConsistency,
  writeLocalUserSettings,
  type CardDensityMode,
  type DiagnosticCheckItem,
  type HistoryRetentionDays,
  type SearchEngineId,
  type SpotlightShortcutMode,
  type UserSettingsModel,
  type UserSettingsPatch,
} from '@/lib/user-settings'
import { CenterPageHeader } from '@/components/user-center/center-page-header'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Database,
  Edit3,
  Heart,
  LogIn,
  Plug,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  User,
  Wand2,
  Zap,
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
  settings: Partial<UserSettingsModel> & { personalizationEnabled: boolean; favoriteSignalCutoff: number; updatedAt: number }
  aliases: string[]
}

type ViewState = 'loading' | 'anonymous' | 'ready' | 'error'

/** 操作记录的中文映射：未知 action 原样展示，不吞掉新事件 */
const ACTIVITY_LABELS: Record<string, string> = {
  'user.export': '导出个人数据',
  'user.delete': '删除云端个人数据',
  'user.settings_update': '更新个人偏好设置',
  'user.profile_update': '修改个人展示资料',
  'user.diagnostics': '执行账户数据健康自检修复',
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

  // 统一偏好设置状态（云端优先，同时镜像到本机缓存以实现 0ms 读取与修改后双重校验）
  const [localPrefs, setLocalPrefs] = useState<UserSettingsModel>(() =>
    initialOverview?.settings ? normalizeUserSettings(initialOverview.settings) : DEFAULT_USER_SETTINGS,
  )
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null)

  // 个人资料编辑状态
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileUsername, setProfileUsername] = useState(initialOverview?.user?.username ?? '')
  const [profileAvatar, setProfileAvatar] = useState(initialOverview?.user?.avatar ?? '')
  const [profileSaving, setProfileSaving] = useState(false)

  // 账户与本地存储健康自检状态
  const [diagRunning, setDiagRunning] = useState(false)
  const [diagChecks, setDiagChecks] = useState<DiagnosticCheckItem[] | null>(null)
  const [diagRepairedTotal, setDiagRepairedTotal] = useState(0)

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
      // NextAuth 未登录时返回的是字面量 null（200）——它是「没有会话」的正常回答，
      // 不是故障。因此只用「解析抛错」当故障，body 为 null / {} 一律走匿名分支。
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
        setLocalPrefs(readLocalUserSettings())
        setState('anonymous')
        return
      }

      const res = await fetch('/api/me', { cache: 'no-store' })
      if (res.status === 401) {
        setLocalPrefs(readLocalUserSettings())
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
      setProfileUsername(data.user?.username ?? '')
      setProfileAvatar(data.user?.avatar ?? '')
      const syncedPrefs = writeLocalUserSettings(normalizeUserSettings(data.settings))
      setLocalPrefs(syncedPrefs)
      setState('ready')
      void fetchProfileExplain(data.identity).then(setExplain)
    } catch {
      setError('网络不可用，未能加载用户中心')
      setState('error')
    }
  }, [])

  useEffect(() => {
    if (initialOverview) {
      const synced = writeLocalUserSettings(normalizeUserSettings(initialOverview.settings))
      setLocalPrefs(synced)
      setProfileUsername(initialOverview.user?.username ?? '')
      setProfileAvatar(initialOverview.user?.avatar ?? '')
      void fetchProfileExplain(initialOverview.identity).then(setExplain)
    } else {
      setLocalPrefs(readLocalUserSettings())
      void load()
    }
    const onMerged = () => void load()
    window.addEventListener('navhub_identity_merged', onMerged)
    window.addEventListener('navhub_identity_changed', onMerged)
    return () => {
      window.removeEventListener('navhub_identity_merged', onMerged)
      window.removeEventListener('navhub_identity_changed', onMerged)
    }
  }, [initialOverview, load])

  // 最近操作（M10 接线）：辅助信息，失败保持静默，绝不打断主面板
  const refreshActivity = useCallback(async () => {
    try {
      const res = await fetch('/api/me/activity?limit=10', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { items?: ActivityItem[] }
      if (Array.isArray(data.items)) setActivity(data.items)
    } catch {
      // 辅助信息取不到就不展示：用户中心的错误条只留给关键区块
    }
  }, [])

  useEffect(() => {
    if (state !== 'ready') return
    void refreshActivity()
  }, [state, refreshActivity])

  /**
   * 通用设置更新 + 修改后自动检查修复（Save-then-Verify）：
   * - 登录态：调用 PATCH /api/me/settings 落库，随后对返回结果与本机缓存执行 verifySettingsConsistency；
   * - 匿名态：写入本机 localStorage 并同样执行 verifySettingsConsistency 闭环验证。
   */
  const applySettingsPatch = useCallback(
    async (patch: UserSettingsPatch, successTitle?: string) => {
      if (settingsBusy) return
      setSettingsBusy(true)
      setVerifyNotice(null)
      try {
        if (state === 'ready' && overview) {
          const res = await fetch('/api/me/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
            cache: 'no-store',
          })
          if (!res.ok) throw new Error('设置保存失败')
          const data = (await res.json()) as { settings: Overview['settings'] }
          const localWritten = writeLocalUserSettings(normalizeUserSettings(data.settings))
          const check = verifySettingsConsistency(patch, data.settings, localWritten)
          const finalSettings = check.verified ? localWritten : writeLocalUserSettings(check.repairedSettings)
          setLocalPrefs(finalSettings)
          setOverview({ ...overview, settings: finalSettings })
          setVerifyNotice(
            check.verified
              ? '已保存并通过云端与本机一致性自检'
              : `已自动修复 ${check.mismatchedKeys.length} 项缓存偏差并完成同步`,
          )
          toast({
            title:
              successTitle ??
              (patch.personalizationEnabled !== undefined
                ? finalSettings.personalizationEnabled
                  ? '已开启个性化'
                  : '已关闭个性化'
                : '偏好设置已保存并校验通过'),
          })
          void refreshActivity()
        } else {
          const localWritten = writeLocalUserSettings(patch)
          const check = verifySettingsConsistency(patch, localWritten, localWritten)
          const finalSettings = check.verified ? localWritten : writeLocalUserSettings(check.repairedSettings)
          setLocalPrefs(finalSettings)
          setVerifyNotice('已保存至本机并通过完整性自检')
          toast({ title: successTitle ?? '本机偏好设置已更新' })
        }
      } catch {
        toast({ title: '设置保存失败', description: '中枢暂不可用，请稍后重试', variant: 'destructive' })
      } finally {
        setSettingsBusy(false)
      }
    },
    [overview, refreshActivity, settingsBusy, state, toast],
  )

  const togglePersonalization = useCallback(async () => {
    if (!overview || settingsBusy) return
    await applySettingsPatch({ personalizationEnabled: !overview.settings.personalizationEnabled })
  }, [applySettingsPatch, overview, settingsBusy])

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

  // 保存个人展示资料（昵称与头像）
  const handleSaveProfileInfo = useCallback(async () => {
    if (!overview || profileSaving) return
    const trimmedName = profileUsername.trim()
    if (!trimmedName || trimmedName.length > 40) {
      toast({ title: '昵称长度需在 1 ~ 40 个字符之间', variant: 'destructive' })
      return
    }
    setProfileSaving(true)
    try {
      const res = await fetch('/api/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: trimmedName,
          avatar: profileAvatar.trim() || null,
        }),
        cache: 'no-store',
      })
      let data: {
        ok?: boolean
        user?: Overview['user']
        error?: string
      } = {}
      try {
        data = (await res.json()) as typeof data
      } catch {
        // 非 JSON 错误响应时保留空对象，交给下方 !res.ok 分支提示
      }
      if (!res.ok || !data.user) {
        throw new Error(data.error || '更新个人资料失败')
      }
      setOverview({ ...overview, user: data.user })
      setEditingProfile(false)
      setVerifyNotice('个人资料已更新并通过回读校验')
      toast({ title: '个人资料已更新' })
      void refreshActivity()
    } catch (err) {
      toast({
        title: '更新个人资料失败',
        description: err instanceof Error ? err.message : '请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setProfileSaving(false)
    }
  }, [overview, profileAvatar, profileSaving, profileUsername, refreshActivity, toast])

  // 执行客户端 + 云端全量健康自检与一键修复
  const handleRunDiagnostics = useCallback(async () => {
    if (diagRunning) return
    setDiagRunning(true)
    try {
      const clientReport = runClientStorageDiagnostics()
      const combinedChecks: DiagnosticCheckItem[] = [...clientReport.checks]
      let totalRepaired = clientReport.repairedCount

      if (state === 'ready' && overview) {
        const res = await fetch('/api/me/diagnostics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          cache: 'no-store',
        })
        if (res.ok) {
          const cloudData = (await res.json()) as {
            repairedCount?: number
            checks?: DiagnosticCheckItem[]
          }
          if (Array.isArray(cloudData.checks)) {
            combinedChecks.push(...cloudData.checks)
          }
          totalRepaired += Number(cloudData.repairedCount ?? 0)
          void refreshActivity()
        }
      }

      setDiagChecks(combinedChecks)
      setDiagRepairedTotal(totalRepaired)
      setLocalPrefs(readLocalUserSettings())
      toast({
        title: totalRepaired > 0 ? `自检完成：已自动修复 ${totalRepaired} 项异常` : '健康自检通过：0 项异常',
        description: '本机存储结构、偏好设置与云端数据引用均已核验一致。',
      })
    } catch {
      toast({ title: '自检执行失败', description: '请稍后重试', variant: 'destructive' })
    } finally {
      setDiagRunning(false)
    }
  }, [diagRunning, overview, refreshActivity, state, toast])

  const effectiveSettings = state === 'ready' && overview ? normalizeUserSettings(overview.settings) : localPrefs

  return (
    <Container as="main" id="main-content" className="space-y-6 pt-3 pb-8 sm:pt-4 sm:pb-10">
      <CenterPageHeader
        title="用户中心"
        eyebrow="账户与数据"
        icon={User}
        description="账号身份、收藏、历史、个性化偏好与数据管理，从这里统一进入。"
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs sm:w-auto"
              disabled={diagRunning}
              onClick={() => void handleRunDiagnostics()}
            >
              <Activity className="mr-2 h-3.5 w-3.5 text-emerald-500" />
              {diagRunning ? '自检修复中…' : '一键健康自检与修复'}
            </Button>
            <Button variant="outline" size="sm" className="w-full text-xs sm:w-auto" onClick={() => void load()}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              刷新
            </Button>
          </div>
        }
      />

      {verifyNotice && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-700 dark:text-emerald-300"
        >
          <span className="flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {verifyNotice}
          </span>
          <button
            type="button"
            onClick={() => setVerifyNotice(null)}
            className="text-[11px] underline underline-offset-2 opacity-80 hover:opacity-100"
          >
            知道了
          </button>
        </div>
      )}

      {diagChecks && (
        <section
          aria-label="健康自检与自动修复报告"
          className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <h2 className="text-sm font-semibold">
                账户与本机存储健康巡检报告（{diagRepairedTotal > 0 ? `已自动修复 ${diagRepairedTotal} 项` : '全部正常'}）
              </h2>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDiagChecks(null)}>
              收起报告
            </Button>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {diagChecks.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-2 rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{item.label}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{item.detail}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    item.status === 'repaired'
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  {item.status === 'repaired' ? '已修复' : '正常'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {state === 'loading' && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl border border-border/70 bg-card/50" />
          ))}
        </div>
      )}

      {state === 'anonymous' && (
        <>
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

          {/* 匿名态同样支持管理本机导航与交互设置，修改后立即自动校验落盘 */}
          <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Settings2 className="h-4 w-4 text-primary" aria-hidden />
                本机导航与搜索偏好设置
              </h2>
              <span className="text-[11px] text-muted-foreground">保存在当前浏览器，登录后自动同步至云端</span>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <label htmlFor="anon-default-search-engine" className="block text-xs font-medium text-foreground">
                  默认搜索引擎
                </label>
                <select
                  id="anon-default-search-engine"
                  value={effectiveSettings.defaultSearchEngine}
                  disabled={settingsBusy}
                  onChange={(e) =>
                    void applySettingsPatch(
                      { defaultSearchEngine: e.target.value as SearchEngineId },
                      '默认搜索引擎已更新',
                    )
                  }
                  className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs"
                >
                  {SEARCH_ENGINE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="anon-card-density" className="block text-xs font-medium text-foreground">
                  站点卡片展示密度
                </label>
                <select
                  id="anon-card-density"
                  value={effectiveSettings.cardDensity}
                  disabled={settingsBusy}
                  onChange={(e) =>
                    void applySettingsPatch({ cardDensity: e.target.value as CardDensityMode }, '卡片密度已更新')
                  }
                  className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs"
                >
                  {CARD_DENSITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="anon-spotlight-shortcut" className="block text-xs font-medium text-foreground">
                  全局搜索唤醒快捷键
                </label>
                <select
                  id="anon-spotlight-shortcut"
                  value={effectiveSettings.spotlightShortcut}
                  disabled={settingsBusy}
                  onChange={(e) =>
                    void applySettingsPatch(
                      { spotlightShortcut: e.target.value as SpotlightShortcutMode },
                      '快捷键偏好已更新',
                    )
                  }
                  className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs"
                >
                  {SPOTLIGHT_SHORTCUT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium">新标签页打开链接</p>
                  <p className="text-[11px] text-muted-foreground">点击导航卡片时在独立标签页打开</p>
                </div>
                <Button
                  size="sm"
                  variant={effectiveSettings.openLinksInNewTab ? 'outline' : 'default'}
                  className="h-7 shrink-0 text-[11px]"
                  disabled={settingsBusy}
                  onClick={() =>
                    void applySettingsPatch({ openLinksInNewTab: !effectiveSettings.openLinksInNewTab })
                  }
                >
                  {effectiveSettings.openLinksInNewTab ? '已开启' : '已关闭'}
                </Button>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium">0-RTT 推测意图计算</p>
                  <p className="text-[11px] text-muted-foreground">搜索框实时计算算式、CIDR、UUID 与色值</p>
                </div>
                <Button
                  size="sm"
                  variant={effectiveSettings.speculativeZeroRttEnabled ? 'outline' : 'default'}
                  className="h-7 shrink-0 text-[11px]"
                  disabled={settingsBusy}
                  onClick={() =>
                    void applySettingsPatch({
                      speculativeZeroRttEnabled: !effectiveSettings.speculativeZeroRttEnabled,
                    })
                  }
                >
                  {effectiveSettings.speculativeZeroRttEnabled ? '已开启' : '已关闭'}
                </Button>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium">全天候时段场景流</p>
                  <p className="text-[11px] text-muted-foreground">按早/中/晚时段智能推荐高频工作流站点</p>
                </div>
                <Button
                  size="sm"
                  variant={effectiveSettings.daypartSceneEnabled ? 'outline' : 'default'}
                  className="h-7 shrink-0 text-[11px]"
                  disabled={settingsBusy}
                  onClick={() =>
                    void applySettingsPatch({ daypartSceneEnabled: !effectiveSettings.daypartSceneEnabled })
                  }
                >
                  {effectiveSettings.daypartSceneEnabled ? '已开启' : '已关闭'}
                </Button>
              </div>
            </div>
          </section>
        </>
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
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setEditingProfile((prev) => !prev)}
                    >
                      <Edit3 className="mr-1 h-3 w-3" />
                      {editingProfile ? '取消编辑' : '编辑资料'}
                    </Button>
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

            {editingProfile && (
              <div className="mt-4 grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-12">
                <div className="sm:col-span-5">
                  <label htmlFor="me-profile-username" className="mb-1 block text-xs font-medium text-muted-foreground">
                    显示昵称 (1~40 字符)
                  </label>
                  <Input
                    id="me-profile-username"
                    value={profileUsername}
                    onChange={(e) => setProfileUsername(e.target.value)}
                    placeholder="输入显示昵称"
                    className="h-9 text-xs"
                  />
                </div>
                <div className="sm:col-span-5">
                  <label htmlFor="me-profile-avatar" className="mb-1 block text-xs font-medium text-muted-foreground">
                    头像 URL (支持 https:// 或站内 / 路径)
                  </label>
                  <Input
                    id="me-profile-avatar"
                    value={profileAvatar}
                    onChange={(e) => setProfileAvatar(e.target.value)}
                    placeholder="https://example.com/avatar.png"
                    className="h-9 text-xs"
                  />
                </div>
                <div className="flex items-end gap-2 sm:col-span-2">
                  <Button
                    size="sm"
                    className="h-9 w-full text-xs"
                    disabled={profileSaving}
                    onClick={() => void handleSaveProfileInfo()}
                  >
                    {profileSaving ? '保存中…' : '保存资料'}
                  </Button>
                </div>
              </div>
            )}

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

          {/* 全量个人导航、0-RTT 引擎与隐私设置控制中心 */}
          <section
            aria-label="全局导航与工作台偏好设置"
            className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Settings2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  全局导航、0-RTT 引擎与隐私偏好设置
                </h2>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  所有修改均实时同步云端并自动触发一致性回读校验，跨设备登录自动生效
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                disabled={settingsBusy}
                onClick={() =>
                  void applySettingsPatch(
                    {
                      defaultSearchEngine: DEFAULT_USER_SETTINGS.defaultSearchEngine,
                      openLinksInNewTab: DEFAULT_USER_SETTINGS.openLinksInNewTab,
                      cardDensity: DEFAULT_USER_SETTINGS.cardDensity,
                      speculativeZeroRttEnabled: DEFAULT_USER_SETTINGS.speculativeZeroRttEnabled,
                      daypartSceneEnabled: DEFAULT_USER_SETTINGS.daypartSceneEnabled,
                      spotlightShortcut: DEFAULT_USER_SETTINGS.spotlightShortcut,
                      searchHistoryEnabled: DEFAULT_USER_SETTINGS.searchHistoryEnabled,
                      telemetryEnabled: DEFAULT_USER_SETTINGS.telemetryEnabled,
                      historyRetentionDays: DEFAULT_USER_SETTINGS.historyRetentionDays,
                    },
                    '已恢复默认导航偏好设置',
                  )
                }
              >
                恢复默认偏好
              </Button>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <label htmlFor="me-default-search-engine" className="block text-xs font-medium text-foreground">
                  默认搜索引擎
                </label>
                <select
                  id="me-default-search-engine"
                  value={effectiveSettings.defaultSearchEngine}
                  disabled={settingsBusy}
                  onChange={(e) =>
                    void applySettingsPatch(
                      { defaultSearchEngine: e.target.value as SearchEngineId },
                      '默认搜索引擎已更新',
                    )
                  }
                  className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs"
                >
                  {SEARCH_ENGINE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="me-card-density" className="block text-xs font-medium text-foreground">
                  导航卡片展示密度
                </label>
                <select
                  id="me-card-density"
                  value={effectiveSettings.cardDensity}
                  disabled={settingsBusy}
                  onChange={(e) =>
                    void applySettingsPatch({ cardDensity: e.target.value as CardDensityMode }, '卡片展示密度已更新')
                  }
                  className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs"
                >
                  {CARD_DENSITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="me-spotlight-shortcut" className="block text-xs font-medium text-foreground">
                  全局搜索唤醒快捷键
                </label>
                <select
                  id="me-spotlight-shortcut"
                  value={effectiveSettings.spotlightShortcut}
                  disabled={settingsBusy}
                  onChange={(e) =>
                    void applySettingsPatch(
                      { spotlightShortcut: e.target.value as SpotlightShortcutMode },
                      '搜索快捷键偏好已更新',
                    )
                  }
                  className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs"
                >
                  {SPOTLIGHT_SHORTCUT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="me-history-retention" className="block text-xs font-medium text-foreground">
                  搜索历史保留周期
                </label>
                <select
                  id="me-history-retention"
                  value={effectiveSettings.historyRetentionDays}
                  disabled={settingsBusy}
                  onChange={(e) =>
                    void applySettingsPatch(
                      { historyRetentionDays: Number(e.target.value) as HistoryRetentionDays },
                      '历史保留周期已更新',
                    )
                  }
                  className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs"
                >
                  {RETENTION_DAY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium">新标签页打开站点</p>
                  <p className="text-[11px] text-muted-foreground">点击导航卡片时默认在新标签页打开外部链接</p>
                </div>
                <Button
                  size="sm"
                  variant={effectiveSettings.openLinksInNewTab ? 'outline' : 'default'}
                  className="h-7 shrink-0 text-[11px]"
                  disabled={settingsBusy}
                  onClick={() =>
                    void applySettingsPatch({ openLinksInNewTab: !effectiveSettings.openLinksInNewTab })
                  }
                >
                  {effectiveSettings.openLinksInNewTab ? '已开启' : '已关闭'}
                </Button>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1 text-xs font-medium">
                    <Zap className="h-3.5 w-3.5 text-amber-500" aria-hidden />
                    0-RTT 推测意图即时计算
                  </p>
                  <p className="text-[11px] text-muted-foreground">输入算式、CIDR、UUIDv7、时间戳或色值 0ms 原地计算</p>
                </div>
                <Button
                  size="sm"
                  variant={effectiveSettings.speculativeZeroRttEnabled ? 'outline' : 'default'}
                  className="h-7 shrink-0 text-[11px]"
                  disabled={settingsBusy}
                  onClick={() =>
                    void applySettingsPatch({
                      speculativeZeroRttEnabled: !effectiveSettings.speculativeZeroRttEnabled,
                    })
                  }
                >
                  {effectiveSettings.speculativeZeroRttEnabled ? '已开启' : '已关闭'}
                </Button>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium">全天候时段场景流推荐</p>
                  <p className="text-[11px] text-muted-foreground">按晨间/日间/夜间智能切换高频工作台场景流</p>
                </div>
                <Button
                  size="sm"
                  variant={effectiveSettings.daypartSceneEnabled ? 'outline' : 'default'}
                  className="h-7 shrink-0 text-[11px]"
                  disabled={settingsBusy}
                  onClick={() =>
                    void applySettingsPatch({ daypartSceneEnabled: !effectiveSettings.daypartSceneEnabled })
                  }
                >
                  {effectiveSettings.daypartSceneEnabled ? '已开启' : '已关闭'}
                </Button>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium">自动记录搜索历史</p>
                  <p className="text-[11px] text-muted-foreground">关闭后搜索请求不再写入云端搜索历史表</p>
                </div>
                <Button
                  size="sm"
                  variant={effectiveSettings.searchHistoryEnabled ? 'outline' : 'default'}
                  className="h-7 shrink-0 text-[11px]"
                  disabled={settingsBusy}
                  onClick={() =>
                    void applySettingsPatch({ searchHistoryEnabled: !effectiveSettings.searchHistoryEnabled })
                  }
                >
                  {effectiveSettings.searchHistoryEnabled ? '已开启' : '已关闭'}
                </Button>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium">匿名行为遥测上报</p>
                  <p className="text-[11px] text-muted-foreground">关闭后点击与浏览事件不再关联个人身份标识</p>
                </div>
                <Button
                  size="sm"
                  variant={effectiveSettings.telemetryEnabled ? 'outline' : 'default'}
                  className="h-7 shrink-0 text-[11px]"
                  disabled={settingsBusy}
                  onClick={() =>
                    void applySettingsPatch({ telemetryEnabled: !effectiveSettings.telemetryEnabled })
                  }
                >
                  {effectiveSettings.telemetryEnabled ? '已开启' : '已关闭'}
                </Button>
              </div>
            </div>
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
