import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { hubGet } from '@/lib/server/hub'
import { safeDecodeParam } from '@/lib/server/route-params'
import type { HubSite } from '@/lib/navhub-api'
import { TagResultsBoard } from '@/components/tag-results-board'
import { MIN_SITES_FOR_TAG_INDEX } from '@/lib/seo/thresholds'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { ogImageUrl } from '@/lib/seo/og-text'

/**
 * 标签结果页（服务端取数 + 客户端岛渲染）。
 *
 * 为什么服务端化：站点卡片标题的 `/site/{id}` 内链必须进 **SSR HTML**。
 * 改版前整页 useEffect 取数，爬虫首轮只看到骨架屏。现在服务端取数经 props
 * 下发，首帧渲染即 SSR，每个标签页 50-100 条站点内链进入 HTML——
 * 这是 `/site/{id}` 详情页除 `/sites` 目录外的第二批入链（孤岛 2163 → ≈71
 * 的关键一步）。
 *
 * limit=100 是中枢 search 的单次上限（也是「加载更多」缺失下的取数上限）：
 * 命中数超过 100 时中枢会回报 hasMore，页面据此把「共 N 个站点」改成
 * 「本页列出 N 个（可能还有更多）」，不给假总数。
 * hubGet 失败返回 null → degraded=true 交给客户端岛出降级提示 + 重试。
 *
 * revalidate=60：369 个标签页每个都直出 50-100 条站点内链（爬虫面）。
 * 带缓存后爬虫重复抓取走 Next Data Cache，不再每次打穿 hub 的 search
 * 聚合查询——这是孤岛收敛后 hub 端最大的负载来源（Phase 6a）。
 * identity 不带：公开检索即可，个性化是客户端重试时的增强项。
 */

export const revalidate = 60

/** 空参数列表 = 不在构建期枚举 369 个标签，首次请求按需生成并进 ISR 缓存 */
export async function generateStaticParams() {
  return []
}

/** 标签元信息（resolve 通道）：name 是规范名，description 为回填的标签描述 */
type TagMeta = { ok: boolean; tag: { name: string; slug: string; description: string | null } | null }

/**
 * 服务端取数（generateMetadata 与页面共用；同请求内 fetch memoization 去重）。
 *
 * 两个通道各自的角色：
 * - search hits：**存活站点数**（候选集过滤 deleted_at/enabled），是
 *   B-8 noindex 分层与 404 判定的权威口径；
 * - resolve：标签规范名与描述（82 条由 scripts/tag-descriptions.mjs 回填）。
 */
async function loadTagPage(slug: string) {
  const [res, tagRes] = await Promise.all([
    // status=active 必须下推到中枢：标签页只展示存活站点，而 limit=100 是硬上限。
    // 不带这个参数时，broken/pending 会先占掉名额，页面再过滤就可能把本来达标的
    // 标签误判成薄页（noindex），与 /api/tags 的存活计数、sitemap 门槛不同口径。
    hubGet<{ hits: Array<{ site: HubSite }>; hasMore?: boolean }>(
      '/api/search?q=&status=active&tag=' + encodeURIComponent(slug) + '&limit=100',
      60,
    ),
    hubGet<TagMeta>('/api/tags/resolve?q=' + encodeURIComponent(slug), 60),
  ])
  // 索引门槛按 **active** 站点算：broken 站点仍会出现在 search 候选集里，
  // 但它们不该为一个薄标签页凑数（实测唯一达标的标签有 2/5 是 broken）。
  const sites = (res?.hits ?? [])
    .map((h) => h.site)
    .filter((s): s is HubSite => Boolean(s))
    .filter((s) => s.status === 'active')
  return { res, sites, tagRes }
}

/**
 * 每页独立的 title/description/robots（2026-10-21 从 layout 迁到 page）。
 *
 * 为什么迁：改版前 layout 里是写死的 `title: '标签详情'`——369 个标签页
 * 共享同一个 title/description，正是方案验收表「重复 title 页面 2100 → 0」
 * 要消灭的对象。且实测 `/tags/layout.tsx` 的字符串 title 会截断根
 * title.template 向孙级传递，放 layout 里连品牌后缀都拿不到；page 级
 * metadata 不受影响（与 /sites、/site/[id] 同构）。
 *
 * B-8 薄标签分层（方案 §4.1 定稿，count 驱动、无写死名单）：
 * - 存活站点 ≥ MIN_SITES_FOR_TAG_INDEX（5）→ 默认可索引，进 sitemap；
 * - <5（含 2-4 站与 1 站）→ `noindex,follow`：页面保留、内链照常传权重，
 *   但不进搜索索引——薄内容页不与站点详情页竞争同一词；
 * - 0 站与不存在的标签 → 页面侧 notFound()（真 404，见下方）。
 * 301/410 刻意不用：标签计数随站点增删会变，noindex 是唯一可逆的处置。
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const safeSlug = safeDecodeParam(slug)
  if (!safeSlug) notFound()
  const { res, sites, tagRes } = await loadTagPage(safeSlug)
  const name = tagRes?.tag?.name ?? safeSlug
  // resolve 返回的是规范 slug：别名/原名 URL（如 /tags/AI 编程）与规范页
  // 内容完全相同，canonical 必须指向规范页，否则同一内容在两个 URL 上竞争。
  // resolve 失败（中枢抖动）时退回请求 slug，至少保持自指不串页。
  const canonicalSlug = tagRes?.tag?.slug ?? safeSlug
  // search 失败（res === null）时按可索引处理：降级渲染不该把整批标签页
  // 临时标成 noindex；只有确认了真实存活数才降档。
  const indexable = res === null || sites.length >= MIN_SITES_FOR_TAG_INDEX
  const canonical = `/tags/${encodeURIComponent(canonicalSlug)}`
  const title = `「${name}」相关站点`
  const description =
    tagRes?.tag?.description ?? `「${name}」标签下的站点列表，按收录顺序排列，可进入详情查看简介、分类与标签。`
  return {
    title,
    description,
    alternates: { canonical },
    // og/twitter 走工厂：裸 openGraph 会整体替换根层默认值（丢 image/type/site_name/locale）
    ...(await pageShareMetadata({
      url: canonical,
      title,
      description,
      // 中枢没答上来时不指动态卡（卡片拿不到真实站点数，默认品牌卡更诚实）
      ...(res === null ? {} : { imageUrl: ogImageUrl(canonical), imageAlt: `${name} · 山羊胡标签` }),
    })),
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
  }
}

export default async function TagDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const safeSlug = safeDecodeParam(slug)
  if (!safeSlug) notFound()
  const { res, sites, tagRes } = await loadTagPage(safeSlug)
  // 真 404（软 404 消灭战）：search 成功但 0 命中 = 标签无存活站点或压根
  // 不存在（方案 §4.1：两类都 404）。search **失败**（res === null）不 404——
  // 中枢挂了不该把整站标签页打成 404，降级渲染由岛负责。
  if (res !== null && sites.length === 0) notFound()
  const indexable = res === null || sites.length >= MIN_SITES_FOR_TAG_INDEX
  const name = tagRes?.tag?.name ?? safeSlug
  const canonicalSlug = tagRes?.tag?.slug ?? safeSlug
  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-5 sm:space-y-6">
        <Breadcrumbs
          jsonLd={indexable}
          items={[
            { label: '首页', path: '/' },
            { label: '标签云', path: '/tags' },
            { label: name, path: `/tags/${encodeURIComponent(canonicalSlug)}` },
          ]}
        />
        <TagResultsBoard
          slug={canonicalSlug}
          initialSites={sites}
          degraded={res === null}
          initialTruncated={Boolean(res?.hasMore)}
          tagDescription={tagRes?.tag?.description ?? null}
        />
      </div>
      <Footer />
    </Container>
  )
}
