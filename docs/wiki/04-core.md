# 04 · packages/core —— 领域层

> 包名 `@navhub/core`，**零 workspace 依赖**的最底层包（仅依赖 `zod` + `pinyin-pro`）。
> 承载：领域模型、CJK 分词、拼音、RRF 融合、通道注册表、排序公式、画像聚合，
> 以及一批「前端智能」纯函数算法（对比矩阵、架构配方、推测意图、模块化布局、加密金库、预取…）。

## 1. 模块文件清单

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| [index.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/index.ts) | 18 | 桶导出（17 个模块） |
| [types.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/types.ts) | ~280 | **领域模型**：Site / Category / 检索类型 / 富化类型 / NavSphere 兼容类型 |
| [channels.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/channels.ts) | 68 | **通道注册表**：名单 + 权重，运行时可扩展 |
| [cjk.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/cjk.ts) | 86 | CJK 分词与 FTS5 MATCH 表达式生成 |
| [pinyin.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/pinyin.ts) | 45 | 拼音线索生成与查询归一化 |
| [fusion.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/fusion.ts) | 140 | **RRF 融合** + 个性化通道 + coverage |
| [ranking.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/ranking.ts) | 58 | 热度 / 新鲜度公式（纯函数） |
| [profile.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/profile.ts) | ~70 | 画像聚合（半衰期衰减） |
| [ecosystem.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/ecosystem.ts) | 183+ | 生态增强库：深链动作 / 平替雷达 / 工作台映射 |
| [speculative-intent.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/speculative-intent.ts) | ~380 | 推测意图 0-RTT 原地预执行（Base64/时间戳/颜色/算术/JSON/URL/哈希/IP） |
| [comparison.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/comparison.ts) | ~230 | 端侧竞品并排对比矩阵（`react vs vue` 类查询） |
| [architecture-recipe.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/architecture-recipe.ts) | ~270 | Graph-RAG 多跳技术栈链路配方 |
| [modular.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/modular.ts) | ~490 | 模块化前端系统协议 + 栅格布局算法 |
| [vault.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/vault.ts) | ~130 | 零知识端到端加密金库（PBKDF2 + AES-256-GCM） |
| [prefetch.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/prefetch.ts) | ~110 | 预测性鼠标轨迹预取与 0-RTT 预连接 |
| [linucb.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/linucb.ts) | ~280 | **LinUCB 上下文多臂老虎机**自适应通道融合 |
| [hyperbolic.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/hyperbolic.ts) | ~200 | **庞加莱双曲空间**度量与平替推理 |
| [health-sentinel.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/health-sentinel.ts) | ~160 | 页面视觉感知防劫持与软 404 巡检 |

> `packages/core/test/` 6 个测试文件：`core` / `ranking-profile` / `modular-layout` / `vault-and-prefetch` / `recipes-and-comparison` / `future-algorithms`。

## 2. 领域模型（types.ts）

### 2.1 站点与类目

```ts
type Id = string;
type SiteStatus = "active" | "pending" | "broken" | "archived";

interface Site {
  id: Id;  url: string;  title: string;
  titleEn?, description?, descriptionEn?;      // 中英双语
  iconKey?, screenshotKey?;
  categoryId: Id;  subCategoryId?: Id | null;
  tags: string[];
  status: SiteStatus;  enabled: boolean;
  sort: number;        // 排序权重，兼作拖拽顺序
  weight: number;      // 命中检索线索数（点击/曝光/搜索），用于个性化
  featured?: boolean;
  source?: string | null;   // manual|import|submission|ai|seed|navsphere|api|mcp
  visitCount?, lastVisitedAt?, trendScore?;    // 行为统计
  health?: SiteHealth;                          // httpStatus/ok/latency/error/lastCheckedAt
  actions?: SiteAction[];                       // 深链快速微动作
  relations?: SiteRelation[];                   // 生态与替代品
  liveMetrics?: SiteLiveMetrics;                // GitHub Star/版本/license/延迟
  workspaces?: string[];                        // dev|design|ai|content
  createdAt: number;  updatedAt: number;
}

interface Category {
  id: Id;
  anchor: string;   // 物化路径 "a/b/c"
  parentId: Id | null;
  title; titleEn?; description?; icon?;
  enabled: boolean;  sort: number;
  source?: string | null;   // navsphere|api|ai|seed；null 视为前端托管
  createdAt; updatedAt;
}
```

**`anchor` 物化路径**是刻意设计：避免「插入子类时父类可能不存在」的循环外键问题；类目后代查询走 `anchor LIKE '前缀/%'`。

另有 `Collection` / `CollectionItem`（精选专题，`kind: topic|geo|roadmap`）、`NavSphereNavigationData` 等 NavSphere 兼容类型。

### 2.2 检索类型

```ts
type SearchChannel = BuiltinChannel | (string & {});  // 内置保留补全，扩展不报错

interface SearchCandidate { siteId; channel; rank; rawScore?; }   // rank 从 1 开始
interface SearchHit      { siteId; score; contributions: Partial<Record<SearchChannel, {rank, value}>>; }
interface PersonalizationSignals { topCategories?; topTags?; visitedSiteIds?; }
interface PersonalizableSite     { siteId; categoryId; tags: string[]; }

interface SearchQuery {
  q; limit?; categoryId?; tag?; statuses?;
  disableSemantic?; disablePersonal?;
  personalize?: PersonalizationSignals;
}
interface SearchResult {
  hits: SearchHit[];
  channelsUsed: SearchChannel[];   // 实际参与的通道，供诚实降级提示
  semanticAvailable: boolean;
  tookMs: number;
}
```

> **`contributions` 是可解释性的载体**：每个 `SearchHit` 记录它在每一路召回中的 `rank` 与 `value`，前端可以回答「它为什么排这儿」。

### 2.3 富化类型

`EnrichmentInput { url, title?, description?, categoryHint? }`
`EnrichmentResult { title, description, categoryId?, suggestedCategoryName?, tags[], keywords[], lang?, provenance: "llm"|"heuristic"|"none" }`

## 3. 通道注册表（channels.ts）

```ts
export const BUILTIN_CHANNELS = ["exact", "fts", "pinyin", "semantic", "personal"] as const;

export const BUILTIN_CHANNEL_WEIGHTS = {
  exact: 1.4,    // 中文子串最可靠
  fts: 1.0,      // BM25 相关性
  pinyin: 0.9,   // 全拼/首字母
  semantic: 1.15,// 向量 KNN
  personal: 0.3, // ← 偏好通道，权重刻意最小
};
```

| 导出 | 行为 |
| --- | --- |
| `registerChannel(name, weight?)` | 运行时追加通道，**幂等**（重复注册以最后一次 weight 为准）；`weight` 必须是非负有限数，否则抛错 |
| `searchChannels()` | 全部通道，**内置在前、扩展按名排序在后**（顺序稳定） |
| `channelWeight(name)` | 未注册返回 `0` → 融合时自然不参与 |
| `channelWeights()` | 权重表（`DEFAULT_WEIGHTS` 的来源） |
| `resetChannels()` | 测试用，重置为内置状态 |

**为什么需要注册表**：通道名单曾是 `types.ts` 的 const 数组，新增一路召回就得改 core 导出类型、所有消费方跟着改。注册表把「名单 + 权重」变成运行时可变。

> ⚠️ 注册表**只解决名单与权重**——新通道的**召回实现**仍由调用方提供（`SearchEngine` 的一个 `channel*` 方法）。

## 4. CJK 分词（cjk.ts）

**背景（已实测）**：SQLite FTS5 的 `unicode61` 分词器把连续汉字当作**一个** token，`match '启动'` 无法命中「启动脚本」；`LIKE '%启动%'` 能命中但不走索引、无相关性排序。

**解法**：写入期把中文转成「单字 + 相邻二元组」序列再喂给 unicode61。

```ts
hanToTokens("启动脚本")
// -> "启 动 脚 本 启动 动脚 脚本"
```

任意长度 ≥2 的中文子串都能被命中，且保留 BM25 排序。实测 `'启动'`、`'启动脚本'`、`'天气'`、`'天气网'`、`'包管理'` 全部命中。

| 函数 | 行为 |
| --- | --- |
| `isHan(ch)` | 是否汉字（`U+3400-4DBF / U+4E00-9FFF / U+F900-FAFF`） |
| `hanRuns(input)` | 提取所有连续中文片段 |
| `hanToTokens(input)` | **写入期**：中文单字 + 相邻二元组，拉丁词保留 |
| `buildFtsTokens(parts)` | 多字段拼接成 FTS 语料（null/undefined 跳过） |
| `buildFtsQuery(q)` | **查询期**：生成 FTS5 `MATCH` 表达式——中文按单字/二元组 `OR`，拉丁词用**前缀匹配**，处理 token 引号与去重；无可匹配 token 返回 `null` |

## 5. 拼音（pinyin.ts）

基于 `pinyin-pro`，目标：中文站点可用**全拼、首字母、中英混输**命中。实测：`启动脚本` → `qidongjiaoben` / `qdjb`。

| 函数 | 行为 |
| --- | --- |
| `pinyinTraits(input)` | 生成 `{ full, initials }`；**非中文部分原样保留**（便于 "github copilot"）；纯拉丁输入直接小写去符号 |
| `normalizeQueryPinyin(q)` | 查询期归一化 → 同上 |
| `looksLikeLatinQuery(q)` | 判断是否拉丁输入（触发拼音通道的条件之一） |

## 6. RRF 融合（fusion.ts）—— 检索核心

### 6.1 为什么用 RRF

RRF 只依赖**排名**而非分数，因此在异构通道之间天然可比（BM25 分、余弦相似度、LIKE 命中数之间没有可比性），无需调参，对单通道异常分数不敏感。

```
score(d)     = Σ_ch  w_ch / (k + rank_ch(d))
coverage 乘子 = 1 + coverageStrength × log2(coverage)
```

- `k = 60`（RRF 原论文经验值）
- `coverageStrength = 0.35`
- `coverage` **只统计相关性通道**（过滤掉 `personal`）——偏好通道不该抬高共识度

### 6.2 核心函数

```ts
export interface FusionWeights {
  coverageStrength: number;   // 0 = 关闭，1 = 标准
  k: number;                  // 60
  [channel: string]: number;  // 每通道权重，未列出按 0
}

export const DEFAULT_WEIGHTS: FusionWeights = { ...channelWeights(), coverageStrength: 0.35, k: 60 };
```

| 函数 | 行为 |
| --- | --- |
| `fuse(candidates, weights?, limit=20)` | ① 按通道权重累加 `w/(k+rank)`；② **同通道重复行只保留最优名次**（先减旧值再加新值）；③ coverage 乘子；④ 排序（score 降序，同分按 `siteId` 字典序）；⑤ 截断 |
| `personalCandidates(sites, signals, opts?)` | 偏好信号 → `personal` 通道候选（见 §6.3） |
| `channelsUsed(candidates)` | 汇总实际参与的通道（按注册表顺序），供前端诚实提示 |

> ⚠️ `DEFAULT_WEIGHTS` 是**构造时快照**——运行期 `registerChannel` 之后，调用方应显式传新的 weights 对象给 `fuse()`。

### 6.3 为什么个性化必须是「一路通道」

[fusion.ts L94-L103](file:///c:/Users/许进龙/Desktop/web/packages/core/src/fusion.ts#L94-L103) 的注释原话：

> RRF 的 k=60 让靠前名次的分数非常接近（排 1 与排 10 只差 ~15%）。如果先算相关性、再乘一个最高 20% 的偏好系数，就能轻易把排 8 顶到排 1 前面——这正是「越用越懂你」变成「搜什么都搜不到」的典型翻车方式。作为独立通道后，翻转能力由通道权重（默认 0.3 vs 相关性 1.0）明确限界，并且能通过 contributions 解释「它为什么排这儿」。

**亲和度打分**（`personalCandidates`）：

| 信号 | 加分 |
| --- | --- |
| 命中用户 top 分类 | `+0.5` |
| 命中 top 标签 | `+min(0.3, 0.15 × 命中数)` |
| 曾访问过的站点 | `+0.2` |

按亲和度降序排名 → 转成 `personal` 通道候选（`rawScore = affinity`）。
**前置约束**：只对「已经被相关性通道召回」的站点施加偏好，避免偏好把无关站点带进结果（见 `SearchEngine.search`）。

## 7. 排序公式（ranking.ts）

**核心约束**：热度与新鲜度是**独立排序键**，不进入 RRF 融合——理由与个性化相同（事后加成会翻转相关性）。热度是**浏览场景**的排序键，不是相关性的修正项。

```ts
interface TrendInput { visits7d: number; favorites7d: number; ageDays: number; }

export const TREND_WEIGHTS = { /* clicks / favorites / agePenalty 权重 */ };

trendScore(input, now = Date.now())   // 热度 = 近7天点击 + 近7天收藏 − 站点年龄惩罚
freshnessScore(createdAt)             // 新鲜度
ageInDays(createdAt, now)             // 站点年龄（天）
```

**公式设计**：
- 点击取**对数**——从 1 到 10 的边际递减，避免老站点凭累计永远霸榜
- 年龄惩罚**线性**——新站点有曝光机会，但不会仅凭新就压过高热站点

> 浏览排序键（`SearchEngine.browse`）：`featured DESC, trend_score DESC, weight DESC, sort ASC`。
> `trend_score` 由 `recompute_rank` 任务写入，为 0 时自然退化为旧行为，**对存量数据零影响**。

## 8. 画像聚合（profile.ts）

| 项 | 值 |
| --- | --- |
| 输入 | 用户近 N 天 `click` / `favorite` 事件（含站点类目与标签） |
| 输出 | `PersonalizationSignals` → 喂给 `personal` 通道（权重 0.3） |
| 时间衰减 | **7 天半衰期** `decay(ageDays, halfLifeDays = 7)` |
| 收藏权重 | **点击的 2 倍**（主动收藏是比偶然点击强得多的信号） |

```ts
interface BehaviorEvent { kind: "click"|"favorite"|string; siteId; categoryId: string|null; tags: string[]; createdAt: number; }
interface BuildProfileOptions { now?; halfLifeDays?; /* ... */ }
export const DEFAULT_PROFILE_OPTIONS = { halfLifeDays: 7, /* ... */ };

decay(ageDays, halfLifeDays = 7): number    // 指数衰减
buildProfile(events, opts = {}): BuiltProfile   // → PersonalizationSignals + 统计
```

## 9. 扩展能力模块

### 9.1 `ecosystem.ts` —— 生态增强库

`ECOSYSTEM_MAP: Record<string, EnhancedSiteData>` 规则字典（按 URL / 关键词匹配），为高频工具提供：
- `actions[]`：深链微动作（如 cursor.com → 查文档 / 社区）
- `relations[]`：平替雷达（AlternativeTo 语义，`relationType: "alternative"`，含 `isFreeOrOpenSource`）
- `liveMetrics`：GitHub Star / 版本 / license
- `workspaces[]`：`dev | design | ai | content`

`getEnhancedSiteData(url, title?)` 查表返回。这些字段由 `storage.ts` 写入 NavSphere 的 `NsItem`。

### 9.2 `comparison.ts` —— 端侧对比矩阵

`parseTechComparisonQuery(query)` 解析 `react vs vue`、`cursor vs vscode`、`pnpm vs bun` 类语法 → `TechComparisonMatrix`（**0 毫秒原地合成**，不外网请求）。

知识库 `COMPARISON_KNOWLEDGE_BASE: TechComparisonMatrix[]`，每项含 `dimensions[]`（`dimName / valueA / valueB / winner: 'A'|'B'|'TIE'`）、`spec { name, category, license, primaryPros[], tradeoffs[], bestFor }`。

### 9.3 `architecture-recipe.ts` —— 技术栈链路配方

`findMatchingArchitectureRecipe(query)` 在领域知识图谱中匹配 → `ArchitectureRecipe { layers: StackLayer[] }`，
每层 `StackLayer { layerName, category, recommended{...}, alternatives[] }`。
预设 `PRESET_RECIPES`：协同文档、本地大模型、全栈 Web、微前端、高可用监控等。

### 9.4 `speculative-intent.ts` —— 0-RTT 原地预执行

`parseSpeculativeIntent(input)` 识别 9 类输入并**即时计算**（Micro-Widget）：

```
base64_decode | base64_encode | timestamp | color | math
json_format   | url_decode    | hash_detect | ip_detect
```

返回 `SpeculativeIntentResult { type, title, subtitle, previewValue, actionLabel, ... }`。

### 9.5 `modular.ts` —— 模块化布局引擎

- `WidgetCategory = 'tools'|'efficiency'|'analytics'|'content'|'ai'`
- `BUILTIN_WIDGET_CATALOG: Record<string, ModularWidgetMeta>`（含 `defaultColSpan/RowSpan`、`min/maxColSpan`、`configSchema`）
- `BUILTIN_PRESET_TEMPLATES: ModularPresetTemplateData[]`
- 布局算法：`reorderWidgetsList`、`shiftWidgetPosition`、`clampWidgetSpan`、`createWidgetInstanceData`、`mergeWidgetConfig`、`compactWidgetsGrid`

### 9.6 `vault.ts` —— 零知识加密金库

- **PBKDF2（600,000 次迭代）**派生主密钥 + **AES-256-GCM** 认证加密
- 通用 Web Crypto API（Node 20+ / 现代浏览器）
- `VaultItem`（明文，含 `isInternal` 标记内网书签）、`EncryptedVaultPayload { version, cipherTextBase64, ivHex, ... }`
- 服务端仅触碰密文 Blob，**永无明文落盘风险**

### 9.7 `prefetch.ts` —— 轨迹预测预取

监听光标轨迹矢量的加速度与朝向夹角，在光标逼近卡片 **150ms 前**触发 DNS 预解析与 TCP/TLS 预连接。

| 函数 | 作用 |
| --- | --- |
| `calculateMotionVector(p1, p2)` | `MotionVector { vx, vy }`（像素/毫秒） |
| `isHeadingTowardsRect(...)` | 是否正朝目标矩形移动 |
| `extractSafeOrigin(rawUrl)` | 安全提取 origin（供预连接） |
| `shouldPreconnectOrigin(...)` | 是否触发预连接 |

### 9.8 `health-sentinel.ts` —— 防劫持巡检

终结「以 HTTP 200 为唯一标准的盲目健康假象」，识别三类问题：**域名抢注停放广告**、**SPA 假 200 软 404**、**单页黑产劫持**。

| 导出 | 作用 |
| --- | --- |
| `DOMAIN_PARKING_KEYWORDS` | 中英停放关键词（`domain for sale`、`域名出售`、`404 not found`…） |
| `stripHtmlToText(html)` | 提取可见文本 |
| `calculateShannonEntropy(text)` | DOM 文本信息熵（黑产页熵值异常） |
| `hammingDistance64(hashA, hashB)` | 64 位感知哈希汉明距离（视觉对比） |
| `auditPageHealth(...)` → `HealthAuditResult` | 状态机 `HEALTHY \| SUSPICIOUS_PARKED \| SOFT_404 \| THIN_CONTENT` |

被 `jobs.ts` 的 `health_check` 任务消费。

### 9.9 `linucb.ts` —— LinUCB 自适应通道融合（未来算法）

**目标**：终结 RRF 静态常数超参缺陷——根据查询特征向量在线自适应计算 5 大通道的**置信度上界（UCB）权重**。

| 导出 | 说明 |
| --- | --- |
| `CONTEXT_DIM = 5` | `extractContextFeatures(query)` → 5 维特征：长度归一化 / CJK 占比 / 字母占比 / **拼音似然度** / 数字占比（均归一化到 [0,1]） |
| `LinUCBArmState` / `LinUCBModel` | 每臂 `A_inv`（逆矩阵）+ `b`（累积奖励向量），`alpha` 默认 0.25 |
| `createLinUCBModel(alpha=0.25)` | 初始化（`A = 单位阵`） |
| `invertMatrix` / `matVecMul` / `dotProduct` / `createIdentityMatrix` | 纯 JS 线性代数（无依赖） |
| `predictArmWeights(model, features)` | UCB score = `θᵀx + α·√(xᵀA⁻¹x)`，并**融合业务先验** |
| `updateArmReward(model, features, arm, reward)` | 在线更新 `A` / `b` |
| `serializeLinUCB` / `deserializeLinUCB` | JSON 持久化 |

### 9.10 `hyperbolic.ts` —— 庞加莱双曲空间（未来算法）

**目标**：突破欧氏空间在树形分类与深层拓扑中的维度膨胀失真，用双曲空间指数级体积增长特性计算测地线距离，推导高置信度平替与上下游依赖。

| 导出 | 说明 |
| --- | --- |
| `EPSILON = 1e-5` | 数值稳定阈值 |
| `euclideanNorm` / `euclideanDot` | 欧式基础 |
| `clampToBall(v, maxNorm = 1-EPSILON)` | 限制在单位球内 |
| `expMap0(v)` / `logMap0(y)` | 原点指数/对数映射（球 ↔ 切空间） |
| `mobiusAdd(u, v)` | Möbius 加法 |
| `poincareDistance(u, v)` | 测地线距离 |
| `computeHyperbolicAlternativeScore(...)` | 平替置信度 |
| `findTopAlternativesInHyperbolicSpace(...)` | 返回 `HyperbolicAlternativeMatch[]` |

## 10. 依赖关系

```
@navhub/core
  ├── 外部依赖：zod（校验）、pinyin-pro（拼音）
  └── 被依赖：@navhub/store、@navhub/ai、@navhub/api、@navhub/mcp
       · store  用：fuse / DEFAULT_WEIGHTS / personalCandidates / cjk / pinyin / trendScore / buildProfile
       · ai     用：EnrichmentResult 等类型
       · api    用：ageInDays / trendScore / auditPageHealth（jobs）
       · 前端   用：lib/{speculative,comparison,architecture-recipe,vault,prefetch}.ts 包装
```

**约定**：core 里的算法都是**纯函数、无 IO、无框架依赖**——这既是可测试性（6 个测试文件覆盖），也是前端能在浏览器侧直接复用的原因。
