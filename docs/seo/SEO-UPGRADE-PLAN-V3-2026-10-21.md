# NavHub SEO 下一步升级方案（V3 · 复扫版）

- 日期：2026-10-21
- 状态：**仅复扫，未改代码**
- 环境：本地 dev（web `:3000` + hub `:8787`），dev 库 51 个 active 站点
- 关联：[V2 方案](./SEO-OPTIMIZATION-PLAN-V2-2026-10-21.md)（索引地基、RSC 化、软 404、sitemap、JSON-LD 第一轮已完成）

---

## 0. 一句话结论

V2 的“能被收录”已经基本成立：sitemap 134 条、软 404 归零、详情页有 SSR 正文与独立 title。**下一步的主矛盾从“能不能收录”转成“爬虫和用户能不能在站内继续走下去，以及分享/结构化数据是否完整”。**

三个最高杠杆的缺口：

1. **内链仍有两处断点**：首页 SSR 里 `/category` 出链为 0；站点详情页 `/site/` 相关出链为 0、`/category` 出链为 0、JSON-LD 为 0。站点详情目前是“内容终点”，不是“可继续浏览的节点”。
2. **分享元信息被页面级 `openGraph` 整体替换**：所有主要模板都只剩 `og:title/description/url`，`og:image/og:type/og:site_name/og:locale` 全部丢失；`twitter:card` 还是 `summary` 且无图。
3. **内容与审计闭环不足**：dev 库 35/51 个站点描述少于 20 字；全量 sitemap 审计在 dev 出现 20 个 timeout；审计本身不检查 OG/JSON-LD/内链，无法防回归。

建议下一轮按 **F（内链）→ G（分享卡）→ H（审计）→ I（内容/运营）** 推进，预计 5-6 个工程日完成 P0/P1。

---

## 1. 复扫证据

### 1.1 内链与 SSR 实测

统计口径：对 dev 服务器实际 HTML 做正则计数（不是源码推断）。

| 页面 | `/category` 出链 | `/site/` 出链 | `/tags/` 出链 | JSON-LD 块 | `og:image` |
|---|---:|---:|---:|---:|---:|
| `/` | **0** | 0（设计如此） | 0 | 2（WebSite + Organization） | **0** |
| `/sites` | 1 | 51 | 0 | 2（BreadcrumbList + ItemList） | **0** |
| `/category` | 5 | 0 | 0 | 1 | **0** |
| `/category/cat-ai` | 6 | 12 | 5 | 2 | **0** |
| `/hot` | 0 | 30 | 0 | 1 | **0** |
| `/tags` | 0 | 0 | 16 | 1 | **0** |
| `/collections` | 0 | 0 | 0 | 1 | **0** |
| `/collections/agentic-ai` | 0 | 6 | 0 | 2 | **0** |
| `/marketplace` | 0 | 0 | 0 | 1 | **0** |
| `/marketplace/{slug}` | 0 | 0 | 0 | 1（SoftwareApplication） | ✅ 有（文件约定 OG） |
| `/site/{id}` | **0** | **0** | 2 | **0** | **0** |

关键读法：

- 首页卡片全部是外链，这是导航站的产品红线，**首页没有 `/site/` 出链不是 bug**（V2 §5.2 已裁定）。
- 但首页连 `/category` 都没有：分类 hub 只能从 `/sites` 或分类详情面包屑进入。分类 hub 是站点详情的主要入链来源之一，这条路径目前绕远了。
- `/site/{id}` 的相似推荐、实体关系仍由客户端 `useEffect` 取数（`site-detail-view.tsx:147`、`:162`），SSR HTML 里没有 `/site/` 相关出链；现有相似卡片主点击还是外链（`site-detail-view.tsx:561` 起），不能直接当内链使用。
- 站点详情已有 1 个 `<h1>`、独立 canonical、独立 title/description；缺的是**结构化数据和站内下一跳**，不是首屏正文。

### 1.2 分享元信息实测

以 `/site/{id}` 为例，实际输出只有：

```html
<meta property="og:title" content="Google Fonts · 站点详情">
<meta property="og:description" content="免费开源字体库，中英文字体齐全">
<meta property="og:url" content="http://localhost:3000/site/...">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Google Fonts · 站点详情">
<meta name="twitter:description" content="免费开源字体库，中英文字体齐全">
```

根布局本来有完整配置（`apps/web-overlay/src/app/layout.tsx:51`）：

```ts
openGraph: {
  type: 'website',
  siteName,
  locale: 'zh_CN',
  images: [{ url: '/icons/icon-512.png', width: 512, height: 512, alt: siteName }],
},
twitter: { card: 'summary' },
```

**根因**：Next 的 metadata 对 `openGraph` 是**整体替换**，不是深合并。页面/子 layout 一旦写 `openGraph: { url: ... }`，根层的 `images/type/siteName/locale` 全部消失。当前 `openGraph` 字面量共 23 处（根 layout 1 处是基准，页面/子 layout 22 处需要迁移；含嵌套 layout 与失败分支；用 `rg 'openGraph:\s*\{'` 可复核），覆盖 `/`、`/sites`、`/category`、`/hot`、`/tags`、`/collections`、`/marketplace`、`/site/[id]`、`/videos`、`/graph`、`/algorithms`、`/submit` 等主要模板。

这不是“缺一张图”这么简单：`og:type/site_name/locale` 也丢了，社交平台和部分聚合器拿到的是一份不完整的对象。

### 1.3 sitemap 与数据质量

| 指标 | dev 实测 | 说明 |
|---|---:|---|
| sitemap URL 总数 | 134 | 10 静态 + 51 site + 5 category + 4 collection + 64 plugin + 0 tag |
| 带 `lastmod` | 119 | 缺的 15 条 = 10 个静态页 + 5 个分类页 |
| active 站点 | 51 | 0 个重复 URL/title |
| 描述 <20 字 | **35 / 51** | 0 条空描述 |
| 标签总数 | 84 | ≥5 站点的 0 个、≥2 站点的 16 个 |
| 达标分类 | 5 | AI 12、开发运维 11、学习教育 10、生活服务 10、设计资源 8 |

标签在 dev 为 0 条达标是**数据量问题**，不是代码回退；V2 §7.6 记录的生产口径是 82 条 ≥5。阈值 5 不要为了“让 sitemap 好看”而下调。

### 1.4 审计可靠性

- 上一轮全量 sitemap 审计（134 页）出现 **20 个 timeout**，集中在 dev 服务器持续运行后的抖动；内容本身没有 20 个 404/软 404。
- 审计脚本目前只查 title/description/canonical/h1/noindex/软 404（`scripts/seo-audit.mjs`），**不查 OG、不查 JSON-LD、不查站内出链**，所以本轮发现的三个缺口它全部漏报。
- 6 条伪造 URL 探针（site/category/tags/collections/marketplace/author）当前全部真 404，软 404 收官状态保持。

---

## 2. 优先级总表

| 批次 | 优先级 | 工作包 | 目标 | 预计 |
|---|---|---|---|---|
| F | **P0** | 内链闭环 | 首页接住分类 hub；站点详情接住同分类站点 + 面包屑 JSON-LD | 1.5-2 天 |
| G | **P1** | 分享卡与安全结构化数据 | OG/Twitter 覆盖所有主要模板；site 详情 BreadcrumbList | 1.5-2 天 |
| H | **P1** | 审计与 CI | 审计覆盖 OG/JSON-LD/内链；生产构建可全量跑；静态测试进 CI | 1-1.5 天 |
| I | P2 | 内容与运营 | 短描述治理、IndexNow、RUM、工具页索引裁决 | 持续 |

---

## 3. P0-F：内链闭环

### F1. 首页增加“站内目录带”（不碰外链卡片）

**现状**：首页 `NavigationContent` 是客户端组件，但客户端组件仍会 SSR；问题不是“没 SSR”，而是**模板里根本没有 `/category` 链接**（实测 0）。首页目前只有 `/sites`、`/collections` 等页脚入口。

**做法**：

1. 在 `apps/web-overlay/src/app/page.tsx` 的 `HomePage` 里并行取：

```ts
const [categories, counts] = await Promise.all([
  loadCategories(3600),
  loadActiveCategoryCounts(3600),
])
const directoryLinks =
  categories && counts
    ? categories
        .filter((c) => c.enabled !== false && (counts.get(c.id) ?? 0) >= MIN_SITES_FOR_INDEX)
        .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.title.localeCompare(b.title, 'zh-CN'))
        .slice(0, 8)
        .map((c) => ({ id: c.id, title: categoryDisplayName(c, categories), count: counts.get(c.id) ?? 0 }))
    : []
```

2. 把 `directoryLinks` 作为可序列化 prop 传给 `NavigationContent`，在 `NavigationToolbar` 之后（`navigation-content.tsx:291` 附近）、分类区块之前（`:327`）渲染一条紧凑的“站内目录”带：

   - 固定入口：`分类总览 → /category`、`全部站点 → /sites`、`标签云 → /tags`
   - 分类入口：`/category/{id}`，锚文本用分类名 + 真实计数
   - 取数失败（`categories`/`counts` 为 null）时整条隐藏，不影响首页 200

3. **不要**把首页 1020 张卡片改成内链，也**不要**按 V2 §5.5 字面渲染 132 条分类链接。理由：

   - 132 条会把首页内链预算从约 145 抬到约 280，且大部分分类页在移动端不可见；
   - `/category` 索引页已经列出全部达标分类，首页只需要一个入口 + 前 8 个高频分类；
   - 首页 → `/category` → `/category/{id}` → `/site/{id}` 仍是三层，爬取深度不增加。

> 这是对 V2 §5.5“首页必须输出 132 条分类链接”的**修订**：用“top 8 + 总览页”替代“全量平铺”，既保留三层结构，又不把首页变成链接列表。

**验收**：

- `curl /` 至少包含 6 条独立 `/category/` 链接（dev 5 个分类 + `/category`）；生产随达标分类数自动增加，仍最多 8 条分类 + 1 条总览。
- 所有分类链接的 ID 都来自 `counts >= MIN_SITES_FOR_INDEX`，不产生 404。
- hub 挂掉时首页仍 200，目录带消失，控制台不刷错误。
- 不修改 `navigation-toolbar.tsx`（并行会话 WIP）；如页脚 WIP 未释放，`/category` 页脚入口延后补，不阻塞 F1。

### F2. 站点详情增加“同分类站点”+ 面包屑 JSON-LD

**现状**：`site/[id]/page.tsx` 已经把首屏站点数据 SSR 下发，但相关推荐仍只在客户端取；`site-detail-view.tsx` 的 KNN 卡片主链接是外链，不能直接改造成内链（红线 3）。同时整个页面 0 个 JSON-LD。

**做法**：

1. 在 `apps/web-overlay/src/app/site/[id]/page.tsx` 的默认导出里，探针 `ok` 且 `site.categoryId` 存在时并行取：

```ts
const [res, categories, counts] = await Promise.all([
  loadCategorySites(site.categoryId, 9, 0, 300),
  loadCategories(3600),
  loadActiveCategoryCounts(3600),
])
const related = (res?.hits ?? [])
  .map((h) => h.site)
  .filter((s): s is HubSite => Boolean(s) && s.id !== site.id && s.status === 'active')
  .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id))
  .slice(0, 6)
```

2. 分类名用 `categoryDisplayName` 解析；只有 `counts.get(categoryId) >= MIN_SITES_FOR_INDEX` 时才把分类作为面包屑的一节和“浏览全部分类站点”链接，避免链到会 404 的薄分类页。

3. **面包屑上移**：在服务端用 `Breadcrumbs`（它同时产出可见 DOM 与 BreadcrumbList JSON-LD，见 `apps/web-overlay/src/components/breadcrumbs.tsx`）渲染：

   ```ts
   [
     { label: '首页', path: '/' },
     { label: '全部站点', path: '/sites' },
     ...(canLinkCategory ? [{ label: categoryName, path: `/category/${id}` }] : []),
     { label: site.title, path: `/site/${id}` },
   ]
   ```

   把渲染结果作为 `breadcrumb` ReactNode prop 传给客户端岛，岛在 `<Container as="main">` 顶部渲染它，并**删除岛内手写的“返回导航 / 标题”面包屑**。这样可见面包屑与 JSON-LD 同源，不会出现两边断档。

4. 客户端岛新增 `initialRelated`、`category` 两个 prop，在 KNN 区块（`site-detail-view.tsx:561`）之前渲染“同分类站点”：

   - 标题：`「{分类名}」的其他站点`；分类名不可用时用“同分类站点”
   - 每张卡片：站点名 → `/site/{id}`（内链，锚文本就是站点名）；旁边保留一个小外链图标 → `site.url`（一跳直达不丢）
   - 底部：`浏览全部 {N} 个{分类名}站点 → /category/{id}`（仅分类达标时）
   - 无数据或中枢失败：整块隐藏，不渲染空标题

5. KNN 相似推荐、实体关系网络继续留在客户端，不预取、不改主链接；本次只补“确定性的同分类内链”，不依赖 embedding 是否可用。

**验收**：

- 任取一个达标分类下的站点详情，SSR HTML 至少 6 条 `/site/` 内链、1 条 `/category/`（达标时）、1 块 BreadcrumbList。
- 站点详情仍只有 1 个 `<h1>`；title/description/canonical 不被面包屑改动。
- 无效 ID 仍真 404；中枢失败仍降级 200；**本路由不新增 `loading.tsx`**（软 404 根因回归锁）。
- `/site/{id}` 的外链主 CTA、KNN 外链行为不变；新增内链是“附加入口”，不是中转。

### F3. 跨 hub 小补链（可选，不阻塞）

- `/hot`、`/tags`、`/collections`、`/marketplace` 目前都有面包屑和页脚，分类 hub 不是它们的必需出链；可在各自的“站内目录”行补一条 `/category`，但不为此改版式。
- 页脚 `/category` 入口等 `footer.tsx` 并行 WIP 释放后再加；**本轮不要动 footer**。

---

## 4. P1-G：分享卡与安全结构化数据

### G1. 用一个 helper 修掉 `openGraph` 整体替换

**新增** `apps/web-overlay/src/lib/seo/metadata.ts`：

```ts
export const DEFAULT_OG_IMAGE = {
  url: '/og-default.png',
  width: 1200,
  height: 630,
  alt: 'NavHub 导航',
}

export async function pageOpenGraph(input: {
  title?: string
  description?: string
  url: string
}) {
  return {
    type: 'website' as const,
    siteName: await loadBrandName(), // cache(getFileContent(SITE_PATH))，失败回退 NavHub
    locale: 'zh_CN',
    url: input.url,
    ...(input.title ? { title: input.title } : {}),
    ...(input.description ? { description: input.description } : {}),
    images: [DEFAULT_OG_IMAGE],
  }
}
```

要点：

- `loadBrandName` 用 `cache()` 包住 `getFileContent(SITE_PATH)`，与标题品牌名单一来源；不要在每个页面里硬编码品牌。
- 逐步替换 22 处页面/子 layout 的 `openGraph: { url: ... }` / `openGraph: { title, description, url }`（根 layout 保留为基准，只补 twitter），包括页面和 `collections/layout.tsx`、`marketplace/layout.tsx` 这类中间层；**任何页面级对象都必须自带 `images`**，否则又会把根层的图顶掉。
- 根布局的 `twitter` 改为 `summary_large_image`，并显式带默认图：

```ts
twitter: { card: 'summary_large_image', images: [DEFAULT_OG_IMAGE.url] }
```

- 新增 `public/og-default.png`（1200×630，静态品牌卡）。不要让 `og:image` 指向不存在的文件；测试里解析 PNG 头校验宽高。
- 站点详情若后续要做**逐站动态 OG**，沿用 `marketplace/[slug]/opengraph-image.tsx` 的 ASCII-only 构图（Satori 默认字体不含 CJK，见该文件 41-53 行），用域名 host 而不是中文站点名；本轮先上默认图，避免引入字体资产和运行时开销。
- 不用根级 `opengraph-image.tsx` 赌“文件约定能否穿透页面级 openGraph”；显式 helper 的行为是确定的，也便于单测。

**验收**：

- `curl` 以下模板均含 `og:image`、`og:type=website`、`og:site_name`、`og:locale=zh_CN`、`og:url`，以及 `twitter:card=summary_large_image` + `twitter:image`：`/`、`/sites`、`/category`、`/category/{id}`、`/hot`、`/tags/{slug}`、`/collections/{slug}`、`/marketplace`、`/site/{id}`、`/algorithms`、`/videos`、`/submit`。
- 插件详情继续由 `marketplace/[slug]/opengraph-image.tsx` 覆盖为插件专属卡，不被默认图顶掉。
- 社媒预览人工抽查 3 条（首页、站点详情、分类详情）。

### G2. 结构化数据：只补安全的，不碰“假榜单”

- **站点详情**：随 F2 上 BreadcrumbList（首页 → 全部站点 → [分类] → 站点）。这是本轮唯一确定要补的结构化数据。
- **`/hot` 暂不加 ItemList**：`visit_count`/`trend_score` 尚未积累，页面文案自己也说“当前榜单不反映真实热度”（V2 §6.4）。给一个不稳定榜单套 `ItemList` 会让结构化数据比页面文案更“权威”，违反红线 2。等真实趋势数据起来再加。
- **`/tags`、`/collections`、`/marketplace` hub**：现有 BreadcrumbList 足够；没有通用的“非站点列表” helper，不值得为 4 个合集/16 个标签扩一套 schema。保持现状。
- **`/site/{id}` 不加 `SoftwareApplication`/`WebApplication`**：站点是网址目录条目，不是软件；没有真实评分/价格，不套应用 schema。
- 现有红线继续：不加 `aggregateRating`、不加 `potentialAction`（没有 `/search` 页）、不编造 `offers`。

### G3. sitemap 的 `lastmod` 补齐（小项）

- `CategoryRef` 增加 `updatedAt`（`/api/categories` 实际返回该字段），`categoryEntries` 用 `toDate` 输出 lastModified（`lib/seo/sitemap-entries.ts:131`）。
- 静态页 10 条没有可靠时间戳，**不要用构建时间伪造 lastmod**；119 → 124 即可。
- `/submit` 继续不放进 sitemap：它是投稿转化页，不是搜索落地页；保持 indexable 但不出现在 sitemap 是合理取舍，在文档里记录，不算缺口。
- 标签 0 条达标是 dev 数据量，生产 82 条会自动进入；不要为了 sitemap 数字下调阈值。

---

## 5. P1-H：审计与 CI

### H1. 把本轮缺口写进审计

在 `scripts/seo-audit.mjs` 增加：

1. **重试**：`--retries=2`，只对超时/网络错误重试（带 200-500ms 退避）；默认并发 4 不变。
2. **OG 检查**：sitemap 页面必须含 `og:image`，`og:url` 与 canonical 同路径；`og:type/og:site_name/og:locale` 非空。若某模板是 noindex，可跳过 image 要求，但 sitemap 页面不能跳过。
3. **JSON-LD 检查**：提取所有 `application/ld+json`，`JSON.parse` 必须成功；`@context` 包含 `schema.org`；`@type` 存在；`BreadcrumbList`/`ItemList` 的 `position` 从 1 连续；禁止出现 `aggregateRating`（与红线同源）。
4. **内链断言**：
   - `/`：至少 1 条 `/category/` 链接；
   - `/site/*`：至少 1 条相关 `/site/` 内链（F2 后是 6 条）；
   - 分类页：至少 1 条 `/site/` 链接（现有 12 条，防回退）。
5. **全量模式**：`--limit=2000` 或 `--all`，对生产预览跑全部 sitemap URL；**dev 只做冒烟，不做门禁**（20 timeout 已证明 dev 不适合当全量门禁）。
6. 保留 `--json` 输出，报告里加 `ogMissing`、`jsonLdInvalid`、`internalLinkMissing` 三个汇总字段，便于 CI 上传。

### H2. 测试与 CI 分工

**静态守卫（进 PR CI，快）**：

- 新增 `test/home-directory.test.ts`：源码级断言首页取 `loadCategories/loadActiveCategoryCounts`、传 `directoryLinks`、渲染 `/category/` 模板，且过滤阈值来自 `MIN_SITES_FOR_INDEX`。
- 扩展 `test/site-detail-404.test.ts`：page 调用 `loadCategorySites`、下发 `initialRelated`、使用 `Breadcrumbs`；岛内有 `/site/` 内链模板；仍无 `loading.tsx`。
- 新增 `test/og-metadata.test.ts`：`pageOpenGraph` 输出含 `images/type/siteName/locale`；根 layout 的 twitter 是 `summary_large_image` + image；`public/og-default.png` 存在且 PNG 头为 1200×630。
- 扩展 `test/sitemap-entries.test.ts`：分类条目带 `lastModified`；静态条目不因缺时间戳而伪造。
- 跑法：根目录 `pnpm exec vitest run apps/web/test/...`；改动只手动镜像到 `apps/web` 对应文件，**不做全量 overlay sync**。

**运行时审计（非 PR 阻塞）**：

- 新增 `seo:audit:prod`（或 `workflow_dispatch`/nightly job）：对生产预览 URL 跑 `--limit=2000 --json --retries=2`，上传 JSON artifact；失败通知，但不阻塞 PR。
- 不建议在 PR CI 里临时拉起 API + web + seed 数据跑全量审计：启动成本和 flakiness 会把一个高价值门禁变成噪音；静态守卫 + 发布后审计更稳。

---

## 6. P2：内容质量与运营

### I1. 短描述治理（35/51，不进 sitemap 阈值调整）

- 后台创建/编辑站点时给 description 加 20-160 字校验或“待补全”提示；按分类/访问量排出待补清单，优先补有外链和搜索需求的站点。
- 站点详情 `generateMetadata` 在 `description` 少于 20 字时，用**真实字段**组合兜底（站点名 + 分类名 + 标签），不写“最好/必备/第一”等词，不编造评分/排名：

```ts
`${site.title}：收录于${categoryName ?? '导航'}分类，提供官网入口、同类站点与标签导航。`
```

- `description` 仍为空时保留现有通用文案，不要在页面正文里扩写没有数据支撑的“适合谁/为什么选它”。
- 新增/修改文案的测试：长度 60-160、无禁用词、无 `aggregateRating`/排名承诺。

### I2. 标签/分类数据

- dev 84 个标签只有 16 个 ≥2、0 个 ≥5；生产 82 个 ≥5。**阈值 5 保持不变**，薄标签继续 `noindex,follow`，不进 sitemap。
- 分类 dev 5 个达标、生产 132 个；首页目录带按 counts 自动伸缩，不写死 ID。
- 不为凑页面生成 <5 站点的标签/分类页（红线 1）。

### I3. 运营与性能

- **IndexNow**：`scripts/indexnow.mjs` 已支持 key 文件校验和 dry-run；部署后把 `INDEXNOW_KEY` + `{key}.txt` 配好，按发布批次推送 sitemap URL，先 dry-run 再实推。
- **GSC/Bing**：`GOOGLE_SITE_VERIFICATION` / `BING_SITE_VERIFICATION` / `BAIDU_SITE_VERIFICATION` 已有 meta 通道；提交 sitemap，观察“已编入/已排除”与软 404 回归。
- **RUM**：生产设 `NEXT_PUBLIC_RUM=1`（默认关闭），采集 LCP/INP/CLS/TTFB；目标 LCP <2.5s（移动）、INP <200ms、CLS <0.1。没有真实数据前不要用 dev 的 7.5MB 传输数字做优化决策（V2 §7.6 已勘误）。
- **图片白名单**：生产按部署能力设 `NAVHUB_IMAGE_HOSTS`，避免 `https://**` 的图片优化器被任意域名使用；这是安全/成本项，不是排名项。
- **视频**：`/videos/player?id=` 仍是 query 路由且 noindex；若视频库是真实内容，规划 `/videos/player/[id]` + 301 + `VideoObject`，否则保持现状。`/videos` SSR 文本约 616 字、无视频 schema，先做产品裁决。

### I4. 工具页索引裁决（P2，需产品确认）

实测 SSR 文本量：`/graph` 约 447 字、`/videos` 约 616 字、`/submit` 约 519 字、`/algorithms` 约 1197 字。`/graph`、`/videos` 当前 indexable 且在 sitemap 里。

建议：

- `/algorithms`：保留 indexable（有可读的方法说明）。
- `/graph`：二选一——补静态说明/操作指南后保留，或 `noindex,follow` 并移出 sitemap；不要让它以 447 字的工具壳参与排名。
- `/videos`：若补 `VideoObject` 和可索引的播放页，保留；否则 `noindex,follow` + 移出 sitemap。
- `/submit`：保持 indexable 但不进 sitemap，或直接 `noindex`；它是转化页，不是内容页。

---

## 7. 对 V2 的修订与保留

| V2 条目 | 状态 | V3 处理 |
|---|---|---|
| §5.5 首页必须输出 132 条 `/category` 链接 | 未落地 | **修订**：top 8 + `/category` 总览，三层深度不变，避免链接膨胀 |
| §5.5 站点详情“同分类 6-8” | 未落地 | **保留并落地**：用同分类 SSR 内链，不用 KNN（embedding 可用性不稳定，且现卡片是外链） |
| §5.4 面包屑可见 + JSON-LD 同源 | 部分落地 | **补站点详情**：服务端 `Breadcrumbs` 作为 ReactNode 下发，删除岛内手写面包屑 |
| Phase 4 详情页 OG | 未落地 | **本轮做默认 OG helper**；逐站动态 OG 延后（CJK 字体成本） |
| `/hot` 榜单文案 | 已修 | **不补 ItemList**，等真实趋势数据 |
| 标签阈值 5 | 已落地 | **保持不变**；dev 0 达标 ≠ 生产 0 达标，勿下调 |
| 审计 | 已有脚本 | **升级检查项 + 生产全量**；dev 不作门禁 |

---

## 8. 红线（本轮继续有效）

1. **不为 <5 站点的分类、<5 站点的标签生成索引页**；薄页 `noindex,follow`，不进 sitemap。
2. **不编造评分、排名、安装量、用户数、“平替/最强/必备”**；首页目录带只用真实分类计数，`/hot` 不加结构化榜单。
3. **不为了 SEO 把外链改成内链中转**；站点详情主 CTA、KNN 卡片主点击保持外链，内链只做附加入口。
4. **不新增 `site/[id]/loading.tsx`**：骨架屏边界会先流式刷 200，`notFound()` 改不了状态码（软 404 根因）。
5. **页面级 `openGraph` 不得裸写 `{ url }`**：必须走 helper 或自带 `images`，否则根层 OG 全丢。
6. **不跑全量 overlay sync / `check-web-overlay --fix`**；只手动镜像本轮改动的文件。
7. **不动并行 WIP**：`footer.tsx`、`navigation-toolbar.tsx`、`layout.tsx`（根布局改动前先协调）、`sitemap.ts`、`tags/**`、auth/identity/me/user-center、API routes。
8. **不提交/推送**，除非明确要求。

---

## 9. 顺序、工作量与预期

### 9.1 建议顺序

1. **F2（1-1.5 天）**：站点详情同分类 + 面包屑 JSON-LD。依赖 `lib/server/categories.ts`，不碰并行 WIP，收益最直接。
2. **F1（0.5-1 天）**：首页站内目录带。只改 `page.tsx` + `navigation-content.tsx`；避开 `navigation-toolbar.tsx`。
3. **G1（1-1.5 天）**：OG helper + 默认图 + 18 处迁移；根 `layout.tsx` 的 twitter 改动先与并行会话协调。
4. **G3 + H1/H2（1-1.5 天）**：分类 lastmod、审计增强、静态守卫、nightly 工作流。
5. **I1/I3/I4（持续）**：短描述治理、IndexNow/RUM、工具页裁决。

### 9.2 预期结果

- 首页 `/category` 出链：**0 → ≥6**（dev；生产 top 8 + 总览）。
- 站点详情 `/site/` 出链：**0 → 6**；`/category/`：**0 → 0/1（达标时）**；JSON-LD：**0 → 1**。生产约 1000 个详情页，等于新增约 6000 条可控内链。
- 主要模板 `og:image`：**0 → 100%**；`og:type/site_name/locale` 恢复；Twitter 改为大图卡。
- sitemap `lastmod`：**119 → 124**（不伪造静态页时间）。
- 审计：新增 OG/JSON-LD/内链检查；生产全量可跑；dev timeout 不再被误判为内容失败。
- 内容：短描述有治理入口和兜底文案；不再出现“页面有排名承诺、数据却是空”的信任问题。

### 9.3 主要风险

| 风险 | 缓解 |
|---|---|
| 站点详情新增 3 次分类相关取数，冷缓存变慢 | 全部走 `hubGet(..., revalidate)`；分类列表/计数 3600s，分类站点 300s；失败隐藏区块，不阻塞页面 |
| 面包屑 ReactNode 传给客户端岛的水合边界 | 用服务端 `Breadcrumbs` 渲染后作为 prop；若遇 RSC 限制，退回 `BreadcrumbTrail`（可见）+ page 级 `JsonLd`（结构化），items 同一数组 |
| 18 处 metadata 迁移漏改 | helper 单测 + 运行时审计逐模板断言；先迁移主要 6 个模板，再补工具页 |
| 首页目录带把首页变“链接墙” | 最多 8 个分类 + 3 个固定入口；移动端横向滚动；不展示未达标分类 |
| 分类计数缓存导致短暂 404 链接 | 只在 `counts >= 5` 时渲染；计数 3600s，最坏情况是极短窗口内分类降级，可接受；审计会抓到 |

---

## 10. 验收命令清单

```bash
# 1) 新增/修改的静态守卫（根目录跑）
pnpm exec vitest run \
  apps/web/test/site-detail-404.test.ts \
  apps/web/test/home-directory.test.ts \
  apps/web/test/og-metadata.test.ts \
  apps/web/test/json-ld.test.ts \
  apps/web/test/sitemap-entries.test.ts

# 2) 类型 / lint（先把本轮改动手动镜像到 apps/web；不跑全量 overlay sync）
pnpm --filter navsphere exec tsc --noEmit
pnpm --filter navsphere exec eslint .

# 3) 生产构建后跑运行时审计（不要用 dev 全量门禁）
pnpm --filter navsphere build
node scripts/seo-audit.mjs --base=http://localhost:3000 --limit=2000 --concurrency=4 --retries=2 --json

# 4) 内链图（已知站点的孤岛/深度回归）
node scripts/link-graph.mjs --check --max-urls=200 --no-probe

# 5) 本轮三条硬断言（curl 级别）
curl -s localhost:3000/ | grep -o 'href="/category[^"]*"' | sort -u | wc -l   # ≥ 6
curl -s localhost:3000/site/<达标分类站点ID> | grep -o 'href="/site/' | wc -l   # ≥ 6
curl -s localhost:3000/site/<达标分类站点ID> | grep -c 'application/ld+json'  # ≥ 1（RSC 会重复，按实际块数看）
curl -s localhost:3000/site/<达标分类站点ID> | grep -c 'property="og:image"' # 1
```

---

## 11. 结论

V2 已经把“可抓取、可收录、不软 404”做完了。V3 不需要再重做一遍索引地基，重点是把**站内链接从目录页延伸到详情页**、把**分享元信息从被覆盖的状态恢复**、把**审计从抽样脚本升级为可回归的门禁**。

如果只能做三件事：

1. **站点详情同分类 SSR 内链 + BreadcrumbList**（F2）；
2. **首页 `/category` 目录带**（F1）；
3. **OG helper + 默认分享图**（G1）。

这三件完成后，再补审计（H）和内容治理（I），比继续扩页面数量更划算。
