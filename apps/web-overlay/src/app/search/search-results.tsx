import Link from 'next/link'
import { AlertTriangle, ArrowRight, ExternalLink, Search, Sparkles } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { SiteFavicon } from '@/components/site-favicon'
import { isSafeHttpUrl, safeHref } from '@/lib/safe-url'
import {
  SEARCH_QUERY_MAX_LENGTH,
  inferredConditionLabels,
  searchHref,
  searchMaxPage,
  searchPageWindow,
} from '@/lib/search-page'
import type { HubSearchHit, HubSearchResult } from '@/lib/navhub-api'

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
  result: HubSearchResult | null
  failed: boolean
  unavailable: HubSearchHit[]
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

/** 字面命中高亮（纯文本切分，不注入 HTML） */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const at = text.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-primary/15 px-0.5 text-foreground">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  )
}

function FailedNotice({ q, page, tag }: { q: string; page: number; tag: string | null }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span>检索服务本次没有响应（不是「没有收录这个站点」）。稍后重试，或先按分类 / 标签浏览。</span>
      <Link
        href={searchHref({ q, page, tag })}
        className="font-medium underline underline-offset-2 hover:no-underline"
      >
        重试
      </Link>
    </div>
  )
}

function RelationBand({ relations }: { relations: NonNullable<HubSearchResult['relationHits']> }) {
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
                <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
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
                  rel="noopener noreferrer"
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

function ResultRow({ hit, q }: { hit: HubSearchHit; q: string }) {
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
            {linkable ? (
              <a
                href={safeHref(site.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="max-w-full truncate text-sm font-semibold text-foreground hover:text-primary hover:underline"
              >
                <Highlight text={site.title} query={q} />
              </a>
            ) : (
              <span className="max-w-full truncate text-sm font-semibold text-foreground">
                <Highlight text={site.title} query={q} />
              </span>
            )}
            {host ? <span className="text-[11px] text-muted-foreground">{host}</span> : null}
            {site.status === 'broken' ? (
              <span
                title="最近一次健康巡检被对方站点拒绝（常见 401/403 反爬），不代表站点已下线"
                className="rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
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
          </div>
        </div>
        <Link
          href={`/site/${encodeURIComponent(site.id)}`}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border/70 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          详情
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
    </li>
  )
}

function EmptyResults({
  q,
  page,
  tag,
  suggestions,
  popular,
}: {
  q: string
  page: number
  tag: string | null
  suggestions: string[]
  popular: string[]
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-dashed border-border/70 bg-card/40 p-6">
      <p className="text-sm font-medium text-foreground">
        {page > 1
          ? `第 ${page} 页没有更多结果。`
          : tag
            ? q
              ? `没有找到与“${q}”匹配、且带标签「${tag}」的站点。`
              : `标签「${tag}」下暂时没有站点。`
            : `没有找到与“${q}”匹配的站点。`}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {page > 1 ? (
          <Link href={searchHref({ q, tag })} className="text-xs text-primary hover:underline">
            回到第 1 页
          </Link>
        ) : null}
        {tag ? (
          <Link href={searchHref({ q })} className="text-xs text-primary hover:underline">
            去掉标签筛选
          </Link>
        ) : null}
      </div>
      {q && !tag && suggestions.length > 0 ? (
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
      {popular.length > 0 ? (
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
        {hits.map((hit) => (hit.site ? <ResultRow key={hit.siteId} hit={hit} q={q} /> : null))}
      </ul>
    </section>
  )
}

function Pagination({
  q,
  page,
  tag,
  hasMore,
}: {
  q: string
  page: number
  tag: string | null
  hasMore: boolean
}) {
  const pages = searchPageWindow(page, hasMore)
  const linkClass = 'px-3 py-1.5 text-xs rounded-md border border-border/70 hover:bg-muted/50'
  return (
    <nav aria-label="搜索结果分页" className="flex flex-wrap items-center gap-2 pt-2">
      {page > 1 ? (
        <Link href={searchHref({ q, page: page - 1, tag })} className={linkClass}>
          上一页
        </Link>
      ) : null}
      {pages.map((n) => (
        <Link
          key={n}
          href={searchHref({ q, page: n, tag })}
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
        <Link href={searchHref({ q, page: page + 1, tag })} className={linkClass}>
          下一页
        </Link>
      ) : null}
    </nav>
  )
}

export function SearchResults({ q, page, tag, result, failed, unavailable }: SearchResultsProps) {
  const hits = result?.hits ?? []
  const hasMore = result?.hasMore === true
  const relations = (result?.relationHits ?? []).filter((rel) => rel.sourceSite).slice(0, 3)
  const suggestions = result?.suggestions ?? []
  const popular = result?.popular ?? []
  const didYouMean = result?.didYouMean
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
  const resultLabel = q
    ? filterRelaxed
      ? `“${q}” 的结果（已放宽筛选）`
      : tag
        ? `“${q}” 在标签「${tag}」下`
        : `“${q}” 的结果`
    : tag
      ? `标签「${tag}」下的站点`
      : ''

  return (
    <>
      <Container as="main" id="main-content">
        <div className="mx-auto max-w-4xl space-y-6 py-6 sm:py-10">
          <header className="space-y-3">
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">搜索站点</h1>
            <p className="text-sm text-muted-foreground">
              从站内全部收录站点中检索，支持中文、拼音与语义匹配；结果是可分享、可回退的固定链接。
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
              <code className="rounded bg-muted px-1 py-0.5">@分类</code> 限定范围，例如{' '}
              <code className="rounded bg-muted px-1 py-0.5">#开源 react</code>、
              <code className="rounded bg-muted px-1 py-0.5">@开发工具 编辑器</code>。
            </p>
          </header>

          {tagApplied ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 font-medium text-primary">
                标签：{tag}
              </span>
              <Link
                href={searchHref({ q })}
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground hover:underline"
              >
                去掉筛选
                <span aria-hidden>×</span>
              </Link>
            </div>
          ) : null}

          {filterRelaxed ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              <span>
                {tag
                  ? `标签「${tag}」等筛选没有命中，已放宽为更宽的结果；下面的站点不保证符合该标签。`
                  : inferred.length > 0
                    ? `查询里的条件（${inferred.join('、')}）没有命中，已放宽为更宽的结果；下面的站点不保证符合这些条件。`
                    : '筛选条件没有命中，已放宽为更宽的结果；下面的站点不保证符合原条件。'}
              </span>
              {tag ? (
                <Link
                  href={searchHref({ q })}
                  className="font-medium underline underline-offset-2 hover:no-underline"
                >
                  去掉筛选
                </Link>
              ) : null}
            </div>
          ) : null}

          {q === '' && !tag ? (
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
                        : '没有找到匹配结果'}
                </p>
                {semanticsOff && !failed ? (
                  <span className="text-[11px] text-muted-foreground">
                    语义检索暂不可用，当前按关键词 / 拼音匹配
                  </span>
                ) : null}
              </div>

              {failed ? <FailedNotice q={q} page={page} tag={tag} /> : null}

              {!failed && !filterRelaxed && inferred.length > 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  已理解查询条件：{inferred.join('、')}。
                </p>
              ) : null}

              {!failed && didYouMean ? (
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs text-foreground">
                  <span>您是不是想搜：</span>
                  <Link href={searchHref({ q: didYouMean, tag: tagApplied ? tag : null })} className="font-bold text-primary underline hover:text-primary/80">
                    {didYouMean}
                  </Link>
                  <span>？</span>
                </div>
              ) : null}

              {!failed && relations.length > 0 ? <RelationBand relations={relations} /> : null}

              {!failed && hits.length > 0 ? (
                <ul className="space-y-2">
                  {hits.map((hit) => (hit.site ? <ResultRow key={hit.siteId} hit={hit} q={q} /> : null))}
                </ul>
              ) : null}

              {/* 有巡检打不开的字面命中时不说「没有找到」：下方分区就是匹配项，
                  先摆「零结果」再摆匹配行会自相矛盾 */}
              {!failed && hits.length === 0 && unavailable.length === 0 ? (
                <EmptyResults
                  q={q}
                  page={page}
                  tag={tagApplied ? tag : null}
                  suggestions={suggestions}
                  popular={popular}
                />
              ) : null}

              {!failed && unavailable.length > 0 ? (
                <UnavailableSection hits={unavailable} q={q} />
              ) : null}

              {!failed && hits.length > 0 && (page > 1 || hasMore) ? (
                <Pagination q={q} page={page} tag={tagApplied ? tag : null} hasMore={hasMore} />
              ) : null}
            </>
          )}
        </div>
      </Container>
      <Footer />
    </>
  )
}
