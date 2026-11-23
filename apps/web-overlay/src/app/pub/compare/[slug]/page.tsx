import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ExternalLink, Link2, RefreshCw, Snowflake } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { EmptyState } from '@/components/ui/empty-state'
import { hubGetProbe } from '@/lib/server/hub'
import { safeDecodeParam } from '@/lib/server/route-params'
import { safeHref } from '@/lib/safe-url'
import { cn } from '@/lib/utils'
import {
  COMPARE_DIMENSIONS,
  COMPARE_DIMENSION_LABELS,
  formatCellValue,
  formatVerifiedDate,
  normalizeComparisonItem,
  type ComparisonCell,
  type ComparisonItem,
  type CompareDimensionKey,
} from '@/lib/compare'

/**
 * 分享的对照表公开页（/pub/compare/{slug}，服务端渲染 + 按需 ISR，
 * Batch 4 Phase 2 P2-4）。
 *
 * 只读冻结页：内容是发布那一刻从快照复制进 published_json 的副本，
 * 公开后原快照再变也不影响这里；页头明说冻结日期与“内容不再更新”。
 * 只渲染发布者勾选的白名单字段（share.fields）；note / migration
 * 永不可公开——服务端就不返回，页面也绝不渲染。
 * 公开页不挂“刷新验证”与“填写价格”按钮：冻结页是只读的，没有写入口。
 *
 * 格子渲染复用 lib/compare.ts 的值+来源+日期口径（formatCellValue /
 * formatVerifiedDate，与 compare-view.tsx 的 CellValue 同样式）：
 * CellValue 本身是 compare-view.tsx 的模块私有函数，本项不改该文件，
 * 故此处按同一规则重绘（值 + 可能过期徽标 + 来源·核实于/更新于·未验证）。
 *
 * 404 纪律与 /pub 一致：只有中枢明确回 404（不存在或已下线）才
 * notFound()；中枢不可达是降级渲染（通用元数据 + 说明壳），不把抖动
 * 误伤成 404。revalidate=60 与中枢公开读接口的 maxAge 对齐。
 * 没有 loading.tsx：与 /pub 同一条软 404 回归锁——骨架屏边界会先流式
 * 刷 200，generateMetadata 里的 notFound() 就改不了状态码（豁免见
 * test/route-state-coverage.test.ts 里 pub/compare/[slug] 的条目）。
 */

export const revalidate = 60

/** 动态段要进入按需 ISR，必须存在 generateStaticParams；空数组 = 全部运行时生成 */
export async function generateStaticParams() {
  return []
}

interface CompareShareDetail {
  ok: boolean
  share: { slug: string; fields: string[]; createdAt: number }
  snapshot: { id: string; siteIds: string[]; items: unknown[]; createdAt: number }
}

function shareCanonical(slug: string): string {
  return `/pub/compare/${encodeURIComponent(slug)}`
}

async function loadCompareShare(slug: string) {
  return hubGetProbe<CompareShareDetail>('/api/compare/shares/' + encodeURIComponent(slug), 60)
}

function formatFrozenDate(createdAt: number): string {
  if (!createdAt || !Number.isFinite(createdAt)) return '未知日期'
  return new Date(createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const safeSlug = safeDecodeParam(slug)
  if (!safeSlug) notFound()
  const probe = await loadCompareShare(safeSlug)
  // 404 判定放 metadata 管线：layout/page 渲染体里抛 notFound() 会被
  // error 边界捕获成客户端回退（实测 200 + NEXT_HTTP_ERROR_FALLBACK）
  if (probe.status === 'miss') notFound()
  const canonical = shareCanonical(safeSlug)
  if (probe.status === 'failed') {
    return {
      title: '对照表分享',
      description: '别人分享的对照表：冻结在某一天的只读对照，内容不再更新。',
      alternates: { canonical },
    }
  }
  const count = probe.data.snapshot.items.length
  const frozen = formatFrozenDate(probe.data.snapshot.createdAt)
  return {
    title: '对照表分享',
    description: `冻结于 ${frozen} 的对照表，共 ${count} 个站点，只读，不再更新。`,
    alternates: { canonical },
  }
}

/** 冻结格子：与 CellValue 同规则——值 + 可能过期徽标 + 来源·日期·未验证。 */
function FrozenCellValue({ cell, dimensionKey }: { cell: ComparisonCell; dimensionKey: CompareDimensionKey }) {
  const verified = cell.verified && formatCellValue(cell) !== '未验证'
  const date = formatVerifiedDate(cell.verifiedAt)
  const dateLabel = dimensionKey === 'maintenance' || dimensionKey === 'price' ? '核实于' : '更新于'
  const isPrice = dimensionKey === 'price'
  const hasValue = formatCellValue(cell) !== '未验证'
  const expired = isPrice && !cell.verified && hasValue
  return (
    <div className={cn('min-w-0', expired && 'opacity-60')}>
      <div className="text-sm text-foreground break-words">
        {formatCellValue(cell)}
        {isPrice && cell.stale === true && (
          <span className="ml-1.5 px-1.5 py-px rounded text-[10px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30">
            可能过期
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
        {cell.source ? `来源：${cell.source}` : '来源未标注'}
        {date ? ` · ${dateLabel} ${date}` : ''}
        {verified ? '' : ' · 未验证'}
      </div>
    </div>
  )
}

export default async function CompareSharePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const safeSlug = safeDecodeParam(slug)
  if (!safeSlug) notFound()
  const probe = await loadCompareShare(safeSlug)
  if (probe.status === 'miss') notFound()

  const ok = probe.status === 'ok'
  const canonical = shareCanonical(safeSlug)
  const items: ComparisonItem[] = ok
    ? probe.data.snapshot.items
        .map((item) => normalizeComparisonItem(item))
        .filter((item): item is ComparisonItem => item !== null)
    : []
  // 只渲染发布者勾选的字段，按 COMPARE_DIMENSIONS 的行顺序排列；
  // 服务端只返回了白名单字段，未勾选的键在响应体里根本不存在。
  const fields = ok
    ? COMPARE_DIMENSIONS.filter((d) => probe.data.share.fields.includes(d.key))
    : []
  const frozen = ok ? formatFrozenDate(probe.data.snapshot.createdAt) : ''

  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-5 sm:space-y-6">
        <Breadcrumbs
          jsonLd={ok}
          items={[
            { label: '首页', path: '/' },
            { label: '对照表分享', path: canonical },
            { label: '冻结对照表', path: canonical },
          ]}
        />
        {!ok ? (
          <EmptyState
            icon={RefreshCw}
            title="对照表暂时打不开"
            description="中枢暂时不可达，页面内容没能加载出来。请稍后刷新重试——这不是该分享被下线了。"
          />
        ) : (
          <>
            <header className="space-y-2">
              <h1 className="text-2xl font-bold">对照表分享</h1>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Snowflake className="size-3.5" aria-hidden />
                此对照表冻结于 {frozen}，内容不再更新 · 共 {items.length} 个站点
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                只读页：格子里的值与来源日期都是冻结那一刻的样子，没有任何写入口；
                发布者只公开了勾选的字段，备注与迁移成本永不公开。
              </p>
            </header>
            {items.length === 0 ? (
              <EmptyState
                icon={Link2}
                title="这里暂时没有可看的站点"
                description="这张分享里没有可展示的站点，等发布者重新分享后再来看看。"
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => (
                  <article key={item.siteId} className="rounded-xl border border-border/70 bg-card p-5 space-y-3">
                    <h2 className="text-base font-semibold text-foreground">
                      <a
                        href={safeHref(item.url)}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1.5 break-words"
                      >
                        <span className="break-words">{item.title}</span>
                        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      </a>
                    </h2>
                    <dl className="space-y-3">
                      {fields.map((dim) => (
                        <div key={dim.key} className="space-y-1">
                          <dt className="text-xs font-medium text-muted-foreground">
                            {COMPARE_DIMENSION_LABELS[dim.key]}
                          </dt>
                          <dd>
                            <FrozenCellValue cell={item[dim.key]} dimensionKey={dim.key} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </article>
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
