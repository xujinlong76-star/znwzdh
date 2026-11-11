import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight, ExternalLink, PlayCircle } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { JsonLd } from '@/components/json-ld'
import { loadSceneDetail, loadScenes, type HubSceneDetail } from '@/lib/server/scenes'
import { safeDecodeParam } from '@/lib/server/route-params'
import { configuredSiteOrigin } from '@/lib/seo/origin'
import { itemListLd } from '@/lib/seo/json-ld'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { ogImageUrl } from '@/lib/seo/og-text'
import { safeHref } from '@/lib/safe-url'
import { sceneMetaDescription, sceneMetaTitle } from '@/lib/seo/scene-meta'

/**
 * 场景落地页（/scenes/{id}，服务端渲染 + 按需 ISR）。
 *
 * 页面内容就是场景的真东西：编辑好的场景说明、按定义顺序的步骤、每一步
 * 中枢按与 AI 找站同一套检索真实召回的站点（跨步去重）。爬虫与用户看到
 * 的是同一份 HTML；想动手办这件事的人点「用 AI 按这个场景找站」回首页，
 * 场景会自动展开（/?scene={id}#ai-finder）。
 *
 * 404 纪律与分类/合集页一致：只有中枢明确回 404 才 notFound()；
 * 中枢不可达是降级渲染（通用元数据 + 说明壳），不把抖动误伤成 404。
 * revalidate=60 与中枢场景接口的 maxAge 对齐。
 */

export const revalidate = 60

export async function generateStaticParams() {
  const scenes = await loadScenes(3600)
  if (!scenes) return []
  return scenes.map((s) => ({ id: s.id }))
}

function sceneCanonical(id: string): string {
  return `/scenes/${encodeURIComponent(id)}`
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const safeId = safeDecodeParam(id)
  if (!safeId) notFound()
  const probe = await loadSceneDetail(safeId)
  if (probe.status === 'miss') notFound()
  if (probe.status !== 'ok') {
    // 取数失败：通用元数据（标题与索引页区分），不从 URL 段编造场景名/计数
    return {
      title: '场景包详情',
      description: '按步骤把一件事办完的网站流程：每一步都给能直接打开的网站。',
      alternates: { canonical: sceneCanonical(safeId) },
    }
  }
  const scene = probe.data.scene
  const canonical = sceneCanonical(scene.id)
  const title = sceneMetaTitle(scene.title)
  const description = sceneMetaDescription({
    title: scene.title,
    description: scene.description,
    stepCount: scene.steps.length,
    siteCount: scene.siteCount,
    stepLabels: scene.steps.map((s) => s.label),
    topSiteTitles: scene.steps.flatMap((s) => s.sites.map((x) => x.title)).slice(0, 3),
  })
  return {
    title,
    description,
    alternates: { canonical },
    ...(await pageShareMetadata({ url: canonical, title, description, imageUrl: ogImageUrl(canonical) })),
  }
}

export default async function SceneDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const safeId = safeDecodeParam(id)
  if (!safeId) notFound()
  const probe = await loadSceneDetail(safeId)
  if (probe.status === 'miss') notFound()

  const origin = configuredSiteOrigin()
  const ok = probe.status === 'ok'
  const scene: HubSceneDetail | null = ok ? probe.data.scene : null
  const degraded = ok ? probe.data.degraded : null
  const summaries = ok ? await loadScenes(300) : null
  const siblings = (summaries ?? []).filter((s) => s.id !== safeId).slice(0, 8)
  const allSites = scene ? scene.steps.flatMap((s) => s.sites) : []

  return (
    <Container as="main" id="main-content">
      <div className="space-y-5 py-4 sm:space-y-6 sm:py-8">
        <Breadcrumbs
          jsonLd={ok}
          items={[
            { label: '首页', path: '/' },
            { label: '场景包', path: '/scenes' },
            { label: scene?.title ?? '场景详情', path: sceneCanonical(safeId) },
          ]}
        />
        {origin && scene ? (
          <JsonLd
            data={itemListLd(
              origin,
              allSites.map((site) => ({ id: site.siteId, title: site.title })),
              `「${scene.title}」配套网站`,
            )}
          />
        ) : null}

        {scene ? (
          <>
            <header className="space-y-3">
              <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{scene.title}：全流程网站与步骤</h1>
              <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">{scene.description}</p>
              <p className="text-sm text-muted-foreground">
                共 {scene.steps.length} 步 · 本页列出 {scene.siteCount} 个能直接打开的网站（按站内真实收录匹配）
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/?scene=${encodeURIComponent(scene.id)}#ai-finder`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
                >
                  <PlayCircle className="h-4 w-4" />
                  用 AI 按这个场景找站
                </Link>
                <span className="text-xs text-muted-foreground">回首页后会自动展开这个场景，也可以直接照下面的步骤自己打开网站。</span>
              </div>
            </header>

            {degraded ? (
              <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground">
                站内检索刚刚出了点问题，下面列出的站点可能不全；过一会儿刷新本页，或回首页用 AI 找站再试一次。
              </p>
            ) : null}

            <div className="space-y-6">
              {scene.steps.map((step) => (
                <section key={step.label} aria-label={step.label} className="space-y-3">
                  <h2 className="text-lg font-semibold text-foreground">{step.label}</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {step.sites.map((site) => (
                      <article key={site.siteId} className="flex flex-col rounded-2xl border border-border bg-card p-4">
                        <Link
                          href={`/site/${site.siteId}`}
                          className="text-base font-semibold text-foreground underline-offset-4 hover:underline"
                        >
                          {site.title}
                        </Link>
                        <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">{site.reason}</p>
                        {site.description ? (
                          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{site.description}</p>
                        ) : null}
                        <a
                          href={safeHref(site.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex min-h-10 w-fit items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-foreground"
                        >
                          打开网站
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {siblings.length > 0 ? (
              <section aria-label="其他场景" className="space-y-3 border-t border-border pt-5">
                <h2 className="text-lg font-semibold text-foreground">其他场景</h2>
                <div className="flex flex-wrap gap-2">
                  {siblings.map((s) => (
                    <Link
                      key={s.id}
                      href={`/scenes/${s.id}`}
                      className="inline-flex min-h-10 items-center gap-1 rounded-full border border-border bg-card px-3.5 text-sm text-foreground transition-colors hover:border-primary/50"
                    >
                      {s.title}
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </Link>
                  ))}
                  <Link
                    href="/scenes"
                    className="inline-flex min-h-10 items-center rounded-full border border-primary/40 bg-primary/5 px-3.5 text-sm font-medium text-foreground"
                  >
                    全部场景包
                  </Link>
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <div className="rounded-2xl border border-border bg-card p-5">
            <h1 className="text-xl font-semibold text-foreground">这个场景暂时加载不出来</h1>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              站内数据服务暂时不可用，场景内容没能取到。可以先去场景包总览看看，或回首页用一句话找网站。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/scenes"
                className="inline-flex min-h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                看全部场景包
              </Link>
              <Link
                href="/"
                className="inline-flex min-h-10 items-center rounded-xl border border-border px-4 text-sm font-medium text-foreground"
              >
                回首页找站
              </Link>
            </div>
          </div>
        )}
      </div>
      <Footer />
    </Container>
  )
}
