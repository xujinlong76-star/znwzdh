import Link from 'next/link'
import { Hash, ArrowRight, Layers } from 'lucide-react'
import type { RelatedTag } from '@/lib/navhub-api'

/**
 * 标签共现「相关标签」区块（服务端渲染，链接进 SSR HTML）。
 *
 * 为什么放在标签页、且服务端化：标签页是浏览死胡同——用户看完「React」下的
 * 站点，此前没有任何路径通往「Vue / Next.js / 前端框架」。共现相关标签把
 * 同批站点同时挂的其它标签摆出来，是信息组织清晰度与导航效率最直接的补强。
 *
 * 纯展示组件、无 'use client'：链接在首帧就进 HTML，爬虫与首屏都不依赖
 * 客户端取数。真实取数在页面级 loadTagPage 用 hubGet 走中枢（与站点列表同口径），
 * 中枢不可达时 initialRelated 为 null，整块不渲染（不报错、不占位）。
 *
 * 排序即中枢返回的 sharedSites 降序；只展示名称与共享站点数，不重复标签云的
 * 热度语义，避免两套口径互相打架。
 */
export function RelatedTags({
  tagSlug,
  related,
}: {
  /** 当前标签的规范 slug，用于「查看更多」回链 /search?tag= */
  tagSlug: string
  related: RelatedTag[] | null
}) {
  if (!related || related.length === 0) return null
  return (
    <section
      aria-label="相关标签"
      className="rounded-2xl border border-border/70 glass-surface p-4 sm:p-5 space-y-3"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Layers className="h-4 w-4 text-indigo-500" strokeWidth={1.5} />
        相关标签
        <span className="text-xs font-normal text-muted-foreground">同一批站点同时收录的其它主题</span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {related.map((t) => (
          <li key={t.id}>
            <Link
              href={'/tags/' + encodeURIComponent(t.slug)}
              className="group inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-sm text-foreground/90 transition-colors hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-foreground"
              title={`${t.sharedSites} 个站点同时收录「${t.name}」`}
            >
              <Hash className="h-3.5 w-3.5 text-muted-foreground group-hover:text-indigo-500" strokeWidth={1.5} />
              {t.name}
              <span className="text-xs text-muted-foreground">{t.sharedSites}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href={'/search?tag=' + encodeURIComponent(tagSlug)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
      >
        查看「{tagSlug}」下的全部站点
        <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
      </Link>
    </section>
  )
}
