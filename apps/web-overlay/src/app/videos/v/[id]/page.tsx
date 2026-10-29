import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFileContent } from '@/lib/github'
import { safeDecodeParam } from '@/lib/server/route-params'
import { safeHref, safeSrc } from '@/lib/safe-url'
import { jsonLdScript } from '@/lib/seo/json-ld'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { configuredSiteOrigin } from '@/lib/seo/origin'
import {
  buildVideoEmbedUrlForSeo,
  enrichVideoItemSeo,
  generateVideoBreadcrumbSchema,
  generateVideoObjectSchema,
} from '@/lib/video-seo'
import { VIDEO_PLATFORM_REGISTRY } from '@/lib/video-multi-platform-harvester'
import type { NavigationData, NavigationSubItem } from '@/types/navigation'

/**
 * 视频独立 SEO 索引落地页（/videos/v/[id]）
 *
 * 设计规范：
 * 1. /videos 与 /videos/player 承载交互式工作台（保持 noindex 避免参数噪音），
 *    而每条经过质量与健康度校验的视频拥有独立的静态/ISR 语义化详情页 /videos/v/[id]，
 *    显式开启搜索引擎索引（index: true, follow: true）并输出相对自引用 canonical。
 * 2. 内联注入完整 Schema.org VideoObject（含 Clip 关键时刻、SeekToAction、InteractionCounter）
 *    与 BreadcrumbList JSON-LD 结构化数据。
 * 3. 服务端直出语义化 HTML（<h1>、课程导读、可抓取章节时间戳目录、完整逐字稿索引与同分类相关课程内链），
 *    确保 Google / Bing / 百度爬虫无需执行复杂客户端脚本即可完整收录视频正文。
 */

export const revalidate = 300

export async function generateStaticParams() {
  return []
}

interface MatchedVideoContext {
  item: NavigationSubItem
  categoryId: string
  categoryTitle: string
  subCategoryTitle?: string
  relatedItems: NavigationSubItem[]
}

async function loadVideoContext(rawId: string): Promise<MatchedVideoContext | null> {
  const safeId = safeDecodeParam(rawId)
  if (!safeId) return null

  const data = (await getFileContent('src/navsphere/content/videos.json')) as NavigationData
  const categories = data?.navigationItems || []

  for (const cat of categories) {
    const catItems: NavigationSubItem[] = [
      ...(cat.items || []),
      ...(cat.subCategories || []).flatMap((s) => s.items || []),
    ]

    for (const candidate of cat.items || []) {
      if (matchesVideoIdentifier(candidate, safeId)) {
        const enriched = enrichVideoItemSeo(candidate, cat.title)
        const related = catItems
          .filter((it) => it.id !== candidate.id && it.enabled !== false)
          .slice(0, 6)
          .map((it) => enrichVideoItemSeo(it, cat.title))
        return {
          item: enriched,
          categoryId: cat.id,
          categoryTitle: cat.title,
          relatedItems: related,
        }
      }
    }

    for (const sub of cat.subCategories || []) {
      for (const candidate of sub.items || []) {
        if (matchesVideoIdentifier(candidate, safeId)) {
          const enriched = enrichVideoItemSeo(candidate, `${cat.title} ${sub.title}`)
          const related = catItems
            .filter((it) => it.id !== candidate.id && it.enabled !== false)
            .slice(0, 6)
            .map((it) => enrichVideoItemSeo(it, cat.title))
          return {
            item: enriched,
            categoryId: cat.id,
            categoryTitle: cat.title,
            subCategoryTitle: sub.title,
            relatedItems: related,
          }
        }
      }
    }
  }

  return null
}

function matchesVideoIdentifier(item: NavigationSubItem, target: string): boolean {
  if (!item) return false
  if (item.id === target) return true
  const vc = item.videoConfig
  if (!vc) return false
  if (vc.seoSlug && vc.seoSlug === target) return true
  if (vc.bvid && vc.bvid.toLowerCase() === target.toLowerCase()) return true
  if (vc.videoId && vc.videoId === target) return true
  return false
}

function formatDurationHuman(seconds?: number): string {
  if (!seconds || seconds <= 0) return '10:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const ctx = await loadVideoContext(id)
  if (!ctx) {
    return {
      title: '未找到视频课程',
      // 路由标题守卫要求 title 与 description 同源齐备：缺描述会让分享卡片
      // 退回站点级默认文案，与「未找到」的语义对不上。
      description: '该视频课程不存在或已下架，请返回视频列表重新选择。',
      robots: { index: false, follow: false },
    }
  }

  const { item, categoryTitle } = ctx
  const vc = item.videoConfig
  const canonical = `/videos/v/${encodeURIComponent(item.id)}`
  const title = vc?.seoTitle || `${item.title} · ${categoryTitle}精选视频`
  const description =
    vc?.seoDescription ||
    item.description ||
    `${item.title}（${categoryTitle}精选视频课程，支持章节跳转与字幕检索）。`
  const isIndexable = vc?.indexable !== false && vc?.healthStatus !== 'broken' && item.enabled !== false

  return {
    title,
    description,
    keywords: vc?.seoKeywords?.join(', '),
    robots: isIndexable ? { index: true, follow: true } : { index: false, follow: true },
    alternates: { canonical },
    ...(await pageShareMetadata({
      url: canonical,
      title,
      description,
      imageUrl: item.icon || null,
      imageAlt: item.title,
    })),
  }
}

export default async function VideoSeoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await loadVideoContext(id)
  if (!ctx) notFound()

  const { item, categoryId, categoryTitle, subCategoryTitle, relatedItems } = ctx
  const vc = item.videoConfig!
  const platformMeta = VIDEO_PLATFORM_REGISTRY[vc.type] || VIDEO_PLATFORM_REGISTRY.custom
  const siteUrl = configuredSiteOrigin() || 'https://nav.example.com'
  const rawEmbedUrl = buildVideoEmbedUrlForSeo(vc)
  const embedUrl = safeSrc(rawEmbedUrl)

  const videoSchema = generateVideoObjectSchema(item, siteUrl)
  const breadcrumbSchema = generateVideoBreadcrumbSchema(item, categoryTitle, categoryId, siteUrl)

  const jsonLdPayload = {
    '@context': 'https://schema.org',
    '@graph': [videoSchema, breadcrumbSchema].filter(Boolean),
  }

  return (
    <main id="main-content" className="min-h-screen bg-slate-950 text-slate-100 py-8 px-4 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLdPayload) }}
      />

      <div className="max-w-5xl mx-auto space-y-8">
        {/* 语义化面包屑导航 */}
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <Link href="/" className="hover:text-amber-400 transition-colors">
            首页
          </Link>
          <span>/</span>
          <Link href="/videos" className="hover:text-amber-400 transition-colors">
            视频教程导航
          </Link>
          <span>/</span>
          <Link
            href={`/videos?category=${encodeURIComponent(categoryId)}`}
            className="hover:text-amber-400 transition-colors"
          >
            {categoryTitle}
          </Link>
          {subCategoryTitle ? (
            <>
              <span>/</span>
              <span className="text-slate-300">{subCategoryTitle}</span>
            </>
          ) : null}
          <span>/</span>
          <span className="text-slate-200 font-medium truncate max-w-xs" aria-current="page">
            {item.title}
          </span>
        </nav>

        {/* 主体视频文章区 */}
        <article className="rounded-2xl border border-slate-800/90 bg-slate-900/70 overflow-hidden shadow-2xl">
          {/* 顶部标题与平台元信息 */}
          <header className="p-6 sm:p-8 border-b border-slate-800/80 space-y-4">
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <span
                className="px-2.5 py-0.5 rounded-full font-semibold text-white"
                style={{ backgroundColor: platformMeta.badgeColor }}
              >
                {platformMeta.name}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300">
                {categoryTitle}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-800/80 text-slate-400">
                时长 {formatDurationHuman(vc.durationSec)}
              </span>
              {vc.qualityScore ? (
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-700/40 text-emerald-300">
                  质量评分 {vc.qualityScore}
                </span>
              ) : null}
              {vc.publishedAt ? (
                <time dateTime={vc.publishedAt} className="text-slate-400">
                  发布于 {vc.publishedAt.slice(0, 10)}
                </time>
              ) : null}
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white leading-snug">
              {item.title}
            </h1>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-1 text-sm text-slate-300">
              <div className="flex items-center gap-3">
                <span>
                  创作者：<strong className="text-white">{vc.author || platformMeta.shortName}</strong>
                </span>
                {vc.stats?.views ? (
                  <span className="text-slate-400">
                    · {vc.stats.views.toLocaleString()} 次观看
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <Link
                  href={`/videos/player?id=${encodeURIComponent(item.id)}`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors"
                >
                  进入沉浸式演播室（高清切源 / 弹幕 / 笔记）
                </Link>
                {item.href ? (
                  <a
                    href={safeHref(item.href)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-200 text-xs transition-colors"
                  >
                    前往 {platformMeta.shortName} 原站观看 ↗
                  </a>
                ) : null}
              </div>
            </div>
          </header>

          {/* 嵌入式视频预览容器 */}
          <div className="aspect-video w-full bg-black relative">
            {embedUrl ? (
              <iframe
                src={embedUrl}
                title={item.title}
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-3">
                <p className="text-sm text-slate-300">
                  该平台（{platformMeta.name}）建议在沉浸式演播室或原站打开观看
                </p>
                <Link
                  href={`/videos/player?id=${encodeURIComponent(item.id)}`}
                  className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 font-semibold text-xs"
                >
                  打开高清播放器
                </Link>
              </div>
            )}
          </div>

          {/* 课程内容摘要与 SEO 关键词标签 */}
          <div className="p-6 sm:p-8 space-y-6">
            <section aria-labelledby="video-summary-heading" className="space-y-2.5">
              <h2 id="video-summary-heading" className="text-lg font-semibold text-white">
                课程内容简介
              </h2>
              <p className="text-sm sm:text-base text-slate-300 leading-relaxed whitespace-pre-line">
                {item.description || vc.seoDescription || `${item.title} — 收录于「${categoryTitle}」专栏。`}
              </p>
            </section>

            {/* 结构化章节时间轴（Google Key Moments 对应 HTML 锚点） */}
            {Array.isArray(vc.chapters) && vc.chapters.length > 0 ? (
              <section aria-labelledby="video-chapters-heading" className="space-y-3 pt-4 border-t border-slate-800/80">
                <h2 id="video-chapters-heading" className="text-lg font-semibold text-white">
                  章节目录与关键时刻 (Key Moments)
                </h2>
                <ol className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {vc.chapters.map((ch, idx) => (
                    <li key={`${ch.time}-${idx}`}>
                      <Link
                        href={`/videos/player?id=${encodeURIComponent(item.id)}&t=${Math.max(0, Math.floor(ch.time))}`}
                        className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 transition-colors"
                      >
                        <span className="text-sm text-slate-200 font-medium truncate">
                          {idx + 1}. {ch.title}
                        </span>
                        <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 shrink-0">
                          {formatDurationHuman(ch.time)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {/* 可检索视频字幕与讲稿全文（高价值长尾词索引区） */}
            {Array.isArray(vc.transcript) && vc.transcript.length > 0 ? (
              <section aria-labelledby="video-transcript-heading" className="space-y-3 pt-4 border-t border-slate-800/80">
                <h2 id="video-transcript-heading" className="text-lg font-semibold text-white">
                  视频语音字幕与要点文稿
                </h2>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-2 text-sm text-slate-300">
                  {vc.transcript.map((line, idx) => (
                    <p key={`${line.time}-${idx}`} className="flex gap-3 leading-relaxed">
                      <span className="font-mono text-xs text-slate-400 shrink-0 pt-0.5">
                        [{formatDurationHuman(line.time)}]
                      </span>
                      <span>{line.text}</span>
                    </p>
                  ))}
                </div>
              </section>
            ) : null}

            {/* SEO 聚合关键词标签 */}
            {Array.isArray(vc.seoKeywords) && vc.seoKeywords.length > 0 ? (
              <section aria-label="课程关键词标签" className="flex flex-wrap gap-2 pt-4 border-t border-slate-800/80">
                {vc.seoKeywords.map((kw) => (
                  <span
                    key={kw}
                    className="px-2.5 py-1 rounded-md bg-slate-800/90 text-slate-300 text-xs"
                  >
                    #{kw}
                  </span>
                ))}
              </section>
            ) : null}
          </div>
        </article>

        {/* 同分类相关视频推荐（加强站内爬虫深度抓取内链） */}
        {relatedItems.length > 0 ? (
          <section aria-labelledby="related-videos-heading" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 id="related-videos-heading" className="text-lg font-semibold text-white">
                同分类相关视频推荐（{categoryTitle}）
              </h2>
              <Link
                href={`/videos?category=${encodeURIComponent(categoryId)}`}
                className="text-xs text-amber-400 hover:underline"
              >
                查看全部 {categoryTitle} 视频 →
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {relatedItems.map((rel) => {
                const relPlatform =
                  VIDEO_PLATFORM_REGISTRY[rel.videoConfig?.type || 'bilibili'] ||
                  VIDEO_PLATFORM_REGISTRY.bilibili
                return (
                  <Link
                    key={rel.id}
                    href={`/videos/v/${encodeURIComponent(rel.id)}`}
                    className="group p-4 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-amber-500/50 transition-all space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="font-medium text-slate-300">{relPlatform.shortName}</span>
                      <span>{formatDurationHuman(rel.videoConfig?.durationSec)}</span>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-100 group-hover:text-amber-300 line-clamp-2">
                      {rel.title}
                    </h3>
                    {rel.description ? (
                      <p className="text-xs text-slate-400 line-clamp-2">{rel.description}</p>
                    ) : null}
                  </Link>
                )
              })}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}
