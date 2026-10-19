# NavHub 4.0 — 全量代码文件索引

> 本文档共 **844 条文件条目**：778 个经静态解析的代码/配置文件，外加 46 个 shadcn 原子件与部署/文档清单。不含 node_modules、构建产物与二进制资源。每条给出职责、实现要点、关键导出与真实 import 依赖。
> 架构原理、数据流与模块间协作关系见 [`CODEBASE_OVERVIEW.md`](./CODEBASE_OVERVIEW.md)；**可搜索浏览版**见 [`codebase-index.html`](./codebase-index.html)（支持按模块筛选、关键词过滤、点击展开）。

## 目录

| 章节 | 内容 |
| :--- | :--- |
| 0 | 根级工程与配置文件 |
| 1–4 | `packages/core` / `store` / `ai` / `mcp`（后端库） |
| 5 | `apps/api`（Fastify 中枢，含 13 个测试文件） |
| 6 | `apps/web-overlay`（前端事实源，202 个文件） |
| 7 | `apps/web`（199 个镜像文件 + 106 个上游独有文件） |
| 8–9 | `extensions` / `scripts` |
| 10 | shadcn/ui 原子组件（46 个） |
| 11 | `e2e` / `docker` / `docs` 清单 |

**阅读说明**：`行数` 为该文件总行数；`关键导出` 取实际 `export` 声明（最多 8 个）；`主要依赖` 由源码 import 语句静态提取——`包` 指 workspace 包（@navhub/*），`相对模块 N 个` 指同仓相对路径导入的数量与前三个目标，`外部` 指第三方依赖。

## 0. 根级工程与配置文件

| 文件 | 职责 | 关键配置 |
| :--- | :--- | :--- |
| `package.json` | Monorepo 根清单与统一脚本入口。 | pnpm@11.7.0 / Node>=22；build、dev、dev:web、test、test:e2e、typecheck、seed、check:overlay、verify |
| `pnpm-workspace.yaml` | 工作区边界、依赖版本钉死与安装期脚本白名单。 | 包含 packages/*、apps/*，排除 web-overlay；overrides 钉 next/zod/sharp/undici；allowBuilds 放行 better-sqlite3/onnxruntime |
| `tsconfig.base.json` | 全仓 TypeScript 基线。 | ESM、strict、bundler 解析、allowImportingTsExtensions（支持 node --experimental-strip-types 直跑 .ts） |
| `vitest.config.ts` | 单元/集成测试配置。 | node 环境、workspace 包别名、覆盖范围与超时 |
| `playwright.config.ts` | E2E 配置。 | webServer 启动前端、baseURL、trace 与重试策略 |
| `Dockerfile` | 单镜像多阶段构建（API/Web 共用基底）。 | node:22、pnpm fetch 分层缓存、prune 生产依赖 |
| `docker-compose.yml` | 历史简版编排（已废弃，保留兼容）。 | api + web 双服务、healthcheck 与数据卷 |
| `types/sqlite-vec.d.ts` | sqlite-vec 最小类型声明。 | load(db)、getLoadablePath() |
| `.env.example` | 全量环境变量样例与注释。 | NAVHUB_MODE / PORT / STORAGE_ADAPTER / 鉴权 / embedding / LLM / 代理 |

## 1. `packages/core` — 领域模型与纯算法库（59 源文件 + 23 测试，11,646 行）

零 IO、零框架依赖的纯函数层：检索通道/融合/排序、LinUCB、双曲几何、推测意图、CRDT、布局算法、知识图谱等。所有模块均可被服务端与浏览器同时复用（core 不依赖 store/api）。

| 文件 | 行数 | 职责与实现要点 | 关键导出 | 主要依赖 |
| :--- | ---: | :--- | :--- | :--- |
| `packages/core/src/architecture-recipe.ts` | 271 | Graph-RAG 多跳技术栈链路配方引擎 (Architecture Stack Recipe Engine) 核心设计目标： 终结传统网址导航孤立、割裂的单点搜索形态。 当用户需要搭建特定系统（协同文档、本地大模型、全栈Web、微前端、高可用监控）时， 系统在领域知识图谱中执行多跳子图遍历，直接合成端到端架构链路配方（Architecture Recipe）。 | `findMatchingArchitectureRecipe`、`PRESET_RECIPES`、`StackLayer`、`ArchitectureRecipe` | — |
| `packages/core/src/autonomous-healing.ts` | 192 | AI 自动嗅探与智能动态元数据守护自愈机制 (Autonomous Healing Agent Core) 核心设计目标： 当全站健康巡检探测到站点故障（404/410/502/域名过期/DNS解析失败）时， 自动启动故障自愈诊断流程： 1. 自动调用 Wayback Machine API 生成归档拯救快照镜像 2. 在同类目同标签图谱中检索高相似度健康替代方案 (Alternative Mirror) 3. 生成结构化诊断自愈报告并自… | `diagnoseBrokenCause`、`runAutonomousHealing`、`BrokenCause`、`BrokenDiagnosis`、`ReplacementCandidate`、`AutonomousHealingReport` | 相对模块 1 个（./wayback-resolver.ts） |
| `packages/core/src/batch-operations.ts` | 184 | 多选批量操作纯算法引擎 (Multi-Selection Batch Operations Engine) 纯算法实现，0 DOM 依赖，跨 Node.js 和浏览器通用。 支持功能： 1. 批量分类内卡片置顶 / 取消置顶 2. 批量移动卡片至目标自定义分类 3. 批量删除选中卡片 4. 批量导出选中卡片为 Markdown 链接列表 5. 批量导出选中卡片为 OneTab 格式纯文本 | `batchSetPinnedSitesInCategory`、`batchMoveSitesBetweenCustomCategories`、`batchDeleteSitesFromCustomCategories`、`batchExportSitesToMarkdown`、`batchExportSitesToOneTab`、`BatchSiteItem`、`BatchCategoryHolder` | — |
| `packages/core/src/bookmark-parser.ts` | 510 | 全格式智能书签解析、去重与智能分类引擎 (Universal Bookmarks Ingestion Engine) 纯算法实现，0 DOM 依赖，跨 Node.js 与浏览器端通用。… | `normalizeBookmarkUrl`、`parseBookmarkDate`、`parseNetscapeBookmarksHtml`、`parseOneTabExportText`、`parseMarkdownBookmarks`、`parseUniversalBookmarks`、`canonicalBookmarkKey`、`deduplicateBookmarkItems`… | — |
| `packages/core/src/channels.ts` | 69 | 检索通道注册表。 为什么需要它：RRF 融合的通道列表曾经是 `types.ts` 里的 const 数组， 新增一路召回（例如将来的「协同过滤」）必须改 core 的导出类型， 所有消费方都被迫跟着改。… | `registerChannel`、`searchChannels`、`channelWeight`、`channelWeights`、`resetChannels`、`BUILTIN_CHANNELS`、`BUILTIN_CHANNEL_WEIGHTS`、`BuiltinChannel` | — |
| `packages/core/src/cjk.ts` | 91 | CJK 检索分词。 背景（已实测）：SQLite 的 FTS5 `unicode61` 分词器把连续汉字当作**一个** token， 因此 `match '启动'` 无法命中「启动脚本」；而 `LIKE '%启动%'` 能命中但无法走索引、 也不支持相关性排序。 解法：写入期把中文转成「单字 + 相邻二元组」序列再喂给 unicode61。 这样任意长度 ≥2 的中文子串都能被命中，且保留 BM25 排序能力。… | `isHan`、`hanRuns`、`hanToTokens`、`buildFtsTokens`、`buildFtsQuery` | — |
| `packages/core/src/client-vector-search.ts` | 218 | 端侧轻量级离线向量检索引擎 (Edge-Vector Search Engine) 核心设计目标： 在离线、离网或未开启 Node.js 服务端 Embedding 模型的环境下， 浏览器端利用 TypedArray 与 Int8 标量量化 (Scalar Quantization)， 实现百毫秒级、低内存开销的高维向量余弦距离搜索与 Top-K 召回。 | `computeVectorNorm`、`cosineSimilarity`、`quantizeVector`、`quantizedCosineSimilarity`、`buildQuantizedVectorIndex`、`searchVectorIndex`、`VectorDocument`、`QuantizedVectorDoc`… | — |
| `packages/core/src/comparison.ts` | 241 | 端侧 Agentic 竞品并排对比矩阵合成引擎 (Side-by-Side Comparison Engine) 核心设计目标： 当用户在搜索框输入技术对决语法（如 "react vs vue", "cursor vs vscode", "pnpm vs bun"）时， 系统在 0 毫秒内原地解析并合成多维结构化对比看板，消解开发者跨站跳转对比的信息摩擦。 | `parseTechComparisonQuery`、`COMPARISON_KNOWLEDGE_BASE`、`ComparisonDimension`、`TechComparisonSpec`、`TechComparisonMatrix` | — |
| `packages/core/src/crdt-sync.ts` | 470 | 本地优先零冲突原子操作日志型 CRDT 协同漫游引擎 (Local-First Op-Log CRDT Engine) 纯算法实现，0 DOM 依赖，跨 Node.js 和浏览器通用。 基于 Last-Write-Wins (LWW) 与因果收敛模型，支持多设备离线编辑、无损合流与日志压缩。 | `createCRDTOperation`、`mergeOperationLogs`、`reduceOperationsToState`、`compactOperationLog`、`compareVectorClocks`、`CrdtStore`、`compactOperationLogs`、`CRDTOpType`… | — |
| `packages/core/src/deterministic-favicon.ts` | 316 | 确定性渐变徽标与自适应 Favicon 生成管线 (Deterministic Gradient Avatar & Favicon Pipeline) 纯算法实现，0 DOM 依赖，跨 Node.js 和浏览器通用。… | `fnv1aHash`、`getDeterministicGradient`、`extractFaviconMonogram`、`generateDeterministicSvg`、`generateDeterministicSvgDataUrl`、`isThirdPartyIconUrl`、`sanitizeIconUrl`、`resolveSiteIcon`… | — |
| `packages/core/src/diy-layout.ts` | 28 | 首页次世代 DIY 可视化排版与分类编排核心算法引擎 (DIY Core Layout Engine) 具体算法按域拆在 ./diy-layout/ 下： 1. ordering 分类拓扑编排、置顶与隐藏算法 2. ranking 时间半衰期自适应站点热度排序算法 3. health 人机工程学与香农信息熵排版健康度评估算法 4. merge 三路差异比对与无损合并引擎 5. suggestion 关键词与 Jaccard 相似度智能分类… | — | 相对模块 10 个（./diy-layout.ts、./diy-layout/ordering.ts、./diy-layout/ranking.ts…） |
| `packages/core/src/diy-layout/collapse.ts` | 19 | 分类手风琴折叠状态算法 (Accordion Collapse)。 | `toggleCollapsedCategory`、`collapseAllCategories`、`expandAllCategories` | — |
| `packages/core/src/diy-layout/health.ts` | 133 | 排版人机工程学健康度与香农信息熵评估算法 (Layout Ergonomics Evaluation)。 | `evaluateLayoutErgonomics`、`LayoutHealthReport` | 相对模块 1 个（./ordering.ts） |
| `packages/core/src/diy-layout/history.ts` | 65 | 撤销/重做时间旅行栈算法 (Time-Travel Undo/Redo Engine)。 | `createLayoutHistory`、`pushLayoutHistory`、`undoLayoutHistory`、`redoLayoutHistory`、`LayoutHistoryState` | — |
| `packages/core/src/diy-layout/merge.ts` | 129 | 多端漫游三路差异比对与无损合并引擎 (3-Way Layout Diff & Merge Engine)。 | `mergeDIYLayoutConfigs`、`DIYConfigPayload`、`MergeResult` | — |
| `packages/core/src/diy-layout/ordering.ts` | 174 | 分类拓扑编排、置顶与隐藏算法 (Topology & Pinning)。 纯函数：输入分类数组/ID 列表，输出新的顺序或新的置顶/隐藏集合， 全程不修改入参（排序前先浅拷贝）。 | `sortCategoriesWithOverrides`、`shiftCategoryOrder`、`reorderCategoryToTarget`、`togglePinnedId`、`toggleHiddenId`、`sortCategoryItemsWithPinned`、`togglePinnedSiteInCategory`、`CategoryLayoutOptions` | — |
| `packages/core/src/diy-layout/presets.ts` | 78 | 开箱即用的预设 DIY 情境模版定义 (Presets)。 | `BUILTIN_DIY_PRESETS`、`DIYPreset` | — |
| `packages/core/src/diy-layout/ranking.ts` | 71 | 时间半衰期自适应站点热度排序算法 (Time-decay Adaptive Ranking)。 公式：Score = (isPinned ? 10000 : 0) + visitCount * 10 * e^(-lambda * dt) + starBonus + trendScore * 5 | `computeAdaptiveSiteRanking`、`AdaptiveRankingOptions` | — |
| `packages/core/src/diy-layout/sanitize.ts` | 87 | 配置清洗与防御：校验并清洗外部导入的 DIY JSON 配置 (Config Sanitization)。 分享链接经 #diy= hash 在 URL 里传播，因此这里是不可信输入的第一道防线： 体积上限、枚举白名单、URL 协议白名单、数组长度与字符串长度全部夹紧。 | `validateAndCleanDIYConfig` | — |
| `packages/core/src/diy-layout/suggestion.ts` | 73 | 关键词与 Jaccard 相似度智能分类推荐算法 (Fuzzy Category Auto-Classifier)。 | `suggestCategoryForSite`、`CategorySuggestion` | — |
| `packages/core/src/dynamic-tool-synthesizer.ts` | 502 | 动态工具合成器与安全执行沙箱 (Dynamic WebMCP Tool Synthesizer & Guarded Executor) 核心设计目标： 1. 自动化接口工具化 (API-to-Tool Synthesis)：将 OpenAPI / REST 端点规格实时合成为标准 WebMCP 工具 2. 站点检索动作工具化 (Site Action Synthesis)：将站点搜索引擎、聚合 API 动态注册为 AI Agent 可调用… | `isSafeUrl`、`createGuardedApiExecutor`、`synthesizeRestTool`、`synthesizeSiteSearchTool`、`parseOpenApiToSpecs`、`SynthesizedToolDefinition`、`SynthesizedToolHandler`、`GuardOptions`… | — |
| `packages/core/src/ecosystem.ts` | 208 | NavHub 4.0 生态增强库：为高频工具提供深链微动作、平替雷达（AlternativeTo）与工作台映射。 | `getEnhancedSiteData`、`ECOSYSTEM_MAP`、`EnhancedSiteData` | 相对模块 1 个（./types.ts） |
| `packages/core/src/facets.ts` | 179 | 分面体系 (Faceted Taxonomy - Phase 2) 为 NavHub 提供正交、受控的多维筛选属性体系。 遵循 W3C SKOS 与分面分类学原则： 1. 正交性：各分面维度彼此独立（付费模式、平台、产品形态、语言支持、应用场景）； 2. 受控词表：封闭候选值集合，杜绝随意输入导致分类爆炸； 3. 渐进式披露：支持与主分类树 (Categories) 及领域标签 (Tags) 自由交叉叠加。 | `getFacetDefinition`、`getFacetOptionLabel`、`normalizeFacets`、`CONTROLLED_FACETS`、`BuiltinFacetKey`、`FacetKey`、`FacetOption`、`FacetDefinition`… | — |
| `packages/core/src/federated-recommendation.ts` | 133 | 客户端联邦协同与本地差分隐私推荐引擎 (Federated Recommendation & Local Differential Privacy) 核心设计目标： 1. 本地差分隐私 (Local Differential Privacy, LDP)：在客户端对用户的标签偏好注入 Laplace 噪声 2. 保证个体隐私不可重构的同时，在无中心化数据库收集用户历史的前提下实现群体协同推荐 3. 混合打分机制：结合私有本地偏好与脱敏群体共… | `sampleLaplace`、`privatizeVector`、`aggregatePrivatizedContributions`、`computeCosineSimilarity`、`rankItemsWithPrivacy`、`CandidateItem`、`RecommendationResult` | — |
| `packages/core/src/fusion.ts` | 141 | 多通道召回融合。 采用 RRF（Reciprocal Rank Fusion）——它不把不同尺度的分数硬凑（BM25 分、余弦相似度、 LIKE 命中数之间没有可比性），而是只依赖**排名**，因此在异构通道之间天然可比、 无需调参、对单个通道的异常分数不敏感。… | `fuse`、`personalCandidates`、`channelsUsed`、`DEFAULT_WEIGHTS`、`FusionWeights` | 相对模块 2 个（./types.ts、./channels.ts） |
| `packages/core/src/health-sentinel.ts` | 405 | Health Sentinel & Anti-Hijacking Sensor (页面视觉感知防劫持与软 404 巡检引擎) 核心设计目标： 终结以 HTTP 200 为唯一标准的盲目健康假象。 综合利用 DOM 文本 Shannon 信息熵、停放关键词语义密度以及 64 位视觉感知哈希（pHash）汉明距离， 精准识别“域名抢注停放广告”、“SPA 假 200 软 404”、“单页黑产劫持”。 | `stripHtmlToText`、`calculateShannonEntropy`、`hammingDistance64`、`logGamma`、`gamma`、`weibullSurvival`、`weibullHazard`、`fitWeibullByMoments`… | — |
| `packages/core/src/hyperbolic.ts` | 255 | Poincaré Ball Hyperbolic Geometry & Alternative Inference Engine (庞加莱双曲空间度量与平替推理引擎) 核心设计目标： 突破欧氏空间在树形分类和深层拓扑中的维度膨胀失真（Distortion）。 利用双曲空间指数级体积增长特性，精确计算技术工具间的测地线距离， 并结合抽象层级模长一致性，推导出高置信度的平替竞品（Alternatives）与上下游依赖。 | `euclideanNorm`、`euclideanDot`、`clampToBall`、`expMap0`、`logMap0`、`mobiusAdd`、`poincareDistance`、`computeHyperbolicAlternativeScore`… | — |
| `packages/core/src/index.ts` | 40 | core 包总出口：按域 `export *` 汇总 38 个模块（类型、分词、拼音、融合、排序、画像、LinUCB、双曲、配方、CRDT、布局、知识图谱等），是服务端与前端共享算法的唯一入口。 | — | 相对模块 39 个（./types.ts、./mcp-schemas.ts、./channels.ts…） |
| `packages/core/src/keyboard-nav.ts` | 143 | 极客键盘流焦点漫游与跨网格导航纯算法 (Keyboard-First Vim Navigator Engine) 纯算法实现，0 DOM 依赖，跨端与单元测试友好。 | `calculateNextGridFocusIndex`、`calculateNextCategoryPointer`、`NavigationDirection`、`GridNavigatorOptions`、`CategoryCardPointer` | — |
| `packages/core/src/knowledge-graph.ts` | 348 | 次世代技术栈知识星图与多跳路径发现引擎 (Knowledge Graph & Tech Pathfinding) 核心设计目标： 终结单点孤立的网址陈列。构建结构化技术知识拓扑图谱： 1. 双向最短链路搜索 (Bi-directional Pathfinding)：查找任意两项技术之间的协同演进路径 （如：React -> Next.js -> Drizzle -> PostgreSQL） 2. 权威度与枢纽度分析 (Kleinberg … | `findShortestTechPath`、`computeGraphCentrality`、`analyzeStackCompatibility`、`PRESET_TECH_GRAPH`、`GraphNode`、`GraphEdge`、`KnowledgeGraphData`、`PathStep`… | — |
| `packages/core/src/layout-sync.ts` | 242 | 布局多端同步的纯算法层（按插槽 LWW + Lamport 逻辑时钟） 要解决的具体故障：多个标签页同时把首页当作起始页打开时， 每个标签页都在失焦/关闭前把**整份配置 JSON** 覆盖写回本地存储。 旧标签页最后写回的那份，会把新标签页刚调好的布局整个抹掉—— 用户看到的是"我刚拖好的顺序，切个标签页就没了"。 为什么不用整表 LWW：整表只有一个时间戳，赢家通吃， 在 A 页改了配色、B 页改了分类顺序的场景下必然丢一半改动。… | `slotKey`、`nextLamport`、`bumpClocks`、`diffChangedSlots`、`mergeLayoutSlots`、`LAYOUT_SLOT_SEP`、`LayoutSlotClocks`、`LayoutMergeSide`… | — |
| `packages/core/src/linucb.ts` | 367 | LinUCB (Contextual Multi-Armed Bandit) 自适应情境多通道融合引擎 核心设计目标： 终结 RRF (Reciprocal Rank Fusion) 的静态常数超参缺陷。 根据用户输入的当前特征向量（查询长度、CJK比例、拼音特征、数字比例等）， 在线自适应计算 5 大通道（exact, fts, pinyin, semantic, personal）的动态置信度上界权重。 | `extractContextFeatures`、`createIdentityMatrix`、`invertMatrix`、`matVecMul`、`dotProduct`、`createLinUCBModel`、`predictArmWeights`、`updateArmReward`… | — |
| `packages/core/src/mcp-schemas.ts` | 594 | MCP / REST 共用的输入契约（zod 单一事实源） 为什么放在 core： apps/api 不能 import @navhub/mcp —— @navhub/mcp 反过来依赖 @navhub/api （它要复用 api 的仓储与业务函数），反向引用会成环。… | `MAX_BATCH_ITEMS`、`SearchSitesInput`、`GetSiteInput`、`ListCategoriesInput`、`CreateSiteInput`、`UpdateSiteInput`、`SetStatusInput`、`BatchImportInput`… | 外部 zod |
| `packages/core/src/modular.ts` | 512 | 模块化前端系统核心协议与布局计算算法 (Modular Layout Core Engine) | `reorderWidgetsList`、`shiftWidgetPosition`、`clampWidgetSpan`、`createWidgetInstanceData`、`mergeWidgetConfig`、`compactWidgetsGrid`、`BUILTIN_WIDGET_CATALOG`、`BUILTIN_PRESET_TEMPLATES`… | — |
| `packages/core/src/p2p-mesh-sync.ts` | 337 | WebRTC DataChannel 点对点分布式书签共识流 (P2P Mesh Sync Protocol) 核心设计目标： 基于本地 CRDT 状态向量引擎，构建去中心化 P2P 网格共识通道。 支持局域网/互联网多设备无中心直连，在离线重连、网络分区下 自动交换 Delta 增量并在数学上确定性收敛。 | `createBroadcastChannelTransport`、`P2PMeshNode`、`P2PSyncSession`、`P2PMessageType`、`P2PMessage`、`HelloPayload`、`SyncRequestPayload`、`DeltaBatchPayload`… | 相对模块 1 个（./crdt-sync.ts） |
| `packages/core/src/pinyin.ts` | 45 | 拼音检索线索生成（写入期）与查询归一化（查询期）。 目标：中文站点可以用全拼、首字母、甚至中英混输命中。 实测 pinyin-pro 输出：启动脚本 -> qidongjiaoben / qdjb | `pinyinTraits`、`normalizeQueryPinyin`、`looksLikeLatinQuery`、`PinyinTraits` | 外部 pinyin-pro |
| `packages/core/src/prefetch.ts` | 193 | 预测性鼠标轨迹预取与 0-RTT 物理瞬开引擎 (Predictive Trajectory Prefetching Engine) 核心设计目标： 突破浏览器传统的“按下点击后才开始建立连接”物理延迟瓶颈（DNS+TLS+TTFB 常见 300~500ms）。 通过监听光标轨迹矢量的加速度与朝向夹角， 在光标逼近卡片 150 毫秒前触发 DNS 预解析与 TCP/TLS 预连接，实现物理级 0 延迟秒开。 | `calculateMotionVector`、`isHeadingTowardsRect`、`extractSafeOrigin`、`shouldPreconnectOrigin`、`determinePrefetchStrategy`、`KalmanFilter2D`、`Point`、`RectBounds`… | — |
| `packages/core/src/profile.ts` | 95 | 个性化画像聚合：行为事件 -> PersonalizationSignals。 输入是用户近 N 天的 click / favorite 事件（含站点类目与标签）， 输出直接喂给 SearchEngine 的 personal 通道（权重 0.3）—— 这就是「越用越懂你」的唯一入口，且翻转能力被通道权重天然限界。 时间衰减（7 天半衰期）：上个月的兴趣不应该和今天的一样重。 收藏权重是点击的 2 倍：主动收藏是比偶然点击强得多的信号。 | `decay`、`buildProfile`、`DEFAULT_PROFILE_OPTIONS`、`BehaviorEvent`、`BuildProfileOptions`、`BuiltProfile` | 相对模块 1 个（./types.ts） |
| `packages/core/src/query-intent.ts` | 223 | 查询意图解析：识别分面修饰词（语言/协议/许可/平台）、技术对比查询（A vs B）与架构配方意图，输出结构化 ParsedFacetedQuery 供检索路由分派。 | `parseFacetedQuery`、`findDidYouMeanSuggestion`、`FACET_INTENT_RULES`、`FacetIntentRule`、`MatchedFacetModifier`、`ParsedFacetedQuery` | 相对模块 1 个（./taxonomy-governance.ts） |
| `packages/core/src/ranking.ts` | 58 | 排序公式（纯函数）。 两个榜单模式，刻意都是「独立排序」而不是搜索融合后的乘数： - trend：热度 = 近期点击 + 近期收藏 − 站点年龄惩罚 - fresh：新品 = 创建时间倒序 为什么热度不能进 RRF 融合：实测证明 RRF(k=60) 把靠前名次压得非常近 （排 1 与排 8 仅差约 11%），任何事后加成都能轻易翻转相关性顺序—— 「越用越懂你」会退化成「搜什么都搜不到」。… | `trendScore`、`freshnessScore`、`ageInDays`、`TREND_WEIGHTS`、`TrendInput` | — |
| `packages/core/src/relations.ts` | 162 | 语义化实体关系体系与 SKOS (Simple Knowledge Organization System) 知识组织模型。 核心目标（Phase 3）： 1. 站点关系由原有的单向弱文本声明，提升为具备双向语义推理的知识图谱边（Site Relations Graph）； 2. 类别结构由孤立的单一树状结构，升级为符合 W3C SKOS 规范的概念模型（同义词 altLabels + 跨树关联 relatedCategories）；… | `categoryToSkosConcept`、`normalizeSiteRelation`、`CONTROLLED_RELATION_TYPES`、`RelationTypeMeta`、`SkosConcept` | 相对模块 1 个（./types.ts） |
| `packages/core/src/semantic-clustering.ts` | 329 | 语义聚类与自适应类目生成引擎 (Semantic Clustering & Autonomous Taxonomy Generation) 核心设计目标： 1. K-Means++ 高维向量聚类算法：解决导入海量书签或未分类站点的无序堆积 2. 自动化类目命名 (Taxonomy Label Synthesis)：基于聚类内标题、标签与高频词特征，合成可解释的分类名称 3. 凝聚度与轮廓度评估 (Cohesion & Quality Sc… | `cosineSim`、`cosineDist`、`extractBagOfWordsVector`、`buildVocabulary`、`kMeansPlusPlus`、`synthesizeClusterName`、`autoClusterSites`、`ClusterableItem`… | — |
| `packages/core/src/speculative-intent.ts` | 17 | Speculative Intent Pre-execution Engine (推测意图 0-RTT 原地预执行引擎) 核心设计目标： 当用户在搜索框输入特定技术文本时（Base64、时间戳、RGB/HEX颜色、算术表达式、JSON、URL编码、哈希等）， 系统不再仅仅返回外链结果，而是在 0 毫秒内原地预执行并生成即时计算结果（Micro-Widget）。… | — | 相对模块 2 个（./speculative-intent/types.ts、./speculative-intent/parse.ts） |
| `packages/core/src/speculative-intent/compute.ts` | 109 | 计算/取值族检测器：算术表达式求值、颜色（HEX/RGB）速览。 | `tryParseMath`、`tryParseColor` | 相对模块 1 个（./types.ts） |
| `packages/core/src/speculative-intent/encoding.ts` | 215 | 编码/解码族检测器：Base64、URL 编码、JSON 美化、哈希指纹识别。 | `tryParseBase64`、`tryParseUrlEncoding`、`tryParseJson`、`tryDetectHash` | 相对模块 1 个（./types.ts） |
| `packages/core/src/speculative-intent/http-status.ts` | 94 | HTTP 状态码标准字典与故障排查速查 (HTTP Status Encyclopedia)。 | `tryParseHttpStatus` | 相对模块 1 个（./types.ts） |
| `packages/core/src/speculative-intent/network.ts` | 135 | 网络族检测器：IPv4 识别、Curl 转 Fetch、JWT 离线解码。 | `tryDetectIp`、`tryParseCurl`、`tryParseJwt` | 相对模块 1 个（./types.ts） |
| `packages/core/src/speculative-intent/parse.ts` | 40 | 推测意图编排入口：按优先级串联各域检测器。 优先级逐层匹配：高置信度特定语法优先，防短串误判。 检测器实现按域拆分在同目录下（encoding/time/network/compute/regex/ semver/http-status），类型定义见 ./types.ts。 | `parseSpeculativeIntent` | 相对模块 8 个（./types.ts、./encoding.ts、./time.ts…） |
| `packages/core/src/speculative-intent/regex.ts` | 129 | 正则表达式即时匹配与捕获组速览 (Regex Sandbox)。 | `tryParseRegex` | 相对模块 1 个（./types.ts） |
| `packages/core/src/speculative-intent/semver.ts` | 156 | 语义化版本解析与兼容性对比 (Semver Comparator)。 | `tryParseSemver` | 相对模块 1 个（./types.ts） |
| `packages/core/src/speculative-intent/time.ts` | 107 | 时间族检测器：Unix 时间戳转换、Cron 表达式解释。 | `tryParseTimestamp`、`tryParseCron` | 相对模块 1 个（./types.ts） |
| `packages/core/src/speculative-intent/types.ts` | 35 | 推测意图（Micro-Widget）的类型契约。 从 speculative-intent.ts 拆出：类型与检测器（encoding/time/network/compute/ regex/semver/http-status）分离，编排入口见 ./parse.ts。 | `SpeculativeIntentType`、`SpeculativeIntentResult` | — |
| `packages/core/src/speculative-prerender.ts` | 156 | 自适应上下文推测性预渲染引擎 (Speculative Pre-rendering Engine) 核心设计目标： 连接 Kalman 轨迹意图预测与浏览器原生 W3C Speculation Rules API。… | `isSafeForSpeculation`、`compileSpeculationRules`、`renderSpeculationRulesScript`、`generateFallbackLinkTags`、`DEFAULT_UNSAFE_PATTERNS`、`SpeculationCandidate`、`SpeculationEagerness`、`SpeculationRuleGroup`… | — |
| `packages/core/src/taxonomy-governance.ts` | 245 | 分类与标签体系智能治理引擎 (Taxonomy Governance & Auditing Engine) 核心目标： 1. 站点归类契合度检测（Categorization Mismatch / Candidate Ranking） 2. 冗余与形近标签合并建议（Tag Consolidation & Synonym/Alias Proposal） 3. 零结果搜索聚类与类目/标签缺口发现（Zero-Result Gap Discove… | `levenshteinDistance`、`normalizeTagKey`、`auditTagConsolidation`、`auditZeroResultGaps`、`auditSiteCategorization`、`TaxonomyProposalKind`、`TaxonomyProposalStatus`、`TaxonomyProposal` | — |
| `packages/core/src/types.ts` | 459 | NavHub 领域模型。 设计约束（重要）： 1. NavSphere 的线上契约是 navigation.json 的三层结构（category -> subCategory -> item）， 本文件的 `NavSphereNavigationData` 必须与该契约**字节级兼容**，否则前端无需改动的目标就破产。… | `canonicalizeUrl`、`Id`、`NavSphereVideoConfig`、`NavSphereItem`、`NavSphereSubCategory`、`NavSphereCategory`、`NavSphereNavigationData`、`NavSphereSiteConfig`… | 相对模块 1 个（./channels.ts） |
| `packages/core/src/vault.ts` | 269 | 本地优先零知识端到端加密金库引擎 (Zero-Knowledge E2EE Vault Engine) 核心设计目标： 彻底消除企业与个人开发者对私密/内网书签（Jira、GitLab、内网 IP、未公开系统）泄露的担忧。 基于通用 Web Crypto API（兼容 Node.js 20+ 与现代浏览器）， 采用 PBKDF2 (100,000 次哈希迭代) 派生主密钥 + AES-256-GCM 认证加密。… | `deriveVaultKey`、`encryptVault`、`decryptVault`、`encryptGenericPayload`、`decryptGenericPayload`、`VaultItem`、`EncryptedVaultPayload`、`VaultCryptoKey`… | — |
| `packages/core/src/visual-fingerprint.ts` | 236 | 视觉指纹分析与美学和谐度引擎 (Visual Fingerprint & Color Harmony) 核心设计目标： 1. 颜色提取与量化分析 (RGB/HSL 转换，亮度与饱和度分布) 2. WCAG 2.1 对比度与可读性评估 3. 视觉情绪与美学风格分类 (cyberpunk, ocean, warm, minimalist, matrix) 4. 调色板和谐度分析 (Color Harmony Scoring & Suggest… | `hexToRgb`、`rgbToHex`、`rgbToHsl`、`getRelativeLuminance`、`calculateContrastRatio`、`colorDistance`、`analyzeVisualFingerprint`、`analyzeColorPalette`… | — |
| `packages/core/src/wayback-resolver.ts` | 103 | 坏链自愈与时间机器历史镜像解析引擎 (Wayback Machine & Dead Link Sentinel) 纯算法实现，0 DOM 依赖，跨 Node.js 和浏览器通用。 | `normalizeTargetUrl`、`buildWaybackSnapshotUrl`、`buildWaybackSaveUrl`、`isPotentialBrokenHttpCode`、`parseWaybackAvailabilityResponse`、`generateWaybackRecoveryUrl`、`WaybackSnapshotInfo` | — |
| `packages/core/src/webmcp-bridge.ts` | 211 | 浏览器端端侧 Model Context Protocol (WebMCP) 双向通信网桥 核心设计目标： 为端侧 AI Agent、浏览器扩展、本地小模型 (WebLLM / Chrome Built-in AI) 提供标准化的 JSON-RPC 2.0 协议交互入口，使 AI 能够直接查询 NavHub 知识库与图谱。 | `WebMcpBridge`、`JsonRpcRequest`、`JsonRpcResponse`、`WebMcpToolDefinition`、`WebMcpToolHandler` | — |

### 测试文件

| 文件 | 行数 | 职责与实现要点 | 关键导出 | 主要依赖 |
| :--- | ---: | :--- | :--- | :--- |
| `packages/core/test/batch-and-favicon.test.ts` | 189 | 批量操作引擎与确定性 Favicon 生成测试。 | — | 相对模块 1 个（../src/index）；外部 vitest |
| `packages/core/test/bookmark-parser.test.ts` | 150 | 书签解析：Netscape/OneTab/Markdown 三格式、URL 规范化与去重。 | — | 相对模块 1 个（../src/bookmark-parser）；外部 vitest |
| `packages/core/test/core.test.ts` | 224 | 核心域综合测试：类型、分词、拼音、融合与排序。 | — | 相对模块 1 个（../src/index.ts）；外部 vitest |
| `packages/core/test/crdt-and-wayback.test.ts` | 163 | CRDT 合流收敛与 Wayback 存档 URL 构造测试。 | — | 相对模块 2 个（../src/crdt-sync.ts、../src/wayback-resolver.ts）；外部 vitest |
| `packages/core/test/diy-layout.test.ts` | 415 | DIY 排版算法：排序覆盖、置顶、自适应排序、信息熵健康度与配置清洗。 | — | 相对模块 1 个（../src/diy-layout）；外部 vitest |
| `packages/core/test/domain-coverage.test.ts` | 193 | 补足高价值纯函数的覆盖：自治修复、知识图谱、语义聚类、LinUCB、推测意图、CRDT。 | — | 相对模块 7 个（../src/autonomous-healing.ts、../src/knowledge-graph.ts、../src/semantic-clustering.ts…）；外部 vitest |
| `packages/core/test/future-algorithms.test.ts` | 450 | 前沿算法矩阵：双曲、联邦推荐、推测预渲染、工具合成等。 | — | 相对模块 1 个（../src/index.ts）；外部 vitest |
| `packages/core/test/health-weibull.test.ts` | 170 | Weibull 生存分析健康哨兵测试。 | — | 相对模块 1 个（../src/health-sentinel.ts）；外部 vitest |
| `packages/core/test/keyboard-nav.test.ts` | 68 | 图谱键盘导航纯函数：方向判定、roving tabindex 与可访问名称。 | — | 相对模块 1 个（../src/keyboard-nav）；外部 vitest |
| `packages/core/test/layout-sync.test.ts` | 181 | Lamport 时钟布局多端合并：插槽级 diff 与冲突收敛。 | — | 相对模块 1 个（../src/layout-sync.ts）；外部 vitest |
| `packages/core/test/modular-layout.test.ts` | 150 | 模块化布局：网格占位、尺寸约束与模板实例化。 | — | 相对模块 1 个（../src/modular）；外部 vitest |
| `packages/core/test/nextgen-3.test.ts` | 202 | NextGen 第三批能力回归（双曲/排序/画像）。 | — | 相对模块 1 个（../src/index.ts）；外部 vitest |
| `packages/core/test/nextgen-4.test.ts` | 242 | NextGen 第四批能力回归（知识图谱/配方/对比）。 | — | 相对模块 1 个（../src/index.ts）；外部 vitest |
| `packages/core/test/nextgen-5.test.ts` | 258 | NextGen 第五批能力回归（CRDT/P2P/预取）。 | — | 相对模块 1 个（../src/index.ts）；外部 vitest |
| `packages/core/test/p2p-mesh-sync.test.ts` | 149 | P2P 网格消息交换与因果收敛测试。 | — | 相对模块 2 个（../src/p2p-mesh-sync.ts、../src/crdt-sync.ts）；外部 vitest |
| `packages/core/test/query-intent.test.ts` | 107 | 查询意图解析：分面词、对比查询与配方识别。 | — | 相对模块 1 个（../src/query-intent.ts）；外部 vitest |
| `packages/core/test/ranking-profile.test.ts` | 211 | 排序与画像：热度衰减、个性化权重与可解释性。 | — | 相对模块 4 个（../src/ranking.ts、../src/profile.ts、../src/fusion.ts…）；外部 vitest |
| `packages/core/test/recipes-and-comparison.test.ts` | 106 | 架构配方匹配与技术对比矩阵生成。 | — | 相对模块 1 个（../src/index.ts）；外部 vitest |
| `packages/core/test/speculative-url-encoding.test.ts` | 33 | URL 编码投机意图边界：孤立代理项不得抛 URIError 打断管线。 | — | 相对模块 1 个（../src/speculative-intent/encoding.ts）；外部 vitest |
| `packages/core/test/ssrf-guard.test.ts` | 80 | SSRF 绕过回归：十进制/十六进制/短写 IPv4、IPv6 映射与重定向跳板。 | — | 相对模块 1 个（../src/dynamic-tool-synthesizer.ts）；外部 vitest |
| `packages/core/test/taxonomy-governance.test.ts` | 98 | 分类治理提案生成与健康度评分。 | — | 相对模块 1 个（../src/taxonomy-governance.ts）；外部 vitest |
| `packages/core/test/vault-and-prefetch.test.ts` | 162 | E2EE 金库加解密与卡尔曼轨迹预取测试。 | — | 相对模块 1 个（../src/index.ts）；外部 vitest |
| `packages/core/test/webmcp-bridge-cap.test.ts` | 41 | WebMCP 桥：工具注册上限与调用约束。 | — | 相对模块 1 个（../src/webmcp-bridge.ts）；外部 vitest |

## 2. `packages/store` — 存储与检索引擎（40 源文件 + 15 测试，8,595 行）

Drizzle + 双方言驱动（SQLite/PostgreSQL）、24 个域仓储、混合检索引擎、FTS 与向量适配器、迁移/保留/聚合治理。向上只暴露 Repository / SearchEngine 两个门面。

| 文件 | 行数 | 职责与实现要点 | 关键导出 | 主要依赖 |
| :--- | ---: | :--- | :--- | :--- |
| `packages/store/src/driver.ts` | 689 | 数据库驱动抽象：统一 SQLite(better-sqlite3)/PostgreSQL 的 Db 接口，手写幂等 DDL，集中 pragma（WAL/内存临时表/mmap）与事务入口，方言差异只在此处与 vector/fts 三处。 | `openDb`、`DDL`、`Dialect`、`SqliteRunner`、`PgRunner`、`Db` | 相对模块 1 个（./migrate.ts）；外部 drizzle-orm |
| `packages/store/src/fts-pg.ts` | 109 | PostgreSQL 全文索引适配器：tsvector + GIN 表达式索引，语料仍复用 CJK 二元分词，对外与 SQLite 版同契约。 | `pgTokens`、`PgFtsStore`、`PgFtsLike` | 包 @navhub/core；相对模块 1 个（./fts.ts） |
| `packages/store/src/fts.ts` | 109 | SQLite FTS5 全文索引适配器：CJK 二元分词写入、BM25 查询、增量 upsert 与全量 rebuild。 | `SqliteFtsStore`、`FtsLike`、`FtsHit`、`FullTextStore` | 包 @navhub/core |
| `packages/store/src/index.ts` | 13 | `@navhub/store` 出口：导出驱动、仓储、检索引擎、FTS/向量适配器、迁移与数据治理模块。 | — | 相对模块 10 个（./schema.ts、./driver.ts、./migrate.ts…） |
| `packages/store/src/migrate.ts` | 195 | 幂等列迁移：为已存在的表补齐新增列（visit_count/trend_score/users.email 等），双方言共用列清单，避免 CREATE TABLE IF NOT EXISTS 无法加列的问题。 | `migrateSiteIndexes`、`migrateColumns`、`migrateEventIdentity`、`COLUMN_ALTERS`、`ColumnAlter` | — |
| `packages/store/src/repository.ts` | 798 | 仓储聚合门面：把 24 个域仓储模块装配为一个 Repository 类，统一 SQL 方言绑定（bindSqlite/toPgSql）、审计兜底与事务。 | `Repository` | 包 @navhub/core；相对模块 25 个（./driver.ts、./repository/records.ts、./repository/sites.ts…） |
| `packages/store/src/repository/analytics.ts` | 102 | 分析查询：热门查询词、零结果查询、热门站点、最新站点、向量读取。 | `topQueries`、`zeroResultQueries`、`hotSites`、`newestSites`、`getEmbedding` | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/behavior.ts` | 100 | 行为事件仓储：事件写入、搜索计数、区间内点击/收藏计数（供热度与画像聚合）。 | `behaviorEvents`、`countSearches`、`clickCountsSince`、`favoriteCountsSince` | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/categories.ts` | 285 | 类目仓储：树查询、创建/确保存在、移动、锚点前缀替换、合并、更新删除、语义详情与 SKOS 导出。 | `listCategories`、`getCategory`、`createCategory`、`ensureCategory`、`moveCategory`、`replaceAnchorPrefix`、`mergeCategories`、`updateCategory`… | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/collections.ts` | 131 | 专题仓储：upsert、列表、按 slug 取详情、取专题内站点。 | `upsertCollection`、`listCollections`、`getCollectionBySlug`、`listCollectionSites` | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/dashboard.ts` | 280 | 仪表盘聚合查询：总览、类目站点分布、库存储指标、安全态势、队列深度。 | `dashboardOverview`、`categorySiteDistribution`、`dbStorageMetrics`、`securityOverview`、`jobsQueueDepth` | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/dialect.ts` | 372 | 行↔领域对象映射与方言工具：字段打包/解包、slugify、token scope 归一化、各表 rowTo* 映射器。 | `buildIndexFields`、`packMetadata`、`slugify`、`normalizeTokenScopes`、`rowToSite`、`rowToCategory`、`rowToSiteRelation`、`rowToFavorite`… | 包 @navhub/core；相对模块 1 个（./records.ts） |
| `packages/store/src/repository/embeddings.ts` | 80 | 向量持久化：写入与读取站点 embedding（进程重启后回灌向量索引）。 | `saveEmbedding`、`savedEmbeddings` | 包 @navhub/core；相对模块 5 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/events.ts` | 108 | 事件与审计仓储：事件写入、审计落库（失败不外抛）、审计日志与动作清单查询。 | `recordEvent`、`audit`、`listAuditLogs`、`listAuditActions` | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/favorites.ts` | 111 | 收藏仓储：收藏增删查、收藏夹分组的增删查。 | `listFavorites`、`addFavorite`、`removeFavorite`、`listFavoriteFolders`、`createFavoriteFolder`、`deleteFavoriteFolder` | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/health.ts` | 107 | 健康仓储：站点健康列更新、健康巡检时序、访问计数递增、热度分批量写入。 | `updateSiteHealth`、`healthCheckSeries`、`bumpVisit`、`setTrendScores` | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/history.ts` | 78 | 搜索历史仓储：记录、列表、清空。 | `recordSearch`、`listSearchHistory`、`clearSearchHistory` | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/io.ts` | 85 | 底层 SQL 执行辅助：字面量转义、count 查询、raw/run 通用执行。 | `getEnabledLiteral`、`runCount`、`raw`、`run` | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/jobs.ts` | 190 | 任务仓储：入队、抢占下一个（含锁）、完成、列表/详情、取消、重试、修剪、过期软删站点清理、僵尸任务回收。 | `enqueueJob`、`claimNextJob`、`completeJob`、`listJobs`、`getJob`、`cancelJob`、`retryJob`、`pruneJobs`… | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/maintenance.ts` | 141 | 存储维护：完整性检查、VACUUM、FTS optimize、WAL checkpoint。 | `maintenanceCheck`、`vacuumDatabase`、`optimizeFts`、`checkpointWal` | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/profiles.ts` | 94 | 用户画像仓储：读写/删除画像，清理行为事件。 | `getUserProfile`、`deleteUserProfile`、`deleteBehaviorEvents`、`saveUserProfile` | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/records.ts` | 264 | 仓储层输入/输出记录类型：SiteInput、DashboardOverview、各类 Record 与图谱类型定义。 | `SiteInput`、`DashboardOverview`、`CategoryDistributionItem`、`CategorySemanticDetail`、`SiteKnowledgeGraph`、`MatchedSiteRelation`、`SecurityOverview`、`FavoriteRecord`… | 包 @navhub/core；相对模块 1 个（../driver.ts） |
| `packages/store/src/repository/sites.ts` | 756 | 站点仓储（最大域）：列表/全量/按 id 批取、动态 SQL 选列、按 URL 查找、创建（含指定 id）、更新、软删/恢复/彻底删、回收站列表。 | `listSites`、`listAllSites`、`getSitesByIds`、`selectSitesSql`、`getSite`、`getDeletedSite`、`findSiteByUrl`、`createSite`… | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/stats.ts` | 64 | 统计仓储：站点/类目/标签等基础计数。 | `stats` | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/system.ts` | 78 | 系统键值状态仓储：读写 system_state（LinUCB 模型、布局时钟等）。 | `getSystemState`、`setSystemState` | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/tags.ts` | 322 | 标签仓储：带计数列表、重命名、更新、删除、合并、别名增删查与解析。 | `listTagsWithCounts`、`renameTag`、`updateTag`、`deleteTag`、`mergeTags`、`addTagAlias`、`removeTagAlias`、`listTagAliases`… | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/taxonomy-governance.ts` | 284 | 治理提案仓储：提案保存/查询、采纳应用、驳回、触发全站审计。 | `saveTaxonomyProposals`、`listTaxonomyProposals`、`getTaxonomyProposal`、`applyTaxonomyProposal`、`dismissTaxonomyProposal`、`runTaxonomyAudit` | 包 @navhub/core；相对模块 2 个（../repository.ts、./dialect.ts） |
| `packages/store/src/repository/tokens.ts` | 155 | API Token 仓储：创建、更新、轮换、吊销、按哈希查找、使用时间节流更新、列表与删除。 | `createApiToken`、`updateApiToken`、`rotateApiToken`、`revokeApiToken`、`findApiTokenByHash`、`touchApiToken`、`listApiTokens`、`deleteApiToken`… | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/users.ts` | 79 | 用户仓储：OAuth 用户 upsert 与读取。 | `upsertOauthUser`、`getUser` | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/repository/vault.ts` | 89 | 金库仓储：用户密文 Blob 的读写与删除。 | `getUserVault`、`saveUserVault`、`deleteUserVault` | 包 @navhub/core；相对模块 4 个（../repository.ts、./records.ts、./dialect.ts…） |
| `packages/store/src/retention.ts` | 179 | 数据保留策略：对 events/audit_logs 先逐行归档再删除，通过注入 RetentionAdapter 保持方言无关。 | `runRetention`、`DEFAULT_RETENTION_TARGETS`、`RetentionTable`、`RetentionRow`、`RetentionAdapter`、`RetentionTarget`、`RetentionOptions`、`RetentionTableResult`… | — |
| `packages/store/src/rollup.ts` | 332 | 明细聚合：把过期明细压成日统计后删除明细（舍明细保统计），与 retention 共用适配器端口。 | `rollupDdl`、`runRollup`、`EVENT_DAILY_ROLLUP`、`AUDIT_DAILY_ROLLUP`、`DEFAULT_ROLLUP_TARGETS`、`RollupDialect`、`RollupGroupColumn`、`RollupSpec`… | 相对模块 1 个（./retention.ts） |
| `packages/store/src/schema.ts` | 386 | Drizzle 表定义（双驱动共享）：只用两库都支持的基础列类型，向量与全文索引留给适配器，共 19 张核心表。 | `categories`、`sites`、`tags`、`tagAliases`、`siteTags`、`siteFacets`、`siteRelations`、`collections`… | 外部 drizzle-orm/sqlite-core |
| `packages/store/src/search.ts` | 850 | 混合检索引擎：exact/fts/pinyin/semantic 四路并行召回 + RRF 融合 + coverage 乘子 + personal 通道，含 Query Planner early-exit、LinUCB 权重注入与通道耗时计量。 | `SearchEngine`、`SearchEngineDeps`、`SearchEngineOptions`、`ChannelTimings` | 包 @navhub/core；相对模块 4 个（./driver.ts、./fts.ts、./repository.ts…） |
| `packages/store/src/vector/codec.ts` | 118 | 向量编解码收敛点：清洗非有限值、维度对齐、SQLite BLOB 与 pgvector 文本字面量互转，规避 SQLite 静默写入 NaN 的隐性故障。 | `sanitizeFinite`、`hasNonFinite`、`fitDimension`、`toBlobParam`、`toPostgresParam`、`SeamVectorCodec`、`VECTOR_NON_FINITE_FALLBACK`、`VectorDialect`… | — |
| `packages/store/src/vector/index.ts` | 6 | 向量适配器出口：统一导出 codec、内存/ sqlite-vec / pgvector 三种实现。 | — | 相对模块 5 个（./codec.ts、./types.ts、./memory.ts…） |
| `packages/store/src/vector/memory.ts` | 50 | 内存向量存储：无 sqlite-vec/pgvector 时的降级实现，暴力余弦检索，进程内生命周期。 | `MemoryVectorStore` | 相对模块 2 个（./types.ts、./codec.ts） |
| `packages/store/src/vector/pgvector.ts` | 121 | pgvector 实现：HNSW 索引、文本字面量参数化写入与 KNN 查询。 | `toPgVector`、`PgVectorStore`、`PgLike`、`PgVectorStoreOptions` | 相对模块 2 个（./types.ts、./codec.ts） |
| `packages/store/src/vector/sqlite-vec.ts` | 194 | sqlite-vec 实现：vec0 虚拟表、BigInt 主键、必须带 LIMIT 的 KNN 查询、rehydrate 回灌与 key→siteId 映射。 | `SqliteVecStore`、`SqliteLike`、`SqliteVecStoreOptions` | 相对模块 2 个（./types.ts、./codec.ts） |
| `packages/store/src/vector/types.ts` | 91 | 向量存储契约：VectorRecord/VectorMatch/VectorStore 接口与 hashSiteId、归一化、BLOB 互转等工具。 | `hashSiteId`、`vectorToBlob`、`blobToVector`、`normalize`、`VectorRecord`、`VectorMatch`、`VectorStore` | 相对模块 1 个（./codec.ts） |

### 测试文件

| 文件 | 行数 | 职责与实现要点 | 关键导出 | 主要依赖 |
| :--- | ---: | :--- | :--- | :--- |
| `packages/store/test/audit-resilience.test.ts` | 69 | 审计写入容错：audit 失败不得把已成功的写操作变成 500。 | — | 相对模块 2 个（../src/driver.ts、../src/repository.ts）；外部 vitest |
| `packages/store/test/dashboard-repo.test.ts` | 186 | 仪表盘仓储聚合结果测试。 | — | 相对模块 3 个（../src/driver.ts、../src/repository.ts、../src/search.ts）；外部 vitest |
| `packages/store/test/dialect.test.ts` | 114 | 方言适配回归：真实踩过的占位符/类型/排序坑。 | — | 相对模块 2 个（../src/repository.ts、../src/fts-pg.ts）；外部 vitest |
| `packages/store/test/driver-pragma.test.ts` | 57 | SQLite pragma 生效断言（WAL/synchronous/temp_store/mmap）。 | — | 相对模块 1 个（../src/driver.ts）；外部 vitest |
| `packages/store/test/pg-dialect.e2e.test.ts` | 220 | 跨方言一致性（真实 PG）：与 SQLite 同批断言逐项对齐，未配置则 skip。 | — | 相对模块 2 个（../../../apps/api/src/config.ts、../../../apps/api/src/context.ts）；外部 vitest |
| `packages/store/test/retention.test.ts` | 267 | 数据保留：先归档后删除、批次与方言无关性。 | — | 相对模块 1 个（../src/retention.ts）；外部 vitest |
| `packages/store/test/rollup-pg.e2e.test.ts` | 202 | rollup 的 PG 方言端到端：$n 占位符、GROUP BY 序号、ON CONFLICT。 | — | 相对模块 2 个（../src/rollup.ts、../src/retention.ts）；外部 node:module、vitest |
| `packages/store/test/rollup.test.ts` | 426 | 明细聚合：日统计生成、明细删除与幂等重跑。 | — | 相对模块 2 个（../src/rollup.ts、../src/retention.ts）；外部 vitest |
| `packages/store/test/search-intelligence.test.ts` | 127 | 检索智能：RRF 融合、coverage 乘子、Query Planner early-exit。 | — | 相对模块 3 个（../src/driver.ts、../src/repository.ts、../src/search.ts）；外部 vitest |
| `packages/store/test/semantic-taxonomy.test.ts` | 192 | 语义分类：向量近邻与类目归属。 | — | 相对模块 3 个（../src/driver.ts、../src/repository.ts、../src/search.ts）；外部 vitest |
| `packages/store/test/site-facets.test.ts` | 218 | 站点分面仓储：写入、按分面聚合与分布统计。 | — | 相对模块 3 个（../src/driver.ts、../src/repository.ts、../src/search.ts）；外部 vitest |
| `packages/store/test/store.test.ts` | 1105 | 存储层总集成测试（最大）：站点/类目/标签/收藏/任务/向量/FTS 全链路。 | — | 相对模块 5 个（../src/vector/index.ts、../src/fts.ts、../src/search.ts…）；外部 vitest |
| `packages/store/test/tags-taxonomy.test.ts` | 195 | 标签体系：合并、别名解析与计数聚合。 | — | 相对模块 3 个（../src/driver.ts、../src/repository.ts、../src/search.ts）；外部 vitest |
| `packages/store/test/taxonomy-governance-repo.test.ts` | 182 | 治理提案仓储：保存、查询、采纳与驳回。 | — | 包 @navhub/core；相对模块 2 个（../src/driver.ts、../src/repository.ts）；外部 vitest |
| `packages/store/test/vector-codec.test.ts` | 179 | 向量编解码：非有限值清洗、维度对齐与双方言参数格式。 | — | 相对模块 1 个（../src/vector/index.ts）；外部 vitest |

## 3. `packages/ai` — 端侧 AI 与抓取安全（7 源文件 + 4 测试，1,382 行）

本地 embedding（bge-small-zh-v1.5 + ONNX）、HTML 元数据抽取、LLM 富化与规则降级、三层 SSRF 防护、超时工具。

| 文件 | 行数 | 职责与实现要点 | 关键导出 | 主要依赖 |
| :--- | ---: | :--- | :--- | :--- |
| `packages/ai/src/embedding-worker.ts` | 90 | ONNX 推理 Worker 线程：独立线程加载 transformers 管道并推理，用 Transferable ArrayBuffer 零拷贝回传 Float32Array，避免阻塞主事件循环。 | — | — |
| `packages/ai/src/embedding.ts` | 405 | 本地 embedding 服务：bge-small-zh-v1.5 惰性加载、HF 镜像 endpoint、LRU 缓存 + singleflight 合并、Worker 模式与进程内降级、ready/stats/close 生命周期。 | `normalizeEmbeddingKey`、`createEmbeddingCache`、`createEmbeddingService`、`siteEmbeddingText`、`DEFAULT_EMBEDDING_CONFIG`、`EmbeddingConfig`、`EmbeddingService`、`EmbeddingCache` | 相对模块 1 个（./with-timeout.ts） |
| `packages/ai/src/enrich.ts` | 467 | AI 富化：抓取 URL → 元数据 → LLM 结构化输出（zod 校验 + 一次重试）→ 失败降级为启发式规则，并标记 provenance。 | `heuristicCategory`、`heuristicTags`、`enrichUrl`、`stripCodeFence`、`heuristicFacets`、`DEFAULT_LLM`、`EnrichmentSchema`、`HEURISTIC_RULES`… | 包 @navhub/core；相对模块 2 个（./ssrf.ts、./metadata.ts）；外部 zod |
| `packages/ai/src/index.ts` | 5 | `@navhub/ai` 出口：导出 embedding、enrich、metadata、ssrf、withTimeout。 | — | 相对模块 4 个（./embedding.ts、./ssrf.ts、./metadata.ts…） |
| `packages/ai/src/metadata.ts` | 93 | HTML 元数据抽取：轻量正则提取 title/og/twitter/description/icon，按主流抓取器优先级排序并绝对化 URL。 | `absolutize`、`extractMetadata`、`ExtractedMetadata` | — |
| `packages/ai/src/ssrf.ts` | 292 | 三层 SSRF 防护：协议白名单、DNS 解析后真实 IP 网段校验（防 DNS Rebinding）、重定向逐跳复检，提供 guardedFetch。 | `isBlockedIp`、`isBlockedIpv4`、`isBlockedIpv6`、`assertUrlShape`、`resolveAndCheck`、`guardedFetch`、`SsrfBlockedError`、`DEFAULT_GUARD`… | 外部 node:dns/promises、node:net |
| `packages/ai/src/with-timeout.ts` | 30 | Promise 超时兜底：任务落地即清定时器，避免悬空 setTimeout 拖住事件循环。 | `withTimeout` | — |

### 测试文件

| 文件 | 行数 | 职责与实现要点 | 关键导出 | 主要依赖 |
| :--- | ---: | :--- | :--- | :--- |
| `packages/ai/test/ai.test.ts` | 264 | AI 包综合测试：元数据抽取、SSRF 三层防护、富化降级与超时。 | — | 相对模块 3 个（../src/ssrf.ts、../src/metadata.ts、../src/enrich.ts）；外部 vitest |
| `packages/ai/test/embedding-cache.test.ts` | 127 | embedding LRU 缓存与 singleflight 合并并发请求的回归。 | — | 相对模块 1 个（../src/embedding.ts）；外部 vitest |
| `packages/ai/test/embedding-worker.test.ts` | 75 | Worker 线程推理与主线程降级路径测试。 | — | 相对模块 1 个（../src/embedding.ts）；外部 vitest |
| `packages/ai/test/with-timeout.test.ts` | 48 | 超时工具：按时完成、超时拒绝、定时器不泄漏。 | — | 相对模块 1 个（../src/with-timeout.ts）；外部 vitest |

## 4. `packages/mcp` — Model Context Protocol 服务（14 源文件 + 2 测试，1,593 行）

把同一套 AppContext 暴露为 30+ 个 MCP 工具，stdio 与 Streamable HTTP 双传输，读写 scope 分级 + 幂等 + 审计。

| 文件 | 行数 | 职责与实现要点 | 关键导出 | 主要依赖 |
| :--- | ---: | :--- | :--- | :--- |
| `packages/mcp/src/handlers.ts` | 45 | MCP 处理器组合入口：构造共享依赖（上下文、幂等、向量索引）并把各域 (deps,args,tc) 处理器绑定为对外 (args,tc) 的对象。 | `createHandlers`、`Handlers` | 包 @navhub/api；相对模块 8 个（./handlers/algorithms.ts、./handlers/catalog.ts、./handlers/developer-tools.ts…） |
| `packages/mcp/src/handlers/algorithms.ts` | 113 | 算法域工具：架构配方、技术对比、自治修复、技术路径、栈兼容、站点聚类（只读投影，heal 会审计）。 | `algorithmHandlers` | 包 @navhub/core；相对模块 2 个（../tools.ts、./shared.ts） |
| `packages/mcp/src/handlers/catalog.ts` | 73 | 目录域工具：类目、标签、统计、热度榜，全部只读。 | `catalogHandlers` | 相对模块 2 个（../tools.ts、./shared.ts） |
| `packages/mcp/src/handlers/developer-tools.ts` | 132 | 开发者工具域：意图解析、配色和谐、联邦推荐、推测规则、动态工具合成，纯计算不落库。 | `developerToolHandlers` | 包 @navhub/core；相对模块 2 个（../tools.ts、./shared.ts） |
| `packages/mcp/src/handlers/discovery.ts` | 141 | 发现域工具：双曲流形平替站点与 Wayback 存档解析，能力缺失时平滑降级。 | `discoveryHandlers` | 包 @navhub/ai、@navhub/core；相对模块 2 个（../tools.ts、./shared.ts） |
| `packages/mcp/src/handlers/jobs.ts` | 34 | 任务域工具：入队（admin）与查询（read）。 | `jobHandlers` | 相对模块 2 个（../tools.ts、./shared.ts） |
| `packages/mcp/src/handlers/shared.ts` | 93 | MCP 处理器共享设施：ok/fail 结果包装、幂等包装器、索引包装器与处理器签名绑定。 | `ok`、`fail`、`makeWithIdempotency`、`makeIndexSite`、`bind`、`ToolResult`、`Handler`、`HandlerDeps`… | 包 @navhub/ai、@navhub/api、@navhub/store；相对模块 1 个（../tools.ts） |
| `packages/mcp/src/handlers/sites.ts` | 265 | 站点域工具：检索/读取/增删改/批量导入/导出/健康巡检/刷新排队，写操作统一走权限→幂等→审计。 | `siteHandlers` | 包 @navhub/ai、@navhub/core；相对模块 2 个（../tools.ts、./shared.ts） |
| `packages/mcp/src/handlers/state-sync.ts` | 73 | 状态同步域：CRDT 操作日志合并与 P2P 网格节点消息交换。 | `stateSyncHandlers` | 包 @navhub/core；相对模块 2 个（../tools.ts、./shared.ts） |
| `packages/mcp/src/http-server.ts` | 319 | MCP Streamable HTTP 传输（标准协议，有状态会话 + SSE）与兼容 REST 端点，使 Claude Desktop/Cursor 等标准客户端可直连。 | `createMcpHttpServer`、`mcpHttpOptionsFromEnv`、`McpHttpOptions` | 包 @navhub/api；相对模块 3 个（./handlers.ts、./mcp-server.ts、./tools.ts）；外部 @modelcontextprotocol/sdk/server/streamableHttp.js |
| `packages/mcp/src/http.ts` | 55 | MCP HTTP 启动入口：读环境变量、装配上下文、校验生产安全约束（默认 127.0.0.1、必须 Bearer、Origin 校验）后监听。 | — | 包 @navhub/api；相对模块 2 个（./http-server.ts、./tools.ts） |
| `packages/mcp/src/mcp-server.ts` | 67 | MCP Server 工厂：ListTools 按 scope 过滤并转 JSON Schema，CallTool 查表调用并把异常转为 isError，stdio 与 HTTP 共用。 | `createMcpServer` | 包 @navhub/api；相对模块 2 个（./tools.ts、./handlers.ts）；外部 @modelcontextprotocol/sdk/server/index.js、@modelcontextprotocol/sdk/types.js、zod-to-json-schema |
| `packages/mcp/src/stdio.ts` | 52 | MCP stdio 传输入口：供 Claude Desktop 等本地进程以管道方式连接。 | — | 包 @navhub/api；相对模块 2 个（./tools.ts、./mcp-server.ts）；外部 @modelcontextprotocol/sdk/server/stdio.js |
| `packages/mcp/src/tools.ts` | 131 | MCP 工具清单与安全模型：读写分级、危险操作默认 dryRun、幂等键、审计、输入上限；schema 单一事实源来自 core。 | `requireScope`、`toolByName`、`McpAuthError`、`TOOL_DEFS`、`McpScope`、`ToolContext` | 包 @navhub/core；外部 zod |

### 测试文件

| 文件 | 行数 | 职责与实现要点 | 关键导出 | 主要依赖 |
| :--- | ---: | :--- | :--- | :--- |
| `packages/mcp/test/mcp-http.test.ts` | 275 | 标准 MCP Streamable HTTP 传输：真实端口、会话头、initialize/tools/list/tools/call 与 scope 收紧。 | — | 包 @navhub/api；相对模块 1 个（../src/http-server.ts）；外部 node:net、vitest |
| `packages/mcp/test/mcp.test.ts` | 642 | MCP 工具安全边界：只读 token 不能写、批量默认 dryRun、幂等去重与审计留痕。 | — | 包 @navhub/api；相对模块 2 个（../src/handlers.ts、../src/tools.ts）；外部 vitest |

## 5. `apps/api` — Fastify 中枢（47 源文件 + 13 测试，8,140 行）

REST 中枢：配置/上下文装配、横切关注点、28 个路由插件（117 个端点）、任务队列、指标与 OpenAPI、种子与迁移。

| 文件 | 行数 | 职责与实现要点 | 关键导出 | 主要依赖 |
| :--- | ---: | :--- | :--- | :--- |
| `apps/api/src/alerts.ts` | 63 | 任务失败告警的 webhook 投递器：URL 来自运维配置故不走 SSRF 守卫，但限定 http/https；永不抛错，超时钳制 1s~30s，避免拖住 JobRunner 的 tick。 | `clampWebhookTimeout`、`sendWebhookAlert`、`WebhookAlertPayload` | — |
| `apps/api/src/auth.ts` | 101 | REST 层鉴权基元：token 生成/哈希/前缀、scope 解析与包含关系（read<write<admin）、恒定时间比较、Bearer 提取。默认关闭鉴权以兼容个人部署。 | `hashToken`、`generateToken`、`tokenPrefixOf`、`parseScopes`、`scopeSatisfies`、`secureEqual`、`bearerOf`、`ANONYMOUS_IDENTITY`… | 外部 fastify |
| `apps/api/src/config.ts` | 248 | 运行配置装配：解析 lite/standard 双模式、端口、CORS、SQLite/PG 路径、embedding 与 LLM 参数、鉴权与代理开关，输出不可变 AppConfig。 | `loadConfig`、`NavHubMode`、`AppConfig` | — |
| `apps/api/src/context.ts` | 172 | 应用上下文工厂：把配置、数据库、仓储、检索引擎、向量/FTS 适配器、embedding 服务装配为 AppContext，是双模式差异被消化的唯一位置（能力可选、失败不致命）。 | `createContext`、`Capabilities`、`AppContext` | 包 @navhub/ai、@navhub/store；相对模块 1 个（./config.ts） |
| `apps/api/src/identity-signature.ts` | 48 | 终端用户身份 HMAC 签名：以 NAVHUB_IDENTITY_SECRET 对 userId/anonId 签名，阻断「自称任意身份」读写他人收藏与画像。 | `signIdentity`、`verifyIdentitySignature` | — |
| `apps/api/src/index-site.ts` | 68 | 站点索引共享函数：批量向量化并 upsert 向量表、同时持久化 embedding（FTS 与拼音由 Repository 写路径维护）；向量失败只记 capabilities.notes，server.ts 与 jobs.ts 共用。 | `indexSite`、`indexSitesBatch`、`IndexSiteItem` | 包 @navhub/ai、@navhub/store；相对模块 1 个（./context.ts） |
| `apps/api/src/index-plugin.ts` | 112 | 插件索引共享函数：批量向量化并写入独立的 `plugins_vec` 向量表 + `plugin_embeddings` 持久层（业务 id `plugin:<slug>`）；失败只记 capabilities.notes；审核上架 / 导入 / 种子 / reindex 共用一条路径，另提供离开上架状态的向量摘除。 | `indexPlugin`、`indexPluginsBatch`、`indexItemFromManifest`、`removePluginIndex`、`IndexPluginItem` | 包 @navhub/ai、@navhub/store、@navhub/core；相对模块 1 个（./context.ts） |
| `apps/api/src/index.ts` | 14 | `@navhub/api` 可复用出口：导出上下文装配、buildServer、站点/插件索引与插件语义检索，供 MCP 包复用同一套仓储/检索，保证两条入口行为一致。 | — | 相对模块 7 个（./config.ts、./context.ts、./server.ts、./index-plugin.ts…） |
| `apps/api/src/jobs.ts` | 873 | 后台任务队列 Runner：9 类任务（health_check / refetch_metadata / recompute_rank / reindex / site_self_healing / token_audit / purge_trash / taxonomy_audit / data_retention），cron 调度、指数退避（最多 3 次）、单实例锁（SQLite 持久锁行 TTL 120s / PG advisory lock）、事件总线与 drain。 | `scheduleCronOf`、`cronDue`、`backoffMs`、`JobEventBus`、`JobRunner`、`JOB_KINDS`、`jobEventBus`、`DEFAULT_CRON_SCHEDULES`… | 包 @navhub/ai、@navhub/core、@navhub/store；相对模块 2 个（./context.ts、./index-site.ts） |
| `apps/api/src/main.ts` | 62 | 服务进程入口：加载配置 → 创建上下文 → buildServer → listen，并注册优雅退出。刻意不做 import.meta.url 主模块判断（Windows 路径形式不一致会静默退出）。 | — | 相对模块 5 个（./config.ts、./context.ts、./server.ts…） |
| `apps/api/src/metrics.ts` | 323 | 进程内轻量指标：按「路由模板 + 方法 + 状态码」有界基数统计 HTTP 时延与检索通道耗时，渲染 Prometheus 文本，不引入 prom-client。 | `recordHttpMetric`、`getHttpMetricsSummary`、`recordSearchChannels`、`getSearchPlannerStats`、`renderMetrics`、`HttpMetricsSummary` | 相对模块 1 个（./context.ts） |
| `apps/api/src/migrate.ts` | 34 | Schema 迁移 CLI 入口：不启动服务即可执行幂等列迁移，供部署前预热与 CI 校验。 | — | 包 @navhub/store；相对模块 2 个（./config.ts、./context.ts） |
| `apps/api/src/openapi.ts` | 312 | OpenAPI 3.1 文档生成器：从 Fastify onRoute 收集的真实路由表 + core 的 zod 契约生成文档，附内置 Swagger UI 页面，杜绝手写清单漂移。 | `buildOpenApiDoc`、`renderDocsHtml`、`RouteEntry` | 包 @navhub/core；相对模块 1 个（./auth.ts）；外部 zod-to-json-schema |
| `apps/api/src/plugins-search.ts` | 186 | 插件语义检索（REST / MCP 共用）：语义通道可用时走 `plugins_vec` KNN；未就绪 / 不可用 / 命中为空时关键词回退，并以 `degraded` 如实标注；相似插件在自身向量缺失时按需补建，语义不可用则返回空列表不阻塞详情页。 | `searchPluginsSemantic`、`similarPlugins`、`PluginSearchOptions`、`PluginSearchResult`、`SimilarPluginsResult`、`PluginSearchItem` | 包 @navhub/core、@navhub/store；相对模块 2 个（./context.ts、./index-plugin.ts） |
| `apps/api/src/profile-service.ts` | 113 | 个性化画像刷新服务：把 click/favorite 事件聚合进 user_profiles 供 personal 检索通道消费，按身份 60 秒节流并限制节流表容量。 | `profileThrottleSize`、`isProfileStale`、`refreshUserProfile`、`resetProfileThrottle`、`resetUserProfile`、`THROTTLE_MAX_ENTRIES` | 包 @navhub/core；相对模块 1 个（./context.ts） |
| `apps/api/src/routes/agents.ts` | 221 | 智能体路由域：推测意图编译、动态工具合成、P2P 网格信令。 | `agentRoutes` | 包 @navhub/core；相对模块 3 个（./visual.ts、../context.ts、./shared.ts）；外部 fastify、zod |
| `apps/api/src/routes/audit.ts` | 72 | 审计日志查询与合规导出路由：按行为/主体/时间分页检索，支持安全归档导出。 | `auditRoutes` | 相对模块 2 个（../context.ts、./shared.ts）；外部 fastify |
| `apps/api/src/routes/categories.ts` | 220 | 类目路由域：分类树查询、创建、增强属性 PATCH、级联删除、跨层级移动与合并。 | `categoryRoutes` | 相对模块 2 个（../context.ts、./shared.ts）；外部 fastify、zod |
| `apps/api/src/routes/collections.ts` | 25 | 精选专题路由域：专题列表、详情与条目读取。 | `collectionRoutes` | 相对模块 1 个（../context.ts）；外部 fastify |
| `apps/api/src/routes/crdt.ts` | 120 | CRDT 操作日志路由域：多端离线编辑日志的提交与合流。 | `crdtRoutes` | 包 @navhub/core；相对模块 2 个（./shared.ts、../context.ts）；外部 fastify、zod |
| `apps/api/src/routes/enrich.ts` | 80 | AI 富化路由域：URL 抓取 → 元数据抽取 → 分类/标签推断 → 自动入库。 | `enrichRoutes` | 包 @navhub/ai、@navhub/core；相对模块 2 个（../index-site.ts、../context.ts）；外部 fastify、zod |
| `apps/api/src/routes/facets.ts` | 79 | 分面路由域：受控分面词表、分类/标签下的分面热度分布、单站点分面属性维护。 | `facetRoutes` | 包 @navhub/core；相对模块 2 个（../context.ts、./shared.ts）；外部 fastify、zod |
| `apps/api/src/routes/favorites.ts` | 97 | 终端用户收藏夹路由域：增删查与收藏夹分组。 | `favoriteRoutes` | 相对模块 2 个（./shared.ts、../context.ts）；外部 fastify、zod |
| `apps/api/src/routes/health.ts` | 53 | 健康与能力探针：/api/health、/ready、/metrics、/warmup，如实上报语义/全文/LLM 能力状态。 | `healthRoutes` | 相对模块 2 个（../metrics.ts、../context.ts）；外部 fastify |
| `apps/api/src/routes/history.ts` | 33 | 搜索历史路由域：记录、读取与清空。 | `historyRoutes` | 相对模块 2 个（./shared.ts、../context.ts）；外部 fastify |
| `apps/api/src/routes/identity.ts` | 43 | 终端用户身份同步：OAuth 登录后的用户 upsert。 | `identityRoutes` | 相对模块 2 个（../context.ts、./shared.ts）；外部 fastify、zod |
| `apps/api/src/routes/jobs.ts` | 239 | 任务队列管理路由：入队、明细、取消、重试、历史修剪与 SSE 实时事件推流。 | `jobRoutes` | 包 @navhub/core；相对模块 3 个（../context.ts、../jobs.ts、./shared.ts）；外部 fastify、zod |
| `apps/api/src/routes/navsphere.ts` | 48 | NavSphere 兼容存储 API：把历史 JSON 文件路径映射为数据库读写端点。 | `navsphereRoutes` | 相对模块 2 个（../storage.ts、../context.ts）；外部 fastify、zod |
| `apps/api/src/routes/profile.ts` | 38 | 个性化画像路由：可解释偏好读取与刷新。 | `profileRoutes` | 相对模块 3 个（./shared.ts、../profile-service.ts、../context.ts）；外部 fastify |
| `apps/api/src/routes/rank.ts` | 218 | 推荐排序路由：热度/新品/相似/双曲平替/LinUCB/联邦隐私推荐。 | `rankRoutes` | 包 @navhub/core；相对模块 2 个（./shared.ts、../context.ts）；外部 fastify、zod |
| `apps/api/src/routes/recipes.ts` | 217 | 算法配方路由：架构配方、竞品对比、确定性 Favicon、自洽愈合。 | `recipeRoutes` | 包 @navhub/ai、@navhub/core；相对模块 1 个（../context.ts）；外部 fastify、zod |
| `apps/api/src/routes/relations.ts` | 100 | 站点关系图谱路由：强类型关系（平替/互补/套件/上游/镜像/关联）双向查询与自我中心图谱。 | `relationRoutes` | 包 @navhub/core；相对模块 2 个（../context.ts、./shared.ts）；外部 fastify、zod |
| `apps/api/src/routes/search.ts` | 151 | 检索路由域：多通道混合召回、查询计划、分面意图解析与降级标记。 | `searchRoutes` | 相对模块 4 个（../metrics.ts、./shared.ts、../profile-service.ts…）；外部 fastify、zod |
| `apps/api/src/routes/shared.ts` | 220 | 路由共享工具箱：统一响应构造（ok/badRequest/conflict…）、分页与参数归一化、SSE 流、审计兜底、身份提取与鉴权辅助。 | `notFound`、`badRequest`、`conflict`、`forbidden`、`unauthorized`、`created`、`parsePagination`、`parseIntParam`… | 相对模块 1 个（../context.ts）；外部 fastify |
| `apps/api/src/routes/sites.ts` | 271 | 站点 CRUD 路由域：列表/详情/创建/更新/删除/批量导入/URL 自动富化。 | `siteRoutes` | 包 @navhub/ai、@navhub/core；相对模块 2 个（../index-site.ts、../context.ts）；外部 fastify、zod |
| `apps/api/src/routes/stats.ts` | 271 | 运营统计路由：全景指标、性能遥测、安全态势、LinUCB 权重演进、SSE 推流与存储在线维护。 | `statsRoutes` | 相对模块 3 个（../context.ts、../metrics.ts、./shared.ts）；外部 fastify、zod |
| `apps/api/src/routes/submissions.ts` | 150 | 投稿与审核路由：匿名投稿入库、审核通过后转正式站点。 | `submissionRoutes` | 相对模块 3 个（../index-site.ts、./shared.ts、../context.ts）；外部 fastify、zod |
| `apps/api/src/routes/tags.ts` | 190 | 标签路由：标签云热度聚合、重命名、解绑删除与批量合并。 | `tagRoutes` | 相对模块 2 个（../context.ts、./shared.ts）；外部 fastify、zod |
| `apps/api/src/routes/taxonomy.ts` | 121 | 分类/标签治理路由：健康度审计、治理提案查询、单条与批量人工采纳/驳回。 | `taxonomyRoutes` | 相对模块 2 个（../context.ts、./shared.ts）；外部 fastify、zod |
| `apps/api/src/routes/telemetry.ts` | 71 | 遥测路由：点击/收藏/搜索事件上报，驱动画像与 LinUCB 闭环。 | `telemetryRoutes` | 包 @navhub/core；相对模块 2 个（../profile-service.ts、../context.ts）；外部 fastify、zod |
| `apps/api/src/routes/tokens.ts` | 232 | API Token 管理路由：签发、轮换、吊销与列表（admin 级）。 | `tokenRoutes` | 相对模块 2 个（../auth.ts、../context.ts）；外部 fastify、zod |
| `apps/api/src/routes/trash.ts` | 56 | 回收站路由：软删除列表、恢复与彻底清除。 | `trashRoutes` | 相对模块 2 个（../index-site.ts、../context.ts）；外部 fastify |
| `apps/api/src/routes/vault.ts` | 55 | E2EE 金库路由：密文 Blob 的云端存取，服务端零知识。 | `vaultRoutes` | 相对模块 2 个（./shared.ts、../context.ts）；外部 fastify、zod |
| `apps/api/src/routes/visual.ts` | 298 | 视觉设计与 WebMCP 路由：配色和谐度分析、视觉指纹、端侧 MCP JSON-RPC 桥。 | `webMcp`、`visualRoutes` | 包 @navhub/core；相对模块 2 个（./shared.ts、../context.ts）；外部 fastify、zod |
| `apps/api/src/seed-data.json` | 718 | 种子数据：分类、精选技术站点、专题合集与视频条目的静态清单，供 seed 脚本幂等导入。 | — | — |
| `apps/api/src/seed-main.ts` | 19 | 种子数据 CLI 入口：导入即执行，避免 Windows 下主模块判断失效导致静默不执行。 | — | 相对模块 1 个（./seed.ts） |
| `apps/api/src/seed.ts` | 133 | 种子导入逻辑：按 URL 去重幂等写入分类/站点/专题，保证 docker compose up 后即是可用站点而非空壳。 | `runSeed`、`SeedResult` | 包 @navhub/ai、@navhub/core、@navhub/store；相对模块 3 个（./config.ts、./context.ts、./storage.ts） |
| `apps/api/src/server.ts` | 384 | Fastify 中枢装配层：CORS/限流/安全响应头/请求 ID/指标 hook/全局错误/响应缓存/分级鉴权/OpenAPI 收集，并按域注册 24 个路由插件。 | `buildServer` | 相对模块 34 个（./context.ts、./openapi.ts、./metrics.ts…）；外部 @fastify/cors、@fastify/rate-limit、fastify |
| `apps/api/src/storage.ts` | 467 | 存储适配层：把 NavSphere 的 JSON 文件语义（navigation/site/resource-metadata/videos）翻译为数据库读写，是 69 处业务调用点零改动切换存储的关键。 | `buildNavigationData`、`writeNavigationData`、`readSiteConfig`、`writeSiteConfig`、`readResourceMetadata`、`writeResourceMetadata`、`readVideosData`、`writeVideosData`… | 包 @navhub/core；相对模块 1 个（./context.ts） |

### 测试文件

| 文件 | 行数 | 职责与实现要点 | 关键导出 | 主要依赖 |
| :--- | ---: | :--- | :--- | :--- |
| `apps/api/test/api.test.ts` | 1735 | REST 全链路集成测试（Fastify inject）：路由 + zod 校验 + 仓储 + 检索，含 embedding 关闭时的降级路径。 | — | 相对模块 3 个（../src/server.ts、../src/context.ts、../src/config.ts）；外部 vitest |
| `apps/api/test/array-caps.test.ts` | 167 | 数组入参上界回归：验证批量写/CRDT 合流等路由的 .max() 限制，防写放大与廉价 DoS。 | — | 相对模块 3 个（../src/server.ts、../src/context.ts、../src/config.ts）；外部 vitest |
| `apps/api/test/auth.test.ts` | 681 | REST 鉴权：开放模式零变化、鉴权模式 public/read/write/admin 逐级拦截、scope 包含、bootstrap 与过期 token。 | — | 相对模块 4 个（../src/server.ts、../src/context.ts、../src/config.ts…）；外部 vitest |
| `apps/api/test/dashboard.test.ts` | 183 | 仪表盘聚合接口测试：总览、分布、安全态势与队列深度。 | — | 相对模块 3 个（../src/server.ts、../src/context.ts、../src/config.ts）；外部 vitest |
| `apps/api/test/facets-api.test.ts` | 150 | 分面 API 测试：词表定义、分布统计与站点分面维护。 | — | 相对模块 3 个（../src/server.ts、../src/context.ts、../src/config.ts）；外部 vitest |
| `apps/api/test/hardening.test.ts` | 148 | 参数加固回归：校验失败不得返回 200、LIMIT 负数/NaN 防护、缺身份写操作一致性。 | — | 相对模块 5 个（../src/server.ts、../src/context.ts、../src/config.ts…）；外部 vitest |
| `apps/api/test/identity-signature.test.ts` | 132 | 身份 HMAC 签名：纯函数向量 + 真实路由 401/200 行为。 | — | 相对模块 4 个（../src/server.ts、../src/context.ts、../src/config.ts…）；外部 vitest |
| `apps/api/test/jobs.test.ts` | 554 | JobRunner 集成测试：四类任务真实 SQLite 执行、失败隔离、单实例锁与画像聚合。 | — | 相对模块 4 个（../src/context.ts、../src/config.ts、../src/jobs.ts…）；外部 vitest |
| `apps/api/test/navigation-snapshot.test.ts` | 172 | navigation.json 快照读写一致性：读侧不得预过滤/截断，否则写侧会误判删除。 | — | 相对模块 3 个（../src/server.ts、../src/context.ts、../src/config.ts）；外部 vitest |
| `apps/api/test/schema-parity.test.ts` | 170 | schema 与仓储列清单一致性校验，防止代码与 DDL 漂移。 | — | 包 @navhub/core；相对模块 1 个（../src/openapi.ts）；外部 vitest |
| `apps/api/test/semantic-api.test.ts` | 195 | 语义检索接口测试：向量可用/不可用两种路径与 capability 上报。 | — | 相对模块 3 个（../src/server.ts、../src/context.ts、../src/config.ts）；外部 vitest |
| `apps/api/test/taxonomy-api.test.ts` | 168 | 分类治理 API 测试：审计报告、提案采纳与驳回。 | — | 相对模块 3 个（../src/server.ts、../src/context.ts、../src/config.ts）；外部 vitest |
| `apps/api/test/upgrade-batch1.test.ts` | 127 | 升级专项回归：Query Planner、cron 调度与 Runner drain。 | — | 相对模块 3 个（../src/context.ts、../src/config.ts、../src/jobs.ts）；外部 vitest |

## 6. `apps/web-overlay` — 前端事实源（202 个自研文件，45,689 行）

NavHub 自研前端的唯一事实源：Next.js 15 App Router 页面、Bento 工作台、DIY 排版、模块系统、BFF 代理、纯函数工具库。`apps/web` 中的同名文件是它的镜像。

| 文件 | 行数 | 职责与实现要点 | 关键导出 | 主要依赖 |
| :--- | ---: | :--- | :--- | :--- |
| `apps/web-overlay/src/app/admin/AdminDashboardClient.tsx` | 1140 | 仪表盘客户端：引擎能力卡、站点/类目统计、SSE 实时遥测、LinUCB 权重与健康趋势图。 | `AdminDashboardClient` | 站内别名 6 个（@/components/ui/badge、@/components/ui/button、@/components/ui/card…）；外部 lucide-react、next/link、react |
| `apps/web-overlay/src/app/admin/AdminLayoutClient.tsx` | 472 | 后台布局客户端：侧边导航、面包屑、搜索、用户菜单与移动端抽屉。 | `AdminLayoutClient` | 站内别名 6 个（@/lib/utils、@/registry/new-york/ui/avatar、@/registry/new-york/ui/button…）；外部 lucide-react、next-auth/react、next-themes、next/link、next/navigation、react |
| `apps/web-overlay/src/app/admin/audit/page.tsx` | 252 | 审计日志页：按动作/主体/时间筛选与分页，支持合规导出。 | `AdminAuditPage` | 站内别名 3 个（@/components/ui/button、@/lib/degrade、@/lib/navhub-api）；外部 lucide-react、react |
| `apps/web-overlay/src/app/admin/categories/page.tsx` | 426 | 类目管理页：树形展示、创建、改名、移动、合并与级联删除。 | `AdminCategoriesPage` | 站内别名 5 个（@/components/admin/load-error-notice、@/components/ui/button、@/components/ui/input…）；外部 react |
| `apps/web-overlay/src/app/admin/collections/page.tsx` | 335 | 专题管理页：专题 CRUD 与条目编排。 | `AdminCollectionsPage` | 站内别名 6 个（@/components/admin/load-error-notice、@/components/ui/button、@/components/ui/input…）；外部 react |
| `apps/web-overlay/src/app/admin/facets/page.tsx` | 362 | 分面词表管理页：受控分面定义与各分类下的分面分布。 | `AdminFacetsPage` | 站内别名 5 个（@/components/ui/button、@/components/ui/input、@/lib/degrade…）；外部 next/link、react |
| `apps/web-overlay/src/app/admin/jobs/page.tsx` | 602 | 任务队列页：任务列表、入队、取消/重试、SSE 实时状态与历史修剪。 | `AdminJobsPage` | 站内别名 6 个（@/components/ui/badge、@/components/ui/button、@/components/ui/card…）；外部 lucide-react、react |
| `apps/web-overlay/src/app/admin/layout.tsx` | 48 | 后台根布局：服务端校验管理员会话，未授权重定向登录。 | `metadata`、`async` | 站内别名 2 个（@/lib/auth、@/registry/new-york/ui/toaster）；相对模块 1 个（./AdminLayoutClient）；外部 next、next/navigation |
| `apps/web-overlay/src/app/admin/loading.tsx` | 46 | 后台骨架屏。 | `AdminLoading` | 站内别名 1 个（@/components/ui/skeleton） |
| `apps/web-overlay/src/app/admin/navigation/page.tsx` | 323 | 导航数据管理入口页（NavSphere 兼容后台）。 | `NavigationPage` | 站内别名 7 个（@/registry/new-york/hooks/use-toast、@/registry/new-york/ui/button、@/registry/new-york/ui/dialog…）；相对模块 2 个（./components/NavigationCard、./components/AddNavigationForm）；外部 @hello-pangea/dnd、lucide-react、react、swr |
| `apps/web-overlay/src/app/admin/page.tsx` | 11 | 后台首页路由壳，渲染 AdminDashboardClient。 | `metadata`、`AdminDashboardPage` | 相对模块 1 个（./AdminDashboardClient）；外部 next |
| `apps/web-overlay/src/app/admin/resources/page.tsx` | 980 | 资源管理页：资源分组与条目 CRUD、图标选择与引用检查。 | `ResourceManagement` | 站内别名 8 个（@/lib/clipboard、@/registry/new-york/hooks/use-toast、@/registry/new-york/ui/button…）；外部 @hookform/resolvers/zod、lucide-react、react、react-hook-form、zod |
| `apps/web-overlay/src/app/admin/sitelist/page.tsx` | 2063 | 站点列表管理（全站最大页面）：搜索/筛选/分页、行内编辑、批量操作、导入导出与富化收录。 | `SiteListPage` | 站内别名 16 个（@/components/icons、@/lib/degrade、@/lib/navigation-tree…）；外部 next/navigation、react |
| `apps/web-overlay/src/app/admin/stats/page.tsx` | 492 | 运营统计页：流量、检索、点击/收藏趋势与存储指标。 | `AdminStatsPage` | 站内别名 6 个（@/components/ui/badge、@/components/ui/button、@/components/ui/card…）；外部 lucide-react、next/link、react |
| `apps/web-overlay/src/app/admin/tags/page.tsx` | 355 | 标签管理页：标签云、重命名、合并与删除。 | `AdminTagsPage` | 站内别名 6 个（@/components/admin/load-error-notice、@/components/ui/button、@/components/ui/input…）；外部 next/link、react |
| `apps/web-overlay/src/app/admin/taxonomy/page.tsx` | 467 | 分类治理页：健康度审计报告与提案采纳/驳回。 | `AdminTaxonomyPage` | 站内别名 3 个（@/components/ui/button、@/components/ui/input、@/lib/navhub-api）；外部 lucide-react、react |
| `apps/web-overlay/src/app/admin/tokens/page.tsx` | 695 | API Token 管理页：签发（含 scope 选择）、轮换、吊销与一次性明文展示。 | `AdminTokensPage` | 站内别名 7 个（@/components/ui/badge、@/components/ui/button、@/components/ui/dialog…）；外部 lucide-react、react |
| `apps/web-overlay/src/app/admin/trash/page.tsx` | 189 | 回收站页：软删除站点列表、恢复与彻底清除。 | `AdminTrashPage` | 站内别名 3 个（@/components/ui/button、@/components/ui/use-toast、@/lib/navhub-api）；外部 lucide-react、react |
| `apps/web-overlay/src/app/admin/videos/[id]/categories/[categoryId]/items/page.tsx` | 334 | 视频子分类条目管理页。 | `runtime`、`SubCategoryVideoItemsPage` | 站内别名 9 个（@/components/icons、@/lib/degrade、@/registry/new-york/hooks/use-toast…）；相对模块 1 个（../../../../components/AddVideoItemForm）；外部 next/navigation、react |
| `apps/web-overlay/src/app/admin/videos/[id]/items/page.tsx` | 463 | 视频条目管理页：某视频分类下的条目 CRUD。 | `runtime`、`VideoItemsPage` | 站内别名 10 个（@/components/icons、@/lib/degrade、@/registry/new-york/hooks/use-toast…）；相对模块 1 个（../../components/AddVideoItemForm）；外部 next/navigation、react |
| `apps/web-overlay/src/app/admin/videos/components/AddVideoItemForm.tsx` | 142 | 新增视频条目表单：标题、链接、图标、分类与排序。 | `AddVideoItemForm`、`AddVideoItemFormProps` | 站内别名 4 个（@/registry/new-york/ui/button、@/registry/new-york/ui/input、@/registry/new-york/ui/label…）；外部 react |
| `apps/web-overlay/src/app/algorithms/page.tsx` | 21 | 算法实验室页：LinUCB 权重、双曲平替、知识图谱与检索调试可视化。 | `metadata`、`AlgorithmsPage` | 站内别名 2 个（@/components/algorithm-lab、@/components/footer）；外部 next |
| `apps/web-overlay/src/app/api/admin/stats/route.ts` | 62 | 后台统计 BFF：校验管理员会话后读取中枢统计。 | `GET`、`runtime` | 站内别名 3 个（@/lib/admin-guard、@/lib/github、@/types/navigation）；外部 next/server |
| `apps/web-overlay/src/app/api/extension/[id]/route.ts` | 71 | 浏览器扩展专用接口：按 id 一键收录/更新当前页站点（Token 鉴权）。 | `PUT`、`runtime` | 站内别名 3 个（@/lib/auth、@/lib/github、@/types/navigation）；外部 next/server |
| `apps/web-overlay/src/app/api/health/route.ts` | 22 | 健康 BFF：聚合中枢探活结果供前端仪表盘使用。 | `GET`、`runtime` | 外部 next/server |
| `apps/web-overlay/src/app/api/home/navigation/route.ts` | 29 | 首页导航数据接口：读取 navigation.json 快照。 | `GET`、`runtime` | 站内别名 1 个（@/lib/github）；外部 next/server |
| `apps/web-overlay/src/app/api/home/site/route.ts` | 20 | 首页站点配置接口：读取 site.json 快照。 | `GET`、`runtime` | 站内别名 1 个（@/lib/github）；外部 next/server |
| `apps/web-overlay/src/app/api/hub/[...path]/route.ts` | 179 | 同源 BFF 反向代理：运行时读取中枢地址，透传请求头/流式响应/二进制，注入会话委托凭据与身份 HMAC 签名，超时区分 504/502。 | `GET`、`POST`、`PUT`、`PATCH`、`DELETE` | 站内别名 3 个（@/lib/auth、@/lib/hub-proxy、@/lib/identity-signature）；外部 next/server |
| `apps/web-overlay/src/app/api/navigation/[id]/categories/route.ts` | 62 | 导航集合内分类的增删与排序。 | `DELETE`、`runtime` | 站内别名 3 个（@/lib/auth、@/lib/github、@/types/navigation）；外部 next/server |
| `apps/web-overlay/src/app/api/navigation/[id]/items/route.ts` | 150 | 导航集合内条目的 CRUD 与批量写入。 | `GET`、`POST`、`PUT`、`DELETE`、`runtime` | 站内别名 3 个（@/lib/auth、@/lib/github、@/types/navigation）；外部 next/server |
| `apps/web-overlay/src/app/api/navigation/[id]/route.ts` | 100 | 单个导航集合的读取、更新与删除。 | `GET`、`PUT`、`DELETE`、`runtime` | 站内别名 3 个（@/lib/auth、@/lib/github、@/types/navigation）；外部 next/server |
| `apps/web-overlay/src/app/api/navigation/check-default/route.ts` | 48 | 校验默认导航集合是否存在并可按需初始化。 | `GET`、`runtime` | 站内别名 2 个（@/lib/auth、@/lib/github）；外部 next/server |
| `apps/web-overlay/src/app/api/navigation/reorder/route.ts` | 54 | 导航/分类/条目拖拽排序落库。 | `POST`、`runtime` | 站内别名 3 个（@/lib/auth、@/lib/github、@/types/navigation）；外部 next/server |
| `apps/web-overlay/src/app/api/navigation/restore/route.ts` | 61 | 导航数据恢复（从备份快照回滚）。 | `POST`、`runtime` | 站内别名 2 个（@/lib/auth、@/lib/github）；外部 next/server |
| `apps/web-overlay/src/app/api/navigation/route.ts` | 106 | 导航数据读写接口：列表/创建/更新导航集合。 | `GET`、`POST`、`PUT`、`runtime` | 站内别名 3 个（@/lib/auth、@/lib/github、@/types/navigation）；外部 next/server |
| `apps/web-overlay/src/app/api/resource/route.ts` | 152 | 资源元数据接口：读取、写入与删除 resource-metadata.json 条目。 | `GET`、`POST`、`DELETE`、`runtime` | 站内别名 4 个（@/lib/auth、@/lib/buffer-utils、@/lib/github…）；外部 next/server |
| `apps/web-overlay/src/app/api/search/route.ts` | 30 | 搜索 BFF：转发到中枢 /api/search 并统一错误形态。 | `GET` | 外部 next/server |
| `apps/web-overlay/src/app/api/site/route.ts` | 57 | 站点配置（site.json）读取与写入。 | `GET`、`POST`、`runtime` | 站内别名 3 个（@/lib/auth、@/lib/github、@/types/site）；外部 next/server |
| `apps/web-overlay/src/app/api/submissions/[number]/route.ts` | 321 | 单条投稿审核：通过（转正式站点）/驳回。 | `PATCH`、`runtime` | 站内别名 4 个（@/lib/admin-guard、@/lib/auth、@/lib/github…）；外部 next/server |
| `apps/web-overlay/src/app/api/submissions/route.ts` | 233 | 投稿接口：创建投稿、列出待审投稿。 | `POST`、`GET`、`runtime` | 站内别名 2 个（@/lib/admin-guard、@/types/submission）；外部 next/server |
| `apps/web-overlay/src/app/api/videos/[id]/items/route.ts` | 153 | 视频条目 CRUD。 | `GET`、`POST`、`PUT`、`DELETE`、`runtime` | 站内别名 3 个（@/lib/auth、@/lib/github、@/types/navigation）；外部 next/server |
| `apps/web-overlay/src/app/api/videos/[id]/route.ts` | 124 | 单个视频集合的读取、更新与删除。 | `GET`、`PUT`、`DELETE`、`runtime` | 站内别名 3 个（@/lib/auth、@/lib/github、@/types/navigation）；外部 next/server |
| `apps/web-overlay/src/app/api/videos/route.ts` | 92 | 视频集合的读取、创建与更新。 | `GET`、`POST`、`PUT`、`runtime` | 站内别名 3 个（@/lib/auth、@/lib/github、@/types/navigation）；外部 next/server |
| `apps/web-overlay/src/app/api/website-metadata/route.ts` | 541 | 网页元数据抓取接口：服务端抓取标题/描述/图标并做 SSRF 校验，供收录表单预填。 | `POST`、`runtime` | 站内别名 3 个（@/lib/auth、@/lib/buffer-utils、@/lib/ssrf-guard）；外部 next/server |
| `apps/web-overlay/src/app/auth/signin/layout.tsx` | 17 | 登录路由段布局：仅声明该段 metadata 并透传 children，避免继承后台导航壳。 | `metadata`、`SignInLayout` | 外部 next |
| `apps/web-overlay/src/app/auth/signin/page.tsx` | 393 | 登录页：账号/Token 登录，失败按 lib/signin-failure 区分「密码错」与「服务坏」。 | `SignInPage` | 站内别名 7 个（@/components/icons、@/components/ui/button、@/components/ui/card…）；外部 lucide-react、next-auth/react、next/link、next/navigation、react |
| `apps/web-overlay/src/app/collections/[slug]/layout.tsx` | 17 | 专题详情路由段布局：声明 metadata（标题模板）与容器。 | `metadata`、`CollectionDetailLayout` | 外部 next |
| `apps/web-overlay/src/app/collections/[slug]/page.tsx` | 176 | 专题详情页：专题内站点分组展示与降级提示。 | `CollectionDetailPage` | 站内别名 9 个（@/components/favorite-button、@/components/footer、@/components/hub-degraded-notice…）；外部 lucide-react、next/link、next/navigation、react |
| `apps/web-overlay/src/app/collections/layout.tsx` | 17 | 专题列表路由段布局：声明 metadata 与页面容器。 | `metadata`、`CollectionsLayout` | 外部 next |
| `apps/web-overlay/src/app/collections/page.tsx` | 123 | 专题列表页：精选合集卡片墙。 | `CollectionsPage` | 站内别名 6 个（@/components/footer、@/components/hub-degraded-notice、@/components/ui/badge…）；外部 lucide-react、next/link、react |
| `apps/web-overlay/src/app/custom/page.tsx` | 77 | 自定义页：用户自定义分类与站点的工作区视图。 | `metadata`、`CustomPage` | 站内别名 4 个（@/components/footer、@/components/modular/modular-canvas-client、@/components/ui/container…）；外部 lucide-react、next、next/link |
| `apps/web-overlay/src/app/error.tsx` | 119 | 路由级错误边界：用 lib/error-report 把异常翻译为可行动说明并给出错误编号。 | `Error` | 站内别名 3 个（@/lib/clipboard、@/lib/error-report、@/registry/new-york/ui/button）；外部 lucide-react、next/link、react |
| `apps/web-overlay/src/app/favorites/layout.tsx` | 17 | 收藏页路由段布局：声明 metadata 与容器。 | `metadata`、`FavoritesLayout` | 外部 next |
| `apps/web-overlay/src/app/favorites/page.tsx` | 686 | 我的收藏页：本地收藏网格、本地筛选、云端同步与批量操作入口。 | `FavoritesPage` | 站内别名 9 个（@/components/favorite-button、@/components/footer、@/components/ui/button…）；外部 lucide-react、next/link、react |
| `apps/web-overlay/src/app/global-error.tsx` | 162 | 根级错误边界：兜住 RootLayout 自身崩溃，输出最小可用的静态恢复页。 | `GlobalError` | 站内别名 1 个（@/lib/error-report） |
| `apps/web-overlay/src/app/graph/page.tsx` | 16 | 技术生态图谱页：力导向图 + 键盘导航 + 详情抽屉。 | `metadata`、`GraphPage` | 站内别名 1 个（@/components/ecosystem-graph）；外部 next |
| `apps/web-overlay/src/app/hot/layout.tsx` | 18 | 热榜路由段布局：声明 metadata 与容器。 | `metadata`、`HotLayout` | 外部 next |
| `apps/web-overlay/src/app/hot/page.tsx` | 237 | 热度榜页：trend/fresh 双榜与时间窗切换。 | `HotPage` | 站内别名 12 个（@/components/density-toggle、@/components/favorite-button、@/components/footer…）；外部 lucide-react、next/link、react |
| `apps/web-overlay/src/app/import/page.tsx` | 20 | 书签导入页：Netscape/OneTab/Markdown 全格式解析、去重与批量入库。 | `metadata`、`ImportPage` | 站内别名 2 个（@/components/bookmark-importer、@/components/footer）；外部 next |
| `apps/web-overlay/src/app/layout.tsx` | 172 | 根布局：全局 metadata/viewport、字体、主题与 Provider 挂载、跳过导航链接与 PWA 注册。 | `generateMetadata`、`viewport`、`RootLayout` | 站内别名 11 个（@/components/offline-banner、@/components/providers、@/components/pwa-register…）；外部 next、next/script |
| `apps/web-overlay/src/app/loading.tsx` | 42 | 全局路由切换骨架屏。 | `Loading` | 站内别名 1 个（@/components/ui/skeleton） |
| `apps/web-overlay/src/app/manifest.ts` | 35 | PWA manifest 路由：名称、图标、主题色与显示模式。 | `manifest` | 外部 next |
| `apps/web-overlay/src/app/not-found.tsx` | 103 | 404 页：按 lib/recovery-links 给出可用的恢复出口而非死路。 | `NotFound` | 站内别名 3 个（@/components/search-palette、@/lib/recovery-links、@/registry/new-york/ui/button）；外部 lucide-react、next/link、next/navigation |
| `apps/web-overlay/src/app/page.tsx` | 61 | 首页（force-dynamic）：经 StorageAdapter 并行读取 navigation.json 与 site.json，SSR 输出 Bento 画布与站点卡片。 | `generateMetadata`、`dynamic`、`async` | 站内别名 5 个（@/components/ScrollToTop、@/components/navigation-content、@/components/ui/container…）；外部 next/types、react |
| `apps/web-overlay/src/app/preferences/layout.tsx` | 17 | 偏好页路由段布局：声明 metadata 与容器。 | `metadata`、`PreferencesLayout` | 外部 next |
| `apps/web-overlay/src/app/preferences/page.tsx` | 252 | 偏好页：主题、密度、强调色、壁纸与个性化画像展示。 | `PreferencesPage` | 站内别名 7 个（@/components/footer、@/components/ui/button、@/components/ui/container…）；外部 lucide-react、next/link、react |
| `apps/web-overlay/src/app/providers.tsx` | 38 | 应用级 Provider 组合：主题、密度、会话、站点信息与预测预取。 | `Providers` | 站内别名 3 个（@/components/offline-banner、@/components/predictive-prefetch-provider、@/components/ui/toaster）；外部 next-auth/react、react |
| `apps/web-overlay/src/app/site/[id]/layout.tsx` | 17 | 站点详情路由段布局：声明 metadata 与容器。 | `metadata`、`SiteDetailLayout` | 外部 next |
| `apps/web-overlay/src/app/site/[id]/page.tsx` | 555 | 站点详情页：元数据、平替雷达、关系图谱、健康状态与实时指标。 | `SiteDetailPage` | 站内别名 10 个（@/components/favorite-button、@/components/footer、@/components/hub-degraded-notice…）；外部 lucide-react、next/link、next/navigation、react |
| `apps/web-overlay/src/app/submit/page.tsx` | 93 | 投稿页：匿名提交站点 URL，服务端富化后进入审核队列。 | `dynamic`、`metadata`、`async` | 站内别名 6 个（@/components/footer、@/components/submission-form、@/components/ui/container…）；外部 lucide-react、next/link、next/types |
| `apps/web-overlay/src/app/tags/[slug]/layout.tsx` | 17 | 标签详情路由段布局：声明 metadata 与容器。 | `metadata`、`TagDetailLayout` | 外部 next |
| `apps/web-overlay/src/app/tags/[slug]/page.tsx` | 148 | 标签详情页：该标签下的站点列表与相关标签。 | `TagDetailPage` | 站内别名 9 个（@/components/favorite-button、@/components/footer、@/components/hub-degraded-notice…）；外部 lucide-react、next/link、next/navigation、react |
| `apps/web-overlay/src/app/tags/layout.tsx` | 17 | 标签云路由段布局：声明 metadata 与容器。 | `metadata`、`TagsLayout` | 外部 next |
| `apps/web-overlay/src/app/tags/page.tsx` | 153 | 标签云页：按热度展示标签并进入标签详情。 | `TagsPage` | 站内别名 7 个（@/components/footer、@/components/hub-degraded-notice、@/components/ui/badge…）；外部 lucide-react、next/link、react |
| `apps/web-overlay/src/app/videos/page.tsx` | 50 | 视频导航页：视频分类与条目浏览。 | `generateMetadata`、`dynamic`、`async` | 站内别名 5 个（@/components/ScrollToTop、@/components/ui/container、@/components/video-content…）；外部 next/types |
| `apps/web-overlay/src/app/videos/player/page.tsx` | 46 | 视频播放页：播放器外壳与相关推荐。 | `generateMetadata`、`dynamic`、`async` | 站内别名 3 个（@/components/video-player-page、@/lib/data-loader、@/lib/github）；外部 next/types |
| `apps/web-overlay/src/components/admin/load-error-notice.tsx` | 50 | 后台加载失败提示：区分网络/鉴权/服务端错误并给重试。 | `LoadErrorNotice` | 站内别名 1 个（@/components/ui/button）；外部 lucide-react |
| `apps/web-overlay/src/components/algorithm-lab.tsx` | 2212 | 算法实验室（2200+ 行）：LinUCB 权重演化、双曲空间、知识图谱、CRDT 与推测意图的交互式演示面板。 | `AlgorithmLab` | 站内别名 14 个（@/components/ui/badge、@/lib/crdt-sync、@/lib/dynamic-tool-synthesizer…）；外部 lucide-react、next/link、react |
| `apps/web-overlay/src/components/architecture-recipe-card.tsx` | 120 | 架构配方卡片：按目标场景展示分层技术选型与替代方案。 | `ArchitectureRecipeCard` | 站内别名 4 个（@/components/ui/badge、@/lib/architecture-recipe、@/lib/clipboard…）；外部 lucide-react、react |
| `apps/web-overlay/src/components/batch-operation-dock.tsx` | 262 | 批量操作坞：多选后底部浮出，支持置顶/移动/删除/Markdown/OneTab 导出。 | `BatchOperationDock` | 站内别名 5 个（@/components/ui/use-toast、@/lib/batch-operations、@/lib/clipboard…）；外部 lucide-react、react |
| `apps/web-overlay/src/components/bookmark-importer.tsx` | 359 | 书签导入器：文件拖拽/粘贴解析、去重预览与批量入库。 | `BookmarkImporter` | 站内别名 3 个（@/components/ui/badge、@/registry/new-york/ui/button、@/registry/new-york/ui/card）；外部 lucide-react、next/link、react |
| `apps/web-overlay/src/components/category-in-situ-controls.tsx` | 149 | 分类原位控制条：重命名、折叠、排序与删除的就地操作。 | `CategoryInSituControls` | 站内别名 4 个（@/components/ui/use-toast、@/lib/modular/use-home-diy、@/lib/utils…）；外部 lucide-react |
| `apps/web-overlay/src/components/density-provider.tsx` | 110 | 内容密度上下文：紧凑/标准/宽松三档并持久化。 | `DensityProvider`、`useDensity`、`ContentDensity` | 外部 react |
| `apps/web-overlay/src/components/density-toggle.tsx` | 91 | 密度切换按钮。 | `DensityToggle` | 站内别名 2 个（@/registry/new-york/ui/button、@/registry/new-york/ui/dropdown-menu）；相对模块 1 个（./density-provider）；外部 lucide-react、react |
| `apps/web-overlay/src/components/ecosystem-graph.tsx` | 660 | 生态图谱力导向可视化：SVG 节点/边、缩放拖拽、键盘漫游与详情抽屉。 | `EcosystemGraph`、`GraphNode`、`GraphEdge` | 站内别名 4 个（@/components/ui/badge、@/components/ui/input、@/lib/graph-nav…）；外部 lucide-react、next/link、react |
| `apps/web-overlay/src/components/favorite-button.tsx` | 39 | 收藏按钮：本地收藏切换与云端同步状态反馈。 | `FavoriteButton` | 站内别名 2 个（@/components/ui/use-toast、@/hooks/useFavorites）；外部 lucide-react |
| `apps/web-overlay/src/components/footer.tsx` | 46 | 页脚：版权、版本与状态入口。 | `Footer` | 站内别名 2 个（@/components/icons、@/types/site）；外部 next/link |
| `apps/web-overlay/src/components/home-diy-toolbar.tsx` | 1309 | 首页 DIY 工具栏（1365 行）：排版模式、强调色、壁纸、毛玻璃、自动整理、撤销重做与分享链接。 | `HomeDIYToolbar` | 站内别名 11 个（@/components/density-provider、@/components/ui/use-toast、@/lib/clipboard…）；外部 lucide-react、react |
| `apps/web-overlay/src/components/home-hero-deck.tsx` | 257 | 首页 Hero 区：时间情境问候、搜索入口与快捷动作卡组。 | `HomeHeroDeck` | 站内别名 5 个（@/components/modular/module-error-boundary、@/components/ui/dialog、@/lib/modular/registry…）；外部 lucide-react、react |
| `apps/web-overlay/src/components/hub-degraded-notice.tsx` | 57 | 中枢降级提示条：明示「服务不可用」而非伪装成空数据。 | `HubDegradedNotice` | 站内别名 2 个（@/lib/degrade、@/registry/new-york/ui/button）；外部 lucide-react |
| `apps/web-overlay/src/components/keyboard-shortcuts-dialog.tsx` | 198 | 快捷键帮助弹窗：/ 搜索、g h 跳转、? 帮助等。 | `KeyboardShortcutsDialog` | 站内别名 4 个（@/components/density-provider、@/components/ui/use-toast、@/lib/modular/use-home-diy…）；外部 lucide-react、react |
| `apps/web-overlay/src/components/modular/modular-canvas-client.tsx` | 20 | 模块画布客户端边界：动态导入画布以避免 SSR 访问 window。 | `ModularCanvasClient` | 外部 lucide-react、next/dynamic |
| `apps/web-overlay/src/components/modular/modular-canvas.tsx` | 565 | Bento 模块画布：网格布局、拖拽排序、缩放、添加/删除与持久化。 | `ModularCanvas` | 站内别名 5 个（@/components/density-toggle、@/lib/modular/registry、@/lib/modular/use-modular-layout…）；相对模块 4 个（./modular-item、./module-library-modal、./template-modal…）；外部 lucide-react、react |
| `apps/web-overlay/src/components/modular/modular-item.tsx` | 467 | 单个模块容器：标题栏、拖拽手柄、尺寸调整、配置与错误边界包裹。 | `ModularItem` | 站内别名 3 个（@/lib/modular/registry、@/registry/new-york/ui/button、@/types/modular）；相对模块 1 个（./module-error-boundary）；外部 lucide-react、react、react-dom |
| `apps/web-overlay/src/components/modular/module-error-boundary.tsx` | 99 | 模块级错误边界：单卡片崩溃不影响整页。 | `ModuleErrorBoundary` | 外部 lucide-react、react |
| `apps/web-overlay/src/components/modular/module-library-modal.tsx` | 192 | 模块库弹窗：按分类浏览并添加内置模块。 | `ModuleLibraryModal` | 站内别名 3 个（@/components/ui/overlay、@/lib/modular/registry、@/registry/new-york/ui/button）；外部 lucide-react、react |
| `apps/web-overlay/src/components/modular/modules/clock-widget.tsx` | 193 | 时钟/番茄钟模块：本地时间与专注倒计时。 | `ClockWidget` | 站内别名 1 个（@/registry/new-york/ui/button）；外部 lucide-react、react |
| `apps/web-overlay/src/components/modular/modules/custom-category-widget.tsx` | 123 | 自定义分类模块：把某个自定义分类的站点平铺为卡片。 | `CustomCategoryWidget` | 外部 lucide-react、react |
| `apps/web-overlay/src/components/modular/modules/favorites-dock-widget.tsx` | 64 | 收藏停靠模块：快速访问本地收藏。 | `FavoritesDockWidget` | 站内别名 1 个（@/hooks/useFavorites）；外部 lucide-react、next/link |
| `apps/web-overlay/src/components/modular/modules/github-heatmap-widget.tsx` | 231 | GitHub 贡献热力图模块：按用户名拉取贡献日历并渲染。 | `GithubHeatmapWidget` | 站内别名 1 个（@/registry/new-york/ui/button）；外部 lucide-react、react |
| `apps/web-overlay/src/components/modular/modules/hyperbolic-radar-widget.tsx` | 78 | 双曲平替雷达模块：展示当前站点的近邻平替。 | `HyperbolicRadarWidget` | 外部 lucide-react、next/link、react |
| `apps/web-overlay/src/components/modular/modules/iframe-widget.tsx` | 134 | 内嵌网页模块：可配置 URL 的 iframe 卡片（含安全限制）。 | `IframeWidget` | 站内别名 1 个（@/registry/new-york/ui/button）；外部 lucide-react、react |
| `apps/web-overlay/src/components/modular/modules/live-api-widget.tsx` | 179 | 动态 API 遥测模块：任意 REST URL + JSONPath 取值 + 轮询周期。 | `LiveApiWidget` | 站内别名 1 个（@/registry/new-york/ui/button）；外部 lucide-react、react |
| `apps/web-overlay/src/components/modular/modules/metrics-widget.tsx` | 118 | 系统指标模块：中枢健康、站点数与请求指标。 | `MetricsWidget` | 站内别名 1 个（@/lib/hub-health）；外部 lucide-react、react |
| `apps/web-overlay/src/components/modular/modules/notes-widget.tsx` | 237 | 便签模块：本地 Markdown 便签与自动保存。 | `NotesWidget` | 站内别名 1 个（@/lib/clipboard）；外部 lucide-react、react |
| `apps/web-overlay/src/components/modular/modules/quick-search-widget.tsx` | 106 | 快捷搜索模块：内嵌搜索框直达检索面板。 | `QuickSearchWidget` | 外部 lucide-react、react |
| `apps/web-overlay/src/components/modular/modules/quick-tools-widget.tsx` | 219 | 极客工具箱模块：UUID、时间戳、Base64、哈希等端侧微工具。 | `QuickToolsWidget` | 站内别名 2 个（@/lib/clipboard、@/registry/new-york/ui/button）；外部 lucide-react、react |
| `apps/web-overlay/src/components/modular/modules/rss-feed-widget.tsx` | 144 | 技术资讯模块：框架 Release/社区动态流，支持换一批。 | `RssFeedWidget` | 站内别名 1 个（@/registry/new-york/ui/button）；外部 lucide-react、react |
| `apps/web-overlay/src/components/modular/modules/speculative-terminal-widget.tsx` | 87 | 推测意图终端模块：输入即解析 Cron/JWT/Base64 等并原地展示。 | `SpeculativeTerminalWidget` | 外部 lucide-react、react |
| `apps/web-overlay/src/components/modular/modules/trending-widget.tsx` | 146 | 热榜模块：trend/fresh 榜单前 N 条。 | `TrendingWidget` | 站内别名 2 个（@/lib/navhub-api、@/lib/safe-url）；外部 lucide-react、next/link、react |
| `apps/web-overlay/src/components/modular/modules/weather-widget.tsx` | 249 | 天气模块：按城市拉取当前天气与预报。 | `WeatherWidget` | 外部 lucide-react、react |
| `apps/web-overlay/src/components/modular/template-modal.tsx` | 84 | 模板选择弹窗：一键套用预设工作台布局。 | `TemplateModal` | 站内别名 3 个（@/components/ui/overlay、@/lib/modular/registry、@/registry/new-york/ui/button）；外部 lucide-react |
| `apps/web-overlay/src/components/modular/widget-config-modal.tsx` | 198 | 模块配置弹窗：按 configSchema 动态渲染表单。 | `WidgetConfigModal` | 站内别名 4 个（@/components/ui/overlay、@/lib/modular/registry、@/registry/new-york/ui/button…）；外部 lucide-react、react |
| `apps/web-overlay/src/components/nav-icon.tsx` | 63 | 导航图标渲染器：名称→Lucide 组件的按需映射，避免整包导入。 | `NavIcon` | 站内别名 1 个（@/lib/nav-icons）；外部 lucide-react、react |
| `apps/web-overlay/src/components/navigation-card.tsx` | 572 | 站点卡片：图标、标题、描述、徽标、平替/关系入口与快捷动作。 | `NavigationCard` | 站内别名 12 个（@/components/favorite-button、@/components/site-favicon、@/components/ui/tooltip…）；外部 lucide-react、next/link |
| `apps/web-overlay/src/components/navigation-content.tsx` | 1212 | 首页主体（1200+ 行）：Bento 画布、分类分组、拖拽重归类、搜索面板联动与 DIY 状态编排。 | `NavigationContent` | 站内别名 25 个（@/components/batch-operation-dock、@/components/category-in-situ-controls、@/components/density-toggle…）；外部 lucide-react、next/dynamic、next/link、react |
| `apps/web-overlay/src/components/offline-banner.tsx` | 107 | 离线提示条：按 lib/offline-banner 判定显示时机与如实文案。 | `OfflineBanner` | 站内别名 1 个（@/lib/offline-banner）；外部 lucide-react、react |
| `apps/web-overlay/src/components/predictive-prefetch-provider.tsx` | 127 | 预测预取 Provider：全局监听指针轨迹并触发 DNS/TCP 预热与预渲染。 | `PredictivePrefetchProvider` | 站内别名 1 个（@/lib/prefetch）；外部 react |
| `apps/web-overlay/src/components/providers.tsx` | 25 | 组件层 Provider 组合（主题/密度/站点信息）。 | `Providers` | 站内别名 2 个（@/components/density-provider、@/components/ui/tooltip）；外部 swr |
| `apps/web-overlay/src/components/pwa-register.tsx` | 117 | Service Worker 注册与更新提示。 | `PwaRegister` | 外部 react |
| `apps/web-overlay/src/components/quick-tools-drawer.tsx` | 581 | 微工具抽屉：时间戳、编码、哈希、JSON 等端侧工具的聚合面板。 | `QuickToolsDrawer` | 站内别名 5 个（@/components/ui/dialog、@/components/ui/input、@/lib/clipboard…）；外部 lucide-react、react |
| `apps/web-overlay/src/components/search-bar.tsx` | 274 | 顶部搜索框：输入防抖、快捷键、候选与结果高亮。 | `SearchBar` | 站内别名 7 个（@/lib/highlight、@/lib/safe-url、@/registry/new-york/ui/button…）；外部 lucide-react、react |
| `apps/web-overlay/src/components/search-palette.tsx` | 746 | 命令面板（750 行）：⌘K 检索、键盘导航、分组结果、投机意图/对比/配方卡片与降级提示。 | `SearchPalette` | 站内别名 18 个（@/components/architecture-recipe-card、@/components/site-favicon、@/components/speculative-intent-card…）；外部 lucide-react、next/link、react |
| `apps/web-overlay/src/components/sidebar.tsx` | 187 | 侧边栏：分类导航、计数徽标、折叠与图标。 | `Sidebar` | 站内别名 8 个（@/components/nav-icon、@/lib/motion、@/lib/nav-icons…）；外部 lucide-react、next/image、next/link、react |
| `apps/web-overlay/src/components/site-favicon.tsx` | 256 | 站点图标：本地 logo 映射 → 远程 favicon → 确定性渐变首字母兜底。 | `fnv1aHash`、`getDeterministicGradient`、`extractFaviconMonogram`、`resolveSiteIcon`、`SiteFavicon`、`PRESET_GRADIENTS`、`LOCAL_LOGO_MAP`、`SiteFaviconProps` | 外部 react |
| `apps/web-overlay/src/components/site-peek-dialog.tsx` | 375 | 站点速览弹窗：不离开页面预览站点信息、关系与快捷操作。 | `SitePeekDialog` | 站内别名 8 个（@/components/site-favicon、@/components/ui/badge、@/components/ui/dialog…）；外部 lucide-react、react |
| `apps/web-overlay/src/components/speculative-intent-card.tsx` | 115 | 推测意图结果卡：渲染 Cron/JWT/哈希等原地计算结果。 | `SpeculativeIntentCard` | 站内别名 3 个（@/lib/clipboard、@/lib/speculative、@/registry/new-york/ui/button）；外部 lucide-react、react |
| `apps/web-overlay/src/components/speculative-prerender.tsx` | 163 | 推测预渲染管理器：把候选 URL 编译为 Speculation Rules 并注入。 | `SpeculativePrerenderManager`、`SpeculationCandidate` | 外部 react |
| `apps/web-overlay/src/components/submission-form.tsx` | 293 | 投稿表单：URL 校验、元数据预填与提交反馈。 | `SubmissionForm` | 站内别名 9 个（@/registry/new-york/ui/alert、@/registry/new-york/ui/button、@/registry/new-york/ui/card…）；外部 lucide-react、react |
| `apps/web-overlay/src/components/tech-comparison-card.tsx` | 121 | 技术对比卡：多维并排矩阵（生态/性能/学习曲线等）。 | `TechComparisonCard` | 站内别名 3 个（@/components/ui/badge、@/lib/comparison、@/registry/new-york/ui/button）；外部 lucide-react、react |
| `apps/web-overlay/src/components/ui/container.tsx` | 39 | 布局容器原子组件：统一最大宽度与水平内边距。 | `Container` | 站内别名 1 个（@/lib/utils） |
| `apps/web-overlay/src/components/ui/dialog.tsx` | 122 | 对话框原子组件（Radix 封装）：焦点陷阱、Esc 关闭与动画。 | — | 站内别名 1 个（@/lib/utils）；外部 @radix-ui/react-dialog、lucide-react、react |
| `apps/web-overlay/src/components/ui/overlay.tsx` | 195 | 浮层行为 hook：滚动锁定、焦点归还、Esc 与点击外部关闭。 | `useOverlayBehavior`、`OverlayBehaviorOptions`、`OverlayBehavior` | 外部 react |
| `apps/web-overlay/src/components/video-card.tsx` | 204 | 视频卡片：封面、时长、来源与播放入口。 | `VideoCard` | 站内别名 3 个（@/components/ui/dialog、@/types/navigation、@/types/site）；外部 lucide-react、next/image、react |
| `apps/web-overlay/src/components/video-content.tsx` | 233 | 视频页主体：分类切换、网格/列表视图与空态。 | `VideoContent` | 站内别名 11 个（@/components/density-toggle、@/components/footer、@/components/mode-toggle…）；外部 lucide-react、next/link、react |
| `apps/web-overlay/src/components/video-player-page.tsx` | 322 | 播放页主体：播放器、信息区与相关推荐。 | `VideoPlayerPage` | 站内别名 6 个（@/components/mode-toggle、@/lib/utils、@/registry/new-york/ui/button…）；外部 lucide-react、next/link、react |
| `apps/web-overlay/src/components/view-mode-toggle.tsx` | 112 | 视图模式切换（网格/列表/紧凑）。 | `ViewModeToggle` | 站内别名 3 个（@/lib/modular/use-home-diy、@/registry/new-york/ui/button、@/registry/new-york/ui/dropdown-menu）；外部 lucide-react、react |
| `apps/web-overlay/src/components/workspace-filter.tsx` | 87 | 工作区情境筛选：按当前时段给出推荐工作区。 | `WorkspaceFilter`、`WORKSPACES`、`WorkspaceId` | 站内别名 1 个（@/lib/daypart）；外部 lucide-react、react |
| `apps/web-overlay/src/hooks/useFavorites.ts` | 279 | 收藏 hook：本地存储读写、乐观更新、云端同步与冲突处理。 | `useFavorites`、`syncFavoritesToCloud`、`LocalFavorite`、`FavoritesApi`、`CloudSyncResult` | 站内别名 4 个（@/lib/degrade、@/lib/favorites-storage、@/lib/identity…）；外部 react |
| `apps/web-overlay/src/lib/admin-guard.ts` | 52 | 管理员守卫：服务端校验会话与角色，返回统一 AdminGuardResult。 | `requireAdmin`、`AdminGuardResult` | 站内别名 1 个（@/lib/auth） |
| `apps/web-overlay/src/lib/admin-load-failure.ts` | 87 | 后台列表加载失败的说明文案。 真实缺陷（`app/admin/collections`、`categories`、`tags` 三页都中过）： void hubGet<Row[]>('/api/collections?all=1') .then((data) => setCols(Array.isArray(data) ? data : [])) .catch(() => setCols([])) // ← 网络 / 401 / 500 … | `classifyLoadFailure`、`describeLoadFailure`、`emptyStateText`、`LOAD_FAILURE_EMPTY_HINT`、`LoadFailureKind` | — |
| `apps/web-overlay/src/lib/architecture-recipe.ts` | 263 | 浏览器端技术栈链路配方适配器 (Browser-side Architecture Recipe Adapter) | `findMatchingArchitectureRecipe`、`PRESET_RECIPES`、`StackLayer`、`ArchitectureRecipe` | — |
| `apps/web-overlay/src/lib/auth.config.ts` | 108 | next-auth 配置：凭据/会话策略、管理员身份判定与密钥解析。 | `isAdminIdentity`、`authSecret`、`authConfig` | 外部 next-auth |
| `apps/web-overlay/src/lib/auth.ts` | 211 | 服务端鉴权工具：读取 GitHub Token、校验管理员会话、hasGithubAuth 与 auth() 包装。 | `getServerGithubToken`、`verifyAdminSession`、`hasGithubAuth`、`auth` | 相对模块 1 个（./auth.config）；外部 next-auth、next-auth/providers/credentials、next-auth/providers/github |
| `apps/web-overlay/src/lib/batch-operations.ts` | 173 | 多选批量操作纯算法引擎 (Multi-Selection Batch Operations Engine) 纯算法实现，0 DOM 依赖，跨 Node.js 和浏览器通用。 | `batchSetPinnedSitesInCategory`、`batchMoveSitesBetweenCustomCategories`、`batchDeleteSitesFromCustomCategories`、`batchExportSitesToMarkdown`、`batchExportSitesToOneTab`、`BatchSiteItem`、`BatchCategoryHolder` | — |
| `apps/web-overlay/src/lib/clipboard.ts` | 88 | 复制到剪贴板：**报喜之前必须先确认真的成功**。 真实缺陷：三处直接把写入丢出去，然后无条件宣告「已复制」： void navigator.clipboard.writeText(url) toast({ title: '🔗 已复制免登专属分享链接！' }) 但剪贴板写入**经常失败，而且悄悄失败**： - 非安全上下文（http:// 局域网 IP）或浏览器不支持时， `navigator.clipboard` 根本不存在，取 `.w… | `clipboardSupported`、`copyText`、`copyFailureToast`、`CLIPBOARD_EMPTY`、`CLIPBOARD_UNSUPPORTED`、`CLIPBOARD_DENIED`、`CopyResult` | — |
| `apps/web-overlay/src/lib/comparison.ts` | 230 | 浏览器端竞品对比矩阵适配器 (Browser-side Comparison Adapter) | `parseTechComparisonQuery`、`COMPARISON_KNOWLEDGE_BASE`、`ComparisonDimension`、`TechComparisonSpec`、`TechComparisonMatrix` | — |
| `apps/web-overlay/src/lib/crdt-sync.ts` | 454 | 本地优先零冲突原子操作日志型 CRDT 协同漫游引擎 (Local-First Op-Log CRDT Engine) 纯算法实现，0 DOM 依赖，跨 Node.js 和浏览器通用。 基于 Last-Write-Wins (LWW) 与因果收敛模型，支持多设备离线编辑、无损合流与日志压缩。 | `createCRDTOperation`、`mergeOperationLogs`、`reduceOperationsToState`、`compactOperationLog`、`compareVectorClocks`、`CrdtStore`、`compactOperationLogs`、`CRDTOpType`… | — |
| `apps/web-overlay/src/lib/daypart.ts` | 45 | 「现在几点」→ 一句工作区情境提示。 为什么单独抽成纯模块（真实缺陷）： WorkspaceFilter 原来在渲染体里直接 `const hour = new Date().getHours()` 算提示文案，而首页是服务端渲染的（app/page.tsx 静态 import NavigationContent）。 服务端多半跑在 UTC（CI 与容器都是），用户却在自己的时区：同一个瞬间两边的 小时数可能差好几个钟头。… | `describeDaypart`、`daypartText`、`DAYPART_PLACEHOLDER`、`DaypartHint` | — |
| `apps/web-overlay/src/lib/degrade.ts` | 92 | 降级提示：把「中枢请求失败」翻译成**用户能据此行动**的一句话。 背景是真实的用户痛点。中枢客户端的降级原则（见 navhub-api.ts 顶部注释）是 「任何网络失败都返回可用的空结果」——这对首页首屏是对的，但落到 /hot、/tags、 /collections、/site/[id] 这些**以数据为主体**的页面就变成了误导： - 站点详情页把「中枢连不上」渲染成「站点不存在或已被收录源清理」 - 专题详情页把「中枢连不上」渲… | `errorStatus`、`isNotFound`、`isAbort`、`describeDegrade`、`DegradedHandler`、`DegradeNotice` | — |
| `apps/web-overlay/src/lib/diy-share-link.ts` | 75 | `#diy=` 免登分享链接的编码。 为什么单独抽成一个纯模块：编码失败的原因（循环引用、BigInt、落单的代理项） 都必须能复现、能断言；而调用它的 useCallback 在 node 环境跑不起来 （仓库的 vitest 没有 jsdom，也没装 @testing-library/react）。 抽出来之后成功与失败两条路都能拿真实输入测。 关键约定：失败**不返回空串**。… | `encodeShareLink`、`describeShareLinkFailure`、`SHARE_LINK_MAX_BYTES`、`ShareLinkBase`、`ShareLinkOutcome` | — |
| `apps/web-overlay/src/lib/dynamic-tool-synthesizer.ts` | 444 | 动态工具合成器与安全执行沙箱 (Dynamic WebMCP Tool Synthesizer & Guarded Executor) 核心设计目标： 1. 自动化接口工具化 (API-to-Tool Synthesis)：将 OpenAPI / REST 端点规格实时合成为标准 WebMCP 工具 2. 站点检索动作工具化 (Site Action Synthesis)：将站点搜索引擎、聚合 API 动态注册为 AI Agent 可调用… | `isSafeUrl`、`createGuardedApiExecutor`、`synthesizeRestTool`、`synthesizeSiteSearchTool`、`parseOpenApiToSpecs`、`SynthesizedToolDefinition`、`SynthesizedToolHandler`、`GuardOptions`… | — |
| `apps/web-overlay/src/lib/error-report.ts` | 135 | 崩溃页面的「翻译层」：把异常翻译成用户能据此行动的一句话。 背景（真实用户痛点）：之前的 `app/error.tsx` 把 `error.message` 直接当成 正文展示——生产环境里那通常是 `Minified React error #418`、`ChunkLoadError` 这类英文内部信息。… | `classifyCrash`、`describeCrash`、`crashReportText`、`CrashKind`、`CrashInfo` | — |
| `apps/web-overlay/src/lib/favorites-filter.ts` | 69 | 「我的收藏」页面的本地筛选。 真实痛点：收藏页把 localStorage 里的收藏**一次性全部铺开**，没有任何筛选或搜索。 收藏十几个还看得过来，攒到几十上百个（导航站的收藏增长很快）之后， 想找某一个只能靠眼睛在网格里扫 —— 而这一页恰恰是"只想快速点开某个站"的场景。 为什么不做成全局搜索：全局检索走中枢（可能降级、要联网）；而收藏就在本地， 已经全部在内存里了。… | `parseFavoriteQuery`、`matchesFavoriteQuery`、`filterFavorites`、`describeFavoritesFilter`、`favoriteFilterEmptyMessage`、`FilterableFavorite` | — |
| `apps/web-overlay/src/lib/favorites-storage.ts` | 58 | 收藏列表的本地读写规则：**「读不出来」和「没有数据」是两件事**。 真实缺陷（`hooks/useFavorites.ts` 与 `lib/modular/workbench-bridge.ts` 都中过同一个坑）： const parsed = JSON.parse(raw) return Array.isArray(parsed) ? parsed : [] // ← 读失败 = 空收藏 这个「空」随后会参与写入（`unshift`… | `parseFavorites`、`corruptBackupKey`、`describeCorruptFavorites`、`FAVORITES_STORAGE_KEY`、`FavoritesParseResult` | — |
| `apps/web-overlay/src/lib/federated-recommendation.ts` | 133 | 客户端联邦协同与本地差分隐私推荐引擎 (Federated Recommendation & Local Differential Privacy) 核心设计目标： 1. 本地差分隐私 (Local Differential Privacy, LDP)：在客户端对用户的标签偏好注入 Laplace 噪声 2. 保证个体隐私不可重构的同时，在无中心化数据库收集用户历史的前提下实现群体协同推荐 3. 混合打分机制：结合私有本地偏好与脱敏群体共… | `sampleLaplace`、`privatizeVector`、`aggregatePrivatizedContributions`、`computeCosineSimilarity`、`rankItemsWithPrivacy`、`CandidateItem`、`RecommendationResult` | — |
| `apps/web-overlay/src/lib/github.ts` | 284 | 存储层门面 —— 保持 NavSphere 原有的两个函数签名，内部改走 StorageAdapter。 为什么用「替换实现」而不是「改调用点」： NavSphere 全站有 16 个 route 文件、约 69 处调用，都只通过这两个函数读写数据。 保持签名不变，就等于**一行调用点都不用改**，后台（增删改查、拖拽排序、 投稿审核、数据导入导出）整体切换到了真实数据库 —— 这是本次改造能低成本落地的根本原因。… | `invalidateContentCache`、`getFileContent`、`commitFile`、`currentAdapterKind` | 站内别名 6 个（@/lib/auth、@/lib/storage-adapter、@/navsphere/content/navigation.json…） |
| `apps/web-overlay/src/lib/graph-nav.ts` | 129 | 生态图谱的键盘导航：**几何关系放在纯函数里算**，组件只负责搬焦点。 真实缺陷（components/ecosystem-graph.tsx）：节点是一个只有 `onClick` 的 SVG `<g>` <g transform={...} className="cursor-pointer" onClick={() => setSelectedNode(n)}> —— 不可聚焦、不能回车、方向键无效。… | `directionFromKey`、`isActivationKey`、`nextNodeInDirection`、`rovingNodeId`、`nodeAccessibleName`、`GraphPoint`、`GraphDirection` | — |
| `apps/web-overlay/src/lib/highlight.ts` | 58 | 搜索结果关键词高亮（纯函数，无 React 依赖）。 与上游 search-bar 的 highlightText 的区别： - 上游把 query **原样**塞进 `new RegExp(query)` —— 查询含 `+` `(` `.` `[` 等 正则元字符会直接抛异常（高亮失败会连带结果渲染崩溃）或产生误匹配。 这里对每个 token 单独转义后再组装。… | `highlightParts`、`HighlightSegment` | — |
| `apps/web-overlay/src/lib/hub-health.ts` | 96 | 中枢健康探测的「如实展示」判定（纯函数，便于单测）。 背景是真实缺陷：仪表盘的引擎监控小卡在健康探测失败时仍然显示 「中枢在线」的绿色呼吸灯，并且用 `stats?.sites ?? 50` 把站点数**编**成 50。 故障时给出虚假的绿色信号 + 虚假数字，比不给数据更有害：用户会据此判断 「系统正常」，从而不去排查。 这里的规则：拿不到的数据一律说「未知」，绝不填默认值； 探活失败就说离线，不再点亮任何「正常」指示。 | `describeHealth`、`HubHealthLike`、`HealthTone`、`HealthStatus` | — |
| `apps/web-overlay/src/lib/hub-proxy.ts` | 146 | `/api/hub/*` 反向代理的纯逻辑。 与 `app/api/hub/[...path]/route.ts` 分开的原因：路由文件 import 了 `@/lib/auth` （next-auth），在单测里拉起整套鉴权栈既慢又脆。… | `upstreamTimeoutMs`、`createDeadline`、`isStreamingContentType`、`isTextContentType`、`isNullBodyStatus`、`sanitizeForwardedFor`、`pickResponseHeaders`、`FORWARD_REQUEST_HEADERS`… | — |
| `apps/web-overlay/src/lib/identity-signature.ts` | 60 | 代理侧：为终端用户身份附加 HMAC 签名。 对应中枢的 `apps/api/src/identity-signature.ts`。身份（`userId` / `anonId`） 此前是纯字符串、可任意自称，中枢配置 `NAVHUB_IDENTITY_SECRET` 后会要求 `x-navhub-identity-signature = HMAC-SHA256(secret, identity)`；本模块负责在 转发前算好这个头。… | `hubIdentitySecret`、`identityFromRequest`、`signIdentity` | — |
| `apps/web-overlay/src/lib/identity.ts` | 55 | 终端用户身份：匿名 ID 生成/持久化与身份切换。 | `getAnonId`、`getIdentity`、`setIdentity` | — |
| `apps/web-overlay/src/lib/knowledge-graph.ts` | 274 | 浏览器端技术知识图谱与路径寻路适配器 (Client-side Knowledge Graph & Tech Pathfinding) | `findShortestTechPath`、`analyzeStackCompatibility`、`PRESET_TECH_GRAPH`、`GraphNode`、`GraphEdge`、`KnowledgeGraphData`、`PathStep`、`TechPathResult`… | — |
| `apps/web-overlay/src/lib/latest-request.ts` | 86 | 「只认最后一次请求」的闸门。 为什么需要（这一类失败长什么样）： 管理端这些列表/详情都是「点一下 → 发一次请求 → 结果整块覆盖界面」。 请求是并发的，而网络不保证先来后到：**先发的慢请求后到，就会把后发的 （用户真正想看的那次）结果覆盖掉**。… | `newRequestGate`、`settleLatest`、`RequestGate`、`LatestOutcome` | — |
| `apps/web-overlay/src/lib/modular/diy-presets.ts` | 768 | 首页次世代 DIY 可视化排版与分类编排纯算法 (Web 客户端运行时) | `sortCategoriesWithOverrides`、`shiftCategoryOrder`、`reorderCategoryToTarget`、`sortCategoryItemsWithPinned`、`togglePinnedSiteInCategory`、`computeAdaptiveSiteRanking`、`evaluateLayoutErgonomics`、`mergeDIYLayoutConfigs`… | — |
| `apps/web-overlay/src/lib/modular/layout-sync.ts` | 355 | 布局多端同步（Web 客户端运行时） 本文件是 packages/core/src/layout-sync.ts 的浏览器镜像 + 传输层， 沿用本仓既有约定：纯算法在 core（可单测），前端保留一份运行时副本 （原因：apps/web 不依赖 @navhub/core，无法直接 import）。 两份逻辑必须保持一致，改动请同步。… | `slotKey`、`nextLamport`、`bumpClocks`、`diffChangedSlots`、`mergeLayoutSlots`、`readSlotClocks`、`writeSlotClocks`、`getLayoutClientId`… | — |
| `apps/web-overlay/src/lib/modular/registry.ts` | 378 | 模块注册表：15 个内置模块的元数据（尺寸约束/分类/配置 schema）与组件映射，以及预设模板。 | `createWidgetInstance`、`WIDGET_REGISTRY`、`PRESET_TEMPLATES` | 站内别名 16 个（@/components/modular/modules/clock-widget、@/components/modular/modules/custom-category-widget、@/components/modular/modules/favorites-dock-widget…）；外部 react |
| `apps/web-overlay/src/lib/modular/sanitize.ts` | 36 | 模块实例净化（纯函数，无依赖）。 为什么需要：本地存储 / 导入的 JSON 可能含有**已失效的模块类型** （旧版本导出、注册表改名、手写文件）。这类实例在 UI 上会变成 "删不掉的僵尸卡片"——组件查不到定义，连删除入口都渲染不出来。 加载与导入两条路径都必须先净化再入 state。… | `sanitizeWidgetInstances`、`SanitizableWidget` | — |
| `apps/web-overlay/src/lib/modular/use-home-diy.ts` | 1212 | 首页 DIY 状态机（1212 行）：共享快照订阅、布局提交/撤销/重做、多端合并、存储失败分类与损坏备份。 | `subscribeHomeDiy`、`getHomeDiySnapshot`、`resetHomeDiySharedState`、`safeLocalStorage`、`classifyHomeDiyStorageFailure`、`describeHomeDiyStorageFailure`、`commitHomeDiyConfig`、`undoHomeDiy`… | 站内别名 6 个（@/lib/diy-share-link、@/lib/identity、@/lib/modular/diy-presets…）；外部 react |
| `apps/web-overlay/src/lib/modular/use-modular-layout.ts` | 576 | 模块画布布局 hook：面板/模块增删改排、持久化与损坏恢复。 | `useModularLayout`、`STORAGE_KEY`、`Board` | 站内别名 1 个（@/types/modular）；相对模块 3 个（./registry、./sanitize、./workspace-storage）；外部 react |
| `apps/web-overlay/src/lib/modular/workbench-bridge.ts` | 116 | 工作台桥：把站点「钉」到工作台（写入布局存储），并判断是否已钉。 | `isSitePinnedToWorkbench`、`pinSiteToWorkbench`、`PinSitePayload` | 相对模块 2 个（./use-modular-layout、./registry） |
| `apps/web-overlay/src/lib/modular/workspace-storage.ts` | 39 | 工作台布局的本地存储接缝。 为什么单独成模块：`use-modular-layout` 在 JSON.parse 失败时只 `console.warn` 后回退默认模板，紧接着的自动持久化副作用会把默认模板**写回同一个 key** —— 用户被截断/污染的布局就此静默丢失，事后无现场可查。 这里把「备份现场 + 抑制首次自动写盘」抽成可回归测试的纯函数。 | `corruptBackupKey`、`backupCorruptPayload`、`StorageWriter` | — |
| `apps/web-overlay/src/lib/motion.ts` | 48 | 「减弱动态效果」偏好的读取口。 CSS 侧由 styles/reduced-motion.css 覆盖绝大多数动效；但**JS 显式传参的滚动** 是 CSS 管不到的：`el.scrollIntoView({ behavior: 'smooth' })` 里的 behavior 会压过样式表里的 `scroll-behavior`。侧边栏跳分类、键盘导航跟随时都会调用它， 对要求减弱动态效果的用户来说，那是一段无法关掉的滚动动画。… | `prefersReducedMotion`、`preferredScrollBehavior`、`REDUCED_MOTION_QUERY`、`MotionQueryMatcher` | — |
| `apps/web-overlay/src/lib/nav-icons.ts` | 158 | 侧边栏分类图标的**名字 → 组件**映射。 起因是一个真实的体积问题：`components/sidebar.tsx` 用了 import * as LucideIcons from 'lucide-react' const Icon = LucideIcons[iconName] \|\| LucideIcons.Folder 命名空间导入让打包器**无法 tree-shaking** —— `/videos` 的路由包里因此多出 两个整… | `resolveNavIcon`、`isIconUrl`、`NAV_ICON_FALLBACK`、`NAV_ICONS` | 外部 lucide-react |
| `apps/web-overlay/src/lib/navhub-api.ts` | 542 | NavHub 中枢 API 客户端（浏览器侧）。 与首页的 StorageAdapter 读路径分工： - 首页导航数据（navigation.json）仍走服务端 getFileContent（SSR，零延迟） - 搜索 / 收藏 / 标签 / 榜单 / 事件走这里的 REST 客户端（CSR，按需加载） 走**同源相对路径** /api/hub/*：由 next.config.js 的 rewrite 代理到中枢， 因此没有 CORS… | `getApiToken`、`setApiToken`、`searchSites`、`reportClick`、`fetchTags`、`fetchTrending`、`fetchNewSites`、`fetchSite`… | 相对模块 1 个（./degrade） |
| `apps/web-overlay/src/lib/offline-banner.ts` | 51 | 网络状态提示的文案与可见性判定（纯函数，可单测）。 背景（真实缺陷，两处）： 1. `components/offline-banner.tsx` 早就写好了，但**从未被挂载** —— 用户离线时页面只会静默降级（现在至少会显示「无法连接中枢」）， 却没有任何地方告诉他「是你的网络断了，不是站点没数据」；… | `describeOfflineBanner`、`RECONNECTED_NOTICE_MS`、`NetworkTone`、`OfflineBannerState` | — |
| `apps/web-overlay/src/lib/prefetch.ts` | 181 | 预测性鼠标轨迹预取与 0-RTT 物理瞬开引擎 (Predictive Trajectory Prefetching Engine) 核心设计目标： 突破浏览器传统的“按下点击后才开始建立连接”物理延迟瓶颈（DNS+TLS+TTFB 常见 300~500ms）。 通过监听光标轨迹矢量的加速度与朝向夹角， 在光标逼近卡片 150 毫秒前触发 DNS 预解析与 TCP/TLS 预连接，实现物理级 0 延迟秒开。 | `calculateMotionVector`、`isHeadingTowardsRect`、`extractSafeOrigin`、`shouldPreconnectOrigin`、`determinePrefetchStrategy`、`KalmanFilter2D`、`Point`、`RectBounds`… | — |
| `apps/web-overlay/src/lib/profile-view.ts` | 66 | 「我的偏好」的三态判定：**取回失败 ≠ 没有画像**。 真实缺陷：页面原本把请求失败和「真的没有画像」渲染成同一句话 —— 中枢连不上时，用户看到的是 「暂无个性化画像。搜索并收藏几个站点后，这里会显示系统推断出的偏好。」 这是一句**站不住的事实陈述**：我们并不知道他有没有画像，我们只是没取到。 用户会照着自己的数据没被记录去理解，而不是「服务暂时不可用」。… | `profileViewState`、`profileDegradeNotice`、`PROFILE_EMPTY_MESSAGE`、`ProfileViewState`、`ProfileViewInput`、`ProfileDegradeNotice` | 相对模块 1 个（./degrade） |
| `apps/web-overlay/src/lib/recovery-links.ts` | 34 | 恢复路径（单一来源）。 「找不到页面」是导航站最高频的失败面：外链失效、收藏里存了旧 id、 手输路径打错一个字。此时用户最需要的是**立刻找到正确的东西**， 而不是一句「页面未找到」+ 一个返回首页。 这些出口同时被 404 页使用；集中在这里的好处是可测： 每条 href 都能对着 overlay 的真实路由表校验（见 test/not-found.test.ts）， 避免「恢复路径本身是死链」这种最讽刺的回归。 | `RECOVERY_LINKS`、`RecoveryIcon`、`RecoveryLink` | — |
| `apps/web-overlay/src/lib/safe-url.ts` | 46 | 渲染期 URL 安全化。 站点 URL 可由匿名投稿写入（`/api/submissions`），若存成 `javascript:alert(1)` 或 `data:text/html,...`，前台 `<a href={site.url}>` 就会变成可点击的 XSS 载体 （服务端已用 httpUrl schema 收紧入库，这里是纵深防御：历史脏数据同样要挡住）。… | `isSafeHttpUrl`、`safeHref`、`safeSrc` | — |
| `apps/web-overlay/src/lib/search-panel.ts` | 79 | 搜索面板「什么都没显示」时到底该说什么 —— 单一判定点（纯函数，可单测）。 组件头部注释写着的契约是「中枢不可用时明示降级，而不是假装『没有结果』」， 但原实现同时踩了三个坑： 1. **自相矛盾**：零结果时把「检索服务暂时不可用」横幅和 「未找到与 “x” 相关的导航」一起渲染。用户无法判断是故障还是真没有， 只能反复换词白试。 2. **死路**：零结果区块只依赖服务端返回的 suggestions / popular 兜底。… | `planSearchPanel`、`SearchPanelActionKind`、`SearchPanelAction`、`SearchPanelMode`、`SearchPanelPlan`、`SearchPanelInput` | — |
| `apps/web-overlay/src/lib/selection.ts` | 72 | 卡片多选（批量操作）的选中状态：纯函数，可单测。 为什么需要它：`components/batch-operation-dock.tsx`（底部批量操作坞）与 `lib/batch-operations.ts`（批量导出 / 置顶 / 移动 / 删除）**写好很久了但从未被挂载** —— 全仓没有任何地方渲染这个坞，也没有任何选中状态，于是它是一段死代码， 而用户对「一次处理多个站点」的需求（导出到 OneTab / 复制成 Markdo… | `toggleSelected`、`isSelected`、`selectAllIds`、`clearSelected`、`pruneSelected`、`summarizeSelection`、`pickSelectedSites` | 站内别名 1 个（@/lib/batch-operations） |
| `apps/web-overlay/src/lib/session.ts` | 12 | 上游遗留文件，覆盖为空模块。 原因：上游 `src/lib/session.ts` 依赖 iron-session，而 iron-session 在本仓 从未真正使用（全仓无 import，已作为死依赖从 package.json 移除）。… | — | — |
| `apps/web-overlay/src/lib/signin-failure.ts` | 131 | 登录失败的分类：**「你密码不对」和「服务坏了」必须分开说**。 真实缺陷（app/auth/signin/page.tsx）： 1. `signIn()` 只要返回 `error` 就写成「密码或 Token 凭证错误」。但 next-auth 在 **服务端配置错误**时返回的是 `Configuration`，HTTP 层则是 500 —— 这两类与用户 的输入毫无关系。… | `describeSignInFailure`、`NETWORK_FAILURE_STATUS`、`PASSWORD_MISMATCH`、`ACCESS_DENIED`、`OAUTH_BROKEN`、`SignInResultLike`、`SignInFailureNotice` | — |
| `apps/web-overlay/src/lib/speculative-prerender.ts` | 156 | 自适应上下文推测性预渲染引擎 (Speculative Pre-rendering Engine) 核心设计目标： 连接 Kalman 轨迹意图预测与浏览器原生 W3C Speculation Rules API。… | `isSafeForSpeculation`、`compileSpeculationRules`、`renderSpeculationRulesScript`、`generateFallbackLinkTags`、`DEFAULT_UNSAFE_PATTERNS`、`SpeculationCandidate`、`SpeculationEagerness`、`SpeculationRuleGroup`… | — |
| `apps/web-overlay/src/lib/speculative.ts` | 944 | Speculative Intent Pre-execution Engine (推测意图 0-RTT 原地预执行引擎) 核心设计目标： 当用户在搜索框输入特定技术文本时（Base64、时间戳、RGB/HEX颜色、算术表达式、JSON、URL编码、哈希等）， 系统不再仅仅返回外链结果，而是在 0 毫秒内原地预执行并生成即时计算结果（Micro-Widget）。 | `parseSpeculativeIntent`、`SpeculativeIntentType`、`SpeculativeIntentResult` | — |
| `apps/web-overlay/src/lib/ssrf-guard.ts` | 157 | 浏览器/服务端通用的 SSRF 守卫：IP 字面量与 DNS 解析结果双重网段判定（环回/私有/链路本地/云元数据）、协议白名单、重定向逐跳复检，提供 guardedFetch 与 DEFAULT_GUARD 策略。 | `isBlockedIp`、`resolveAndCheck`、`guardedFetch`、`isProbablySafeUrl`、`SsrfBlockedError`、`DEFAULT_GUARD`、`ALLOWED_PROTOCOLS`、`GuardOptions`… | 外部 node:dns/promises、node:net |
| `apps/web-overlay/src/lib/storage-adapter.ts` | 333 | 存储适配器 —— 前端与持久化解耦的唯一接缝。 背景（决定了整个改造方案的成本）： NavSphere 全站的持久化只经过两个函数： getFileContent(path) 读 commitFile(path, content, ...) 写 共 69 处调用点，读写的都是 3 个 JSON 文件。 所以**不需要碰那 69 处**。… | `resolveAdapterKind`、`createHttpAdapter`、`createGithubAdapter`、`createSqliteAdapter`、`createStorageAdapter`、`StorageError`、`StorageAdapterKind`、`StorageAdapter`… | — |
| `apps/web-overlay/src/lib/telemetry-status.ts` | 72 | 实时遥测面板的状态判定：**不许把「解析失败」显示成「就绪」**。 真实缺陷（`admin/AdminDashboardClient.tsx`）： sse.addEventListener('tick', (e) => { try { const payload = JSON.parse(e.data); setData(...) } catch {} // ← 解析失败，一声不吭 }) sse.onerror = () => setSs… | `telemetryState`、`describeTelemetry`、`SseStatus`、`TelemetryState`、`TelemetryDescriptor` | — |
| `apps/web-overlay/src/lib/vault.ts` | 262 | 客户端零知识端到端加密金库适配器 | `deriveVaultKey`、`encryptVault`、`decryptVault`、`encryptGenericPayload`、`decryptGenericPayload`、`VaultItem`、`EncryptedVaultPayload`、`EncryptedPayloadEnvelope` | — |
| `apps/web-overlay/src/lib/visual-fingerprint.ts` | 198 | 浏览器端视觉指纹与色彩和谐度适配器 (Client-side Visual Fingerprint & Color Harmony) | `hexToRgb`、`rgbToHex`、`rgbToHsl`、`getRelativeLuminance`、`calculateContrastRatio`、`analyzeVisualFingerprint`、`analyzeColorPalette`、`RgbColor`… | — |
| `apps/web-overlay/src/lib/wayback-resolver.ts` | 97 | 坏链自愈与时间机器历史镜像解析引擎 (Wayback Machine & Dead Link Sentinel) 纯算法实现，0 DOM 依赖，跨 Node.js 和浏览器通用。 | `normalizeTargetUrl`、`buildWaybackSnapshotUrl`、`buildWaybackSaveUrl`、`isPotentialBrokenHttpCode`、`parseWaybackAvailabilityResponse`、`WaybackSnapshotInfo` | — |
| `apps/web-overlay/src/lib/webmcp-bridge.ts` | 184 | 浏览器端端侧 Model Context Protocol (WebMCP) 双向通信网桥适配器 | `getWebMcpBridge`、`WebMcpBridge`、`JsonRpcRequest`、`JsonRpcResponse`、`WebMcpToolDefinition`、`WebMcpToolHandler` | — |
| `apps/web-overlay/src/middleware.ts` | 21 | Next 中间件：基于 next-auth 保护 /admin 与身份相关路由。 | `config`、`auth` | 站内别名 1 个（@/lib/auth.config）；外部 next-auth、next/server |
| `apps/web-overlay/src/types/modular.ts` | 63 | 模块化系统类型契约：模块定义、实例、页面布局与预设模板。 | `WidgetCategory`、`WidgetConfigField`、`ModularWidgetDefinition`、`WidgetInstance`、`ModularPageLayout`、`ModularPresetTemplate` | — |
| `apps/web-overlay/src/types/navigation.ts` | 171 | 导航领域类型与原始数据映射：分类/子项/条目/视频配置/关系/实时指标。 | `resolveIconPath`、`VideoConfigRaw`、`NavigationSubItemRaw`、`SiteAction`、`SiteRelation`、`SiteLiveMetrics`、`NavigationSubItem`、`VideoConfig`… | — |
| `apps/web-overlay/src/types/next-auth.d.ts` | 25 | next-auth 类型扩展：Session/User/JWT 上的角色字段。 | — | 外部 next-auth |
| `apps/web-overlay/src/types/submission.ts` | 83 | 投稿类型与 Issue 互转：表单数据 ↔ GitHub Issue 正文/标签解析。 | `parseSubmissionFromIssueBody`、`generateIssueBody`、`SUBMISSION_LABELS`、`SubmissionData`、`SubmissionIssue`、`SubmissionResponse` | — |

## 7. `apps/web` — 运行镜像与上游底座（310 个文件，60,287 行）

上游 NavSphere 基底 + overlay 回放结果，是实际构建/运行的目录。其中大部分代码文件与 overlay 同名对应（见 7.1），其余为上游原生文件（旧版后台、shadcn 原子件、数据快照，见 7.2）。

### 7.1 镜像文件（与 `apps/web-overlay` 同名对应，199 个）

这些文件在 `apps/web` 与 `apps/web-overlay` 中各存在一份，内容必须逐字节一致（由 `pnpm check:overlay` 强制）。修改时以 overlay 为事实源，再同步回 `apps/web`。

| 文件 | 行数 | 事实源 | 内容一致性 |
| :--- | ---: | :--- | :--- |
| `apps/web/src/app/admin/AdminDashboardClient.tsx` | 1140 | `apps/web-overlay/src/app/admin/AdminDashboardClient.tsx` | **漂移**（行数相同、内容不同，需人工 diff） |
| `apps/web/src/app/admin/AdminLayoutClient.tsx` | 472 | `apps/web-overlay/src/app/admin/AdminLayoutClient.tsx` | 一致 |
| `apps/web/src/app/admin/audit/page.tsx` | 252 | `apps/web-overlay/src/app/admin/audit/page.tsx` | 一致 |
| `apps/web/src/app/admin/categories/page.tsx` | 426 | `apps/web-overlay/src/app/admin/categories/page.tsx` | 一致 |
| `apps/web/src/app/admin/collections/page.tsx` | 335 | `apps/web-overlay/src/app/admin/collections/page.tsx` | 一致 |
| `apps/web/src/app/admin/facets/page.tsx` | 362 | `apps/web-overlay/src/app/admin/facets/page.tsx` | 一致 |
| `apps/web/src/app/admin/jobs/page.tsx` | 602 | `apps/web-overlay/src/app/admin/jobs/page.tsx` | 一致 |
| `apps/web/src/app/admin/layout.tsx` | 48 | `apps/web-overlay/src/app/admin/layout.tsx` | 一致 |
| `apps/web/src/app/admin/loading.tsx` | 46 | `apps/web-overlay/src/app/admin/loading.tsx` | 一致 |
| `apps/web/src/app/admin/navigation/page.tsx` | 323 | `apps/web-overlay/src/app/admin/navigation/page.tsx` | 一致 |
| `apps/web/src/app/admin/page.tsx` | 11 | `apps/web-overlay/src/app/admin/page.tsx` | 一致 |
| `apps/web/src/app/admin/resources/page.tsx` | 980 | `apps/web-overlay/src/app/admin/resources/page.tsx` | 一致 |
| `apps/web/src/app/admin/sitelist/page.tsx` | 2063 | `apps/web-overlay/src/app/admin/sitelist/page.tsx` | 一致 |
| `apps/web/src/app/admin/stats/page.tsx` | 492 | `apps/web-overlay/src/app/admin/stats/page.tsx` | 一致 |
| `apps/web/src/app/admin/tags/page.tsx` | 355 | `apps/web-overlay/src/app/admin/tags/page.tsx` | 一致 |
| `apps/web/src/app/admin/taxonomy/page.tsx` | 467 | `apps/web-overlay/src/app/admin/taxonomy/page.tsx` | 一致 |
| `apps/web/src/app/admin/tokens/page.tsx` | 695 | `apps/web-overlay/src/app/admin/tokens/page.tsx` | 一致 |
| `apps/web/src/app/admin/trash/page.tsx` | 189 | `apps/web-overlay/src/app/admin/trash/page.tsx` | 一致 |
| `apps/web/src/app/admin/videos/[id]/categories/[categoryId]/items/page.tsx` | 334 | `apps/web-overlay/src/app/admin/videos/[id]/categories/[categoryId]/items/page.tsx` | 一致 |
| `apps/web/src/app/admin/videos/[id]/items/page.tsx` | 463 | `apps/web-overlay/src/app/admin/videos/[id]/items/page.tsx` | 一致 |
| `apps/web/src/app/admin/videos/components/AddVideoItemForm.tsx` | 142 | `apps/web-overlay/src/app/admin/videos/components/AddVideoItemForm.tsx` | 一致 |
| `apps/web/src/app/algorithms/page.tsx` | 21 | `apps/web-overlay/src/app/algorithms/page.tsx` | 一致 |
| `apps/web/src/app/api/admin/stats/route.ts` | 62 | `apps/web-overlay/src/app/api/admin/stats/route.ts` | 一致 |
| `apps/web/src/app/api/extension/[id]/route.ts` | 71 | `apps/web-overlay/src/app/api/extension/[id]/route.ts` | 一致 |
| `apps/web/src/app/api/health/route.ts` | 22 | `apps/web-overlay/src/app/api/health/route.ts` | 一致 |
| `apps/web/src/app/api/home/navigation/route.ts` | 29 | `apps/web-overlay/src/app/api/home/navigation/route.ts` | 一致 |
| `apps/web/src/app/api/home/site/route.ts` | 20 | `apps/web-overlay/src/app/api/home/site/route.ts` | 一致 |
| `apps/web/src/app/api/hub/[...path]/route.ts` | 179 | `apps/web-overlay/src/app/api/hub/[...path]/route.ts` | 一致 |
| `apps/web/src/app/api/navigation/[id]/categories/route.ts` | 62 | `apps/web-overlay/src/app/api/navigation/[id]/categories/route.ts` | 一致 |
| `apps/web/src/app/api/navigation/[id]/items/route.ts` | 150 | `apps/web-overlay/src/app/api/navigation/[id]/items/route.ts` | 一致 |
| `apps/web/src/app/api/navigation/[id]/route.ts` | 100 | `apps/web-overlay/src/app/api/navigation/[id]/route.ts` | 一致 |
| `apps/web/src/app/api/navigation/check-default/route.ts` | 48 | `apps/web-overlay/src/app/api/navigation/check-default/route.ts` | 一致 |
| `apps/web/src/app/api/navigation/reorder/route.ts` | 54 | `apps/web-overlay/src/app/api/navigation/reorder/route.ts` | 一致 |
| `apps/web/src/app/api/navigation/restore/route.ts` | 61 | `apps/web-overlay/src/app/api/navigation/restore/route.ts` | 一致 |
| `apps/web/src/app/api/navigation/route.ts` | 106 | `apps/web-overlay/src/app/api/navigation/route.ts` | 一致 |
| `apps/web/src/app/api/resource/route.ts` | 152 | `apps/web-overlay/src/app/api/resource/route.ts` | 一致 |
| `apps/web/src/app/api/search/route.ts` | 30 | `apps/web-overlay/src/app/api/search/route.ts` | 一致 |
| `apps/web/src/app/api/site/route.ts` | 57 | `apps/web-overlay/src/app/api/site/route.ts` | 一致 |
| `apps/web/src/app/api/submissions/[number]/route.ts` | 321 | `apps/web-overlay/src/app/api/submissions/[number]/route.ts` | 一致 |
| `apps/web/src/app/api/submissions/route.ts` | 233 | `apps/web-overlay/src/app/api/submissions/route.ts` | 一致 |
| `apps/web/src/app/api/videos/[id]/items/route.ts` | 153 | `apps/web-overlay/src/app/api/videos/[id]/items/route.ts` | 一致 |
| `apps/web/src/app/api/videos/[id]/route.ts` | 124 | `apps/web-overlay/src/app/api/videos/[id]/route.ts` | 一致 |
| `apps/web/src/app/api/videos/route.ts` | 92 | `apps/web-overlay/src/app/api/videos/route.ts` | 一致 |
| `apps/web/src/app/api/website-metadata/route.ts` | 541 | `apps/web-overlay/src/app/api/website-metadata/route.ts` | 一致 |
| `apps/web/src/app/auth/signin/layout.tsx` | 17 | `apps/web-overlay/src/app/auth/signin/layout.tsx` | 一致 |
| `apps/web/src/app/auth/signin/page.tsx` | 393 | `apps/web-overlay/src/app/auth/signin/page.tsx` | 一致 |
| `apps/web/src/app/collections/[slug]/layout.tsx` | 17 | `apps/web-overlay/src/app/collections/[slug]/layout.tsx` | 一致 |
| `apps/web/src/app/collections/[slug]/page.tsx` | 176 | `apps/web-overlay/src/app/collections/[slug]/page.tsx` | 一致 |
| `apps/web/src/app/collections/layout.tsx` | 17 | `apps/web-overlay/src/app/collections/layout.tsx` | 一致 |
| `apps/web/src/app/collections/page.tsx` | 123 | `apps/web-overlay/src/app/collections/page.tsx` | 一致 |
| `apps/web/src/app/custom/page.tsx` | 77 | `apps/web-overlay/src/app/custom/page.tsx` | 一致 |
| `apps/web/src/app/error.tsx` | 119 | `apps/web-overlay/src/app/error.tsx` | 一致 |
| `apps/web/src/app/favorites/layout.tsx` | 17 | `apps/web-overlay/src/app/favorites/layout.tsx` | 一致 |
| `apps/web/src/app/favorites/page.tsx` | 686 | `apps/web-overlay/src/app/favorites/page.tsx` | 一致 |
| `apps/web/src/app/global-error.tsx` | 162 | `apps/web-overlay/src/app/global-error.tsx` | 一致 |
| `apps/web/src/app/graph/page.tsx` | 16 | `apps/web-overlay/src/app/graph/page.tsx` | 一致 |
| `apps/web/src/app/hot/layout.tsx` | 18 | `apps/web-overlay/src/app/hot/layout.tsx` | 一致 |
| `apps/web/src/app/hot/page.tsx` | 237 | `apps/web-overlay/src/app/hot/page.tsx` | 一致 |
| `apps/web/src/app/import/page.tsx` | 20 | `apps/web-overlay/src/app/import/page.tsx` | 一致 |
| `apps/web/src/app/layout.tsx` | 172 | `apps/web-overlay/src/app/layout.tsx` | 一致 |
| `apps/web/src/app/loading.tsx` | 42 | `apps/web-overlay/src/app/loading.tsx` | 一致 |
| `apps/web/src/app/manifest.ts` | 35 | `apps/web-overlay/src/app/manifest.ts` | 一致 |
| `apps/web/src/app/not-found.tsx` | 103 | `apps/web-overlay/src/app/not-found.tsx` | 一致 |
| `apps/web/src/app/page.tsx` | 61 | `apps/web-overlay/src/app/page.tsx` | 一致 |
| `apps/web/src/app/preferences/layout.tsx` | 17 | `apps/web-overlay/src/app/preferences/layout.tsx` | 一致 |
| `apps/web/src/app/preferences/page.tsx` | 252 | `apps/web-overlay/src/app/preferences/page.tsx` | 一致 |
| `apps/web/src/app/providers.tsx` | 38 | `apps/web-overlay/src/app/providers.tsx` | 一致 |
| `apps/web/src/app/site/[id]/layout.tsx` | 17 | `apps/web-overlay/src/app/site/[id]/layout.tsx` | 一致 |
| `apps/web/src/app/site/[id]/page.tsx` | 555 | `apps/web-overlay/src/app/site/[id]/page.tsx` | 一致 |
| `apps/web/src/app/submit/page.tsx` | 93 | `apps/web-overlay/src/app/submit/page.tsx` | 一致 |
| `apps/web/src/app/tags/[slug]/layout.tsx` | 17 | `apps/web-overlay/src/app/tags/[slug]/layout.tsx` | 一致 |
| `apps/web/src/app/tags/[slug]/page.tsx` | 148 | `apps/web-overlay/src/app/tags/[slug]/page.tsx` | 一致 |
| `apps/web/src/app/tags/layout.tsx` | 17 | `apps/web-overlay/src/app/tags/layout.tsx` | 一致 |
| `apps/web/src/app/tags/page.tsx` | 153 | `apps/web-overlay/src/app/tags/page.tsx` | 一致 |
| `apps/web/src/app/videos/page.tsx` | 50 | `apps/web-overlay/src/app/videos/page.tsx` | 一致 |
| `apps/web/src/app/videos/player/page.tsx` | 46 | `apps/web-overlay/src/app/videos/player/page.tsx` | 一致 |
| `apps/web/src/components/admin/load-error-notice.tsx` | 50 | `apps/web-overlay/src/components/admin/load-error-notice.tsx` | 一致 |
| `apps/web/src/components/algorithm-lab.tsx` | 2212 | `apps/web-overlay/src/components/algorithm-lab.tsx` | 一致 |
| `apps/web/src/components/architecture-recipe-card.tsx` | 120 | `apps/web-overlay/src/components/architecture-recipe-card.tsx` | 一致 |
| `apps/web/src/components/batch-operation-dock.tsx` | 262 | `apps/web-overlay/src/components/batch-operation-dock.tsx` | 一致 |
| `apps/web/src/components/bookmark-importer.tsx` | 359 | `apps/web-overlay/src/components/bookmark-importer.tsx` | 一致 |
| `apps/web/src/components/category-in-situ-controls.tsx` | 149 | `apps/web-overlay/src/components/category-in-situ-controls.tsx` | 一致 |
| `apps/web/src/components/density-provider.tsx` | 110 | `apps/web-overlay/src/components/density-provider.tsx` | 一致 |
| `apps/web/src/components/density-toggle.tsx` | 91 | `apps/web-overlay/src/components/density-toggle.tsx` | 一致 |
| `apps/web/src/components/ecosystem-graph.tsx` | 660 | `apps/web-overlay/src/components/ecosystem-graph.tsx` | 一致 |
| `apps/web/src/components/favorite-button.tsx` | 39 | `apps/web-overlay/src/components/favorite-button.tsx` | 一致 |
| `apps/web/src/components/footer.tsx` | 46 | `apps/web-overlay/src/components/footer.tsx` | 一致 |
| `apps/web/src/components/home-diy-toolbar.tsx` | 1309 | `apps/web-overlay/src/components/home-diy-toolbar.tsx` | 一致 |
| `apps/web/src/components/home-hero-deck.tsx` | 257 | `apps/web-overlay/src/components/home-hero-deck.tsx` | 一致 |
| `apps/web/src/components/hub-degraded-notice.tsx` | 57 | `apps/web-overlay/src/components/hub-degraded-notice.tsx` | 一致 |
| `apps/web/src/components/keyboard-shortcuts-dialog.tsx` | 198 | `apps/web-overlay/src/components/keyboard-shortcuts-dialog.tsx` | 一致 |
| `apps/web/src/components/modular/modular-canvas-client.tsx` | 20 | `apps/web-overlay/src/components/modular/modular-canvas-client.tsx` | 一致 |
| `apps/web/src/components/modular/modular-canvas.tsx` | 565 | `apps/web-overlay/src/components/modular/modular-canvas.tsx` | 一致 |
| `apps/web/src/components/modular/modular-item.tsx` | 467 | `apps/web-overlay/src/components/modular/modular-item.tsx` | 一致 |
| `apps/web/src/components/modular/module-error-boundary.tsx` | 99 | `apps/web-overlay/src/components/modular/module-error-boundary.tsx` | 一致 |
| `apps/web/src/components/modular/module-library-modal.tsx` | 192 | `apps/web-overlay/src/components/modular/module-library-modal.tsx` | 一致 |
| `apps/web/src/components/modular/modules/clock-widget.tsx` | 193 | `apps/web-overlay/src/components/modular/modules/clock-widget.tsx` | 一致 |
| `apps/web/src/components/modular/modules/custom-category-widget.tsx` | 123 | `apps/web-overlay/src/components/modular/modules/custom-category-widget.tsx` | 一致 |
| `apps/web/src/components/modular/modules/favorites-dock-widget.tsx` | 64 | `apps/web-overlay/src/components/modular/modules/favorites-dock-widget.tsx` | 一致 |
| `apps/web/src/components/modular/modules/github-heatmap-widget.tsx` | 231 | `apps/web-overlay/src/components/modular/modules/github-heatmap-widget.tsx` | 一致 |
| `apps/web/src/components/modular/modules/hyperbolic-radar-widget.tsx` | 78 | `apps/web-overlay/src/components/modular/modules/hyperbolic-radar-widget.tsx` | 一致 |
| `apps/web/src/components/modular/modules/iframe-widget.tsx` | 134 | `apps/web-overlay/src/components/modular/modules/iframe-widget.tsx` | 一致 |
| `apps/web/src/components/modular/modules/live-api-widget.tsx` | 179 | `apps/web-overlay/src/components/modular/modules/live-api-widget.tsx` | 一致 |
| `apps/web/src/components/modular/modules/metrics-widget.tsx` | 118 | `apps/web-overlay/src/components/modular/modules/metrics-widget.tsx` | 一致 |
| `apps/web/src/components/modular/modules/notes-widget.tsx` | 237 | `apps/web-overlay/src/components/modular/modules/notes-widget.tsx` | 一致 |
| `apps/web/src/components/modular/modules/quick-search-widget.tsx` | 106 | `apps/web-overlay/src/components/modular/modules/quick-search-widget.tsx` | 一致 |
| `apps/web/src/components/modular/modules/quick-tools-widget.tsx` | 219 | `apps/web-overlay/src/components/modular/modules/quick-tools-widget.tsx` | 一致 |
| `apps/web/src/components/modular/modules/rss-feed-widget.tsx` | 144 | `apps/web-overlay/src/components/modular/modules/rss-feed-widget.tsx` | 一致 |
| `apps/web/src/components/modular/modules/speculative-terminal-widget.tsx` | 87 | `apps/web-overlay/src/components/modular/modules/speculative-terminal-widget.tsx` | 一致 |
| `apps/web/src/components/modular/modules/trending-widget.tsx` | 146 | `apps/web-overlay/src/components/modular/modules/trending-widget.tsx` | 一致 |
| `apps/web/src/components/modular/modules/weather-widget.tsx` | 249 | `apps/web-overlay/src/components/modular/modules/weather-widget.tsx` | 一致 |
| `apps/web/src/components/modular/template-modal.tsx` | 84 | `apps/web-overlay/src/components/modular/template-modal.tsx` | 一致 |
| `apps/web/src/components/modular/widget-config-modal.tsx` | 198 | `apps/web-overlay/src/components/modular/widget-config-modal.tsx` | 一致 |
| `apps/web/src/components/nav-icon.tsx` | 63 | `apps/web-overlay/src/components/nav-icon.tsx` | 一致 |
| `apps/web/src/components/navigation-card.tsx` | 572 | `apps/web-overlay/src/components/navigation-card.tsx` | 一致 |
| `apps/web/src/components/navigation-content.tsx` | 1212 | `apps/web-overlay/src/components/navigation-content.tsx` | 一致 |
| `apps/web/src/components/offline-banner.tsx` | 107 | `apps/web-overlay/src/components/offline-banner.tsx` | 一致 |
| `apps/web/src/components/predictive-prefetch-provider.tsx` | 127 | `apps/web-overlay/src/components/predictive-prefetch-provider.tsx` | 一致 |
| `apps/web/src/components/providers.tsx` | 25 | `apps/web-overlay/src/components/providers.tsx` | 一致 |
| `apps/web/src/components/pwa-register.tsx` | 117 | `apps/web-overlay/src/components/pwa-register.tsx` | 一致 |
| `apps/web/src/components/quick-tools-drawer.tsx` | 581 | `apps/web-overlay/src/components/quick-tools-drawer.tsx` | 一致 |
| `apps/web/src/components/search-bar.tsx` | 274 | `apps/web-overlay/src/components/search-bar.tsx` | 一致 |
| `apps/web/src/components/search-palette.tsx` | 746 | `apps/web-overlay/src/components/search-palette.tsx` | 一致 |
| `apps/web/src/components/sidebar.tsx` | 187 | `apps/web-overlay/src/components/sidebar.tsx` | 一致 |
| `apps/web/src/components/site-favicon.tsx` | 256 | `apps/web-overlay/src/components/site-favicon.tsx` | 一致 |
| `apps/web/src/components/site-peek-dialog.tsx` | 375 | `apps/web-overlay/src/components/site-peek-dialog.tsx` | 一致 |
| `apps/web/src/components/speculative-intent-card.tsx` | 115 | `apps/web-overlay/src/components/speculative-intent-card.tsx` | 一致 |
| `apps/web/src/components/speculative-prerender.tsx` | 163 | `apps/web-overlay/src/components/speculative-prerender.tsx` | 一致 |
| `apps/web/src/components/submission-form.tsx` | 293 | `apps/web-overlay/src/components/submission-form.tsx` | 一致 |
| `apps/web/src/components/tech-comparison-card.tsx` | 121 | `apps/web-overlay/src/components/tech-comparison-card.tsx` | 一致 |
| `apps/web/src/components/ui/container.tsx` | 39 | `apps/web-overlay/src/components/ui/container.tsx` | 一致 |
| `apps/web/src/components/ui/dialog.tsx` | 122 | `apps/web-overlay/src/components/ui/dialog.tsx` | 一致 |
| `apps/web/src/components/ui/overlay.tsx` | 195 | `apps/web-overlay/src/components/ui/overlay.tsx` | 一致 |
| `apps/web/src/components/video-card.tsx` | 204 | `apps/web-overlay/src/components/video-card.tsx` | 一致 |
| `apps/web/src/components/video-content.tsx` | 233 | `apps/web-overlay/src/components/video-content.tsx` | 一致 |
| `apps/web/src/components/video-player-page.tsx` | 322 | `apps/web-overlay/src/components/video-player-page.tsx` | 一致 |
| `apps/web/src/components/view-mode-toggle.tsx` | 112 | `apps/web-overlay/src/components/view-mode-toggle.tsx` | 一致 |
| `apps/web/src/components/workspace-filter.tsx` | 87 | `apps/web-overlay/src/components/workspace-filter.tsx` | 一致 |
| `apps/web/src/hooks/useFavorites.ts` | 279 | `apps/web-overlay/src/hooks/useFavorites.ts` | 一致 |
| `apps/web/src/lib/admin-guard.ts` | 52 | `apps/web-overlay/src/lib/admin-guard.ts` | 一致 |
| `apps/web/src/lib/admin-load-failure.ts` | 87 | `apps/web-overlay/src/lib/admin-load-failure.ts` | 一致 |
| `apps/web/src/lib/architecture-recipe.ts` | 263 | `apps/web-overlay/src/lib/architecture-recipe.ts` | 一致 |
| `apps/web/src/lib/auth.config.ts` | 108 | `apps/web-overlay/src/lib/auth.config.ts` | 一致 |
| `apps/web/src/lib/auth.ts` | 211 | `apps/web-overlay/src/lib/auth.ts` | 一致 |
| `apps/web/src/lib/batch-operations.ts` | 173 | `apps/web-overlay/src/lib/batch-operations.ts` | 一致 |
| `apps/web/src/lib/clipboard.ts` | 88 | `apps/web-overlay/src/lib/clipboard.ts` | 一致 |
| `apps/web/src/lib/comparison.ts` | 230 | `apps/web-overlay/src/lib/comparison.ts` | 一致 |
| `apps/web/src/lib/crdt-sync.ts` | 454 | `apps/web-overlay/src/lib/crdt-sync.ts` | 一致 |
| `apps/web/src/lib/daypart.ts` | 45 | `apps/web-overlay/src/lib/daypart.ts` | 一致 |
| `apps/web/src/lib/degrade.ts` | 92 | `apps/web-overlay/src/lib/degrade.ts` | 一致 |
| `apps/web/src/lib/diy-share-link.ts` | 75 | `apps/web-overlay/src/lib/diy-share-link.ts` | 一致 |
| `apps/web/src/lib/dynamic-tool-synthesizer.ts` | 444 | `apps/web-overlay/src/lib/dynamic-tool-synthesizer.ts` | 一致 |
| `apps/web/src/lib/error-report.ts` | 135 | `apps/web-overlay/src/lib/error-report.ts` | 一致 |
| `apps/web/src/lib/favorites-filter.ts` | 69 | `apps/web-overlay/src/lib/favorites-filter.ts` | 一致 |
| `apps/web/src/lib/favorites-storage.ts` | 58 | `apps/web-overlay/src/lib/favorites-storage.ts` | 一致 |
| `apps/web/src/lib/federated-recommendation.ts` | 133 | `apps/web-overlay/src/lib/federated-recommendation.ts` | 一致 |
| `apps/web/src/lib/github.ts` | 284 | `apps/web-overlay/src/lib/github.ts` | 一致 |
| `apps/web/src/lib/graph-nav.ts` | 129 | `apps/web-overlay/src/lib/graph-nav.ts` | 一致 |
| `apps/web/src/lib/highlight.ts` | 58 | `apps/web-overlay/src/lib/highlight.ts` | 一致 |
| `apps/web/src/lib/hub-health.ts` | 96 | `apps/web-overlay/src/lib/hub-health.ts` | 一致 |
| `apps/web/src/lib/hub-proxy.ts` | 146 | `apps/web-overlay/src/lib/hub-proxy.ts` | 一致 |
| `apps/web/src/lib/identity-signature.ts` | 60 | `apps/web-overlay/src/lib/identity-signature.ts` | 一致 |
| `apps/web/src/lib/identity.ts` | 55 | `apps/web-overlay/src/lib/identity.ts` | 一致 |
| `apps/web/src/lib/knowledge-graph.ts` | 274 | `apps/web-overlay/src/lib/knowledge-graph.ts` | 一致 |
| `apps/web/src/lib/latest-request.ts` | 86 | `apps/web-overlay/src/lib/latest-request.ts` | 一致 |
| `apps/web/src/lib/modular/diy-presets.ts` | 768 | `apps/web-overlay/src/lib/modular/diy-presets.ts` | 一致 |
| `apps/web/src/lib/modular/layout-sync.ts` | 355 | `apps/web-overlay/src/lib/modular/layout-sync.ts` | 一致 |
| `apps/web/src/lib/modular/registry.ts` | 378 | `apps/web-overlay/src/lib/modular/registry.ts` | 一致 |
| `apps/web/src/lib/modular/sanitize.ts` | 36 | `apps/web-overlay/src/lib/modular/sanitize.ts` | 一致 |
| `apps/web/src/lib/modular/use-home-diy.ts` | 1212 | `apps/web-overlay/src/lib/modular/use-home-diy.ts` | 一致 |
| `apps/web/src/lib/modular/use-modular-layout.ts` | 576 | `apps/web-overlay/src/lib/modular/use-modular-layout.ts` | 一致 |
| `apps/web/src/lib/modular/workbench-bridge.ts` | 116 | `apps/web-overlay/src/lib/modular/workbench-bridge.ts` | 一致 |
| `apps/web/src/lib/modular/workspace-storage.ts` | 39 | `apps/web-overlay/src/lib/modular/workspace-storage.ts` | 一致 |
| `apps/web/src/lib/motion.ts` | 48 | `apps/web-overlay/src/lib/motion.ts` | 一致 |
| `apps/web/src/lib/nav-icons.ts` | 158 | `apps/web-overlay/src/lib/nav-icons.ts` | 一致 |
| `apps/web/src/lib/navhub-api.ts` | 542 | `apps/web-overlay/src/lib/navhub-api.ts` | 一致 |
| `apps/web/src/lib/offline-banner.ts` | 51 | `apps/web-overlay/src/lib/offline-banner.ts` | 一致 |
| `apps/web/src/lib/prefetch.ts` | 181 | `apps/web-overlay/src/lib/prefetch.ts` | 一致 |
| `apps/web/src/lib/profile-view.ts` | 66 | `apps/web-overlay/src/lib/profile-view.ts` | 一致 |
| `apps/web/src/lib/recovery-links.ts` | 34 | `apps/web-overlay/src/lib/recovery-links.ts` | 一致 |
| `apps/web/src/lib/safe-url.ts` | 46 | `apps/web-overlay/src/lib/safe-url.ts` | 一致 |
| `apps/web/src/lib/search-panel.ts` | 79 | `apps/web-overlay/src/lib/search-panel.ts` | 一致 |
| `apps/web/src/lib/selection.ts` | 72 | `apps/web-overlay/src/lib/selection.ts` | 一致 |
| `apps/web/src/lib/session.ts` | 12 | `apps/web-overlay/src/lib/session.ts` | 一致 |
| `apps/web/src/lib/signin-failure.ts` | 131 | `apps/web-overlay/src/lib/signin-failure.ts` | 一致 |
| `apps/web/src/lib/speculative-prerender.ts` | 156 | `apps/web-overlay/src/lib/speculative-prerender.ts` | 一致 |
| `apps/web/src/lib/speculative.ts` | 944 | `apps/web-overlay/src/lib/speculative.ts` | 一致 |
| `apps/web/src/lib/ssrf-guard.ts` | 157 | `apps/web-overlay/src/lib/ssrf-guard.ts` | 一致 |
| `apps/web/src/lib/storage-adapter.ts` | 333 | `apps/web-overlay/src/lib/storage-adapter.ts` | 一致 |
| `apps/web/src/lib/telemetry-status.ts` | 72 | `apps/web-overlay/src/lib/telemetry-status.ts` | 一致 |
| `apps/web/src/lib/vault.ts` | 262 | `apps/web-overlay/src/lib/vault.ts` | 一致 |
| `apps/web/src/lib/visual-fingerprint.ts` | 198 | `apps/web-overlay/src/lib/visual-fingerprint.ts` | 一致 |
| `apps/web/src/lib/wayback-resolver.ts` | 97 | `apps/web-overlay/src/lib/wayback-resolver.ts` | 一致 |
| `apps/web/src/lib/webmcp-bridge.ts` | 184 | `apps/web-overlay/src/lib/webmcp-bridge.ts` | 一致 |
| `apps/web/src/middleware.ts` | 21 | `apps/web-overlay/src/middleware.ts` | 一致 |
| `apps/web/src/types/modular.ts` | 63 | `apps/web-overlay/src/types/modular.ts` | 一致 |
| `apps/web/src/types/navigation.ts` | 171 | `apps/web-overlay/src/types/navigation.ts` | 一致 |
| `apps/web/src/types/next-auth.d.ts` | 25 | `apps/web-overlay/src/types/next-auth.d.ts` | 一致 |
| `apps/web/src/types/submission.ts` | 83 | `apps/web-overlay/src/types/submission.ts` | 一致 |

> 实测：199 个镜像文件中 198 个内容一致、1 个漂移——其中 0 个 overlay 侧行数更多（overlay 更新）、0 个 `apps/web` 侧更多、1 个行数相同但内容不同。`check:overlay` 会非零退出；其提示语默认「把 apps/web 同步回 overlay」，但方向需逐文件确认（按行数判断多数是 overlay 更新）。

### 7.2 `apps/web` 独有文件（上游 NavSphere 底座与本地新增，106 个）

| 文件 | 行数 | 职责与实现要点 | 关键导出 | 主要依赖 |
| :--- | ---: | :--- | :--- | :--- |
| `apps/web/src/app/actions/fetch-financial-data.ts` | 46 | Server Action：抓取金融行情数据并返回结构化结果（上游示例能力，供资源页扩展）。 | `fetchFinancialData`、`FinancialDataResponse`、`FinancialData` | — |
| `apps/web/src/app/admin/data/page.tsx` | 709 | 数据管理页：整库导入/导出、备份与清理入口。 | `runtime`、`DataManagementPage` | 站内别名 7 个（@/components/ui/badge、@/components/ui/button、@/components/ui/card…）；外部 lucide-react、react |
| `apps/web/src/app/admin/navigation/[id]/categories/[categoryId]/items/page.tsx` | 606 | 分类下的条目管理页。 | `runtime`、`CategoryItemsPage` | 站内别名 9 个（@/components/icons、@/registry/new-york/hooks/use-toast、@/registry/new-york/ui/badge…）；相对模块 1 个（../../../../components/AddItemForm）；外部 @hello-pangea/dnd、next/navigation、react |
| `apps/web/src/app/admin/navigation/[id]/categories/page.tsx` | 679 | 导航集合的分类管理页：增删改与排序。 | `runtime`、`CategoriesPage` | 站内别名 10 个（@/lib/navigation-tree、@/registry/new-york/hooks/use-toast、@/registry/new-york/ui/badge…）；相对模块 1 个（../../components/AddCategoryForm）；外部 @hello-pangea/dnd、lucide-react、next/navigation、react |
| `apps/web/src/app/admin/navigation/[id]/items/page.tsx` | 576 | 导航集合的条目管理页：站点条目 CRUD 与排序。 | `runtime`、`ItemsPage` | 站内别名 9 个（@/components/icons、@/registry/new-york/hooks/use-toast、@/registry/new-york/ui/badge…）；相对模块 1 个（../../components/AddItemForm）；外部 @hello-pangea/dnd、next/navigation、react |
| `apps/web/src/app/admin/navigation/[id]/page.tsx` | 217 | 导航集合详情管理页：集合信息编辑与下级入口。 | `runtime`、`NavigationPage` | 站内别名 7 个（@/components/icons、@/registry/new-york/hooks/use-toast、@/registry/new-york/ui/button…）；外部 lucide-react、next/navigation、react |
| `apps/web/src/app/admin/navigation/[id]/subcategory/[subId]/page.tsx` | 84 | 子分类条目管理页。 | `runtime`、`SubCategoryItemsPage` | 站内别名 6 个（@/components/icons、@/components/ui/button、@/components/ui/input…）；外部 next/link、next/navigation、react |
| `apps/web/src/app/admin/navigation/components/AddCategoryForm.tsx` | 160 | 新建分类表单（名称/图标/排序）。 | `AddCategoryForm` | 站内别名 7 个（@/lib/icons、@/registry/new-york/hooks/use-toast、@/registry/new-york/ui/button…）；外部 @hookform/resolvers/zod、react-hook-form、zod |
| `apps/web/src/app/admin/navigation/components/AddItemForm.tsx` | 391 | 新建站点条目表单（标题/URL/图标/描述/子项）。 | `AddItemForm` | 站内别名 8 个（@/components/icons、@/registry/new-york/hooks/use-toast、@/registry/new-york/ui/button…）；外部 @hookform/resolvers/zod、react、react-hook-form、zod |
| `apps/web/src/app/admin/navigation/components/AddNavigationForm.tsx` | 179 | 新建导航集合表单。 | `AddNavigationForm` | 站内别名 6 个（@/registry/new-york/hooks/use-toast、@/registry/new-york/ui/button、@/registry/new-york/ui/form…）；相对模块 1 个（./IconSelector）；外部 @hookform/resolvers/zod、react-hook-form、zod |
| `apps/web/src/app/admin/navigation/components/IconPicker.tsx` | 182 | 图标选择器：内置图标库分页选择。 | `IconPicker` | 站内别名 5 个（@/components/icons、@/lib/utils、@/registry/new-york/ui/button…）；外部 lucide-react、react |
| `apps/web/src/app/admin/navigation/components/IconSelector.tsx` | 83 | 图标选择触发器与预览。 | `IconSelector` | 站内别名 5 个（@/lib/icons、@/lib/utils、@/registry/new-york/ui/button…）；外部 lucide-react、react |
| `apps/web/src/app/admin/navigation/components/IconUploader.tsx` | 133 | 图标上传：本地图片转 DataURL 或写入资源目录。 | `IconUploader` | 站内别名 3 个（@/registry/new-york/ui/button、@/registry/new-york/ui/form、@/registry/new-york/ui/input）；外部 react-hook-form |
| `apps/web/src/app/admin/navigation/components/NavigationCard.tsx` | 288 | 导航集合卡片：条目数、快捷编辑与删除。 | `NavigationCard` | 站内别名 8 个（@/lib/icons、@/lib/utils、@/registry/new-york/hooks/use-toast…）；相对模块 1 个（./AddNavigationForm）；外部 @hello-pangea/dnd、lucide-react、next/navigation、react |
| `apps/web/src/app/admin/resources/download/page.tsx` | 118 | 图标批量下载器：按站点域名抓取 favicon 并打包。 | `runtime`、`FaviconDownloader` | 外部 react |
| `apps/web/src/app/admin/site/page.tsx` | 321 | 站点全局设置页：标题/描述/关键词/主题/页脚等 site.json 编辑。 | `runtime`、`SiteSettings` | 站内别名 12 个（@/components/icons、@/registry/new-york/hooks/use-toast、@/registry/new-york/ui/button…）；外部 @hookform/resolvers/zod、react、react-hook-form、zod |
| `apps/web/src/app/admin/submissions/page.tsx` | 431 | 投稿审核页：待审列表、详情对比与通过/驳回。 | `SubmissionsPage` | 站内别名 9 个（@/registry/new-york/ui/badge、@/registry/new-york/ui/button、@/registry/new-york/ui/card…）；外部 lucide-react、react |
| `apps/web/src/app/admin/videos/[id]/categories/page.tsx` | 460 | 某视频集合下的分类管理页。 | `runtime`、`VideoCategoriesPage` | 站内别名 8 个（@/registry/new-york/hooks/use-toast、@/registry/new-york/ui/badge、@/registry/new-york/ui/button…）；相对模块 1 个（../../components/AddVideoCategoryForm）；外部 @hello-pangea/dnd、lucide-react、next/navigation、react |
| `apps/web/src/app/admin/videos/components/AddVideoCategoryForm.tsx` | 180 | 新建视频分类表单。 | `AddVideoCategoryForm` | 站内别名 6 个（@/registry/new-york/hooks/use-toast、@/registry/new-york/ui/button、@/registry/new-york/ui/form…）；相对模块 1 个（./IconSelector）；外部 @hookform/resolvers/zod、react-hook-form、zod |
| `apps/web/src/app/admin/videos/components/IconSelector.tsx` | 81 | 视频分类图标选择器。 | `IconSelector` | 站内别名 5 个（@/lib/icons、@/lib/utils、@/registry/new-york/ui/button…）；外部 lucide-react、react |
| `apps/web/src/app/admin/videos/components/VideoCategoryCard.tsx` | 234 | 视频分类卡片：封面、条目数与操作。 | `VideoCategoryCard` | 站内别名 8 个（@/lib/icons、@/lib/utils、@/registry/new-york/hooks/use-toast…）；相对模块 1 个（./AddVideoCategoryForm）；外部 lucide-react、next/navigation、react |
| `apps/web/src/app/admin/videos/components/VideoIconUpload.tsx` | 114 | 视频分类图标上传。 | `VideoIconUpload` | 站内别名 4 个（@/components/icons、@/registry/new-york/hooks/use-toast、@/registry/new-york/ui/button…）；外部 react |
| `apps/web/src/app/admin/videos/page.tsx` | 195 | 视频分类管理页：分类 CRUD 与排序。 | `runtime`、`VideosAdminPage` | 站内别名 7 个（@/registry/new-york/hooks/use-toast、@/registry/new-york/ui/button、@/registry/new-york/ui/dialog…）；相对模块 2 个（./components/VideoCategoryCard、./components/AddVideoCategoryForm）；外部 lucide-react、react、swr |
| `apps/web/src/app/api/favicon-im/route.ts` | 37 | 即时 Favicon 生成：无图标时按域名生成首字母/渐变图。 | `GET`、`runtime` | 外部 next/server |
| `apps/web/src/app/api/favicon/route.ts` | 32 | Favicon 代理：服务端抓取目标站图标并缓存，规避跨域与防盗链。 | `GET`、`runtime` | 外部 next/server |
| `apps/web/src/app/api/resource/check-references/route.ts` | 106 | 资源引用检查：删除前校验资源是否仍被条目引用。 | `POST`、`runtime` | 站内别名 3 个（@/lib/github、@/types/navigation、@/types/site）；外部 next/server |
| `apps/web/src/app/api/site-config/route.ts` | 31 | 站点配置（site.json）读写接口。 | `GET`、`runtime` | 站内别名 1 个（@/types/site）；外部 next/server |
| `apps/web/src/app/auth/error/page.tsx` | 28 | 登录错误页：展示 next-auth 错误码的可读解释。 | `ErrorPage` | 外部 next/navigation、react |
| `apps/web/src/app/components/Footer.tsx` | 23 | 旧版页脚组件（上游布局遗留）。 | `Footer` | — |
| `apps/web/src/app/components/Header.tsx` | 18 | 旧版页头组件。 | `Header` | — |
| `apps/web/src/app/components/Layout.tsx` | 17 | 旧版页面布局壳。 | `Layout` | 相对模块 2 个（./Header、./Footer）；外部 react |
| `apps/web/src/app/components/ResourceCard.tsx` | 32 | 旧版资源卡片。 | `ResourceCard` | 相对模块 1 个（../types/navigation）；外部 next/image、next/link |
| `apps/web/src/app/components/ScrollToTop.tsx` | 41 | 旧版回到顶部按钮。 | `ScrollToTop` | 外部 react |
| `apps/web/src/app/components/ThemeToggle.tsx` | 31 | 旧版主题切换按钮。 | `ThemeToggle` | 外部 next-themes、react |
| `apps/web/src/app/components/theme-provider.tsx` | 8 | 旧版主题 Provider（next-themes 包装）。 | `ThemeProvider` | 外部 next-themes、next-themes/dist/types |
| `apps/web/src/app/components/ui/icon-picker.tsx` | 76 | 旧版图标选择器（emoji/内置图标）。 | `IconPicker` | 站内别名 4 个（@/lib/utils、@/registry/new-york/ui/button、@/registry/new-york/ui/input…）；外部 react |
| `apps/web/src/app/middleware.ts` | 19 | 旧版中间件：/admin 路由会话校验。 | `middleware`、`config` | 外部 next/server |
| `apps/web/src/app/types/navigation.ts` | 46 | 上游导航数据类型：NavigationData/ResourceData 等原始结构。 | `NavigationSubItem`、`NavigationSubCategory`、`NavigationItem`、`NavigationData`、`ResourceItem`、`ResourceSection`、`ResourceData` | — |
| `apps/web/src/components/NavigationButton.tsx` | 53 | 旧版导航按钮。 | `NavigationButton` | 外部 next/link、react |
| `apps/web/src/components/NavigationItem.tsx` | 41 | 旧版导航条目。 | `NavigationItem` | 站内别名 1 个（@/types/navigation）；相对模块 2 个（./NavigationToggle、./NavigationLink） |
| `apps/web/src/components/NavigationLink.tsx` | 16 | 旧版导航链接。 | `NavigationLink` | 外部 next/link |
| `apps/web/src/components/NavigationSidebar.tsx` | 38 | 旧版导航侧栏。 | `NavigationSidebar` | 站内别名 2 个（@/components/ui/scroll-area、@/types/navigation）；相对模块 1 个（./NavigationItem） |
| `apps/web/src/components/NavigationToggle.tsx` | 29 | 旧版侧栏开关。 | `NavigationToggle` | 外部 react |
| `apps/web/src/components/NavigationToggleButton.tsx` | 1 | 空占位文件（上游遗留，已无实现）。 | — | — |
| `apps/web/src/components/ResourceCard.tsx` | 53 | 资源卡片：图标、标题、描述与外链。 | `ResourceCard` | 站内别名 2 个（@/lib/utils、@/types/navigation）；外部 next/image、next/link |
| `apps/web/src/components/ResourceTabs.tsx` | 68 | 资源分组标签页切换。 | `ResourceTabs` | 站内别名 4 个（@/components/ui/scroll-area、@/components/ui/separator、@/components/ui/tabs…）；相对模块 1 个（./ResourceCard） |
| `apps/web/src/components/ScrollToTop.tsx` | 62 | 回到顶部按钮：滚动阈值显示与平滑滚动。 | `ScrollToTop` | 外部 react |
| `apps/web/src/components/ThemeToggle.tsx` | 37 | 主题切换按钮（浅色/深色/跟随系统）。 | `ThemeToggle` | 站内别名 1 个（@/components/ui/button）；外部 lucide-react、next-themes、react |
| `apps/web/src/components/admin/main-nav.tsx` | 25 | 后台顶部主导航。 | `MainNav` | 站内别名 1 个（@/lib/utils）；外部 next/image、next/link |
| `apps/web/src/components/admin/search.tsx` | 14 | 后台顶部搜索框。 | `Search` | 站内别名 1 个（@/components/ui/input）；外部 lucide-react |
| `apps/web/src/components/admin/side-nav.tsx` | 71 | 后台侧边导航菜单。 | `SideNav` | 站内别名 3 个（@/components/ui/button、@/components/ui/scroll-area、@/lib/utils）；外部 lucide-react、next/link、next/navigation |
| `apps/web/src/components/admin/user-nav.tsx` | 80 | 后台用户菜单（头像/退出）。 | `UserNav` | 站内别名 3 个（@/components/ui/avatar、@/components/ui/button、@/components/ui/dropdown-menu）；外部 lucide-react、next-auth/react、next-themes |
| `apps/web/src/components/dynamic-metadata.tsx` | 29 | 动态 metadata 注入组件：客户端更新标题/描述。 | `DynamicMetadata` | 相对模块 1 个（./site-provider）；外部 react |
| `apps/web/src/components/icons.tsx` | 160 | 图标集合：导航分类图标表与 Icon 组件。 | `Icons`、`Icon` | 外部 lucide-react |
| `apps/web/src/components/mode-toggle.tsx` | 23 | 明暗模式切换（下拉菜单）。 | `ModeToggle` | 站内别名 1 个（@/registry/new-york/ui/button）；外部 lucide-react、next-themes |
| `apps/web/src/components/site-provider.tsx` | 66 | 站点信息上下文：site.json 配置注入与 useSiteInfo。 | `useSiteInfo`、`SiteProvider` | 站内别名 1 个（@/types/site）；外部 react |
| `apps/web/src/components/theme-provider.tsx` | 8 | 主题 Provider（next-themes）。 | `ThemeProvider` | 外部 next-themes、next-themes/dist/types |
| `apps/web/src/components/theme-toggle.tsx` | 41 | 主题切换按钮。 | `ThemeToggle` | 站内别名 2 个（@/registry/new-york/ui/button、@/registry/new-york/ui/dropdown-menu）；外部 lucide-react、next-themes、react |
| `apps/web/src/components/ui/avatar.tsx` | 50 | 头像原子组件（Radix）。 | — | 站内别名 1 个（@/lib/utils）；外部 @radix-ui/react-avatar、react |
| `apps/web/src/components/ui/badge.tsx` | 36 | 徽标原子组件（多 variant）。 | `BadgeProps` | 站内别名 1 个（@/lib/utils）；外部 class-variance-authority、react |
| `apps/web/src/components/ui/button.tsx` | 56 | 按钮原子组件（variant/size/loading）。 | `ButtonProps` | 站内别名 1 个（@/lib/utils）；外部 @radix-ui/react-slot、class-variance-authority、react |
| `apps/web/src/components/ui/card.tsx` | 79 | 卡片原子组件族（Header/Content/Footer）。 | — | 站内别名 1 个（@/lib/utils）；外部 react |
| `apps/web/src/components/ui/command.tsx` | 155 | 命令面板原子组件（cmdk 封装）。 | — | 站内别名 2 个（@/components/ui/dialog、@/lib/utils）；外部 @radix-ui/react-dialog、cmdk、lucide-react、react |
| `apps/web/src/components/ui/dropdown-menu.tsx` | 200 | 下拉菜单原子组件（Radix）。 | — | 站内别名 1 个（@/lib/utils）；外部 @radix-ui/react-dropdown-menu、lucide-react、react |
| `apps/web/src/components/ui/form.tsx` | 178 | 表单原子组件（react-hook-form 绑定）。 | — | 站内别名 2 个（@/components/ui/label、@/lib/utils）；外部 @radix-ui/react-label、@radix-ui/react-slot、react、react-hook-form |
| `apps/web/src/components/ui/icon-picker.tsx` | 162 | 图标选择器：图标库搜索与预览。 | `IconPicker`、`icons` | 站内别名 5 个（@/components/ui/button、@/components/ui/command、@/components/ui/input…）；外部 lucide-react、react |
| `apps/web/src/components/ui/input.tsx` | 24 | 输入框原子组件。 | `InputProps` | 站内别名 1 个（@/lib/utils）；外部 react |
| `apps/web/src/components/ui/json-editor.tsx` | 199 | JSON 编辑器：语法校验与格式化。 | `JsonEditor` | 外部 @monaco-editor/react、next-themes、react |
| `apps/web/src/components/ui/label.tsx` | 26 | 表单标签原子组件。 | — | 站内别名 1 个（@/lib/utils）；外部 @radix-ui/react-label、class-variance-authority、react |
| `apps/web/src/components/ui/popover.tsx` | 31 | 气泡浮层原子组件（Radix）。 | — | 站内别名 1 个（@/lib/utils）；外部 @radix-ui/react-popover、react |
| `apps/web/src/components/ui/scroll-area.tsx` | 48 | 自定义滚动区域原子组件。 | — | 站内别名 1 个（@/lib/utils）；外部 @radix-ui/react-scroll-area、react |
| `apps/web/src/components/ui/search-input.tsx` | 33 | 带清除按钮的搜索输入框。 | `SearchInputProps` | 站内别名 2 个（@/components/icons、@/lib/utils）；外部 react |
| `apps/web/src/components/ui/separator.tsx` | 31 | 分隔线原子组件。 | — | 站内别名 1 个（@/lib/utils）；外部 @radix-ui/react-separator、react |
| `apps/web/src/components/ui/skeleton.tsx` | 16 | 骨架屏原子组件。 | — | 站内别名 1 个（@/lib/utils） |
| `apps/web/src/components/ui/table.tsx` | 114 | 表格原子组件族。 | — | 站内别名 1 个（@/lib/utils）；外部 react |
| `apps/web/src/components/ui/tabs.tsx` | 55 | 标签页原子组件（Radix）。 | — | 站内别名 1 个（@/lib/utils）；外部 @radix-ui/react-tabs、react |
| `apps/web/src/components/ui/textarea.tsx` | 23 | 多行输入原子组件。 | `TextareaProps` | 站内别名 1 个（@/lib/utils）；外部 react |
| `apps/web/src/components/ui/toast.tsx` | 127 | Toast 原子组件（Radix）。 | — | 站内别名 1 个（@/lib/utils）；外部 @radix-ui/react-toast、class-variance-authority、lucide-react、react |
| `apps/web/src/components/ui/toaster.tsx` | 35 | Toast 渲染出口。 | `Toaster` | 站内别名 2 个（@/components/ui/toast、@/components/ui/use-toast） |
| `apps/web/src/components/ui/tooltip.tsx` | 36 | 文字提示原子组件（Radix）。 | — | 站内别名 1 个（@/lib/utils）；外部 @radix-ui/react-tooltip、react |
| `apps/web/src/components/ui/use-toast.ts` | 191 | Toast 状态机 hook（reducer + 队列 + 自动消失）。 | `reducer` | 站内别名 1 个（@/components/ui/toast）；外部 react |
| `apps/web/src/config/site.ts` | 22 | 站点配置读取：从 site.json 快照解析并带默认值。 | `getSiteConfig`、`siteConfig` | 站内别名 1 个（@/types/site） |
| `apps/web/src/hooks/useNavigationItems.ts` | 46 | 导航条目 hook：拉取并缓存首页条目。 | `useNavigationItems` | 站内别名 1 个（@/types/navigation）；外部 swr |
| `apps/web/src/lib/api.ts` | 67 | 导航数据客户端：删除/更新导航与排序的 fetch 封装。 | `deleteNavigation`、`updateNavigation`、`updateNavigationOrder` | 站内别名 1 个（@/types/navigation） |
| `apps/web/src/lib/buffer-utils.ts` | 16 | Buffer 工具：Uint8Array/字符串转 Base64（服务端与边缘运行时通用）。 | `uint8ArrayToBase64`、`stringToBase64` | — |
| `apps/web/src/lib/data-loader.ts` | 104 | 首页数据加工：原始 navigation/site JSON → 领域模型，含过滤与图标路径解析。 | `processSiteData`、`processNavigationSubItem`、`processNavigationData`、`filterNavigationData`、`getProcessedData` | 站内别名 2 个（@/types/navigation、@/types/site） |
| `apps/web/src/lib/icons.ts` | 115 | 图标名称映射表（上游版）。 | `navigationIcons`、`IconType` | 外部 lucide-react |
| `apps/web/src/lib/navigation-tree.ts` | 133 | 导航树工具：扁平列表↔树、查找与排序。 | `findItemLocation`、`moveItem`、`moveSubCategory`、`ItemLocation` | 站内别名 1 个（@/types/navigation） |
| `apps/web/src/lib/polyfills.ts` | 8 | 运行时 polyfill（旧浏览器/边缘环境兼容）。 | — | — |
| `apps/web/src/lib/utils.ts` | 8 | 通用工具：cn 类名合并与杂项。 | `cn` | 外部 clsx、tailwind-merge |
| `apps/web/src/navsphere/content/navigation-default.json` | 1395 | 默认导航数据：首次启动/恢复出厂时使用。 | — | — |
| `apps/web/src/navsphere/content/navigation.json` | 1575 | 导航数据快照（NavSphere 兼容格式）：分类与站点条目的持久化载体。 | — | — |
| `apps/web/src/navsphere/content/resource-metadata.json` | 161 | 资源元数据快照：资源分组与条目图标/描述。 | — | — |
| `apps/web/src/navsphere/content/site.json` | 15 | 站点全局配置快照：标题、描述、主题、页脚与外观。 | — | — |
| `apps/web/src/navsphere/content/videos.json` | 89 | 视频导航数据快照：视频分类与条目。 | — | — |
| `apps/web/src/registry/new-york/hooks/use-mobile.tsx` | 20 | 响应式断点 hook：判断是否移动端视口。 | `useIsMobile` | 外部 react |
| `apps/web/src/registry/new-york/hooks/use-toast.ts` | 195 | shadcn Toast 状态机 hook。 | `reducer` | 站内别名 1 个（@/registry/new-york/ui/toast）；外部 react |
| `apps/web/src/registry/new-york/lib/utils.ts` | 7 | shadcn 工具：clsx + tailwind-merge 的 cn()。 | `cn` | 外部 clsx、tailwind-merge |
| `apps/web/src/services/ResourceService.ts` | 19 | 资源服务：resource-metadata 的读取、写入与引用校验封装。 | `ResourceService` | — |
| `apps/web/src/services/siteConfigService.ts` | 43 | 站点配置服务：site.json 的读取与更新封装。 | `SiteConfigService` | 站内别名 1 个（@/types/site） |
| `apps/web/src/types/dnd.d.ts` | 99 | 拖拽库类型补充声明。 | `DragDropContext`、`Droppable`、`Draggable`、`DraggableProvided`、`DroppableProvided`、`DraggableStateSnapshot`、`DraggableRubric`、`DropResult`… | 外部 react |
| `apps/web/src/types/env.d.ts` | 8 | 环境变量类型声明。 | — | — |
| `apps/web/src/types/resource-metadata.ts` | 9 | 资源元数据类型定义。 | `ResourceMetadata` | — |
| `apps/web/src/types/session.ts` | 9 | 会话类型定义（next-auth session 扩展）。 | `SessionData` | — |
| `apps/web/src/types/site.ts` | 31 | 站点配置类型定义（basic/appearance/features）。 | `SiteConfig`、`SiteInfo` | — |
| `apps/web/src/utils/cn.ts` | 7 | 类名合并工具（clsx + tailwind-merge）。 | `cn` | 外部 clsx、tailwind-merge |

## 8. `extensions` — 浏览器与桌面扩展（8 个文件）

Chrome MV3 扩展（地址栏检索 + 一键收录）与 Raycast 扩展（全局检索 + Markdown 复制）。

| 文件 | 行数 | 职责与实现要点 | 关键导出 | 主要依赖 |
| :--- | ---: | :--- | :--- | :--- |
| `extensions/chrome-extension/README.md` | 24 | Chrome 扩展安装与 Token 配置说明。 | — | — |
| `extensions/chrome-extension/background.js` | 67 | Chrome 扩展 Service Worker：omnibox 地址栏「nh + 关键词」快捷检索，复用同一份 apiUrl/token 配置。 | — | — |
| `extensions/chrome-extension/manifest.json` | 27 | Chrome Manifest V3 清单：权限、omnibox 关键字、action 弹窗与图标声明。 | — | — |
| `extensions/chrome-extension/popup.html` | 202 | 扩展弹窗界面：搜索框、结果列表、当前页收录按钮与配置区（无内联脚本，符合 MV3 CSP）。 | — | — |
| `extensions/chrome-extension/popup.js` | 257 | 扩展弹窗逻辑：调用中枢搜索/富化收录，全部 createElement + textContent 渲染以防 XSS，token 存 chrome.storage.local。 | — | — |
| `extensions/raycast-extension/README.md` | 26 | Raycast 扩展安装与偏好配置说明。 | — | — |
| `extensions/raycast-extension/package.json` | 60 | Raycast 扩展清单：命令、偏好项（apiToken/webUrl）与依赖声明。 | — | — |
| `extensions/raycast-extension/src/search-navhub.tsx` | 103 | Raycast 命令：全局模糊检索 NavHub 站点，支持一键复制 Markdown 链接与打开详情。 | `SearchNavHub` | 外部 @raycast/api、react |

## 9. `scripts` — 工程自动化（21 个文件，2,431 行）

vendor/overlay 同步与漂移校验、备份、数据治理、PWA 图标、Git 钩子、推仓与统一验证。

| 文件 | 行数 | 职责与实现要点 | 关键导出 | 主要依赖 |
| :--- | ---: | :--- | :--- | :--- |
| `scripts/backup-pg.mjs` | 120 | PostgreSQL 备份脚本：调用 pg_dump 生成归档。 | — | — |
| `scripts/backup.mjs` | 132 | SQLite 数据库备份脚本：一致性快照 + 时间戳归档。 | — | 外部 node:module |
| `scripts/check-extensions.mjs` | 133 | 扩展规范性校验（CI 门禁）：校验 MV3 清单、资源存在性与 JS 语法、Raycast 包结构与入口文件。 | — | — |
| `scripts/check-upstream-ref.mjs` | 71 | 上游底座 ref 一致性校验：比对 vendor-web 的 DEFAULT_REF、Dockerfile.web 的 ARG 与 UPSTREAM.md 记录，保证构建可复现。 | — | — |
| `scripts/check-web-overlay.mjs` | 95 | 覆盖层一致性闸门：正向严格校验 overlay→apps/web 每个文件存在且内容一致，反向仅告警，防止自研改动在重新 vendor 时丢失。 | — | 相对模块 1 个（./lib/overlay-drift.mjs） |
| `scripts/d1-regression.mjs` | 85 | Cloudflare D1 方言回归脚本：验证 SQL 在 D1 上的兼容性。 | — | — |
| `scripts/data-retention.mjs` | 371 | 数据保留/聚合的运维 CLI：按策略调用 retention 与 rollup。 | — | 相对模块 2 个（../packages/store/src/retention.ts、../packages/store/src/rollup.ts）；外部 node:module、node:stream/promises |
| `scripts/dev-all.mjs` | 92 | 并行启动中枢与前端开发服务，统一前缀日志与退出信号。 | — | — |
| `scripts/gen-pwa-icons.mjs` | 62 | 从品牌色程序化生成 PWA 图标（192/512/maskable/apple-touch），避免位图放大模糊。 | — | 外部 node:module |
| `scripts/install-git-hooks.mjs` | 48 | 安装本地 Git pre-commit 钩子：提交前拦截 overlay 未同步与扩展配置错误。 | — | — |
| `scripts/lib/overlay-drift.mjs` | 141 | 覆盖层漂移比对纯逻辑：排除规则、CRLF 归一化、SHA-256 内容比对、双向差异与孤儿文件发现（可单测）。 | `isExcluded`、`isBinary`、`sha256`、`normText`、`sameContent`、`walkTree`、`diffOverlay`、`findOwnedOrphans` | — |
| `scripts/lib/overlay-drift.test.ts` | 218 | 漂移比对纯逻辑单测：排除规则、CRLF 归一化、内容比对与孤儿文件发现。 | `x`、`v` | 相对模块 1 个（./overlay-drift.mjs）；外部 vitest |
| `scripts/lib/walk-copy.mjs` | 111 | 逐文件拷贝实现：规避 Windows 递归 cpSync 的 EIO 与符号链接报错，跳过安装产物。 | `walkAndCopy` | — |
| `scripts/lib/walk-copy.test.ts` | 167 | 逐文件拷贝单测：跳过 node_modules、符号链接处理与目录创建。 | — | 相对模块 1 个（./walk-copy.mjs）；外部 vitest |
| `scripts/pg-check.mts` | 100 | PostgreSQL 手工连通性与 SQL 冒烟检查脚本。 | — | 相对模块 1 个（../apps/api/src/index.ts） |
| `scripts/push-to-github.bat` | 35 | Windows 一键推仓脚本：绑定远端、建 main 分支、提交并推送。 | — | — |
| `scripts/push-to-github.sh` | 38 | macOS/Linux 一键推仓脚本（同 bat 语义）。 | — | — |
| `scripts/run.mjs` | 32 | pnpm filter 启动包装器：定位 workspace 包并转发 dev 命令。 | — | — |
| `scripts/sync-web-overlay.mjs` | 134 | 把 apps/web 中「与上游不同或上游没有」的文件精确同步进 web-overlay，保证 overlay 是自研改动的完整集合。 | — | — |
| `scripts/vendor-web.mjs` | 216 | 下载上游 NavSphere tarball 覆盖 apps/web，再回放 web-overlay 自研改动，实现「底座升级 + 改动保留」。 | — | 相对模块 1 个（./lib/walk-copy.mjs） |
| `scripts/verify.mjs` | 30 | 统一验证入口：串行执行类型检查、overlay 一致性、扩展校验与单元测试。 | — | — |

### 样式文件

| 文件 | 行数 | 职责与实现要点 | 关键导出 | 主要依赖 |
| :--- | ---: | :--- | :--- | :--- |
| `apps/web-overlay/src/styles/globals.css` | 460 | 全局样式与设计令牌：Tailwind 指令、CSS 变量（颜色/圆角/阴影）、Bento 卡片与动效基类。 | — | — |
| `apps/web-overlay/src/styles/reduced-motion.css` | 37 | prefers-reduced-motion 适配：保留状态变化、去除位移/缩放/脉冲动画（WCAG 2.3.3）。 | — | — |
| `apps/web-overlay/src/styles/skip-link.css` | 46 | 跳过导航链接样式：隐藏态与 focus 态分离，避免覆盖布局（WCAG 2.4.1）。 | — | — |

| 文件 | 行数 | 职责与实现要点 | 关键导出 | 主要依赖 |
| :--- | ---: | :--- | :--- | :--- |
| `apps/web/src/app/styles/admin.css` | 31 | 后台专用样式：表格、表单与侧栏。 | — | — |
| `apps/web/src/app/styles/navigation.css` | 534 | 导航前台样式：分类区块、卡片网格与响应式断点。 | — | — |
| `apps/web/src/styles/globals.css` | 460 | 全局样式与设计令牌：Tailwind 指令、CSS 变量（颜色/圆角/阴影）、Bento 卡片与动效基类。 | — | — |
| `apps/web/src/styles/reduced-motion.css` | 37 | prefers-reduced-motion 适配：保留状态变化、去除位移/缩放/脉冲动画（WCAG 2.3.3）。 | — | — |
| `apps/web/src/styles/skip-link.css` | 46 | 跳过导航链接样式：隐藏态与 focus 态分离，避免覆盖布局（WCAG 2.4.1）。 | — | — |

## 10. shadcn/ui 原子组件（`apps/web/src/registry/new-york/ui`，46 个）

这一层是上游脚手架引入的无样式业务原子件，全部由 Radix UI 原语 + CVA 变体封装，仅负责可访问性与视觉令牌，不含业务逻辑；业务组件通过 `@/components/ui/*` 再导出使用。

| 文件 | 职责 |
| :--- | :--- |
| `accordion.tsx` | 折叠面板（单/多开） |
| `alert.tsx` | 行内提示条（info/warning/error） |
| `alert-dialog.tsx` | 确认对话框（危险操作） |
| `aspect-ratio.tsx` | 固定宽高比容器 |
| `avatar.tsx` | 头像与兜底占位 |
| `badge.tsx` | 状态徽标 |
| `breadcrumb.tsx` | 面包屑导航 |
| `button.tsx` | 按钮（variant/size/asChild） |
| `card.tsx` | 卡片容器族 |
| `carousel.tsx` | 轮播（Embla） |
| `chart.tsx` | 图表容器与 tooltip 封装（Recharts） |
| `checkbox.tsx` | 复选框 |
| `collapsible.tsx` | 可折叠区域 |
| `command.tsx` | 命令面板（cmdk） |
| `context-menu.tsx` | 右键菜单 |
| `dialog.tsx` | 模态对话框 |
| `drawer.tsx` | 底部/侧边抽屉（Vaul） |
| `dropdown-menu.tsx` | 下拉菜单 |
| `form.tsx` | react-hook-form 绑定与错误提示 |
| `hover-card.tsx` | 悬停卡片 |
| `input.tsx` | 输入框 |
| `input-otp.tsx` | OTP 输入框 |
| `label.tsx` | 表单标签 |
| `menubar.tsx` | 菜单栏 |
| `navigation-menu.tsx` | 导航菜单 |
| `pagination.tsx` | 分页器 |
| `popover.tsx` | 气泡浮层 |
| `progress.tsx` | 进度条 |
| `radio-group.tsx` | 单选组 |
| `resizable.tsx` | 可拖拽分栏 |
| `scroll-area.tsx` | 自定义滚动区 |
| `select.tsx` | 下拉选择 |
| `separator.tsx` | 分隔线 |
| `sheet.tsx` | 侧滑面板 |
| `skeleton.tsx` | 骨架屏 |
| `slider.tsx` | 滑块 |
| `sonner.tsx` | Sonner Toast 出口 |
| `switch.tsx` | 开关 |
| `table.tsx` | 表格族 |
| `tabs.tsx` | 标签页 |
| `textarea.tsx` | 多行输入 |
| `toast.tsx` | Toast 原语 |
| `toaster.tsx` | Toast 渲染器 |
| `toggle.tsx` | 切换按钮 |
| `toggle-group.tsx` | 切换按钮组 |
| `tooltip.tsx` | 文字提示 |

## 11. `e2e`、`docker`、`docs` 与扩展资源

| 文件 | 职责 |
| :--- | :--- |
| `e2e/admin-dashboard.spec.ts` | 后台仪表盘端到端：登录、指标与 SSE |
| `e2e/admin-jobs.spec.ts` | 任务队列端到端：入队与状态流转 |
| `e2e/admin-token.spec.ts` | Token 签发/吊销端到端 |
| `e2e/daypart-hydration.spec.ts` | 首屏时段提示水合一致性 |
| `e2e/dialog-in-viewport.spec.ts` | 弹窗视口可见性 |
| `e2e/diy-shared-state.spec.ts` | DIY 布局跨标签共享 |
| `e2e/front-pages.spec.ts` | 前台页面可达性 |
| `e2e/search.spec.ts` | 搜索交互 |
| `e2e/workbench.spec.ts` | 模块工作台增删拖拽与持久化 |
| `docker/Dockerfile.api` | API 生产镜像：多阶段构建、仅保留生产依赖、非 root 运行 |
| `docker/Dockerfile.web` | Web 生产镜像：vendor 上游 + 回放 overlay，Next standalone 输出 |
| `docker/docker-compose.yml` | 生产编排：lite/standard 双 profile、健康检查、卷与网络 |
| `docker/entrypoint.sh` | API 容器入口：等待 DB、迁移、可选 seed |
| `docker/entrypoint-web.sh` | Web 容器入口：注入中枢地址并启动 standalone server |
| `docs/UPGRADE-PLAN-2026-10-16.md` | 升级改造总方案（P0~P3 任务分解） |
| `docs/UPGRADE-EXECUTION-REPORT-2026-10-17.md` | 升级执行报告与验收结论 |
| `docs/UPGRADE-RECOMMENDATIONS-2026-10-16.md` | 升级建议清单与优先级 |
| `docs/AUDIT_VERIFICATION_2026-10-16.md` | 安全审计核验记录 |
| `docs/P3-COMPLETION-REPORT-2026-10-16.md` | P3 阶段完成报告 |
| `docs/acceptance-report.md` | 验收报告 |
| `docs/navigation-enhancement-plan.md` | 导航能力增强计划 |
| `docs/research-notes.md` | 技术调研笔记 |
| `docs/research-taxonomy-upgrade.md` | 分类体系升级调研 |
| `docs/security-notes.md` | 安全设计与威胁模型笔记 |
