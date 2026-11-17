import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, ExternalLink, Flame, MessageCircleQuestion, Newspaper, Search, Sparkles } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { safeHref } from '@/lib/safe-url'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/registry/new-york/ui/button'
import {
  hotlistAllEmptyCopy,
  hotlistEmptyVariant,
  hotlistSourceEmptyCopy,
} from '@/lib/empty-states'
import {
  formatClock,
  formatHotValue,
  loadBriefToday,
  loadHotlist,
  type HubBriefHotPick,
  type HubHotlistSource,
} from '@/lib/server/brief'
import { formatHotlistSubline } from '@/lib/relative-time'
import BriefWatch from './brief-watch'
import BriefResurface from './brief-resurface'
import HotlistFreshness from './hotlist-freshness'
import BriefTriage from './brief-triage'
import DailyFocus from '@/components/daily-focus'

/**
 * 每日简报页（/brief，服务端渲染）。
 *
 * 一页看完今天：小猫猫开场白（锚定真实条目生成、失败走模板）、在追剧
 * 今日提醒（客户端岛按登录身份补）、今日重温（客户端岛按本机收藏现算）、
 * 今日热榜精选、全网热榜（多源并列）、站内新收录。全部数据来自中枢的缓存管道（热榜每小时抓取、简报按天
 * 组版落库），本页不现算、不现抓；中枢不可达时降级为说明壳并 noindex，
 * 不拿空榜单冒充内容。
 */

export const revalidate = 300

const TITLE = '每日简报 - 今天值得看的，都在这一页'
const DESCRIPTION = '小猫猫每日简报：全网热榜精选（微博/百度/头条/抖音/B站/知乎）、站内新收录与在追短剧提醒，一页看完今天值得看的。'
const FALLBACK_DESCRIPTION = '每天一份的站内简报：全网热榜、站内新收录与在追短剧提醒汇总成一页。'

export async function generateMetadata(): Promise<Metadata> {
  const brief = await loadBriefToday()
  if (!brief) {
    return {
      title: '每日简报',
      description: FALLBACK_DESCRIPTION,
      alternates: { canonical: '/brief' },
      robots: { index: false, follow: true },
    }
  }
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: '/brief' },
    ...(await pageShareMetadata({ url: '/brief', title: TITLE, description: DESCRIPTION })),
  }
}

function HotRow({ item }: { item: HubBriefHotPick }) {
  const hot = formatHotValue(item.hotValue)
  return (
    // 标题外链与站内搜是两个并列的独立链接：站内搜绝不嵌进标题 <a> 里，
    // 标题仍是直达原平台的主链路，搜按钮只做站内跳转（同页，不开新标签）。
    // 搜按钮可点目标 44×44（min-h-11 min-w-11，WCAG 2.5.5）：图标仍 14px，
    // 外框达标并带可见「站内搜」文字；行高随之 28px → 44px（+16px/行），
    // 换手机端不再误点跳外站。
    // 不展示 item.rank：各源热度口径不同、部分源（如知乎）无数值热度，
    // 序号会暗示并不存在的统一排名；只并列展示标题与链接。
    <li className="flex items-center gap-1">
      <a
        href={safeHref(item.url)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-w-0 flex-1 items-baseline gap-2 rounded-md px-1 py-1 hover:bg-accent transition-colors"
      >
        <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
        {item.hotLabel ? <span className="shrink-0 text-[10px] text-orange-700 dark:text-orange-400">{item.hotLabel}</span> : null}
        {hot ? <span className="shrink-0 text-xs text-muted-foreground">{hot}</span> : null}
      </a>
      <Link
        href={`/search?q=${encodeURIComponent(item.title)}`}
        aria-label={`站内搜「${item.title}」`}
        title={`站内搜「${item.title}」`}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-link"
      >
        <Search className="h-3.5 w-3.5" aria-hidden />
        <span>站内搜</span>
      </Link>
    </li>
  )
}

function SourceColumn({ source }: { source: HubHotlistSource }) {
  const clock = formatClock(source.fetchedAt)
  // 副行文案是本站抓取时刻的相对时间（非平台更新时间）；首帧由 SSR 算出，
  // 客户端小岛每 60 秒按同一 fetchedAt 重算，不发请求。
  const subline = formatHotlistSubline(source.status, source.fetchedAt)
  return (
    <section aria-label={source.name} className="min-w-0 rounded-xl border bg-card p-4">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{source.name}</h3>
        <a
          href={safeHref(source.homeUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          完整榜单 <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </header>
      <HotlistFreshness
        status={source.status}
        fetchedAt={source.fetchedAt}
        clock={clock}
        ssrText={subline}
      />
      {source.items.length > 0 ? (
        <ol className="space-y-0.5">
          {source.items.slice(0, 30).map((item) => (
            <HotRow key={`${source.id}-${item.rank}`} item={{ ...item, source: source.id, sourceName: source.name, fetchedAt: source.fetchedAt ?? 0 }} />
          ))}
        </ol>
      ) : (
        <div className="py-4 text-center space-y-2">
          <p className="text-xs text-muted-foreground">{hotlistSourceEmptyCopy(source).why}</p>
          <a
            href={safeHref(source.homeUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-link hover:underline"
          >
            {hotlistSourceEmptyCopy(source).actionLabel}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
      )}
    </section>
  )
}

export default async function BriefPage() {
  const [brief, hotlist] = await Promise.all([loadBriefToday(), loadHotlist()])
  // 全源皆空才是空态：中枢不可达（hotlist 为 null）是失败，走上面的降级壳；
  // 任一源有条目也不是空态。只有全空时才用解释 + 去 /hot 的出口代替一排死盒子。
  const hotlistVariant = hotlistEmptyVariant(hotlist)
  const hotlistCopy = hotlistVariant ? hotlistAllEmptyCopy(hotlistVariant) : null

  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-6 sm:space-y-8">
        <Breadcrumbs
          items={[
            { label: '首页', path: '/' },
            { label: '每日简报', path: '/brief' },
          ]}
        />

        {/* 今日专注是简报的第一块内容：本机岛，挂载前渲染静态骨架（U-61，
            与终态同高不跳动）、SSR 不带用户数据。
            放在条件之外——哪怕中枢不可达、简报降级成说明壳，今天的专注也还在。 */}
        <DailyFocus />

        {/* 问问我的收藏：只是一张跳转卡片，不在简报页内嵌问答；点进去到 /ask 再问。 */}
        <section
          aria-label="问问我的收藏"
          className="rounded-xl border bg-card p-4"
        >
          <Link href="/ask" className="flex items-center gap-3">
            <MessageCircleQuestion className="h-5 w-5 shrink-0 text-primary" aria-hidden />
            <span className="flex-1">
              <span className="block text-sm font-semibold">问问我的收藏</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                在自己的收藏里带引用问答：每条结论都链到原收藏条目，找不到就老实说不知道。
              </span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </section>

        {!brief && !hotlist ? (
          <section className="rounded-xl border bg-card p-6 text-center">
            <Newspaper className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
            <h1 className="mb-2 text-lg font-semibold">每日简报暂时不可用</h1>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              简报服务未启动或网络不可达，今天的热榜与新收录暂时取不到。稍后再来，或先去
              <Link href="/hot" className="text-link hover:underline">站内热度榜</Link>
              看看。
            </p>
          </section>
        ) : (
          <>
            {brief ? (
              <section aria-label="今日简报" className="rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    <Sparkles className="h-4 w-4 text-primary" aria-hidden /> 小猫猫每日简报
                  </span>
                  <span aria-hidden>·</span>
                  <span>{brief.date}</span>
                  <span aria-hidden>·</span>
                  <span>生成于 {formatClock(brief.generatedAt) ?? ''}</span>
                </div>
                <p className="text-base leading-relaxed sm:text-lg">{brief.opening}</p>
              </section>
            ) : null}

            <BriefWatch />

            <BriefResurface />

            <BriefTriage />

            {brief && brief.hotPicks.length > 0 ? (
              <section aria-label="今日热榜精选">
                <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
                  <Flame className="h-5 w-5 text-orange-500" aria-hidden /> 今日热榜精选
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[...new Set(brief.hotPicks.map((p) => p.source))].map((sourceId) => {
                    const picks = brief.hotPicks.filter((p) => p.source === sourceId)
                    const first = picks[0]
                    if (!first) return null
                    return (
                      <div key={sourceId} className="min-w-0 rounded-xl border bg-card p-4">
                        <h3 className="mb-2 text-sm font-semibold">{first.sourceName}</h3>
                        <ol className="space-y-0.5">
                          {picks.map((pick) => (
                            <HotRow key={`${sourceId}-${pick.rank}`} item={pick} />
                          ))}
                        </ol>
                      </div>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {brief && brief.newSites.length > 0 ? (
              <section aria-label="站内新收录">
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold">
                    {brief.newSitesScope === 'today' ? '今日新收录' : '最近收录'}
                  </h2>
                  <Link href="/hot?tab=new" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    看新品榜 <ArrowRight className="h-3 w-3" aria-hidden />
                  </Link>
                </div>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {brief.newSites.map((site) => (
                    <li key={site.id} className="rounded-xl border bg-card p-4">
                      <Link href={`/site/${encodeURIComponent(site.id)}`} className="text-sm font-medium hover:text-link">
                        {site.title}
                      </Link>
                      {site.description ? (
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{site.description}</p>
                      ) : null}
                      <p className="mt-2 text-[11px] text-muted-foreground">收录于 {site.addedOn}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {hotlist ? (
              <section aria-label="全网热榜" id="hotlist">
                <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
                  <Flame className="h-5 w-5 text-orange-500" aria-hidden /> 全网热榜
                </h2>
                <p className="mb-3 text-xs text-muted-foreground">
                  每小时更新一次；只汇总各平台的标题与链接，点任意条目直达原平台。各源热度口径不同，只并列展示、不混算总榜。
                </p>
                {hotlistCopy ? (
                  <EmptyState
                    // 服务端页：图标传已渲染的元素，不把 Flame 组件函数传过 RSC 边界
                    //（尺寸与主色按 warning 档自带，与 EmptyState 的 iconTone="warning" 同值）。
                    icon={<Flame className="h-6 w-6 text-amber-700 dark:text-amber-400" aria-hidden />}
                    iconTone="warning"
                    title={hotlistCopy.title}
                    description={
                      <>
                        {hotlistCopy.why} {hotlistCopy.next}
                      </>
                    }
                    action={
                      <Button asChild size="sm" variant="outline" className="text-xs">
                        <Link href={hotlistCopy.actionHref}>{hotlistCopy.actionLabel}</Link>
                      </Button>
                    }
                  />
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {hotlist.sources.map((source) => (
                      <SourceColumn key={source.id} source={source} />
                    ))}
                  </div>
                )}
                {hotlist.uncovered.length > 0 ? (
                  <div className="mt-4 rounded-xl border border-dashed p-4 text-xs leading-relaxed text-muted-foreground">
                    <p className="mb-1 font-medium text-foreground">暂未覆盖的平台</p>
                    <ul className="list-disc space-y-1 pl-4">
                      {hotlist.uncovered.map((u) => (
                        <li key={u.id}>
                          {u.name}：{u.reason}（可先去
                          <a href={safeHref(u.homeUrl)} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
                            官方热榜页
                          </a>
                          看）
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </div>
      <Footer />
    </Container>
  )
}
