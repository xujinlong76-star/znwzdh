# NavHub 全站 SEO 优化方案（代码级）

> 扫描范围：`apps/web`（Next.js 16.4.2 App Router + React 19）全量前端代码、`apps/api` 路由清单、`data/navhub.db` 实库统计
> 扫描日期：2026-10-20
> 结论先行：**骨架是有的（robots / sitemap / manifest / title.template / skip-link 都做了），但索引体系只覆盖了站内可索引资产的 2.5%，且动态页标题全站重复、零 canonical、零结构化数据、1020 个站点详情页是内链孤岛。现在能收录首页，但完全吃不到长尾。**

> **口径更新（2026-10-22 类目树升级）**：本文的分类口径（594 类目、≥5 站点仅 99/132 个、门槛 `MIN_SITES_FOR_INDEX = 5`）是**旧平铺树**的历史快照，留作当时的证据，不要再据此改代码。新口径：权威树 18 根 / 215 叶（`packages/core/src/category-registry.ts`），站点只挂叶子、一级根只做导航；根与父级的站点数按后代聚合（`apps/web-overlay/src/lib/seo/category-totals.ts`）；索引门槛已分档——类目 12 / 标签 5（`apps/web-overlay/src/lib/seo/thresholds.ts`）。复核请用 [方案 V4](./SEO-OPTIMIZATION-PLAN-V4-2026-10-22.md)。

---

## 一、现状盘点

### 1.1 内容资产（实测自 `data/navhub.db`）

| 资产 | 数量 | 有独立 URL | 有描述 | sitemap 覆盖 |
|---|---|---|---|---|
| 站点 sites | 1020 | ✅ `/site/[id]`（UUID） | 1020/1020 有中文 description | ❌ 0 |
| 分类 categories | 594（启用） | ❌ **无分类路由** | — | ❌ 0 |
| 标签 tags | 1080 | ✅ `/tags/[slug]` | **0/1080 有 description** | ❌ 0 |
| 合集 collections | 4 | ✅ `/collections/[slug]` | 4/4 | ❌ 0 |
| 插件 plugins | 64 | ✅ `/marketplace/[slug]` | 有 | ✅ 64 |
| 静态入口 | 3 | `/`、`/marketplace`、`/hot` | — | ✅ 3 |

**sitemap 实际提交 67 条，理论可提交 2651+ 条，覆盖率 2.5%。**

### 1.2 关键薄内容分布（决定了后文所有阈值）

| 维度 | 分布 |
|---|---|
| 分类 | **489/594 个分类下 0 个站点**；≥5 站点的仅 99 个；≥10 站点的 63 个；3-4 站点 3 个；1-2 站点 3 个 |
| 标签 | `开源`(123) / `国产`(34) / `轻量`(22) / `中文`(20)… 极度长尾；**≥5 站点仅 82 个，≥3 站点仅 203 个**，其余 ~900 个标签只有 1-2 个站点 |
| 分类 anchor | 106/594 的 anchor 等于 UUID（如 `8378e6ac-…`），仅 5 个顶层分类是 `cat-ai` 这类可读字符串 |

> **这条是全案最重要的输入**：如果为 594 个分类和 1080 个标签无脑生成页面，会产生 **1574 个薄内容/空页面**，直接拖垮整站质量分。方案里所有"要不要索引"的判断都由此推导。

### 1.3 已有的 SEO 基建（值得保留，不要推翻）

- `src/app/robots.ts`、`src/app/sitemap.ts`、`src/app/manifest.ts`（均按请求推导 origin，自托管友好）
- `layout.tsx` 的 `title.template = '%s - 站点名'`，子页面只写页面名（正确地避免了品牌名重复两次）
- 25 个路由都有 metadata 导出，公开页面无一遗漏
- 首页 `<h1 className="sr-only">`、skip-link、`prefers-reduced-motion`（无障碍与大纲结构是 SEO 的正相关项）
- `marketplace/[slug]/` 是全站唯一做了 `openGraph` + `twitter` + `opengraph-image.tsx` 的页面，可作范本

---

## 二、体检评分

| 维度 | 权重 | 得分 | 说明 |
|---|---|---|---|
| 可抓取与索引控制 | 20% | 45 | robots 有但漏 8 类私密路径；sitemap 覆盖 2.5%；零 noindex |
| 页面级元数据 | 20% | 30 | template 正确，但动态详情页标题/描述全站重复，零 canonical，无 metadataBase |
| 结构化数据 | 15% | 5 | 全站零 JSON-LD（仅 admin 有个导出按钮用到 `ld+json` 字符串） |
| 渲染与性能 | 15% | 50 | 首页可 SSR；但全站 `force-dynamic` + 适配器 `no-store`，TTFB 承压 |
| URL 架构 | 10% | 40 | 主键是 UUID 进 URL；播放页用 `?id=`；594 个分类无 URL |
| 社交与分享 | 10% | 20 | 仅插件详情页有 OG 卡 |
| 内容质量治理 | 10% | 30 | 489 个空分类 + ~900 个无描述薄标签，无任何门槛过滤 |

### **总分：35 / 100（Needs Major Work）**

---

## 三、问题清单（P0 / P1 / P2）

### P0 — 直接影响收录量与排名，第 1-2 周必须修

| # | 问题 | 证据 | 量化影响 |
|---|---|---|---|
| P0-1 | **sitemap 覆盖率 2.5%** | `src/app/sitemap.ts:48-53` 只写死 `/`、`/marketplace`、`/hot` 三条静态条目 + 插件分页 | 1020 站点页 + 594 分类 + 1080 标签 + 4 合集共 2698 个 URL 从未被提交 |
| P0-2 | **动态详情页标题全站重复** | `site/[id]/layout.tsx` 固定 `title: '站点详情'`、`description: '站点简介、相似推荐与生态关联'`；`tags/[slug]/layout.tsx` 固定「标签详情」；`collections/[slug]/layout.tsx` 固定「合集详情」 | 2104 个可索引页面共用 3 个 title，等于把长尾词全部放弃 |
| P0-3 | **全站零 canonical** | `grep "alternates\|canonical"` 在 `src/app/` 下无业务命中（唯一命中是 `api/website-metadata` 解析第三方页面） | 分页/筛选/参数变体 URL 会分散权重；UUID 页与未来的 slug 页会双索引 |
| P0-4 | **软 404** | `site/[id]/page.tsx:230` 是 `if (notFound \|\| !site)` 的**客户端 state 分支**；`page.tsx` 第 1 行即 `'use client'` | 无效 id 返回 HTTP 200 + 空壳 HTML，搜索引擎判定软 404 累积后降低整站信任分 |
| P0-5 | **未设置 metadataBase** | 全仓 `grep metadataBase` 0 命中 | 新增 canonical/OG 的相对 URL 无法解析成绝对地址；Next 会退化为构建期 localhost |
| P0-6 | **私密页无任何索引隔离** | 全站 `grep "robots:"` 0 命中；`src/app/robots.ts:24` 仅 `disallow: ['/admin','/api/','/preferences','/favorites']` | `/marketplace/mine`、`/marketplace/publish`、`/marketplace/installed`、`/custom`、`/import`、`/offline`、`/auth/*` 均可被索引 |
| P0-7 | **1020 个站点详情页是内链孤岛** | `components/navigation-card.tsx:152` 卡片 `<Link href={safeHref(item.href)} target="_blank">` 直接外链；`ResourceCard.tsx:25` 同理。全仓指向 `/site/` 的内部链接**只有 3 处**：`search-palette.tsx:630`（搜索面板关系卡）、`site/[id]/page.tsx:459/534`（平替/生态链）、`admin/stats/page.tsx:455`（后台） | 1020 个页面既不在 sitemap 也没有入链，等于"不可发现" |

### P1 — 3-4 周修，决定长尾竞争力

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| P1-1 | 零 JSON-LD | `grep "application/ld+json"` 仅 `admin/categories/page.tsx:132` | 拿不到富摘要：站内搜索框、面包屑、列表结构化结果全部缺席 |
| P1-2 | 首页 `/site` 页 `/tags` 页无 OG 卡 | 全站仅 `marketplace/[slug]/layout.tsx:52` 有 openGraph/twitter | 微信/知乎/Discord 分享无卡片，损失社交流量 |
| P1-3 | 594 个分类无独立 URL | `src/app/` 下无 `category/` 目录 | 分类是导航站最强的聚合落地页形态，现在完全放弃；489 个空分类还顺手挡住了"该做但没做"的判断 |
| P1-4 | 分类 anchor 大概率不可读 | 106/594 anchor == UUID | 出现 `/category/8378e6ac-7dd3-4c4a-b96a-c1ecb5456688` 这种 URL，无法被搜索理解 |
| P1-5 | 标签/分类页无薄内容门槛 | 无任何阈值逻辑 | ~900 个 1-2 站点标签页会被索引 |
| P1-6 | 全站 `force-dynamic` + 无缓存层 | `page.tsx`、`videos/page.tsx`、`videos/player/page.tsx`、`submit/page.tsx`、`sitemap.ts` 均 `force-dynamic`；`lib/storage-adapter.ts:247` 为 `cache: "no-store"` | 每次爬虫请求都打穿中枢，LCP/TTFB 随风飘；爬虫抓取配额被无谓消耗 |
| P1-7 | 首页不支持 `?q=` | `grep searchParams/useSearchParams` 在首页链路 0 命中 | 无法声明合法的 `WebSite.SearchAction`，拿不到站内搜索框富摘要 |

### P2 — 体验与长线

- `videos/player/page.tsx` 用 `?id=` 定位内容，产生重复 URL 且无 canonical 收敛
- 首页 H1 `sr-only` 视觉隐藏，且取的是后台配置原文，未做长度控制
- `next.config.js` 的 `images.remotePatterns` 默认放开 `https://**`，任意站点图片都可经 `/ _next/image` 代理，消耗带宽与缓存配额
- 无面包屑导航 UI（站点详情只有"返回"按钮），缺失信息架构信号
- `sites.title_en` / `description_en` 字段已存在但无 `hreflang` 方案，未来做英文版会双索引

## 四、落地方案（6 个阶段，附可粘贴代码）

### Phase 1（第 1 周）索引地基

**目标：让搜索引擎对"哪些页面存在、哪些不该收录、唯一地址是什么"有确定答案。**

#### 1.1 设置 metadataBase（`src/app/layout.tsx`）

```ts
return {
  // 所有相对 URL（canonical / og:image）的解析基准。
  // 自托管换域名只改这一个环境变量。
  metadataBase: new URL(process.env.NAVHUB_PUBLIC_URL ?? 'http://localhost:3000'),
  title: { default: siteName, template: '%s - ' + siteName },
  description: 'AI 原生的开发者网址导航：中文语义检索、拼音混合召回、Bento 自由排版工作台',
};
```

> 配套：compose / Dockerfile 注入 `NAVHUB_PUBLIC_URL=https://你的域名`，localhost 仅作兜底。

#### 1.2 统一 canonical 策略

原则：**每个可索引页面自报 canonical**，一律写相对路径（交给 metadataBase 解析），业务代码里不拼域名。私密页同时加 `robots:{index:false}`，此时 canonical 无意义可省。

```ts
// 静态页
export const metadata: Metadata = {
  title: '标签总览',
  description: '按标签浏览全部站点，找到同一主题下的其它资源',
  alternates: { canonical: '/tags' },
};
// 动态页
alternates: { canonical: `/site/${encodeURIComponent(id)}` },
```

#### 1.3 noindex 策略表

robots.txt 只是"不抓"，页面仍可能以纯 URL 进索引；**真正不索引必须在页面写 `robots: { index:false, follow:false }`**。

| 路径 | robots.txt | 页面 noindex |
|---|---|---|
| `/admin/**`、`/api/**` | Disallow（已有） | ✅ |
| `/auth/**` | **Disallow（新增）** | ✅ |
| `/preferences`、`/favorites` | Disallow（已有） | ✅ |
| `/marketplace/mine`、`publish`、`installed`、`import` | **Disallow（新增）** | ✅ |
| `/custom`、`/import`、`/offline`、`/videos/player`、`/s/**` | **Disallow（新增）** | ✅ |
| 薄标签页（站点数 <5）、薄分类页（站点数 <5） | — | ✅（见 §五） |

```ts
// src/app/robots.ts
disallow: [
  '/admin', '/api/', '/auth/', '/preferences', '/favorites',
  '/custom', '/import', '/offline', '/s/', '/videos/player',
  '/marketplace/mine', '/marketplace/publish',
  '/marketplace/installed', '/marketplace/import',
],
```

### Phase 2（第 2 周）动态详情页 metadata 服务端化

**核心思路：把 `page.tsx` 从「客户端组件」改成「服务端组件 + 客户端子组件」。** 交互逻辑整体下沉到子组件，UI 零改动，metadata 立刻有地方生成。

#### 2.1 先加服务端 hub 取数封装

`lib/navhub-api.ts` 的 `fetchSite()` 走相对路径，是给浏览器用的；服务端需要绝对地址 + Next Data Cache。

```ts
// src/lib/server/hub.ts
const HUB_BASE = (
  process.env.NAVHUB_STORAGE_BASE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:8787'
).replace(/\/$/, '');

/** 服务端直连中枢，走 Next Data Cache。失败返回 null，调用方自行降级。 */
export async function hubGet<T>(path: string, revalidateSeconds = 300): Promise<T | null> {
  try {
    const res = await fetch(`${HUB_BASE}${path}`, {
      next: { revalidate: revalidateSeconds },
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
```

#### 2.2 `/site/[id]` 改造（消灭 P0-2 / P0-4）

```tsx
// src/app/site/[id]/page.tsx  ← 删掉 'use client'，改为服务端组件
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { hubGet } from '@/lib/server/hub';
import { SiteDetailClient } from './site-detail-client'; // 原 page.tsx 原样搬入，保留 'use client'

export const revalidate = 3600; // 站点信息变化不频繁，用 ISR 替代 force-dynamic

interface HubSiteLike {
  title: string;
  description?: string;
  url?: string;
  categoryTitle?: string;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const site = await hubGet<HubSiteLike>(`/api/sites/${encodeURIComponent(id)}`);
  if (!site?.title) {
    return { title: '页面不存在', robots: { index: false, follow: false } };
  }
  const desc = (site.description ?? `NavHub 收录的 ${site.title} 详情、平替方案与同生态工具`).slice(0, 75);
  return {
    title: `${site.title}：${site.categoryTitle ?? '收录详情'}`,
    description: desc,
    alternates: { canonical: `/site/${encodeURIComponent(id)}` },
    openGraph: {
      title: `${site.title} - NavHub 导航`,
      description: desc,
      type: 'website',
      url: `/site/${encodeURIComponent(id)}`,
    },
  };
}

export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const site = await hubGet<HubSiteLike>(`/api/sites/${encodeURIComponent(id)}`);
  if (!site?.title) notFound(); // 真 404 状态码，消灭软 404
  return <SiteDetailClient initialSite={site} siteId={id} />;
}
```

同时删掉 `site/[id]/layout.tsx` 里的静态 metadata（标题让位给 page 层），保留 layout 的壳。`/tags/[slug]`、`/collections/[slug]` 套同一模式：先 resolve 出 slug 对应实体，取不到就 `noindex`。

#### 2.3 标题公式（永久告别全站重复）

| 页面 | title 公式 | description 公式 |
|---|---|---|
| 站点详情 | `{站点名}：{分类名}` | `{站点 description} 另附平替方案与同生态工具。` |
| 标签页 | `{标签}相关的开发工具与资源` | `共 {N} 个与「{标签}」相关的精选站点。` |
| 合集页 | `{合集名}` | `{合集 description}` |
| 分类页 | `{分类名}工具导航` | `{N} 个精选{分类名}工具，按热度与口碑排序。` |

> 规范沉淀：**`use client` 组件永不承担 SEO 责任**，所有按参数变化的元信息一律下沉到服务端页面层。

### Phase 3（第 3 周）sitemap 扩容 + 分片

**把 67 条扩到 ~1100 条，并让 sitemap 不再每次自请求打穿中枢。**

#### 3.1 用 `generateSitemaps` 做官方分片

Next.js App Router 原生支持多 sitemap，会自动生成 `/sitemap.xml` 索引。分片方案（每片远低于 50000 URL / 50MB 上限）：

| 分片 id | 内容 | 预估条数 |
|---|---|---|
| `0` 核心 | `/`、`/marketplace`、`/hot`、`/tags`、`/collections`、`/graph`、`/algorithms`、`/videos` + 64 插件 | ~72 |
| `1` 站点 | 1020 个 `/site/{id}` | 1020 |
| `2` 分类 | 99 个达标分类 | 99 |
| `3` 标签 | 82 个达标标签 | 82 |
| `4` 合集 | 4 个合集 | 4 |

```ts
// src/app/sitemap.ts
import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { hubGet } from '@/lib/server/hub';

export const revalidate = 3600; // 让 CDN / Next 缓存，爬虫不必每次打穿中枢

/** 索引门槛：低于这个站点数的分类/标签一律不进 sitemap，且页面侧同步 noindex */
const MIN_SITES_FOR_INDEX = 5;

interface Paged<T> { items?: T[]; total?: number }

export async function generateSitemaps() {
  return [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const h = await headers();
  const host = h.get('host');
  if (!host) return [];
  const proto = (h.get('x-forwarded-proto') ?? 'https').split(',')[0]!.trim();
  const origin = `${proto}://${host}`;

  if (id === 0) return coreEntries(origin);
  if (id === 1) return siteEntries(origin);
  if (id === 2) return categoryEntries(origin);
  if (id === 3) return tagEntries(origin);
  return collectionEntries(origin);
}
```

#### 3.2 三个实体分片的数据取法

```ts
async function siteEntries(origin: string): Promise<MetadataRoute.Sitemap> {
  // /api/sites 的 limit 上限是 1000（apps/api/src/routes/sites.ts:36），1020 条需翻两页
  const out: MetadataRoute.Sitemap = [];
  for (let offset = 0; offset < 1020; offset += 500) {
    const body = await hubGet<Paged<{ id: string; updated_at: number }>>(
      `/api/sites?limit=500&offset=${offset}&status=active`,
    );
    for (const s of body?.items ?? []) {
      out.push({
        url: `${origin}/site/${encodeURIComponent(s.id)}`,
        lastModified: new Date(s.updated_at),
        changeFrequency: 'weekly',
        priority: 0.6,
      });
    }
  }
  return out;
}

async function tagEntries(origin: string): Promise<MetadataRoute.Sitemap> {
  const tags = await hubGet<Array<{ slug: string; siteCount: number; updated_at?: number }>>('/api/tags');
  return (tags ?? [])
    .filter((t) => t.siteCount >= MIN_SITES_FOR_INDEX && t.slug)
    .map((t) => ({
      url: `${origin}/tags/${encodeURIComponent(t.slug)}`,
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    }));
}
```

分类分片需要新增 `/api/categories/with-counts`（或复用 `listCategories()` 后按 `category_id` 聚合），只输出 `enabled=1` 且站点数 ≥5 的 99 条。

#### 3.3 顺带修掉的性能问题

- 旧实现每次爬虫请求都 `fetch(${origin}/api/hub/plugins)` 翻最多 50 页 —— 新方案加 `revalidate = 3600`，并改为按分片只取自己那一份数据。
- 已有 `test/sitemap.test.ts` 单测覆盖 `pluginSitemapEntries`，新版把「阈值过滤 / 去重 / 时间戳降级」抽成纯函数继续单测，保持这个好传统。

### Phase 4（第 4 周）结构化数据（JSON-LD）

**目标富摘要：站内搜索框、面包屑路径、列表条目。** 先说红线：**绝对不要编造 `aggregateRating` / `reviewCount`**。导航站的评分数据不可信，Google 对虚假评分会直接人工处罚，收益远小于风险。

#### 4.1 通用注入组件

```tsx
// src/components/json-ld.tsx（服务端组件，无 'use client'）
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
```

#### 4.2 首页：WebSite + SearchAction（需先补 `?q=` 支持）

前置条件：首页目前**不读 `?q=`**（`grep searchParams` 在首页链路 0 命中）。若不先补这个，`SearchAction` 声明的地址是无效的，属于欺骗性标注。补法：

```tsx
// src/app/page.tsx（已是服务端组件，直接加）
export default async function HomePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { navigationData, siteData } = await getData();
  return (
    <>
      <NavigationContent
        navigationData={navigationData}
        siteData={siteData}
        initialQuery={q ?? ''}   // NavigationContent 里把 searchQuery 的初始值换成这个 prop
      />
      <ScrollToTop />
    </>
  );
}
```

```tsx
// 首页注入
<JsonLd data={{
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: siteData.basic.title,
  url: origin,
  description: siteData.basic.description,
  potentialAction: {
    '@type': 'SearchAction',
    target: { '@type': 'EntryPoint', urlTemplate: `${origin}/?q={search_term_string}` },
    'query-input': 'required name=search_term_string',
  },
}} />
```

#### 4.3 全站：BreadcrumbList

站点详情页 / 分类页 / 标签页统一挂面包屑（同时见 Phase 5.3 的可见面包屑，两者数据同源）：

```tsx
<JsonLd data={{
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: '首页', item: origin },
    { '@type': 'ListItem', position: 2, name: site.categoryTitle, item: `${origin}/category/${site.categoryAnchor}` },
    { '@type': 'ListItem', position: 3, name: site.title },
  ],
}} />
```

#### 4.4 列表页：ItemList

分类页 / 标签页 / 合集页渲染站点列表时输出 ItemList，有机会拿到列表型富结果：

```tsx
<JsonLd data={{
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: `${categoryTitle}工具导航`,
  numberOfItems: sites.length,
  itemListElement: sites.slice(0, 30).map((s, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: s.title,
    url: `${origin}/site/${s.id}`,
  })),
}} />
```

#### 4.5 组织级：Organization（首页一次）

`name` / `url` / `logo`（用 `public/logo.png`）。插件详情页已有 OG 图，可复用 `logo` 作 `publisher`。

### Phase 5（第 5-6 周）内链架构重构

**这是投入产出比最高的一块：现在 1020 个详情页 100% 不可被发现。**

#### 5.1 现状：孤岛的形成机制

`components/navigation-card.tsx:152` 与 `ResourceCard.tsx:25` 都渲染成：

```tsx
<Link href={safeHref(item.href)} target="_blank" rel="noopener noreferrer">
```

即**整个卡片就是一个外链**。爬虫从首页出发，走到的全部是第三方站点，永远不会进入 `/site/[id]`。而全仓指向 `/site/` 的内部链接只剩 3 处（`search-palette.tsx:630`、`site/[id]/page.tsx:459/534`、`admin/stats/page.tsx:455`），且都在不抓取的深层。

#### 5.2 卡片双模式：保留一键直达，同时暴露内链

不要破坏"点了就去目标站"这个核心体验。改成：**整卡仍是外链（可点区域不变），但在卡片角落增加一个独立的站内详情入口**，并把站点标题改成内链。

```tsx
// navigation-card.tsx —— 在现有 <Link> 同级追加
<div className="relative">
  <Link href={safeHref(item.href)} target={linkTarget} rel="noopener noreferrer" ...>
    {/* 原有内容不动 */}
  </Link>

  {/* 新增：站内详情入口。absolute 定位不影响原有点击热区 */}
  <Link
    href={`/site/${item.id}`}
    className="absolute -top-1.5 -right-1.5 z-10 rounded-full border border-border/70
               bg-card/90 dark:bg-card/70 backdrop-blur-xs p-0.5 opacity-0 group-hover:opacity-100
               focus-visible:opacity-100 transition-opacity shadow-xs"
    onClick={(e) => e.stopPropagation()}  // 不触发卡片外链
    aria-label={`查看 ${item.title} 的详情与平替方案`}
    title="站内详情"
  >
    <Info className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
  </Link>
</div>
```

同时把标题 `<span>` 换成内链（标题是用户最想深入了解的入口）：

```tsx
<Link
  href={`/site/${item.id}`}
  onClick={(e) => e.stopPropagation()}
  className="truncate hover:text-primary hover:underline"
>
  {item.title}
</Link>
```

> 收益：一次改动就给 1020 个详情页注入入链，且首页本身就是权重最高的页面。成本：一个组件文件。
> 取舍：标题不再直接跳出。若产品坚持标题必须外跳，至少保留角落的 `Info` 入口 —— 两者取一，但不能都没有。

#### 5.3 新增 `/category/[anchor]` 路由（P1-3）

分类是导航站最强的聚合落地页形态。**必须先解决 anchor 可读性**：106/594 的 anchor 是 UUID。做法：给 `categories` 表加 `slug` 字段，用「标题拼音 + 短哈希」生成（如 `kuang-jia-yu-yuan-ma-fang-an` → `ai-gongju`），`anchor` 保持不动以免破坏现有逻辑。

```tsx
// src/app/category/[slug]/page.tsx（服务端组件）
export const revalidate = 3600;

export async function generateMetadata({ params }): Promise<Metadata> {
  const { slug } = await params;
  const cat = await resolveCategory(slug);
  if (!cat) return { robots: { index: false, follow: false } };
  const n = cat.siteCount;
  if (n < 5) return { robots: { index: false, follow: true } }; // 薄分类：可跟随但不索引
  return {
    title: `${cat.title}工具导航`,
    description: `${n} 个精选${cat.title}工具，覆盖…（取自分类 description 截断）`,
    alternates: { canonical: `/category/${slug}` },
  };
}
```

#### 5.4 面包屑（可见 + JSON-LD 同源）

`首页 / 分类 / 站点名`。站点详情、分类页、标签页都要有。数据与 §4.3 的 BreadcrumbList 完全同源，写一个 `<Breadcrumb items={...} />` 同时吐 UI 和 `<JsonLd>`，避免两处漂移。

#### 5.5 三角互链规则

| 页面 | 必须包含的出链 |
|---|---|
| 首页 | 分类聚合页（已有分类区块 → 改为指向 `/category/[slug]`）、热榜、标签云 |
| 分类页 | 该分类下站点（≤80）、同级/子分类 5-10 个、相关标签 10-15 个 |
| 标签页 | 该标签下站点（≤80）、相关标签 10-15 个、所属分类 3-5 个 |
| 站点页 | 同分类其它站点（已有相似推荐）、平替/生态（已有）、所属分类 1 个、所属标签 5-10 个 |

#### 5.6 锚文本规范（避免全站同质化）

| 场景 | 锚文本 |
|---|---|
| 首页卡片标题 | 站点名本身 |
| 分类页列表 | `{站点名} 官网入口` / `{站点名} 替代方案`（自然穿插） |
| 相关推荐 | `和 {站点名} 类似的工具` / `{站点名} 平替` |
| 面包屑 | 分类名 |
| 平替区块 | `为什么选 {站点名} 而不是 {对手}` |

> 严禁全站统一用「查看详情」「点击进入」这类无信息锚文本 —— 等于浪费 1020 次关键词传递机会。

### Phase 6（第 7-8 周）渲染与性能：把 force-dynamic 换成 ISR

现状：`page.tsx`、`videos/page.tsx`、`videos/player/page.tsx`、`submit/page.tsx`、`sitemap.ts` 全部 `export const dynamic = "force-dynamic"`，且 `lib/storage-adapter.ts:247` 是 `cache: "no-store"`。每次爬虫请求都打穿中枢，既慢又浪费抓取配额。

分页面决策：

| 页面 | 现状 | 建议 | 理由 |
|---|---|---|---|
| 首页 `/` | force-dynamic | `revalidate = 300`（ISR） | 站点列表 5 分钟延迟完全可接受；`page.tsx` 的注释已说明为什么不能静态固化，ISR 正是解法 |
| 站点详情 | force-dynamic | `revalidate = 3600` | 站点元数据变化极少 |
| 分类 / 标签页 | 客户端取数 | `revalidate = 1800` | 同上，且服务端化后才能用 |
| sitemap | force-dynamic | `revalidate = 3600` | 省掉每次的全量翻页 |
| 投稿页 `/submit` | force-dynamic | 保留动态 | 表单需要实时类目 |
| 后台 `/admin/**` | — | 保留 + noindex | 已规划 |

补充项：
- `next.config.js` 的 `images.remotePatterns` 默认 `https://**`。建议收紧为 `NAVHUB_IMAGE_HOSTS` 白名单模式（代码已经支持，只是默认值太宽），避免任意站点图片经 `/_next/image` 白蹭带宽。
- `/videos/player?id=xxx` 改为 `/videos/player/[id]`，从根上消灭参数重复 URL。

---

## 五、索引阈值模型（全案最关键的决策）

**原则：宁可少索引 200 个薄页，不要为了 200 个薄页拖垮 1000 个好页。**

| 页面类型 | 总量 | 门槛 | 索引进站 | noindex | 依据 |
|---|---|---|---|---|---|
| 站点详情 | 1020 | 无门槛（均有 description + 分类） | **1020** | 0 | 内容实体完整，唯一性由 title+desc 保证 |
| 分类 | 594 | 站点数 ≥5 | **99** | 495 | 489 个空分类 + 6 个 1-4 站点分类直接 noindex |
| 标签 | 1080 | 站点数 ≥5 | **82** | 998 | 其余标签大多 1-2 站点，页面几乎空壳 |
| 合集 | 4 | 均 ≥1 | **4** | 0 | 人工维护，质量高 |
| 插件 | 64 | 已上架 | **64** | 0 | 已有 OG + sitemap |
| 私密/工具页 | 约 20 | — | 0 | 20 | 见 §1.3 |

**索引入库总量：约 1269 条（现状 67 条 → 增长 ~19 倍），且每一页都过质量门槛。**

配套执行细则：

1. 分类页达到 ≥5 站点后**自动**从 noindex 转为可索引（在 `generateMetadata` 里按 `siteCount` 判断，不靠人工维护）。
2. 标签页同理。阈值配置文件化，后续可调：
   ```ts
   // src/lib/seo/thresholds.ts
   export const INDEX_THRESHOLDS = { category: 5, tag: 5 } as const;
   ```
3. **先补内容再放开**：1080 个标签 0 个有 description，是有意为之还是欠账？建议优先给这 82 个达标标签补 description（`tags.description` 字段已存在，直接写值即可，零迁移成本）。
4. 空分类的处置：594 个启用分类里 489 个是空的。建议在后端加"启用但 0 内容自动下架（enabled=0）"，而不是在前端做无谓的 noindex —— 减少数据噪声比在展示层补救更彻底。

---

## 六、落地页建设优先级（P0 首月）

> 排序依据：**内容就绪度（站点数）× 意图明确度 × 实现成本**。注意：具体的搜索量与难度需要用 SEO 工具（或 Google Keyword Planner / 5118 / 站长工具）实际拉数验证，此处先按站内数据给出确定性排序。

### P0-首批（内容最厚、成本最低，建议先做）

| # | 落地页 | URL | 收录站点数 | 意图 |
|---|---|---|---|---|
| 1 | 数据库与存储 | `/category/…` | 21 | 「常用的数据库管理工具」「数据库客户端」 |
| 2 | IaC 与云厂商 | `/category/…` | 17 | 「IaC 工具」「云厂商对比」 |
| 3 | AI 工具 | `/category/cat-ai` | 15 | 「AI 工具导航」「AI 工具箱」 |
| 4 | 大模型对话助手 | `/category/…` | 14 | 「大模型对话工具」「免费 AI 聊天」 |
| 5 | 组件库与 UI 体系 | `/category/…` | 14 | 「React 组件库」「UI 框架对比」 |
| 6 | 开发运维 | `/category/cat-dev` | 13 | 「DevOps 工具」「运维导航」 |
| 7 | AI 图像与视频 | `/category/…` | 13 | 「AI 绘图工具」「AI 视频生成」 |
| 8 | 核心框架与元框架 | `/category/…` | 13 | 「前端框架对比」「Next.js 替代」 |
| 9 | 热门站点详情页 ×20 | `/site/{id}` | — | 「{工具名} 是什么 / 平替 / 官网」 |
| 10 | 标签：开源 | `/tags/开源` | 123 | 「开源工具推荐」 |
| 11 | 标签：国产 | `/tags/国产` | 34 | 「国产替代软件」 |
| 12 | 标签：轻量 / 中文 / 文档 | `/tags/…` | 22/20/19 | 「轻量级工具」「中文界面软件」 |
| 13 | 合集：AI 编程工具链 | `/collections/ai-coding` | 4 站点 | 「AI 编程工具链」「AI 辅助编程」 |
| 14 | 合集：2026 前沿 Agentic AI 生产力矩阵 | `/collections/agentic-ai` | 4 站点 | 「Agentic AI 工具」「AI Agent 框架」 |
| 15 | 首页品牌词 | `/` | — | 「NavHub 导航」「开发者导航站」 |

### P1-次批（需要先补内容）

- 其余 36 个 ≥5 站点的分类页
- 其余 70 个达标标签页（**先补 description**）
- 1020 个站点详情页中，按 `visit_count` / `trend_score` 排序的 Top 200（热度高的页面排名潜力更大）
- `/graph` 技术生态图谱页 → 可包装成「{品类}平替图谱」合集，承接「XX 的替代品」类意图

### P2-长线

- `/algorithms` 算法实验室页包装成内容资产（技术向长文，做品牌信任与外链）
- 英文版（`title_en`/`description_en` 字段已就绪），配 `hreflang`

---

## 七、验收指标与排期

### 排期

| 阶段 | 周期 | 交付 |
|---|---|---|
| Phase 1 索引地基 | 第 1 周 | metadataBase / canonical / noindex / robots 重写 |
| Phase 2 动态页服务端化 | 第 2 周 | `/site/[id]`、`/tags/[slug]`、`/collections/[slug]` 改造 |
| Phase 3 sitemap 扩容 | 第 3 周 | 5 个分片 + 阈值过滤 + `/api/categories/with-counts` |
| Phase 4 结构化数据 | 第 4 周 | WebSite+SearchAction / BreadcrumbList / ItemList / Organization |
| Phase 5 内链重构 | 第 5-6 周 | 卡片双模式 + `/category/[slug]` + 面包屑 |
| Phase 6 性能 | 第 7-8 周 | ISR 化 + 图片白名单 + 播放页路径化 |

### 验收指标（上线后 4-8 周观测）

| 指标 | 现状 | 目标 |
|---|---|---|
| sitemap 提交 URL 数 | 67 | ≥1269 |
| GSC「已编入索引」页面 | 个位数 | ≥1000（4 周内） |
| 重复 title 页面数 | 2104 | 0 |
| 软 404 | 全量动态页 | 0 |
| 有 JSON-LD 的页面 | 0 | 全部可索引模板页 |
| 首页 TTFB（爬虫 UA，无缓存） | 打穿中枢 | P95 < 800ms |
| 平均排名进前 3 的词数 | — | ≥30 |

---

## 八、红线：不要做的事

1. **不要为 489 个空分类生成页面。** 空聚合页是最典型的薄内容，比没有页面更糟。
2. **不要给没有评分数据的站点编造 `aggregateRating`。** 虚假结构化数据会导致人工处罚，一次性清零流量。
3. **不要在页面里堆砌关键词。** 标题公式里的分类名出现一次即可，导航站的转化靠产品力不是密度。
4. **不要为了 SEO 把外链全部改成内链中转。** 导航站的核心价值是"一键直达"，中转页会直接杀死这个价值。Phase 5.2 的角落入口是正确的折中。
5. **不要用 302 做永久跳转。** `/s/[code]` 目前用 302 短链，符合语义（可统计点击），保持即可；但若未来做 URL 规范化迁移，永久变更要用 301。
6. **不要在构建期固化站点名到 title。** `page.tsx` 的注释里已经记录过这个坑（库里已是"NavHub 导航"，构建产物里还是"NavSphere导航"），任何"为了 SEO 改静态导出"的提议都要先读那段注释。

---

## 九、发布前检查清单

- [ ] `NAVHUB_PUBLIC_URL` 已在生产环境注入，`metadataBase` 生效
- [ ] 每个可索引模板页都有 `alternates.canonical`
- [ ] `/site/[id]` 无效 id 返回真 404（`curl -o /dev/null -s -w "%{http_code}"` 验证）
- [ ] 分类页站点数 <5 时响应头含 `noindex`（`curl -sI` 看 meta）
- [ ] `/sitemap.xml` 为索引，5 个分片均可访问且 ≤50000 条
- [ ] `robots.txt` 的 `Sitemap:` 指向正确域名（自托管反代需转发 Host）
- [ ] 首页 `?q=test` 能真正驱动搜索结果
- [ ] 结构化数据通过 Google Rich Results Test 验证（4 类模板各至少 1 页）
- [ ] 卡片新增内链入口后，`pnpm --filter navsphere lint` + `pnpm typecheck` 通过
- [ ] `test/sitemap.test.ts` 新增阈值过滤单测
- [ ] Lighthouse SEO 项 100 分（对 3 个模板页各跑一次）
