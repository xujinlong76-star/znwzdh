import type { Metadata } from 'next'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { hubGet } from '@/lib/server/hub'
import type { HubSite } from '@/lib/navhub-api'
import { pageShareMetadata } from '@/lib/seo/metadata'
import HotView from './hot-view'

/**
 * 榜单页（服务端取数 + 客户端岛）。
 *
 * 为什么服务端化：站点卡片的 `/site/{id}` 内链要进 SSR HTML；改版前整页
 * useEffect 取数，爬虫首轮只看到骨架屏。取数顺带把 metadata 从 layout
 * 收回 page（layout 只剩骨架，已删除）。
 *
 * revalidate=60：与中枢 /api/rank/* 的 maxAge 对齐；/hot 是爬虫面，
 * 缓存让重复抓取不再每次打穿中枢排序查询。
 */

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: '今日热榜',
    description: '按热度排序的热门站点与资源',
    alternates: { canonical: '/hot' },
    ...(await pageShareMetadata({ url: '/hot' })),
  }
}

export const revalidate = 60

type RankHit = { site: HubSite }

/** 两个榜单共用一次服务端取数；失败各自降级为空数组 */
async function loadHot() {
  const [trendingRes, freshRes] = await Promise.all([
    hubGet<{ hits: RankHit[] }>('/api/rank/trending?limit=30', 60),
    hubGet<{ hits: RankHit[] }>('/api/rank/new?limit=30', 60),
  ])
  const pick = (res: { hits: RankHit[] } | null): HubSite[] =>
    (res?.hits ?? []).map((h) => h.site).filter((s): s is HubSite => Boolean(s))
  return {
    trending: pick(trendingRes),
    fresh: pick(freshRes),
    degraded: trendingRes === null || freshRes === null,
  }
}

export default async function HotPage() {
  const { trending, fresh, degraded } = await loadHot()
  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-5 sm:space-y-6">
        <Breadcrumbs
          items={[
            { label: '首页', path: '/' },
            { label: '今日热榜', path: '/hot' },
          ]}
        />
        <HotView initialTrending={trending} initialFresh={fresh} degraded={degraded} />
      </div>
      <Footer />
    </Container>
  )
}
