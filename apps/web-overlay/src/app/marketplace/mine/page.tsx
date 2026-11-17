'use client'

/**
 * 作者中心：我的插件（全部状态）。
 *
 * 与公开市场列表的区别：
 *   - 身份来自本机 anonId，服务端按 owner_identity 精确匹配；
 *   - 返回 pending/rejected/delisted 记录，作者能看到审核备注与待审变更说明；
 *   - 只有 published 记录出现在公开作者页与市场列表。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { MarketplaceLoadError } from '@/components/marketplace-load-error'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { applyMarketplaceListLoad, type MarketplaceListSnapshot } from '@/lib/plugins/marketplace-load-state'
import { fetchMyPlugins, type HubMyPluginStats, type HubPluginItem } from '@/lib/navhub-api'
import { pluginDetailHref } from '@/lib/plugins/detail-href'
import { getIdentity } from '@/lib/identity'
import {
  ArrowLeft,
  GitFork,
  Download,
  Star,
  CheckCircle2,
  Clock3,
  Eye,
  Loader2,
  PencilLine,
  Plus,
  ShieldAlert,
  Sparkles,
  Store,
  XCircle,
} from 'lucide-react'
import dynamic from 'next/dynamic'

const AiPluginStudioModal = dynamic(
  () => import('@/components/plugins/ai-plugin-studio-modal').then((m) => m.AiPluginStudioModal),
  { ssr: false }
)

const STATUS_META: Record<
  string,
  { label: string; className: string; icon: typeof Clock3 }
> = {
  pending: { label: '待审核', className: 'text-amber-700 dark:text-amber-400 border-amber-500/30 bg-amber-500/5', icon: Clock3 },
  published: { label: '已上架', className: 'text-emerald-700 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5', icon: CheckCircle2 },
  rejected: { label: '已驳回', className: 'text-rose-700 dark:text-rose-400 border-rose-500/30 bg-rose-500/5', icon: XCircle },
  delisted: { label: '已下架', className: 'text-zinc-600 border-zinc-500/30 bg-zinc-500/5', icon: ShieldAlert },
  quarantined: { label: '安全隔离', className: 'text-destructive-text border-destructive/30 bg-destructive/5', icon: ShieldAlert },
}

export default function MyPluginsPage() {
  const identity = useMemo(() => getIdentity(), [])
  // 列表三态共用一份快照：取数失败时不写空兜底（见 applyMarketplaceListLoad），
  // 首屏失败改立 loadFailed，由失败态接管列表区；头部徽章与「共 N 个」也随
  // 之隐藏，不报假零（P1-2）。
  const [list, setList] = useState<MarketplaceListSnapshot<HubPluginItem>>({
    items: [],
    total: 0,
    loadFailed: false,
  })
  // 服务端全量聚合（/mine 的 stats）：取不到时（降级回落）才按当页 items 求和
  const [stats, setStats] = useState<HubMyPluginStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [notice, setNotice] = useState<DegradeNotice | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [studioPlugin, setStudioPlugin] = useState<HubPluginItem | null>(null)

  // A-4b：作者插件 >100 时列表不再截断在前 100 条。首屏 offset=0 替换，
  // 「加载更多」按已显示条数取下一页追加；与插件市场列表
  // （plugin-market-board.tsx）同款形态。追加页失败时 res 是降级兜底
  // （items 空、total 0），不能拿它覆盖现有状态：否则已加载的 100 条
  // 会被清空、按钮随之消失，后面的页再也到不了；total 追加时只涨不跌。
  // 计数优先用服务端全量聚合 stats（A-4 已接进本 load，见下 setStats），
  // 取不到 stats 时才按已加载 items 求和，随加载更多逐步收敛到全量。
  const load = useCallback(async (offset = 0, append = false) => {
    if (append) setLoadingMore(true)
    else {
      setLoading(true)
      setNotice(null)
    }
    let failed = false
    const res = await fetchMyPlugins(
      { identity, limit: 100, offset },
      (error) => {
        failed = true
        setNotice(describeDegrade(error, '作者中心'))
      },
    )
    // 两边合一（A-4b 追加失败保护 + A-4 服务端 stats）：追加失败时不覆盖已有
    // items/total/stats；追加成功时 stats 以服务端全量聚合为准（与分页无关）。
    // 首屏失败同理：不写空兜底，改立 loadFailed，由失败态接管列表区（P1-2）。
    setList((prev) =>
      applyMarketplaceListLoad(prev, res, {
        failed,
        append,
        silent: false,
        mergeAppendTotal: (prevTotal, nextTotal) => Math.max(prevTotal, nextTotal),
      }),
    )
    if (!failed) setStats(res.stats ?? null)
    if (append) setLoadingMore(false)
    else setLoading(false)
  }, [identity])

  useEffect(() => {
    void load()
  }, [load, reloadToken])

  const counts = useMemo(() => {
    const base = { pending: 0, published: 0, rejected: 0, other: 0 }
    for (const item of list.items) {
      if (item.status === 'pending') base.pending++
      else if (item.status === 'published') base.published++
      else if (item.status === 'rejected') base.rejected++
      else base.other++
    }
    // 服务端 stats 是全量聚合（不限前 100 个）；逐字段回落，当页求和只作降级兜底
    return {
      pending: stats?.pending ?? base.pending,
      published: stats?.published ?? base.published,
      rejected: stats?.rejected ?? base.rejected,
      other: stats?.other ?? base.other,
    }
  }, [list.items, stats])

  const metrics = useMemo(() => {
    let installs = 0
    let stars = 0
    let remixes = 0
    for (const item of list.items) {
      installs += item.installCount || 0
      stars += item.starCount || 0
      remixes += item.remixCount || 0
    }
    return {
      installs: stats?.installs ?? installs,
      stars: stats?.stars ?? stars,
      remixes: stats?.remixes ?? remixes,
    }
  }, [list.items, stats])

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
          <Button asChild size="sm" className="h-8 gap-1.5 text-xs">
            <Link href="/marketplace/publish">
              <Plus className="w-3.5 h-3.5" />
              发布新插件
            </Link>
          </Button>
        </div>

        <div className="rounded-2xl border border-border/70 glass-surface market-hero p-4 sm:p-7 space-y-3">
          <div className="flex items-center gap-2 text-xs text-primary font-medium">
            <Store className="w-3.5 h-3.5" />
            作者中心
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">我的插件</h1>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-2xl">
            这里可以看到你提交的全部插件与审核状态。待审/驳回的记录不会出现在公开市场；
            修改清单后需重新提交审核。
          </p>
          {/* 失败时不报假零：徽章与「共 N 个」整行隐藏，失败态在下方接管 */}
          {!list.loadFailed && (
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
              <Badge variant="outline" className="border-amber-500/30 text-amber-700 dark:text-amber-400">待审核 {counts.pending}</Badge>
              <Badge variant="outline" className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400">已上架 {counts.published}</Badge>
              <Badge variant="outline" className="border-rose-500/30 text-rose-700 dark:text-rose-400">已驳回 {counts.rejected}</Badge>
              {counts.other > 0 && <Badge variant="outline">其他 {counts.other}</Badge>}
              <span className="text-muted-foreground ml-auto">共 {list.total} 个</span>
            </div>
          )}
        </div>

        {/* 创作者生态漏斗与影响力大盘 (Creator Funnel) */}
        {list.items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-border/70 bg-card/60 p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Download className="w-3.5 h-3.5 text-emerald-500" />
                <span>总安装次数</span>
              </div>
              <div className="text-2xl font-bold font-mono text-foreground pt-0.5">{metrics.installs}</div>
              <p className="text-[10px] text-muted-foreground">累计生态被采纳量</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-card/60 p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Star className="w-3.5 h-3.5 text-amber-500" />
                <span>总星标收藏</span>
              </div>
              <div className="text-2xl font-bold font-mono text-foreground pt-0.5">{metrics.stars}</div>
              <p className="text-[10px] text-muted-foreground">社区认可度</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-card/60 p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <GitFork className="w-3.5 h-3.5 text-violet-500" />
                <span>衍生二创数</span>
              </div>
              <div className="text-2xl font-bold font-mono text-foreground pt-0.5">{metrics.remixes}</div>
              <p className="text-[10px] text-muted-foreground">二创繁荣度</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-card/60 p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span>上架成功率</span>
              </div>
              <div className="text-2xl font-bold font-mono text-foreground pt-0.5">
                {list.total > 0 ? `${Math.round((counts.published / list.total) * 100)}%` : '0%'}
              </div>
              <p className="text-[10px] text-muted-foreground">{counts.published} / {list.total} 审核通过</p>
            </div>
          </div>
        )}

        {notice && !list.loadFailed && (
          <HubDegradedNotice notice={notice} onRetry={() => setReloadToken((n) => n + 1)} subject="作者中心" />
        )}

        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-3" />
            正在加载我的插件…
          </div>
        ) : list.loadFailed ? (
          <MarketplaceLoadError title="我的插件加载失败" notice={notice} onRetry={() => setReloadToken((n) => n + 1)} />
        ) : list.items.length === 0 ? (
          <div className="py-14 text-center border border-dashed border-border/70 rounded-2xl space-y-3">
            <Store className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">你还没有提交过插件</p>
            <Button asChild size="sm" className="gap-1.5">
              <Link href="/marketplace/publish">
                <Plus className="w-3.5 h-3.5" />
                发布第一个插件
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {list.items.map((plugin) => {
              const meta = STATUS_META[plugin.status] ?? STATUS_META.pending
              const StatusIcon = meta.icon
              return (
                <div
                  key={plugin.id}
                  className="rounded-xl border border-border/70 bg-card/60 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={pluginDetailHref(plugin.slug, plugin.status)}
                        className="font-semibold text-sm hover:text-primary transition-colors"
                      >
                        {plugin.name}
                      </Link>
                      <Badge variant="outline" className={`text-[10px] ${meta.className}`}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {meta.label}
                      </Badge>
                      <span className="text-[11px] font-mono text-muted-foreground">v{plugin.version}</span>
                      {plugin.featured && (
                        <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-700 dark:text-amber-400">精选</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{plugin.description || '暂无描述'}</p>
                    {/* C-2：已上架插件挂着未审的新版投稿时，在作者中心行内可见（/api/plugins/mine 已是 ownerView） */}
                    {plugin.status === 'published' && plugin.pendingVersion && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400">
                        待审新版本 v{plugin.pendingVersion}，审核中
                      </p>
                    )}
                    {plugin.status === 'pending' && plugin.pendingChangelog && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400">
                        待审变更：{plugin.pendingChangelog}
                      </p>
                    )}
                    {plugin.reviewNote && (
                      <p className="text-[11px] text-muted-foreground">
                        审核备注：{plugin.reviewNote}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-0.5">
                      <span>{plugin.installCount} 次安装</span>
                      <span>{plugin.starCount} 星标</span>
                      {(plugin.reviewCount ?? 0) > 0 && (
                        <span>{plugin.ratingAvg?.toFixed(1)} 分 · {plugin.reviewCount} 评价</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
                    <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                      <Link href={pluginDetailHref(plugin.slug, plugin.status)}>
                        <Eye className="w-3.5 h-3.5" />
                        预览
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setStudioPlugin(plugin)}
                      className="h-8 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/5"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      AI 工坊升级
                    </Button>
                    <Button asChild size="sm" className="h-8 gap-1.5 text-xs">
                      <Link href={`/marketplace/publish?from=${encodeURIComponent(plugin.slug)}`}>
                        <PencilLine className="w-3.5 h-3.5" />
                        手动发版本
                      </Link>
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!list.loadFailed && list.items.length < list.total && (
          <div className="text-center">
            <Button
              variant="outline"
              disabled={loadingMore}
              onClick={() => void load(list.items.length, true)}
              className="gap-1.5"
            >
              {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
              加载更多（{list.items.length}/{list.total}）
            </Button>
          </div>
        )}
      </div>

      {studioPlugin && (
        <AiPluginStudioModal
          open={Boolean(studioPlugin)}
          onOpenChange={(open) => {
            if (!open) setStudioPlugin(null)
          }}
          initialManifest={studioPlugin.manifest}
          initialSlug={studioPlugin.slug}
          onPublished={() => {
            setStudioPlugin(null)
            void load()
          }}
        />
      )}

      <Footer />
    </Container>
  )
}
