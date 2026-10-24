'use client'

/**
 * 用户中心概览（仪表盘）。
 *
 * 拆分前这里是 1238 行的单页：状态机 + 资料编辑 + 统计 + 全量设置 + 信号清理 +
 * 最近操作 + 重复入口。现在职责收敛为：
 *   - 组装：账号卡、统计、快捷入口、同步与健康、个性化摘要、最近操作、分组入口；
 *   - 取数与四态状态机（loading / anonymous / ready / error）复用 useMeOverview（T1），
 *     服务端注入的首屏概览经 initialOverview 传入，不再自带一份取数实现；
 *   - 设置写路径复用 lib/me-settings-save 的 Save-then-Verify 内核（T1）；
 *   - 完整设置与资料编辑分别移到 `/me/settings`、`/me/account`。
 *
 * 固定文案（匿名 / 加载失败 / 登录状态无法确认）与 E2E 断言保持一致。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { useFavorites } from '@/hooks/useFavorites'
import { useMeOverview } from '@/hooks/use-me-overview'
import { getAnonId } from '@/lib/identity'
import { saveSettingsPatchLocal, saveSettingsPatchToCloud } from '@/lib/me-settings-save'
import type { MeOverview } from '@/lib/me-types'
import {
  clearProfileSignals,
  fetchProfileExplain,
  type HubProfileExplain,
} from '@/lib/navhub-api'
import {
  normalizeUserSettings,
  readLocalUserSettings,
  SEARCH_ENGINE_OPTIONS,
  CARD_DENSITY_OPTIONS,
  RETENTION_DAY_OPTIONS,
  type UserSettingsModel,
  type UserSettingsPatch,
} from '@/lib/user-settings'
import { CenterPageHeader } from '@/components/user-center/center-page-header'
import { SectionState } from '@/components/user-center/section-state'
import { AccountCard } from '@/components/user-center/dashboard/account-card'
import { StatsGrid } from '@/components/user-center/dashboard/stats-grid'
import { QuickActions } from '@/components/user-center/dashboard/quick-actions'
import { SyncHealthCard } from '@/components/user-center/dashboard/sync-health-card'
import { PersonalizationCard } from '@/components/user-center/dashboard/personalization-card'
import { RecentActivity, type ActivityItem } from '@/components/user-center/dashboard/recent-activity'
import { EntryGroups } from '@/components/user-center/dashboard/entry-groups'
import { ArrowRight, CheckCircle2, RefreshCw, Settings2, User } from 'lucide-react'

/** 设置摘要：只读展示最容易理解的 4 项，完整表单在 /me/settings */
function SettingsSummary({ settings, local }: { settings: UserSettingsModel; local: boolean }) {
  const engine = SEARCH_ENGINE_OPTIONS.find((o) => o.value === settings.defaultSearchEngine)?.label ?? '内置'
  const density = CARD_DENSITY_OPTIONS.find((o) => o.value === settings.cardDensity)?.label ?? '舒适'
  const retention = RETENTION_DAY_OPTIONS.find((o) => o.value === settings.historyRetentionDays)?.label ?? '—'
  const rows = [
    { label: '默认搜索引擎', value: engine },
    { label: '卡片展示密度', value: density },
    { label: '历史保留周期', value: retention },
    { label: '0-RTT 即时计算', value: settings.speculativeZeroRttEnabled ? '已开启' : '已关闭' },
  ]
  return (
    <section className="flex h-full flex-col rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Settings2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            偏好设置
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {local ? '保存在本浏览器，登录后自动同步' : '已同步云端，跨设备生效'}
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="text-xs">
          <Link href="/me/settings">
            管理设置
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
          </Link>
        </Button>
      </div>
      <dl className="mt-3 grid flex-1 gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/50 px-3 py-2">
            <dt className="min-w-0 truncate text-xs text-muted-foreground">{row.label}</dt>
            <dd className="shrink-0 text-xs font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function MeView({ initialOverview }: { initialOverview: MeOverview | null }) {
  const favorites = useFavorites()
  const { toast } = useToast()
  const { state, overview, error, anonId, reload, updateSettings } = useMeOverview({ initialOverview })
  const [explain, setExplain] = useState<HubProfileExplain | null>(null)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [localPrefs, setLocalPrefs] = useState<UserSettingsModel>(() =>
    initialOverview?.settings ? normalizeUserSettings(initialOverview.settings) : readLocalUserSettings(),
  )
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null)

  // 身份事件（合并 / 切换）触发的重取做 inflight 去重：
  // 合并完成的瞬间 merged + changed 两个事件几乎同时到达，不去重会连发两次 /api/me。
  const reloadInflight = useRef(false)
  const reloadOnce = useCallback(async () => {
    if (reloadInflight.current) return
    reloadInflight.current = true
    try {
      await reload()
    } finally {
      reloadInflight.current = false
    }
  }, [reload])

  useEffect(() => {
    const onMerged = () => void reloadOnce()
    window.addEventListener('navhub_identity_merged', onMerged)
    window.addEventListener('navhub_identity_changed', onMerged)
    return () => {
      window.removeEventListener('navhub_identity_merged', onMerged)
      window.removeEventListener('navhub_identity_changed', onMerged)
    }
  }, [reloadOnce])

  useEffect(() => {
    if (overview) void fetchProfileExplain(overview.identity).then(setExplain)
  }, [overview])

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
    // 取数放微任务：effect 同步段不触碰 setState（set-state-in-effect）
    void Promise.resolve().then(refreshActivity)
  }, [state, refreshActivity])

  /**
   * 概览只保留「个性化开关」一项写操作：
   * 登录态 PATCH 云端并回读校验，匿名态写本机；其余设置统一在 /me/settings。
   * Save-then-Verify 内核复用 lib/me-settings-save（与 /me/settings 同一份实现）。
   */
  const togglePersonalization = useCallback(async () => {
    if (!overview || settingsBusy) return
    const next = !overview.settings.personalizationEnabled
    const patch: UserSettingsPatch = { personalizationEnabled: next }
    setSettingsBusy(true)
    setVerifyNotice(null)
    try {
      const result =
        state === 'ready'
          ? await saveSettingsPatchToCloud(patch)
          : saveSettingsPatchLocal(patch)
      setLocalPrefs(result.finalSettings)
      updateSettings(result.finalSettings)
      setVerifyNotice(result.notice)
      toast({ title: next ? '已开启个性化' : '已关闭个性化' })
    } catch {
      toast({ title: '设置保存失败', description: '中枢暂不可用，请稍后重试', variant: 'destructive' })
    } finally {
      setSettingsBusy(false)
    }
  }, [overview, settingsBusy, state, toast, updateSettings])

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

  const effectiveSettings = state === 'ready' && overview ? normalizeUserSettings(overview.settings) : localPrefs
  const displayAnonId = anonId || (state === 'anonymous' ? getAnonId() : '')

  return (
    <Container as="main" id="main-content" className="space-y-5 pb-8 pt-3 sm:space-y-6 sm:pb-10 sm:pt-4">
      <CenterPageHeader
        title="用户中心"
        eyebrow="账户与数据"
        icon={User}
        description="账号身份、收藏、历史、插件、个性化偏好与数据管理，从这里统一进入。"
        actions={
          <Button variant="outline" size="sm" className="w-full text-xs sm:w-auto" onClick={() => void reloadOnce()}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            刷新
          </Button>
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

      {state === 'loading' && (
        <SectionState variant="loading" rows={6} rowClassName="h-24" loadingLabel="正在加载用户中心" />
      )}

      {state === 'anonymous' && (
        <div className="space-y-4 sm:space-y-5">
          <AccountCard
            anonymous
            user={null}
            anonId={displayAnonId}
            favoritesCount={favorites.items.length}
          />
          <SettingsSummary settings={localPrefs} local />
          <EntryGroups />
        </div>
      )}

      {state === 'error' && (
        <SectionState
          variant="error"
          title="用户中心加载失败"
          description={error ?? '网络或中枢暂时不可用，请稍后重试。这不代表你的数据被清空。'}
          onRetry={() => void reloadOnce()}
        />
      )}

      {state === 'ready' && overview && (
        <div className="space-y-4 sm:space-y-5">
          <AccountCard
            anonymous={false}
            user={overview.user}
            anonId={displayAnonId}
            favoritesCount={overview.counts.favorites}
          />
          <StatsGrid counts={overview.counts} />
          <QuickActions />

          <div className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <PersonalizationCard
                enabled={overview.settings.personalizationEnabled}
                busy={settingsBusy}
                explain={explain}
                onToggle={() => void togglePersonalization()}
                onClearSignal={(kind) => void clearSignal(kind)}
              />
            </div>
            <div className="lg:col-span-5">
              <SyncHealthCard
                profile={overview.profile}
                vault={overview.vault}
                llmConfig={overview.llmConfig}
                settingsUpdatedAt={overview.settings.updatedAt}
                aliases={overview.aliases}
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <SettingsSummary settings={effectiveSettings} local={false} />
            </div>
            <div className="lg:col-span-5">
              <RecentActivity items={activity} />
            </div>
          </div>

          <EntryGroups />
        </div>
      )}

      <Footer />
    </Container>
  )
}
