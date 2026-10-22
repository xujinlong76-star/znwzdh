# NavHub 技术 SEO 审计与修复规格（代码级）

> 事实源 `apps/web-overlay/src/app/**`；`apps/web` 是 vendor+overlay 镜像，**patch 只写 overlay**。线上 `localhost:3000`（Next 16.4.2）+ 中枢 `:8787` 实测，结论均有 curl / file:line 支撑。

> **口径更新（2026-10-22 类目树升级）**：本文的分类口径（594 类目、462 个 <5 站点、132 个达标、门槛 5）是**旧平铺树**的历史快照，留作当时的证据，不要再据此改代码。新口径：权威树 18 根 / 215 叶（`packages/core/src/category-registry.ts`），站点只挂叶子、一级根只做导航；根与父级的站点数按后代聚合（`apps/web-overlay/src/lib/seo/category-totals.ts`）；索引门槛已分档——类目 12 / 标签 5（`apps/web-overlay/src/lib/seo/thresholds.ts`）。复核请用 [方案 V4](./SEO-OPTIMIZATION-PLAN-V4-2026-10-22.md)。

## 一、体检评分

| 维度 | 权重 | 得分 | 扣分依据（实测） |
|---|---|---|---|
| 可抓取/索引控制 | 25% | 40 | sitemap 67 条（应约 1106，`sitemap.ts:69-76` 只写 3 条）；robots 漏 9 类私密路径（`robots.ts:24`）；全站 0 个 `noindex`；`/site/<无效id>` 返回 200 |
| 页面元数据 | 20% | 28 | 1106 个详情页共用 3 组 title；0 canonical、0 metadataBase；3 个中间层 layout 打断 `title.template`；首页无 OG |
| 结构化数据 | 10% | 3 | 0 个 `application/ld+json`（唯一命中是 `admin/categories/page.tsx:132` 的导出按钮） |
| 渲染与性能 | 20% | 25 | **全站 `Cache-Control: no-store`**（`lib/storage-adapter.ts:189` 读取无 cache 选项→Next 16 默认不缓存）；首页 HTML **7.5 MB / 8.2 s**；`/site/[id]` 49 KB 空壳 |
| URL 架构 | 10% | 40 | 详情页主键 UUID；`/videos/player?id=`；无 `/category`；`categories.anchor` 实测为 `父id/子id`（含斜杠，不可作 URL 段） |
| 社交分享 | 5% | 15 | 仅 `/marketplace/[slug]` 有 OG/Twitter |
| 内容质量治理 | 10% | 20 | **462/594 个分类 <5 站点**、998/1080 个标签 <5 站点（接口可见 1079，另 1 个 0 站标签被 `/api/tags` 的 `minCount=1` 滤掉）、无任何索引门槛。（注意口径：按 `category_id ∪ sub_category_id` 双指针算，≥5 站的分类是 **132**、真·0 站点仅 **1**；只看 `category_id` 会得出 99 与 489 两个错误数） |

**总分 28 / 100（Not Ready）**。比既有方案（35）更低，因为新增两条它没看到的实测事实——**全站不可缓存**、**首页 7.5 MB**：这两条决定"服务端化 + sitemap 扩容"完成后爬虫仍会在首页耗尽预算。

## 二、问题清单
### P0 — 不修就无法被正常收录/排名

| # | 问题 | 证据 | 量化影响 |
|---|---|---|---|
| P0-1 | `/site/[id]` 纯客户端渲染，**HTML 无站点名**；无效 id 返回 **200** | `site/[id]/page.tsx:1` 为 `'use client'`，`:230` 的 `if (notFound \|\| !site)` 只是客户端分支。实测 `curl /site/0035b857-…` → 49 KB、`grep -c hey`=**0**、无 `<h1>`、`<title>` 恒为「站点详情 - NavHub 导航」；`/site/1` → **200**（中枢实际 404） | 1013 页正文为空 → 空页/软 404，整批不参与排名 |
| P0-2 | 1106 个详情页共用 3 组 title/description | `site/[id]/layout.tsx:9-12`、`tags/[slug]/layout.tsx:9-12`、`collections/[slug]/layout.tsx:9-12` 全为字面量 | 1013 站点+82 标签+4 合集 = 1106 页 title 重复 → 最多 1 页进索引 |
| P0-3 | 全站零 canonical、零 metadataBase | `grep -rn "canonical\|metadataBase" src/` 0 业务命中 | 参数变体分散权重；OG 相对 URL 解析到构建期 localhost |
| P0-4 | sitemap 只 67 条，缺 1013 站点/82 标签/4 合集 | `curl /sitemap.xml \| grep -c "<url>"` = **67**（3 静态+64 插件） | 覆盖率 ~6%，最有价值的实体页零提交 |
| P0-5 | 1020 详情页零入链（孤岛） | `navigation-card.tsx:153`（另 `:281`、`:447`）均 `<Link href={safeHref(item.href)}>` 外链；全仓指向 `/site/` 的内链仅 `search-palette.tsx:630`、`site/[id]/page.tsx:459/534`、`admin/stats/page.tsx:455`；首页页脚 9 条内链为 `/ /hot /tags /marketplace /graph /algorithms /import /custom /favorites`，**不含任何 `/site/`，也不含 `/collections`** | 无入链+不在 sitemap = 不可发现。**首页 HTML 已含 1020 个唯一 `data-navhub-site-id`**，改造成本极低 |
### P1 — 决定长尾竞争力

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| P1-1 | `title.template` 在 2 级 layout 处断链 | `tags/layout.tsx:9`、`collections/layout.tsx:9`、`marketplace/layout.tsx:5` 声明**字符串** title；`resolve-title.js:14-31` 中字符串 title 返回 `template:null`，**清空继承的模板**。实测 `/tags` →「标签总览 - NavHub 导航」而 `/tags/ai` →「标签详情」无后缀；`/marketplace/mine` 同样无后缀 | 3 个路由族共 8 页丢品牌后缀 |
| P1-2 | 全站 `Cache-Control: no-store`，ISR 无处可开 | `lib/storage-adapter.ts:189` 读取 `{method:"GET"}` 无 `next.revalidate`→Next 16 fetch 默认不缓存→根 layout 的 `generateMetadata` 让每个路由动态。实测 `/`、`/hot`、`/tags`、`/marketplace`、`/site/[id]` 全部 `no-store` | 每次抓取打穿中枢；`revalidate` 写了也不生效 |
| P1-3 | 首页 7.5 MB / 8.2 s | `curl -o /dev/null /` → size 7509959、total 8.20 s（gzip 后 406 KB，未开 br）；1020 张卡全量 SSR | LCP 与抓取预算双输 |
| P1-4 | 私密/工具页无 `noindex`，robots 漏 9 路径 | `robots.ts:24` 仅 4 条；实测 `/marketplace/installed`、`/custom`、`/import`、`/offline`、`/auth/signin`、`/favorites`、`/preferences`、`/marketplace/mine` 全 200 且**无 robots meta** | 个人化页面进索引，稀释质量分 |
| P1-5 | 零结构化数据 | 见上表 | 拿不到面包屑/列表/站内搜索框富结果 |
| P1-6 | 标签/分类页无薄内容门槛 | `tags/[slug]/page.tsx` 按 slug 直接检索，不判站点数 | 997 个 <5 站点标签会被索引（1079 标签中 ≥5 站的仅 82） |
| P1-7 | 首页不读 `?q=`，不能声明 SearchAction | `navigation-content.tsx:84-120` 全部 useState 与搜索无关 | 站内搜索框富结果缺席 |

**P2**：`/videos/player?id=` 无 canonical（`videos/player/page.tsx:31`）；首页 H1 是 `sr-only` 且只含品牌（`navigation-content.tsx:287`）；`/submit` 可索引；无可见面包屑。**平替区块不读 `site_relations`（0 行），而是从 `packages/core/src/ecosystem.ts` 的 17 条 host 键实时匹配**：区块会渲染但 **0 条内链**（种子全无 `targetSiteId`，`site/[id]:457/533` 的 `alt.targetSiteId ? <Link> : <span>` 恒走 span）；且 `github.com` 是 host 级键，**76 个 GitHub 仓库型站点被统一附上「GitLab/Gitee 平替」**（占 active 7.5%，同类错配还有 Cline/vLLM/Qwen/LangGraph）（实测 `curl /api/sites/0035b857…/relations`：HTTP 压测工具 hey 返回「GitLab 私有化代码托管」），语义错误。

## 三、修复方案
### Phase 1 · 索引地基（半天）

**1.1** 新增 `apps/web-overlay/src/lib/seo/origin.ts`

```ts
import { headers } from 'next/headers'
/** 全站绝对 URL 唯一基准；优先环境变量，且只在缺变量时才触碰 headers()，避免全站永久动态 */
export async function getSiteOrigin(): Promise<string> {
  const configured = process.env.NAVHUB_PUBLIC_URL?.replace(/\/+$/, '')
  if (configured) return configured
  const h = await headers(), host = h.get('host')
  if (!host) return 'http://localhost:3000'
  return `${(h.get('x-forwarded-proto') ?? 'http').split(',')[0]!.trim()}://${host}`
}
```

**1.2** `src/app/layout.tsx:39` 的 return 对象追加

```ts
  metadataBase: new URL(await getSiteOrigin()),
  openGraph: { type: 'website', siteName, locale: 'zh_CN', title: siteName, description: 'AI 原生的开发者网址导航',
    // public/ 下无 logo.png，只有 icons/icon-512.png（512×512，满足 ≥112×112）
    images: [{ url: '/icons/icon-512.png', width: 512, height: 512, alt: siteName }] },
  twitter: { card: 'summary', title: siteName, description: 'AI 原生的开发者网址导航' },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large' } },
```
**1.3 canonical 收敛**：只写路径交给 metadataBase，一页只一个。静默页（`/`、`/hot`、`/tags`、`/collections`、`/marketplace`）取无参自身路径，`?q=`/`?page=`/utm 全部收敛；`/site/[id]`、`/tags|collections|marketplace/[slug]` 取同路径且 slug 用 **resolve 后的规范值**（天然合并别名）；`/videos/player` 统一指向 `/videos`；私密页不写。
**1.4 noindex 策略**（Disallow 只省抓取预算，**真正不索引必须页面级 noindex**）

| 路径 | robots.txt | 页面 `robots` |
|---|---|---|
| `/admin/**`、`/api/**` | 已有 | 已有，不动 |
| `/auth/**`、`/s/**`、`/custom`、`/import`、`/offline`、`/submit`、`/videos/player` | **新增 Disallow** | ✅ 各页 metadata 加 `{index:false,follow:false}` |
| `/favorites`、`/preferences` | 已有 | ✅ 两个 layout |
| `/marketplace/mine`、`publish`、`installed`、`import` | **新增** | ✅ **只能写各自 layout，不能写 `marketplace/layout.tsx`**（会连累 `/marketplace/[slug]`） |
| 薄标签/薄分类（<5 站点） | — | ✅ 见 Phase 2（`follow:true` 保留权重流） |

`robots.ts:24` → `disallow: ['/admin','/api/','/auth/','/s/','/preferences','/favorites','/custom','/import','/offline','/submit','/videos/player','/marketplace/mine','/marketplace/publish','/marketplace/installed','/marketplace/import']`

**1.5 修 `title.template` 断链** — 新增 `src/lib/seo/brand.ts`

```ts
import { getFileContent } from '@/lib/github'
/** 与根 layout 同源（site.json），供中间层 layout 重建被清空的模板 */
export async function brandTitleTemplate(): Promise<string> {
  const site = await getFileContent<{ basic?: { title?: string } }>('src/navsphere/content/site.json')
  return '%s - ' + (site?.basic?.title ?? 'NavHub')
}
```

`tags/layout.tsx`、`collections/layout.tsx`、`marketplace/layout.tsx` 的 `export const metadata` 改为：

```ts
export async function generateMetadata(): Promise<Metadata> {
  // default 给本段 index 页；template 必须显式重建，否则会清空根模板
  return { title: { default: '标签总览', template: await brandTitleTemplate() },
    description: '按标签浏览全部站点，找到同一主题下的其它资源' }
}
```

> 品牌名仍只来自 site.json 一处，不违反 `route-titles.test.ts`。附注：`admin/layout.tsx:13` 的 `template:'%s · 管理后台'` 同样吃掉根模板（模板不叠加），后台标题实际无品牌后缀 —— 已知取舍，P2。
### Phase 2 · 三详情页服务端化 + 真 404（2 天）

**2.1** 新增 `src/lib/server/hub.ts`

```ts
const HUB_BASE = (process.env.NAVHUB_STORAGE_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/$/, '')
/** 服务端直连中枢，走 Data Cache；失败返回 null 由调用方降级，绝不阻塞渲染 */
export async function hubGet<T>(path: string, revalidate = 300): Promise<T | null> {
  try {
    const res = await fetch(HUB_BASE + path, { next: { revalidate }, headers: { accept: 'application/json' } })
    return res.ok ? ((await res.json()) as T) : null
  } catch { return null }
}
```
**2.2 `/site/[id]`**：原 `page.tsx` 整体搬到 `site-detail-client.tsx`（保留 `'use client'`，仅两处改动：`initialSite` 作 `useState` 初值、`loading` 初值改 `!initialSite`），新 `page.tsx`：

```tsx
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { hubGet } from '@/lib/server/hub'
import type { Metadata } from 'next'
import { SiteDetailClient } from './site-detail-client'
import type { HubSite } from '@/lib/navhub-api'

export const revalidate = 3600
const getSite = cache((id: string) => hubGet<HubSite>('/api/sites/' + encodeURIComponent(id), 3600))
const canon = (id: string) => '/site/' + encodeURIComponent(id)

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params, site = await getSite(id)
  const title = site?.title ? `${site.title} · 站点详情` : '站点详情'
  const description = site?.description?.trim().slice(0, 150) || '站点简介、相似推荐与生态关联'
  return { title, description, alternates: { canonical: canon(id) },
    openGraph: { type: 'website', title, description, url: canon(id) },
    ...(site ? {} : { robots: { index: false, follow: false } }) }
}

export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, site = await getSite(id)
  if (!site) notFound() // 真 404 + Next 自动输出 noindex
  return <SiteDetailClient siteId={id} initialSite={site} />
}
```

同时**删掉 `site/[id]/layout.tsx` 的 metadata 导出**（否则 layout 的字符串 title 抢走 page 的模板）。
**2.3 `/tags/[slug]`**：`/api/tags/resolve?q=` 实测可用（返回 `{ok,tag}`），`/api/tags?minCount=5` 实测正好 **82** 条。

```tsx
export const revalidate = 1800
const MIN = 5 // 与 sitemap 共用 lib/seo/thresholds.ts
const getTag = cache((s: string) => hubGet<{ tag: { slug: string; name: string } }>('/api/tags/resolve?q=' + encodeURIComponent(s), 1800))

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const tag = (await getTag(decodeURIComponent(slug)))?.tag
  const count = tag ? await countSitesForTag(tag.slug) : 0   // /api/search?tag=… 的 total，缓存 1800
  const title = tag ? `「${tag.name}」相关站点（${count}）` : '标签详情'
  const description = tag ? `收录 ${count} 个与「${tag.name}」相关的站点：官网入口、简介与同类替代方案。` : '该标签下的站点列表'
  return { title, description, alternates: { canonical: '/tags/' + encodeURIComponent(tag?.slug ?? String(slug)) },
    ...(tag && count >= MIN ? {} : { robots: { index: false, follow: true } }) } }

export default async function TagDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tag = (await getTag(decodeURIComponent(slug)))?.tag
  if (!tag) notFound() // 真 404
  if (tag.slug !== decodeURIComponent(slug)) permanentRedirect('/tags/' + encodeURIComponent(tag.slug)) // 别名 308
  return <TagDetailClient tag={tag} />
}
```

`/collections/[slug]` 同模式且更简单：`/api/collections/:slug` 实测返回 `{collection, sites}`，不存在时中枢 404 → `hubGet` 返回 null → `notFound()`。

> 三者共同约束：**client 子组件必须把首屏数据当 props 接住**（title/description/列表），否则 HTML 仍是空壳，等于没改。
### Phase 3 · sitemap 扩容（**不分片**）

**1106 条不值得分片**。门槛：单文件 >5000 URL 或生成耗时 >5 s 才拆；Google 上限 50000/50 MB，翻 20 倍也够。

```ts
export const revalidate = 3600
const MIN_SITES = 5
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await getSiteOrigin()
  const [plugins, s1, s2, s3, tags, collections] = await Promise.all([
    loadPublishedPlugins(),                                                    // 现有逻辑保留
    // status=active 必带：不带会混入 7 条 broken/pending（实测无 status 返回 1020 条）；500 分页取，单页 1000 在并发下曾 502
    hubGet<Array<{ id: string; updatedAt?: number }>>('/api/sites?status=active&limit=500&offset=0', 3600),
    hubGet<Array<{ id: string; updatedAt?: number }>>('/api/sites?status=active&limit=500&offset=500', 3600),
    hubGet<Array<{ id: string; updatedAt?: number }>>('/api/sites?status=active&limit=500&offset=1000', 3600),
    hubGet<Array<{ slug: string; count: number }>>(`/api/tags?minCount=${MIN_SITES}`, 3600),
    hubGet<Array<{ slug: string; enabled: boolean }>>('/api/collections', 3600),
  ])
  // ⚠️ 实测：/api/sites 与 /api/tags 返回**裸数组**，不是 {items,total}
  return [...staticEntries(origin), ...pluginSitemapEntries(origin, plugins),
    ...siteEntries(origin, [...(s1 ?? []), ...(s2 ?? []), ...(s3 ?? [])]),     // 1013
    ...tagEntries(origin, tags ?? []),                                        // 82
    ...collectionEntries(origin, (collections ?? []).filter(c => c.enabled))] // 4
}
```
目标条数 **≈1174** = 1013 站点 + 82 标签 + 4 合集 + 64 插件 + 10 静态（含 `/sites`，不含已 noindex 的 `/submit`）。`/category/*` 上线前不得入 sitemap；W8 上线后 **1307**。

`siteEntries/tagEntries/collectionEntries` 抽成纯函数放 `lib/seo/sitemap-entries.ts`，接 `test/sitemap.test.ts` 既有传统（去重、空 slug 跳过、时间戳非法降级）。

> 若将来真分片：`generateSitemaps` 会把 URL 变成 `/sitemap/0.xml`，而 **`/sitemap.xml` 直接 404**（`next-metadata-route-loader.js:239-274`），Next **不**自动生成索引。此时必须自写 `app/sitemap.xml/route.ts` 返回 `<sitemapindex>` 并**删除** `app/sitemap.ts`（同路径不可并存），否则 robots 的 `Sitemap:` 指向 404。
### Phase 4 · 结构化数据（禁止编造）

`src/components/seo/json-ld.tsx`（服务端组件）：`<script type="application/ld+json" dangerouslySetInnerHTML={{__html: JSON.stringify(data).replace(/</g,'\\u003c')}} />`

| 位置 | 类型 | 约束 |
|---|---|---|
| 首页 | `WebSite` + `Organization` | `SearchAction` **仅在 `?q=` 真接后才加**；`Organization.logo` 用 `/icons/icon-512.png` |
| 列表页 | `ItemList` | `numberOfItems` = 真实条数；`url` 必须指向存在的 200 页面（不能指向未建成的 `/category/*`） |
| 详情/标签/合集 | `BreadcrumbList` | 每一级 `item` 必须可访问；平替数据来自 host 键种子而非 `site_relations` 表 → **不得据此输出 `sameAs`/`isSimilarTo`**（75 个 github.com 站点的「GitLab 平替」就是错的） |
| 站点详情 / 合集 | `WebPage` / `CollectionPage` | `about` 指外部官网，`hasPart` 指已收录详情页；**不加** `aggregateRating/review/offers` |
### Phase 5 · 内链：新建 `/sites` 目录页（优于改首页卡片）

首页整卡外链**一个字不动**（一键直达是命门）。新建 `app/sites/page.tsx`（RSC）：经 `lib/server/hub.ts` 的 `hubGet('/api/sites?status=active&limit=60&offset=N')` **直连中枢**（实测裸数组、全 active、共 **17 页**，末页 53）。**注意**：`:3000/api/sites` 是 **404**（web 侧无此路由），别写成相对路径 fetch —— RSC 里相对 URL 会直接抛 `Failed to parse URL`；浏览器侧才走 `/api/hub/sites` 代理，每页 60 条标题内链 → `/site/{id}`，点击深度 2。**不要用 `/api/search?q=`**：实测返回 1020 条（含 7 条非 active）、无 `total`、offset=1013 直接报错。分页：页 1 可索引 + 自 canonical；页 ≥2 `{index:false,follow:true}` + 自 canonical（勿指回页 1）；sitemap 只放 `/sites` 一条。若最终仍要首页直链，只改标题不动整卡，三处 `<Link>`：`:153`（紧凑）/`:281`（丰富）/`:446`（标准·默认）。
### Phase 6 · 性能与 ISR 边界

| 改动 | 文件 | 说明 |
|---|---|---|
| 存储读取加缓存 | `lib/storage-adapter.ts:189` 的 init 加 `next: { revalidate: Number(process.env.NAVHUB_STORAGE_REVALIDATE ?? 30) }` | **全站 no-store 的唯一根因**，改完页面才可能静态化 |
| 首页瘦身 + 图片 | `navigation-content.tsx` 每分类默认只展开前 N 个 + 链接到详情页；`next.config.js:49-54` 生产注入 `NAVHUB_IMAGE_HOSTS` | 7.5 MB → 目标 <800 KB；**不能用 `dynamic(ssr:false)` 藏内容**，那会丢内链 |
| 可 ISR | `/site/[id]`(3600)、`/tags|collections/[slug]`(1800)、`/sitemap.xml`(3600) | 依赖第一行先落地 |
| **不能改** | `/`、`/admin/**`、`/marketplace/mine|installed`、`/favorites`、`/preferences`、`/submit` | 强即时性 / 强个性化 |

## 四、验收

```bash
curl -o /dev/null -s -w "%{http_code}\n" localhost:3000/site/1                       # 404
curl -s localhost:3000/site/0035b857-… | grep -c "轻量 HTTP 压测"                     # ≥1（正文入 HTML）
curl -s localhost:3000/site/0035b857-… | grep -o '<title>[^<]*\|rel="canonical"[^>]*' # 含「hey」+ 绝对 canonical
curl -s "localhost:3000/videos/player?id=9" | grep -o 'rel="canonical"[^>]*'          # /videos
curl -s localhost:3000/sitemap.xml | grep -c "<url>"                                  # ≥1100（含 1013 /site/）
curl -s localhost:3000/ | grep -c 'href="/site/'                                      # ≥1000
curl -s localhost:3000/tags/开源 | grep -o '<title>[^<]*'                             # 含「 - NavHub 导航」
curl -s localhost:3000/favorites | grep -o '<meta name="robots"[^>]*>'                # noindex
curl -o /dev/null -s -w "%{http_code}\n" "localhost:3000/sites?page=1"                 # 308 → /sites
curl -s localhost:3000/sites | grep -c 'href="/site/'                                  # 60（首屏 SSR 内链）
curl -o /dev/null -s -w "%{http_code}\n" "localhost:3000/api/sites?limit=1"           # 404：web 侧无此路由，务必直连中枢
```
三个模板页（`/tags/开源`、`/collections/ai-coding`、`/site/…`）的 title 必须互不相同。
图结构回归用 `node scripts/link-graph.mjs --check`（必须带 `--from-db`，否则孤岛恒为 0：入链为 0 的页面 BFS 永远走不到）；上线后应看到孤岛从 2163 降到 <40、≤2 跳可达从 0.6% 升到 >98%。

**必须新增的自动化测试**
1. `apps/web/test/seo-invariants.test.ts` 静态扫描：① 每个 `[param]` 级 `page.tsx` 必须导出 `metadata`/`generateMetadata`；② 私密路径清单的 layout/page 含 `index:false`；③ 公开路由带 `alternates.canonical` 的数量 ≥ 公开路由数；④ 任何 layout 的 `title` 若是对象且本段有子路由，必须同时有 `template`。
2. `route-titles.test.ts` 追加：**中间层 layout 的 `title` 不得为字符串且存在子路由** —— 这正是当前真实 bug，现有 309 行测试完全没覆盖。
3. `sitemap.test.ts` 追加：纯函数"裸数组输入→条目数正确 / <5 站点标签被过滤 / 重复 id 去重"。

## 五、红线

1. **不给 462 个 <5 站点分类、998 个 <5 站点标签生成可索引页面**，也不为它们建路由。分类计数必须用 `category_id ∪ sub_category_id`（站点用 sub 指叶子、category 指父级）；只看 `category_id` 会把叶子分类全判成空，得出 489/99 这种错数。
2. **不编造 `aggregateRating`/`reviewCount`/`offers`**：评分、`visit_count`、`trend_score`、`featured` 全为 0，任何"热门/评分"schema 与文案都是伪造。
3. **不把 `ecosystem.ts` 的 host 键种子当作事实**：它按 hostname 匹配，仅 `github.com` 一个键就影响 75 个仓库型站点，「GitLab 是国内快速访问的代码托管」对具体仓库是错误陈述。**修法不是"缩小键粒度"**：`ecosystem.ts` 按 URL 子串/前缀匹配，把键改成 `github.com/xxx` 仍会被 `github.com` 键拦截。必须改成**精确 URL 全等匹配**或**种子里直接写 `siteId` 白名单**（后者顺带解决 `targetSiteId` 缺失）。**优先白名单**：匹配是「首个 `includes` 命中即返回」，键序即优先级，往表里加一个短键会静默改写存量站点的归类；白名单没有顺序语义，加谁是加谁。在此之前不要据此生成 schema，也不要在 title/文案里承诺"平替"。同一函数还产出 `actions`（已渲染在首页卡片 `navigation-card.tsx:354/498/512` 与 `site-peek-dialog.tsx:139`，76 个仓库页共用 GitHub 的「搜开源库/Trending」）与 `workspaces`；`liveMetrics` 是**硬编码常量**（`cursor.com` 125000 / `excalidraw.com` 86000），且已被消费两处：① 卡片星标徽章 `navigation-card.tsx:176/304/470` 与 `site-peek-dialog.tsx:95`；② **排序权重** `lib/modular/diy-presets.ts:191` 按 `min(15, stars/1000*0.5)` 加分——`trend_score` 全为 0 时这 +15 是除置顶外最大的信号，等于用假数据把这两个站顶到 DIY 布局前列。首页 SSR 实测**未**渲染该徽章（`fill-amber-500` 0 次），故当前是"影响排序 + 待数据源触发即展示"，不是纯潜伏。
4. **不为 SEO 把卡片外链改成中转页**，只能"标题内链 + 整卡外链"并存。
5. **不把 `/category/[slug]` 建在 `categories.anchor` 上**（实测含 `/`），要做须新增 slug 字段，属数据层变更，本轮不做。
6. **不靠复制品牌字面量修 title**；**不在 `?q=` 未接通前声明 `SearchAction`**。

## 六、对既有方案 `SEO-OPTIMIZATION-PLAN-2026-10-20.md` 的勘误

| # | 原文 | 判断 | 理由 |
|---|---|---|---|
| 1 | §3.1「Next 自动生成 `/sitemap.xml` 索引」 | ❌ 错误 | `next-metadata-route-loader.js:239-274`：`generateSitemaps` 下无 id 请求返回 **404**，索引必须自写。照做 = robots 指向 404，GSC 提交失败；且 1106 条根本不需要分片 |
| 2 | §3.2 `body?.items ?? []`、`t.siteCount >= 5` | ❌ 错误 | 实测 `/api/sites`、`/api/tags` 返回**裸数组**，标签计数字段是 `count`。照抄得到 0 条站点、0 条标签的 sitemap |
| 3 | §1.1 仅用 `NAVHUB_PUBLIC_URL` 作 metadataBase；§2.2 metadata 与 page 各调一次 hubGet | ⚠️ 不完整 | 需保留 `headers()` 兜底，但必须先判断环境变量再触碰（否则全站永久动态）；未用 `cache()` 去重 → 每页 2 次中枢请求 |
| 4 | §1.3「25 个路由都有 metadata，公开页无一遗漏」 | ❌ 漏检 | 未发现字符串 title 的中间层会清空根模板（`resolve-title.js:14-31`）；实测 `/tags/ai`、`/collections/ai-coding`、`/marketplace/mine` 全丢后缀 |
| 5 | §P1-6 归因「全站 force-dynamic」 | ⚠️ 归因错 | 真因是 `storage-adapter.ts:189` 读取无缓存。不改这里，Phase 6 写的 `revalidate` 全部无效 |
| 6 | §六「热门站点 Top 20 / 按 visit_count 排序」 | ❌ 无数据 | 三字段全 0，排序随机。首批落地页只能按分类站点数（可量化）选 |
| 7 | §5.3 直接建 `/category/[slug]` | ⚠️ 风险 | `anchor` 实测为 `父id/子id`；且 `/api/categories` 不返回 siteCount，需额外聚合。应降为 P2 |
| 8 | §P0-2「2104 页共用 3 个 title」；§七「4 周索引 ≥1000」 | ⚠️ 自相矛盾 / 过乐观 | 它自己认定只有 82 个标签可索引，应为 **1106**；新域名 + 1013 同构页，建议改"4 周 ≥300、8 周 ≥1000" |
| 9 | 全案未提 | ❌ 遗漏 | ① 首页 7.5 MB/8.2 s；② 全站 `no-store`；③ 首页 HTML 已含 1020 个 site id（内链改造是"一个组件"而非架构重构）；④ 无 `logo.png`，Organization.logo 只能用 icon-512；⑤ `ResourceCard.tsx:25` 在 overlay 已不存在，外链卡片实际 3 处均在 `navigation-card.tsx:153/281/447` |

## 七、如果只做 3 件事

1. **`/site/[id]` 服务端化 + 真 404 + 页面级 metadata/canonical**（Phase 2.2）。1013 页当前正文为空、标题重复、无效 id 返回 200；这是唯一"改完可索引页面从 ~67 变 ~1100"的改动，其它优化都以它为前提。
2. **新建 `/sites` 目录页 + sitemap 补实体**（Phase 5 + 3）。服务端化只解决"能被索引"，内链 + sitemap 才解决"能被发现"；`/sites` 一个文件让 1013 个详情页全部获得入链且首页一字不改，比改 1020 张卡片干净。合计 <1 天，覆盖 P0-1/4/5。
3. **修 `lib/storage-adapter.ts:189` 缓存 + 收窄首页 DOM**（Phase 6 前两项）。不修这条，前两件做完仍每次抓取打穿中枢、首页 8.2 秒才传完，爬虫配额与 LCP 会吃掉全部收益。唯一跨全站杠杆点：一行 fetch 选项 + 一次首页折叠。
