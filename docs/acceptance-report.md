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
  `/submit`、`/videos` 等页面**已确认接中枢**（`getFileContent` → StorageAdapter(http) → `/api/storage`，
  见上文「全页面读路径打通」表；全仓无残留静态 `import *.json`，仅 `lib/github.ts` 的兜底基线）。
  原「数据来源仍沿用上游写法」的记录已过期，于 2026-10-14 复核更正。
- 健康巡检（任务与巡检历史/趋势查询已完成，见 docs/wiki）、PWA（含更新提示）已实现；
  对话式侧边栏、主题系统部分实现。
---

# 第二轮验收：导航功能增强（2026-10-13，实测）

基于 `docs/navigation-enhancement-plan.md` 实施 Phase 0-4 后的实测记录。

## 测试规模

```
Test Files  8 passed (8)
     Tests  216 passed (216)     （第一轮基线 132，新增 84）
```

| 套件 | 用例数 | 新增覆盖 |
| --- | --- | --- |
| `packages/core` | 24 + 14 | 热度公式（对数/年龄惩罚/收藏权重）、画像聚合（衰减/保序去重/收藏 2 倍权重/空事件） |
| `packages/store` | 21 + 17 | 分类移动 anchor 级联、防成环、合并、删除归类、标签云/重命名/合并、收藏幂等、画像 roundtrip、搜索历史、OAuth upsert、任务队列、迁移幂等、旧库自动补列 |
| `apps/api` | 21 + 16 + 10 | 分类管理四路由、标签/专题、收藏夹全流程、榜单、事件白名单+点击计数、用户同步、搜索历史、**D1 双向回归**；JobRunner 四任务 + 锁 + 画像闭环 |
| `packages/mcp` | 20 + 8 | 新工具 4 个（get_trending/list_tags/refresh_site/run_job）、admin 边界 |
| `packages/ai` | 26 | 不变（SSRF 复用，无新抓取路径） |

TypeScript 严格模式 `tsc --noEmit`：**0 错误**（core / store / ai / mcp / api 五个包）。
Next.js 生产构建：**通过**（新页面 /tags /tags/[slug] /hot /favorites /site/[id] /admin/jobs /admin/stats 全部生成）。

## D1 缺陷修复：三向实测（真实服务 + 真实快照写回）

| 场景 | 结果 |
| --- | --- |
| 经 API 创建的站点不在快照里 | **幸存**（51 → 51，旧行为会静默删除） |
| navsphere 源站点从快照移除 | **被删除**（全量对齐管理语义未破坏） |
| seed 源站点从快照移除 | **被删除**（初始内容仍可管理） |

自动化版本固化为 `apps/api/test/api.test.ts` 的「D1 缺陷回归」两个用例。

## 任务 Runner 实测（真实 SQLite，30s 轮询）

- 入队 `recompute_rank` → 35 秒内自动执行完（`status=done`）
- 热度分真实产出：有点击的站点 0.69，无互动站点 0（公式下限钳位生效）
- `health_check` 对 SSRF 目标（127.0.0.1:9）判 broken 并记录原因，任务本身 done（抓取失败是业务的正常结果）
- 坏 siteId 的 `refetch_metadata` 标记 failed 且不阻塞同轮其它任务
- 并发 tick 只有一个真正执行（防重入）；锁行执行后释放（TTL 120s 兜底）

## 个性化闭环实测

```
3 次 click 事件（anon-loop）→ buildProfile 聚合（7 天半衰期）
  → user_profiles.topCategories = [AI 类目]
  → GET /api/search?q=AI&anonId=anon-loop
  → channelsUsed = exact + fts + personal     （personal 通道真实出现）
```

## 迁移实测

- `pnpm --filter @navhub/api migrate`（此前 package.json 声明了脚本但文件缺失，直接失败）现在可用
- 旧库（缺 visit_count/trend_score/email 等列的 2026-10-12 数据库）经 openDb 自动补齐，测试锁定
- 幂等：第二次执行为空操作

## 前端实测

- Next.js 15.5.21 生产构建通过，7 个新页面全部生成
- `/api/hub/*` 服务端代理接入（同源、无 CORS、兼容 docker 内部主机名）
- SearchPalette：防抖 200ms + AbortController + 通道徽标 + 语义降级提示 + 最近搜索
- 收藏夹 v1：localStorage 优先，未登录可用；星标按钮在卡片/搜索/榜单/详情四处均可用

## 已知边界（如实记录）

1. 收藏夹云端同步的身份由调用方传入（anonId / userId），未做终端用户鉴权——多用户公开场景需加 Bearer token（api_tokens 表已具备能力）
2. `refetch_metadata` 默认只走启发式（不烧 LLM 额度），LLM 需显式 `llm: true`
3. NavSphere 线格式仍只表达两级分类；更深层级经新 API 暴露给新 UI，兼容快照保持两级
4. PG（standard）路径未在本次实测（Docker 未运行）；双方言 DDL 与 SQL 分支已按既有约定编写，`scripts/pg-check.mts` 保持可用

---

# 第三轮验收：PWA / 投稿统一 / 通道注册表（2026-10-13，实测）

## 测试规模

```
Test Files  8 passed (8)
     Tests  216 passed (216)     （第二轮 205，新增 11）
```

新增覆盖：投稿 6 例（pending 落库 / 409 去重 / 400 校验 / 审核队列 / 审核流转）、
通道注册表 5 例（内置权重不变 / 注册 / 非法入参 / fuse 纳入新通道 / reset 隔离）。

## PWA 实测（真实 next start + 真实产物）

| 项 | 结果 |
| --- | --- |
| `/manifest.webmanifest` | 200 `application/manifest+json`，内容含 name/short_name/standalone/theme_color/三个图标/三个快捷方式 |
| 图标 4 枚（192/512/maskable/apple-touch-icon） | 200 `image/png`，字节数真实（3351B/13228B/8617B/1946B） |
| `/sw.js` | 200 `application/javascript` |
| 首页 HTML | `rel="manifest"` ✓、`theme-color` ✓、`apple-touch-icon` ✓、SW 注册代码在 layout chunk ✓ |
| 生产构建 | 通过，`/manifest.webmanifest` 路由生成 |

踩坑记录：`metadata.icons.apple` 在 Next 15.5 **只渲染 meta 不渲染 link**（实测），
改用 `<head>` 显式 `<link rel="apple-touch-icon">`；SW 注册走 `useEffect`（生产才注册），
HTML 里本来就不该出现内联脚本，验证方式是检查 layout chunk 含注册代码。

## 投稿统一实测

- 无 GitHub 配置时（NavHub 默认部署），`POST /api/submissions` 经 Web 路由回退到中枢：
  创建 `status=pending, source=submission` 站点，限流 5 次/小时/IP，重复 URL 409
- 审核闭环：`GET /api/sites?status=pending` 出队 → `PATCH /api/sites/:id {status:"active"}` 通过
- 配置了 `GITHUB_OWNER/REPO/PAT` 时保持上游 Issue 流程（向后兼容，两通道并存）

## 通道注册表演实

- 内置五路开箱即用，权重与重构前完全一致（1.4/1.0/0.9/1.15/0.3）
- `registerChannel("collab", 1.0)` 后 `searchChannels()` 含新通道，`fuse` 将其纳入
  融合与 coverage 统计（两路命中的站点排到单路前面）
- 非法通道名（空串）与非法权重（负数/NaN）抛错；`resetChannels()` 保证测试隔离

## 部署集成

- `apps/web-overlay/` 现为 29 个文件（新增 manifest.ts / pwa-register.tsx / layout.tsx /
  sw.js / 4 枚图标 / submissions 路由），`scripts/check-web-overlay.mjs` 校验一致
- `scripts/gen-pwa-icons.mjs`：图标可再生（sharp 经 createRequire 锚定 apps/web 解析）

---

# 第四轮验收：全面排错（真实浏览器实测，2026-10-14）

用 agent-browser（真实 Chromium）逐页采集 console/errors/performance entries，
375px 与 1280px 双视口验证，发现并修复以下问题。全部修复后复验通过。

## 修复清单

| # | 严重度 | 问题 | 位置 | 根因 | 修复 |
| --- | --- | --- | --- | --- | --- |
| 1 | **P0** | 搜索结果/标签/榜单/收藏云同步/站点详情/管理面板数据全部静默为空 | `apps/web/src/lib/navhub-api.ts` | `getJson` 已拼 `/api/hub` 基址，调用方又传 `/api/...` 路径 → 实际请求 `/api/hub/api/search` 双重前缀 404，被 catch 吞掉只显示空态 | 新增 `hubUrl()` 归一化（兼容 `/api/search`、`/search`、`/api/hub/search` 三种写法），回归测试 `scripts/navhub-api.test.ts` |
| 2 | **P0** | 大量样式缺失：/tags 在 375px 横向溢出 4369px、标签不换行、页脚文字竖排 | `src/styles/globals.css` + 构建产物 | Tailwind v4 自动源检测漏扫大部分 src 文件：构建 CSS 仅 32KB，`flex-wrap`/`space-y-*`/`rounded-2xl`/`flex-row` 等工具类整批缺失（grep 实证 0 命中） | globals.css 加 `@source '../**/*.{js,ts,jsx,tsx,mdx}'`；CSS 恢复 90KB，全部工具类生成 |
| 3 | P1 | `/site/[id]` 永远显示「站点不存在」（数据请求被 #1 连带） | `src/app/site/[id]/page.tsx` | 同 #1（performance entries 实锤请求了 `/api/hub/api/sites/...`） | 随 #1 修复，实测详情正常渲染（标题/描述/点击数） |
| 4 | P1 | 水合不匹配（控制台 hydration 报错） | `quick-tools-widget.tsx`、`quick-tools-drawer.tsx` | `useState(() => Date.now()/randomUUID())` 初始值在 SSR 与客户端必然不同且直接渲染 | 初始 0/'' + `useEffect` 挂载后赋值，渲染加占位符 |
| 5 | P1 | `Container` 不支持 className：/custom 页面类型错误 + 页面级间距被静默丢弃 | `src/components/ui/container.tsx` | 组件只接收 children | 加 `className` 合并（cn） |
| 6 | P2 | iOS 桌面图标缺失 | `src/app/layout.tsx` | Next 15.5 的 `metadata.icons.apple` 只渲染 meta 不渲染 link（实测） | head 显式 `<link rel="apple-touch-icon">` |
| 7 | P2 | overlay 与 apps/web 漂移（并行会话直接改工作区，手工同步必漏） | `apps/web-overlay/` | 多写者无同步机制 | 新建 `scripts/sync-web-overlay.mjs`：下载上游 tarball 精确 diff（不同/新增→进 overlay，一致→移出），当前 88 文件全部一致 |

## 复验结果（修复后，真实浏览器）

| 项 | 修复前 | 修复后 |
| --- | --- | --- |
| 搜索请求 URL | `/api/hub/api/search?...`（404） | `/api/hub/search?...`（200） |
| 搜索下拉 | 空态 | 结果 + 通道徽标渲染 |
| /tags 375px | scrollWidth 4369px 横向溢出 | scrollWidth=clientWidth，76 个标签正常换行 |
| /tags 数据 | 空 | 76 个标签 + 搜索过滤 |
| /hot 数据 | 空 | 热度榜渲染（含"3 次热度"分量） |
| /site/[id] | 「站点不存在」 | 详情完整渲染 |
| /custom 水合 | hydration 报错 | 控制台干净 |
| 首页 console（375/1280px） | — | 0 错误 0 页面异常 |

## 测试规模（最终）

```
Test Files  12 passed (12)      Tests  269 passed (269)
apps/web/scripts/navhub-api.test.ts  8 断言通过（tsx 运行）
tsc --noEmit（core/store/ai/mcp/api/web）  0 错误
Next.js 生产构建  通过（.next-bugfix2，含 @source 修复）
```

## 过程经验（复用价值）

- **agent-browser 与沙箱**：持久 daemon 会被调用间回收 → 单次调用内完成 open→采集→close；
  refs 不跨调用；`wait --load networkidle` 会挂（用 load 或跳过）
- **a11y snapshot 文本拼接是假象**（如 "2026NavHub" 缺空格），核实以原始 HTML 为准
- **performance entries 是定位前端请求 bug 的利器**：直接列出页面实际请求的 URL
- Tailwind v4 漏扫的表象是"部分类缺失"，与文件无关（同一文件里有的类在有的不在），
  排查方法是 grep 构建 CSS 里的工具类，修复用显式 `@source`

---

# 第五轮验收：PWA 离线能力补测 + 新发现 BUG-8（2026-10-14）

对上一轮未覆盖区域补测：/algorithms、/videos、/submit 页面、收藏持久化、
暗色模式、离线（Service Worker）、overlay 同步脚本稳定性。

## BUG-8（P1）Service Worker 从未注册，PWA 离线能力 100% 失效

| 项 | 内容 |
|---|---|
| 位置 | `apps/web/src/components/pwa-register.tsx` |
| 根因 | 注册代码挂在 `window.addEventListener('load', ...)`，而 React 水合通常在 `load` **之后**才执行 —— 监听回调永不被调用 |
| 证据 | 浏览器实测：`navigator.serviceWorker.getRegistrations()` → `count: 0`；`performance` 中 `/sw.js` **零请求**；离线访问 `net::ERR_INTERNET_DISCONNECTED` |
| 影响 | PWA 完全摆设：manifest/SW/图标都在，但离线打不开、无法安装到桌面 |
| 修复 | 删除 load 监听，effect 内直接 `register`；注册失败由静默 `catch` 改为 `console.warn` |
| 复验 | 注册数 1 / scope `/` / state `activated`；二次访问 `controller: true`；**离线仍能加载首页（52 张卡片）** |

```tsx
// 修复后（完整可替换）
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    // 直接注册；不等 load 事件（水合在 load 之后，监听器不会触发）
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      console.warn('[pwa] service worker 注册失败：', err)
    })
  }, [])

  return null
}
```

同时把 `public/sw.js` 的预缓存失败从静默吞掉改为 `console.warn`
（同一"静默 catch"反模式，曾让"PWA 已接入"的验收结论失真）。

## 其它补测结果（全部通过，无需修复）

| 项 | 结果 |
|---|---|
| /algorithms、/videos、/submit | 页面渲染正常，console 0 错误 |
| 收藏持久化 | 点星 → localStorage 落库（"DeepSeek"）→ 刷新后仍保留，星标呈已收藏态 |
| 暗色模式 | `html.dark` + 背景 `rgb(9,9,11)` 生效 |
| 离线（修复后） | 首页正常渲染，52 张卡片 |
| overlay 同步脚本 | 曾间歇性崩溃（约两次一次，写入被占用）→ 写入加重试后连跑 4 次全通过 |

## 最终状态

```
vitest        269 passed（12 文件）
tsc --noEmit  0 错误
next build    通过（含 SW 注册修复）
浏览器        双视口 + 暗色 + 离线，console 0 错误
```

---

# 第六轮验收：边界探测 + 限流分桶修复（2026-10-14）

## BUG-9（P1）按 IP 的限流退化成"整站一个桶"

| 项 | 内容 |
|---|---|
| **位置（调用链）** | 浏览器 → `apps/web/src/app/api/hub/[...path]/route.ts`（代理）→ `apps/api/src/server.ts`（Fastify + `@fastify/rate-limit`） |
| **根因** | 代理只转发 `content-type/accept/authorization`，**不带客户端 IP**；中枢默认 `trustProxy=false`，`req.ip` 恒为前端进程地址 → 所有访客共享同一限流桶 |
| **触发条件** | 任何经前端代理的写接口；最致命是投稿 `5 次/小时`：第 6 位访客就被 429 挡住 |
| **影响范围** | 功能可用性（投稿/批量导入/富化等写接口）；不限数据正确性、无性能影响 |

复现（修复前，直连中枢）：
```
POST /api/submissions  x5 → 201, 第6次 → 429（x-ratelimit-limit: 5）
带 X-Forwarded-For: 1.2.3.4 / 5.6.7.8 → 仍 429   ← XFF 被忽略
```

修复（两处，各一行级改动）：
```ts
// apps/web/src/app/api/hub/[...path]/route.ts
const xff = request.headers.get('x-forwarded-for')
if (xff) headers['x-forwarded-for'] = xff
```
```ts
// apps/api/src/server.ts
const trustProxy = process.env.NAVHUB_TRUST_PROXY !== "0";   // 直连公网时设 0 防伪造
const app = Fastify({ logger: { level: logLevel }, bodyLimit: 4 * 1024 * 1024, trustProxy });
```

**取舍**：`trustProxy` 全开意味着信任 XFF；若中枢被直接暴露到公网，客户端可伪造 XFF 绕过限流。
提供 `NAVHUB_TRUST_PROXY=0` 开关：仅在"中枢直连公网"时关闭。架构上中枢本就不该公网暴露，故默认开。

复验（修复后，端到端经前端代理）：
```
XFF=201.1.1.1 → 201   XFF=202.2.2.2 → 201        （各自独立桶，修复前全是 429）
XFF=201.1.1.1 连打：1-4 → 201，第5/6 → 429        （限流仍生效，未被绕过）
无 XFF → 201                                        （退回前端进程 IP 桶）
```

## 排查过但**确认无问题**的项（附证据，避免重复排查）

| 排查项 | 结论 |
|---|---|
| `limit` 越界/负数/非数字 | zod 已校验 1..100，返回 400 + `detail` 明细 |
| `hit.site` 为空（搜索结果 null） | 两处均有 `if (!site) return/null` 守卫 |
| 收藏 localStorage / JSON 导入 | `try/catch` + `Array.isArray` 校验；`importJson` 返回 `{ok,error}` |
| 搜索防抖的 abort 竞态 | `searchSites` 透传 AbortError，组件 `.catch` 内判 `aborted` 后忽略 → 无未捕获拒绝 |
| JobRunner 单实例锁 | SQLite 持久锁行 + TTL 抢占 + 唯一键冲突兜底；PG advisory lock；手动触发与定时不会重入 |
| 中枢不可用时代理降级 | 返回 502 + `{error, details}` JSON |
| 暗色模式 / 离线 SW / 收藏持久化 | 均实测通过 |

## 一个被**证伪**的假设（已回滚，留作记录）

我曾判定"`/api/sites/:id` 匹配不了 URL 形态（含斜杠）404"，据此加了 `/api/sites/by-url` 路由。
**该前提是错的**：实测 `/api/sites/https%3A%2F%2Fchatgpt.com` → **200**（find-my-way 会解码 %2F）；
早先看到的 404 只是因为那个 URL 不在库里。已回滚路由与 `fetchSite` 改动，
改为用测试锁定真实契约："URL 百分号编码后可经 `/api/sites/:id` 查到"。
不编码的原始 URL 仍 404 —— 属 HTTP 路由固有行为，非缺陷。

## 最终状态

```
vitest         271 passed（12 文件）
tsx navhub-api 8 断言通过
tsc --noEmit   0 错误（core/store/ai/mcp/api/web）
next build     通过
端到端         经代理的限流分桶、离线 SW、双视口 console 0 错误
```

---

# 第七轮验收：模块化页面系统深化（2026-10-14）

## 现状研究结论（22 文件 / ~3900 行已有实现）

架构：`src/lib/modular/registry.ts`（13 类模块注册表，含 min/max 列行约束）+
`use-modular-layout.ts`（多看板 + 增删/重排/缩放/模板/导入导出/紧凑重排/撤销重做，
localStorage v2 格式含 v1 迁移）+ `modular-canvas.tsx`（12 栅格 CSS Grid）+
`modular-item.tsx`（模块卡片）。响应式：移动端 col-span-12 堆叠、md/lg 折算跨度。

## 本轮修复的三个缺陷

### BUG-10（P1）模块间没有真正的故障隔离
- **根因**：React 渲染是整棵树——任一模块 render 抛错即整页白屏，"模块独立"只是形式
- **修复**：新增 `module-error-boundary.tsx`（getDerivedStateFromError + 重试换 key 重挂载 +
  编辑模式内移除入口），包裹每个模块内容
- **复验**：注入 `?fault=1` 强制时钟模块渲染抛错 → 页面存活、7 个模块容器全在、
  故障卡片显示错误信息与重试入口、其余模块照常渲染、console 仅告警

### BUG-11（P1）缩放手柄被父级原生拖拽劫持，**拖拽缩放在真实鼠标下 100% 失败**
- **位置（调用链）**：`modular-item.tsx` 手柄 onPointerDown → 父卡片 `draggable={isEditing}`
- **根因**：手柄按下并移动 → 父级触发原生 HTML5 `dragstart` → 浏览器 `pointercancel` 掉指针流。
  插桩实锤：`{ds:1, pc:1, pu:0}`（dragstart 1 次、pointercancel 1 次、pointerup 永不到来）
- **修复**：卡片 `onDragStart` 内检测 `isResizingRef.current` → `e.preventDefault()` 拒绝劫持；
  手柄加 `z-10` + `touch-none`
- **复验**：真实鼠标拖手柄 +142px → colSpan 3→5（与实测列宽 75px 完全吻合）、纵向拖 → 行高 1→2

### BUG-12（P2）缩放把"80px=1 列"写死 + 每步都压历史
- **根因**：列宽映射假设容器 1200px（1440 屏实际 110px/列，375 屏 20px/列）→ 手感跳格；
  每个栅格变化做一次 boards 深拷贝 + 历史入栈 → 拖一次塞十几条快照，撤销只能回退一格
- **修复**：按下时实测容器宽度与 columnGap 算真实列宽；行高按 115px 档位；
  新增 `beginInteraction()`（开始时压**一份**快照，过程中 recordHistory=false）
- **复验**：一次拖拽 = 一步撤销（undo 直接回到拖拽前 3×1）；Pointer Events 统一鼠标/触屏

## 实测证据汇总（真实 Chromium）

| 项 | 结果 |
| --- | --- |
| 横向拖拽缩放 | +142px → colSpan 3→5，落库一致 |
| 纵向拖拽缩放 | +125px → rowSpan 1→2 |
| 撤销 | 一次拖拽一步撤销，回到拖拽前状态 |
| 故障隔离 | 崩溃模块局部降级，页面与其余模块存活 |
| 375px 响应式 | 无横向溢出，7 模块全宽堆叠 |
| console | 0 错误 |
| 回归 | vitest 271 全绿 · tsc 0 错误 · 生产构建通过 |

## 已知边界（如实记录）

- 模块重排仍用 HTML5 DnD（桌面拖拽流畅），触屏用 ⬆️/⬇️ 按钮替代——触屏拖拽换位未实现
- rowSpan 档位高度（175/290/420px）为约定值，拖拽按 115px 增量归档，非像素级自由高度
