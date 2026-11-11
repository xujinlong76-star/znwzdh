import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, ListOrdered, Globe } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { JsonLd } from '@/components/json-ld'
import { loadScenes } from '@/lib/server/scenes'
import { configuredSiteOrigin } from '@/lib/seo/origin'
import { absUrl } from '@/lib/seo/json-ld'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { sceneStepHead, scenesIndexDescription } from '@/lib/seo/scene-meta'

/**
 * 场景包索引页（/scenes，服务端渲染）。
 *
 * 存在理由（SEO_PLAN §二 第一后续项）：24 个场景包此前只活在首页组件与
 * POST /api/ai/find 里，爬虫抓不到、链接没法分享，任务型搜索流量（「做 PPT
 * 的网站」「做短剧流程」）全接不住。这里把每个场景做成可索引的真实页面
 * 入口：数据全部来自中枢只读接口 GET /api/scenes，与首页场景区、AI 找站
 * 同源同口径，页面上的计数都是接口按真实召回算出来的，不写死。
 *
 * 中枢不可达时降级为说明壳并 noindex：不拿空清单冒充完整索引页。
 */

export const revalidate = 300

const INDEX_TITLE = '场景包 - 把一件事办完的网站流程'
const CANONICAL = '/scenes'
/** 中枢不可达时的通用描述（不带任何计数，与正常路径的合成口径分开） */
const FALLBACK_DESCRIPTION = '把一件事按先后顺序拆成几步，每一步都给出能直接打开的网站，照着走就能办完。'

export async function generateMetadata(): Promise<Metadata> {
  const scenes = await loadScenes(300)
  if (!scenes) {
    return {
      title: INDEX_TITLE,
      description: FALLBACK_DESCRIPTION,
      alternates: { canonical: CANONICAL },
      robots: { index: false, follow: true },
    }
  }
  const description = scenesIndexDescription({
    sceneCount: scenes.length,
    totalSites: scenes.reduce((n, s) => n + s.siteCount, 0),
    sceneTitles: scenes.map((s) => s.title),
  })
  return {
    title: INDEX_TITLE,
    description,
    alternates: { canonical: CANONICAL },
    ...(await pageShareMetadata({ url: CANONICAL, title: INDEX_TITLE, description })),
  }
}

export default async function ScenesIndexPage() {
  const scenes = await loadScenes(300)
  const origin = configuredSiteOrigin()

  return (
    <Container as="main" id="main-content">
      <div className="space-y-5 py-4 sm:space-y-6 sm:py-8">
        <Breadcrumbs
          jsonLd={Boolean(scenes)}
          items={[
            { label: '首页', path: '/' },
            { label: '场景包', path: CANONICAL },
          ]}
        />
        {origin && scenes ? (
          <JsonLd
            data={{
              '@context': 'https://schema.org',
              '@type': 'ItemList',
              name: '场景包',
              numberOfItems: scenes.length,
              itemListElement: scenes.map((s, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                name: s.title,
                url: absUrl(origin, `/scenes/${encodeURIComponent(s.id)}`),
              })),
            }}
          />
        ) : null}

        <header className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">场景包：把一件事办完的网站流程</h1>
          <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
            很多事不是打开一个网站就能办完的：做一份 PPT 要找模板、做稿件、配素材，做一部短剧要写剧本、生图、
            生成视频、配音剪辑再发布。场景包把这类事按先后顺序拆成几步，每一步都给出能直接打开的网站——
            照着走，就能把一件事从头办到尾。
          </p>
        </header>

        {scenes ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {scenes.map((scene) => {
              const heads = scene.stepLabels.map(sceneStepHead).filter(Boolean)
              return (
                <Link
                  key={scene.id}
                  href={`/scenes/${scene.id}`}
                  className="group flex flex-col rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/40"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-lg font-semibold text-foreground">{scene.title}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <span className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                    {scene.description}
                  </span>
                  {heads.length > 0 ? (
                    <span className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                      <ListOrdered className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="line-clamp-2">{heads.join(' → ')}</span>
                    </span>
                  ) : null}
                  <span className="mt-3 flex items-center gap-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                    <span>共 {scene.stepCount} 步</span>
                    {scene.siteCount > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <Globe className="h-3.5 w-3.5" />
                        {scene.siteCount} 个网站
                      </span>
                    ) : null}
                  </span>
                </Link>
              )
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-base font-medium text-foreground">场景包暂时加载不出来</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              站内数据服务暂时不可用，场景清单没能取到。你可以先回首页，用 AI 找站说一句话找网站，或从分类里慢慢逛。
            </p>
            <Link
              href="/"
              className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              回首页找站
            </Link>
          </div>
        )}
      </div>
      <Footer />
    </Container>
  )
}
