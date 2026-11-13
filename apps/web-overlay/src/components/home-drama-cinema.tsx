'use client'

/**
 * 首页「沉浸影院」区（设计稿 E 的核心版式落地）：
 *  - 深色影院带：短剧海报横滑（Agnes 生成的 2 张竖版海报打头）+ 短剧平台站卡；
 *  - 右侧热播榜：短剧分类内站点按编辑推荐顺序（分类 sort 即编辑序）呈现，
 *    脚注如实标注口径——全站真实热度统计尚在积累，不冒充播放量榜单；
 *  - 下方 4 张分类横幅（同为 Agnes 生成图）做分类入口卡。横幅上的站数不写死，
 *    而是从同一份导航数据实时数出来（@/lib/drama-sites 的 countCategorySites，
 *    口径与分类页一致），收录增减后数字自动跟上，不再漂移。
 *    海报是通用装饰图，不贴「热播」徽标——徽标会暗示对应具体剧集热播，而点开
 *    只是分类页；榜单拉取失败时如实说「暂时拉不到」，不一直写「加载中…」。
 *
 * 图片为什么走 public/drama-media.json 而不是打包进 JS：6 张原图约 17MB，
 * 压成 WebP 后共 162KB、以 base64 放进一个静态 JSON，组件懒挂载时才
 * fetch，完全不进首页 JS bundle（首页预算只剩约 30KB 余量）。fetch 失败
 * 时退化为渐变海报卡 + 文字链接，功能不假装、入口不丢。
 * 站点数据走既有的 /api/home/navigation（与生态图谱同款公开只读口）。
 * 标题行下方另有一行「继续追」：读本机追剧清单（未登录也能用），把
 * due→check→active 前 4 部以文字卡露出，空清单时整行不渲染；卡片点开
 * 只是平台站首页（站内无单剧深链），文案不暗示能直达某集，取行口径在
 * @/lib/watchlist 的 selectContinueWatching，与分类页横幅同源。
 * 推荐位口径（A10）：巡检确认失效（broken）的站不上海报墙与热播榜，
 * 收集逻辑在 @/lib/drama-sites；分类列表里它们仍保留并标失效。
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Clapperboard, Flame, Play } from 'lucide-react'
import { collectDramaSites, countCategorySites, type DramaSite } from '@/lib/drama-sites'
import { safeHref } from '@/lib/safe-url'
import { WatchlistAddButton } from '@/components/watchlist-add-button'
import { useWatchlist } from '@/hooks/useWatchlist'
import {
  cadenceLabel,
  isReminderDue,
  selectContinueWatching,
  type WatchEntry,
} from '@/lib/watchlist'

interface MediaEntry {
  key: string
  title: string
  width: number
  height: number
  data: string
}

/** 续看卡片角标：只断言清单里已有的事实，不冒充平台真的更新了。 */
function continueBadge(entry: WatchEntry, now: Date): string {
  if (isReminderDue(entry, now)) return '今日待看'
  if (entry.cadence.kind === 'unknown') return '可查更新'
  return cadenceLabel(entry.cadence)
}

const BANNER_LINKS: Record<string, { href: string; caption: string }> = {
  'banner-ai-tools': { href: '/category/ai-tools', caption: 'AI 工具' },
  'banner-entertainment': { href: '/category/entertainment', caption: '影音娱乐' },
  'banner-learning': { href: '/category/learning-growth', caption: '学习成长' },
  'banner-productivity': { href: '/category/office-productivity', caption: '效率办公' },
}

export function HomeDramaCinema() {
  const rootRef = useRef<HTMLElement | null>(null)
  const [posters, setPosters] = useState<MediaEntry[]>([])
  const [banners, setBanners] = useState<MediaEntry[]>([])
  const [dramaSites, setDramaSites] = useState<DramaSite[]>([])
  const [started, setStarted] = useState(false)
  // 「继续追」续看行：读本机追剧清单，未登录也能用；ready 前与存储被禁时不渲染，
  // 空清单时整行不出现——不在深色影院带里留「你还没追剧」的占位。
  const { ready: watchlistReady, entries: watchlistEntries, storageBlocked } = useWatchlist()
  const now = new Date()
  const continueWatching =
    watchlistReady && !storageBlocked ? selectContinueWatching(watchlistEntries, now) : []
  // 横幅站数：导航数据到手后才有数；null = 还没数出来，只显示分类名不编数字
  const [aiToolsCount, setAiToolsCount] = useState<number | null>(null)
  // 榜单状态：pending = 还没开始拉（首屏未进入视口），failed = 已拉取失败
  const [navStatus, setNavStatus] = useState<'pending' | 'loading' | 'done' | 'failed'>('pending')

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setStarted(true)
          io.disconnect()
        }
      },
      { rootMargin: '600px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!started) return
    let cancelled = false
    fetch('/drama-media.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setPosters(Array.isArray(data.posters) ? data.posters : [])
        setBanners(Array.isArray(data.banners) ? data.banners : [])
      })
      .catch(() => {
        // 海报/横幅是装饰素材：拉不到就保持空数组，影院区的平台直达入口照常渲染，故吞掉
      })
    setNavStatus('loading')
    fetch('/api/home/navigation')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        if (!data) {
          setNavStatus('failed')
          return
        }
        // 收集口径在 @/lib/drama-sites：已确认失效（broken）的站不上推荐位（A10）
        setDramaSites(collectDramaSites(data.navigationItems))
        // 横幅站数与分类页同口径实时数；数不到就不显示数字，不编数
        setAiToolsCount(countCategorySites(data.navigationItems, 'reg-ai-tools', 'AI 工具'))
        setNavStatus('done')
      })
      .catch(() => {
        // 首页影院只是推荐位：导航数据拉不到时推荐保持空，页面主目录不受影响，
        // 不为次要模块弹错打扰用户，故吞掉；榜单区如实显示拉取失败而非一直「加载中」
        if (!cancelled) setNavStatus('failed')
      })
    return () => {
      cancelled = true
    }
  }, [started])

  const chart = dramaSites.slice(0, 8)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [canPagePrev, setCanPagePrev] = useState(false)
  const [canPageNext, setCanPageNext] = useState(false)
  const pageScroll = (dir: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    const first = el.firstElementChild as HTMLElement | null
    const step = (first ? first.offsetWidth : 176) + 12
    const page = Math.max(step, Math.floor(el.clientWidth / step) * step)
    const max = Math.max(0, el.scrollWidth - el.clientWidth)
    el.scrollTo({ left: Math.min(max, Math.max(0, Math.round((el.scrollLeft + dir * page) / step) * step)), behavior: 'smooth' })
  }
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      setCanPagePrev(el.scrollLeft > 4)
      setCanPageNext(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [posters, dramaSites])

  return (
    <section ref={rootRef} aria-label="短剧影院" className="mt-8 overflow-hidden rounded-3xl bg-zinc-950 text-zinc-100 shadow-xl">
      <div className="flex items-center justify-between px-4 pt-4 sm:px-6">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Clapperboard className="h-5 w-5 text-rose-500" aria-hidden />
          短剧影院
          <span className="hidden text-xs font-normal text-zinc-400 sm:inline">免费短剧 + 各大平台，一站直达</span>
        </h2>
        <div className="flex items-center gap-4">
          <Link href="/me/watchlist" className="inline-flex items-center gap-0.5 text-sm text-zinc-300 transition-colors hover:text-white">
            我的追剧 <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link href="/category/duanju" className="inline-flex items-center gap-0.5 text-sm text-zinc-300 transition-colors hover:text-white">
            进入短剧专区 <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        <div className="flex items-center gap-1.5" role="group" aria-label="短剧海报翻页">
          <button type="button" onClick={() => pageScroll(-1)} disabled={!canPagePrev} aria-label="向左翻页" className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-zinc-200 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={() => pageScroll(1)} disabled={!canPageNext} aria-label="向右翻页" className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-zinc-200 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
        </div>
      </div>

      {continueWatching.length > 0 && (
        <div className="px-4 pt-3 sm:px-6" aria-label="继续追">
          <div className="flex items-center gap-3 overflow-x-auto pb-1">
            <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-zinc-100">
              <Play className="h-4 w-4 text-rose-400" aria-hidden />
              继续追
            </span>
            {continueWatching.map((e) => (
              <a
                key={e.key}
                href={safeHref(e.playUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-56 shrink-0 flex-col rounded-2xl border border-white/10 bg-white/5 p-3 transition-colors hover:bg-white/10"
                title={`${e.title} · 在${e.platformTitle}站内打开`}
              >
                <span className="flex items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/20 text-sm font-bold text-rose-300" aria-hidden>
                    {e.platformTitle.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={e.title}>{e.title}</span>
                </span>
                <span className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                  <span className="min-w-0 flex-1 truncate" title={e.platformTitle}>{e.platformTitle}</span>
                  <span className="shrink-0">{e.episode > 0 ? `看到第 ${e.episode} 集` : '还没开始看'}</span>
                  <span className="ml-auto shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-300">{continueBadge(e, now)}</span>
                </span>
              </a>
            ))}
            <Link
              href="/me/watchlist"
              className="flex w-24 shrink-0 self-stretch flex-col items-center justify-center gap-0.5 rounded-2xl border border-white/10 bg-white/5 text-sm text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              全部清单
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      )}

      <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[1fr_300px]">
        <div ref={scrollRef} className="flex gap-3 overflow-x-auto pb-2" aria-label="短剧海报与平台">
          {posters.map((p, i) => (
            <Link
              key={p.key}
              href="/category/duanju"
              className="group relative w-36 shrink-0 overflow-hidden rounded-2xl sm:w-44"
              title={`${p.title} · 去短剧专区`}
            >
              <img src={p.data} alt={p.title} width={p.width} height={p.height} className="aspect-[440/784] w-full object-cover transition-transform duration-300 group-hover:scale-105" loading={i === 0 ? 'eager' : 'lazy'} fetchPriority={i === 0 ? 'high' : undefined} />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2.5 pt-8 text-sm font-semibold">
                {p.title}
              </span>
              {/* 海报是通用装饰图：不贴「热播」徽标，点开只是短剧分类页，并无对应剧集 */}
            </Link>
          ))}
          {posters.length === 0 && (
            <Link href="/category/duanju" className="flex aspect-[440/784] w-36 shrink-0 flex-col justify-end rounded-2xl bg-gradient-to-br from-rose-900 via-zinc-900 to-zinc-950 p-3 sm:w-44">
              <span className="text-sm font-semibold">短剧专区</span>
              <span className="mt-1 text-xs text-zinc-400">红果、DramaWave 等免费短剧都在这</span>
            </Link>
          )}
          {dramaSites.map((s) => (
            <div
              key={s.id}
              className="flex w-36 shrink-0 flex-col rounded-2xl border border-white/10 bg-white/5 p-3 transition-colors hover:bg-white/10 sm:w-44"
            >
              <a
                href={safeHref(s.href)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 flex-col justify-between"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20 text-lg font-bold text-rose-300" aria-hidden>
                  {s.title.slice(0, 1)}
                </span>
                <span>
                  <span className="block truncate text-sm font-semibold" title={s.title}>{s.title}</span>
                  <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-zinc-400">{s.description || '点开直接看'}</span>
                </span>
              </a>
              <span className="mt-2 block">
                <WatchlistAddButton platform={{ siteId: s.id, title: s.title, href: s.href }} variant="dark" />
              </span>
            </div>
          ))}
        </div>

        <aside className="rounded-2xl border border-white/10 bg-white/5 p-4" aria-label="短剧热播榜">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Flame className="h-4 w-4 text-orange-500" aria-hidden /> 短剧热播榜
          </h3>
          {chart.length > 0 ? (
            <ol className="mt-3 space-y-2">
              {chart.map((s, i) => (
                <li key={s.id}>
                  <a href={safeHref(s.href)} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-2.5 text-sm">
                    <span className={`w-5 shrink-0 text-center font-mono text-base font-bold ${i < 3 ? 'text-rose-500' : 'text-zinc-400'}`}>{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate group-hover:underline" title={s.title}>{s.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-zinc-400">
              {navStatus === 'failed'
                ? '榜单暂时拉不到，可以直接进短剧专区逛。'
                : '榜单加载中…也可以直接进短剧专区逛。'}
            </p>
          )}
          <p className="mt-3 border-t border-white/10 pt-2 text-[11px] leading-relaxed text-zinc-400">
            按站内编辑推荐顺序排列；全站真实热度统计还在积累中，暂不冒充播放量榜单。
          </p>
        </aside>
      </div>

      {banners.length > 0 && (
        <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:px-6 sm:pb-6 lg:grid-cols-4">
          {banners.map((b) => {
            const link = BANNER_LINKS[b.key]
            if (!link) return null
            // AI 工具横幅的站数是实时数出来的（导航数据到手前只显示分类名，不编数字）
            const caption =
              b.key === 'banner-ai-tools' && aiToolsCount !== null
                ? `AI 工具 · ${aiToolsCount} 站`
                : link.caption
            return (
              <Link key={b.key} href={link.href} className="group relative overflow-hidden rounded-2xl" title={caption}>
                <img src={b.data} alt={b.title} width={b.width} height={b.height} className="aspect-[1000/561] w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-6 text-sm font-semibold">
                  {caption}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
