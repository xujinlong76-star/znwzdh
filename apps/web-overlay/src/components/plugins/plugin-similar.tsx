'use client'

/**
 * 相似插件（详情页发现回路）。
 *
 * 数据来自 GET /api/plugins/:slug/similar（语义向量近邻）。服务端把两种「没有数据」
 * 分开：未建索引 / 确实没有近邻 → items 空且 degraded:false，本组件静默隐藏，不占位；
 * 语义不可用或请求失败 → degraded:true，必须给出原因与重试入口。
 * 静默隐藏只适用于前者——把失败也藏起来会让发现回路无声消失（见 lib/degrade.ts）。
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchSimilarPlugins, type HubPluginItem } from '@/lib/navhub-api'
import { pluginKindLabel } from '@/lib/plugins/plugin-manifest'
import { Sparkles } from 'lucide-react'
import { SectionState } from '@/components/user-center/section-state'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'

type SimilarResult =
  | { phase: 'ready'; items: HubPluginItem[] }
  | { phase: 'degraded'; notice: DegradeNotice }

type SimilarState = SimilarResult | { phase: 'loading' }

export function PluginSimilar({ slug }: { slug: string }) {
  const [attempt, setAttempt] = useState(0)
  // key 让「已取回的结果」自带请求标识：重试时 key 变化即回到 loading，无需在 effect 里同步 setState
  const key = `${slug}#${attempt}`
  const [result, setResult] = useState<{ key: string; value: SimilarResult } | null>(null)

  useEffect(() => {
    let alive = true
    let failure: DegradeNotice | null = null
    const onDegraded = (error: unknown) => {
      if (!alive) return
      failure = describeDegrade(error, '相似插件服务')
      setResult({ key, value: { phase: 'degraded', notice: failure } })
    }
    void fetchSimilarPlugins(slug, 6, onDegraded).then((res) => {
      if (!alive) return
      if (res.degraded) {
        // 服务端 200 但语义索引不可用：degrade() 不会回调 onDegraded，这里补一条可重试提示
        setResult({
          key,
          value: {
            phase: 'degraded',
            notice: failure ?? {
              message: '语义索引暂不可用，未取回相似插件。',
              retryable: true,
            },
          },
        })
        return
      }
      setResult({ key, value: { phase: 'ready', items: res.items } })
    })
    return () => {
      alive = false
    }
  }, [slug, attempt, key])

  const state: SimilarState = result?.key === key ? result.value : { phase: 'loading' }

  // 加载中不占位：区块在详情页靠下，出现骨架反而会把页脚内容推下去（CLS）
  if (state.phase === 'loading') return null

  if (state.phase === 'degraded') {
    return (
      <div className="mt-10">
        <SectionState
          variant="error"
          title="相似插件暂时没有取到"
          description={state.notice.message}
          onRetry={state.notice.retryable ? () => setAttempt((n) => n + 1) : undefined}
          retryLabel="重新加载"
        />
      </div>
    )
  }

  if (state.items.length === 0) return null

  return (
    <section aria-labelledby="similar-plugins-heading" className="mt-10">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-4 h-4 text-muted-foreground" aria-hidden />
        <h2 id="similar-plugins-heading" className="text-base font-semibold text-foreground">
          相似插件
        </h2>
        <span className="text-xs text-muted-foreground">按语义相似度推荐</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {state.items.map((p) => (
          <Link
            key={p.slug}
            href={`/marketplace/${encodeURIComponent(p.slug)}`}
            className="group rounded-xl border border-border/70 bg-card/60 p-4 space-y-2 transition-colors hover:border-primary/40 hover:bg-card"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg leading-none" aria-hidden>
                {p.icon || '🧩'}
              </span>
              <span className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                {p.name}
              </span>
              <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded-md bg-muted/60 text-muted-foreground shrink-0">
                {pluginKindLabel(p.kind)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{p.description}</p>
            <div className="text-[11px] text-muted-foreground/80 font-mono">
              v{p.version} · 安装 {p.installCount} · 星标 {p.starCount}
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
