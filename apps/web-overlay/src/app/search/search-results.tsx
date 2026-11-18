import Link from 'next/link'
import { AlertTriangle, ArrowRight, ExternalLink, Search, Sparkles, MonitorPlay, Globe, Store } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { SiteFavicon } from '@/components/site-favicon'
import { isSafeHttpUrl, safeHref } from '@/lib/safe-url'
import {
  SEARCH_QUERY_MAX_LENGTH,
  inferredConditionLabels,
  relaxedPricingNotice,
  searchHref,
  searchMaxPage,
  searchPageWindow,
} from '@/lib/search-page'
import type { HubPluginSearchResponse, HubSearchHit, HubSearchResult, HubSite } from '@/lib/navhub-api'
import { pluginDetailHref } from '@/lib/plugins/detail-href'
import { Fragment } from 'react'
import { highlightParts } from '@/lib/highlight'
import { SearchFacetBar, type FacetGroup } from '@/components/search-facet-bar'
import { ZeroResultActions } from '@/components/search/zero-result-actions'
import { AlgorithmHudBadge } from '@/components/algorithm-hud-badge'
import { WantedActions } from '@/components/search/wanted-actions'

/**
 * /search 的视图（纯服务端组件）。
 *
 * 输入框用原生 GET form，不引入客户端状态：搜索页本身就是「URL 即状态」，
 * 无 JS 也能用，且不会把又一个搜索面板打进首屏包。
 */

interface SearchResultsProps {
  q: string
  page: number
  tag: string | null
  /** 分类作用域（slug 或 id）：分类页「全局搜索本分类」入口透传 */
  category?: string | null
  /** 分类中文展示名（page.tsx 用类目表解析；取不到时退回 slug，见下） */
  categoryName?: string | null
  /** 已生效的正交分面筛选 */
  facets?: Record<string, string[]>
  /** 分面分布（中枢 /api/facets）；null = 取数失败或未启用，整块不渲染 */
  facetGroups?: FacetGroup[] | null
  result: HubSearchResult | null
  failed: boolean
  unavailable: HubSearchHit[]
  /** 与查询词匹配的插件（GET /api/plugins/search，前 5 条）；null = 未取 / 取数失败，分区不渲染 */
  plugins?: HubPluginSearchResponse | null
  /** 零结果救援的「今日热榜」：今日热榜前 6（/search 页取数，失败为空数组） */
  recommended?: HubSite[]
  /** 收录站点外链 rel（站点级设置，服务端透传）；缺省 nofollow */
  externalRel?: string
}

/** 只展示「为什么这条会被搜到」里不直观的通道；exact/fts 是用户预期内的 */
const CHANNEL_LABELS: Record<string, string> = {
  pinyin: '拼音',
  semantic: '语义',
  personal: '个性化',
}

function siteHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** 字面命中高亮：复用客户端同款 highlightParts（多词 / 正则转义 / 代理对安全） */
function Highlight({ text, query }: { text: string; query: string }) {
  const segments = highlightParts(text, query)
  if (segments.length === 1 && !segments[0].hit) return <>{text}</>
  return (
    <>
      {segments.map((seg, i) =>
        seg.hit ? (
          <mark key={i} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
            {seg.text}
          </mark>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  )
}

function FailedNotice({ q, page, tag, category, facets }: { q: string; page: number; tag: string | null; category?: string | null; facets?: Record<string, string[]> }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span>检索服务本次没有响应（不是「没有收录这个站点」）。稍后重试，或先按分类 / 标签浏览。</span>
      <Link
        href={searchHref({ q, page, tag, category, facets })}
        className="font-medium underline underline-offset-2 hover:no-underline"
      >
        重试
      </Link>
    </div>
  )
}

function RelationBand({
  relations,
  externalRel = 'nofollow noopener noreferrer',
}: {
  relations: NonNullable<HubSearchResult['relationHits']>
  externalRel?: string
}) {
  return (
    <section
      aria-label="相关替代与对标方案"
      className="space-y-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3"
    >
      <h2 className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        相关替代与对标
      </h2>
      <ul className="space-y-1.5">
        {relations.map((rel) => {
          const site = rel.sourceSite
          if (!site) return null
          return (
            <li
              key={rel.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/60 bg-card/80 px-2.5 py-2"
            >
              <Link
                href={`/site/${encodeURIComponent(site.id)}`}
                className="text-sm font-medium text-foreground hover:text-primary hover:underline"
              >
                {site.title}
              </Link>
              <span className="text-[11px] text-muted-foreground">对标 {rel.targetTitle}</span>
              {rel.isFreeOrOpenSource ? (
                <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                  开源/免费
                </span>
              ) : null}
              {rel.note ? (
                <span className="text-[11px] text-muted-foreground">· {rel.note}</span>
              ) : null}
              {isSafeHttpUrl(site.url) ? (
                <a
                  href={safeHref(site.url)}
                  target="_blank"
                  rel={externalRel}
                  className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  直达
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function ResultRow({
  hit,
  q,
  externalRel = 'nofollow noopener noreferrer',
}: {
  hit: HubSearchHit
  q: string
  externalRel?: string
}) {
  const site = hit.site
  if (!site) return null

  const host = siteHost(site.url)
  const linkable = isSafeHttpUrl(site.url)
  const channels = Object.keys(hit.contributions ?? {}).filter((channel) => CHANNEL_LABELS[channel])

  return (
    <li className="rounded-xl border border-border/70 bg-card/60 p-3 transition-colors hover:border-border hover:bg-muted/30">
      <div className="flex items-start gap-3">
        <SiteFavicon
          title={site.title}
          url={site.url}
          icon={site.iconKey ?? undefined}
          className="h-9 w-9 shrink-0 rounded-lg border border-border/50 bg-muted/40 object-contain p-1"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {/* P3-13：主次倒置修正——标题是站内详情（最显眼的主操作），
                站外直达降为次级链接。原来标题本身是外链、详情反是 26px 小按钮。 */}
            <Link
              href={`/site/${encodeURIComponent(site.id)}`}
              className="max-w-full truncate text-sm font-semibold text-foreground hover:text-primary hover:underline"
            >
              <Highlight text={site.title} query={q} />
            </Link>
            {host ? <span className="text-[11px] text-muted-foreground">{host}</span> : null}
            {site.status === 'broken' ? (
              <span
                title="最近一次健康巡检被对方站点拒绝（常见 401/403 反爬），不代表站点已下线"
                className="rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
              >
                巡检打不开
              </span>
            ) : null}
          </div>
          {site.description ? (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              <Highlight text={site.description} query={q} />
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            {site.tags?.slice(0, 4).map((tag) => (
              // 标签即筛选：点一下看该标签下的全部站点。不保留当前关键词——
              // 「按这个标签浏览」比「在本次查询里再收窄」更符合点击标签的预期。
              <Link
                key={tag}
                href={searchHref({ tag })}
                className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/20"
              >
                {tag}
              </Link>
            ))}
            {channels.map((channel) => (
              <span key={channel} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {CHANNEL_LABELS[channel]}命中
              </span>
            ))}
            <AlgorithmHudBadge contributions={hit.contributions} />
          </div>
        </div>
        {linkable ? (
          <a
            href={safeHref(site.url)}
            target="_blank"
            rel={externalRel}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border/70 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            直达
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : null}
      </div>
    </li>
  )
}

function EmptyResults({
  q,
  page,
  tag,
  category = null,
  categoryName: categoryNameProp = null,
  facets = {},
  suggestions,
  popular,
  inferredCategory,
  recommended,
  externalRel = 'nofollow noopener noreferrer',
  correction = null,
  hideGenericRecommendations = false,
  hasPlugins = false,
}: {
  q: string
  page: number
  tag: string | null
  /** 当前分类（U-143）：「回到第 1 页」保留它，翻页不丢筛选 */
  category?: string | null
  /** 分类中文展示名（SearchResults 透传；取不到时退回 slug） */
  categoryName?: string | null
  /** 当前分面筛选（U-143）：同上 */
  facets?: Record<string, string[]>
  suggestions: string[]
  popular: string[]
  /** 中枢从查询里理解到的分类（如 @开发工具 / “开发工具”一词）；没有推断出来时不硬凑 */
  inferredCategory?: string | null
  /** 零结果救援的「今日热榜」：今日热榜站点；取数失败为空数组，整块不渲染 */
  recommended: HubSite[]
  externalRel?: string
  /** 自动纠正（有值时两出口的「新建收藏」优先用纠正后的词做标题） */
  correction?: { original: string; corrected: string } | null
  /**
   * 纠正后仍零结果：隐藏「换个词试试 / 大家在搜 / 今日热榜」三块泛推荐，
   * 只留 AI 找站 / 投稿收录 / 存为待找 / 新建收藏四个明确出口（协调人决定 1）。
   */
  hideGenericRecommendations?: boolean
  /**
   * A3（方案 b）：插件命中时空态仍渲染，但标题必须限定为站点——页面
   * 上方已有插件分区，再写无限定的「站内暂时没有收录」会自相矛盾，
   * 且与状态行「站点暂无匹配；插件市场有 N 个相关结果。」口径一致。
   */
  hasPlugins?: boolean
}) {
  // 分类中文名：取不到时退回 slug（与 SearchResults 同口径）。
  const categoryName = categoryNameProp ?? category ?? ''
  return (
    <section className="space-y-4 rounded-2xl border border-dashed border-border/70 bg-card/40 p-6">
      {/* U-28：零结果标题必须定性——三种情况的下一步完全不同，不能只说
          「没有找到」：A 成功 0 命中 = 站内未收录（投稿/待找/AI 找站）；
          B 纠正后仍 0 命中 = 已换词还是没有；C 取数失败不在这里——
          failed 时本组件根本不渲染，改由 FailedNotice 明示「服务没响应」。 */}
      <p className="text-sm font-medium text-foreground">
        {page > 1
          ? `第 ${page} 页没有更多结果。`
          : hasPlugins
            ? tag
              ? q
                ? `站点暂无与“${q}”匹配、且带标签「${tag}」的收录。`
                : `标签「${tag}」下站点暂无收录。`
              : category
                ? q
                  ? `站点暂无与“${q}”匹配、且在分类「${categoryName}」下的收录。`
                  : `分类「${categoryName}」下站点暂无收录。`
                : correction
                  ? `换了“${correction.corrected}”还是没有——站点暂无匹配的收录。`
                  : q
                    ? `站点暂无与“${q}”匹配的收录。`
                    : `站点暂无匹配的收录。`
            : tag
              ? q
                ? `站内暂时没有收录与“${q}”匹配、且带标签「${tag}」的站点。`
                : `标签「${tag}」下暂时没有站点。`
              : category
                ? q
                  ? `站内暂时没有收录与“${q}”匹配、且在分类「${categoryName}」下的站点。`
                  : `分类「${categoryName}」下暂时没有站点。`
                : correction
                  ? `换了“${correction.corrected}”还是没有——站内暂时没有收录匹配的站点。`
                  : Object.keys(facets).length > 0
                    ? `按当前分面筛选暂时没有站点。`
                    : `站内暂时没有收录与“${q}”匹配的站点。`}
      </p>
      {/* U-187：翻页越界（page > 1）时首要恢复动作放最前——空态标题正下方，
          不用翻过 AI 找站 / 待找收藏 / 相关分类四组出口；第 1 页零结果顺序不变。 */}
      {page > 1 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href={searchHref({ q, tag, category, facets })} className="text-xs text-primary hover:underline">
            回到第 1 页
          </Link>
        </div>
      ) : null}
      {/* A11：零结果不是死胡同——两个真出口放最前（AI 找站带词自动问、
          投稿收录带词预填），再往下才是换词/热门词/全网穿透这些次要出口 */}
      {q ? <ZeroResultActions query={q} /> : null}
      {/* 容错纠错两出口：存为待找 / 新建收藏（客户端岛） */}
      {q ? <WantedActions query={q} correctedQuery={correction?.corrected ?? null} /> : null}
      {/* 相关分类：中枢从查询里理解到的分类（@算子或分类词）才给——没有推断
          出来不硬凑分类；点进去是该分类的全部站点（不带原查询词，带原词
          会把用户送回同一个零结果）。 */}
      {inferredCategory ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">相关分类</p>
          <div className="flex flex-wrap gap-1.5">
            <Link
              href={searchHref({ category: inferredCategory })}
              className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary transition-colors hover:bg-primary/20"
            >
              浏览「{inferredCategory}」分类的全部站点
            </Link>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {tag ? (
          <Link href={searchHref({ q })} className="text-xs text-primary hover:underline">
            去掉标签筛选
          </Link>
        ) : null}
      </div>
      {q && !tag && !hideGenericRecommendations && suggestions.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">换个词试试</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((item) => (
              <Link
                key={item}
                href={searchHref({ q: item })}
                className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary transition-colors hover:bg-primary/20"
              >
                {item}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      {!hideGenericRecommendations && popular.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">大家在搜</p>
          <div className="flex flex-wrap gap-1.5">
            {popular.map((item) => (
              <Link
                key={item}
                href={searchHref({ q: item })}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
              >
                {item}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      {/* 今日热榜（research #2）：零结果页不能只剩「没有」——热榜站点是现成
          的兜底内容，复用正常结果行的 ResultRow（命中即 HubSearchHit，
          contributions 为空，不标任何通道）。取数失败时 recommended 为空，
          整块不渲染，不谎称「没有推荐」。标题只说「今日热榜」，不写
          「为你推荐」——这份榜单与查询词无关，不能冒充个性化推荐。 */}
      {!hideGenericRecommendations && recommended.length > 0 ? (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1 font-medium">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            今日热榜站点
          </p>
          <ul className="space-y-2">
            {recommended.map((site) => (
              <ResultRow
                key={site.id}
                hit={{ siteId: site.id, score: 0, contributions: {}, site }}
                q={q}
                externalRel={externalRel}
              />
            ))}
          </ul>
          <Link href="/hot" className="inline-block text-xs text-primary hover:underline">
            查看完整热榜 →
          </Link>
        </div>
      ) : null}
      {q ? (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1 font-medium">
            <Globe className="h-3.5 w-3.5 text-primary" />
            全网穿透搜索：直接去外部开发者引擎查找 “{q}”
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { name: 'Google 开发者搜索', url: `https://www.google.com/search?q=${encodeURIComponent(q)}`, color: 'hover:border-blue-500/50 hover:bg-blue-500/10' },
              { name: 'GitHub 仓库代码', url: `https://github.com/search?q=${encodeURIComponent(q)}&type=repositories`, color: 'hover:border-purple-500/50 hover:bg-purple-500/10' },
              { name: 'Devv 开发者专搜', url: `https://devv.ai/search?q=${encodeURIComponent(q)}`, color: 'hover:border-emerald-500/50 hover:bg-emerald-500/10' },
              { name: 'Bilibili 技术视频', url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(q)}`, color: 'hover:border-sky-500/50 hover:bg-sky-500/10' },
            ].map((engine) => (
              <a
                key={engine.name}
                href={safeHref(engine.url)}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={`inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs border border-border bg-card text-foreground transition-all shadow-2xs ${engine.color}`}
              >
                <span>{engine.name}</span>
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            ))}
          </div>
        </div>
      ) : null}
      <nav aria-label="浏览入口" className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border/60 pt-3 text-xs">
        <Link className="text-primary hover:underline" href="/category">
          按分类浏览
        </Link>
        <Link className="text-primary hover:underline" href="/tags">
          按标签浏览
        </Link>
        <Link className="text-primary hover:underline" href="/sites">
          全部站点目录
        </Link>
        {q ? (
          <Link
            className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 hover:underline font-medium"
            href={`/videos?q=${encodeURIComponent(q)}`}
          >
            <MonitorPlay className="w-3.5 h-3.5" />
            <span>在视频库中搜索 “{q}”</span>
          </Link>
        ) : null}
        {/* P1-3：零结果页的插件出口——不依赖插件取数成败，始终可点去市场搜 */}
        {q ? (
          <Link
            className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
            href={`/marketplace?q=${encodeURIComponent(q)}`}
          >
            <Store className="w-3.5 h-3.5" />
            <span>在插件市场中搜索 “{q}”</span>
          </Link>
        ) : null}
      </nav>
    </section>
  )
}

/**
 * 字面匹配但最近巡检打不开的站点。
 *
 * 与正常结果分区展示而不是混排：巡检失败（401/403 反爬）不代表站点真的
 * 下线，混进正常结果会让用户以为它们"匹配度低"；整段藏起来又会造成
 * 「大站搜不到」。名字照常可点，说明如实给出。
 */
function UnavailableSection({ hits, q }: { hits: HubSearchHit[]; q: string }) {
  const externalRel = 'nofollow noopener noreferrer'
  return (
    <section aria-label="最近巡检打不开的匹配站点" className="space-y-2">
      <div
        role="status"
        className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          以下 {hits.length} 个站点与你的查询字面匹配，但最近一次健康巡检被对方站点拒绝（常见 401/403
          反爬）。这不代表站点已下线，点击通常仍可正常打开；巡检恢复后会自动回到正常结果。
        </span>
      </div>
      <ul className="space-y-2">
        {hits.map((hit) => (hit.site ? <ResultRow key={hit.siteId} hit={hit} q={q} externalRel={externalRel} /> : null))}
      </ul>
    </section>
  )
}

/** 插件类型文案与插件市场列表页同一套（plugin-market-board.tsx 的 KIND_LABELS） */
const PLUGIN_KIND_LABELS: Record<string, string> = {
  'site-pack': '网站包',
  'workspace-preset': '工作台预设',
  theme: '主题',
  'search-pack': '搜索引擎包',
  bundle: '组合包',
}

/**
 * P1-3：/search 的「插件市场」分区。
 *
 * 搜索浮层用同一接口（GET /api/plugins/search）能搜到插件，结果页却只取
 * 站点——同一查询前后不一致。分区只展示前 5 条，更多走 /marketplace?q=…；
 * 详情链接经 pluginDetailHref（非 published 记录走 /preview，不直接 404）。
 * items 为空时返回 null：插件取数失败（plugins=null）与零命中都不留空分区。
 */
export function PluginSection({ plugins, q }: { plugins: HubPluginSearchResponse; q: string }) {
  const items = plugins.items ?? []
  if (items.length === 0) return null
  return (
    <section aria-label="插件市场" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Store className="h-4 w-4 text-primary" aria-hidden />
          插件市场
          {plugins.total > items.length ? (
            <span className="text-xs font-normal text-muted-foreground">共 {plugins.total} 个</span>
          ) : null}
          {plugins.degraded ? (
            <span className="text-[11px] font-normal text-muted-foreground">语义检索未就绪 · 关键词匹配</span>
          ) : null}
        </h2>
        <Link
          href={`/marketplace?q=${encodeURIComponent(q)}`}
          className="text-xs text-primary hover:underline"
        >
          查看全部插件结果 →
        </Link>
      </div>
      <ul className="space-y-2">
        {items.map((plugin) => (
          <li
            key={plugin.id}
            className="rounded-xl border border-border/70 bg-card/60 p-3 transition-colors hover:border-border hover:bg-muted/30"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <Link
                href={pluginDetailHref(plugin.slug, plugin.status)}
                className="max-w-full truncate text-sm font-semibold text-foreground hover:text-primary hover:underline"
              >
                <Highlight text={plugin.name} query={q} />
              </Link>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                {PLUGIN_KIND_LABELS[plugin.kind] ?? plugin.kind}
              </span>
              {plugin.version ? (
                <span className="text-[11px] text-muted-foreground">v{plugin.version}</span>
              ) : null}
            </div>
            {plugin.description ? (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                <Highlight text={plugin.description} query={q} />
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Pagination({
  q,
  page,
  tag,
  category,
  facets,
  hasMore,
}: {
  q: string
  page: number
  tag: string | null
  category?: string | null
  facets?: Record<string, string[]>
  hasMore: boolean
}) {
  const pages = searchPageWindow(page, hasMore)
  const linkClass = 'px-3 py-1.5 text-xs rounded-md border border-border/70 hover:bg-muted/50'
  return (
    <nav aria-label="搜索结果分页" className="flex flex-wrap items-center gap-2 pt-2">
      {page > 1 ? (
        <Link href={searchHref({ q, page: page - 1, tag, category, facets })} className={linkClass}>
          上一页
        </Link>
      ) : null}
      {pages.map((n) => (
        <Link
          key={n}
          href={searchHref({ q, page: n, tag, category, facets })}
          aria-current={n === page ? 'page' : undefined}
          className={
            n === page
              ? 'px-3 py-1.5 text-xs rounded-md border border-primary bg-primary/10 font-semibold text-primary'
              : linkClass
          }
        >
          {n}
        </Link>
      ))}
      {hasMore && page < searchMaxPage() ? (
        <Link href={searchHref({ q, page: page + 1, tag, category, facets })} className={linkClass}>
          下一页
        </Link>
      ) : null}
    </nav>
  )
}

function SearchRelatedTags({
  tags,
  currentTag,
  q,
}: {
  tags: Array<{ name: string; slug: string; count: number }>
  currentTag: string | null
  q: string
}) {
  const displayTags = tags.filter((t) => t.slug !== currentTag?.toLowerCase())
  if (displayTags.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1 pb-1">
      <span className="text-xs text-muted-foreground font-medium mr-1 flex items-center gap-1">
        相关主题:
      </span>
      {displayTags.map((t) => (
        <Link
          key={t.slug}
          href={searchHref({ q: q || undefined, tag: t.slug })}
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs bg-muted/60 hover:bg-primary/10 hover:text-primary border border-border/60 transition-colors text-muted-foreground"
          title={`${t.count} 个命中站点包含此标签`}
        >
          <span>#{t.name}</span>
          <span className="text-[10px] opacity-70">({t.count})</span>
        </Link>
      ))}
    </div>
  )
}

export function SearchResults({
  q,
  page,
  tag,
  category = null,
  categoryName: categoryNameProp = null,
  facets = {},
  facetGroups = null,
  result,
  failed,
  unavailable,
  plugins = null,
  recommended = [],
  externalRel = 'nofollow noopener noreferrer',
}: SearchResultsProps) {
  const hits = result?.hits ?? []
  // 分类中文名：page.tsx 已用类目表解析；未解析/取数失败时退回 slug 原样
  //（站内已有「显示原始标识」的容忍口径，见 :332 相关分类链接）。
  const categoryName = categoryNameProp ?? category ?? ''
  const hasMore = result?.hasMore === true
  const relations = (result?.relationHits ?? []).filter((rel) => rel.sourceSite).slice(0, 3)
  const relatedTags = result?.relatedTags ?? []
  const suggestions = result?.suggestions ?? []
  const popular = result?.popular ?? []
  const didYouMean = result?.didYouMean
  const correction = result?.correction ?? null
  // 纠正后仍零结果：只给两个明确出口（存为待找 / 新建收藏），不再叠
  // 「换个词试试 / 大家在搜 / 今日热榜」这类泛推荐（协调人决定 1）。
  // 未纠正的零结果态保持现有 P0 兜底不变。
  const correctedZero = Boolean(correction) && hits.length === 0
  // A3（方案 b）：站点零命中但插件命中时，EmptyResults 仍渲染——
  // 插件命中可能是弱匹配，用户要找的站点仍未收录，不能丢掉页内唯一的
  // 升级路径（AI 找站 / 投稿收录 / 存为待找 / 新建收藏四个出口都挂在
  // EmptyResults 内，抑制它会比协调人划定的最精简态还少）。只把空态
  // 标题限定为站点（见 EmptyResults 的 hasPlugins 分支），状态行亦
  // 已改写为「站点暂无匹配；插件市场有 N 个相关结果。」；PluginSection
  // 保持在 EmptyResults 之前，视觉优先。
  const hasPlugins = (plugins?.items.length ?? 0) > 0
  const excluded = result?.excludedTerms ?? []
  const semanticsOff = result !== null && result.semanticAvailable === false
  // 语义 KNN 对任何输入都会返回最近邻，乱码查询也会"有结果"。
  // 整页没有一条关键词命中时如实说明，别让用户以为这些就是匹配项。
  // 通道必须非空：标签筛选 / 兜底路径返回的 contributions 是 {}，空对象的
  // every() 恒为 true，会把「按标签列出」误标成「全是语义近似」。
  const semanticOnly =
    hits.length > 0 &&
    hits.every((hit) => {
      const channels = Object.keys(hit.contributions ?? {})
      return channels.length > 0 && channels.every((channel) => channel === 'semantic')
    })
  // 中枢在「带筛选却零命中」时会自动放宽筛选重试并标记 fallback=filter。
  // 此时结果已不满足筛选条件（显式 tag 或查询里的 #/@ 算子），不能再把它们
  // 说成「在标签 X 下」——那是错误归因。
  const inferred = result ? inferredConditionLabels(result) : []
  const filterRelaxed = result?.fallback === 'filter'
  const tagApplied = tag !== null && !filterRelaxed
  const fuzzy = result?.fallback === 'fuzzy'
  // U-184：resultLabel 必须覆盖全部四类筛选态（q/tag/category/facets）——
  // 空态门（:839）开门后纯分类/纯分面态进入结果分支，若这里仍为空串，
  // 状态行模板 `${resultLabel}：本页 N 条` 会渲染首字孤冒号。门条件保证
  // 结果分支内至少其一非空，模板本身保持无条件拼接（不掩盖下一次枚举遗漏）。
  const resultLabel = q
    ? filterRelaxed
      ? `“${q}” 的结果（已放宽筛选）`
      : tag
        ? `“${q}” 在标签「${tag}」下`
        : category
          ? `“${q}” 在分类「${categoryName}」下`
          : `“${q}” 的结果`
    : tag
      ? `标签「${tag}」下的站点`
      : category
        ? `分类「${categoryName}」下的站点`
        : Object.keys(facets).length > 0
          ? `分面筛选下的站点`
          : ''

  return (
    <>
      <Container as="main" id="main-content">
        <div className="mx-auto max-w-4xl space-y-6 py-6 sm:py-10">
          <header className="space-y-3">
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">搜索站点</h1>
            <p className="text-sm text-muted-foreground">
              {category
                ? `在分类「${categoryName}」中检索，支持中文、拼音与语义匹配；结果是可分享、可回退的固定链接。`
                : '从站内全部收录站点中检索，支持中文、拼音与语义匹配；结果是可分享、可回退的固定链接。'}
            </p>
            <form action="/search" method="get" role="search" className="flex items-center gap-2">
              <label htmlFor="site-search-q" className="sr-only">
                搜索关键词
              </label>
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <input
                  id="site-search-q"
                  name="q"
                  type="search"
                  defaultValue={q}
                  maxLength={SEARCH_QUERY_MAX_LENGTH}
                  placeholder="搜索站点名称、简介或标签…"
                  className="h-10 w-full rounded-xl border border-border/70 bg-background/90 pl-9 pr-3 text-sm shadow-xs transition-colors hover:border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                />
              </div>
              {/* 提交关键词时保留进行中的标签筛选；要去掉标签用输入框上方的筛选条。
                  type=hidden 不进无障碍树，按装饰性控件标注，field-names 门禁同口径。 */}
              {tagApplied ? <input type="hidden" name="tag" value={tag} aria-hidden="true" /> : null}
              {/* 重搜改词时保留分类与分面筛选；不保留 page，重搜回到第 1 页。
                  分面逐值一个 hidden input（name="f_<key>"），与 normalizeSearchFacets 口径一致。 */}
              {category ? <input type="hidden" name="category" value={category} aria-hidden="true" /> : null}
              {Object.entries(facets).flatMap(([key, values]) =>
                values.map((value) => (
                  <input key={`f_${key}-${value}`} type="hidden" name={`f_${key}`} value={value} aria-hidden="true" />
                )),
              )}
              <button
                type="submit"
                className="h-10 shrink-0 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                搜索
              </button>
            </form>
            {/* 检索算子是中枢最有用却最不显眼的能力：不写出来没人会试。
                示例必须真实可点回结果（#开源 react / @开发工具 编辑器都实测有命中）。 */}
            <p className="text-[11px] text-muted-foreground">
              支持 <code className="rounded bg-muted px-1 py-0.5">#标签</code>、
              <code className="rounded bg-muted px-1 py-0.5">@分类</code> 限定范围，
              <code className="rounded bg-muted px-1 py-0.5">-词</code> 排除关键词；例如{' '}
              <code className="rounded bg-muted px-1 py-0.5">#开源 react</code>、
              <code className="rounded bg-muted px-1 py-0.5">@开发工具 编辑器</code>、
              <code className="rounded bg-muted px-1 py-0.5">笔记 -广告</code>。
            </p>
          </header>

          {facetGroups && facetGroups.length > 0 ? (
            <SearchFacetBar groups={facetGroups} q={q} tag={tagApplied ? tag : null} category={category} selected={facets} />
          ) : null}

          {q && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-blue-500/25 bg-blue-500/5 text-xs text-foreground">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <MonitorPlay className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-foreground truncate">
                    在精选技术视频库中搜索 “{q}”
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    收录 B站 &amp; YouTube 高保鲜实战课程与优质教程
                  </div>
                </div>
              </div>
              <Link
                href={`/videos?q=${encodeURIComponent(q)}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs shrink-0 transition-colors shadow-2xs self-start sm:self-auto"
              >
                <span>前往视频库</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}

          {/* U-183：生效中的筛选放一组——标签芯片与分类芯片同容器。
              分类芯片只要 category 非空就渲染（不用 tagApplied 口径：
              category 无「被放宽」的单独信号，hidden input 无论如何都
              保留它；放宽态隐藏芯片会让用户失去唯一清除入口）。 */}
          {tagApplied || category ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {tagApplied ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 font-medium text-primary">
                    标签：{tag}
                  </span>
                  <Link
                    href={searchHref({ q, category, facets })}
                    className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground hover:underline"
                  >
                    去掉筛选
                    <span aria-hidden>×</span>
                  </Link>
                </>
              ) : null}
              {category ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 font-medium text-primary">
                    分类：{categoryName}
                  </span>
                  <Link
                    href={searchHref({ q, tag, facets })}
                    aria-label={`去掉分类「${categoryName}」筛选`}
                    className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground hover:underline"
                  >
                    去掉筛选
                    <span aria-hidden>×</span>
                  </Link>
                </>
              ) : null}
            </div>
          ) : null}

          {filterRelaxed ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              <span>
                {relaxedPricingNotice(result?.relaxedFacets) ??
                  (tag
                    ? `标签「${tag}」等筛选没有命中，已放宽为更宽的结果；下面的站点不保证符合该标签。`
                    : inferred.length > 0
                      ? `查询里的条件（${inferred.join('、')}）没有命中，已放宽为更宽的结果；下面的站点不保证符合这些条件。`
                      : '筛选条件没有命中，已放宽为更宽的结果；下面的站点不保证符合原条件。')}
              </span>
              {tag ? (
                <Link
                  href={searchHref({ q, category, facets })}
                  className="font-medium underline underline-offset-2 hover:no-underline"
                >
                  去掉筛选
                </Link>
              ) : null}
            </div>
          ) : null}

          {/* U-184：空态门条件须与 page.tsx 的 hasFilter 一致（q/tag/category/facets
              四类），否则纯分类/纯分面态取回的结果会被静默丢弃、只显示「输入关键词」。 */}
          {q === '' && !tag && !category && Object.keys(facets).length === 0 ? (
            <section className="space-y-3 rounded-2xl border border-dashed border-border/70 bg-card/40 p-8 text-center">
              <p className="text-sm text-muted-foreground">输入关键词开始搜索；也可以先按分类或标签浏览。</p>
              <nav aria-label="浏览入口" className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs">
                <Link className="text-primary hover:underline" href="/category">
                  按分类浏览
                </Link>
                <Link className="text-primary hover:underline" href="/tags">
                  按标签浏览
                </Link>
                <Link className="text-primary hover:underline" href="/sites">
                  全部站点目录
                </Link>
                <Link className="text-primary hover:underline" href="/collections">
                  精选专题
                </Link>
              </nav>
            </section>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm text-muted-foreground" role="status">
                  {failed
                    ? '检索服务本次没有响应'
                    : hits.length > 0
                      ? `${resultLabel}：本页 ${hits.length} 条${semanticOnly ? '（均为语义近似，无关键词命中）' : ''}${fuzzy ? '（已放宽匹配范围）' : ''}${hasMore ? '，还有更多' : '，已到最后一页'}。`
                      : unavailable.length > 0
                        ? `没有可直接展示的正常站点；有 ${unavailable.length} 个字面匹配的站点最近巡检打不开（见下方）`
                        : page > 1
                          ? '这一页没有更多结果'
                          : hasPlugins
                            ? `站点暂无匹配；插件市场有 ${plugins?.total ?? 0} 个相关结果。`
                            : '站内暂时没有收录匹配的站点'}
                </p>
                {semanticsOff && !failed ? (
                  <span className="text-[11px] text-muted-foreground">
                    语义检索暂不可用，当前按关键词 / 拼音匹配
                  </span>
                ) : null}
              </div>

              {failed ? <FailedNotice q={q} page={page} tag={tag} category={category} facets={facets} /> : null}

              {!failed && !filterRelaxed && inferred.length > 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  已理解查询条件：{inferred.join('、')}。
                </p>
              ) : null}

              {/* 负向过滤同样会让结果变少：不说出来用户只会觉得「怎么搜不到」 */}
              {!failed && excluded.length > 0 ? (
                <p className="text-[11px] text-muted-foreground">已排除关键词：{excluded.join('、')}。</p>
              ) : null}

              {!failed && correction ? (
                <div
                  role="status"
                  className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs text-foreground"
                >
                  <span>已替你纠正为：</span>
                  <Link
                    href={searchHref({ q: correction.corrected, tag: tagApplied ? tag : null })}
                    className="font-bold text-primary underline hover:text-primary/80"
                  >
                    {correction.corrected}
                  </Link>
                  <span>不是这个？</span>
                  <Link
                    href={searchHref({ q: correction.original, tag: tagApplied ? tag : null, nocorrect: true })}
                    className="font-medium text-primary underline underline-offset-2 hover:no-underline"
                  >
                    搜原来的「{correction.original}」
                  </Link>
                </div>
              ) : !failed && didYouMean ? (
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs text-foreground">
                  <span>您是不是想搜：</span>
                  <Link href={searchHref({ q: didYouMean, tag: tagApplied ? tag : null })} className="font-bold text-primary underline hover:text-primary/80">
                    {didYouMean}
                  </Link>
                  <span>？</span>
                </div>
              ) : null}

              {!failed && relatedTags.length > 0 ? (
                <SearchRelatedTags tags={relatedTags} currentTag={tag} q={q} />
              ) : null}

              {!failed && relations.length > 0 ? <RelationBand relations={relations} externalRel={externalRel} /> : null}

              {!failed && hits.length > 0 ? (
                <ul className="space-y-2">
                  {hits.map((hit) => (hit.site ? <ResultRow key={hit.siteId} hit={hit} q={q} externalRel={externalRel} /> : null))}
                </ul>
              ) : null}

              {/* P1-3：插件分区与站点结果并列——插件取数失败（plugins=null）
                  或零命中时不渲染；放在 EmptyResults 之前，站点零命中但插件
                  有命中时用户先看到插件，不会只剩「没有收录」。 */}
              {hasPlugins && plugins ? <PluginSection plugins={plugins} q={q} /> : null}

              {/* 有巡检打不开的字面命中时不说「没有找到」：下方分区就是匹配项，
                  先摆「零结果」再摆匹配行会自相矛盾。A3（方案 b）：插件有命中时
                  EmptyResults 仍渲染（标题经 hasPlugins 限定为站点，四个出口
                  保留），PluginSection 在它之前，视觉优先。 */}
              {!failed && hits.length === 0 && unavailable.length === 0 ? (
                <EmptyResults
                  q={q}
                  page={page}
                  tag={tagApplied ? tag : null}
                  category={category}
                  categoryName={categoryName}
                  facets={facets}
                  suggestions={suggestions}
                  popular={popular}
                  inferredCategory={result?.inferredCategory ?? null}
                  recommended={recommended}
                  externalRel={externalRel}
                  correction={correction}
                  hideGenericRecommendations={correctedZero}
                  hasPlugins={hasPlugins}
                />
              ) : null}

              {!failed && unavailable.length > 0 ? (
                <UnavailableSection hits={unavailable} q={q} />
              ) : null}

              {!failed && hits.length > 0 && (page > 1 || hasMore) ? (
                <Pagination q={q} page={page} tag={tagApplied ? tag : null} category={category} facets={facets} hasMore={hasMore} />
              ) : null}
            </>
          )}
        </div>
      </Container>
      <Footer />
    </>
  )
}
