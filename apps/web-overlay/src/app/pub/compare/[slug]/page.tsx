import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ExternalLink, Link2, RefreshCw, Snowflake } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { EmptyState } from '@/components/ui/empty-state'
import { JsonLd } from '@/components/json-ld'
import { hubGetProbe } from '@/lib/server/hub'
import { safeDecodeParam } from '@/lib/server/route-params'
import { safeHref } from '@/lib/safe-url'
import { siteOrigin } from '@/lib/seo/origin'
import { compareShareWebPageLd } from '@/lib/seo/json-ld'
import { cn } from '@/lib/utils'
import {
  COMPARE_DIMENSIONS,
  COMPARE_DIMENSION_LABELS,
  normalizeComparisonItem,
  type ComparisonCell,
  type ComparisonItem,
  type CompareDimensionKey,
} from '@/lib/compare'
import { COMPARE_SHARE_FIELD_TTL_DAYS, compareShareCellDisplay } from '@/lib/compare-share-ttl'

/**
 * 分享的对照表公开页（/pub/compare/{slug}，服务端渲染 + 按需 ISR，
 * Batch 4 Phase 2 P2-4；P13 2026-11-26 改为语义化对照表 + 字段级 TTL 三态）。
 *
 * 只读冻结页：内容是发布那一刻从快照复制进 published_json 的副本，
 * 公开后原快照再变也不影响这里；页头明说冻结日期与“内容不再更新”。
 * 只渲染发布者勾选的白名单字段（share.fields）；note / migration
 * 永不可公开——服务端就不返回，页面也绝不渲染。
 * 公开页不挂“刷新验证”与“填写价格”按钮：冻结页是只读的，没有写入口。
 * 对照页一律不带佣金链、不打分、不排名。
 *
 * 呈现（P13）：
 * - 真 <table>：首列实体名（th scope="row"），其余列一个字段一格，
 *   原子单元格，不再用卡片 + <dl>（AI 爬虫不执行 JS，事实必须在服务端 HTML 里）；
 * - 字段级 TTL 三态（见 lib/compare-share-ttl.ts）：已核验 / 已过期 /
 *   未核实；过期字段灰显 + “截至 YYYY-MM-DD 核验，现待复核”，且退出 JSON-LD；
 * - 页顶固定方法论块：比较范围、核验日期、TTL 含义；
 * - WebPage JSON-LD：只取表格格子的可见文案（同一份 compareShareCellDisplay
 *   输出），逐字一致；dateModified = 快照冻结时间，只随实质更新改。
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

/**
 * 冻结格子：文案唯一来源是 compareShareCellDisplay（表格与 JSON-LD 共用），
 * 本组件只负责按三态着色，不再各算一份值/日期/状态。
 * - 已核验：正常显示；
 * - 已过期：灰显 + “截至 YYYY-MM-DD 核验，现待复核”；
 * - 未核实：值为空时显示“未验证”，有值也必须在副行标“未验证”，绝不写成已核实。
 */
function FrozenCellValue({
  cell,
  dimensionKey,
  nowMs,
}: {
  cell: ComparisonCell
  dimensionKey: CompareDimensionKey
  nowMs: number
}) {
  const display = compareShareCellDisplay(cell, dimensionKey, nowMs)
  const expired = display.state === 'expired'
  return (
    <div className={cn('min-w-0', expired && 'opacity-60')}>
      <div className="text-sm text-foreground break-words">{display.valueText}</div>
      <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{display.noteText}</div>
    </div>
  )
}

/** TTL 分档文案：数字取自 COMPARE_SHARE_FIELD_TTL_DAYS，不手写第二份数字。 */
function ttlMethodText(): string {
  const priceTtl = COMPARE_SHARE_FIELD_TTL_DAYS.price
  const platformTtl = COMPARE_SHARE_FIELD_TTL_DAYS.platform
  const maintenanceTtl = COMPARE_SHARE_FIELD_TTL_DAYS.maintenance
  return `价格与套餐 ${priceTtl} 天、功能清单 ${platformTtl} 天、上线状态 ${maintenanceTtl} 天`
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
  const frozenAtMs = ok ? probe.data.snapshot.createdAt : null
  const nowMs = Date.now()

  // JSON-LD 与可见表格同一份来源：每格先算 display，表格渲染它，
  // JSON-LD 只收其中 state === 'verified' 的格子（过期 / 未核实退出）。
  const ldItems = items.map((item) => ({
    name: item.title,
    url: item.url || null,
    fields: fields
      .filter((dim) => compareShareCellDisplay(item[dim.key], dim.key, nowMs).state === 'verified')
      .map((dim) => {
        const display = compareShareCellDisplay(item[dim.key], dim.key, nowMs)
        return {
          label: COMPARE_DIMENSION_LABELS[dim.key],
          valueText: display.valueText,
          noteText: display.noteText,
        }
      }),
  }))
  const ldDescription = ok ? `此对照表冻结于 ${frozen}，内容不再更新 · 共 ${items.length} 个站点` : ''
  const origin = await siteOrigin()

  return (
    <Container as="main" id="main-content">
      {ok && items.length > 0 && origin ? (
        <JsonLd
          data={compareShareWebPageLd(origin, {
            slug: safeSlug,
            title: '对照表分享',
            description: ldDescription,
            frozenAtMs,
            items: ldItems,
          })}
        />
      ) : null}
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
            <section aria-label="比较方法" className="rounded-xl border border-border/70 bg-card p-4 sm:p-5 space-y-2">
              <h2 className="text-sm font-semibold text-foreground">比较方法</h2>
              <ul className="list-disc pl-5 space-y-1 text-xs leading-relaxed text-muted-foreground">
                <li>
                  比较范围：本次对照只比较
                  {fields.length > 0
                    ? fields.map((dim) => COMPARE_DIMENSION_LABELS[dim.key]).join('、')
                    : '发布者勾选的字段'}
                  ；不比较官网域名、备注与迁移成本。
                </li>
                <li>核验日期：本表冻结于 {frozen}；每个格子的核实日期见格内标注，无核实日期的格子一律标“未验证”。</li>
                <li>
                  核验有效期（TTL）：{ttlMethodText()}
                  ；超出有效期的字段灰显并标注“截至 YYYY-MM-DD 核验，现待复核”，且不进入结构化数据。
                </li>
              </ul>
            </section>
            {items.length === 0 ? (
              <EmptyState
                icon={Link2}
                title="这里暂时没有可看的站点"
                description="这张分享里没有可展示的站点，等发布者重新分享后再来看看。"
              />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border/70">
                <table className="w-full border-collapse bg-card text-left">
                  <caption className="sr-only">
                    对照表分享：冻结于 {frozen} 的只读对照表，共 {items.length} 个站点
                  </caption>
                  <thead>
                    <tr className="border-b border-border/70">
                      <th scope="col" className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                        站点
                      </th>
                      {fields.map((dim) => (
                        <th key={dim.key} scope="col" className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                          {COMPARE_DIMENSION_LABELS[dim.key]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.siteId} className="border-b border-border/70 last:border-b-0 align-top">
                        <th scope="row" className="px-4 py-3 text-sm font-semibold text-foreground">
                          <a
                            href={safeHref(item.url)}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1.5 break-words"
                          >
                            <span className="break-words">{item.title}</span>
                            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          </a>
                        </th>
                        {fields.map((dim) => (
                          <td key={dim.key} className="px-4 py-3">
                            <FrozenCellValue cell={item[dim.key]} dimensionKey={dim.key} nowMs={nowMs} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      <Footer />
    </Container>
  )
}
