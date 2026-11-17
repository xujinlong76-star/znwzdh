'use client'

/**
 * 公开作者页：/marketplace/author/<ownerKey>
 *
 * ownerKey 是服务端对内部归属身份做的不可逆哈希（sha256 前 24 位），
 * 因此可以安全公开；页面只展示 published 插件与聚合计数，不暴露 identity。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import {
  fetchAuthorPlugins,
  saveAuthorProfile,
  type HubPluginAuthorResponse,
  type HubPluginItem,
  type PluginAuthorProfile,
} from '@/lib/navhub-api'
import { getIdentity } from '@/lib/identity'
import { PluginCard, AuthorVerifiedBadge } from '@/components/plugins/plugin-card'
import { safeHref } from '@/lib/safe-url'
import { toast } from 'sonner'
import { failureToastOptions } from '@/lib/failure-guidance'
import dynamic from 'next/dynamic'

const PluginInstallModal = dynamic(
  () => import('@/components/plugins/plugin-install-modal').then((m) => m.PluginInstallModal),
  { ssr: false }
)
import { ArrowLeft, Download, ExternalLink, Heart, Loader2, Pencil, Star, Store, UserRound } from 'lucide-react'

export default function AuthorPluginsView({
  ownerKey,
  initialData = null,
}: {
  ownerKey: string
  initialData?: HubPluginAuthorResponse | null
}) {
  const identity = useMemo(() => getIdentity(), [])
  const [data, setData] = useState<HubPluginAuthorResponse | null>(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [loadingMore, setLoadingMore] = useState(false)
  const [notice, setNotice] = useState<DegradeNotice | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [installTarget, setInstallTarget] = useState<HubPluginItem | null>(null)
  const [installMode, setInstallMode] = useState<'install' | 'uninstall' | 'upgrade'>('install')
  // 作者档案编辑（D 批）：仅作者本人（data.isOwner）可见。表单状态在打开时
  // 从 data.profile 初始化；保存走 POST /api/plugins/author/profile。
  const [editingProfile, setEditingProfile] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({
    displayName: '',
    bio: '',
    avatar: '',
    homepage: '',
    github: '',
    x: '',
    donateUrl: '',
  })

  const handleOpenInstallModal = useCallback(
    (plugin: HubPluginItem, mode: 'install' | 'uninstall' | 'upgrade' = 'install') => {
      setInstallTarget(plugin)
      setInstallMode(mode)
    },
    [],
  )

  // A-4b：作者插件 >100 时列表不再截断在前 100 条。首屏 offset=0 替换，
  // 「加载更多」按已显示条数取下一页追加；与插件市场列表
  // （plugin-market-board.tsx）同款形态。追加页失败时 res 是降级兜底
  // null，不能拿它覆盖现有状态：否则已加载的 100 条会被清空、按钮随之
  // 消失，后面的页再也到不了。total 追加时只涨不跌（同 A-3 管理端守卫）。
  const load = useCallback(async (offset = 0, append = false) => {
    if (append) setLoadingMore(true)
    else {
      setLoading(true)
      setNotice(null)
    }
    const res = await fetchAuthorPlugins(
      ownerKey,
      { limit: 100, offset },
      (error) => setNotice(describeDegrade(error, '作者页')),
    )
    // 已由服务端验证过的作者页在刷新失败时保留首屏数据，只显示降级提示
    if (res) {
      setData((prev) =>
        append && prev
          ? { ...res, items: [...prev.items, ...res.items], total: Math.max(prev.total, res.total) }
          : res,
      )
    }
    if (append) setLoadingMore(false)
    else setLoading(false)
  }, [ownerKey])

  useEffect(() => {
    // 首屏已经由 SSR 注入数据；只有显式重试（reloadToken 变化）才重新请求
    if (initialData && reloadToken === 0) return
    void load()
  }, [load, reloadToken, initialData])

  // SSR 注入的 initialData 没有调用方身份，isOwner 恒为 false；本地有身份时
  // 后台静默刷新一次（不闪 loading、不覆盖已加载的更多页），作者本人才能
  // 看到「编辑我的档案」入口；非本人刷新后 isOwner 仍为 false、无任何变化。
  const refreshedForIdentity = useRef(false)
  useEffect(() => {
    if (!initialData || refreshedForIdentity.current) return
    if (typeof window === 'undefined' || !getIdentity()) return
    refreshedForIdentity.current = true
    void fetchAuthorPlugins(ownerKey, { limit: 100, offset: 0 }).then((res) => {
      // 只补 profile/isOwner 这类服务端才知道的字段；已加载的更多页不回退
      if (res) {
        setData((prev) =>
          prev
            ? {
                ...res,
                items: prev.items.length >= res.items.length ? prev.items : res.items,
                total: Math.max(prev.total, res.total),
              }
            : res,
        )
      }
    })
  }, [initialData, ownerKey])

  const openProfileEditor = () => {
    const p: PluginAuthorProfile | null | undefined = data?.profile
    setProfileForm({
      displayName: p?.displayName ?? '',
      bio: p?.bio ?? '',
      avatar: p?.avatar ?? '',
      homepage: p?.links?.homepage ?? '',
      github: p?.links?.github ?? '',
      x: p?.links?.x ?? '',
      donateUrl: p?.donateUrl ?? '',
    })
    setEditingProfile(true)
  }

  const handleSaveProfile = async () => {
    const trim = (v: string) => v.trim()
    setSavingProfile(true)
    try {
      const res = await saveAuthorProfile({
        displayName: trim(profileForm.displayName) || null,
        bio: trim(profileForm.bio) || null,
        avatar: trim(profileForm.avatar) || null,
        links: {
          homepage: trim(profileForm.homepage) || undefined,
          github: trim(profileForm.github) || undefined,
          x: trim(profileForm.x) || undefined,
        },
        donateUrl: trim(profileForm.donateUrl) || null,
      })
      setData((prev) => (prev ? { ...prev, profile: res.profile } : prev))
      setEditingProfile(false)
      toast.success('作者档案已保存')
    } catch (err) {
      toast.error('保存失败', failureToastOptions(err, () => void handleSaveProfile()))
    } finally {
      setSavingProfile(false)
    }
  }

  const patchItem = useCallback((updated: HubPluginItem) => {
    setData((prev) =>
      prev
        ? { ...prev, items: prev.items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)) }
        : prev,
    )
  }, [])

  // P2-1：作者页响应体（HubPluginAuthorResponse）没有 authorVerified 字段，
  // 中枢只在插件条目（HubPluginItem.authorVerified）上返回；authorVerified
  // 语义上是作者级字段（同作者的作品共用同一作者身份），因此以本页作品列表
  // 为准：任一作品已认证即视为作者已认证。作者尚无已上架作品时无法判定，
  // 不展示徽章（不猜、不补默认值）。
  const authorVerified = useMemo(
    () => data?.items.some((item) => item.authorVerified === true) ?? false,
    [data],
  )

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回插件市场</span>
          </Link>
          <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
            <Link href="/marketplace/mine">
              <UserRound className="w-3.5 h-3.5" />
              作者中心
            </Link>
          </Button>
        </div>

        {loading ? (
          <div className="py-24 text-center text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-3" />
            正在加载作者主页…
          </div>
        ) : !data ? (
          notice ? (
            <div className="py-10 space-y-4 max-w-2xl mx-auto">
              <HubDegradedNotice notice={notice} onRetry={() => setReloadToken((t) => t + 1)} />
              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                未能加载作者主页，可能是网络或中枢服务问题；重试后仍失败请稍后再来。
              </p>
            </div>
          ) : (
            <div className="py-20 text-center border border-dashed border-border/70 rounded-2xl space-y-3">
              <UserRound className="w-8 h-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">作者不存在，或暂时没有已上架插件</p>
              <Button asChild size="sm" variant="outline">
                <Link href="/marketplace">去市场逛逛</Link>
              </Button>
            </div>
          )
        ) : (
          <>
            <div className="rounded-2xl border border-border/70 glass-surface market-hero p-6 sm:p-7 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                    {data.profile?.avatar ? (
                      <span className="text-2xl leading-none">{data.profile.avatar}</span>
                    ) : (
                      <UserRound className="w-6 h-6" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight truncate">
                        {data.profile?.displayName || data.author}
                      </h1>
                      {data.authorKind && (
                        <Badge variant="outline" className="text-[10px]">
                          {data.authorKind === 'import' ? '导入作者' : '社区作者'}
                        </Badge>
                      )}
                      {/* P2-1：已认证才显徽章，未认证不占位 */}
                      {authorVerified && <AuthorVerifiedBadge />}
                      {data.isOwner && (
                        <Badge variant="outline" className="text-[10px] text-primary border-primary/30 bg-primary/5">
                          这是你
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                      ownerKey: {data.ownerKey.slice(0, 12)}…
                    </p>
                  </div>
                </div>
                {data.isOwner && !editingProfile && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={openProfileEditor}
                    className="h-8 gap-1.5 text-xs shrink-0"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    编辑我的档案
                  </Button>
                )}
              </div>
              {/* 作者档案（D 批）：只渲染作者真实填过的内容，未填的不显示、不造假 */}
              {data.profile?.bio && (
                <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
                  {data.profile.bio}
                </p>
              )}
              {(data.profile?.links?.homepage ||
                data.profile?.links?.github ||
                data.profile?.links?.x ||
                data.profile?.donateUrl) && (
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {data.profile.links?.homepage && (
                    <a
                      href={safeHref(data.profile.links.homepage)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>个人主页</span>
                    </a>
                  )}
                  {data.profile.links?.github && (
                    <a
                      href={safeHref(data.profile.links.github)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>GitHub</span>
                    </a>
                  )}
                  {data.profile.links?.x && (
                    <a
                      href={safeHref(data.profile.links.x)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>X</span>
                    </a>
                  )}
                  {data.profile.donateUrl && (
                    <a
                      href={safeHref(data.profile.donateUrl)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <Heart className="w-3 h-3" />
                      <span>支持作者</span>
                    </a>
                  )}
                </div>
              )}
              {/* 作者本人编辑档案（D 批）：头像只认 emoji/短文本，链接须为 http(s) 绝对地址 */}
              {data.isOwner && editingProfile && (
                <div className="rounded-xl border border-border/70 bg-background/60 p-4 space-y-3">
                  <h2 className="text-sm font-semibold text-foreground">编辑我的档案</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">显示名称（最多 60 字）</span>
                      <input
                        value={profileForm.displayName}
                        maxLength={60}
                        onChange={(e) => setProfileForm((f) => ({ ...f, displayName: e.target.value }))}
                        placeholder={data.author}
                        className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground"
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">头像（emoji 或短文本，8 字符以内）</span>
                      <input
                        value={profileForm.avatar}
                        maxLength={8}
                        onChange={(e) => setProfileForm((f) => ({ ...f, avatar: e.target.value }))}
                        placeholder="如 🐱"
                        className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground"
                      />
                    </label>
                    <label className="space-y-1 text-xs sm:col-span-2">
                      <span className="text-muted-foreground">简介（最多 500 字）</span>
                      <textarea
                        value={profileForm.bio}
                        maxLength={500}
                        rows={3}
                        onChange={(e) => setProfileForm((f) => ({ ...f, bio: e.target.value }))}
                        placeholder="介绍一下你自己和你的插件…"
                        className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground"
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">个人主页链接</span>
                      <input
                        value={profileForm.homepage}
                        type="url"
                        onChange={(e) => setProfileForm((f) => ({ ...f, homepage: e.target.value }))}
                        placeholder="https://…"
                        className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground"
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">GitHub 链接</span>
                      <input
                        value={profileForm.github}
                        type="url"
                        onChange={(e) => setProfileForm((f) => ({ ...f, github: e.target.value }))}
                        placeholder="https://github.com/…"
                        className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground"
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">X 链接</span>
                      <input
                        value={profileForm.x}
                        type="url"
                        onChange={(e) => setProfileForm((f) => ({ ...f, x: e.target.value }))}
                        placeholder="https://x.com/…"
                        className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground"
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">捐赠链接（填了才在详情页展示）</span>
                      <input
                        value={profileForm.donateUrl}
                        type="url"
                        onChange={(e) => setProfileForm((f) => ({ ...f, donateUrl: e.target.value }))}
                        placeholder="https://…"
                        className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground"
                      />
                    </label>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    留空表示不填、不展示；头像只能是 emoji 或短文本，不能填图片地址。
                  </p>
                  <div className="flex items-center gap-2">
                    <Button size="sm" disabled={savingProfile} onClick={() => void handleSaveProfile()}>
                      {savingProfile ? '保存中…' : '保存档案'}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={savingProfile} onClick={() => setEditingProfile(false)}>
                      取消
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Store className="w-3.5 h-3.5 text-primary" />
                  {data.stats.plugins} 个已上架插件
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5 text-primary" />
                  {data.stats.installs} 次安装
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 text-amber-500" />
                  {data.stats.stars} 星标
                </span>
              </div>
            </div>

            {notice && (
              <HubDegradedNotice notice={notice} onRetry={() => setReloadToken((n) => n + 1)} subject="作者页" />
            )}

            {data.items.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground border border-dashed border-border/70 rounded-2xl">
                这位作者还没有已上架插件
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.items.map((plugin) => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    identity={identity}
                    onStatusChange={patchItem}
                    onOpenInstallModal={handleOpenInstallModal}
                  />
                ))}
              </div>
            )}

            {data.items.length < data.total && (
              <div className="text-center">
                <Button
                  variant="outline"
                  disabled={loadingMore}
                  onClick={() => void load(data.items.length, true)}
                  className="gap-1.5"
                >
                  {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                  加载更多（{data.items.length}/{data.total}）
                </Button>
              </div>
            )}
          </>
        )}
      </div>

        {/* 安装 / 卸载确认弹窗 */}
        <PluginInstallModal
          plugin={installTarget}
          mode={installMode}
          identity={identity}
          open={Boolean(installTarget)}
          onOpenChange={(next) => {
            if (!next) {
              setInstallTarget(null)
              setInstallMode('install')
            }
          }}
          onSuccess={() => setReloadToken((n) => n + 1)}
        />
      <Footer />
    </Container>
  )
}
