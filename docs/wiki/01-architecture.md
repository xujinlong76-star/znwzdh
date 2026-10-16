# 01 · 项目整体架构

## 1. 项目定位

**NavHub** 是一款 AI 原生的网址导航系统，四条核心能力：

1. **本地中文语义检索**——ONNX 本地 embedding（`bge-small-zh-v1.5`），不外发数据
2. **拼音 / 关键词混合召回**——五路通道 RRF 融合
3. **AI 自动富化入库**——抓取网页 → LLM 抽取标题/描述/标签/分类（缺 Key 时降级启发式）
4. **MCP Server**——让 AI Agent 通过标准协议直接读写导航数据

底座来自 [NavSphere](https://github.com/tianyaxiang/NavSphere)（MIT），NavHub 在它的**存储接缝**上做替换与扩展，而非重写。

## 2. 整体架构图

```
┌─────────────────────────── 客户端层 ───────────────────────────┐
│  apps/web (Next.js 15)      extensions/ (Chrome / Raycast)    │
│  PWA + Service Worker       AI 客户端 (Claude Desktop/Cursor) │
└──────────────┬──────────────────────┬─────────────────────────┘
               │ STORAGE_ADAPTER=http │ MCP stdio / HTTP
               │ + /api/hub/* 代理    │ + Bearer token
┌──────────────▼──────────────────────▼─────────────────────────┐
│                      apps/api (Fastify 5)                     │
│  ┌──────────────┐ ┌────────────────┐ ┌──────────────────────┐  │
│  │ REST 路由×42 │ │ 存储兼容 API    │ │ JobRunner (4 任务)   │  │
│  │ /api/*       │ │ /api/storage   │ │ 30s 轮询 + 单实例锁  │  │
│  └──────┬───────┘ └───────┬────────┘ └──────────┬───────────┘  │
│         └───────── AppContext (context.ts) ─────┘             │
└────────────────────────────┬──────────────────────────────────┘
        ┌────────────────────┼─────────────────────┐
┌───────▼────────┐  ┌────────▼─────────┐  ┌────────▼──────────┐
│ @navhub/ai     │  │ @navhub/store    │  │ packages/mcp      │
│ embedding      │  │ Repository       │  │ 15 tools          │
│ SSRF guarded   │  │ SearchEngine     │  │ scope/idempotency │
│ LLM enrich     │  │ VectorStore ×3   │  │ audit             │
└────────────────┘  │ FullTextStore ×2 │  └───────────────────┘
                    │ openDb(sqlite|pg)│
                    └────────┬─────────┘
                             │ 全部依赖
                    ┌────────▼─────────┐
                    │ @navhub/core     │
                    │ 领域模型/分词/拼音│
                    │ RRF 融合/排序/画像│
                    └──────────────────┘
```

## 3. 目录结构

```
c:\Users\许进龙\Desktop\web\
├── apps/
│   ├── api/                 Fastify 中枢（REST + 存储兼容 API + 种子数据 + 任务队列）
│   ├── web/                 Next.js 15 前端（vendored NavSphere 底座 + NavHub 覆盖）
│   └── web-overlay/         NavHub 自有覆盖文件的源（同步到 apps/web）
├── packages/
│   ├── core/                领域层：模型 / CJK 分词 / 拼音 / RRF / 排序 / 画像 / 扩展算法
│   ├── store/               存储层：schema + 双驱动 + Repository + 检索引擎 + 向量/全文
│   ├── ai/                  能力层：ONNX embedding + SSRF 抓取 + LLM 富化
│   └── mcp/                 Agent 层：MCP Server（stdio + HTTP）
├── extensions/
│   ├── chrome-extension/    Chrome 扩展（omnibox 搜索 + popup 管理）
│   └── raycast-extension/   Raycast 扩展（快速检索）
├── docker/                  Dockerfile.api / Dockerfile.web / compose（4 profile）
├── scripts/                 运行、vendoring、图标生成、回归校验脚本
├── docs/                    验收报告 / 增强规划 / 调研笔记 / wiki（本套）
├── data/                    运行时数据：navhub.db + 本地 embedding 模型缓存
├── types/                   sqlite-vec 类型声明
├── docker-compose.yml       根 compose（api + web 双服务，简版）
├── Dockerfile               根 Dockerfile
├── pnpm-workspace.yaml      workspace 声明 + allowBuilds + zod v3 overrides
├── vitest.config.ts         测试配置（排除 apps/web）
└── tsconfig.base.json       TS 基础配置
```

## 4. 两种运行模式

模式由 `NAVHUB_MODE` 决定，在 [config.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/config.ts#L12) 定义、在 [context.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/context.ts#L37) 被消费——**这是双模式差异被消化掉的唯一位置**。

| 维度 | `lite`（默认） | `standard` |
| --- | --- | --- |
| 数据库 | SQLite（`better-sqlite3`） | PostgreSQL（`pg`） |
| 必需配置 | `NAVHUB_SQLITE_PATH`（默认 `./data/navhub.db`） | `NAVHUB_DATABASE_URL`（缺则**启动即报错**） |
| 向量索引 | sqlite-vec（`vec0` 虚拟表，整数键 + 站点映射重水化） | pgvector（HNSW） |
| 全文检索 | FTS5 + CJK 二元分词 | tsvector + GIN 表达式索引 + pg_trgm |
| 单实例锁 | `idempotency` 表持久锁行（TTL 120s） | PostgreSQL advisory lock（`728501001`） |
| 适用 | 个人 / NAS，单容器零外部依赖 | 公开站 / 企业内部，多用户 |

## 5. 关键设计决策（Why）

### 5.1 存储接缝：把改造点压缩到 2 个函数

NavSphere 全站持久化只经过两个函数（[github.ts](file:///c:/Users/许进龙/Desktop/web/apps/web/src/lib/github.ts#L133-L179)）：

```
getFileContent(path)              -> 读 JSON
commitFile(path, content, ...)    -> 写 JSON
```

数据落在 3 个文件（`navigation.json` / `site.json` / `resource-metadata.json`），共 **69 处调用点**。NavHub **不改那 69 处**，只把这两个函数的实现换成「按 `STORAGE_ADAPTER` 选择后端」：

| 适配器 | 数据存哪 | 适用 |
| --- | --- | --- |
| `github` | 你自己的 GitHub 仓库（原版行为） | 零成本、无需服务器 |
| `http` | NavHub 中枢（**默认**） | 自建，获得 AI 检索能力 |
| `sqlite` | 同进程直连数据库 | 单机部署（**不适用于 Web 前端**，仅 API 侧） |

服务端对应实现是 [storage.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/storage.ts)：把 JSON 文件语义翻译成数据库语义。

### 5.2 能力可选、失败不致命

`createContext` 的装配策略是「能力可选、失败不致命」（[context.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/context.ts#L7-L11)）：

| 缺失能力 | 降级行为 | 上报位置 |
| --- | --- | --- |
| sqlite-vec 加载失败 | 退化为 `MemoryVectorStore`，无语义通道 | `capabilities.notes` |
| embedding 模型缺失 | 同上，关键词/拼音/全文三路照常 | `capabilities.semantic` |
| FTS5 不可用 | 全文通道返回空，不影响其他通道 | `capabilities.fts` |
| 无 LLM API Key | 富化走启发式，结果标 `provenance: "heuristic"` | `capabilities.llm` |

这套降级路径有测试覆盖（关闭 embedding 后搜索仍必须可用）。所有状态可在 `GET /api/health` 查看。

### 5.3 个性化是「一路通道」而非「事后加成」

RRF 的 k=60 会把靠前名次压得非常接近：

```
rrf(1)  = 1/61 = 0.01639
rrf(8)  = 1/68 = 0.01471   -> 仅差 11%
```

任何 ≥11% 的事后加成都能把排 8 顶到排 1——「越用越懂你」会退化成「搜什么都搜不到」。因此 [fusion.ts](file:///c:/Users/许进龙/Desktop/web/packages/core/src/fusion.ts#L94-L103) 把个性化做成一路权重 **0.3** 的通道（相关性通道 0.9~1.4），翻转能力被权重天然限界，且能通过 `contributions` 解释「它为什么排这儿」。

### 5.4 schema 只用双库共支持的列类型

[schema.ts](file:///c:/Users/许进龙/Desktop/web/packages/store/src/schema.ts#L3-L9) 只使用 `integer / real / text / blob`，**不引入任何方言特定类型**。向量与全文索引由适配器层用虚拟表/扩展对象实现。代价是向量列在 schema 里「看不见」，收益是同一份表定义同时跑两种数据库，方言差异收敛到 `driver.ts` 与 `vector/`。

### 5.5 启动入口独立成 main.ts

[main.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/main.ts#L3-L8) 导入即启动，**不依赖主模块判断**——Windows 上 `process.argv[1]` 与 `import.meta.url` 路径形式不一致会导致脚本静默退出且无输出，比报错更难排查。

## 6. 模块依赖关系

### 6.1 workspace 依赖图

```
@navhub/core     ← 无 workspace 依赖（底层，依赖 zod + pinyin-pro）
    ▲
    ├── @navhub/store   (+ drizzle-orm, better-sqlite3, sqlite-vec, pg)
    ├── @navhub/ai      (+ @huggingface/transformers, zod)
    │
    ├── @navhub/api     ← @navhub/core + @navhub/store + @navhub/ai
    │       ▲           (+ fastify, @fastify/cors, @fastify/rate-limit)
    │       │
    └── @navhub/mcp     ← @navhub/api + core + store + ai
                          (+ @modelcontextprotocol/sdk, zod-to-json-schema)

apps/web (navsphere)    ← 独立（不 import 任何 @navhub/* 包，走 HTTP）
                          仅在 storage-adapter 的 sqlite 直连模式提到 @navhub/api（构建期排除）
```

### 6.2 关键点

- **`@navhub/api` 的 `index.ts` 是可复用出口**（[index.ts](file:///c:/Users/许进龙/Desktop/web/apps/api/src/index.ts#L1-L10)）：导出 `config / context / server / storage`，让 MCP 包与 HTTP 服务共用同一套上下文装配——保证两条入口的检索与写入行为完全一致，不会出现「两套逻辑算出两个答案」。
- **`apps/web` 不 import `@navhub/*`**：前端通过 `STORAGE_ADAPTER=http` + `/api/hub/*` 运行时代理访问中枢，保持前后端解耦（vendored 上游不被打包中枢代码）。
- **`pnpm` 严格布局**：原生依赖必须是直接依赖——`sqlite-vec` 必须写在 `apps/api` 的 `dependencies` 里，否则不会因 `@navhub/store` 依赖它而暴露给 API。

## 7. 核心数据流

### 7.1 一次搜索请求

```
用户输入「写代码的AI」
  │
  ▼  SearchPalette 防抖 + AbortController
apps/web → GET /api/hub/search?q=...        (同源代理)
  │
  ▼  next.config 运行时转发到中枢
apps/api  server.ts  GET /api/search        (限流 120/min)
  │      ├─ 解析身份 → refreshUserProfile（7 天半衰期画像，带节流）
  │      ├─ 记录 search_history + events
  ▼
SearchEngine.search()                        packages/store/search.ts
  │  Promise.all 并行四路（每路 50 条）
  │    ├─ channelExact    LIKE 子串（含 pinyin_full / pinyin_initials）
  │    ├─ channelFts      FullTextStore.search() → BM25
  │    ├─ channelPinyin   全拼/首字母前缀匹配
  │    └─ channelSemantic embed(q) → VectorStore.search() KNN
  │  + personalCandidates()（若 personalize 信号存在，且只作用于已被召回站点）
  │  + postFilter()：状态/分类（含 anchor 后代）/标签过滤
  ▼
fuse(candidates, weights, pool)              packages/core/fusion.ts
  │  score = Σ w_ch / (k + rank)  ，k=60
  │  × (1 + 0.35 × log2(coverage))  coverage 只统计相关性通道
  ▼
SearchResult { hits, channelsUsed, semanticAvailable, tookMs }
  │
  ▼  hits 携带 contributions（每路 rank + value）
响应给前端 / MCP / 扩展
```

### 7.2 一次站点写入（MCP 为例）

```
MCP create_site (scope=write)
  ├─ requireScope 校验（只读 token 直接拒绝）
  ├─ CreateSiteInput.parse（zod）
  ├─ withIdempotency(idempotencyKey)  → 命中直接回放上次结果
  ├─ findSiteByUrl 去重 → 已存在则返回既有站点（非报错）
  ├─ repo.createSite()
  ├─ guardedFetch + enrichUrl（LLM 或启发式 → provenance）
  ├─ indexSite()：embedding → vectors.upsert + repo.saveEmbedding（失败不阻断）
  └─ repo.audit({ actor: "mcp:<身份>", action: "create_site", ... })
```

### 7.3 前端保存导航快照

```
前端 admin 拖拽排序完成
  → commitFile("src/navsphere/content/navigation.json", data)
  → StorageAdapter (http) → PUT /api/storage
  → writeNavigationData(ctx, data)
       按 source 过滤删除范围（D1 缺陷修复）：
         {null, navsphere, seed} 按快照管理；
         api / mcp / ai 创建的站点不被静默删除
  → 按 sort 全量对齐 categories + sites
```

## 8. 技术栈清单

| 层 | 技术 | 版本 | 说明 |
| --- | --- | --- | --- |
| 运行时 | Node.js | ≥ 20（Docker 用 22） | `--experimental-strip-types` 直跑 TS |
| 包管理 | pnpm workspace | — | `allowBuilds` 白名单 + zod v3 统一 override |
| 后端框架 | Fastify | 5.12.5 | + `@fastify/cors` + `@fastify/rate-limit` |
| 前端框架 | Next.js (App Router) | 15.5.28 | React 19.3.1（2026-10-16 由 18.2 升级，recharts 同步到 3.x），vendored NavSphere |
| 前端 UI | Radix UI + Tailwind CSS 4 | — | shadcn 风格组件集 |
| ORM | Drizzle ORM | 0.45.4 | schema 双驱动共享（`drizzle-kit` 生成） |
| 数据库 | better-sqlite3 / pg | 13.0.3 / 8.23.1 | lite / standard |
| 向量 | sqlite-vec / pgvector | 0.1.9 / pg17 | HNSW（PG） |
| Embedding | @huggingface/transformers | 4.3.1 | 本地 ONNX `bge-small-zh-v1.5`（512 维，q8） |
| 拼音 | pinyin-pro | 3.29.5 | 全拼 + 首字母 |
| 校验 | zod | ^3.25.76 | 全仓统一 v3 |
| Agent 协议 | @modelcontextprotocol/sdk | 1.32.1 | stdio + HTTP 双传输 |
| 测试 | vitest | 4.1.11 | `pool: "forks"`，超时 30s/60s |

## 9. 质量保障

- **测试**：653 个测试（+ 10 个 PostgreSQL 跨方言用例，设 `NAVHUB_TEST_DATABASE_URL` 时运行，否则 skip），`pnpm test`（套件清单见 [09-run-and-test.md](./09-run-and-test.md)）
- **类型检查**：`pnpm typecheck`（`packages/*` + `apps/api` 严格 tsc；`apps/web` 因上游依赖组合问题在 next.config 中忽略）
- **验收**：PostgreSQL 分档验证 17/17 通过，见 [docs/acceptance-report.md](../acceptance-report.md)
- **回归**：D1 缺陷（navigation.json 全量对齐误删）有专门回归测试与脚本 `scripts/d1-regression.mjs`
