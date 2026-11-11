'use client'

/**
 * 首页「沉浸影院」区（设计稿 E 的核心版式落地）：
 *  - 深色影院带：短剧海报横滑（Agnes 生成的 2 张竖版海报打头）+ 短剧平台站卡；
 *  - 右侧热播榜：短剧分类内站点按编辑推荐顺序（分类 sort 即编辑序）呈现，
 *    脚注如实标注口径——全站真实热度统计尚在积累，不冒充播放量榜单；
 *  - 下方 4 张分类横幅（同为 Agnes 生成图）做分类入口卡。
 *
 * 图片为什么走 public/drama-media.json 而不是打包进 JS：6 张原图约 17MB，
 * 压成 WebP 后共 162KB、以 base64 放进一个静态 JSON，组件懒挂载时才
 * fetch，完全不进首页 JS bundle（首页预算只剩约 30KB 余量）。fetch 失败
 * 时退化为渐变海报卡 + 文字链接，功能不假装、入口不丢。
 * 站点数据走既有的 /api/home/navigation（与生态图谱同款公开只读口）。
 * 推荐位口径（A10）：巡检确认失效（broken）的站不上海报墙与热播榜，
 * 收集逻辑在 @/lib/drama-sites；分类列表里它们仍保留并标失效。
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Clapperboard, Flame } from 'lucide-react'
import { collectDramaSites, type DramaSite } from '@/lib/drama-sites'
import { safeHref } from '@/lib/safe-url'

interface MediaEntry {
  key: string
  title: string
  width: number
  height: number
  data: string
}

const BANNER_LINKS: Record<string, { href: string; caption: string }> = {
  'banner-ai-tools': { href: '/category/ai-tools', caption: 'AI 工具 · 60 站' },
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
      .catch(() => undefined)
    fetch('/api/home/navigation')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        // 收集口径在 @/lib/drama-sites：已确认失效（broken）的站不上推荐位（A10）
        setDramaSites(collectDramaSites(data.navigationItems))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [started])

  const chart = dramaSites.slice(0, 8)

  return (
    <section ref={rootRef} aria-label="短剧影院" className="mt-8 overflow-hidden rounded-3xl bg-zinc-950 text-zinc-100 shadow-xl">
      <div className="flex items-center justify-between px-4 pt-4 sm:px-6">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Clapperboard className="h-5 w-5 text-rose-500" aria-hidden />
          短剧影院
          <span className="hidden text-xs font-normal text-zinc-400 sm:inline">免费短剧 + 各大平台，一站直达</span>
        </h2>
        <Link href="/category/duanju" className="inline-flex items-center gap-0.5 text-sm text-zinc-300 transition-colors hover:text-white">
          进入短剧专区 <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[1fr_300px]">
        <div className="flex gap-3 overflow-x-auto pb-2" aria-label="短剧海报与平台">
          {posters.map((p) => (
            <Link
              key={p.key}
              href="/category/duanju"
              className="group relative w-36 shrink-0 overflow-hidden rounded-2xl sm:w-44"
              title={`${p.title} · 去短剧专区`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.data} alt={p.title} width={p.width} height={p.height} className="aspect-[440/784] w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2.5 pt-8 text-sm font-semibold">
                {p.title}
              </span>
              <span className="absolute left-2 top-2 rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-semibold">热播</span>
            </Link>
          ))}
          {posters.length === 0 && (
            <Link href="/category/duanju" className="flex aspect-[440/784] w-36 shrink-0 flex-col justify-end rounded-2xl bg-gradient-to-br from-rose-900 via-zinc-900 to-zinc-950 p-3 sm:w-44">
              <span className="text-sm font-semibold">短剧专区</span>
              <span className="mt-1 text-xs text-zinc-400">红果、DramaWave 等免费短剧都在这</span>
            </Link>
          )}
          {dramaSites.map((s) => (
            <a
              key={s.id}
              href={safeHref(s.href)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-36 shrink-0 flex-col justify-between rounded-2xl border border-white/10 bg-white/5 p-3 transition-colors hover:bg-white/10 sm:w-44"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20 text-lg font-bold text-rose-300" aria-hidden>
                {s.title.slice(0, 1)}
              </span>
              <span>
                <span className="block truncate text-sm font-semibold">{s.title}</span>
                <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-zinc-400">{s.description || '点开直接看'}</span>
              </span>
            </a>
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
                    <span className={`w-5 shrink-0 text-center font-mono text-base font-bold ${i < 3 ? 'text-rose-500' : 'text-zinc-500'}`}>{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate group-hover:underline">{s.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-zinc-400">榜单加载中…也可以直接进短剧专区逛。</p>
          )}
          <p className="mt-3 border-t border-white/10 pt-2 text-[11px] leading-relaxed text-zinc-500">
            按站内编辑推荐顺序排列；全站真实热度统计还在积累中，暂不冒充播放量榜单。
          </p>
        </aside>
      </div>

      {banners.length > 0 && (
        <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:px-6 sm:pb-6 lg:grid-cols-4">
          {banners.map((b) => {
            const link = BANNER_LINKS[b.key]
            if (!link) return null
            return (
              <Link key={b.key} href={link.href} className="group relative overflow-hidden rounded-2xl" title={link.caption}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.data} alt={b.title} width={b.width} height={b.height} className="aspect-[1000/561] w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-6 text-sm font-semibold">
                  {link.caption}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
