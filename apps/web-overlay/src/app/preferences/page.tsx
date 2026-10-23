'use client'

/**
 * 「我的偏好」——个性化画像的终端用户视图。
 *
 * 系统据行为（点击/收藏/搜索）聚合出偏好并用于搜索重排；
 * 这里把它**显式呈现**给用户：看得见才谈得上信任与可控。
 *
 * 关键交互：
 *  - 展示 topCategories / topTags / visitedSiteIds（画像里被用于排序的部分）
 *  - 重置画像 = 清 user_profiles + 该身份的行为事件（收藏与搜索历史**不动**——
 *    它们是用户自己的数据，不是被推断的偏好）
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { hubGet, hubSend, type HubSite } from '@/lib/navhub-api'
import { getIdentity } from '@/lib/identity'
import {
  PROFILE_EMPTY_MESSAGE,
  profileDegradeNotice,
  profileViewState,
} from '@/lib/profile-view'
import { Sparkles, RotateCcw, Tag, FolderOpen, History, Search, Heart, Clock, ShieldAlert, Bot, Settings2 } from 'lucide-react'
import { UserLlmConfigCard } from '@/components/ai/user-llm-config-card'
import { UserCenterNav } from '@/components/user-center/user-center-nav'
import { CenterPageHeader } from '@/components/user-center/center-page-header'
import { EmptyState } from '@/components/ui/empty-state'

interface Profile {
  userId: string
  topCategories: string[]
  topTags: string[]
  visitedSiteIds: string[]
  favoriteSiteIds: string[]
  searchCount: number
  updatedAt: number
}

/** 类目 id → 标题（画像里存的是 id，直接展示对用户没有意义） */
async function loadCategoryTitles(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {}
  try {
    const cats = await hubGet<Array<{ id: string; title: string }>>('/api/categories')
    const map: Record<string, string> = {}
    for (const c of cats) map[c.id] = c.title
    return map
  } catch {
    return Object.fromEntries(ids.map((id) => [id, id]))
  }
}

async function loadSiteTitles(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  await Promise.all(
    ids.slice(0, 20).map(async (id) => {
      try {
        const site = await hubGet<HubSite>('/api/sites/' + encodeURIComponent(id))
        out[id] = site.title
      } catch {
        out[id] = id
      }
    }),
  )
  return out
}

export default function PreferencesPage() {
  const { toast } = useToast()
  const [identity, setIdentity] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [catTitles, setCatTitles] = useState<Record<string, string>>({})
  const [siteTitles, setSiteTitles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [resetting, setResetting] = useState(false)

  const load = useCallback(async (id: string) => {
    if (!id) return
    try {
      const data = await hubGet<{ profile: Profile | null }>(
        '/api/profile?anonId=' + encodeURIComponent(id),
      )
      setLoadError(null)
      setProfile(data.profile)
      if (data.profile) {
        setCatTitles(await loadCategoryTitles(data.profile.topCategories))
        setSiteTitles(await loadSiteTitles(data.profile.visitedSiteIds))
      }
    } catch (error) {
      // 中枢不可用时降级为「无画像」，但**必须记下错误**：
      // 否则界面会把「没取到」说成「你没有画像」（见 lib/profile-view.ts）
      setProfile(null)
      setLoadError(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const syncAndLoad = () => {
      const id = getIdentity()
      setIdentity(id)
      void load(id)
    }
    syncAndLoad()
    window.addEventListener('navhub_identity_ready', syncAndLoad)
    window.addEventListener('navhub_identity_changed', syncAndLoad)
    window.addEventListener('navhub_identity_merged', syncAndLoad)
    return () => {
      window.removeEventListener('navhub_identity_ready', syncAndLoad)
      window.removeEventListener('navhub_identity_changed', syncAndLoad)
      window.removeEventListener('navhub_identity_merged', syncAndLoad)
    }
  }, [load])

  const handleRetry = () => {
    if (!identity) return
    setLoading(true)
    setLoadError(null)
    void load(identity)
  }

  const handleReset = async () => {
    if (!identity) return
    setResetting(true)
    try {
      const res = await hubSend<{ ok: boolean; eventsRemoved: number; profileCleared: boolean }>(
        '/api/profile?anonId=' + encodeURIComponent(identity),
        'DELETE',
      )
      if (res.ok) {
        setProfile(null)
        setCatTitles({})
        setSiteTitles({})
        toast({
          title: '画像已重置',
          description: '已清除偏好与行为记录' + (res.eventsRemoved ? `（${res.eventsRemoved} 条行为事件）` : '') + '。收藏夹与搜索历史保持不变。',
        })
      }
    } catch {
      toast({ title: '重置失败', description: '中枢暂不可用，请稍后再试。', variant: 'destructive' })
    } finally {
      setResetting(false)
    }
  }

  const hasProfile = Boolean(
    profile &&
      (profile.topCategories.length > 0 ||
        profile.topTags.length > 0 ||
        profile.visitedSiteIds.length > 0),
  )

  const view = profileViewState({ loading, failed: loadError !== null, hasProfile })
  const degrade = loadError === null ? null : profileDegradeNotice(loadError)

  return (
    <Container as="main" id="main-content" className="space-y-5 pb-8 pt-3 sm:space-y-6 sm:pb-10 sm:pt-4">
      <UserCenterNav />

      <CenterPageHeader
        title="我的偏好"
        icon={Sparkles}
        eyebrow="个性化偏好"
        back={{ href: '/', label: '返回主页' }}
        description="搜索会根据你的浏览与收藏做轻量个性化重排。这里是系统据你的行为推断出的内容——看得见，才可以控制。"
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button variant="outline" size="sm" asChild className="w-full text-xs sm:w-auto">
              <Link href="/me">
                <Settings2 className="mr-2 h-4 w-4" />
                全局导航与隐私设置
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild className="w-full text-xs sm:w-auto">
              <Link href="/me/history">
                <History className="mr-2 h-4 w-4" />
                管理搜索历史
              </Link>
            </Button>
          </div>
        }
      />

      {view === 'loading' ? (
        <div aria-busy="true" aria-live="polite" aria-label="正在加载偏好" className="space-y-4">
          <span className="sr-only">加载中…</span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-3 rounded-xl border border-border/70 bg-card/50 p-4 last:col-span-2 sm:last:col-span-1">
                <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                <div className="h-6 w-24 animate-pulse rounded bg-muted" />
                <div className="h-2.5 w-20 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="space-y-3 rounded-xl border border-border/70 bg-card/50 p-4 sm:p-5">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="h-7 w-3/5 animate-pulse rounded-full bg-muted" />
                <div className="h-7 w-2/5 animate-pulse rounded-full bg-muted" />
              </div>
            ))}
          </div>
          <div className="space-y-3 rounded-xl border border-border/70 bg-card/50 p-4 sm:p-5">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ) : view === 'degraded' && degrade ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-6 text-center">
          <p className="text-sm font-medium text-foreground">{degrade.message}</p>
          <p className="mt-2 text-xs text-muted-foreground">{degrade.hint}</p>
          {degrade.retryable && (
            <Button size="sm" variant="outline" className="mt-4" onClick={handleRetry}>
              <RotateCcw className="mr-2 h-4 w-4" />
              重试
            </Button>
          )}
        </div>
      ) : view === 'empty' ? (
        <EmptyState
          icon={Sparkles}
          iconTone="muted"
          title="还没有可展示的偏好"
          description={PROFILE_EMPTY_MESSAGE}
          action={
            <Button asChild size="sm" variant="outline" className="text-xs">
              <Link href="/">去主页搜索并收藏站点</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4 sm:space-y-5">
          {/* 摘要：把原先挤在头图里的计数拆成可扫读的三块，窄屏 2 列、第三块整行 */}
          <section aria-label="画像摘要" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { icon: Search, label: '搜索次数', value: profile!.searchCount, hint: '累计参与统计' },
              { icon: Heart, label: '收藏站点', value: profile!.favoriteSiteIds.length, hint: '参与重排' },
              { icon: Clock, label: '画像更新', value: new Date(profile!.updatedAt).toLocaleDateString('zh-CN'), hint: '本地时区' },
            ].map((stat) => (
              <div
                key={stat.label}
                className="min-w-0 rounded-xl border border-border/70 bg-card/60 p-4 last:col-span-2 sm:last:col-span-1"
              >
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <stat.icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                  {stat.label}
                </p>
                <p className="mt-2 break-words text-lg font-semibold tabular-nums">{stat.value}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{stat.hint}</p>
              </div>
            ))}
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <section className="flex h-full min-w-0 flex-col rounded-xl border border-border/70 bg-card/60 p-4 transition-colors hover:border-border sm:p-5">
              <h2 className="mb-3 flex items-center justify-between gap-2 text-sm font-semibold">
                <span className="flex min-w-0 items-center gap-2">
                  <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                  常浏览的类目
                </span>
                <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
                  {profile!.topCategories.length} 个
                </span>
              </h2>
              <div className="flex flex-wrap gap-2">
                {profile!.topCategories.map((c) => (
                  <span
                    key={c}
                    title={catTitles[c] ?? c}
                    className="max-w-full truncate rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs"
                  >
                    {catTitles[c] ?? c}
                  </span>
                ))}
                {profile!.topCategories.length === 0 && (
                  <span className="text-xs text-muted-foreground">暂无</span>
                )}
              </div>
            </section>

            <section className="flex h-full min-w-0 flex-col rounded-xl border border-border/70 bg-card/60 p-4 transition-colors hover:border-border sm:p-5">
              <h2 className="mb-3 flex items-center justify-between gap-2 text-sm font-semibold">
                <span className="flex min-w-0 items-center gap-2">
                  <Tag className="h-4 w-4 shrink-0 text-primary" />
                  关注的标签
                </span>
                <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
                  {profile!.topTags.length} 个
                </span>
              </h2>
              <div className="flex flex-wrap gap-2">
                {profile!.topTags.map((t) => (
                  <span
                    key={t}
                    title={t}
                    className="max-w-full truncate rounded-full border border-border/60 bg-accent px-3 py-1 text-xs"
                  >
                    {t}
                  </span>
                ))}
                {profile!.topTags.length === 0 && (
                  <span className="text-xs text-muted-foreground">暂无</span>
                )}
              </div>
            </section>

            <section className="flex h-full min-w-0 flex-col rounded-xl border border-border/70 bg-card/60 p-4 sm:col-span-2 sm:p-5">
              <h2 className="mb-3 flex items-center justify-between gap-2 text-sm font-semibold">
                <span className="flex min-w-0 items-center gap-2">
                  <History className="h-4 w-4 shrink-0 text-primary" />
                  最近访问过的站点
                </span>
                <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
                  {profile!.visitedSiteIds.length} 个
                </span>
              </h2>
              <div className="flex flex-wrap gap-2">
                {profile!.visitedSiteIds.slice(0, 20).map((id) => (
                  <span
                    key={id}
                    title={siteTitles[id] ?? id}
                    className="max-w-full truncate rounded-full border border-border/60 bg-muted px-3 py-1 text-xs"
                  >
                    {siteTitles[id] ?? id}
                  </span>
                ))}
              </div>
              <p className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
                <span>展示最近 {Math.min(20, profile!.visitedSiteIds.length)} 个</span>
                <span aria-hidden>·</span>
                <span>更新于 {new Date(profile!.updatedAt).toLocaleString('zh-CN')}</span>
              </p>
            </section>

            <section className="min-w-0 rounded-xl border border-destructive/25 bg-destructive/[0.03] p-4 sm:col-span-2 sm:p-5">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-destructive">
                <ShieldAlert className="h-4 w-4" />
                重置画像
              </h2>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                清除以上偏好与相关行为记录。搜索结果将恢复为纯相关性排序。
                <strong className="text-foreground"> 收藏夹与搜索历史不会被删除</strong>——那是你主动保存的数据。
              </p>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleReset}
                disabled={resetting}
                className="w-full sm:w-auto"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                {resetting ? '重置中…' : '重置个性化画像'}
              </Button>
            </section>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Bot className="h-4 w-4 text-primary" />
            AI 与扩展
          </h2>
          <p className="text-xs text-muted-foreground">模型与密钥配置，只影响本机的增强能力。</p>
        </div>
        <UserLlmConfigCard />
      </section>

      <Footer />
    </Container>
  )
}
