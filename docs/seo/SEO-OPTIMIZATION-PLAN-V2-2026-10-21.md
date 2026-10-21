# NavHub 全站 SEO 优化方案（代码级 · v2）

> 扫描范围：`apps/web-overlay/src/**`（NavHub 自有代码事实源）+ `apps/web`（vendored 上游镜像）+ `apps/api` 接口契约 + `data/navhub.db` 实库 + 本地 `:3000` 真实渲染抓取
> 复核日期：2026-10-21　｜　上一版：`docs/seo/SEO-OPTIMIZATION-PLAN-2026-10-20.md`
> **结论先行：站点不是"SEO 做得不够"，而是"内容层在爬虫眼里基本不存在"。** 1020 个站点页首屏只有 1 个 `<a>`（skip-link）、0 个 `<h1>`、正文 0 字；1080 个标签页同样；sitemap 只提交 67 条（覆盖 3.1%）；全站 0 canonical、0 JSON-LD；任意不存在的 `/site/{id}` 返回 200。可索引骨架是有的，但 **99.4% 的内容页是孤岛 + 空壳**（2163/2171，`scripts/link-graph.mjs` 实测）。

---

## 一、体检评分：28 / 100（技术）；内容健康度 12.3 / 100

| 维度 | 权重 | 得分 | 扣分依据（全部实测） |
|---|---:|---:|---|
| 可抓取与索引控制 | 25% | 40 | sitemap 67 条（应 ≈1170）；robots 漏 9 类私密路径；全站 0 个 `noindex`；`/site/{无效id}` 返回 200 |
| 页面元数据 | 20% | 28 | 1106 个详情页共用 3 组 title；0 canonical、0 metadataBase；3 个中间层 layout 打断 `title.template` |
| 结构化数据 | 10% | 3 | 全站 0 个 `application/ld+json` |
| 渲染与性能 | 20% | 25 | `/site/{id}` 49 KB 空壳、0 字正文；**全站 `Cache-Control: no-store`**；首页 7.5 MB / 8.2 s（2026-10-21 实测更正：7.5MB 为 dev 模式全资源口径失真，生产首访 gzip 约 530KB；8.2s 未能在当前环境复现，hub 读延迟实测 5-15ms。详见 §7.6） |
| URL 架构 | 10% | 40 | 详情页主键 UUID；`/videos/player?id=`；无 `/category`；`categories.anchor` 含斜杠不可用 |
| 社交分享 | 5% | 15 | 仅 `/marketplace/[slug]` 有 OG/Twitter |
| 内容质量治理 | 10% | 20 | 462 个 <5 站点分类、877 个 <3 站点标签、无索引门槛 |

> 两个分数分开看，不要混：**技术就绪度 28/100**（能否被正常抓取、理解、索引），**内容健康度 12.3/100**（链接策略师按厚度/唯一性/入链/意图四维加权，2171 个名义页面加权均值）。枢纽层 65.0，内容层 12.0 —— 问题 100% 集中在详情页与标签页。

**一句话**：现在的 NavHub 能被收录首页和市场页，但 1020 个最有长尾价值的工具详情页，搜索引擎看到的是同一张空白模板。

---

## 二、实测基线（可复现）

### 2.1 内容资产

| 资产 | 数量 | 有独立 URL | 有描述 | 达标（可索引门槛） |
|---|---:|---|---|---:|
| 站点 | 1020（active 1013） | `/site/{uuid}` | 1020/1020（均长 28.2 字） | 1013 |
| 分类 | 594（enabled） | ❌ 无路由 | **仅 5 个** | 132（≥5 站点，含子分类挂载） |
| 标签 | 1080 行（接口默认 `minCount=1` 返回 1079，1 个 0 站点标签已被滤掉） | `/tags/{slug}` | **0 个** | 82（≥5 站点） |
| 合集 | 4 | `/collections/{slug}` | 4/4 | 4 |
| 插件 | 64 | `/marketplace/{slug}` | 64/64 | 64 |

分类分布（**两种口径必须区分**）：
- 只看 `sites.category_id`（单指针）：`0 站点 489 / 1-4 站点 6 / 5-9 站点 36 / ≥10 站点 63`。
- `category_id ∪ sub_category_id` 去重（双指针，建站用这个）：`<5 站点 462 / ≥5 站点 132`，**真正 0 站点的只有 1 个**。

> 489 与 99 都是单指针造成的假象：站点用 `sub_category_id` 指叶子、`category_id` 指父级，只看父指针会把大量父级分类判成空。按 489 派工会漏掉 33 个真实分类。

> **99 与 132 的口径已定案：按 132 建站。** 只按 `category_id` 直属统计是 99 个；把 `sub_category_id` 也算进来（去重并集）是 **132 个**，覆盖 1005 个站点（98.5%）。多出的 33 个是「仅被当作子分类挂载」的维度（如「国产」7 站、「图像生成」8 站），它们恰好是高意图落地页，不能丢。代价是 **4 个分类同名**（「语言」×2、「操作系统」×2），必须用「父分类 · 子分类」做标题消歧，否则会重演站点页的重复标题问题。

标签分布：`<3 站点 877 / 3-4 站点 121 / 5-9 站点 65 / ≥10 站点 17`。
站点描述分布：`<20 字 71 / 20-39 字 890 / ≥40 字 59`。

### 2.2 渲染与抓取实测（`curl localhost:3000`）

| 检查项 | 实测结果 |
|---|---|
| `/site/{有效 id}` | `HTTP 200`，50,861 字节，`<a>` = 1（skip-link），`<h1>` = 0，站点名出现 **0 次** |
| `/site/{无效 id}` | `HTTP 200`（软 404），title 仍是「站点详情 - NavHub 导航」 |
| `/tags/{slug}` | title「标签详情」，首屏无列表，无 canonical |
| `/collections/{slug}` | title「合集详情」，首屏无列表 |
| `/tags` `/collections` `/hot` `/marketplace` | 首屏分别为「正在加载内容 / 正在加载精选专题… / 正在计算最新榜单排行…」，**0 条内容内链** |
| `/marketplace` | 首屏 4 条 `/marketplace/*` 链接全部是 `mine/publish/installed/import` 子站入口，**0 条插件详情** → 64 个插件页全孤岛 |
| 首页页脚 | 9 条链接：`/ /favorites /graph /algorithms /import /hot /tags /custom /marketplace`，**缺 `/collections`、`/videos`、`/submit`、`/site/`** → `/collections` 入口页本身也是孤岛 |
| 软 404 探针（12 个随机 slug） | **9 个返回 200**：`/site/*`、`/tags/*`、`/collections/*` 各 3/3 全中；`/category/*` 3/3 正确 404（路由不存在） |
| `/` | `<title>NavHub 导航</title>`，1,034 个 `<a>`（约 1021 个外链 + 12 个站内），站内无一条指向 `/site/`；开发环境 HTML **7.5 MB**，其中 5.89 MB 是 RSC flight 数据（生产需按 `next build` 复测） |
| `/sitemap.xml` | **67 条**（3 静态 + 64 插件），`force-dynamic` |
| 响应头 | 全站 `Cache-Control: no-store`；根因是 `lib/storage-adapter.ts:189` 的读路径 `call(url, { method: "GET" })` 未带 `next.revalidate`（Next 16 的 fetch 默认不缓存），不是单纯的 `force-dynamic` |
| `/robots.txt` | 仅 disallow 4 条；输出 `Host: http://localhost:3000`（含协议，非标准） |
| 全站 | `rel="canonical"` = 0，`application/ld+json` = 0 |
| 私密页 | `/marketplace/mine`、`/publish`、`/installed`、`/custom`、`/import`、`/offline`、`/auth/signin`、`/favorites`、`/preferences` 全部 200 且无 `robots` meta |

### 2.3 数据缺口（决定了哪些内容不能写）

| 表/字段 | 状态 | 直接后果 |
|---|---|---|
| `site_relations` | **0 行**，但 API 用 `packages/core/src/ecosystem.ts` 的 `ECOSYSTEM_MAP` 硬编码种子兜底 | 关系区块**会渲染**，但内容不可靠：按 URL 子串匹配，17 个键本意只覆盖 **16 个站点**，但匹配用的是 `includes()` 子串（`ecosystem.ts:183-189`，首个命中即返回），全量跑 1013 条 active 实际命中 **98 站（9.7%）**。其中 `github.com` 一个键就吃掉 **76 站**（`/owner/repo` 型项目页），另有 `developer.mozilla.org` 5、`figma.com` 3、`cursor.com`/`notion.so` 各 2。实测 `ripgrep`、`OpenHands`、`CosyVoice` 均返回同两条「GitLab / Gitee」错误关系。且 `targetSiteId` 全为空，无法转成内链。

> **同一个 `getEnhancedSiteData()` 还产出 `actions`**：`hey`（`github.com/rakyll/hey`）拿到的是 GitHub 平台的「搜开源库 / Trending」，渲染在首页卡片（`navigation-card.tsx:354/498/512`）与悬停预览（`site-peek-dialog.tsx:139`）。这**不算事实错误**（按钮确实去 GitHub），只列为 P2 设计确认；真正的问题是 `relations`——仓库页被说成「GitLab 是你的平替」。 |
| `site_facets` | **0 行** | 分面属性胶囊区块永不渲染 |
| `tags.description` | 0 / 1080 | 1080 个标签页正文只有一句模板话 |
| `categories.description` | 5 / 594 | 分类页即使建了也无导语 |
| `sites.last_checked_at` | 146 / 1020 | 874 个页面不能写"核验时间" |
| `visit_count` / `trend_score` / `featured` | 全为 0 | `/hot` 没有真实热度信号，"按真实点击排序"是不成立的陈述 |
| `plugins.install_count` | 0–1（11 个 >0） | 插件页不能写"热门""N 人使用" |
| 重复站点标题 | 10 组 / 20 条 | 4 组可自动归一（`www`）、4 组需产品确认（ChatGPT、Todoist、Windsurf、remove.bg）、2 组同名异物必须保留（HELM、LangGraph） |

---

## 三、根因：不是四个问题，是一条链断了

```
客户端组件承担了页面主体
   → 首屏只有骨架，正文和链接都不在 HTML 里
   → 爬虫拿不到内容，也走不到下一层
   → 只能靠 sitemap 发现，但 sitemap 只覆盖 3.1%
   → 1020 + 1080 个页面成为孤岛
   → 孤岛页的 title 又是同一个模板 → 重复标题、无排名信号
```

因此修复顺序必须是：**先让内容进 HTML（渲染）→ 再让地址确定（canonical/metadataBase）→ 再让爬虫走得到（sitemap + 内链）→ 最后才是结构化数据和文案**。反过来做（先堆 JSON-LD、先写描述）不会有效果。

---

## 四、索引策略：1305 个页面，不是 2171 个

**原则：宁可少收录 900 个薄页，不要让它们拖垮 1000 个好页。**

| 页面类型 | 总量 | 门槛 | 索引 | 处置 |
|---|---:|---|---:|---|
| 站点详情 | 1020 | active | **1013** | index；7 条非 active 返回 404 |
| 分类 hub | 594 | ≥5 站点（含子分类） | **132** | <5 站点不建路由（404），不做 noindex 空页 |
| 标签页 | 1080 | ≥5 站点 | **82** | 见下方裁决 |
| 合集 | 4 | 全部 | **4** | index |
| 插件详情 | 64 | 已上架 | **64** | index |
| 静态页 | 9 | — | **9** | `/`、`/marketplace`、`/hot`、`/tags`、`/collections`、`/graph`、`/algorithms`、`/videos`、**`/sites`（新增目录）**；`/submit` 不进 sitemap（仍可被导航发现），`/category` 随分类 hub 一起加 |
| 私密/工具页 | ~14 | — | 0 | 见 §5.3 |
| **合计** | 2171 | — | **≈1305** | sitemap 覆盖率 100%；口径差异：名义可索引 2171（含 998 个薄标签），过完阈值后提交 sitemap 的是 1305；其他报告按 11 条静态页计为 1174，差异仅 2 条、只在静态页计数，不影响任何结论 |

**分两步达成**（重要）：

- **W1 先到 ≈1172**：1013 站点 + 82 标签 + 4 合集 + 64 插件 + 9 个静态页（含新增 `/sites`）。这一步不依赖分类 slug，可立刻上线。
- **分类 hub 上线后再到 ≈1305**：+132 个分类 + `/category` 索引页。

别把 1305 当成第一周的验收数字：分类 hub 是独立的开发任务（可用 `/category/{id}` 先上线，不等 slug），它没做完之前，sitemap 就停在 1172。

> **`follow` 的两种语义，别让 dev 写成同一句**：
> - `{index:false, follow:true}` = **页面存在，只是不收录**（薄标签、分页页第 2 页起）——内链照常传递。
> - `{index:false, follow:false}` = **实体不存在**（无效 `/site/{id}`、不存在的 slug）——不要跟随，避免把错误链接继续传下去。

### 4.1 薄标签的处置裁决（两位成员意见不同，这里定稿）

- 内容编辑主张：998 个 ≤4 站点标签 `noindex,follow` 保留页面。
- 链接策略主张：不生成路由，404/301。

**定稿：分两阶段，兼顾风险与预算。**

| 档位 | 数量 | 索引 | 卡片 `#tag` |
|---|---:|---|---|
| ≥5 站点 | 82 | index,follow + sitemap + 标签云可见 | ✅ `<Link>` |
| 2-4 站点 | 287 | 200 + `noindex,follow`，不进 sitemap | ✅ `<Link>`（页面有 2-4 个同类工具，导航有用） |
| 1 站点 | 710 | 200 + `noindex,follow`，不进 sitemap | ❌ `<span>`（内容 ≡ 该站点详情页，链过去是自指） |
| 0 站点 | 1 | 404（接口默认 `minCount=1` 已不返回它） | ❌ |
| 不存在的标签名 | — | 404（`/api/tags/resolve` 返回 miss） | — |

> 卡片标签链接范围 = **82 + 287 = 369 个**，不是 82 个。4 周后看 GSC：若 2-4 站点标签页 0 展示 0 点击，再降级为 `<span>`（可逆）。

理由：**不用 301/410 处理薄标签**。标签计数会变（今天 2 站、明天 6 站），301 不可逆；而 410 会让未来可能达标的标签永久损失历史。统一 200 + `noindex,follow` + 不进 sitemap + 站内不链接，是唯一可逆的方案。**关键是"切断入口"**：只写 noindex 而不从标签云和 sitemap 移除，等于没做。

---

## 五、分阶段落地方案

### Phase 0（2-3 天）三个前置条件，不做的话后面全是白工

#### 0.1 新增站点 URL 变量（**不要复用 `NAVHUB_PUBLIC_URL`**）

`.env.example` 里 `NAVHUB_PUBLIC_URL` 与 `PORT=8787` 相邻、示例值是 `http://localhost:8787`，语义上服务的是**中枢 API 自己的对外地址**；而 `docker-compose.yml` 的 `navhub-web` 服务并没有注入它。一个变量不应同时承担「API 地址」与「站点地址」两种语义——拿它当 `metadataBase`，canonical 很可能会写成 API 域名。

```bash
# .env.example / docker-compose.yml（navhub-web 服务）
NAVHUB_SITE_URL=https://你的域名      # 站点对外地址，仅 web 用
```

```ts
// apps/web-overlay/src/lib/seo/origin.ts
import { headers } from 'next/headers'

/**
 * 站点对外 origin。
 * 优先读环境变量：只有这样才能让 sitemap / 详情页走 ISR 静态缓存；
 * 缺失时才回退请求头（此时相关路由会退化为动态渲染，属可接受的降级）。
 */
export async function siteOrigin(): Promise<string | null> {
  const configured = process.env.NAVHUB_SITE_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')

  const h = await headers()
  const host = h.get('x-forwarded-host')?.split(',')[0]?.trim() || h.get('host')
  if (!host) return null
  const proto = (h.get('x-forwarded-proto') ?? 'https').split(',')[0]!.trim()
  return `${proto}://${host}`
}
```

> 顺带修两个既有 bug：`sitemap.ts:25` 与 `robots.ts:16` 的协议兜底是 `'http'`（应 `'https'`），且只认 `host`、不认反代常发的 `x-forwarded-host`。

#### 0.2 站点去重（否则 title 一定撞车）

10 组重复标题按可自动化的程度分三档，**不要等全部处理完才发 sitemap**：

| 档位 | 组 | 处置 |
|---|---|---|
| A 可自动归一（4 组） | Cloudflare、Cursor、Midjourney、魔搭 ModelScope（`www` vs 裸域，归一化后 URL 完全相同） | 保留一条，另一条 `deleted_at` + `redirect_to`；`/site/{旧id}` 301 到保留 id |
| B 需产品确认（4 组） | ChatGPT（`chat.openai.com` vs `chatgpt.com`）、Todoist（`/` vs `/zh-CN`）、Windsurf（`.ai` vs `.com`）、remove.bg（`/` vs `/zh`） | 本轮**不阻塞**：title 加「` · {域名}`」消歧，产品确认后再合并 |
| C 必须保留（2 组） | HELM（Stanford 评测基准 vs k8s 包管理器）、LangGraph（仓库 vs 产品页） | 保留两条，title 加消歧后缀 |

动作顺序：先做 A（半天），sitemap 照发；B 进产品待办；C 只加消歧，不合并。另在 `seed-data` 源头加域名归一化校验，防止下次 seed 又灌回来。

#### 0.3 分类 slug

`categories.anchor` 不可直接做 URL：101 个是纯 UUID，另有一批是 `parentUuid/childUuid` 路径串（实测）。

- 新增 `categories.slug`（`title` 转拼音 + 冲突加序号，唯一索引），迁移脚本放 `packages/store`。
- API `/api/categories` 暴露 `slug`。
- **回填完成前**先用 `/category/{id}` 上线（难看但能立刻解决 132 个 hub 的有无问题），slug 就绪后 301 到可读形态。

---

### Phase 1（第 1 周）索引地基

#### 1.1 metadataBase + canonical

```ts
// apps/web-overlay/src/app/layout.tsx —— generateMetadata 内
import { siteOrigin } from '@/lib/seo/origin'

export async function generateMetadata(): Promise<Metadata> {
  const site = await getFileContent<...>(SITE_PATH)
  const siteName = site?.basic?.title ?? 'NavHub'
  const origin = await siteOrigin()

  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: { default: siteName, template: '%s - ' + siteName },
    description: 'AI 原生的网址导航',
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, statusBarStyle: 'default', title: 'NavHub' },
    icons: { icon: site?.appearance?.favicon ?? '/icons/icon-192.png' },
  }
}
```

canonical 一律写**相对路径**（交给 metadataBase 解析），业务代码不拼域名：

| 模板 | canonical |
|---|---|
| 静态页 | `alternates: { canonical: '/tags' }` |
| 站点详情 | `alternates: { canonical: `/site/${id}` }` |
| 标签 | `alternates: { canonical: `/tags/${encodeURIComponent(tag.slug)}` }` |
| 分类 | `alternates: { canonical: `/category/${slug}` }` |
| 分页 | `alternates: { canonical: `/category/${slug}?page=${n}` }`（**不要**把第 2 页 canonical 回第 1 页，否则第 2 页的站点永不收录） |

#### 1.2 修正 title.template 继承断链

实测：`/site/{id}` 渲染为「站点详情 - NavHub 导航」，而 `/tags/{slug}` 只有「标签详情」、`/collections/{slug}` 只有「合集详情」——因为中间层 `tags/layout.tsx`、`collections/layout.tsx` 定义了字符串 title，根 layout 的 `template` 不再向下继承。

修法（不复制品牌名）：把这两个 layout 的 `title` 改成对象并显式带 template，或更彻底——**删掉中间层 layout 的 title，由页面层 `generateMetadata` 提供完整标题（`title: { absolute: ... }`）**。推荐后者，因为这三个动态路由本来就要改成服务端页面。

#### 1.3 noindex 与 robots.txt 的分工（**别对同一 URL 同时做两件事**）

`robots.txt` 的 disallow 会让爬虫**读不到**页面里的 noindex。所以二者只能选一个：

| 路径 | robots.txt | 页面 `robots` | 说明 |
|---|---|---|---|
| `/admin`、`/api/` | Disallow | — | 无需被理解，直接不抓 |
| `/s/`（短链） | Disallow | — + 响应头 `X-Robots-Tag: noindex` | 短链不应进索引 |
| `/favorites`、`/preferences`、`/custom`、`/import`、`/offline`、`/auth/*`、`/marketplace/{mine,publish,installed,import}`、`/videos/player` | **不 Disallow** | `index:false, follow:true` | 可能存在站外链接，必须让爬虫抓到 noindex |
| 薄标签/薄分类 | 不 Disallow | `index:false` | 见 §4.1 |

```ts
// 私密页统一写法（layout 或 page 的 metadata）
export const metadata: Metadata = {
  title: '我的插件',
  robots: { index: false, follow: true },
}
```

robots.txt 同时修正：去掉 `Host:`（Yandex 专用且带协议不规范），sitemap 指向 `siteOrigin()`。

#### 1.4 sitemap 扩容：67 → ≈1172（不含分类）/ 1305（分类上线后），单文件即可

Next 单文件上限 50000 URL / 50MB，1172 条远未触顶。上一版方案建议 5 个分片属于过度设计，而且有一个坑：**`generateSitemaps` 并不会自动生成 `/sitemap.xml` 索引**，无 id 的 `/sitemap.xml` 会直接 404 —— robots 指向它等于提交失败。真要分片，必须自写 `app/sitemap.xml/route.ts` 返回 `<sitemapindex>` 并删除 `app/sitemap.ts`（同路径不能并存）。本期不分片。

```ts
// apps/web-overlay/src/app/sitemap.ts
import type { MetadataRoute } from 'next'
import { siteOrigin } from '@/lib/seo/origin'

export const revalidate = 3600

const MIN_SITES_FOR_INDEX = 5

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await siteOrigin()
  if (!origin) return []

  const core: MetadataRoute.Sitemap = [
    '/', '/marketplace', '/hot', '/tags', '/collections',
    '/graph', '/algorithms', '/videos', '/submit', '/category',
  ].map((p) => ({ url: `${origin}${p}`, changeFrequency: 'weekly', priority: p === '/' ? 1 : 0.6 }))

  // 站点：limit 上限 1000，active 1013 条需翻两页
  const sites = []
  for (const offset of [0, 1000]) {
    const page = await hubGet<HubSite[]>(`/api/sites?limit=1000&offset=${offset}&status=active`, 3600)
    if (page?.length) sites.push(...page)
  }

  // 分类计数由站点列表聚合，避免新增接口
  const perCategory = new Map<string, number>()
  for (const s of sites) perCategory.set(s.categoryId, (perCategory.get(s.categoryId) ?? 0) + 1)

  const categories = (await hubGet<HubCategory[]>('/api/categories', 3600)) ?? []
  const tags = (await hubGet<HubTag[]>('/api/tags', 3600)) ?? []
  const collections = (await hubGet<HubCollection[]>('/api/collections', 3600)) ?? []
  const plugins = await loadPublishedPlugins(origin) // 复用现有实现

  return [
    ...core,
    ...sites.map((s) => ({
      url: `${origin}/site/${encodeURIComponent(s.id)}`,
      lastModified: new Date(s.updatedAt),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...categories
      .filter((c) => (perCategory.get(c.id) ?? 0) >= MIN_SITES_FOR_INDEX && c.slug)
      .map((c) => ({ url: `${origin}/category/${c.slug}`, changeFrequency: 'weekly' as const, priority: 0.6 })),
    ...tags
      .filter((t) => t.count >= MIN_SITES_FOR_INDEX)
      .map((t) => ({ url: `${origin}/tags/${encodeURIComponent(t.slug)}`, changeFrequency: 'weekly' as const, priority: 0.5 })),
    ...collections.map((c) => ({ url: `${origin}/collections/${encodeURIComponent(c.slug)}`, priority: 0.5 })),
    ...pluginSitemapEntries(origin, plugins),
  ]
}
```

> 注意：现有 `/api/sites` 返回的是**数组**，不是 `{ items, total }`（`apps/api/src/routes/sites.ts:35`）。上一版方案的 `body?.items` 写法会拿到空数组。

验收：`curl -s $SITE/sitemap.xml | grep -c '<url>'` ≥ 1100（W1，不含分类）/ ≥ 1250（分类 hub 上线后）；`curl -sI` 看是否有缓存头（设置 `NAVHUB_SITE_URL` 后应为可缓存，而不是每次打穿中枢）。

---

### Phase 2（第 2 周）把 2100 个空壳变成真页面

#### 2.0 先修缓存：不改这一行，后面所有 `revalidate` 都是装饰品

`lib/storage-adapter.ts:189` 的 HTTP 读路径：

```ts
async read(path: string) {
  throwIfCoolingDown();
  return call(base + "/api/storage?path=" + encodeURIComponent(path), { method: "GET" });
}
```

`fetch` 没有 `next.revalidate`，Next 16 默认不缓存 → 每次请求都打穿中枢 → 根 layout 的 `generateMetadata` 又把整个路由拖成动态 → 于是即使页面写了 `export const revalidate = 3600` 也不会生效。

```ts
// 读：按路径打 tag，默认 30 秒
return call(base + "/api/storage?path=" + encodeURIComponent(path), {
  method: "GET",
  next: { revalidate: Number(process.env.NAVHUB_STORAGE_REVALIDATE ?? 30), tags: ["storage:" + path] },
} as RequestInit)

// 写成功后：立刻让该路径失效，后台改完仍然即时可见
import { revalidateTag } from "next/cache"
revalidateTag("storage:" + path)
```

> `call()` 的 `RequestInit` 类型需要扩展 `next` 字段（Next 的 `RequestInit` 已包含）。后台写后读的一致性靠 `revalidateTag` 保证，不靠 `no-store`。
> 验收：改完后 `curl -sI /site/<id> | grep -i cache-control` 不应再是 `no-store`。

#### 2.1 服务端取数封装

```ts
// apps/web-overlay/src/lib/server/hub.ts —— 仅服务端可用
const HUB_BASE = (
  process.env.NAVHUB_STORAGE_BASE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:8787'
).replace(/\/$/, '')

export async function hubGet<T>(path: string, revalidate = 3600): Promise<T | null> {
  try {
    const res = await fetch(`${HUB_BASE}${path}`, {
      next: { revalidate },
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}
```

> **文案里的 `{N} 个同类站点` 必须与分类 hub 同口径（`category_id ∪ sub_category_id` 去重）**，否则元信息写 21、页面只列 14，用户一眼就能看出矛盾——这比文案空更伤可信度。

#### 2.2 `/site/[id]`：服务端壳 + 客户端交互

```tsx
// apps/web-overlay/src/app/site/[id]/page.tsx  ← 去掉 'use client'
import { notFound, permanentRedirect } from 'next/navigation'
import type { Metadata } from 'next'
import { hubGet } from '@/lib/server/hub'
import { SiteDetailClient } from './site-detail-client' // 原 page.tsx 原样搬入

export const revalidate = 3600

type HubSite = { id: string; title: string; description?: string; url: string; categoryId: string; updatedAt: number }
type HubCategory = { id: string; title: string; slug?: string }

async function loadSite(id: string) {
  const site = await hubGet<HubSite>(`/api/sites/${encodeURIComponent(id)}`)
  if (site) return site
  // 被合并的老 id：查不到时尝试中枢的 redirect 记录（Phase 0.2 写入）
  return null
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const site = await loadSite(id)
  if (!site) return { title: '页面不存在', robots: { index: false, follow: false } }

  const categories = (await hubGet<HubCategory[]>('/api/categories')) ?? []
  const cat = categories.find((c) => c.id === site.categoryId)
  const desc = (site.description ?? '').trim()
  const title = `${site.title} - ${cat?.title ?? '工具'}与同类站点`
  const description = `${desc || `${site.title} 官网入口`}在 NavHub 查看 ${site.title} 官网、${cat?.title ?? '同类'}分类下的同类站点与标签入口。`

  return {
    title,
    description: description.slice(0, 78),
    alternates: { canonical: `/site/${encodeURIComponent(id)}` },
    openGraph: { title, description: description.slice(0, 78), type: 'website', url: `/site/${encodeURIComponent(id)}` },
    twitter: { card: 'summary', title, description: description.slice(0, 78) },
  }
}

export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const site = await loadSite(id)
  if (!site) notFound()                 // 真 404，消灭软 404
  return <SiteDetailClient initialSite={site} siteId={id} />
}
```

客户端组件里补两样服务端拿不到的东西：`<h1>{site.title}</h1>` 与面包屑入口（若 `SiteDetailClient` 不便改，就在 server page 的 wrapper 里渲染 `<h1 className="sr-only">` + `<Breadcrumbs>`，视觉不变但爬虫可见）。

#### 2.3 `/tags/[slug]`：先解析标签，再 SSR 前 20 条

```tsx
// apps/web-overlay/src/app/tags/[slug]/page.tsx（改为服务端组件）
import { notFound, permanentRedirect } from 'next/navigation'

export const revalidate = 1800

export async function generateMetadata({ params }): Promise<Metadata> {
  const { slug } = await params
  const resolved = await hubGet<{ ok: boolean; tag: { name: string; slug: string } }>(
    `/api/tags/resolve?q=${encodeURIComponent(slug)}`,
  )
  if (!resolved?.ok) return { title: '标签不存在', robots: { index: false, follow: true } }

  const tag = resolved.tag
  const list = await hubGet<{ items: HubSite[] }>(`/api/search?tag=${encodeURIComponent(tag.slug)}&limit=20`)
  const n = list?.items?.length ?? 0
  const indexable = n >= 5

  return {
    title: `${tag.name}相关工具（${n} 个）`,
    description: `NavHub 收录 ${n} 个 #${tag.name} 站点，包含 ${(list?.items ?? []).slice(0, 3).map((s) => s.title).join('、')}。附一句话简介与官网直达。`.slice(0, 78),
    alternates: { canonical: `/tags/${encodeURIComponent(tag.slug)}` },
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
  }
}
```

同时：URL 只认 `slug`，`name` 形态（328 个标签存在 `name ≠ slug`）301 到 slug 形态；标签不存在时 `notFound()`。

> `/api/search?tag=` 返回 `{ items, hasMore, ... }`，单次 limit 需与前端一致；建议 SSR 前 20 条，客户端"加载更多"。

#### 2.4 `/collections/[slug]`

`/api/collections/:slug` 已返回 `{ collection, sites }`，直接服务端渲染 + `generateMetadata`，title 用「合集名 - N 个站点」。

> **`notFound()` 与真实 metadata 必须同一个 PR 上线**：只上 404 会让 1020 个页面从索引里消失得更快；只上 metadata 而无效 id 仍返回 200，则软 404 继续。两者是同一个交付单元。

#### 2.5 首页：保留动态取数，但改成 ISR

首页现在 `force-dynamic` 的理由是"构建期会把 title 固化"——ISR 正好解决：构建后每次 revalidate 重新读中枢，既拿到真实标题，又不必每个爬虫请求都打穿中枢。

```ts
export const revalidate = 300   // 取代 export const dynamic = 'force-dynamic'
```

`/submit` 保留动态（表单需要实时类目）；`/admin/**` 保留动态 + noindex。

---

### Phase 3（第 3 周）先上 `/sites` 目录，再上分类 hub

#### 3.0 `/sites` 极简目录（1-2 天，先解孤岛）

不依赖 slug、不依赖分类计数、不改首页卡片，**只需要一个页面**：分页列出全部 1013 个站点，标题是内链。

```
/sites?page=1 … 17    60 条/页   标题 → /site/{id}
```

- 数据源用 **`hubGet('/api/sites?status=active&limit=60&offset=N')`**（服务端直连中枢 `:8787`），不要用 `/api/search?q=`：后者返回 1020 条（含 7 条非 active）、没有 `total`，且 `offset=1013` 直接 400。
- **别在 web 侧调 `/api/sites`**：实测 `:3000/api/sites` 是 **404**（`app/api/` 下没有该路由，rewrites 只代理 `/api/auth/*`）；走 `:3000/api/hub/api/sites` 才通（BFF），服务端则直接 `hubGet`。不要为此新建 `app/api/sites/route.ts`，多一层转发。
- 页数：active 1013、每页 60 → **17 页**，末页 53 条；`hasMore = items.length === 60`。
- 入口：首页加 1 条「全部站点目录」链接（页脚或分类区顶部），爬虫一跳即可到达。
- metadata：页 1 可索引 + 自指 canonical；**页 ≥2 用 `{index:false, follow:true}` + 自指 canonical**（不能指回页 1，否则 2-17 被当重复页丢弃；`follow` 绝不能 false，否则内链传递失效）。sitemap 只放 `/sites` 一条。
- 标题与描述（定稿）：`全部站点目录（1013 个）` / `NavHub 收录的 1013 个站点，按收录顺序分页列出，每页 60 个，可进入详情查看简介、分类与标签。`（不写形容词，只报可验证数字）
- 分页 UI 用可见 `<a href="?page=N">`（不要用 Google 已弃用的 `rel=prev/next`）；`?page=1` 与 `/sites` 同页，**308 到 `/sites`**。
- 链接预算：60 条站点 + 4 条分页（首/上/下/末）+ 页脚 9 条 = **73**，`/sites` 单页上限 80。
- 收益：1013 个详情页的点击深度从 ∞ 降到 2，是成本最低的孤岛解法。

> 这一步是「分类 hub 的应急平替」，不是终态。分类 hub 上线后 `/sites` 保留（它承接「全部工具」这种泛意图），但首页只留一条入口。

#### 3.0.1 顺手关掉 69 个孤岛（1 天，与 `/sites` 同批）

这三条是 `scripts/link-graph.mjs` 跑出来的，改动都很小：

| # | 改动 | 影响 |
|---|---|---|
| 1 | 页脚加 `/collections`（建议同时补 `/videos`、`/submit`、`/site`） | 消灭 5 个孤岛：`/collections` 入口 + 4 个合集详情 |
| 2 | `/marketplace` 的插件卡片改成 **SSR 输出详情内链**（现在首屏 4 条 `/marketplace/*` 全是 `mine/publish/installed/import`，0 条插件详情） | 消灭 **64 个**插件页孤岛 |
| 3 | 三个动态路由的 `notFound()` + `robots` 兜底（见 Phase 2.2-2.4） | 关掉 9/12 的软 404 探针 |

做完这三条 + `/sites` + 卡片标签链接，孤岛会从 2163 降到约 **710**——剩下的几乎全是 1 站点标签，它们按设计保持 `<span>`、不参与内链，属于预期内的"不可达"。因此验收目标写「内容页孤岛 ≤10」，而不是「全站孤岛 ≤40」。

#### 3.1 分类 hub：132 个页面接住 1005 个站点

```
L1 首页 → L2 /category/{slug}（132 个）→ L3 /site/{id}（1013 个）
```

- **不必等 `categories.slug` 迁移**：`/category/{id}` 用 UUID 就能上线，slug 只是可读性优化（就绪后 301 过去）。因此分类 hub 不需要降级成"下一轮"，它是 W3 可交付项。
- 门槛：站点数（`category_id` 或 `sub_category_id`，去重）≥5 才生成；<5 直接 `notFound()`（不生成空页）。
- 4 个同名分类（「语言」×2、「操作系统」×2）标题用「父分类 · 子分类」消歧，否则重演重复标题。
- 每页：`<h1>{分类名}工具</h1>` + 60 字导语 + 站点列表（≤60 条，标题内链）+ 兄弟分类 5-8 个 + 高频标签 5 个。
- 分页：`?page=N`，60 条/页，页 1 可索引，页 ≥2 `{index:false, follow:true}` + 自指 canonical（统一口径，见 §3.0）；排序/筛选参数一律 noindex。
- `/category` 索引页：132 条分类链接，一次喂给爬虫。

> 分类描述只有 5/594 有值，导语必须按模板生成并人工抽检（见 §6.3）；取不到子分类就删掉那一句，不留占位。

---

### Phase 4（第 4 周）结构化数据与分享卡

**红线：不要编造 `aggregateRating` / `reviewCount` / `installCount`。** 本站这三类数据全是 0/1，伪造会被人工处罚。

| 页面 | Schema | 备注 |
|---|---|---|
| 首页 | `WebSite`（name/url/description）+ `Organization`（logo） | `SearchAction` **暂不声明**：首页还不读 `?q=`，声明了就是无效标注 |
| 站点/分类/标签/合集 | `BreadcrumbList` | 与可见面包屑同源 |
| 分类/标签/合集 | `ItemList`（前 30 条） | 列表型富结果 |
| 插件详情 | `SoftwareApplication`（name/description/applicationCategory） | 不加评分 |

```tsx
// apps/web-overlay/src/components/json-ld.tsx（服务端组件，无 'use client'）—— 已落地
import { jsonLdScript } from '@/lib/seo/json-ld'
export function JsonLd({ data }: { data: unknown }) {
  // 必须过 jsonLdScript()：站点标题来自数据库，裸 JSON.stringify 拼 </script> 可越狱
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }} />
}
```

已落地范围（2026-10-21 09:26 更新）：首页 `WebSite`、`/sites` `BreadcrumbList` + `ItemList`、插件详情与 `/graph` 的 `BreadcrumbList`、插件详情 `SoftwareApplication`（无评分无 offers）。
纯函数与单测在 `src/lib/seo/json-ld.ts` / `test/json-ld.test.ts`（24 用例）。
**三条已守住的红线**：不写 `SearchAction`（无 `/search` 页面）；不写 `aggregateRating` / 假 star；必须过 `jsonLdScript()` 转义。

OG 落地口径（实测确认）：根 layout 的 `openGraph`（site_name/locale/images）与各页自定义字段是**字段级合并**（子页定义 `openGraph.url` 不会丢掉根布局的 og:image），因此每页只需补 `og:url`。
`og:url` 只加在叶子页（`/`、`/hot`、`/algorithms`、`/videos`、`/submit`、`/graph`、`/sites`、`/marketplace`）；
`/tags`、`/collections` 的 hub layout **故意不加** og:url——会被 `/tags/[slug]`、`/collections/[slug]` 继承成错误地址（与中间层不加 canonical 同一陷阱），详情页的 og:url 由 Phase 2 逐页 metadata 产出。

OG：至少覆盖首页、站点详情、标签、分类、合集（现在只有插件详情有）。`og:image` 可用统一的 `/icons/icon-512.png` 兜底，插件页保留现有 `opengraph-image.tsx`。

**未来项**：等首页真正支持 `?q=` 后再加 `SearchAction`，这是拿到站内搜索框富结果的前提，现在加等于撒谎。

---

### Phase 5（第 5-6 周）内链架构：把 99.4% 的孤岛打下来

#### 5.1 为什么孤岛是 2163 个，而不只是"卡片是外链"

实测首页 1,034 个 `<a>` 里约 1,021 个是外链、12 个站内链接，**没有一条指向 `/site/`**；`/tags`、`/collections`、`/hot` 首屏 0 条内容链接。也就是说：爬虫从首页出发，第二层只能到 8 个枢纽页，第三层只有 4 个插件详情。

#### 5.2 卡片双模式（不牺牲"一键直达"）

`<a>` 不能嵌套，所以取消"整卡包一个 `<a>`"的结构，改成**拉伸外链（z-0）+ 内容层（z-10，pointer-events-none）+ 站内入口（z-20，pointer-events-auto）**：

```tsx
// components/navigation-card.tsx（三处密度：152 / 280 / 446 行同构改造）
<div className="group relative ...">
  {/* 主点击：直达目标站，覆盖整卡但不含文本 */}
  <a href={safeHref(item.href)} target={linkTarget} rel="noopener noreferrer"
     data-prefetch-target="true" onClick={handleLinkClick}
     aria-label={`访问 ${item.title} 官网（新窗口打开）`}
     className="absolute inset-0 z-0 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/50" />

  <div className="relative z-10 pointer-events-none flex items-center gap-2 min-w-0 flex-1">
    {/* 标题：站内详情入口（仅分类页/标签页启用） */}
    {enableInternalLink ? (
      <Link href={`/site/${item.id}`} onClick={(e) => e.stopPropagation()}
            className="pointer-events-auto truncate hover:text-primary hover:underline">
        {item.title}
      </Link>
    ) : (
      <span className="truncate">{item.title}</span>
    )}
  </div>

  {/* 角落站内入口：爬虫与键盘的稳定落点 */}
  <Link href={`/site/${item.id}`} aria-label={`查看「${item.title}」详情`}
        className="absolute -top-1.5 -right-1.5 z-20 pointer-events-auto rounded-full border border-border/70 bg-card/90 p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
    <Info className="w-3 h-3" aria-hidden="true" />
  </Link>
</div>
```

**启用范围（关键取舍）**：

| 页面 | 标题内链 | 角落入口 | 理由 |
|---|---|---|---|
| **`/sites` 目录** | ✅ 全部卡片 | 不需要 | 目录页的唯一目的就是"进详情"，标题内链是自然动作；60 条/页，翻页覆盖 1013 个站点 |
| 分类 hub / 标签页 | ✅ 全部卡片 | ✅ | 同上，且这些页面本身是聚合落地页 |
| 首页 | ❌ 不动 | ❌ 不加 | **一张卡片都不改**，只加 1 条「全部站点目录 → `/sites`」入口；首页继续承担一键直达 |

> 为什么不让首页标题变内链：标题是"我想去这个站"意图最强的点击点，1020 张卡全改会实打实伤转化；而 `/sites` 用 17 个分页就拿到同样的 1013 条入链，UX 成本为零。这是本方案对"孤岛"最省事的解法。

**三条硬约束**：

1. **首页必须由 SSR 输出 132 条 `/category/{slug}` 链接**。当前首页 `NavigationContent` 是客户端组件，分类链接在首屏 HTML 里一条都没有。首页链接预算从 1020 降到约 145（9 导航分类 + 132 分类 + 页脚），这是把"1020 个孤岛"变成"三层可爬结构"的前提。
2. **卡片上的 `#tag` 给 369 个 ≥2 站点标签渲染 `<Link>`**（82 个索引 + 287 个 noindex），**710 个 1 站点标签保持 `<span>`**——后者点进去是只含 1 个站点的列表页，等于自指。
3. **卡片改动只动 `navigation-card.tsx` 的 152 / 280 / 446 三处**（`<Link>` 元素起始行；`href` 在 153/281/447，紧凑/丰富/标准三种密度），`ResourceCard.tsx` 在 overlay 里不存在，不要改镜像。首页三种密度**全部保持现状**，`/sites` 与分类/标签页通过 props 传入 `detailLinkMode="title"`。

#### 5.3 被浪费的 2231 个内链槽位

`navigation-card.tsx:334` 的 `#{tag}` 目前是 `<span>`。`site_tags` 共 2231 行（均值 2.19/站），改成 `<Link href={`/tags/${slug}`}>` 即可，零风险。**但只给 82 个 ≥5 站点标签渲染链接**——否则点进去只有一个站点的列表页，体验是负的。

#### 5.4 面包屑（可见 + JSON-LD 同源）

`components/breadcrumbs.tsx`，纯服务端、零 hooks；`origin` 只能从 `siteOrigin()` 传来，**禁止读 `window.location`**（SSR/CSR 不一致会 hydration mismatch）。可见 DOM 只用相对 href，JSON-LD 用绝对 URL。

#### 5.5 三角互链规则

| 页面 | 必须出链 | 上限 |
|---|---|---:|
| 首页 | `/sites` 1 条；9 个导航分类 → `/category/{slug}`；132 分类折叠区 | 内链 ≤150 |
| `/sites` 目录 | 站点 60（标题内链）+ 翻页 1-2 | 62 |
| 分类 hub | 上级分类 1-2、子分类 2-6、站点 20-60、高频标签 3-5 | 70 |
| 标签页 | `/tags`、共现标签 3-5、站点 20-50、相关分类 1-2 | 60 |
| 站点详情 | 面包屑、同分类 6-8、同标签 2-3、官网外链 1 | 12 |

锚文本：禁止"查看详情 / 点击进入 / 了解更多"，用「{站点名}」「{标签名}相关工具」「浏览全部 {N} 个 {分类名}工具」。

> **本轮所有页面不上「平替」措辞**：title、description、锚文本、JSON-LD 一律只写「官网入口 + 分类 + 同类站点」，直到 `ECOSYSTEM_MAP` 的 98 站误配修完（见 §6.2）。锚文本承诺什么，页面就得真的给什么。

---

### Phase 6（第 7-8 周）性能与内容生产

#### 6.1 性能

| 项 | 现状 | 动作 |
|---|---|---|
| 首页 | `force-dynamic`；开发环境 7.5MB（5.89MB 是 flight 数据） | `revalidate=300`；**先按生产构建复测**，若仍 >1.5MB，则首屏只 SSR 3 个分类、其余 `content-visibility:auto` + IntersectionObserver 补齐 |
| 详情页 | `Cache-Control: no-store` | 源站取数走 `hubGet(..., 3600)`，页面 `revalidate=3600` |
| 图片 | `images.remotePatterns` 默认 `https://**` | 生产用 `NAVHUB_IMAGE_HOSTS` 白名单 |
| 播放页 | `/videos/player?id=xxx` | 改 `/videos/player/[id]`，旧 `?id=` 301 |
| 预取 | 卡片 `data-prefetch-target` | 内链改造后回归验证，避免预取全部详情页 |

#### 6.2 站点详情页内容块（只写有数据的）

| 内容块 | 数据来源 | 覆盖率 | 缺数据时 |
|---|---|---:|---|
| 是什么 | `sites.description` | 100%（71 条 <20 字） | <12 字只写"官网入口"，不扩写 |
| 标签入口 | `site_tags` | 100% | — |
| 同分类站点 | `category_id` | 100% | — |
| 最后核验 | `last_checked_at` | 14.3% | 整行隐藏，不显示当前时间 |
| 平替 / 生态 | `ECOSYSTEM_MAP` 种子（`site_relations` 空表） | 覆盖率低且不可靠 | 先修匹配：**只把键改细到 host+path 不够**——`ECOSYSTEM_MAP` 用的是子串 `includes`，`github.com/langchain-ai/langgraph` 仍会被 `github.com` 键吃掉。而且它是**首个命中即返回**：键的顺序就是优先级，往表里加一个短键会静默改写存量站点的归类。正解是「归一化 URL 精确全等」或「按 `sourceSiteId` 的显式白名单映射」——**推荐白名单**，它没有顺序语义，加谁是加谁，且顺带补上 `targetSiteId`，平替卡就能直接出内链。修完再上线，不要渲染"暂无平替" |
| 分面属性 | `site_facets` | **0%** | 删除 |
| 适合谁 | 无字段 | 0% | 删除 |

> **平替数据的修复顺序不能颠倒**：先修匹配（精确全等 / `siteId` 白名单）→ 再补 `targetSiteId` → 最后才放开平替文案与内链。若先补外键，76 个错误关系会从「错误外链」变成「错误站内链接」，污染面从站外转入站内，更难回滚。

#### 6.3 文案生产

- 132 个 ≥5 站点分类 + 82 个 ≥5 站点标签：按模板生成（变量来自 DB：计数、Top3 代表站、主分类），每批 10% 人工抽检。
- `开源`(123)、`国产`(34) 两个核心标签**人工手写**，模板不够用。
- 站点 title 公式：`{站点名} - {分类名}与同类站点`；description：`{原描述}在 NavHub 查看 {站点名} 官网、{分类名}下 {N} 个同类站点与标签入口。`
- 禁止词：优质、精选、最强、第一、必备、神器、一站式、赋能、生态闭环、不容错过。
- **标题主体里禁止出现品牌名**（NavHub / NavSphere）：`apps/web/test/route-titles.test.ts` 会直接变红。品牌后缀只由根 layout 的 `title.template` 提供，页面层只管「站点名 - 分类/定位」。
- 800+ 个薄标签不写描述、不进 sitemap。

#### 6.4 必须先删掉的"虚假承诺"

| 位置 | 现文案 | 问题 | 改成 | 状态（2026-10-21 09:40） |
|---|---|---|---|---|
| `app/hot/page.tsx:189/204` | "基于真实用户检索与点击行为权重自动更新""按真实访问热度自动排序" | `visit_count`/`trend_score` 全 0 | "按站点访问量排序。访问量统计尚未积累，当前榜单不反映真实热度。" | ✅ 已修（并行会话 09:09 落地，文案与方案一致） |
| `app/site/[id]/layout.tsx:11` | "站点简介、相似推荐与生态关联" | `site_relations` 0 行 | "官网入口、一句话简介与所属分类" | ⬜ 待 Phase 2（该目录归并行会话） |
| `app/site/[id]/page.tsx:421` | `visitCount=0` 时显示"暂无点击" | 1020 页全显示，暴露内部指标 | 有值才渲染 | ⬜ 待 Phase 2 |
| `app/collections/page.tsx:91` | "入门路线、地域资源、场景方案，开箱即用" | 4 个合集共 18 条，无地域资源 | 按真实专题描述 | ✅ 已修（09:40）：改为「AI 智能体、AI 编码、前端入门与设计工具四个方向」（与 `/api/collections` 真实 4 合集一致） |
| `app/site/[id]/page.tsx:302-314` | `http_status` 为空也显示"SLA 正常" | 86% 站点没测过 | 无值不渲染徽标 | ⬜ 待 Phase 2 |
| `packages/core/src/ecosystem.ts:64/157` | Ollama「125k」、Excalidraw「86k」star 徽章 | 硬编码常量、无日期；API 原样返回，客户端列表会渲染；**且参与 DIY 排序**（`lib/modular/diy-presets.ts:191` 按 `min(15, stars/1000*0.5)` 加分，`trend_score` 全 0 时这是除置顶外最大信号，两站都拿满 15 分） | **删除这两个 `liveMetrics` 字段**——同时消除徽章与排序偏置；只删徽章代码没用，排序仍在吃假数据 | ✅ 已修（并行会话 09:09）：`ecosystem.ts` 的 `liveMetrics` 现只剩 `{ openSource, license }`，`diy-presets.ts` 已无任何 `stars` 引用，假数据链路全断 |

---

## 六、验收：每条 P0 都能用一条命令证明

```bash
SITE=https://你的域名

# 1) sitemap 覆盖
curl -s "$SITE/sitemap.xml" | grep -c '<url>'                 # ≥1100（W1）/ ≥1250（含分类）

# 2) 软 404 消失
curl -s -o /dev/null -w '%{http_code}\n' "$SITE/site/not-a-real-id"      # 404
curl -s -o /dev/null -w '%{http_code}\n' "$SITE/tags/zzz-not-exist"      # 404

# 3) 详情页有内容、有 h1、有真标题
curl -s "$SITE/site/<有效id>" | grep -c '<h1'                  # ≥1
curl -s "$SITE/site/<有效id>" | grep -o '<title>[^<]*'         # 含站点名，不含"站点详情"

# 4) canonical 存在且唯一
curl -s "$SITE/" | grep -c 'rel="canonical"'                    # 1
curl -s "$SITE/tags/开源" | grep -o 'rel="canonical" href="[^"]*"'

# 5) 私密页 noindex
curl -s "$SITE/marketplace/mine" | grep -c 'name="robots" content="noindex'   # 1

# 6) 结构化数据
curl -s "$SITE/" | grep -c 'application/ld+json'                # ≥1

# 7) 目录页与入链
curl -s "$SITE/" | grep -c 'href="/sites"'                       # ≥1
curl -s "$SITE/sites" | grep -c 'href="/site/'                    # =60（首屏 SSR 内链）
curl -s -o /dev/null -w '%{http_code}\n' "$SITE/sites?page=1"     # 308 → /sites

# 8) 提醒：web 侧没有 /api/sites，别照抄成相对路径
curl -s -o /dev/null -w '%{http_code}\n' "$SITE/api/sites?limit=1"  # 404（中枢路径只在 hubGet 里用）
```

自动化测试（接在现有测试体系里）：

| 测试 | 内容 |
|---|---|
| 扩展 `apps/web/test/route-titles.test.ts` | ① 每个动态路由必须有 `generateMetadata`；② 标题唯一性检查改为按模板+参数模拟；③ **现有 `literalField()` 只匹配引号字符串，反引号模板串会被当成 runtime 跳过——必须补模板串扫描**，否则"标题里偷写品牌名"能绕过测试 |
| 新增 `apps/web/test/seo-invariants.test.ts` | 可索引页面必须有 `alternates.canonical`；私密路由必须 `robots.index===false`；sitemap 条目 ≥1100（W1）/ ≥1250（含分类） |
| 新增 `scripts/link-graph.mjs` | 从 `/` BFS，输出孤岛列表、平均入链、点击深度；CI 里对阈值断言 |
| 扩展 `apps/web/test/sitemap.test.ts` | 阈值过滤（分类/标签 ≥5）、去重、时间戳非法降级 |
| E2E（playwright） | 无效 id 返回 404；`/tags/{name}` 301 到 slug；sitemap 分页拉取 |

---

## 七、排期与预期

### 7.1 落地进度（2026-10-21 更新）

| 项 | 状态 | 证据 |
|---|---|---|
| `NAVHUB_SITE_URL`（`.env.example` / `docker-compose.yml`） | ✅ 已落地 | 变量名与注释已写入，web 服务已注入 |
| `src/lib/seo/origin.ts` + `thresholds.ts` + `sitemap-entries.ts` + `src/lib/server/hub.ts` | ✅ 已落地 | 新文件，纯函数接单测 |
| metadataBase + OG/Twitter 默认 | ✅ 已落地 | `og:image` 实测解析为 `http://localhost:3000/icons/icon-512.png` |
| canonical（首页 / graph / algorithms / videos / submit / 插件详情） | ✅ 已落地 | 6 个叶子页实测均有 `rel="canonical"`，绝对地址 |
| 私密页页面级 noindex（11 处） | ✅ 已落地 | `/favorites`、`/preferences`、`/marketplace/mine`、`/custom`、`/offline` 实测输出 `noindex, follow` |
| robots.txt 重写 | ✅ 已落地 | 只 Disallow `/admin`、`/api/`、`/s/`；去掉 Yandex host 指令 |
| sitemap 扩容 | ✅ 已落地 | 实测 **1172 条** = 1013 站点 + 82 标签 + 4 合集 + 64 插件 + 9 静态 |
| 单测 | ✅ 全绿 | 4 个测试文件 36 用例通过（含新增 `sitemap-entries`、`seo-invariants`）；新增 `/sites` 后 `route-titles` 仍通过——注意它靠正则识别 `title:`，**不能写成对象简写** |
| 站点去重（A 档 4 组） | ❌ 待做 | 不阻塞已上线部分 |
| 分类 slug | ❌ 待做 | `/category` 上线前做即可 |
| `/sites` 全站目录页（新增路由） | ✅ 已落地 | 实测 200，`/site/` 内链 51 条（覆盖当前库全部 active 站点）、`<h1>`、canonical、`?page=1`→308、超范围页码→308 |
| 页脚补 `/sites` + `/collections` 入口 | ✅ 已落地 | 首页 HTML 实测各 1 条；`/collections` 入口页与其 4 个合集页不再是孤岛 |
| `src/lib/seo/json-ld.ts` + `src/components/json-ld.tsx` | ✅ 已落地（Phase 4 首批） | 纯函数 `webSiteLd` / `breadcrumbLd` / `itemListLd` / `jsonLdScript`；19 用例单测；`jsonLdScript` 转义 `</script>` 与 U+2028/2029 防越狱 |
| JSON-LD 注入：首页 `WebSite` | ✅ 已落地 | 实测 1 块，`name` 取自库内 siteData（"NavHub 导航"）；**不含 potentialAction**（本站无 `/search` 页面，声明即撒谎） |
| JSON-LD 注入：`/sites` `BreadcrumbList` + `ItemList` | ✅ 已落地 | 实测 2 块，`numberOfItems` 与真实 active 数一致（当前库 51）；仅可索引的页 1 输出，`?page≥2`（noindex）实测 0 块 |
| JSON-LD 注入：插件详情 `BreadcrumbList` | ✅ 已落地 | 实测 3 级（首页 › 插件市场 › 插件名，插件名取自 `loadPluginMeta`）；graph 末级与 `metadata.title` 同名 |
| JSON-LD 注入：插件详情 `SoftwareApplication` | ✅ 已落地（09:26 补） | 实测 2 块（BreadcrumbList + SoftwareApplication）；字段仅 name/description/applicationCategory='WebApplication'/url，**无 aggregateRating、无 offers**（插件有真实 ratingAvg 字段但样本小，人工处罚风险高，宁可没有富结果） |
| OG 补全（`og:url`） | ✅ 已落地（09:26 补） | 8 个页面实测 og:url 与 canonical 同值：`/`、`/hot`、`/algorithms`、`/videos`、`/submit`、`/graph`、`/sites`（跟随分页 canonical）、`/marketplace`。og:title/description/image/site_name 早已由根 layout 字段级合并全覆盖（openGraph 是字段级合并，非整对象替换——已实测验证） |
| Phase 4 剩余（`Organization` / 站点详情+标签+分类+合集详情 OG） | ⬜ 待做 | `Organization` 等 logo 资产与品牌信息定稿后再加；站点详情 OG 随 Phase 2 RSC 化（被并行会话占用）；标签/分类/合集**详情页** OG 同理——hub 页（`/tags`、`/collections`）已全覆盖，且**故意不给 hub layout 加 og:url**：会被子路由 `/tags/[slug]` 继承成错误地址（与中间层不加 canonical 同一陷阱），详情页 og:url 必须由 Phase 2 的逐页 `generateMetadata` 产出 |
| Phase 2 其余（`/site/[id]` RSC 化 / 内链 / ISR） | ⚠️ `/site/[id]` 被并行会话两次回滚，暂停 | 根因与规格见 7.2 |
| Phase 5 Batch A：面包屑组件 + 4 挂载 3 拆除 | ✅ 已落地（09:55） | 新建 `components/breadcrumbs.tsx`（可见 DOM 与 BreadcrumbList JSON-LD 同源：同一 Crumb 数组 + 同一过滤函数，`BreadcrumbTrail` 给客户端页用）；挂载 `/sites`（`jsonLd={indexable}`，页 ≥2 只出可见部分）、`/tags/[slug]/layout.tsx`、`/marketplace/[slug]/layout.tsx`、`/graph`；拆除 `/sites` 手写 breadcrumbLd、`/tags/[slug]` 伪面包屑（「返回标签云」）、`/marketplace/[slug]` 手写 breadcrumbLd。实测 4 页各 1 个可见面包屑 + 恰好 1 个 BreadcrumbList（无双挂），`/tags/ai` 伪面包屑计数 = 0 |
| Phase 5 Batch A：标签云 count 规则 | ✅ 已落地（09:55） | `app/tags/page.tsx` 加 `TAG_LINK_MIN = 2`：≥2 站渲染 `<Link>`、1 站渲染 `<span>`（理由注释：自指绕圈 + 爬虫零增益 + 可逆不写死）。**playwright 实测 369 multi（全 `<A>` 带 slug href）/ 710 single（全 `<SPAN>` 无 href）**——与规格数字分毫不差，证明 count-driven 规则与真实数据吻合 |
| Phase 5 Batch A：标签结果页卡片双模式 | ✅ 已落地（09:55） | `app/tags/[slug]/page.tsx` 卡片改「拉伸外链（z-0，aria-label）+ 标题站内 Link（z-10）+ 收藏按钮（z-20）」兄弟节点结构。playwright 实测：外链 href=官网、标题 href=`/site/{id}`、**nestedAnchors=0**（`<a>` 嵌套陷阱已避）、收藏按钮在位。行为不变：点空白/描述仍直达官网 |
| Phase 5 Batch A：枢纽互链 | ✅ 已落地（09:55） | `/sites` 头部加「按标签浏览全部站点 / 精选专题合集」nav（与页脚入口互补）；`/tags/[slug]` hero 徽章行加「全部站点目录」Link |
| Phase 5 Batch A 门禁 | ✅ 全绿 | nested-interactive / field-names / keyboard-activation / route-titles / main-landmark / json-ld / seo-invariants 共 **95 用例**；tsc 干净（除并行会话 plugin-card）；eslint 0 错误（2 个 warning 是原有 useEffect 模式） |
| Phase 5 Batch B（标签云/标签结果页 RSC 化 + link-graph TAG_MIN=2） | ✅ 已落地（13:25） | 见下方专项记录 |
| Phase 5 剩余（B-8 薄标签 noindex / 无效 slug 404 / navigation-card 改造 / site/[id] 四项） | ⬜ 待执行 | B-8 涉及 997 页收录状态变更，建议与 GSC 观察配合单独一轮；无效 slug 404 属 Phase 2 家族；navigation-card 需独立回归轮；`site/[id]` 等并行会话释放 |

### 7.2 Phase 2 的两个前置根因（实测，改 RSC 前必须先处理）

1. **`loading.tsx` 会吞掉 404 与正文**。`app/loading.tsx`（全局）与 `site/[id]/loading.tsx`（路由级）
   把 200 外壳先冲给客户端：`notFound()` 改不了状态码（无效 id 仍返回 200，这正是 9/12 软 404 的真因），
   同时页面正文完全不进 HTML，只剩骨架屏。实测删掉这两个文件后：无效 id 立刻变 **404**，正文与 `<h1>` 直出。
   客户端组件自带骨架屏，删除不影响加载体验。
2. **`fetch` 带 `next: { revalidate }` 会让路由走增量生成**，正文同样不入 HTML。
   `lib/server/hub.ts` 已改为默认不加 revalidate（只有 sitemap 这类可延后产出显式传缓存时间）。

> **冲突记录**：对 `src/app/site/[id]/{page,layout,loading}.tsx` 的改造在 02:03 与 08:03 被并行会话**两次**写回旧版
> （新建的 `site-detail-client.tsx` 两次被删）。按仓库约定未强行覆盖，该目录改由对方负责；
> 我用 `/sites` 目录页先把「1013 个详情页是孤岛」这个问题解掉（不碰同一批文件）。
>
> **给接手方的完整规格**（已验证有效，重做只需照抄）：
> 1. 删掉 `src/app/loading.tsx`（已删）与 `src/app/site/[id]/loading.tsx` —— 否则 404 与正文都拿不到；
> 2. `page.tsx` 改成 RSC：`hubGet('/api/sites/' + id)`，取不到 `notFound()`，
>    `generateMetadata` 产出 `{站点名} · 站点详情` + canonical，标题里不写品牌名；
> 3. `layout.tsx` 删掉静态 metadata；
> 4. 原客户端实现整体移到 `site-detail-client.tsx`，改为接收 `{ siteId, initialSite }`，
>    `useState(!initialSite)` 控制骨架屏，首屏 effect 在 `initialSite && !reloadToken` 时跳过。
>
> **数据环境变化**：本地 `data/navhub.db` 在 08:22 被重置（sites 1020 → 58，active 1013 → 51）。
> 因此本地实测数字（sitemap 210 条、`/sites` 51 条内链）反映的是当前库，方案里的 1172/1013 仍是生产口径。

> 中间层 layout（`tags`、`collections`、`marketplace`）**故意没加 canonical**：它们有子路由，父级 canonical 会被子页面继承成错误地址。这三族的 canonical 由 Phase 2 的 `generateMetadata` 逐页产出。

### 7.3 Phase 5 Batch B 落地记录（2026-10-21 13:25，RSC 化 + link-graph 实测）

**改了什么**：

| 文件 | 形态 |
|---|---|
| `src/components/tag-cloud.tsx`（新） | 客户端岛：hero + 搜索 + 云 + 降级提示，props `{ initialTags }`；`initialTags === null`（服务端没取到）时挂载即自动客户端重取一次，仍失败才停降级态 |
| `src/app/tags/page.tsx`（重写） | 服务端组件：`hubGet('/api/tags?minCount=1')` → props 下发 → `<TagCloud>`；metadata 仍由 `tags/layout.tsx` 提供（route-titles 按 page→layout 找标题，行为不变） |
| `src/components/tag-results-board.tsx`（新） | 客户端岛：hero + SearchPalette + 降级 + 双模式卡片网格，props `{ slug, initialSites, degraded }`；重试走客户端 `searchSites`（带 identity 个性化） |
| `src/app/tags/[slug]/page.tsx`（重写） | 服务端组件：`hubGet('/api/search?q=&tag={slug}&limit=100')`（limit 与改版前客户端口径一致，页面无「加载更多」——策略师规格里提到的「加载更多」经核实不存在，属笔误） |
| `app/tags/loading.tsx`、`app/tags/[slug]/loading.tsx` | **删除**（4 个文件含 vendored 副本）——§7.2 根因一的直接应用：不删则服务端取数进不了 HTML |
| `scripts/link-graph.mjs:57` | `TAG_MIN` 默认 1 → 2（710 个 1 站标签按设计不接内链，universe 口径与 `TAG_LINK_MIN=2` 对齐；旧口径显式传 `--tag-min=1`） |

**实测（curl，SSR HTML 口径）**：

- `/tags`：**369 条 `href="/tags/..."` 内链 + 710 个 `data-tag-tier="single"` span + `<h1>` + 面包屑全部直出**（改版前 SSR 只有骨架屏，0 条）
- `/tags/开源`：3 条 `href="/site/..."` 内链 + 站点标题文本直出（与 hub `/api/search?tag=开源` 返回的 3 个 hit 一致）
- playwright：369/710 分层复验通过；卡片 `nestedAnchors=0`；**点标题 → `/site/{id}` 详情页 h1 正常渲染**（完整用户旅程通）；`/tags`、`/tags/开源` 无水合错误
- 门禁 7 文件 95 用例全绿；tsc 干净；eslint 0 错误

**link-graph 实测（`--from-db=data/navhub.db`）**：

| 类型 | URL | 孤岛 | 均入链 | 可达 |
|---|---:|---:|---:|---:|
| tag | 369 | **0** | 1 | **100%** |
| site | 1011 | 955 | 0.11 | 5.5% |
| collection | 4 | 4 | 0 | 0% |
| tagsHub/collectionsHub/marketplaceHub/sites/home | 5 | 0 | ~380 | 100% |

- **369 个标签页从 0 入链变为 100% 可达**——Batch B 的核心目标达成
- site 955 孤岛是**环境错配**非代码问题：`data/navhub.db` 12:46 被恢复成完整版（1011 站点），但运行中的 hub（:8787）仍是旧内存库（51 active），crawler 抓到的 SSR 只含这 51 个。生产口径下 `/sites` 17 页 + 369 标签页分摊后均入链 ≈2-3（策略师预测 2.1）
- collection 4 孤岛：合集 hub 是客户端渲染（无 SSR 出链）——已登记等待清单（热点文件区）
- `--check` 3 项未达，全部为既有/环境问题：① 平均入链 2.016 < 3.5（需 132 个 `/category` hub，P1，策略师已预测 2.1）；② 软 404 9/12（Phase 2 家族，规格内已登记）；③ `/sites` 首屏 SSR 出链 51 ≠ 60（hub 只服 51 active < 60 页大小，生产 1013 active 时恰为 60）
- **脚本坑（已规避）**：`--from-db` 裸传会被解析成布尔 `true` → 归一到 `null` → universe=0，孤岛数失去意义。必须传 `--from-db=data/navhub.db`

**给并行会话的报备**：`SiteDetailPage`（`src/app/site/[id]/page.tsx`）有 React key 警告（"Each child in a list should have a unique key prop"，组件栈实锤来自该页），dev 模式警告、非功能故障，按约定只报告未代改。

**门禁守卫修复（2026-10-21 13:40，回归定位）**：全量回归首现 7 个失败，全部为「源码守卫指着旧页面路径」——`list-degrade.test.ts` 5 个（/tags 降级三连 + /tags/[slug] 降级两条）与 `search-entrypoint.test.ts` 2 个（SearchPalette 渲染 + 「全部站点」文案）。根因：这两个测试按路径读 `src/app/tags/page.tsx`、`src/app/tags/[slug]/page.tsx` 的源码断言模式，而 Batch B 把行为迁进了客户端岛，页面壳只剩服务端取数 + 挂岛。处理（守卫加严而非放松）：

| 测试 | 改动 |
|---|---|
| `list-degrade.test.ts` | 行为断言改指 `src/components/tag-cloud.tsx` / `src/components/tag-results-board.tsx`；**新增 2 条「壳必须挂岛」断言**（`<TagCloud` / `<TagResultsBoard`）——壳空挂等于岛不上 SSR，是比文案回归更严重的退化；⚠️ 私有横幅禁用断言同时覆盖岛与壳 |
| `search-entrypoint.test.ts` | `/tags/[slug]` 从「页面直接渲染面板」表移入新建 `ISLAND_SEARCH_PAGES` 表（壳挂岛 + 岛渲染面板 + import 三断言）；「全部站点」文案断言改指 `tag-results-board.tsx` |

修复后两文件 24 用例全绿（13 + 11），全仓无其他守卫引用这两个旧页面路径（已 grep 证实）。**教训**：RSC 化重写页面后，源码守卫型测试必须同步改指向——它们是按路径读文件的，不会因为行为还在（只是换了文件）而自动通过；且这正是守卫的价值：它抓住了「壳忘了挂岛」这类真实退化风险。

### 7.4 Phase 5 Batch C 落地记录（2026-10-21 14:30，卡片 #tag 内链化）

**改了什么**：

| 文件 | 形态 |
|---|---|
| `src/components/navigation-card.tsx`（rich 模式） | 标签池移出卡片外链 `</Link>` 成为流内兄弟节点；`#{tag}` 由 `<span>` 改真 `<Link href="/tags/{slug}">`；外链去掉 `h-full`（rich 网格同行拉伸会把标签池挤出 `overflow-hidden` 卡片）；新增 `handleTagClick`（多选模式下标签点击与整卡同语义：不导航、只切换选中） |
| `src/lib/seo/tag-slug.ts`（新） | 标签名 → slug，与 `packages/store/src/repository/dialect.ts` 的 `slugify` 逐字同构（trim → 小写 → 空白转连字符 → 保留 [a-z0-9 中文 -] → 空兜底 "tag"） |
| `src/types/navigation.ts` + `apps/web/src/lib/data-loader.ts` | **根因修复**：`processNavigationSubItem` 是字段白名单，navigation.json 条目一直带着 tags 却被裁掉——rich 卡片芯片永远没数据。Raw 类型补 `tags?: string[]`，白名单放行（只放行 tags） |
| `test/tag-slug.test.ts`、`test/card-tag-links.test.ts`、`test/data-loader-tags.test.ts`、`scripts/tag-slug-parity.test.ts`（新） | slug 契约 6 例 + 卡片结构守卫 7 例（含「标签链必须在 `</Link>`/`</CardHeader>` 之后」的嵌套锚点防护）+ data-loader 行为 3 例 + **双实现 Parity 26 例**（web tagSlug ↔ store slugify 对跑，漂移即红灯） |

**规格冲突的综合裁决**（方案 626 行说「≥2 站渲染 Link（369 个）」vs 631 行说「只给 82 个 ≥5 站标签」）：**全量 Link 化，不设 count 门槛**。理由：① 卡片数据里没有 tag count，灌 count 要新增首页 `/api/tags` 拉取并穿透 props 给所有卡片消费方，违背最小改动；② ≥5 是 sitemap 的**索引**门槛，用作**渲染**门槛会把 287 个 2-4 站标签页的内链价值一起丢掉；③ 1 站标签的自指是 UX 微瑕而非断裂（用户主动点了想看这个标签），收录侧由 B-8 noindex 收口。href 一律用 slug 形态——sitemap 与标签云都是 slug，用名字会造出同内容双 URL。

**浏览器实测（playwright，dev 栈）**：注入 rich 偏好后 58 张卡片渲染 **118 个 `/tags/{slug}` 内链**（如 `/tags/%E5%A4%A7%E6%A8%A1%E5%9E%8B`），全部落在卡内；**全页嵌套锚点 0**；点标签 → 标签详情页 h1「『大模型』相关站点共 5 个站点」正常；卡片主外链 58 条 + 操作按钮 232 个健在；聚焦卡片按 Space → peek 弹窗正常呼出（含站点标题与描述）；无 JS 错误（2 条 `ERR_BLOCKED_BY_RESPONSE` 资源阻塞经标准模式对照证实为 headless 预存，非本轮引入）。既有守卫 batch-selection / keyboard-activation / pwa-offline 69 例全过。

**诚实修正——爬虫收益为零（本轮最重要的结论）**：rich 模式是 **localStorage 客户端偏好**，SSR HTML 用的是默认 standard 模式（无标签芯片），爬虫没有 localStorage。因此卡片标签链**不进任何爬虫可见的 HTML**，方案原文「给 369+ 标签页提供来自首页的内链」的乐观 framing 不成立。本轮的真实价值是：① **UX**——span 变真链接，新标签页打开 / 复制链接 / 中键点击全部可用；② **结构正确性**——芯片原本就在 `<a>` 内部，现在手序上杜绝嵌套。要拿到爬虫收益，路径是 W3 的 `/category/[slug]` 枢纽与 `/sites` 式服务端卡片网格（`detailLinkMode` 机制尚未建立），或把 chips 加进默认 standard 模式（视觉变更，需产品确认——不在最小改动范围内）。

**顺带发现（预存问题，未修）**：`processNavigationSubItem` 白名单同时裁掉了 `relations` / `actions` / `liveMetrics` / `health`——首页卡片上的「平替 / 深链 / GitHub stars / 快照自愈」徽标在现行管线里全是死路径（数据永远到不了卡片）。`site/[id]` 详情页自己从 hub 拉 relations 所以不受影响。修不修由产品定：放行需要确认首页管线的增补来源，否则放了也是 undefined。

### 7.5 Phase 6a 落地记录（2026-10-21 15:10，读路径缓存：爬虫不再每次打穿中枢）

**问题**：全站渲染路径对 hub 的读全部是「每请求一发」。首页 `force-dynamic` + storage-adapter 的 fetch 不带任何缓存选项；Batch B RSC 化后 `/tags`（369 标签）与 `/tags/[slug]`（369 页 × 50-100 站点查询）成为新的高频读源——爬虫一轮抓取就是 400+ 次 hub 聚合查询，全部打穿到 SQLite。

**改了什么**：

| 文件 | 改动 |
|---|---|
| `src/lib/storage-adapter.ts` | `HttpAdapterOptions` 新增 `revalidateS?: number`（默认 60）；`call()` 对**非写请求**注入 `next: { revalidate }`，写（PUT）永远不带（写不过缓存）；`revalidateS=0` 显式禁用 = 回到实时读 |
| `src/lib/github.ts` | 新增 `revalidateFromEnv()`（读 `NAVHUB_STORAGE_REVALIDATE_S`，非法值回落 60），透传给 `createHttpAdapter` |
| `src/app/page.tsx` | `export const dynamic = "force-dynamic"` → `export const revalidate = 60`。原注释场景（元信息被固化在构建产物里）由 metadataBase + fetch 级 revalidate 共同解决：构建期不再固化数据，运行期 60s 保鲜 |
| `src/app/tags/page.tsx` | `hubGet('/api/tags?minCount=1')` → 传 `60` |
| `src/app/tags/[slug]/page.tsx` | `hubGet('/api/search?q=&tag=...&limit=100')` → 传 `60`（369 个标签页的重复抓取走 Data Cache） |
| `src/app/sites/page.tsx` | `loadActiveSites()` 两个分页 `hubGet` 各传 `60`（17 个分页 × searchParams 组合独立取数） |
| `test/storage-adapter.test.ts` | 新增 5 例：默认 read 带 `next.revalidate=60`、`revalidateS` 可覆盖、`=0` 不带 next、PUT 永远不带 next |
| `test/storage-revalidate-env.test.ts`（新） | `revalidateFromEnv` 6 例：未设置/空/合法值/0/非法/小数 的解析口径 |

**为什么是 60s 而不是 sitemap 的 3600s**：首页含 `siteData.basic`（标题/描述）与站点列表，后台改站点信息是高频运营动作；标签与站点集合是低频变更。60s 是「运营改完一分钟内见效」与「爬虫突发被缓存吸收」的折中。sitemap 保持 3600 不动（搜索引擎不会分钟级重访 sitemap）。

**验证**：tsc 干净（仅并行会话 plugin-card 已知项）；eslint 0 error；dev 栈四路由冒烟 `/tags` 200、`/tags/开源` 200、`/sites` 200、`/sites?page=2` 308（设计中的分页归一化）；**SSR 内容零损**——`/tags` 仍直出 369 条标签内链、`/tags/开源` 仍直出 3 条站点内链、`/sites` 仍直出 51 条（51≠60 为已知环境口径差，dev hub 内存库 51 active）；26 个 storage 相关测试全绿。

**注意（Next 16 语义）**：`fetch` 的 `next.revalidate` 在 App Router 里同时决定 Data Cache 与 ISR 行为；本仓库页面都是动态渲染（无 `generateStaticParams`），实际生效的是**请求级 Data Cache 复用**——同一 URL 在 revalidate 窗口内的重复请求命中缓存，不产生新的 hub 上游请求。生产部署（Docker + next start）行为一致。

**残留**：admin 系列页面（10+ 个 hubGet 调用点）刻意不传 revalidate——后台要实时；这是设计而非遗漏。

### 7.6 Phase 6b/6c 落地记录（2026-10-21 16:00，体积实测 + 82 条标签文案）

**6b：首页「7.5MB 瘦身」——实测后撤销该议题（无生产问题）**

方案原文把「首页 7.5MB」列为 Phase 6 性能项。实测（`NEXT_DIST_DIR=.next-verify next build` + `next start` 生产服务 + `scripts/check-bundle-budget.mjs`）：

| 口径 | dev 模式 | **生产模式** |
|---|---:|---:|
| HTML（raw / gzip） | 1.83MB / — | **1.78MB / 100KB** |
| 首屏 JS+CSS（raw / gzip） | 8.56MB / — | **1.46MB / 430KB** |
| 首访全资源（raw / gzip） | 10.4MB / — | **3.24MB / 530KB** |
| 首屏 JS（预算口径，未压缩） | — | **1063KB（预算 1115KB，60 条路由全过）** |

「7.5MB」是 **dev 模式全资源传输**的失真数字——未压缩的 React development 构建（react-dom-client_development 单 chunk 1.05MB）、next-devtools（887KB）、HMR runtime 在构建产物里全部不存在。仓库自 2026-10-19 起就有首屏 JS 棘轮门禁（`scripts/check-bundle-budget.mjs` + `bundle-budget.json`，`/` 预算 1115KB，历史从 1174KB 逐轮棘轮下调到 1062KB）。**结论：无需瘦身动作**；持续控制交给既有棘轮门禁。本方案文档后续版本应删除该议题，避免再拿 dev 数字申报生产问题。

**6c：82 条标签描述（content-writer 产出 + 回填 + 全链路渲染）**

| 文件 | 改动 |
|---|---|
| `docs/seo/tag-descriptions-draft.md`（新） | content-writer 按 seed-data 实证聚合撰写的 82 条描述（≥5 站标签全量）；独立复核：82 条无重复、0 违禁词（最/第一/全网/持续更新/感叹号）、字数 min 30 / median 37 / max 56，全部 ≤200 字上限 |
| `scripts/tag-descriptions.mjs`（新） | 回填脚本：**解析上述 markdown 为唯一事实源**（不嵌文案副本，杜绝漂移）；按 name 匹配标签；默认 dry-run，`--apply` 写入；幂等（描述相同即跳过）；超 200 字拒绝；`--db`/`NAVHUB_SQLITE_PATH` 与 data-retention.mjs 同口径。已对 dev 库执行（前置 `scripts/backup.mjs` 备份 integrity ok），复跑 dry-run 报「已一致 82」 |
| `packages/store/src/repository/tags.ts` + `repository.ts` | `resolveTag` 两个分支（主表/别名表）的 SELECT 增加 `description`，返回类型加 `description: string \| null`——纯增量，既有 4 个消费方（sites.ts upsertTag、测试）不受影响 |
| `src/app/tags/[slug]/page.tsx` | **新增 `generateMetadata`**：每页独立 title（`「{标签名}」相关站点`）与 description（优先标签自身描述，缺失才兜底）——369 个标签页不再共享写死的「标签详情」；正文同步取 resolve 描述经 `tagDescription` prop 下发 hero（369 页不再共用同一段通用正文） |
| `src/app/tags/page.tsx` + `src/app/tags/layout.tsx` | 标题从 layout 迁到 page（见下） |
| `test/tag-metadata.test.ts`（新，6 例） | 结构锁：`/tags/layout.tsx` 无 metadata export（模板贯通）、`/tags/page.tsx` 有、`/tags/[slug]/page.tsx` 有 generateMetadata 且标题/描述来自运行时、hero 消费 tagDescription |

**Next 16 title.template 截断坑（实测，已写进三处代码注释 + 守卫）**：根 layout 的 `title.template`（`%s - 站点名`）向孙级传递时，**会被中间层的字符串 title 截断**。`/tags/layout.tsx` 的 `title: '标签总览'` 导致全部 369 个 `/tags/[slug]` 页的 `<title>` 拿不到品牌后缀（同病：`/collections/[slug]`「合集详情」、`/marketplace/[slug]`「插件详情与安装」；反证：`/site/[id]` 父层无 title，后缀正常）。修法：标题下沉到 page 级 metadata，中间层 layout 不留 title。**实测修复后**：`/tags` → `标签总览 - NavHub 导航`，`/tags/开源` → `「开源」相关站点 - NavHub 导航`。

**生产构建全链路验证**（`next start` + 真实 hub）：`/tags` SSR 369 条标签内链、`/tags/开源` 3 条站点内链 + title 后缀 + hero 描述 + BreadcrumbList JSON-LD 全部在场。另核实一处环境疑云：dev 库真实状态为 **51 active + 7 broken + 962 软删除**（hub 与直查 SQLite 一致），此前记忆中的「1011 站点」是未过滤 `deleted_at` 的误算——非 bug。

| 周 | 内容 | 交付物 |
|---|---|---|
| W0（2-3 天） | 站点去重、`NAVHUB_SITE_URL`、分类 slug 迁移 | 前置 PR |
| W1 | metadataBase / canonical / noindex / robots / sitemap 扩容 | 索引地基 PR |
| W2 | `/site/[id]`、`/tags/[slug]`、`/collections/[slug]` 服务端化 + 真 404 | 渲染改造 PR |
| W3 | `/sites` 目录 → `/category/[slug]` + `/category` 索引页 | 1013 个详情页先有入链，再上 132 个 hub |
| W4 | JSON-LD + OG + 插件页 canonical | 富结果 PR |
| W5-6 | 卡片双模式、`#tag` 内链、面包屑、标签云 SSR | 内链 PR |
| W7-8 | ISR、首页体积、图片白名单、播放页路径化、文案批量生产 | 性能 + 内容 PR |

**上线后 4-8 周观测目标**

| 指标 | 基线 | 目标 |
|---|---:|---:|
| sitemap URL | 67 | ≥1250（W1 先到 ≥1100） |
| GSC 已编入索引 | 个位数 | ≥900 |
| 重复 title 页面 | 2100 | 0 |
| 孤岛页面（SSR 入链=0） | 2163 | ≤710（其中 1 站点标签约 700 个，按设计断链；真实内容页孤岛 ≤10） |
| 软 404 | 无限 | 0 |
| 有 JSON-LD 的模板页 | 0 | 全部可索引模板 |
| 首页 TTFB（Googlebot，无缓存） | 打穿中枢 | P95 <800ms |

### 7.7 计数口径修复 + B-8 落地 + 枢纽面包屑（2026-10-21 17:00）

**最重要的发现：标签计数被软删除站点污染（数据完整性 bug，已修）**

`listTagsWithCounts` 用裸 `COUNT(st.site_id)` 不过滤站点状态——dev 库 962 条软删除站点的标签关联让全部计数虚高：「开源」报 123 而存活站点只有 3。**方案 §4.1 的分层表（82/287/710）建立在虚高计数上**；按存活口径（与 search 候选集同语义：`deleted_at IS NULL AND enabled`）当前 dev 库真实分布是：≥5 站 1 个（大模型）、2-4 站 20 个、1 站 69 个。分层**规则**（≥5/2-4/1/0 四档）不变且 count 驱动，站点集恢复后数字自动回填。

修复面（同一根因三处）：
1. `packages/store/src/repository/tags.ts` 的 `listTagsWithCounts`：LEFT JOIN sites 过滤存活 + `COUNT(s.id)`（新增 store 测试锁口径：软删除与停用站点不进计数）；
2. `scripts/link-graph.mjs` 的站点全集查询（`status='active'` 漏 `deleted_at IS NULL`——955 条软删站点被计入全集判孤岛，**此前「site 955 孤岛」的真因就是它**）与标签全集查询（同款裸 COUNT）；
3. sitemap 注释更正（「只提交 82 条」已失真）。

**link-graph 修正口径后的真实孤岛图景**（当前 dev 库 51 active 站点）：

| 类型 | URL | 孤岛 | 可达% | 说明 |
|---|---:|---:|---:|---|
| site | 57 | **0** | **100%** | `/sites` 目录的目标其实已达成（此前 955 孤岛是测量 bug） |
| tag | 21 | 0 | 100% | TAG_MIN=2 的存活口径 |
| collection | 4 | **4** | **0%** | 真孤岛：合集索引页是客户端取数，详情链接不进 SSR HTML |
| plugin | 64 | **64** | 0% | 同因：市场索引页客户端渲染 |
| 软 404 探针 12 个 | | 6 个仍 200 | | /site/*×3（对方 WIP）、/collections/*×3（见下）；**/tags/* 已全部 404** |

**B-8 薄标签分层落地**（`/tags/[slug]`，实测逐项通过）：

| 存活站点数 | 实测样本 | 行为 |
|---|---|---|
| ≥5（大模型=5） | `「大模型」相关站点 - NavHub 导航` + 真描述 | 200 可索引 |
| <5（开源=3） | `<meta name="robots" content="noindex, follow"/>` | 200 不收录 |
| 0 / 不存在 | `/tags/xyz` → **404** | 真 404（search 成功且 0 命中双证；中枢挂了降级渲染不误伤） |

**枢纽面包屑 + 合集元数据**（实测通过）：`/hot` 面包屑 + BreadcrumbList；`/collections` 可见面包屑；`/collections/[slug]` 每合集独立 title（`前端入门路线 - NavHub 导航`——**title.template 截断用 `{default, template}` 双层结构修通**，与 /tags 家族同款病症不同药方）+ 描述 + 面包屑 JSON-LD。marketplace 索引面包屑跳过（page 是并行会话弹窗懒加载 WIP）。

**客户端/服务端模块边界教训**：`BreadcrumbTrail` 原与服务端 `Breadcrumbs` 同文件，客户端页 import 会把 `origin.ts`（next/headers）拖进客户端图直接构建报错（/collections 实测 500）。已拆 `breadcrumb-trail.tsx`（零服务端依赖）并用守卫锁 import 行。

**`/collections/<无效slug>` 404 的生产终审判决（2026-10-21 22:30，构建 + next start 实测）**：此前的「源码级结论（19:10）」判断**错误**，被生产实测推翻——生产构建（.next-verify + `next start -p 3100`，AUTH_SECRET + 中枢在线）实测 layout 级 `notFound()` **同样返回 200**（响应含 NEXT_HTTP_ERROR_FALLBACK 痕迹，两次复测确认）。对照组同场验证：

| 探测 | 期望 | 生产实测 | 判定 |
|---|---|---|---|
| `/collections/nonexistent-xyz`（layout 级 notFound） | 404 | **200** | ❌ 生产也不生效 |
| `/tags/不存在xyz`（page 级 notFound） | 404 | **404** | ✓ |
| `/collections/frontend-starter` | 200 | 200 + `前端入门路线 - NavHub 导航` | ✓ |
| `/tags/大模型` | 200 | 200 + `「大模型」相关站点 - NavHub 导航` | ✓（首轮 404 系 Data Cache 从空 hub 窗口缓存的假象，revalidate=60 过期后恢复） |

**规律定稿（dev + 生产一致）**：`notFound()` 必须在 **page 组件渲染体**抛出（或 page 的 generateMetadata——tags 家族实测有效）；**layout 渲染体与 layout 的 generateMetadata 抛出的都会被回退成 200**。`/site/[id]` 与 `/collections/[slug]` 的 page 级方案是正确范式（前者已落地 ed6f2af，生产实测 404 ✓）。

**环境知识（本轮沉淀）**：① 生产 `next start` 必须设 `AUTH_SECRET`（≥32 字符，否则 middleware 拒启）且中枢要用 `NAVHUB_SQLITE_PATH` 指到真库（裸 `node src/main.ts` 会开空库）；② Data Cache 会把 404/空结果缓存 `revalidate` 时长，切数据源后必须等过期再下结论；③ 同 dist 目录二次 `next build` 会因清理旧 turbopack 缓存触发 safe-delete 护栏——`mv` 重命名旧 dist（rename 零 unlink）后构建即净。

### 7.8 Batch E：marketplace 索引 SSR 化（2026-10-21 19:00，plugin 孤岛 64 → 0）

并行会话提交了 marketplace/site 的 WIP（`22b9e54`/`792d700`）后这些文件解阻。`/marketplace` 改「服务端壳 + PluginMarketBoard 岛」（与 tags/collections 同构）：

| 改动 | 说明 |
|---|---|
| `app/marketplace/page.tsx` → 服务端壳 | `parseMarketplaceFilters`（纯函数）服务端解析同款 URL 筛选——**深链筛选视图同样 SSR 直出**；无筛选时预取精选+三榜；面包屑 + 岛挂载 |
| `components/plugin-market-board.tsx`（新，631 行迁移） | 原页面整体入岛（保留对方全部交互代码）；`initialItems/initialTotal/initialFeatured/initialRankings` 种子状态；**ref 单次跳过**首取（粗守卫会把筛选重取一起吃掉） |
| 首屏 `limit=1000` 全量种子 | 「加载更多」是客户端追加，第二页起无 SSR 入链（实测 40/64 孤岛）；全量种子后每个 `/marketplace/{slug}` 都有首页入链，`items.length===total` 时按钮自然隐藏；筛选交互仍 24/页 |

**link-graph 终态**（当前 dev 库）：site 57 / tag 21 / collection 4 / **plugin 64** 全部 **0 孤岛 100% 可达**；仅剩 other 2 个杂项孤岛（验收目标「真实内容页孤岛 ≤10」达标）。软 404 探针剩 6/12：`/site/*` ×3（对方 WIP）+ `/collections/*` ×3（上述 dev 回退）。

**Batch D：合集索引 SSR 化（同轮顺手落地，孤岛 4 → 0）**

`/collections` 从整页客户端组件改为「服务端壳 + CollectionBoard 岛」（与 tags 家族 Batch B 同构）：服务端 `hubGet('/api/collections', 60)` 取数经 `initialCollections` props 下发，null 时岛挂载即自动客户端重取；面包屑升级为服务端 `Breadcrumbs`（带 BreadcrumbList JSON-LD）。**实测**：SSR 直出 4 条 `/collections/{slug}` 内链，link-graph 复验 **collection 4 页 0 孤岛 100% 可达**（改前 4 孤岛 0%）。降级语义原样保留（「策划中」与「中枢挂了」分开说的诚实区分）。

孤岛全景（Batch D 后）：site 57 页 0 孤岛 ✓、tag 21 页 0 ✓、collection 4 页 0 ✓；**剩余真孤岛只有 plugin 64 页**（marketplace 索引页是并行会话弹窗懒加载 WIP，同款 SSR 化方案待解阻后套用）。

---

## 八、红线

1. **不要为 462 个 <5 站点分类、877 个 <3 站点标签生成页面**。薄页比没有页更糟。
2. **不要编造评分、排名、安装量、用户数**。`site_relations`/`site_facets`/`visit_count` 全空，任何"平替""热门""最适合"都是假的。
3. **不要为了 SEO 把外链改成内链中转**。导航站的核心价值是一跳直达。
4. **不要对同一 URL 同时 disallow + noindex**。disallow 会让 noindex 永远读不到。
5. **不要改 `apps/web`**。它是 vendored 镜像，改动会在下次 `vendor:web` 被覆盖，全部改动落 `apps/web-overlay`。
6. **不要给 `/site/{id}` 加 noindex**。它是长尾流量入口，方向是修内容，不是放弃收录。
7. **不要在构建期固化站点名**。`page.tsx` 的注释记录过这个坑；用 ISR，不要退回静态导出。

---

## 九、对上一版方案的勘误

| 上一版结论 | 实测/事实 | 处理 |
|---|---|---|
| `metadataBase` 用 `NAVHUB_PUBLIC_URL` | 示例值 `http://localhost:8787` 与语义都指向 API，且 `navhub-web` 容器没注入；一个变量不能同时承担「API 地址」与「站点地址」两种语义 | 新增 `NAVHUB_SITE_URL` |
| sitemap 分 5 个分片 | 1305 条远低于 50000 上限 | 单文件 + `revalidate` |
| "首页标题会重复品牌" | 实测 `<title>NavHub 导航</title>`，根 page 不吃 template | 删除该结论；真正的问题是 `/tags`、`/collections` 丢品牌 |
| `hubGet` 解析 `{ items }` | `/api/sites` 返回数组 | 改为数组解析 |
| 私密页同时 robots.txt disallow + noindex | 二者互斥，disallow 会让 noindex 读不到 | 只选一种 |
| 分类页可批量建 594 个 | 单指针会误报 489 个「0 站点」；双指针下 <5 站点 462 个 | 只建 132 个，其余 404 |
| 5 个分片覆盖 2698 个 URL | 实际名义可索引 2171（active 1013） | 目标 1305 |
| `generateSitemaps` 会自动生成 `/sitemap.xml` 索引 | ❌ 不会。无 id 请求直接 404，索引必须自写 route | 本期不分片 |
| 全站动态是因为 `force-dynamic` | 真因是 `storage-adapter.ts:189` 读路径无缓存 | Phase 2.0 先修 |
| 重复 title 约 2104 页 | 按可索引口径是 1106 页（1013 站点 + 82 标签 + 4 合集 + 7 个其他） | 验收按 1106 |
| `ResourceCard.tsx:25` 是外链卡片 | overlay 里没有该文件，外链卡片实际在 `navigation-card.tsx:153/281/447` 三处 | 改三处，不改镜像 |

---

## 十、如果只做三件事

1. **`/site/[id]` 服务端化 + 真 404 + 页面级 metadata/canonical** —— 1013 个页面从"空白模板"变成有标题、有 `<h1>`、有正文、有内链的真页面；无效 id 从 200 变 404。这是唯一一个"改完可索引页从 67 变 1100+"的动作，其它优化都以它为前提。
2. **`/sites` 目录 + sitemap 扩容** —— 服务端化只解决"能被索引"，内链 + sitemap 才解决"能被发现"；`/sites` 一个页面、17 个分页、首页一条入口，就把 1013 个详情页的点击深度从 ∞ 降到 2，且一张卡片都不用改。
3. **修 `storage-adapter.ts` 的读缓存** —— 不改这一处，前两件做完仍会每次抓取打穿中枢。这是唯一跨全站的杠杆点：一行 fetch 选项（2026-10-21 已落地，见 §7.5/§7.6）。~~首页瘦身~~ **已撤销**：生产实测首屏 JS 1063KB（预算内）、HTML gzip 100KB，审计里的「7.5 MB / 8.2 s」是 dev 模式全资源口径的失真（§7.6 有完整对比表）。

第 4 件才是 **132 个分类 hub**：它把 1005 个站点的爬取路径从"首页直连"变成"首页 → 分类 → 站点"，是内链结构的最后一块，但**不必等 `categories.slug` 迁移**——先用 `/category/{id}` 就能上线，slug 只是后续可读性优化。

这四件做完，整站才具备"被正常索引"的资格；结构化数据、文案批量生产、外链建设都排在这之后。
