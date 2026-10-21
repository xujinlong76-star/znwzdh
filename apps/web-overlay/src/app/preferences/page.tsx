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
import { Sparkles, RotateCcw, Tag, FolderOpen, History, ArrowLeft } from 'lucide-react'
import { UserLlmConfigCard } from '@/components/ai/user-llm-config-card'
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
    const id = getIdentity()
    setIdentity(id)
    void load(id)
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
    <Container as="main" id="main-content" className="py-4 sm:py-8 space-y-5 sm:space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-4 sm:p-8 shadow-xs mb-6">
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 w-64 h-64 bg-primary/10 rounded-full blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -left-20 bottom-0 w-44 h-44 bg-sky-400/10 rounded-full blur-3xl" />
        <Sparkles
          aria-hidden
          strokeWidth={1}
          className="pointer-events-none absolute right-5 top-5 hidden sm:block w-16 h-16 text-border/70"
        />
        <div className="relative z-10 space-y-3">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回主页</span>
            </Link>
            <span className="text-border">/</span>
            <span className="text-xs text-primary font-medium">个性化偏好</span>
          </div>
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
            <div className="max-w-2xl">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-xs shrink-0">
                  <Sparkles className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <span className="truncate">我的偏好</span>
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
                搜索会根据你的浏览与收藏做轻量个性化重排。这里是系统据你的行为推断出的内容——
                看得见，才可以控制。
              </p>
            </div>
            <Button variant="outline" size="sm" asChild className="w-full sm:w-auto shrink-0 text-xs">
              <Link href="/favorites">
                <History className="mr-2 h-4 w-4" />
                搜索历史另在收藏页管理
              </Link>
            </Button>
          </div>
          <div className="mt-5 pt-4 border-t border-border/50 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/25 bg-primary/5 text-xs text-primary">
              <Sparkles className="w-3 h-3" />
              {view === 'loading'
                ? '正在读取画像'
                : view === 'empty'
                ? '暂无画像'
                : view === 'degraded'
                ? '画像暂不可用'
                : '画像已生成'}
            </span>
            {profile && (
              <>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                  搜索 {profile.searchCount} 次
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                  收藏 {profile.favoriteSiteIds.length} 个
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {view === 'loading' ? (
        <div aria-busy="true" aria-live="polite" aria-label="正在加载偏好" className="space-y-4">
          <span className="sr-only">加载中…</span>
          <div className="rounded-xl border border-border/70 bg-card/50 p-5 space-y-3 animate-pulse">
            <div className="h-4 w-32 rounded bg-muted" />
            <div className="h-8 w-full rounded bg-muted" />
            <div className="h-8 w-4/5 rounded bg-muted" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/70 bg-card/50 p-5 space-y-3 animate-pulse">
                <div className="h-4 w-24 rounded bg-muted" />
                <div className="h-3 w-full rounded bg-muted" />
                <div className="h-3 w-2/3 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ) : view === 'degraded' && degrade ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-6 text-center">
          <p className="text-sm text-muted-foreground">{degrade.message}</p>
          <p className="text-xs text-muted-foreground mt-2">{degrade.hint}</p>
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
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-xl border border-border/70 bg-card/60 p-4 sm:p-5 transition-colors hover:border-border">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-primary" />
              常浏览的类目
            </h2>
            <div className="flex flex-wrap gap-2">
              {profile!.topCategories.map((c) => (
                <span key={c} className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs">
                  {catTitles[c] ?? c}
                </span>
              ))}
              {profile!.topCategories.length === 0 && (
                <span className="text-xs text-muted-foreground">暂无</span>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border/70 bg-card/60 p-4 sm:p-5 transition-colors hover:border-border">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" />
              关注的标签
            </h2>
            <div className="flex flex-wrap gap-2">
              {profile!.topTags.map((t) => (
                <span key={t} className="rounded-full border border-border/60 bg-accent px-3 py-1 text-xs">
                  {t}
                </span>
              ))}
              {profile!.topTags.length === 0 && (
                <span className="text-xs text-muted-foreground">暂无</span>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border/70 bg-card/60 p-4 sm:p-5 sm:col-span-2">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              最近访问过的站点（{profile!.visitedSiteIds.length}）
            </h2>
            <div className="flex flex-wrap gap-2">
              {profile!.visitedSiteIds.slice(0, 20).map((id) => (
                <span key={id} className="rounded-full border border-border/60 bg-muted px-3 py-1 text-xs max-w-full truncate inline-block">
                  {siteTitles[id] ?? id}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border/50 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>搜索计数 {profile!.searchCount} 次</span>
              <span>·</span>
              <span>收藏 {profile!.favoriteSiteIds.length} 个</span>
              <span>·</span>
              <span>更新于 {new Date(profile!.updatedAt).toLocaleString('zh-CN')}</span>
            </p>
          </section>

          <section className="rounded-xl border border-dashed border-border/70 bg-card/40 p-4 sm:p-5 sm:col-span-2">
            <h2 className="text-sm font-medium mb-2">重置画像</h2>
            <p className="text-xs text-muted-foreground mb-3">
              清除以上偏好与相关行为记录。搜索结果将恢复为纯相关性排序。
              <strong className="text-foreground"> 收藏夹与搜索历史不会被删除</strong>——那是你主动保存的数据。
            </p>
            <Button size="sm" variant="destructive" onClick={handleReset} disabled={resetting} className="w-full sm:w-auto">
              <RotateCcw className="mr-2 h-4 w-4" />
              {resetting ? '重置中…' : '重置个性化画像'}
            </Button>
          </section>
        </div>
      )}

      <div className="mt-6">
        <UserLlmConfigCard />
      </div>
    </Container>
  )
}
