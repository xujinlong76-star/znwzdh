# NavHub SEO 方案 V4 · 规模复核版

- 日期：2026-10-22
- 性质：**仅扫描与分析，未改任何代码**
- 前置：V2（索引地基/RSC/软404/sitemap/JSON-LD）、V3（内链/分享卡/审计）已落地并收官
- 本轮新输入：**生产种子集实测**（29 个 site-pack，5845 条条目）+ 全量代码复核

---

## ⚠️ 修订记录（2026-10-22 晚，执行阶段回填）

本方案初稿有两处 P0 判断在落地时被数据推翻，**以本节为准**：

| 初稿结论 | 修订后事实 | 依据 |
|---|---|---|
| P0-1「分类门槛 12 会砍掉 59% 站点入口」 | ❌ **错误，已撤回**。按权威树叶子重算：210 个叶子中 147 个 ≥12，覆盖 **5238/5845 = 89.6%** 站点。门槛 12 是**校准正确**的 | `apps/api/test/seed-plugins.test.ts`「类目索引门槛的站点覆盖率是棘轮」：29 包 / 5845 站 / **解析不到叶子 0 条** / 中位 18 站每叶 / 门槛 12 覆盖 89.6%（一次性脚本 `tmp-leaf-dist.mts` 已并入该断言，改门槛值就是改这条棘轮） |
| P0-2「阈值分档从未接线」 | ⚠️ **部分错误**。overlay（事实源）**已接线**；未接线的是 `apps/web` 镜像副本（陈旧） | `apps/web-overlay/src/app/{sitemap,category/page,category/[slug],site/[id],page}.tsx` 均引用分档常量 |

**错误根因**：初稿用「包内分类标题」当分母（536 个，中位数 11），而真实口径是「权威树叶子」（210 个，中位数 18）。site-pack 的分类标题会经 `resolveRegistryLeaf` 映射到叶子，解析不到才落未分类——实测 5845 条**全部解析成功**，0 条落未分类。

**仍然成立的结论**（已在执行阶段修复）：
- overlay 的 `app/category/page.tsx` 与两个测试文件仍引用已删除的 `MIN_SITES_FOR_INDEX`，**导致源仓库无法编译**——已修复
- 镜像 `apps/web` 与 overlay 有 12 个文件漂移——已 `--fix` 同步
- 71 组「同标题、不同 URL」站点——已改为标题带分类名消歧

---


## 0. 一句话结论

技术 SEO 该做的都做完了——孤岛 0、软 404 0、重复 title 0、sitemap 机制满配。但**这些结论全部是在 51 个站点的开发集上验证的**。换成生产集（5845 条 → 去重后 4752 站 / 536 个分类）后，有三条既有决策会被数据直接推翻：

1. **分类门槛 12 会砍掉 59% 的站点入口**。536 个分类里只有 189 个 ≥12 站，仅覆盖 2387 站；其余 347 个分类会 `notFound()`，其下 3458 个站点失去分类 hub。
2. **阈值分档写了但没接线**。`MIN_SITES_FOR_CATEGORY_INDEX=12` / `MIN_SITES_FOR_TAG_INDEX=5` 全仓 **0 引用**，所有页面仍在用 `MIN_SITES_FOR_INDEX=5`（该常量注释自称"临时兼容垫片，勿提交"）。现在是"幸运的未接线"——真按 12 接上就是第 1 条那个结果。
3. **主矛盾已经从"能不能收录"变成"内容够不够厚"**。4752 个详情页，描述长度中位数 **23 字**（P10=19、P90=31），98% 不足 40 字；页面正文除标题和这 23 字之外全是链接列表。

---

## 1. 实测数据（本轮扫描的核心证据）

### 1.1 种子集规模与去重损耗

| 指标 | 数值 | 来源 |
|---|---:|---|
| 29 个 site-pack 的站点条目总数 | **5845** | `apps/api/src/seed-data/site-packs/*.ts` |
| 重复 URL 数 | **739** | 同上 |
| 冗余条目（重复计数） | **1093** | 同上 |
| 去重后唯一站点 | **4752** | 同上 |
| 分类定义条数 | 538（536 个唯一标题） | 同上 |
| 跨包重名分类 | 2（`数据库与存储`、`办公套件与文档`） | 同上 |

> 种子写入逻辑（`apps/api/src/seed.ts:120-121`）是 `findSiteByUrl` 命中即 `skipped++; continue`——**先到先得**。这意味着 1093 条条目被静默丢弃，且丢弃的是**后到包里那一版**的描述/分类/标签，哪怕它更好。

### 1.2 分类门槛的覆盖率曲线（决定性数据）

按 site-pack 里每个分类实际挂的站点数统计：

| 门槛 | 达标分类 | 覆盖率 | 被砍掉的分类 | 失去分类 hub 的站点 |
|---:|---:|---:|---:|---:|
| **5（当前线上值）** | 536 / 536 | 100% | 0 | 0 |
| **8（数据推荐值）** | 511 / 536 | **97%** | 25 | 163 |
| **12（已定义待接线值）** | **189 / 536** | **41%** | **347** | **3458** |

分类站点数的中位数是 **11**。门槛 12 卡在中位数之上，等于把一半以上的分类判死。

### 1.3 描述质量分布（去重后 4752 站）

| 分位 | 描述字数 |
|---|---:|
| P10 | 19 |
| **中位数** | **23** |
| P90 | 31 |
| < 20 字 | 899 站（18%） |
| < 40 字 | 4695 站（**98%**） |

> 分布窄到反常：P10 到 P90 只差 12 个字。这不是"内容长度参差"，是"所有页面长得一模一样"。4752 个页面共用同一种 23 字句式，是典型的模板化薄内容特征。

### 1.4 去重后仍存在的重复标题

| 指标 | 数值 |
|---|---:|
| 重复标题种类 | **71** |
| 涉及站点 | **143** |
| 样例 | `ChatGPT ×2`、`Cursor ×2`、`中国农业银行 ×2`、`驾考宝典 ×2` |

同一 title 落在不同 URL 上（多为 `chat.openai.com` vs `chatgpt.com`、`cursor.com` vs `cursor.sh` 这类官网迁移），会产出两条 `<title>` 完全相同的详情页，互相蚕食。

---

## 2. 问题清单

### P0 — 规模一上来就会出问题

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| P0-1 | **分类门槛 12 与真实分布严重错配** | `lib/seo/thresholds.ts:14` 定义 12；实测 536 分类中位数 11 站，≥12 的仅 189 个 | 若按 12 接线，347 个分类页 `notFound()`，3458 个站点（59%）失去分类 hub |
| P0-2 | **阈值分档未接线** | `MIN_SITES_FOR_CATEGORY_INDEX` / `MIN_SITES_FOR_TAG_INDEX` 全仓 0 引用；`sitemap.ts:113-114`、`category/[slug]/page.tsx:14`、`category/page.tsx:8`、`page.tsx:11` 全部用 `MIN_SITES_FOR_INDEX=5` | 分类与标签共用 5，分档决策等于没生效；且 `MIN_SITES_FOR_INDEX` 注释写明"临时垫片，勿提交" |
| P0-3 | **低于门槛分类直接 404，与标签页策略不一致** | `category/[slug]/page.tsx:88` 判定 `qualifies`，不达标走 `notFound()`；标签页是 `noindex,follow`（`tags/[slug]/page.tsx:78`） | 分类 404 会连带断掉其下站点的唯一分类入链；标签却保留页面。同一类"薄页"两种处置 |
| P0-4 | **种子重复导致实际内容量比计划少 19%** | 5845 条 → 4752 站（-1093）；`seed.ts:120` 先到先得 | 容量规划、sitemap 预估、门槛测算全部建立在虚高的 5845 上 |
| P0-5 | **71 组同标题不同 URL** | 去重后 143 站 | 两条详情页 `<title>` 相同，关键词互相蚕食 |

### P1 — 影响长尾竞争力

| # | 问题 | 证据 |
|---|---|---|
| P1-1 | 描述同质化：4752 页全部 19-31 字 | §1.3 |
| P1-2 | 站点详情页零正文：4 个区块全是链接列表（`site-detail-view.tsx` 的 h2 分别对应关系网/生态/同分类/相似），无任何事实型说明段落 | `components/site-detail-view.tsx:459/526/577/647` |
| P1-3 | sitemap 规模未实测：机制满配，但从未在 4752+536+64 的真实量级上跑过生成耗时与体积 | `app/sitemap.ts` |
| P1-4 | 构建期预渲染压力：`generateStaticParams` 会为每个达标分类拉 `loadCategorySites`，536 个分类 × 多次 hub 往返 | `category/[slug]/page.tsx:104-116` |
| P1-5 | GSC / TTFB 仍标注 ⏳，本地无法验证 | `.workbuddy/memory/2026-10-22.md:18` |

### P2

- 分类 description 偏短（538 条定义普遍一句话），未做长度与意图校准
- `title_en` / `description_en` 字段闲置，无 hreflang 方案
- IndexNow 脚本已就绪但未接入部署流程
- `images.remotePatterns` 默认 `https://**` 未收紧（成本/安全项）

---

## 3. 方案

### Phase 1（P0，半天）修门槛与 404 策略

#### 1.1 门槛用 8，不是 12 也不是 5

理由必须落在数据上，不能拍脑袋：

- **12**：覆盖率 41%，347 个分类判死，3458 站失去 hub → 直接否掉。
- **5**：覆盖率 100%，但 536 个分类里有 25 个只有 5-7 站，页面除列表外无内容 → 薄页。
- **8**：覆盖率 97%，只砍 25 个分类（163 站），砍掉的正是站点最少的尾部；中位数 11 站意味着多数分类仍有 11+ 条真实条目可展示。

```ts
// src/lib/seo/thresholds.ts —— 删掉垫片，改为按数据定的分档
/** 分类页：实测 536 个分类站点数中位数 11；门槛 8 覆盖 97% 站点、仅淘汰 25 个尾部类目 */
export const MIN_SITES_FOR_CATEGORY_INDEX = 8

/** 标签页：标签是长尾集合，5 站即可构成有意义的聚合 */
export const MIN_SITES_FOR_TAG_INDEX = 5

/**
 * @deprecated 2026-10-22 起分档，勿再新增引用。
 * 保留导出只为让未迁移的调用点在类型上仍可编译；迁移完成后删除。
 */
export const MIN_SITES_FOR_INDEX = MIN_SITES_FOR_CATEGORY_INDEX
```

> 注意最后一行：垫片指向**分类门槛**而不是继续写死 5，这样漏改的调用点会跟着分类口径走，而不是悄悄停留在旧值。

#### 1.2 逐个调用点接线

| 文件 | 当前 | 改为 |
|---|---|---|
| `app/sitemap.ts:113` | `tagEntries(..., MIN_SITES_FOR_INDEX)` | `MIN_SITES_FOR_TAG_INDEX` |
| `app/sitemap.ts:114` | `categoryEntries(..., MIN_SITES_FOR_INDEX)` | `MIN_SITES_FOR_CATEGORY_INDEX` |
| `app/category/[slug]/page.tsx` | `MIN_SITES_FOR_INDEX` | `MIN_SITES_FOR_CATEGORY_INDEX` |
| `app/category/page.tsx` | `MIN_SITES_FOR_INDEX` | `MIN_SITES_FOR_CATEGORY_INDEX` |
| `app/page.tsx`（首页目录带） | `MIN_SITES_FOR_INDEX` | `MIN_SITES_FOR_CATEGORY_INDEX` |
| `app/tags/[slug]/page.tsx` | 已有分层逻辑 | 补 `MIN_SITES_FOR_TAG_INDEX` 常量引用 |

#### 1.3 低于门槛的分类：改成 noindex,follow，不要 404

这是本轮最重要的一处策略修正。

**现状**：`category/[slug]/page.tsx:88` 判定不达标就 `notFound()`。后果是：一个挂了 7 个真实站点的分类页返回 404，那 7 个站点就只剩 `/sites` 分页和详情页互链这两条弱路径。

**改为三档处置**：

```tsx
// category/[slug]/page.tsx —— 把二值判断换成三态
type CategoryVerdict = 'index' | 'noindex' | 'missing'

function verdictOf(siteCount: number, categoryExists: boolean): CategoryVerdict {
  if (!categoryExists) return 'missing'      // 分类不存在 → 真 404
  if (siteCount === 0) return 'missing'      // 空分类 → 404（无内容可给）
  if (siteCount < MIN_SITES_FOR_CATEGORY_INDEX) return 'noindex' // 有内容但不值得索引
  return 'index'
}
```

对应 `generateMetadata`：

```ts
if (verdict === 'missing') notFound()

return {
  title,
  description,
  alternates: { canonical },
  ...(verdict === 'noindex' ? { robots: { index: false, follow: true } } : {}),
  ...(await pageShareMetadata({ url: canonical, title, description })),
}
```

**为什么这样更好**：
- 7 个站点的分类页对用户是有价值的（能浏览），对搜索引擎是薄的 → 保留页面 + `noindex,follow`，内链权重照常传，用户路径不断。
- 与标签页策略统一，不再出现"同类薄页两种处置"。
- 空分类仍然 404 —— 那才是真的没有内容可给。

> 这条修改会让 `category` 的 404 探针测试（`test/category-hub.test.ts`）需要同步调整：原本断言"低于门槛 → 404"，改为"0 站 → 404 / 1..7 站 → noindex"。

### Phase 2（P0，1 天）种子去重与标题消歧

#### 2.1 去重从"先到先得"改为"择优保留"

```ts
// apps/api/src/seed.ts:120 附近
const dup = await ctx.repo.findSiteByUrl(s.url);
if (dup) {
  // 同 URL 已在库：保留信息量更大的那一版，而不是无条件丢弃后到的
  const incoming = (s.description ?? '').trim();
  const existing = (dup.description ?? '').trim();
  if (incoming.length > existing.length + 10) {
    await ctx.repo.updateSite(dup.id, {
      description: s.description,
      // 分类不覆盖：分类归属以先入库的权威包为准，避免同一站点在包之间来回横跳
    });
    improved++;
  } else {
    skipped++;
  }
  continue;
}
```

要点：
- **只覆盖描述，不覆盖分类**。分类归属来回变会让分类页的站点集合抖动，`revalidate` 窗口内出现"站点从 A 分类消失"，比描述差一点更伤。
- 阈值 `+10` 是为了避免"改两个标点也算更优"的无意义写入。

#### 2.2 71 组重复标题消歧

```ts
// site/[id]/page.tsx 的 generateMetadata
const categoryName = category?.title ?? null
// 同标题站点存在时，用分类名做区分；分类名也没有才退回域名
const titleSuffix = categoryName ? ` · ${categoryName}` : ` · ${new URL(site.url).hostname}`
const title = `${site.title}${needsDisambiguation ? titleSuffix : ''}`
```

`needsDisambiguation` 的来源：入库时统计同 `title` 的站点数，>1 时打标（或查询时判断）。这样 `ChatGPT · 大模型对话助手` 与 `ChatGPT · AI 编程助手` 不再同题。

#### 2.3 描述补写优先级

按"描述最短 + 分类站点数最多"排序，先补高价值页：

```sql
SELECT s.id, s.title, s.url, length(s.description) AS len, c.title AS cat,
       (SELECT COUNT(*) FROM sites x WHERE x.category_id = s.category_id
          AND x.deleted_at IS NULL AND x.enabled = 1 AND x.status = 'active') AS cat_count
FROM sites s LEFT JOIN categories c ON c.id = s.category_id
WHERE s.deleted_at IS NULL AND length(s.description) < 20
ORDER BY cat_count DESC, len ASC
LIMIT 200;
```

目标：把 899 个 <20 字的站点补到 40-80 字。**不要**为了凑字数堆"最好/必备/第一"——V3 红线仍然有效。

### Phase 3（P1，2-3 天）站点详情页正文增量

4752 个详情页目前只有标题 + 23 字描述 + 链接列表。要给每页加**有事实依据**的正文，而不是编造评测。

可用的事实字段（`sites` 表已有，无需新增采集）：

| 字段 | 可生成的正文 |
|---|---|
| `url` | 官网域名、是否为子域/镜像 |
| `category_id` | 所属分类（链接到分类页） |
| `site_tags` | 标签清单（链接到标签页） |
| `http_status` / `health_ok` / `latency_ms` / `last_checked_at` | 「最近一次可达性检查：2026-10-22，HTTP 200」——这是**独家事实**，官方站没有 |
| `site_relations` | 平替/生态/上下游关系的自然语言说明 |
| `created_at` | 收录时间 |
| `source` | 来源（seed / submit / 用户投稿） |

建议新增一个「收录档案」区块（放在现有链接区块之前）：

```tsx
<dl className="grid gap-2 text-sm sm:grid-cols-2">
  <div><dt>官网</dt><dd><a href={site.url} rel="noopener noreferrer nofollow">{hostname}</a></dd></div>
  <div><dt>所属分类</dt><dd><Link href={`/category/${categorySlug}`}>{categoryTitle}</Link></dd></div>
  <div><dt>收录时间</dt><dd>{formatDate(site.createdAt)}</dd></div>
  <div><dt>最近检查</dt><dd>{formatDate(site.lastCheckedAt)} · HTTP {site.httpStatus}</dd></div>
</dl>
<p>
  {site.title} 是收录在「{categoryTitle}」分类下的工具站点，
  可通过官网 {hostname} 直接访问。
  {relationSummary /* 由 site_relations 生成的自然语言，如「与 X、Y 互为平替」 */}
</p>
```

**收益**：每页从"23 字"提升到 150-250 字的事实型正文，且 4752 页各不相同（域名、分类、时间、状态都不同）。这是唯一能规模化、又不违反"不编造"红线的做法。

### Phase 4（P1，1 天）规模验证

代码层面无法回答的问题，必须实测：

```bash
# 1) 灌满生产种子（4752 站）
pnpm seed

# 2) sitemap 体积与耗时
time curl -s -o /tmp/sitemap.xml -w '%{size_download} bytes\n' localhost:3000/sitemap.xml
grep -c '<url>' /tmp/sitemap.xml

# 3) 构建期预渲染耗时（536 个分类页）
time pnpm --filter navsphere build

# 4) 分类页 ISR 命中
curl -s -o /dev/null -w '%{http_code} %{time_total}\n' localhost:3000/category/<slug>
curl -s -o /dev/null -w '%{http_code} %{time_total}\n' localhost:3000/category/<slug>  # 第二次应显著更快

# 5) 全量审计（生产预览，不是 dev）
node scripts/seo-audit.mjs --base=http://localhost:3000 --limit=6000 --concurrency=4 --retries=2 --json
```

判定线：
- sitemap 单文件 ≤ 50MB / ≤ 50000 URL（4752+536+82+64 ≈ 5434，单片足够，**不需要分片**——这点要明确写进结论，避免过度设计）
- 首次生成 ≤ 30s，ISR 命中后 ≤ 200ms
- 审计 0 问题（OG / JSON-LD / 内链三项）

### Phase 5（P2）测量闭环

- GSC / Bing 提交 sitemap，观察"已编入 / 已排除"比例；软 404 回归监控
- IndexNow：部署后配置 `INDEXNOW_KEY`，先 dry-run 再按发布批次推送
- RUM：生产开 `NEXT_PUBLIC_RUM=1`，采集 LCP/INP/CLS；**不要用 dev 数字做决策**

---

## 4. 与 V2/V3 的关系（哪些结论被推翻）

| 既有结论 | 出处 | V4 判定 |
|---|---|---|
| 分类门槛 12 | `thresholds.ts:14`（方案 P4） | ❌ **推翻**：实测只覆盖 41% 站点。改为 8 |
| 分类/标签分档 | 同上 | ⚠️ **保留方向，修正执行**：分档对，但从未接线；且分类值需重定 |
| 低于门槛分类直接 404 | `category/[slug]/page.tsx:36` | ❌ **推翻**：改为 noindex,follow（0 站才 404） |
| sitemap 需要分片 | 我 10-20 的 V1 | ❌ **撤回**：5434 条远低于 50000 上限，单片足够，分片是过度设计 |
| 软 404 归零 | V3 已达成 | ✅ 保留，但 404 探针测试需按 Phase 1.3 调整 |
| 孤岛归零 | V3 已达成（12 类全 0） | ✅ 保留；但规模上量后需重跑 `link-graph` 复验 |
| 重复 title 归零 | V3 已达成（开发集） | ⚠️ **部分失效**：生产集去重后仍有 71 组 / 143 站 |
| 内容就绪度 | V3 I1（35/51 短描述） | ⚠️ **低估**：生产集是 899/4752 <20 字、98% <40 字 |

---

## 5. 排期

| 阶段 | 工作量 | 依赖 | 交付 |
|---|---|---|---|
| Phase 1 门槛与 404 策略 | 0.5 天 | 无 | thresholds.ts + 6 处调用点 + category 三态判定 + 测试调整 |
| Phase 2 种子去重与标题消歧 | 1 天 | Phase 1 | seed.ts 择优覆盖 + title 消歧 + 200 条描述补写清单 |
| Phase 3 详情页正文增量 | 2-3 天 | Phase 2 | 「收录档案」组件 + 4752 页正文从 23 字到 150-250 字 |
| Phase 4 规模验证 | 1 天 | Phase 2 完成后 | sitemap/构建/ISR/审计四项实测数字 |
| Phase 5 测量闭环 | 持续 | 需真实部署 | GSC 收录曲线、IndexNow 推送记录、CWV 基线 |

**建议顺序：Phase 1 → Phase 4 → Phase 2 → Phase 3 → Phase 5。**
把 Phase 4 提前到第 2 位，是因为只有先跑出真实规模数字，Phase 2/3 的投入方向才有依据（例如若构建时间已经 8 分钟，Phase 3 加重正文前就得先解决预渲染）。

---

## 6. 验收指标

| 指标 | 当前 | 目标 |
|---|---:|---:|
| 分类页 404 数（生产集） | 若接 12 则 347 | **0**（<8 站走 noindex，不 404） |
| 被索引分类数 | 536（门槛 5） | 511（门槛 8，覆盖 97% 站点） |
| 去重后站点数 | 4752 | 4752（去重逻辑改进，数量不变但描述更优） |
| 重复 title 组数 | 71（143 站） | 0 |
| 详情页正文中位字数 | 23 | ≥150 |
| 描述 <20 字站点 | 899 | ≤100 |
| sitemap URL 数 | 134（dev 51 站） | ≈5434（生产集全量） |
| sitemap 生成耗时 | 未测 | ≤30s（首次）/ ≤200ms（缓存） |
| 运行时审计问题数 | 0（60 页抽样） | 0（6000 页全量） |

---

## 7. 红线（延续 V3，新增 2 条）

1. 不为 0 站分类生成索引页；1-7 站分类页 `noindex,follow` 但**必须保留**，不 404。
2. 不编造评分、排名、安装量、"平替/最强/必备"。Phase 3 的正文只能用 `sites` 表已有的事实字段。
3. 不为了 SEO 把外链改成内链中转；卡片主点击保持外链。
4. 不新增 `site/[id]/loading.tsx`（软 404 根因）。
5. 页面级 `openGraph` 必须走 `pageShareMetadata` 工厂。
6. **【新增】不因"提升数字"下调门槛**。门槛由覆盖率数据决定，不由 sitemap 条数好看决定。
7. **【新增】描述补写不做批量模板生成**。899 条短描述必须人工/半人工逐条补，模板批量生成会把"23 字同质化"变成"80 字同质化"，问题不变只是变长。

---

## 8. 结论

V2/V3 解决的是"搜索引擎能不能进来、能不能走下去"。这两件事已经做完，且在 51 站点的开发集上验证过。

V4 要解决的是**换到 4752 站点后，前面所有阈值和假设是否还成立**。答案是不成立：分类门槛 12 会砍掉 59% 的入口，阈值分档从未生效，内容厚度是 23 字的模板化短句。

如果只能做三件事：

1. **Phase 1**：门槛改 8 + 接线 + 分类不达标改 noindex（半天，收益最大，风险最低）
2. **Phase 4**：把 4752 站灌进去跑一遍真实规模（一天，决定后面所有投入方向）
3. **Phase 2**：种子择优覆盖 + 71 组标题消歧（一天，消灭重复与损耗）

Phase 3 的内容增量是真正的长期工作，但要等 Phase 4 的数字出来再定投入力度。
