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
import { hubGet, hubSend, getApiToken, setApiToken, type HubSite } from '@/lib/navhub-api'
import { getIdentity } from '@/lib/identity'
import { Sparkles, RotateCcw, Tag, FolderOpen, History, KeyRound } from 'lucide-react'

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
  const [resetting, setResetting] = useState(false)
  /** 多端身份 token（本机保存，服务端据此绑定云端数据归属） */
  const [apiToken, setApiTokenState] = useState<string | null>(null)
  const [tokenDraft, setTokenDraft] = useState('')
  const [tokenSaved, setTokenSaved] = useState(false)

  const load = useCallback(async (id: string) => {
    if (!id) return
    try {
      const data = await hubGet<{ profile: Profile | null }>(
        '/api/profile?anonId=' + encodeURIComponent(id),
      )
      setProfile(data.profile)
      if (data.profile) {
        setCatTitles(await loadCategoryTitles(data.profile.topCategories))
        setSiteTitles(await loadSiteTitles(data.profile.visitedSiteIds))
      }
    } catch {
      // 中枢不可用时降级为「无画像」，不抛给 UI
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = getIdentity()
    setIdentity(id)
    setApiTokenState(getApiToken())
    void load(id)
  }, [load])

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

  return (
    <Container className="py-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            我的偏好
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            搜索会根据你的浏览与收藏做轻量个性化重排。这里是系统据你的行为推断出的内容——
            看得见，才可以控制。
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/favorites">
            <History className="mr-2 h-4 w-4" />
            搜索历史另在收藏页管理
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">加载中…</div>
      ) : (
        <section className="rounded-md border p-4 mb-6">
          <h2 className="text-sm font-medium mb-2 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            多端身份 token（可选）
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            默认匿名：云端数据按本机随机 ID 归属，多端不互通。填入管理员签发的 token 后，
            收藏 / 金库 / 画像 / 历史改为绑定该 token——换设备填同一 token 即同步，
            且别人猜到你的匿名 ID 也读不到你的数据。token 只存本机浏览器，不上传别处。
          </p>
          {apiToken ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono rounded bg-muted px-2 py-1">
                已绑定（{apiToken.slice(0, 6)}…{apiToken.slice(-4)}）
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setApiToken(null)
                  setApiTokenState(null)
                  setTokenSaved(false)
                  if (identity) void load(identity)
                }}
              >
                解除绑定（回退匿名）
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                value={tokenDraft}
                onChange={(e) => { setTokenDraft(e.target.value); setTokenSaved(false) }}
                placeholder="粘贴 token 明文（仅显示一次的那个）"
                className="h-9 flex-1 min-w-52 rounded-md border bg-background px-3 text-sm font-mono"
              />
              <Button
                size="sm"
                disabled={!tokenDraft.trim()}
                onClick={() => {
                  setApiToken(tokenDraft)
                  setApiTokenState(tokenDraft.trim())
                  setTokenDraft('')
                  setTokenSaved(true)
                  if (identity) void load(identity)
                }}
              >
                保存并绑定
              </Button>
            </div>
          )}
          {tokenSaved && (
            <p className="text-xs text-green-600 mt-2">已绑定，云端数据现归属该 token。刷新页面后生效于全部请求。</p>
          )}
        </section>
      )}

      {!loading && !hasProfile && (
        <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          暂无个性化画像。搜索并收藏几个站点后，这里会显示系统推断出的偏好。
        </div>
      )}
      {!loading && hasProfile && (
        <div className="space-y-6">
          <section className="rounded-md border p-4">
            <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-primary" />
              常浏览的类目
            </h2>
            <div className="flex flex-wrap gap-2">
              {profile!.topCategories.map((c) => (
                <span key={c} className="rounded-full bg-primary/10 px-3 py-1 text-xs">
                  {catTitles[c] ?? c}
                </span>
              ))}
              {profile!.topCategories.length === 0 && (
                <span className="text-xs text-muted-foreground">暂无</span>
              )}
            </div>
          </section>

          <section className="rounded-md border p-4">
            <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" />
              关注的标签
            </h2>
            <div className="flex flex-wrap gap-2">
              {profile!.topTags.map((t) => (
                <span key={t} className="rounded-full bg-accent px-3 py-1 text-xs">
                  {t}
                </span>
              ))}
              {profile!.topTags.length === 0 && (
                <span className="text-xs text-muted-foreground">暂无</span>
              )}
            </div>
          </section>

          <section className="rounded-md border p-4">
            <h2 className="text-sm font-medium mb-3">最近访问过的站点（{profile!.visitedSiteIds.length}）</h2>
            <div className="flex flex-wrap gap-2">
              {profile!.visitedSiteIds.slice(0, 20).map((id) => (
                <span key={id} className="rounded-full bg-muted px-3 py-1 text-xs">
                  {siteTitles[id] ?? id}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              搜索计数 {profile!.searchCount} 次 · 收藏 {profile!.favoriteSiteIds.length} 个 ·
              更新于 {new Date(profile!.updatedAt).toLocaleString('zh-CN')}
            </p>
          </section>

          <section className="rounded-md border border-dashed p-4">
            <h2 className="text-sm font-medium mb-2">重置画像</h2>
            <p className="text-xs text-muted-foreground mb-3">
              清除以上偏好与相关行为记录。搜索结果将恢复为纯相关性排序。
              <strong className="text-foreground"> 收藏夹与搜索历史不会被删除</strong>——那是你主动保存的数据。
            </p>
            <Button size="sm" variant="destructive" onClick={handleReset} disabled={resetting}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {resetting ? '重置中…' : '重置个性化画像'}
            </Button>
          </section>
        </div>
      )}
    </Container>
  )
}
