'use client'

/**
 * 收藏页「星标插件」分区（P1-6）。
 *
 * 问题：插件只有「星标」没有「收藏」，星标插件不在 /favorites（收藏模型
 * 只有 siteId），要去 /me/plugins 再跳一次 /marketplace?starred=1；两个
 * 词、两个地方，用户容易以为「星标丢了」。
 *
 * 最低成本做法（本批不改收藏模型）：收藏页常驻一个分区，直接列出已星标
 * 的插件（走 GET /api/plugins?starred=true，最多 6 条），并给显眼的
 * 「查看全部星标插件」入口（/marketplace?starred=1）与插件中心入口
 * （/me/plugins）。0 星标时不藏分区——空态本身就是解释「星标在哪」
 * 的地方，藏起来等于问题没修。
 *
 * 三态纪律（与插件市场同款，P1-2）：取数失败立 failed，不拿空兜底冒充
 * 「你还没有星标任何插件」；失败态带重试，重试与首载走同一条 load。
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, RefreshCw, Star } from 'lucide-react'
import { fetchPlugins, type HubPluginItem } from '@/lib/navhub-api'
import { pluginDetailHref } from '@/lib/plugins/detail-href'

/** 星标列表入口：插件市场只看已星标（与 /me/plugins 的星标卡同款地址） */
export const STARRED_PLUGINS_HREF = '/marketplace?starred=1'
/** 分区内最多列几条：只是找得到星标的入口，全量去市场页看 */
export const STARRED_PLUGINS_LIMIT = 6

export type StarredPluginsSnapshot =
  | { status: 'loading' }
  | { status: 'ready'; items: HubPluginItem[]; total: number }
  | { status: 'failed' }

/**
 * 取数状态转移（纯函数）：失败时不写降级兜底（items 空、total 0），改立
 * failed——否则一次瞬间故障会把「星标取不到」渲染成「你还没有星标」。
 */
export function applyStarredPluginsLoad(
  res: { items: HubPluginItem[]; total: number },
  failed: boolean,
): StarredPluginsSnapshot {
  if (failed) return { status: 'failed' }
  return { status: 'ready', items: res.items, total: res.total }
}

export function StarredPluginsSectionView({
  snapshot,
  onRetry,
}: {
  snapshot: StarredPluginsSnapshot
  onRetry: () => void
}) {
  return (
    <section
      aria-label="星标插件"
      data-testid="starred-plugins-section"
      className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 sm:p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Star className="h-4 w-4 text-amber-500" aria-hidden />
          星标插件
        </span>
        <span className="text-xs text-muted-foreground">
          插件的星标和网站的收藏是两套东西：星标的插件不在收藏列表里，在这里找。
        </span>
        <span className="ml-auto" />
        <a
          href={STARRED_PLUGINS_HREF}
          className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline underline-offset-2"
        >
          查看全部星标插件
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>

      {snapshot.status === 'loading' && (
        <p className="text-xs text-muted-foreground">正在加载星标插件…</p>
      )}

      {snapshot.status === 'failed' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-amber-700 dark:text-amber-400">
            星标插件暂时取不到，这不代表你没有星标插件。
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-background/60 px-2.5 py-1 font-medium hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重试
          </button>
          <a href={STARRED_PLUGINS_HREF} className="font-medium underline underline-offset-2">
            直接去星标列表看看
          </a>
        </div>
      )}

      {snapshot.status === 'ready' && snapshot.items.length === 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>还没有星标任何插件：在插件市场给插件点亮星标后，会出现在这里。</span>
          <a href="/marketplace" className="font-medium text-amber-700 dark:text-amber-400 hover:underline underline-offset-2">
            去插件市场看看
          </a>
          <a href="/me/plugins" className="font-medium hover:underline underline-offset-2">
            插件中心
          </a>
        </div>
      )}

      {snapshot.status === 'ready' && snapshot.items.length > 0 && (
        <>
          <ul className="space-y-1.5">
            {snapshot.items.map((plugin) => (
              <li key={plugin.slug}>
                <a
                  href={pluginDetailHref(plugin.slug, plugin.status)}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-2.5 py-2 text-xs hover:border-amber-500/40 hover:bg-amber-500/5"
                >
                  <Star className="h-3.5 w-3.5 shrink-0 fill-amber-500 text-amber-500" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{plugin.name}</span>
                  {plugin.description ? (
                    <span className="hidden min-w-0 flex-1 truncate text-muted-foreground sm:inline">
                      {plugin.description}
                    </span>
                  ) : null}
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    ★ {plugin.starCount}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            共 {snapshot.total} 个星标插件
            {snapshot.total > snapshot.items.length ? `，这里只列前 ${snapshot.items.length} 个` : ''}
            {' · '}
            <a href="/me/plugins" className="font-medium hover:underline underline-offset-2">
              插件中心
            </a>
          </p>
        </>
      )}
    </section>
  )
}

export function StarredPluginsSection() {
  const [snapshot, setSnapshot] = useState<StarredPluginsSnapshot>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  const load = useCallback(async () => {
    setSnapshot({ status: 'loading' })
    // fetchPlugins 失败时调 onDegraded 并返回空兜底：必须用 failed 旗标拦住，
    // 否则 .then 会把空兜底写成 ready，失败就冒充了「0 星标」（P1-2 同款坑）。
    let failed = false
    const res = await fetchPlugins(
      { starred: true, limit: STARRED_PLUGINS_LIMIT },
      () => {
        failed = true
      },
    ).catch(() => {
      failed = true
      return { items: [], total: 0 }
    })
    setSnapshot(applyStarredPluginsLoad(res, failed))
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadToken])

  return (
    <StarredPluginsSectionView
      snapshot={snapshot}
      onRetry={() => setReloadToken((n) => n + 1)}
    />
  )
}
