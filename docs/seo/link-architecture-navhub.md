# NavHub 内链架构与信息架构设计（连乐桥 · 链接策略）

> 数据口径：本地 :3000 实测 SSR HTML + `data/navhub.db` 直查。所有数字可复现（脚本见 §8）。

> **口径更新（2026-10-22 类目树升级）**：本文的分类口径（594 分类 / 132 个 ≥5 站点 / 488 条 `parent_id` / 门槛 5）是**旧平铺树**的历史快照，留作当时的证据，不要再据此改代码。新口径：权威树 18 根 / 215 叶（`packages/core/src/category-registry.ts`），站点只挂叶子、一级根只做导航；根与父级的站点数按后代聚合（`apps/web-overlay/src/lib/seo/category-totals.ts`）；索引门槛已分档——类目 12 / 标签 5（`apps/web-overlay/src/lib/seo/thresholds.ts`）。复核请用 [方案 V4](./SEO-OPTIMIZATION-PLAN-V4-2026-10-22.md)。

## 1. 现状内链图谱（SSR 实测，非推测）

| 页面类型 | 数量 | 出链到哪些类型 | 入链来源（SSR 内 `<a>`） | 是否孤岛 |
|---|---|---|---|---|
| `/` 首页 | 1 | 外链 1022 条；内链仅 12 条（页脚 9 + `/hot`×2 + `/tags`） | 全站 `/` 链接 | 否（枢纽） |
| `/site/{id}` 站点详情 | 1020 | **0 条**（整页客户端渲染，SSR 只有 skip-link） | **0 条** | **是，1020 个** |
| `/tags/{slug}` 标签结果 | 1080 | **0 条**（卡片是客户端外链 `<a href={site.url}>`） | **0 条** | **是，1080 个** |
| `/tags` 标签云 / `/collections` 合集入口 | 2 | **0 条** → `/tags/{slug}`、`/collections/{slug}` | `/tags` 在页脚、`/collections` **不在页脚** | `/collections` 是孤岛 |
| `/collections/{slug}` | 4 | 0 条（客户端） | **0 条** | **是，4 个** |
| `/marketplace/{slug}` 插件详情 | 64 | — | **0 条**（`/marketplace` 的 4 条链接全是子站 `publish`/`mine`/`installed`/`import`，不是插件详情） | **64 个孤岛** |
| `/marketplace` `/hot` `/graph` `/algorithms` `/custom` `/import` 等枢纽（含市场入口） | 8 | — | 页脚全站 1 条/页 | 否 |

**核心指标（实测）**
- 库存可索引页面：`1`（首页）`+ 1013`（active 站点；7 条非 active 将 410）`+ 1079`（标签，`/api/tags` 默认 `minCount=1` 口径）`+ 2`（标签云/合集入口）`+ 4`（合集）`+ 65`（市场入口 + 64 插件）`+ 7`（`/hot` `/graph` `/algorithms` `/custom` `/import` `/videos` 等）`= **2171**`（`robots.ts` 仅拦 `/admin` `/api/` `/preferences` `/favorites`）。**这是「库存名义」口径**；其中 997 个薄标签页按 §3.4 判 `noindex`，故**实际提交 sitemap 的是 1174 条**——两个数字都对，分母不同，别混用
- 孤岛数（SSR 入链 = 0）：**2163 / 2171 = 99.4%**（`scripts/link-graph.mjs --from-db` 实测）= 1013 site + 1079 tag + 4 collection + 64 plugin + 1 `/collections` + 2 其他
- 内容型页面平均入链：**0.000**（实测；口径 = 内容型 URL 的 SSR 入链总数 ÷ 内容型 URL 数）
- 最大点击深度：**2**，但**首页出发总共只能到达 13 个 URL（0.6%）**——1013 个 `/site/{id}`、1079 个 `/tags/{slug}`、64 个插件详情**一个都到不了**
- sitemap 仅 67 条（3 静态 + 64 插件），**覆盖率 67/2171 = 3.1%**
- 代码层指向 `/site/` 的引用仅 3 处，全部不产出有效入链：`search-palette.tsx:630`、`site/[id]/page.tsx:459/534`、`admin/stats/page.tsx:455`（robots 禁抓）。**根因不是「没数据」，是「数据错了」**：`site_relations` 表确实 0 行，但 `/api/hub/sites/{id}/relations` 从 `packages/core/src/ecosystem.ts` 的 **17 个 URL/关键词键**实时匹配（种子 25 条目）。两个缺陷叠加：① **`targetSiteId` 100% 缺失** → `site/[id]:457/:533` 的 `alt.targetSiteId ? <Link> : <span>` 恒走 span，内链 0 条；② **键是 host 级**，`"github.com"` 一个键命中 **76 个 active 站点**（Cline / vLLM / Qwen 2.5 / LangGraph …），实测 `hey`（HTTP 压测 CLI）的平替是「GitLab：私有化部署的代码托管平台」——**7.5%（76/1013）的站点在被错误陈述平替**，全站 98 站（9.7%）被种子命中、其中 88 站（8.7%）落在多站共享键上。所以平替区块当前是**错误内容**，不是空内容。

**两个比"孤岛"更致命的缺陷**
1. **重复 title**：`/site/{id}` 的 title 恒为 `站点详情 - NavHub 导航`（1020 份完全相同），description 恒为 `站点简介、相似推荐与生态关联`，`<h1>` 数量 = **0**；`/tags/{slug}` 的 title 恒为 `标签详情`（1080 份相同，不含标签名）。
2. **无限软 404 空间**：`/site/abc`、`/site/99999999`、`/tags/zzz-xxx`、`/collections/zzz-xxx` 全部返回 **HTTP 200**（实测）；标签名/别名双形态同样 200（`/tags/AI%20编程` 与 `/tags/ai-编程` 均 200，328 个标签受影响）。这是抓取预算黑洞，优先级高于孤岛治理。

## 2. 孤岛治理：卡片双模式（不牺牲"点卡直达"）

**2.1 为什么不能把外链改内链中转** —— 导航站的核心价值是**一跳直达**。"首页 → NavHub → 详情页 → 目标站"变成两跳，跳出率必然上升，且 1020 条内链的权重收益远小于体验损失。所以：**外链保持，内链以"不争抢主点击"的方式叠加**。

### 2.2 双模式 DOM 设计（拉伸链接 + 分层 z-index）
核心技巧：`<a>` 不能嵌套，因此**取消外层 `<a>` 包裹**，改为「整卡拉伸外链（z-0）+ 站内入口（z-10）作为兄弟节点」：

```tsx
// components/navigation-card.tsx —— 标准模式（现 446-460 行）
<Card tabIndex={0} data-navhub-site-id={item.id} className="group relative ...">
  {/* ① 拉伸外链：覆盖整卡，z 最低，无文本 → 必须有 aria-label */}
  <a href={safeHref(item.href)} target={linkTarget} rel="noopener noreferrer"
     data-prefetch-target="true" onClick={handleLinkClick}
     aria-label={`访问 ${item.title} 官网（新窗口打开）`}
     className="absolute inset-0 z-0 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/50" />
  <CardHeader className="relative z-10 pointer-events-none">   {/* 内容不拦截点击 */}
    <CardTitle>
      {/* ② 标题=站内详情：pointer-events-auto 把它从覆盖层里"挖"出来 */}
      <Link href={`/site/${item.id}`} onClick={(e) => e.stopPropagation()}
            className="pointer-events-auto hover:text-primary hover:underline underline-offset-4">
        {item.title}
      </Link>
    </CardTitle>
  </CardHeader>
  {/* ③ 角落站内入口（爬虫与键盘的可靠落点），操作胶囊整体提到 z-30 */}
  <Link href={`/site/${item.id}`} title="站内详情"
        aria-label={`查看「${item.title}」详情：介绍、平替与相似站点`}
        className="absolute bottom-2 right-2 z-20 pointer-events-auto ...">
    <Info className="w-3.5 h-3.5" />
  </Link>
</Card>
```

**2.3 取舍**
| 方案 | 主点击体验 | 爬虫可见内链 | 判定 |
|---|---|---|---|
| 全卡改内链 | 变两跳，最差 | 强 | ✗ 杀核心价值 |
| 整卡外链 + 角落入口（标题不动） | 100% 保留 | 1 条/卡 | ✓ 首页不采用（见 §6 预算） |
| **拉伸外链 + 标题内链 + 角落入口** | 保留（标题改站内，是唯一代价） | 2 条/卡 | ✓ **仅用于分类 hub / 标签页** |

**标题改站内的代价**：点击标题的用户比例最高，但导航站用户多是"看到标题 → 想去这个站"，两个动作挤在同一视觉层会让用户困惑。因此**只在分类 hub / 标签页启用标题内链；首页卡片零改动**（纯外链、不渲染任何 `/site/` 内链），站内详情统一从分类 hub 进入——首页 → hub → 详情仍是 **2 跳**，不吃深度。同一组件用 `detailLinkMode: 'none' | 'title'` 由页面传入，首页传 `none`；视觉上仅在 `title` 模式给标题加 hover 下划线，让两种模式可感知。

**2.4 可访问性**
- 拉伸 `<a>` 无文本 → 必须 `aria-label`（含站点名 + "新窗口"），否则读屏读到空链接；且**保留在 Tab 序列第一位**（不可 `tabindex="-1"`），否则键盘用户失去主操作。
- 标题内链与角落入口的 `aria-label` 必须**互不相同**且描述性（避免"查看详情"）；卡片容器 `tabIndex={0}` 已存在，`handleKeyDown` 需明确：`Enter` → 外链，`Shift+Enter` → 站内详情。
- 焦点可见：拉伸 `<a>` 的 ring 需作用于容器（`focus-within:ring-2`），否则焦点框被卡片裁切。
- 改动文件：`components/navigation-card.tsx`（3 处 `<Link`：紧凑 **152** / **丰富 280** / 标准 **446**）；`ResourceCard.tsx` 是**死代码**（`ResourceTabs` 无任何页面 import，实测 0 处引用），本轮不碰，若将来启用需在 overlay 新建同路径文件覆盖。

**顺带修掉的漏点**：标准/丰富卡片里的 `#{tag}`（`navigation-card.tsx:334`）当前是 `<span>` —— **1020 个站点共 2231 个标签槽位**（`site_tags` 2231 行，均值 2.19/站，无站点仅 1 标签，191 站 ≥3），全是白白浪费的内链，改为 `<Link href={`/tags/${slug}`}>`；`site/[id]:389` 已用 `/tags/{name}`，需统一改为 slug 形态（见 §3.3）。

## 3. 信息架构

**3.1 `/category/{slug}` 值得建（数据支持）**
- 594 分类中 **132 个 ≥5 站点**（口径：`sites.category_id = c.id OR sites.sub_category_id = c.id`；**952/1020 站点带 `sub_category_id`**，只算 `category_id` 会漏算成 99）。**去重并集覆盖 1005 个站点（98.5% 的库）**，均值 **7.6 站/页**（`sum(n)=1206` 含父子重复，不可用）。`parent_id` 有 488 条非空 → 天然两层。
- 结论：**132 个分类 hub 是接住 1005 个站点详情页的最优中间层**（首页直接挂 1020 个站点详情是链接预算灾难）。

### 3.2 三层结构与分工
```
L1 首页 /                     —— 只做"分类分发"：9 个首页导航分类 → 132 个 /category/{slug}
L2 分类 hub /category/{slug}  —— 该分类站点清单（≤60 卡/页）+ 兄弟分类 + 高频标签
L3 站点详情 /site/{id}        —— 同分类/同标签兄弟站点 8-12 条 + 平替 + 官方外链
过渡 /sites（**本轮最小可行 hub**：纯列表 + 分页。数据源必须用中枢 `GET /api/sites?status=active&limit=60&offset=N`（裸数组、只含 active），**不能用 `/api/search?q=`**：后者返回 1020 条含 7 条非 active、无 `total` 字段、`offset=1013` 直接 400、且走相关度排序会随规则调整而漂移）
侧层 /tags/{slug}（仅保留 82 个 ≥5 站点）/ /collections/{slug}（4 个）/ /graph
```

### 3.3 URL 规范
| 页面 | URL | 说明 |
|---|---|---|
| 分类 hub | `/category/{slug}` | **`categories.anchor` 不可直接用**：101 个是纯 UUID，另有一批是 `parentUuid/childUuid` 路径串（实测），非 URL 安全 |
| 分类列表 | `/category` | 132 个 hub 的索引页（**依赖 `/category/[id]` 路由先上线**，否则不进 sitemap） |
| 全站目录 | `/sites` | **本轮 hub**：1013 站 / 60 一页 = **17 页**（末页 53 条），SSR 输出标题内链。**页 1 可索引 + 自 canonical；页 ≥2 `robots:{index:false,follow:true}` + 自 canonical（不指回页 1，否则 2–17 页被当重复页丢弃，但 `follow` 必须留以传权重）**。⚠️ `follow` 的语义要分实体：**有内容但不想收录 → `follow:true`**（薄标签、分页页）；**实体不存在 → `follow:false`**（无效 `/site/{id}`、`/tags/{slug}`、`/collections/{slug}`）。别让 dev 抄成同一句。sitemap 只放 `/sites` 一条，不放 17 页；用可见 `<a href="?page=N">`，不用 `rel=prev/next`（已弃用） |
| 站点详情 / 合集 / 分页 | `/site/{id}`、`/collections/{slug}`、`/category/{slug}?page=2` | 前两者保留自指 canonical；分页加 `noindex,follow` + 自指 canonical |
| 标签页 | `/tags/{slug}` | **必须只用 slug**：`tags.slug` 全量非空，328 个 `name ≠ slug`；当前 `site/[id]:389` 用 name 生成，制造重复 URL |

**迁移要求**：新增 `categories.slug`（`title` 转拼音 + 冲突加序号，唯一索引），路由层 `where slug = ? OR id = ?` 兜底，canonical 恒指向 slug 形态。**在 slug 回填完成前，用 `/category/{id}` 上线**（难看但可用，先解决孤岛，再做美化）。**`/site/{id}` 本轮不做 slug 化**：`/api/sites/:id` 只接受 id 或 URL，改 URL 必须动 API 契约，属 P1 之后。**标签别名归一是必须项，不是优化**：`site/[id]:389` 现在用 `site.tags`（名称）拼 `/tags/`，而 `tags` 总数 **1079**、`name !== slug` **328 条**（如 `Rust→rust`、`CI→ci`、`PDF→pdf`）——约 30% 站内标签链接指向非规范形态，不做 308 就会让 `/tags/Rust` 与 `/tags/rust` 各自被索引。锚文本一律用规范中文 name。

### 3.4 489 个空分类的正确处置：下架，不是 noindex
- `noindex` 仍需被抓取 → 浪费预算，且 489 个 0 站点页面对用户是死胡同（软 404 风险）。正确做法：**不生成路由** —— `/category` 索引页与所有 `getStaticParams`/sitemap 只取 `site_count ≥ 5`（按 `category_id OR sub_category_id` 计）的 132 条，其余分类请求直接 `notFound()` → 410/404。
- 数据层同步：`categories.enabled` 全为 1，建议把 489 个空分类置 `enabled=0`，管理后台默认隐藏，避免后续误建页。**同名分类 2 组共 4 个 hub 需先消歧**：`语言`（10 站 / 5 站，共 3 条记录但仅 2 条 ≥5）、`操作系统`（5 站 / 6 站）——按 `父分类·子分类` 命名，否则同页两个锚文本会指向两个 URL。
- 同类处理（**两层，不必按站数细分**）：`≥5 站点（82 个）`正常建页进 sitemap；`<5 站点（997 个 = 2-4 站 287 + 1 站 710）`→ **`200 + noindex, follow`**；**只有「标签名根本不存在」才 404**（`/api/tags/resolve` 返回 404 时）。踩过的坑：`/api/tags` 默认 `minCount=1`，**0 站标签在接口层就被滤掉**（DB 有 1 个、接口侧 1079 而非 1080），所以「0 站 → 404」这个桶实际不存在，别照抄。**1 站标签不 301 的理由**：301 不可逆、浏览器与爬虫缓存以月计，而标签站数会变（今天 1 站、明天补到 5 站就该进 sitemap）；noindex 可逆，同样拿到「保外链、不断站内可用性」的收益，还留着长尾词起量的可能。
- ⚠️ **必须与「卡片 `#tag` 断链」同批上线**（`site/[id]:389`、`tags/[slug]:85-88` 现在都是 `<Link`）：只做一半会造出成片内部 404/301 跳转，比薄页更伤。**断链口径 = 369 保留 / 710 降级**：`≥5`（82）+ `2–4 站`（287）共 **369 个仍渲染 `<Link>`**（这两档页面都存在，2–4 档只是 noindex）；只有 **1 站（710）降为 `<span>`**。注意：这 710 个页面**仍然保留 `200`**（不 301、不 404，见上条），降 `<span>` 是为了**自指循环**——卡片上的 `#tag` 属于该站，点了会进"只含这一个站点"的列表页，而那个列表页唯一的内容就是刚离开的站点；对用户是原地绕圈，对爬虫是零增益。

## 4. 三角互链规则（硬约束）

| 页面 | 必须包含的出链 | 内链上限 | 外链上限 |
|---|---|---|---|
| `/category/{slug}` | ① 面包屑上级分类 1-2 ② 子分类 hub 2-6 ③ 站点详情 20-60（标题内链）④ 该分类高频标签 3-5 ⑤ 站点外链按钮 1/卡 | 70（60 站点 + 10 hub/标签） | 60（每卡 1 直达，`rel="noopener noreferrer"`） |
| `/site/{id}` | ① 面包屑：首页 → 分类 hub → 本站点 ② 同分类兄弟站点 6-8（KNN 结果改内链）③ 同标签页 2-3 ④ 平替 **0 条**（见 §1：`targetSiteId` 全缺 + host 级键错配，在补字段与缩小键粒度之前**不产内链、不做 schema、不进 title**）⑤ 官方主站外链 1 | 12 | 2 |
| `/tags/{slug}` | ① 面包屑 `/tags` ② 共现标签 3-5（同站点共现 Top）③ 站点详情 20-50 ④ 相关分类 hub 1-2 | 60 | 50 |
| `/sites` | ① 面包屑 `/` ② 站点详情 60（标题内链）③ 分页收敛为首/上/下/末 **4 条** ④ 页脚 9 | **80** | 60 |
| `/` | ① 1 条 → `/sites` ② 页脚 9 条 ③ 外链卡片（零改动，见 §6）；`/category` 上线后再加 132 条 hub 链接 | 20 | ≤ 150 |

**锚文本规范（禁止"查看详情""点击进入""了解更多"）**
| 场景 | 模板 | 示例 |
|---|---|---|
| 分类 hub | `{分类名}合集`（名字已含「工具/平台/服务」时只加「合集」）/ `浏览全部 {N} 个 {分类名}` | `AI 工具合集`（**不是**「AI 工具工具合集」）、`浏览全部 21 个数据库与存储` |
| 站点详情 | `{站点名}的平替方案` / `{站点名}详情` | `查看 Figma 的平替与生态搭配` |
| 标签 | `{标签名}相关工具`（slug 中文兜底用 name） | `Rust 相关工具` |
| 站点卡片标题 / 兄弟站点 | 裸站点名（部分匹配，最自然）；兄弟站点可加 `（同分类）` | `Vercel`、`Supabase（同分类）` |
| 外链 | 保留站点名 + 视觉外链图标，**不改锚文本** | `Vercel` ↗ |

**校验规则**：同一页面内同一目标不得出现 2 次相同锚文本；锚文本长度 2-12 字；禁止以"详情/点击/这里/更多"结尾。

## 5. 面包屑与 JSON-LD 同源

**一个组件同时产出可见面包屑 + `BreadcrumbList`**，放在 `components/breadcrumbs.tsx`（**Server-safe，零 hooks**）：

```tsx
// components/breadcrumbs.tsx  —— Server-safe，零 hooks
type Crumb = { name: string; href?: string }
export function Breadcrumbs({ items, origin }: { items: Crumb[]; origin: string }) {
  const ld = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({
      '@type': 'ListItem', position: i + 1, name: c.name,
      ...(c.href ? { item: origin + c.href } : {}),
    })),
  }
  return (
    <>
      <nav aria-label="面包屑" className="text-xs text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          {items.map((c, i) => {
            const last = i === items.length - 1
            return (
              <li key={(c.href ?? '') + c.name} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight aria-hidden className="w-3 h-3 opacity-50" />}
                {c.href && !last
                  ? <Link href={c.href} className="hover:text-foreground transition-colors">{c.name}</Link>
                  : <span aria-current={last ? 'page' : undefined} className="text-foreground font-medium">{c.name}</span>}
              </li>
            )
          })}
        </ol>
      </nav>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
    </>
  )
}
```

**hydration 两个风险点与规避**
1. **`origin` 绝不从 `window.location` 读**。SSR 时为空、CSR 时有值 → 若 origin 参与可见 DOM 会直接 mismatch。方案：`origin` 由页面从 `headers()` 推导后作为 props 下传（复用 `sitemap.ts` 里 `siteOrigin()` 的写法）。JSON-LD 走 `dangerouslySetInnerHTML`，React 不比对，天然安全；但**可见 DOM 只用相对 href**，恒等。
2. **客户端页面（`'use client'`）不要用异步数据决定"渲染几段"**。`items` 数量在 SSR 首帧与 hydration 首帧必须一致。`/site/{id}` 现在标题来自 `fetchSite` → 首帧为空。正确做法（也是根治方案）：
   **把 `app/site/[id]/page.tsx` 拆成 RSC 壳 + 客户端交互区**：`page.tsx` 用 `await fetchSite(id)` 取数据 → `generateMetadata` 输出 `{title}: ${site.title} - NavHub` 与真实 description → 渲染 `<h1>`、`<Breadcrumbs>`、内链列表；`site-detail-client.tsx` 只保留收藏/复制/平替筛选等交互。**这一步同时消灭 1020 个重复 title、0 个 h1、0 条 SSR 内链**，是整个项目 ROI 最高的改动。`/tags/{slug}` 同理：slug 来自 `useParams()`（SSR 有值，安全），但站点列表来自 fetch → 列表容器改为 RSC 侧渲染前 20 条，客户端只负责"加载更多"。

## 6. 链接预算与爬虫效率

| 项 | 现状（实测） | 目标 |
|---|---|---|
| 首页出链 | **1034 条**（1022 外链 + 12 内链），HTML **7.5 MB** | 站点卡片**零改动**（1020 条外链是产品本质，一键直达不可削）；只新增 **1 条** → `/sites`（`/category` 上线后再 +132）。**首页不承载任何 `/site/` 内链**，预算下移到 `/sites` 与 hub 层（`/sites` 80 内链/页，其余 hub ≤70） |
| 枢纽页 / 详情页出链上限 | 无约束 / 0 | 150 / 15 |
| 分页 | 无 | `/category/{slug}?page=N`：60 卡/页，`noindex,follow`，canonical 自指（不做 canonical 回第一页，否则第 2 页站点永不被收录） |
| 筛选参数 | `/tags/{slug}` 走 `searchSites({tag})`，无 `?sort=` 污染 | 任何 `?utm_*`/`?ref=` 一律 301 到无参；`?page` 之外的参数页 `noindex,follow` |
| `/s/{code}` 短链 | `app/s/[code]/route.ts` 302 跳 `/marketplace/*`，robots 未拦 | ① `robots.ts` disallow `/s/`；② route 上手写响应头 `X-Robots-Tag: noindex, nofollow`；③ 保留 302（不升 301，短链目标可改） |
| 软 404 | `/site/{任意}`、`/tags/{任意}`、`/collections/{任意}` 全 200 | 全部 `notFound()`；实测 50 个随机 slug 必须 404 |
| 标签 URL 归一 | `name` 与 `slug` 双形态均 200（328 个标签受影响） | 非 slug 形态 301 → `/tags/{slug}` |
| 首页体积 | 7.5 MB（1020 卡全量 SSR） | **保持全量 SSR**（移出 SSR = 把 1020 条外链从 HTML 里拿掉，爬虫不保证执行 JS 补齐），改用 `content-visibility:auto` + `contain-intrinsic-size`，并把 favicon 收敛为同一 `symbol` 复用。现有 7.5 MB ≈ 每卡 7 KB，主要是 class 串与内联 SVG |

## 7. 内容健康度评分

**公式**（0-100）：`H = 0.30·T + 0.25·U + 0.25·L + 0.20·I`，其中 `T = 60·min(1, SSR正文字数/300) + 40·min(1, 内链实体数/20)`；`U = 100·[0.5·(1−重复title) + 0.3·(1−模板正文) + 0.2·(1−重复description)]`；`L = 100·min(1, SSR入链数/20)`；`I` = 人工结构化评分（承接的查询意图与页面可提供信息量的差值）

| 页面类型 | T | U | L | I | **H** | 关键扣分依据 |
|---|---|---|---|---|---|---|
| `/site/{id}` ×1013 | 5 | 0 | 0 | 45 | **10.5** | SSR 正文 0 字、`<h1>` 0 个；title/description 100% 重复；入链 0；描述均长 28.2 字符 |
| `/tags/{slug}` ×1079 | 8 | 6 | 0 | 35 | **10.9** | title 全为"标签详情"；`tags.description` 0/1080 有值；卡片为客户端外链 |
| `/collections/{slug}` ×4 | 25 | 70 | 0 | 60 | **37.0** | 18 条 items / 4 合集 ≈ 4.5 条/页；入链 0 |
| `/marketplace/{slug}` ×64 | 55 | 75 | 20 | 65 | **53.3** | 入链仅 4 条 |
| `/` ×1 | 78 | 85 | 100 | 90 | **87.7** | 唯一强项，但承载 1022 条外链 |
| `/tags` `/collections` `/marketplace` 枢纽 ×3 | 15-40 | 60-75 | 100 | 60-70 | **57 / 61 / 70** | title 唯一、入链充足，但内容客户端渲染 |
| `/hot` `/graph` `/algorithms` 等 ×8 | 30 | 70 | 100 | 55 | **63.0** | 客户端组件为主 |

**本期基线**：按页面数加权 `Σ(H×页数)/2172 = **12.3 / 100**`
（`87.7 + 1013×10.5 + 1079×10.9 + 57 + 61 + 4×37 + 70 + 64×53.3 + 8×63 = 26737.5`；`26737.5 / 2172 = 12.31`）
**分层看**：枢纽层 12 页均值 **65.0**，内容层 2168 页均值 **12.0** → 问题 100% 集中在详情/标签层，方向明确。

## 8. 8 周可量化目标

| 指标 | 基线（实测） | W8 目标 | 验证方法 |
|---|---|---|---|
| 孤岛页面数（SSR 入链 = 0） | **2163（99.4%）** | **≤ 40**（仅非 active 站点与长尾插件） | `scripts/link-graph.mjs --from-db` |
| 内容型页面平均入链 | **0.000** | **≥ 3.5** | 同上 |
| 最大点击深度（首页出发） | **2 但仅 13 个 URL 可达** | **≤ 3，且 ≥98% 可达** | 同上 |
| ≤3 点击可达页面占比 | **0.6%（13/2171）** | **≥ 98%** | 同上 |
| 名义可索引页面 | 2171 | **1307**（W8 全量） | sitemap 条目数 |
| sitemap 覆盖率 | 67 / 2171 = 3.1% | **P0 阶段 1174 → W8 1307** | 抓 `sitemap.xml` 计数 |
| 重复 title 页面数 | 2100（1020 + 1080） | **0** | 脚本比对 `<title>` 唯一性 |
| 软 404（随机 slug 返回 200） | 100% | **0** | 50 个随机 slug 探针 |
| 全站健康度 H | 12.3 | **≥ 45** | §7 公式重算 |

**分两阶段**：`P0`（`/category` 路由未建，**不可提前进 sitemap**，指向 404 会拉低整份文件信任度）= `1013` active site `+ 82` 标签 `+ 4` 合集 `+ 1` `/collections` `+ 64` 插件 `+ 1` `/marketplace` `+ 11` 静态（`/` `/sites` `/hot` `/tags` `/collections` `/marketplace` `/graph` `/algorithms` `/custom` `/import` `/videos`；`/submit` 已判 noindex 不计）= **1174**。`W8` 加上 `132` 分类 hub `+ 1` `/category` 索引 `= **1307**`。同时 7 个非 active 站点 410。

**验证工具**：① `scripts/link-graph.mjs`（**已交付**，零依赖，Node ≥22）：从 `/` 起 BFS 抓 SSR HTML，并用 `--from-db=data/navhub.db` 反推库存页面清单——**这一步是必需的**，否则只会报"孤岛 0"（孤岛因入链为 0 永远不会被 BFS 走到）。输出 `data/link-graph.json`（indegree / depth / 每页出链 / 软 404 探针），`--check` 模式在未达 §8 阈值时退出码 1，可直接进 CI；`--assert-pagination` 追加 4 条 `/sites` 分页断言（分页页有 `/site/` 出链却带 `nofollow` / 页 1 被 `noindex` / `?page=1` 未 308 / 页 1 首屏出链 ≠ 60），`/sites` 未上线时自动标 `skipped` 不判失败；② GSC 覆盖率报告：`已编入索引` ≥ 1100、`已发现-尚未编入索引` < 10%、`重复，Google 选择的规范网页与用户指定的不同` < 5%（标签双形态的验收口径）；③ 爬虫日志按 `Googlebot` UA grep `GET /site/` 与 `GET /tags/` 日计数，要求 `/site/` 日抓取 > 0 且 404 率 < 2%；④ 脚本内 50 次随机 slug 探针。
## 9. 落地清单（按优先级）

| P | 改动文件 | 改动点 | 影响页面数 | 风险 |
|---|---|---|---|---|
| P0 | `app/site/[id]/page.tsx` → 拆 `page.tsx`(RSC) + `site-detail-client.tsx` | `generateMetadata` 输出真实 title/desc；渲染 `<h1>` + `<Breadcrumbs>` + 服务端内链列表 | 1020 | 中：RSC 化需把 `fetchSite` 从客户端 hooks 迁出，降级提示逻辑要重做 |
| P0 | `app/tags/[slug]/page.tsx`、`app/collections/[slug]/page.tsx`、`app/site/[id]/page.tsx` | 无效 slug → `notFound()` **且 `generateMetadata` 返回 `robots:{index:false,follow:false}`**（防 `error.tsx` 兜底回归 200+真标题）；标签 URL 只认 slug，非 slug 308 | 全站 | 低：需确认 `searchSites`/`fetchCollectionDetail` 的 miss 语义 |
| P0 | `app/sitemap.ts` | 分两次：先 sites(1013)/tags(82)/collections(5)/插件(64)/静态(11) → 1174；`/category` 上线后再加 132+1 | 1174→1307 | 低：`/category` 未建时**绝不能先写进 sitemap**；8 组重复在生成侧去重，不阻塞 |
| P0 | `app/sites/page.tsx`（新增）+ **新建** `lib/server/hub.ts` 的 `hubGet()` | **本轮 hub**：走中枢 `/api/sites?status=active&limit=60&offset`（**不是 `/api/search`**）。⚠️ **两个坑**：① `:3000/api/sites` 无路由、实测 **404**（`app/api/` 下没有 `sites`，也无 rewrite）；② **不能复用 `lib/navhub-api.ts`**——它的 `BASE = '/api/hub'` 是**相对路径**（该文件头写明"浏览器侧"），RSC 里 `fetch` 会抛 `TypeError: Failed to parse URL`。必须新建 server helper 读 `NAVHUB_STORAGE_BASE_URL` 用**绝对地址**（照抄 `app/api/search/route.ts` 的 baseUrl 写法）。首页只加 1 条入口 | 1013（17 页） | 低：`hasMore = items.length === 60`；页 ≥2 需 `noindex,follow`+自 canonical |
| P1 | `app/category/[slug]/page.tsx`（新增）+ `app/category/page.tsx`（新增） | 三层结构中间层；≥5 站点才生成；`?page=N` 分页。**`语言`×2、`操作系统`×2 这 4 个同名 hub 消歧前不建** | 132 + 1 | 中：`anchor` 非 URL 安全（101 个纯 UUID + 路径串），需 `slug` 列或 id 兜底 |
| P1 | `components/navigation-card.tsx`（`<Link` 152 / 280 / 446） | 新增 `detailLinkMode` prop：hub 层=拉伸外链 + 标题内链 + 角落 ⓘ；**首页传 `none`，行为零变化**。`#tag` span → `Link`（仅 82 个 ≥5 标签） | 1020 卡 | 中：改点击模型，需回归拖拽/多选/置顶/peek 四条交互；首页必须验证「一键直达」未回归 |
| P1 | `app/page.tsx` / `navigation-content.tsx` | 首页增加 9 个导航分类 + 132 个分类 hub 入口（**必须 SSR 首屏输出**，不可 `IntersectionObserver` 补齐） | 1 | 中：首页 7.5MB，需与懒渲染同批上线 |
| P2 | `components/breadcrumbs.tsx`（新增）+ 各页接入 | 可见面包屑与 `BreadcrumbList` 同源 | 1104 | 低：注意 `origin` 只能服务端推导 |
| P2 | `app/tags/page.tsx` | 标签云改为服务端渲染 82 个 `≥5` 标签的 `<Link>` | 82（入链从 0 变 82） | 低 |
| P2 | `app/robots.ts` + `app/s/[code]/route.ts` | disallow `/s/`、`/videos/player`；短链响应头 `X-Robots-Tag: noindex, nofollow` | — | 低 |
| P3 | 数据层：`site_relations`（0 行，实为 25 条硬编码种子）、`site_facets`（0 行）、`tags.description`（0/1080）、`categories.slug`、`visit_count`/`trend_score`（全 0） | `targetSiteId` 全缺 → 内链 0 条；键是 **host 级**（`"github.com"` 一键命中 76 站）→ 88 站（8.7%）被错误陈述平替，**这是内容错误不是内容缺失**。**修复必须按闸门顺序，跳步会制造更难的污染**：① 先把子串匹配改成**精确 URL 全等**或 **`siteId` 白名单**（注意：只把键细到 host+path 无效，`includes` 仍会命中父键）→ ② 再补 `targetSiteId` → ③ 最后才放开平替内链 / schema / title。**反过来做（先补外键再修匹配）会把 76 条错误关系变成站内内链，权重污染从外链挪进内链、回滚成本更高**；分面胶囊完全不渲染（`site_facets` 0 行）；**且 `relationsDegraded` 只在 fetch 抛错时置真**，`total:0` 时区块与降级提示都不渲染，真报错时又误报「服务未响应可重试」 | 1020 | 中：属数据生产 + 一处错误文案，**决定 §4 平替内链能否落地** |

**不做的事**：① 不把 489 个空分类做成页面；② 不把 1020 条外链改内链中转；③ 不给 `/site/{id}` 加 `noindex`（它是长尾流量入口，要先修内容再谈收录）；④ 不改 `apps/web`（vendored 镜像），所有改动落 `apps/web-overlay/src`；⑤ 不对同标题站点做自动合并（见下）。
**站点去重（不阻塞上线）**：严格 URL 归一（host 去 www + path 去尾斜杠 + 小写）得 **4 组 8 个 URL**，可全自动处理，且**只在 sitemap 生成侧去重**（每组取最小 id，纯函数，10 行）——8 页近重复占 0.7%，不值得为它推迟 67 → 1174 的整体收益。需人工判断、**不要自动合并**的另有 4 组：`remove.bg`/`remove.bg/zh`、`todoist.com/`/`todoist.com/zh-CN`（locale 变体，应 301 到根）、`windsurf.ai`→`windsurf.com`（换 TLD）、`chatgpt.com`(broken)→`chat.openai.com`（换域名）。**2 组是误报必须都留**：`helm`（Stanford HELM 评测基准 vs Helm 包管理器）、`langgraph`（GitHub 仓库 vs LangChain 产品页）。
