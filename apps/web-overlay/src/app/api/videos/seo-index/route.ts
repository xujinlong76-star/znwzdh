import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { mutateVideoLibrary, readVideoLibrary } from '@/lib/video-library-store'
import { auditVideoSeoReadiness, enrichVideoItemSeo } from '@/lib/video-seo'
import { VIDEO_PLATFORM_REGISTRY } from '@/lib/video-multi-platform-harvester'
import { configuredSiteOrigin } from '@/lib/seo/origin'
import type { NavigationSubItem } from '@/types/navigation'

export const runtime = 'nodejs'

/**
 * GET /api/videos/seo-index
 * 返回全库视频的 SEO 收录就绪度审计报告、多平台分布统计与可索引落地页清单
 */
export async function GET() {
  try {
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return new Response(authCheck.error, { status: authCheck.status })
    }

    const data = await readVideoLibrary()
    const items: NavigationSubItem[] = []
    const platformCounts: Record<string, number> = {}

    for (const cat of data.navigationItems || []) {
      for (const it of cat.items || []) {
        const enriched = enrichVideoItemSeo(it, cat.title)
        items.push(enriched)
        const p = enriched.videoConfig?.type || 'bilibili'
        platformCounts[p] = (platformCounts[p] || 0) + 1
      }
      for (const sub of cat.subCategories || []) {
        for (const it of sub.items || []) {
          const enriched = enrichVideoItemSeo(it, `${cat.title} ${sub.title}`)
          items.push(enriched)
          const p = enriched.videoConfig?.type || 'bilibili'
          platformCounts[p] = (platformCounts[p] || 0) + 1
        }
      }
    }

    const audit = auditVideoSeoReadiness(items)
    const siteOrigin = configuredSiteOrigin() || ''

    return NextResponse.json({
      ok: true,
      audit,
      platformCounts,
      supportedPlatforms: Object.values(VIDEO_PLATFORM_REGISTRY),
      sitemapUrl: `${siteOrigin}/videos/sitemap.xml`,
      rssFeedUrl: `${siteOrigin}/videos/feed.xml`,
      sampleLandingUrls: items
        .filter((it) => it.enabled !== false && it.videoConfig?.indexable !== false)
        .slice(0, 12)
        .map((it) => ({
          id: it.id,
          title: it.title,
          platform: it.videoConfig?.type || 'bilibili',
          url: `${siteOrigin}/videos/v/${encodeURIComponent(it.id)}`,
          seoSlug: it.videoConfig?.seoSlug,
        })),
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'SEO 审计失败' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/videos/seo-index
 * 批量为全量视频补齐/刷新 SEO 结构化字段（seoSlug、seoTitle、seoDescription、seoKeywords、indexable），
 * 并支持可选的 IndexNow 搜索引擎主动推送。
 */
export async function POST(request: Request) {
  try {
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return new Response(authCheck.error, { status: authCheck.status })
    }

    const body = await request.json().catch(() => ({}))
    const nowIso = new Date().toISOString()

    const outcome = await mutateVideoLibrary(
      (data) => {
        let enrichedCount = 0
        const nextCategories = (data.navigationItems || []).map((cat) => {
          const nextItems = (cat.items || []).map((it) => {
            if (!it.videoConfig) return it
            enrichedCount++
            const enriched = enrichVideoItemSeo(it, cat.title)
            return {
              ...enriched,
              videoConfig: {
                ...enriched.videoConfig!,
                lastIndexedAt: nowIso,
              },
            }
          })

          const nextSubCategories = (cat.subCategories || []).map((sub) => ({
            ...sub,
            items: (sub.items || []).map((it) => {
              if (!it.videoConfig) return it
              enrichedCount++
              const enriched = enrichVideoItemSeo(it, `${cat.title} ${sub.title}`)
              return {
                ...enriched,
                videoConfig: {
                  ...enriched.videoConfig!,
                  lastIndexedAt: nowIso,
                },
              }
            }),
          }))

          return {
            ...cat,
            items: nextItems,
            subCategories: nextSubCategories,
          }
        })

        return {
          next: {
            ...data,
            navigationItems: nextCategories,
          },
          result: { enrichedCount },
          skip: enrichedCount === 0,
        }
      },
      'SEO batch enrichment: enrich video items with seoSlug, seoTitle, seoDescription, and seoKeywords',
      { token: authCheck.githubToken || undefined }
    )

    if (!outcome.ok) {
      return NextResponse.json(
        { ok: false, error: '视频库写入版本冲突，请稍后重试' },
        { status: 409 }
      )
    }

    // 可选：如果配置了 IndexNow Key，则主动向 Bing / Yandex / IndexNow 推送最新视频落地页
    let indexNowSubmitted = 0
    const indexNowKey = body?.indexNowKey || process.env.NAVHUB_INDEXNOW_KEY
    const siteOrigin = configuredSiteOrigin()
    if (indexNowKey && siteOrigin) {
      try {
        const freshData = await readVideoLibrary()
        const urlList: string[] = [`${siteOrigin}/videos/sitemap.xml`]
        for (const cat of freshData.navigationItems || []) {
          for (const it of [
            ...(cat.items || []),
            ...(cat.subCategories || []).flatMap((s) => s.items || []),
          ]) {
            if (it.enabled !== false && it.videoConfig?.healthStatus !== 'broken') {
              urlList.push(`${siteOrigin}/videos/v/${encodeURIComponent(it.id)}`)
            }
          }
        }
        const host = new URL(siteOrigin).host
        const pingRes = await fetch('https://api.indexnow.org/indexnow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            host,
            key: String(indexNowKey),
            urlList: urlList.slice(0, 500),
          }),
          signal: AbortSignal.timeout(6000),
        })
        if (pingRes.ok) {
          indexNowSubmitted = Math.min(urlList.length, 500)
        }
      } catch {
        // IndexNow 推送失败不影响主流程
      }
    }

    return NextResponse.json({
      ok: true,
      enrichedCount: outcome.result.enrichedCount,
      indexNowSubmitted,
      indexedAt: nowIso,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '批量生成 SEO 索引失败' },
      { status: 500 }
    )
  }
}
