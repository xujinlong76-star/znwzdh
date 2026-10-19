'use client'

/**
 * 公开作者页：/marketplace/author/<ownerKey>
 *
 * ownerKey 是服务端对内部归属身份做的不可逆哈希（sha256 前 24 位），
 * 因此可以安全公开；页面只展示 published 插件与聚合计数，不暴露 identity。
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import {
  fetchAuthorPlugins,
  type HubPluginAuthorResponse,
  type HubPluginItem,
} from '@/lib/navhub-api'
import { getIdentity } from '@/lib/identity'
import { PluginCard } from '@/components/plugins/plugin-card'
import { ArrowLeft, Download, Loader2, Star, Store, UserRound } from 'lucide-react'

export default function PluginAuthorPage({
  params,
}: {
  params: Promise<{ key: string }>
}) {
  const { key } = use(params)
  const identity = useMemo(() => getIdentity(), [])
  const [data, setData] = useState<HubPluginAuthorResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<DegradeNotice | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setNotice(null)
    const res = await fetchAuthorPlugins(
      key,
      { limit: 100 },
      (error) => setNotice(describeDegrade(error, '作者页')),
    )
    setData(res)
    setLoading(false)
  }, [key])

  useEffect(() => {
    void load()
  }, [load, reloadToken])

  const patchItem = useCallback((updated: HubPluginItem) => {
    setData((prev) =>
      prev
        ? { ...prev, items: prev.items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)) }
        : prev,
    )
  }, [])

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
          <div className="py-20 text-center border border-dashed border-border/70 rounded-2xl space-y-3">
            <UserRound className="w-8 h-8 mx-auto text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">作者不存在，或暂时没有已上架插件</p>
            <Button asChild size="sm" variant="outline">
              <Link href="/marketplace">去市场逛逛</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-border/70 glass-surface subtle-mesh p-6 sm:p-7 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <UserRound className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight truncate">{data.author}</h1>
                    {data.authorKind && (
                      <Badge variant="outline" className="text-[10px]">
                        {data.authorKind === 'import' ? '导入作者' : '社区作者'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                    ownerKey: {data.ownerKey.slice(0, 12)}…
                  </p>
                </div>
              </div>
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
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <Footer />
    </Container>
  )
}
