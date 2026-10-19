'use client'

/**
 * 插件市场首页：社区共享的「网址信息」与「功能」。
 *
 * 三种插件形态（全部为声明式 JSON，经 @navhub/core 契约校验，零任意代码执行）：
 *   - site-pack        网站包：站点 + 分类 + 标签
 *   - workspace-preset 工作台预设：Bento 看板与模块组合
 *   - theme            主题：强调色 + 设计 token
 *
 * 数据统一走 /api/hub BFF（见 lib/navhub-api.ts），中枢不可用时降级提示 + 重试。
 * 卡片与安装确认弹窗复用 components/plugins/**（与详情页同一套交互）：
 * 列表页不挂载工作台状态机，workspace-preset 确认后暂存，由 /custom 画布消费。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { fetchPlugins, type HubPluginItem } from '@/lib/navhub-api'
import { getIdentity } from '@/lib/identity'
import { PluginCard } from '@/components/plugins/plugin-card'
import { PluginInstallModal } from '@/components/plugins/plugin-install-modal'
import { stageWorkspacePreset } from '@/lib/plugins/preset-staging'
import {
  ArrowLeft,
  Crown,
  Flame,
  Loader2,
  PackageCheck,
  Search,
  Sparkles,
  Star,
  Store,
  TrendingUp,
  Upload,
  UserRound,
} from 'lucide-react'

const PAGE_SIZE = 24

const TOPIC_COLLECTIONS = [
  { id: 'all', title: '全部插件', icon: '🌐' },
  { id: 'trending', title: '🔥 飙升榜', sort: 'trending' },
  { id: 'geek', title: '🚀 极客全栈装备', q: '武器库' },
  { id: 'search', title: '🔍 快捷直达引擎', kind: 'search-pack' },
  { id: 'devops', title: '📊 生产力工作台', kind: 'workspace-preset' },
  { id: 'theme', title: '🎨 赛博与暗黑美学', kind: 'theme' },
] as const

export default function MarketplacePage() {
  const identity = useMemo(() => getIdentity(), [])
  const [items, setItems] = useState<HubPluginItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [notice, setNotice] = useState<DegradeNotice | null>(null)
  const [kind, setKind] = useState('')
  const [sort, setSort] = useState('trending')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [installTarget, setInstallTarget] = useState<HubPluginItem | null>(null)
  const [featured, setFeatured] = useState<HubPluginItem[]>([])
  const [rankings, setRankings] = useState<{
    popular: HubPluginItem[]
    rating: HubPluginItem[]
    fresh: HubPluginItem[]
  }>({ popular: [], rating: [], fresh: [] })

  const load = useCallback(
    async (offset: number, append: boolean) => {
      if (append) setLoadingMore(true)
      else setLoading(true)
      if (!append) setNotice(null)
      const onDegraded = (error: unknown) => setNotice(describeDegrade(error, '插件市场'))
      const res = await fetchPlugins(
        { kind: kind || undefined, q: q || undefined, sort, limit: PAGE_SIZE, offset },
        onDegraded,
      )
      setItems((prev) => (append ? [...prev, ...res.items] : res.items))
      setTotal(res.total)
      if (append) setLoadingMore(false)
      else setLoading(false)
    },
    [kind, q, sort],
  )

  useEffect(() => {
    void load(0, false)
  }, [load, reloadToken])

  const reload = useCallback(() => setReloadToken((n) => n + 1), [])

  const patchItem = useCallback((updated: HubPluginItem) => {
    setItems((prev) => prev.map((p) => (p.slug === updated.slug ? { ...p, ...updated } : p)))
  }, [])

  const hasFilter = Boolean(q || kind)

  // 精选与三榜只在“无筛选”时加载：避免与主列表抢请求，也避免筛选后仍显示无关推荐
  useEffect(() => {
    if (hasFilter) return
    let cancelled = false
    void Promise.all([
      fetchPlugins({ featured: true, sort: 'featured', limit: 6 }),
      fetchPlugins({ sort: 'popular', limit: 5 }),
      fetchPlugins({ sort: 'rating', limit: 5 }),
      fetchPlugins({ sort: 'new', limit: 5 }),
    ]).then(([f, popular, rating, fresh]) => {
      if (cancelled) return
      setFeatured(f.items)
      setRankings({ popular: popular.items, rating: rating.items, fresh: fresh.items })
    })
    return () => {
      cancelled = true
    }
  }, [hasFilter, reloadToken])

  const rankingGroups = [
    {
      key: 'popular' as const,
      title: '安装榜',
      icon: TrendingUp,
      metric: (p: HubPluginItem) => `${p.installCount} 次安装`,
    },
    {
      key: 'rating' as const,
      title: '口碑榜',
      icon: Star,
      metric: (p: HubPluginItem) =>
        (p.reviewCount ?? 0) > 0 ? `${(p.ratingAvg ?? 0).toFixed(1)} 分 · ${p.reviewCount} 评价` : '暂无评价',
    },
    {
      key: 'fresh' as const,
      title: '新作榜',
      icon: Sparkles,
      metric: (p: HubPluginItem) => (p.publishedAt ? new Date(p.publishedAt).toLocaleDateString('zh-CN') : '刚刚上架'),
    },
  ]

  const handleTopicClick = (topic: typeof TOPIC_COLLECTIONS[number]) => {
    if (topic.id === 'all') {
      setKind('')
      setQ('')
      setQInput('')
      setSort('trending')
    } else {
      if ('kind' in topic && topic.kind) setKind(topic.kind)
      else setKind('')
      if ('q' in topic && topic.q) {
        setQ(topic.q)
        setQInput(topic.q)
      } else {
        setQ('')
        setQInput('')
      }
      if ('sort' in topic && topic.sort) setSort(topic.sort)
    }
  }

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 space-y-6">
        {/* 顶部展板 */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface subtle-mesh p-6 sm:p-7 shadow-xs">
          <div className="flex items-center gap-2 mb-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回首页</span>
            </Link>
            <span className="text-border">/</span>
            <span className="text-xs text-primary font-medium flex items-center gap-1">
              <Store className="w-3.5 h-3.5" />
              插件市场
            </span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                插件市场
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-2xl">
                与社区互换收藏的网址包、工作台布局、主题与搜索引擎包。全部插件都是可读可审计的声明式 JSON，
                不含任何可执行代码；安装前可先看清单预览。
              </p>
            </div>
            <div className="flex items-center flex-wrap gap-2 shrink-0">
              <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                <Link href="/marketplace/installed">
                  <PackageCheck className="w-3.5 h-3.5 text-primary" />
                  已安装管家
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                <Link href="/marketplace/import">
                  <Upload className="w-3.5 h-3.5" />
                  导入插件文件
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                <Link href="/marketplace/mine">
                  <UserRound className="w-3.5 h-3.5" />
                  作者中心
                </Link>
              </Button>
              <Button asChild size="sm" className="h-8 gap-1.5 text-xs">
                <Link href="/marketplace/publish">发布插件</Link>
              </Button>
            </div>
          </div>

          {/* 精选专题集胶囊 */}
          <div className="mt-5 pt-4 border-t border-border/50 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1 mr-1">
              <Flame className="w-3 h-3 text-amber-500" />
              精选专题：
            </span>
            {TOPIC_COLLECTIONS.map((topic) => {
              const isTopicActive =
                (topic.id === 'all' && !kind && !q && sort === 'trending') ||
                ('kind' in topic && kind === topic.kind) ||
                ('q' in topic && q === topic.q) ||
                ('sort' in topic && sort === topic.sort && !kind && !q)
              return (
                <button
                  key={topic.id}
                  onClick={() => handleTopicClick(topic)}
                  className={`px-2.5 py-1 rounded-full text-xs transition-all ${
                    isTopicActive
                      ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                      : 'bg-background/70 hover:bg-background text-muted-foreground hover:text-foreground border border-border/60'
                  }`}
                >
                  {topic.title}
                </button>
              )
            })}
          </div>
        </div>

        {/* 筛选栏 */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="按类型筛选"
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">全部类型</option>
            <option value="site-pack">网站包</option>
            <option value="workspace-preset">工作台预设</option>
            <option value="theme">主题</option>
            <option value="search-pack">搜索引擎包</option>
          </select>
          <select
            aria-label="排序方式"
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="trending">🔥 7天飙升榜</option>
            <option value="new">最新发布</option>
            <option value="popular">安装最多</option>
            <option value="stars">星标最多</option>
            <option value="rating">评分最高</option>
            <option value="updated">最近更新</option>
          </select>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              setQ(qInput.trim())
            }}
          >
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label="搜索插件"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="搜索名称 / 描述"
                className="h-8 w-52 rounded-md border border-input bg-background pl-8 pr-2.5 text-sm"
              />
            </div>
            <Button type="submit" size="sm" variant="outline" className="h-8">
              搜索
            </Button>
          </form>
          {total > 0 && !loading && (
            <span className="text-xs text-muted-foreground ml-auto">共 {total} 个插件</span>
          )}
        </div>

        {notice && <HubDegradedNotice notice={notice} onRetry={reload} subject="插件市场" />}

        {!hasFilter && featured.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <Crown className="w-4 h-4 text-amber-500" />
                编辑精选
              </h2>
              <span className="text-[11px] text-muted-foreground">人工挑选的社区代表作</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {featured.slice(0, 6).map((p) => (
                <PluginCard
                  key={`featured-${p.id}`}
                  plugin={p}
                  identity={identity}
                  onStatusChange={patchItem}
                  onOpenInstallModal={setInstallTarget}
                />
              ))}
            </div>
          </section>
        )}

        {!hasFilter && (rankings.popular.length > 0 || rankings.rating.length > 0 || rankings.fresh.length > 0) && (
          <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {rankingGroups.map((group) => {
              const rows = rankings[group.key]
              const Icon = group.icon
              return (
                <div key={group.key} className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Icon className="w-3.5 h-3.5 text-primary" />
                    {group.title}
                  </div>
                  {rows.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground py-2">暂无数据</p>
                  ) : (
                    <ol className="space-y-1.5">
                      {rows.map((p, index) => (
                        <li key={`${group.key}-${p.id}`}>
                          <Link
                            href={`/marketplace/${encodeURIComponent(p.slug)}`}
                            className="flex items-center gap-2 rounded-md px-1.5 py-1 -mx-1.5 hover:bg-muted/60 transition-colors"
                          >
                            <span className="w-4 text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
                            <span className="text-xs font-medium truncate flex-1">{p.name}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">{group.metric(p)}</span>
                          </Link>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )
            })}
          </section>
        )}

        {/* 列表 */}
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-3" />
            正在加载插件市场…
          </div>
        ) : items.length === 0 ? (
          <div className="py-14 text-center border border-dashed border-border/70 rounded-2xl space-y-3">
            <Store className="w-8 h-8 mx-auto text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {hasFilter
                ? '没有匹配的插件，换个筛选条件试试'
                : '市场还空着——发布第一个插件，分享你的网址收藏或工作台布局'}
            </p>
            <div className="flex items-center justify-center gap-2">
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link href="/marketplace/import">
                  <Upload className="w-3.5 h-3.5" />
                  导入文件
                </Link>
              </Button>
              <Button asChild size="sm" className="gap-1.5">
                <Link href="/marketplace/publish">发布插件</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
            {items.map((p) => (
              <PluginCard
                key={p.id}
                plugin={p}
                identity={identity}
                onStatusChange={patchItem}
                onOpenInstallModal={setInstallTarget}
              />
            ))}
          </div>
        )}

        {items.length < total && (
          <div className="text-center">
            <Button
              variant="outline"
              disabled={loadingMore}
              onClick={() => void load(items.length, true)}
              className="gap-1.5"
            >
              {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
              加载更多（{items.length}/{total}）
            </Button>
          </div>
        )}

        {/* 安装确认弹窗：卡片快捷安装统一走这里（预演范围 + 客户端消费 payload） */}
        <PluginInstallModal
          plugin={installTarget}
          mode="install"
          identity={identity}
          open={Boolean(installTarget)}
          onOpenChange={(next) => {
            if (!next) setInstallTarget(null)
          }}
          onSuccess={reload}
          onApplyPreset={(preset, mode) => {
            // 列表页不挂载工作台状态机：暂存并由 /custom 画布消费（携带用户选择的模式）
            if (installTarget) {
              stageWorkspacePreset(installTarget.slug, installTarget.name, preset, mode)
            }
          }}
        />
      </div>
      <Footer />
    </Container>
  )
}
