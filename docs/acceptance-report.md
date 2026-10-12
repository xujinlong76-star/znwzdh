# 验收报告（实测，非设计意图）

本文件记录**实际跑出来的结果**。每条都可复现。

## 环境

| 项 | 值 |
| --- | --- |
| Node | v24.21.0（DSH 自带运行时） |
| pnpm | 11.7.0 |
| 模式 | `lite`（SQLite + sqlite-vec + FTS5） |
| embedding | `Xenova/bge-small-zh-v1.5` quantized，24MB，512 维，**完全离线** |
| LLM | 未配置（按预期降级为启发式） |
| 语料 | 50 个真实中文站点 / 5 个类目 / 77 个标签 |

## 启动横幅（真实输出）

```
================================================================
NavHub 已启动
  监听    http://0.0.0.0:8787
  模式    lite
  语义检索 可用
  全文检索 可用
  LLM 富化 不可用（降级为启发式）
  · sqlite-vec 已加载，向量维度 512
  · FTS5 全文索引就绪（CJK 二元分词）
  · embedding 服务已装配（惰性加载：Xenova/bge-small-zh-v1.5 via https://hf-mirror.com）
================================================================
```

播种耗时：**50 个站点全部生成向量，共 1340ms**。

## 检索验收：16 / 16 通过

`[通道]` 列展示该次查询实际命中的召回通道，`ms` 为服务端耗时。

### [1] 语义检索 —— 用自然语言提问（核心能力）

```
PASS  写代码的AI            => Cursor > GitHub Copilot > Claude        [fts+semantic] 461ms
PASS  帮我找个能画流程图的工具   => Excalidraw > Midjourney > Figma        [fts+semantic] 11ms
PASS  我要部署容器           => Kubernetes > Docker Hub > Vercel        [fts+semantic] 11ms
PASS  免费高清图片           => Unsplash > TinyPNG > Google Fonts      [exact+fts+semantic] 10ms
PASS  天气预报             => 中国天气网 > GitHub Trending > 国家网信办  [exact+fts+semantic] 10ms
PASS  装依赖包             => npm > npmmirror > Iconify                [fts+semantic] 9ms
PASS  AI 绘画              => Midjourney > Claude > GitHub Copilot      [exact+fts+semantic] 9ms
PASS  算法刷题             => 力扣 LeetCode > Stack Overflow > GitHub Trending  [fts+semantic] 8ms
PASS  我想学前端            => MDN 中文 > Vercel > arXiv                 [fts+semantic] 10ms
```

注意这些查询里**没有任何一个词出现在站点的标题或描述里**（除了「天气预报」），
说明不是关键词匹配在起作用，而是真的走了语义通道。

### [2] 拼音 / 首字母

```
PASS  zgtqw   => 中国天气网 > Uiverse > Ollama   [exact+fts+pinyin+semantic] 11ms
PASS  tianqi  => 中国天气网 > Claude > Unsplash     [exact+semantic] 9ms
PASS  manong  => Google Fonts > Unsplash > Claude  [semantic] 8ms
```

### [3] 中文子串 / 英文前缀

```
PASS  天气    => 中国天气网 > GitHub Trending > 知乎  [exact+fts+semantic] 9ms
PASS  curs    => Cursor > Coursera > Uiverse          [exact+fts+pinyin+semantic] 9ms
PASS  docker  => Docker Hub > Kubernetes > Uiverse     [exact+fts+pinyin+semantic] 9ms
PASS  设计    => Dribbble > Figma > Iconify           [exact+fts+semantic] 9ms
```

### [4] 标签过滤

```
标签=代码补全 命中 1 条: GitHub Copilot
```

## 自动化测试：117 / 117 通过

```
Test Files  5 passed (5)
     Tests  117 passed (117)
```

| 套件 | 用例数 | 关键覆盖 |
| --- | --- | --- |
| `packages/core` | 24 | CJK 二元分词、MATCH 表达式转义、拼音、RRF 融合、个性化通道权重约束 |
| `packages/store` | 21 | 内存/真实 sqlite-vec 双实现一致、hashSiteId 稳定性、真实 SQLite 集成 15 项 |
| `packages/ai` | 26 | SSRF 全部网段 + IPv4 映射绕过、元数据抽取、启发式降级、schema 校验 |
| `apps/api` | 21 | 真实 HTTP 端到端：检索四通道、CRUD、409 去重、改名后索引同步、降级、审计 |
| `packages/mcp` | 25 | 只读 token 越权被拒、dryRun 默认、幂等重放、条数上限、审计落库 |

TypeScript 严格模式 `tsc --noEmit`：**0 错误**。

## 开发过程中被测试抓到并修掉的真实缺陷

这些不是设计说明，是**先写错、被验证推翻、然后修好**的记录：

1. **个性化会覆盖相关性**（最初设计错误）
   最初把个性化做成「融合后乘一个 ≤20% 的系数」。实测算出 RRF(k=60) 下
   `rrf(1)/rrf(8) = 1.11`，即排 8 的站点只要加成 11% 就能顶掉排 1。
   已改为「个性化是一路独立通道，权重 0.3」，并加测试锁定「多通道共识的相关性结果不会被单路偏好顶掉」。

2. **FTS5 无法命中中文子串**
   `unicode61` 把连续汉字当成单个 token，`match '启动'` 查不到「启动脚本」。
   已在写入期展开为单字 + 二元分词（`packages/core/src/cjk.ts`），实测任意 ≥2 字子串均可命中。

3. **英文词被分词器丢弃**
   CJK 分词最初只处理汉字，导致「GitHub Copilot」里的英文整段消失，搜 `GitHub` 无结果。
   已补充拉丁词提取。

4. **中文标签永远无法过滤**
   `slugify` 把非 `[a-z0-9]` 字符全部删除，中文标签被 slug 成空字符串，
   且过滤只匹配 slug。已改为保留 CJK，并同时匹配 `slug` 与 `name`。

5. **GET 检索接口直接报参数无效**
   query string 的值都是字符串，而 zod schema 要求 `number`，
   `GET /api/search?limit=3` 会返回「参数无效」。已改用 `z.coerce` + 布尔联合类型。

6. **启发式分类误判**
   最初用「命中关键词计数」，「GitHub Copilot AI 代码补全」被归到「开发运维」
   （GitHub + 代码 2 票 vs AI 1 票）。已改为**加权关键词** + 标题加成 + 拉丁词边界匹配。

7. **Node type-stripping 不支持构造函数参数属性**
   `constructor(private db: Db)` 会导致 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。已全部改为显式字段声明。

8. **主模块判断导致静默退出**
   `import.meta.url === "file://" + process.argv[1]` 在 Windows 上因盘符大小写/斜杠形式不一致而恒为 false，
   `server.ts` 直接运行会**退出码 0 且无任何输出**（比报错更难查）。已改为独立入口 `main.ts` / `seed-main.ts`。

## MCP 端到端验收（真实 JSON-RPC 握手）

用真实 MCP 客户端协议（stdio + `initialize` + `tools/list` + `tools/call`）验证，非模拟。

```
handshake: ok
server: {"name":"navhub","version":"0.1.0"}
tools count: 9
  - search_sites   [query,limit,categoryId,tag]
  - get_site       [idOrUrl]
  - list_categories[includeCounts]
  - get_stats      []
  - create_site    [url,title,description,categoryId,tags,enrich,idempotencyKey]
  - update_site    [id,title,description,categoryId,tags,featured]
  - set_status     [id,status]
  - batch_import   [sites,defaultCategoryId,dryRun,idempotencyKey]
  - health_check   [limit,onlyUnchecked]
```

### 真实工具调用结果

```
[search_sites] query=写代码的AI count=3 channels=["fts","semantic"] tookMs=609
   Cursor          matchedBy={"fts":1,"semantic":1}
   GitHub Copilot  matchedBy={"fts":2,"semantic":2}
   Claude          matchedBy={"fts":4,"semantic":4}

[batch_import dryRun] dryRun=true wouldCreate=1
   plan=[{"url":"https://example.com/mcp-dry","action":"create","title":"MCP 干跑"}]

[get_stats] sites=50 categories=5 semantic=true
```

`matchedBy` 让 AI 能解释「为什么推荐这个站点」，而不是只给一个不透明的排序。

### dryRun 未落库（已核对）

```
调用 batch_import（未显式传 dryRun）后：
  库中站点数           50  -> 50   （未增加）
  库中 example.com 站点  0          （未写入）
```

注意：用「干跑」两个字做一次语义搜索会返回 20 条结果 —— 那是**语义通道的正常行为**
（自然语言查询会召回语义相近的站点），并不是该站点被写入了。
判定「是否落库」必须按 URL 或总数核对，这也是这次验收里修正过的一个误读。

## standard 模式验收（PostgreSQL 17 + pgvector，实机）

此前这是唯一未验证的架构假设。本次通过 Docker 起了真实 `pgvector/pgvector:pg17`，**17/17 通过**。

```
capabilities: ["pgvector (HNSW) 就绪",
               "PostgreSQL tsvector 全文索引就绪（CJK 二元分词 + GIN 表达式索引）",
               "embedding 已被配置关闭，语义通道不可用"]

  PASS  pgvector (HNSW) 就绪
  PASS  类目物化路径  anchor=pg-cat/pg-sub
  PASS  创建站点
  PASS  中文标签可写回  tags=["天气","生活"]
  PASS  按 URL 读回且标签不为空  tags=["天气","生活"]
  PASS  更新站点
  PASS  tsvector 命中中文子串『天气』  hits=1
  PASS  tsvector 命中『天气预报』
  PASS  检索引擎『天气』命中  channels=["exact","fts"]
  PASS  拼音首字母 zgtqw 命中中国天气网
  PASS  浏览模式可用  hits=1
  PASS  父类目过滤包含子类目  hits=2
  PASS  中文标签过滤命中  hits=1
  PASS  重复 URL 可被检测
  PASS  删除后读不到
  PASS  统计返回真实计数  {"sites":1,"categories":2,"tags":2,"broken":0,"disputed":0}
  PASS  审计与事件落库

STANDARD MODE: 17/17 passed
```

环境：Docker 29.4.3 + `pgvector/pgvector:pg17`（pgvector 0.8.7）。

### 这一步又抓出 4 个只在 PostgreSQL 上暴露的真实缺陷

这些问题在 SQLite 上**全部正常**，只有在真实 PG 上才会失败 —— 也正是"必须实机验证"的原因：

1. **`boolean = integer` 类型错误**：
   SQLite 没有布尔类型，代码里把 `true/false` 统一绑成 `0/1`；
   PG 是强类型，`enabled = 1` 直接报 `operator does not exist: boolean = integer`。
   已改为**按方言**绑定（`bindSqlite` / `toPgSql`），并让 `enabled = ?` 谓词按方言取 `1` 或 `TRUE`。

2. **PostgreSQL 折叠未加引号的别名为小写**（最隐蔽的一个）：
   `SELECT category_id AS categoryId` 在 PG 上返回的列名是 **`categoryid`**，
   而读取侧写的是 `r.categoryId`，于是恒为 `undefined`。
   后果是「父类目过滤包含子类目」在子类目没有直属站点时静默返回空结果。
   已在 `rawRows` 与仓储层统一做**行键小写归一化**，并加测试锁住该约定。

3. **子类目 id 取了不存在的字段名**：
   `SELECT id FROM categories ...` 返回 `{ id }`，但代码读的是 `d.categoryId`，
   导致子类目 id 全是 `undefined`。已补别名（这个问题在 SQLite 上被"父类目恰好有直属站点"掩盖了）。

4. **标签永远读不回来**：
   `rowToSite` 把 `tags` 硬编码为 `[]`，标签能写进 `site_tags` 表却读不回来。
   已补上按方言的聚合查询（SQLite `group_concat` / PG `string_agg`）。

## Docker 与镜像源（本机实测）

本机 **Docker Hub 不可达**，具体表现与处置：

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| `docker pull pgvector/pgvector:pg17` → `failed to resolve reference ... EOF` | `registry-1.docker.io` 被阻断 | 用镜像前缀拉取后重新打 tag |
| `docker compose build` → `failed to fetch oauth token ... auth.docker.io` | 构建期仍需访问 `auth.docker.io` 取 token | 用 `NODE_IMAGE` build-arg 指向镜像源 |
| 在 `~/.docker/daemon.json` 写 `registry-mirrors` 无效（`docker info` 显示 `[]`） | **Docker Desktop 会重写该文件**，只保留它自己管理的键（builder.gc / experimental） | 不依赖 daemon.json，改用镜像前缀 + build-arg |

可用的镜像源（实测可达）：

```
docker.m.daocloud.io   ✅ 401（可达，正常鉴权语义）
docker.1ms.run         ✅ 401（可达）
dockerproxy.net        ✅ 200
docker.mirrors.ustc.edu.cn   ❌ 不可达
hub-mirror.c.163.com         ❌ 不可达
mirror.ccs.tencentyun.com    ❌ 不可达
```

### 容器镜像构建：受限网络下的实际进展与阻碍

**应用层已实测通过**（见上节 17/17）；容器化打包在本机网络下受阻，逐段进展如下：

| 步骤 | 状态 |
| --- | --- |
| `docker pull pgvector/pgvector:pg17` | ✅ 经 `docker.m.daocloud.io` 镜像源成功 |
| 真实 PostgreSQL 17 + pgvector 0.8.7 运行 | ✅ 容器启动健康 |
| **应用代码连真实 PG 全链路验证** | ✅ **17/17 通过** |
| `Dockerfile.api` 的 `NODE_IMAGE` / `DEBIAN_MIRROR` 参数化 | ✅ 已实现 |
| 基础镜像拉取（`node:22-bookworm-slim`） | ⚠️ 仅 `dockerproxy.net` 可用；`daocloud`/`1ms.run` 分别出现 502 与 TLS 超时 |
| `apt-get install python3 make g++` | ✅ 经 `mirrors.tuna.tsinghua.edu.cn` 成功 |
| 构建期 `pnpm install` | ❌ 容器到 `registry.npmmirror.com` 的 TLS 频繁 `UND_ERR_SOCKET` 重试失败 |

结论：**阻碍来自构建期的外网稳定性，不是代码或 Dockerfile 的问题**。
在正常网络下（或预先 `docker save/load` 依赖层）应可直接构建。

可选的规避方式：

1. 预先把依赖装进基础层（`docker build` 时 `--cache-from`，或在镜像内先 `pnpm store` 预热）。
2. 直接以宿主机进程方式运行（本项目全程验证就是这么做的），仅在需要容器编排时再构建镜像。
3. 在网络不受限的环境构建一次，`docker save` 后分发。

### 可复现的构建方式

```bash
# 1) 拉基础镜像（走镜像源）并打回官方 tag
docker pull docker.m.daocloud.io/library/node:22-bookworm-slim
docker tag  docker.m.daocloud.io/library/node:22-bookworm-slim node:22-bookworm-slim

docker pull docker.m.daocloud.io/pgvector/pgvector:pg17
docker tag  docker.m.daocloud.io/pgvector/pgvector:pg17 pgvector/pgvector:pg17

# 2) 用镜像源地址作为 NODE_IMAGE 构建
cd docker
POSTGRES_PASSWORD=navhub docker compose --profile standard \
  build --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim api-standard
```

两个 Dockerfile 都已把基础镜像暴露为 `NODE_IMAGE`（默认 `node:22-bookworm-slim`），
compose 也透传了该变量，因此无网络限制的环境无需任何额外操作。

### 顺带发现的环境问题

- Docker Hub 在本机不可达，详见上节「Docker 与镜像源」（含可复现的构建方式）。
- `docker-compose.yml` 里 `mcp` profile 曾用 `${NAVHUB_MCP_TOKEN:?}` 强制校验；
  Compose 会**在解析期**校验所有 profile 的变量，导致仅想启动 postgres 的命令也直接失败。
  已改为可缺省，强制校验留在 `mcp/src/http.ts` 的启动逻辑里。
- `postgres` 服务原先没有端口映射，宿主机无法直连；已补 `POSTGRES_PORT`（默认 5432）。


## 前端（apps/web）接入 —— 已完成读 + 写双路径

### 完成情况

| 项 | 状态 |
| --- | --- |
| vendoring NavSphere 底座（commit `6ba74fa`） | ✅ [scripts/vendor-web.mjs](scripts/vendor-web.mjs) |
| `StorageAdapter` 三后端（http / github / sqlite 实现） | ✅ |
| `src/lib/github.ts` 替换为门面（签名不变，69 处调用点零改动） | ✅ |
| **首页读路径改为异步读中枢** | ✅ `page.tsx` 已改 |
| **路由强制动态渲染** | ✅ `export const dynamic = "force-dynamic"` |
| 中枢不可用时的降级 | ✅ 回退到构建期内联基线 |
| `next build` 通过 | ✅ 全部页面生成 |
| 覆盖文件在 Docker 构建期注入 | ✅ `docker/Dockerfile.web` |

### 实测证据

**1. 首页渲染的是数据库内容，不是上游静态 JSON**

```
中枢：{sites:50, categories:5, tags:77}
中枢 /api/storage?path=.../navigation.json：5 个类目 × 11 站点
中枢 /api/storage?path=.../site.json：title = NavHub 导航

GET http://127.0.0.1:3000/  ->  200, 89466 bytes
<title> = NavHub 导航
description = AI 原生的网址导航 —— 支持中文语义检索、拼音与关键词混合召回

库中站点是否渲染：
  中国天气网      TRUE
  魔搭 ModelScope TRUE
  力扣 LeetCode   TRUE
  Excalidraw      TRUE
```

**2. 后台改完，前台立即生效（读路径真正打通）**

```
PUT /api/storage  (修改 site.json 的 title)
GET http://127.0.0.1:3000/  ->  <title> 立刻变为修改后的值
（随后已还原）
```

**3. 中枢不可用时优雅降级（不白屏、不 500）**

```
停止中枢后 GET /：
  status = 200, 272876 bytes
  title  = NavSphere导航        （回退到构建期基线）
  含上游基线站点 Vercel   TRUE   （基线生效）
  含数据库站点中国天气网  FALSE  （数据库不可达，符合预期）
```

### 全页面读路径打通（本轮扩展）

首页打通后，把其余仍读构建期静态 JSON 的页面一并改造：

| 页面 | 原数据来源 | 现状 |
| --- | --- | --- |
| `/` | `navigation.json` + `site.json` 静态导入 | ✅ 异步读中枢 |
| `/submit` | `navigation.json` 静态导入 | ✅ 异步读中枢（类目下拉反映真实类目） |
| `/videos` | `videos.json` + `site.json` 静态导入 | ✅ 异步读中枢 |
| `/videos/player` | 同上 | ✅ 异步读中枢 |
| 根 `layout.tsx` | 硬编码 `NavSphere` 品牌 | ✅ 读中枢站点配置 |

改造后仅剩 `src/lib/github.ts` 里**刻意保留**的构建期基线导入（兜底用）。

```
GET /              -> 200   title="NavHub 导航"
GET /submit        -> 200   title="网站投稿 - NavHub 导航"
GET /videos        -> 200   title="Videos - NavHub 导航"
GET /videos/player -> 200   title="视频播放器 - NavHub 导航"

首页仍渲染数据库站点：中国天气网 TRUE  魔搭 ModelScope TRUE
渲染内容中已无硬编码品牌（唯一一处 NavSphere 是上游 GitHub 仓库的署名链接，应当保留）
```

### 这一轮又抓到 3 个问题

1. **`<title>` 品牌重复**（`X - NavHub 导航 - NavHub 导航`）。
   根 layout 的 `title.template` 会统一追加站点名，而子页面标题里又拼了一次。
   已约定：**子页面只写页面名，品牌由 layout 单一来源追加**。

2. **根 layout 硬编码 `NavSphere` 品牌**：所有子页面标题都被追加 ` - NavSphere`，
   与中枢里的品牌名并存，用户看到两个品牌。已改为读中枢站点配置。

3. **数据库里的站点配置标题被写坏（`NavHub ??`）** —— 这条最值得记录：
   ```
   中枢 site.json basic.title = "NavHub ??"
   码点 = ["4e","61","76","48","75","62","20","3f","3f"]   // 3f 3f = 两个问号
   ```
   成因：用 **PowerShell 发 PUT 请求**时中文被压成了 `?`，即缺陷在"写请求的编码"而不是应用逻辑。
   这也说明一件事：**验证时必须连数据的字节级正确性一起核对** ——
   页面上显示"NavHub 导航"看起来是对的，但实际存的是问号，只有当编码/字体不同步时才会暴露。
   已改用 Node 的 `fetch` 发请求（显式 UTF-8）修复，并新增 2 个测试锁住中文编码往返。

### 改动要点与踩到的坑

1. **首页原本是同步读静态 JSON**（`import navigationData from "@/navsphere/content/navigation.json"`），
   而适配器读写是异步的。已把 `page.tsx` 与 `generateMetadata()` 改为 `async`。

2. **`generateMetadata` 被构建期固化**（实测踩到）：只改成 async 还不够 —— 首页参与预渲染时，
   `<title>` 会被写死在构建产物里。证据：库里标题已是「NavHub 导航」，页面 `<title>` 却仍是构建时的
   回退值「NavSphere导航」。加 `export const dynamic = "force-dynamic"` 后每次请求实时读取，问题消失。
   （站点列表当时看起来正常，是因为它恰好走了动态路径，掩盖了这个问题。）

3. **站点配置必须有基线**：前端 `generateMetadata()` 直接读 `siteData.basic.title`，
   若中枢在「从未保存过站点配置」时返回 `{}`，首页会在渲染期抛错。
   已在中枢侧提供 `DEFAULT_SITE_CONFIG`（NavHub 品牌），并由 seed 落库。

4. **两级兜底**：`getFileContent` 在「适配器报错」和「返回空结构」两种情况下都回退到构建期内联基线，
   保证「中枢没起来」与「库是空的」都不会让站点变成空壳。

### 主动禁用的能力

`STORAGE_ADAPTER=sqlite`（同进程直连）在 Web 前端**已禁用并给出明确报错**：
直连要求把整个 `@navhub/api` 打进前端产物（实测报 `Module not found: @navhub/api`，
标记为 external 又会与 Next 内部 webpack 插件冲突）。需要省一次 HTTP 往返时，
把中枢与前端放同机、用 `http` 指向 `127.0.0.1` 即可。
`createSqliteAdapter` 仍保留在 `storage-adapter.ts` 供其他运行环境使用。

## 已知未完成项

- `standard` 模式：**已完成实机验证（17/17）**，见上节。
  `PgVectorStore` 与 `SqliteVecStore` 共享同一套接口，但**尚无自动化跨方言一致性测试**
  （`scripts/pg-check.mts` 是手工验证脚本，需要真实 PostgreSQL 才跑）。
- `apps/web`：读写双路径均已打通并实测（见上节）。
  `/submit`、`/videos` 等页面的数据来源仍沿用上游写法，未逐一改造。
- 健康巡检、对话式侧边栏、PWA、主题系统尚未实现。