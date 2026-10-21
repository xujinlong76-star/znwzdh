# 09 · 运行方式、配置与测试

## 1. 环境要求

| 项 | 要求 |
| --- | --- |
| Node.js | ≥ 20（Docker 用 22） |
| 包管理 | pnpm 11（workspace） |
| 可选 | Docker / Docker Compose、PostgreSQL 17 + pgvector、pwsh（非必需） |
| 网络 | 首次 seed 需下载 embedding 模型（~24MB，走 `hf-mirror.com`） |

## 2. 本地开发

```bash
pnpm install
cp .env.example .env

# 1) 播种内置站点与插件市场种子（同时生成向量，首次会下载 24MB 模型）
#    必须在仓库根目录执行：库路径默认是 cwd 相对的 ./data/navhub.db
pnpm seed

# 2) 启动中枢 → http://localhost:8787
pnpm --filter @navhub/api start
```

### 2.1 根 package.json 脚本

| 脚本 | 命令 | 说明 |
| --- | --- | --- |
| `pnpm dev` | `node apps/api/src/main.ts` | 中枢开发模式（以仓库根为 CWD，与 dev-all/Docker 同一套相对路径口径） |
| `pnpm dev:web` | `node scripts/run.mjs --filter navsphere dev` | 前端（:3000） |
| `pnpm build` | `pnpm -r --filter "@navhub/*" build` | 全部包构建 |
| `pnpm test` | `vitest run` | 711 通过 / 11 跳过（42 个测试文件；其中 PG 跨方言 12 项未配 `NAVHUB_TEST_DATABASE_URL` 时 skip） |
| `pnpm test:watch` | `vitest` | 监听模式 |
| `pnpm typecheck` | `pnpm -r exec tsc --noEmit` | 全仓类型检查 |
| `pnpm seed` | `node apps/api/src/seed-main.ts` | 播种（必须根目录 CWD；子包脚本 `pnpm --filter @navhub/api seed` 会写错库） |
| `pnpm mcp:stdio` | `pnpm --filter @navhub/mcp start` | 启动 MCP stdio |
| `pnpm vendor:web` | `node scripts/vendor-web.mjs` | 拉取上游底座 |
| `pnpm test:pg` | `node --experimental-strip-types scripts/pg-check.mts` | PostgreSQL 分档验收 |
| `pnpm backup` | `node scripts/backup.mjs` | SQLite 在线热备（见 §8） |

### 2.2 `@navhub/api` 子脚本

| 脚本 | 入口 | 说明 |
| --- | --- | --- |
| `dev` / `start` | `node --experimental-strip-types src/main.ts` | 直跑 TS（**不经过编译**） |
| `migrate` | `src/migrate.ts` | schema 幂等补列 |
| `seed` | `src/seed-main.ts` | 种子数据 |
| `build` | `tsc -p tsconfig.json` | 类型检查 + 产出 dist |
| `typecheck` | `tsc --noEmit` | |

> **`--experimental-strip-types`** 是全仓的运行方式：Node 只做类型擦除，**不转译**——因此有语法限制（见 §7 环境坑 3）。

### 2.3 双终端运行

```bash
# 终端 1：中枢
pnpm --filter @navhub/api start        # :8787

# 终端 2：前端
pnpm dev:web                           # :3000
```

前端通过 `STORAGE_ADAPTER=http` + `/api/hub/*` 运行时代理访问中枢（本地指向 `http://localhost:8787`）。

> 本机没有 PowerShell Core（`pwsh`）时，脚本请用**点源**方式执行：`. ./scripts/run.ps1 install`

## 3. Docker 运行

```bash
cd docker
docker compose up -d                                     # lite：仅中枢
docker compose --profile web up -d                       # 追加 Web 前端
docker compose --profile standard up -d                  # PostgreSQL + pgvector
NAVHUB_MCP_TOKEN=xxx docker compose --profile mcp up -d  # 追加 MCP HTTP
```

根目录保留了一份历史简版 `docker-compose.yml`（已标记 Deprecated，请统一使用 `docker/docker-compose.yml`）。详细配置见 [08-extensions-scripts-docker.md](./08-extensions-scripts-docker.md)。

## 4. MCP 接入

### 4.1 stdio（Claude Desktop / Cursor）

```json
{
  "mcpServers": {
    "navhub": {
      "command": "node",
      "args": ["--experimental-strip-types", "packages/mcp/src/stdio.ts"],
      "env": { "NAVHUB_MODE": "lite", "NAVHUB_SQLITE_PATH": "./data/navhub.db" }
    }
  }
}
```

或 `pnpm mcp:stdio` / bin `navhub-mcp`。

### 4.2 HTTP

```bash
# 直接跑
NAVHUB_MCP_TOKEN=xxx pnpm --filter @navhub/mcp http    # :8790

# 或 Docker
NAVHUB_MCP_TOKEN=xxx docker compose --profile mcp up -d
```

**未设 `NAVHUB_MCP_TOKEN` 会拒绝启动并 `exit(2)`。**

## 5. 环境变量全表

### 5.1 运行模式与服务

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NAVHUB_MODE` | `lite` | `lite` \| `standard`；非两者之一启动报错 |
| `NAVHUB_PORT` / `PORT` | `8787` | `NAVHUB_PORT` 优先 |
| `NAVHUB_HOST` / `HOST` | `0.0.0.0` | |
| `NAVHUB_PUBLIC_URL` | `http://localhost:8787` | |
| `NAVHUB_SESSION_SECRET` | `insecure-dev-secret-change-me` | **生产（`NODE_ENV=production`）强制要求 ≥32 字符且非默认值，否则拒绝启动** |
| `NAVHUB_LOG_LEVEL` | `info`（测试时 `silent`） | |
| `NAVHUB_TRUST_PROXY` | 关闭（见说明） | 默认不信任 `X-Forwarded-For`（防公网直连伪造 XFF 绕过限流）。`1`/`true` 信任整条链，但 `req.ip` 取的是**客户端自报的最左值**，换个伪造值就换个限流桶；反代后推荐给可信网段列表（proxy-addr 语法，如 `"loopback, 172.16.0.0/12"`）。数字不是跳数：`2` 会让 XFF 整段失效，配置层直接报错 |
| `NAVHUB_NAVIGATION_MAX_SITES` | `8000` | `navigation.json` 单文件快照站点数上限，超限返回 HTTP 413 |
| `NAVHUB_CORS_ORIGINS` | `*` | 逗号分隔 |
| `NAVHUB_JOBS_ENABLED` | 开启（`=0`/`false` 关闭） | 任务队列开关 |
| `NAVHUB_JOBS_INTERVAL_MS` | `30000`（<1000 视为非法回退） | 任务轮询间隔（毫秒），见 [02-api.md §5.2](./02-api.md) |
| `NAVHUB_SEED_ON_START` | `1` | Docker entrypoint 自动播种 |
| `NAVHUB_SEED_EMBEDDINGS` | 开启（`=0` 关闭） | seed 是否生成向量 |

### 5.2 REST 鉴权

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NAVHUB_AUTH_REQUIRED` | `false` | **公开部署时开启**；开启后管理面必须带 Bearer token，终端功能（搜索/事件/收藏/投稿）仍匿名可用。**生产 + 公网 `NAVHUB_PUBLIC_URL` + 本项为 false → 启动即失败**（fail-closed） |
| `NAVHUB_BOOTSTRAP_TOKEN` | 空 | **一次性引导 token**：启用鉴权后用它创建第一个库内 token，用完删除并重启 |
| `NAVHUB_ALLOW_INSECURE_PUBLIC` | `0` | 逃生阀：确认公网不可达（内网/NAS）时设 `1` 退回"只警告"，生产公网部署不建议使用 |

引导流程与路由分级详见 [02-api.md §2.3](./02-api.md)。

### 5.2.1 后台任务告警

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NAVHUB_ALERT_WEBHOOK` | 空 | 任务重试耗尽时 POST 一条 JSON（飞书/钉钉/自建机器人可直连）；留空只落 `console.error` |
| `NAVHUB_ALERT_TIMEOUT_MS` | `5000` | 单次投递超时，内部钳到 1s~30s；投递失败不影响任务流 |

告警**只在重试耗尽时触发一次**（`MAX_JOB_ATTEMPTS=3`），不会每次失败都喊。

### 5.3 数据库

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NAVHUB_SQLITE_PATH`（回退 `NAVHUB_DB_PATH`） | `./data/navhub.db` | lite 模式 |
| `NAVHUB_DATABASE_URL` | 无 | **standard 模式必填**，缺则启动抛错 |

### 5.4 本地 embedding

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NAVHUB_EMBEDDING_MODEL` | `Xenova/bge-small-zh-v1.5` | 512 维，24MB |
| **`NAVHUB_EMBEDDING_ENDPOINT`** | `https://hf-mirror.com` | ⚠️ **`transformers.js` 不读 `HF_ENDPOINT`**，这个值赋给 `env.remoteHost`——在 `huggingface.co` 不可达的网络里是「能跑」与「永远卡住」的分界 |
| `NAVHUB_EMBEDDING_DTYPE` | `q8` | `q8 \| fp16 \| fp32 \| q4` |
| `NAVHUB_EMBEDDING_CACHE` | `./data/models` | 离线部署预挂载此目录 |
| `NAVHUB_EMBEDDING_DIM` | `512` | |
| `NAVHUB_EMBEDDING_ENABLED` | `true` | `false` 关闭语义通道 |

### 5.5 LLM（可选）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NAVHUB_LLM_BASE_URL` | `https://api.deepseek.com` | OpenAI 兼容 |
| `NAVHUB_LLM_API_KEY` | 空 | **缺省时 AI 富化降级为启发式**，系统照常可用 |
| `NAVHUB_LLM_MODEL` | `deepseek-chat` | |
| `NAVHUB_LLM_TIMEOUT_MS` | `20000` | |

### 5.6 抓取（SSRF 守卫）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NAVHUB_FETCH_TIMEOUT_MS` | `10000` | |
| `NAVHUB_FETCH_MAX_BYTES` | `2097152`（2MB） | 边读边截断 |
| `NAVHUB_FETCH_MAX_REDIRECTS` | `3` | 每跳重新做 DNS + IP 校验 |
| `NAVHUB_ALLOW_PRIVATE_NETWORKS` | `false` | **内网导航站（NAS 收录内网服务）设 `true`** |
| `NAVHUB_USER_AGENT` | `NavHubBot/0.1` | |

### 5.7 MCP

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NAVHUB_MCP_SCOPES` | `read,write` | 逗号分隔 `read,write,admin` |
| `NAVHUB_MCP_ACTOR` | `mcp:stdio` / `mcp:http` | 审计身份 |
| `NAVHUB_MCP_HTTP_HOST` | `127.0.0.1` | **默认只监听本机** |
| `NAVHUB_MCP_HTTP_PORT` | `8790` | |
| `NAVHUB_MCP_TOKEN` | 空 | **HTTP 必填，缺失拒绝启动（exit 2）** |
| `NAVHUB_MCP_ALLOW_INSECURE` | `false` | 本地调试，降级为只读 |
| `NAVHUB_MCP_ALLOWED_ORIGINS` | 空 | Origin 白名单 |

### 5.8 前端（apps/web）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| **`STORAGE_ADAPTER`** | `http` | `http` \| `github` \| `sqlite`（**Web 端拒绝 sqlite**） |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8787` | 中枢地址 |
| `NAVHUB_STORAGE_BASE_URL` | 同上 | `/api/hub/*` 路由**运行时**读取，换地址只需重启前端 |
| `NAVHUB_HUB_TIMEOUT_MS` | `30000` | `/api/hub/*` 代理的**上游超时**（毫秒）；到点回 504，SSE 长连接不受影响 |
| `NAVHUB_STORAGE_TOKEN` | 空 | 中枢开启鉴权时的 Bearer |
| `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_BRANCH` / `GITHUB_PAT` | — | `STORAGE_ADAPTER=github` 时必需 |
| `NEXT_DIST_DIR` | `.next` | 构建输出目录 |
| `NAVHUB_WEB_STANDALONE` | 关（`=1` 开） | 生成 standalone 产物（需符号链接权限） |

### 5.9 Docker 构建参数

`NODE_IMAGE`（默认 `node:22-bookworm-slim`）、`DEBIAN_MIRROR`（默认 `deb.debian.org`）、`NAVSPHERE_REF`（默认 `main`）。

## 6. 测试

### 6.1 运行

```bash
pnpm test          # 全部 653 个测试
pnpm test:watch    # 监听
pnpm test:pg       # PostgreSQL 手工验收（scripts/pg-check.mts，需先起 postgres）
```

### 6.2 跨方言自动化测试（#19）

[packages/store/test/pg-dialect.e2e.test.ts](file:///c:/Users/许进龙/Desktop/web/packages/store/test/pg-dialect.e2e.test.ts)：
把 SQLite 套件的**核心断言**（标签聚合、类目物化路径、FTS/拼音/浏览、软删除部分唯一索引、标签删除索引刷新、巡检历史、任务队列退避、审计/事件、画像 roundtrip）复跑到**真 PostgreSQL** 上。

| 要点 | 说明 |
| --- | --- |
| **连不上不红** | 未设 `NAVHUB_TEST_DATABASE_URL` → 整套件 skip（并 console.warn 说明原因）；设了但连不上 → **失败**（不能悄悄跳过） |
| 覆盖的方言坑 | `group_concat` vs `string_agg`、`?` → `$n` 占位符、`BOOLEAN` vs `INTEGER`、PG 别名小写折叠、`WHERE deleted_at IS NULL` 部分唯一索引 |
| CI | [.github/workflows/ci.yml](file:///c:/Users/许进龙/Desktop/web/.github/workflows/ci.yml)：`test-sqlite`（typecheck + 全量测试）与 `test-postgres`（**pgvector/pgvector:pg16 service** + 只跑本套件）两个 job，PG 连接串经 `NAVHUB_TEST_DATABASE_URL` 注入 |

本地跑：起 postgres 后 `set NAVHUB_TEST_DATABASE_URL=postgres://... && pnpm exec vitest run packages/store/test/pg-dialect.e2e.test.ts`。

[vitest.config.ts](file:///c:/Users/许进龙/Desktop/web/vitest.config.ts)：

```ts
include: ["packages/**/test/**/*.test.ts", "apps/api/test/**/*.test.ts"],
environment: "node",
testTimeout: 30_000,
hookTimeout: 60_000,
pool: "forks",
// 注意：排除 apps/web —— 那是 vendored 的上游底座，不是测试目标
```

### 6.2 套件覆盖

| 套件 | 覆盖 |
| --- | --- |
| `packages/core`（6 文件） | CJK 分词、FTS5 MATCH 表达式、拼音、RRF 融合、个性化通道、热度公式、画像聚合、模块化布局、金库与预取、配方与对比、未来算法（LinUCB/双曲） |
| `packages/store`（2 文件） | 向量存储（**内存/真实 sqlite-vec 双实现一致性**）、真实 SQLite 集成、分类管理（移动/合并/删除归类）、收藏夹、画像、任务队列、**schema 迁移幂等**、方言差异、**零结果两级兜底**（放宽过滤/模糊匹配）、**offset 分页**（拼接一致性 + browse 探针）、**软删除回收站**（软删/恢复/永久删/同 id 复活/部分唯一索引） |
| `packages/ai` | SSRF 网段判定（**含 IPv4 映射绕过**）、元数据抽取、启发式降级 |
| `packages/mcp` | 权限硬边界、**dryRun 默认行为**、幂等、审计、admin 级工具 |
| `apps/api`（3 文件） | **真实 HTTP 端到端**：检索、CRUD、去重、索引同步、降级、审计、收藏夹、榜单、**D1 快照误删回归**；JobRunner 四任务 + 单实例锁；**REST 鉴权**（开放模式回归、逐级拦截、scope 含义、token 生命周期、审计身份）；**零结果建议**与**分页防灌水**（offset>0 不记事件）；**审计日志查询**（过滤/分页/损坏 diff 容错）；**回收站**（删除→回收站→恢复 409 冲突→永久删除→快照复活） |

### 6.3 类型检查

```bash
pnpm typecheck     # pnpm -r exec tsc --noEmit
```

> `apps/web` 因 vendored 上游依赖组合问题在 `next.config.js` 中 `ignoreBuildErrors: true`；**`packages/*` 与 `apps/api` 仍严格检查**。

### 6.4 PostgreSQL 分档验收

```bash
docker compose --profile standard up -d postgres
node --experimental-strip-types scripts/pg-check.mts     # 或 pnpm test:pg
```

结果：**17/17 通过**，详见 [docs/acceptance-report.md](../acceptance-report.md)。

## 7. 环境坑与排障

### 7.1 脚本执行

1. **`.ps1` 请用点源**：本机没有 `pwsh`，用 `. ./scripts/run.ps1 <args>`（点源保留退出码）
2. **`.ps1` 里不要写中文**：Windows PowerShell 5.1 按 **ANSI** 读取脚本文件，中文会导致解析失败——仓库里的 `.ps1` 刻意只用 ASCII

### 7.2 TypeScript 运行时限制

3. **不要用 TS 构造函数参数属性**（`constructor(private x: T)`）：Node 的 `--experimental-strip-types` 只做类型擦除，遇到这类会生成运行时代码的语法报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`
   - 仓库里的规避：`StorageError`、`SsrfBlockedError`、`McpAuthError` 都用**显式字段声明 + 赋值**
4. **不要用 `import.meta.url === process.argv[1]` 判断主模块**：Windows 上路径形式不一致会导致脚本**静默退出且无输出**（比报错更难排查）——入口统一放 `main.ts` / `seed-main.ts`，**导入即启动**

### 7.3 pnpm 与依赖

5. **pnpm 11 的构建脚本白名单在 `pnpm-workspace.yaml` 的 `allowBuilds`**，不在 `package.json`（`better-sqlite3`、`esbuild`、`onnxruntime-node`、`protobufjs`、`sharp` 需要 `true`）
6. **原生依赖要做直接依赖**：`sqlite-vec` 必须在 `apps/api` 的 `dependencies` 里——pnpm 严格布局不会因为 `@navhub/store` 依赖它就把它暴露给 API
7. **zod 全仓固定 v3**（`pnpm-workspace.yaml` 的 `overrides`）：vendored 前端的 `@hookform/resolvers@3` 只支持 zod v3；若解析到 v4，类型检查直接失败

### 7.4 检索与网络

8. **`NAVHUB_EMBEDDING_ENDPOINT`**：不是 `HF_ENDPOINT`——`transformers.js` v4 不读取该环境变量，必须走 `env.remoteHost`
9. **`NAVHUB_TRUST_PROXY` 默认关闭（`false`）**：公网直连时防止客户端伪造 `X-Forwarded-For` 绕过限流。置于反代之后时**别习惯性写 `1`**：`1` 采信的是链首（客户端自己写的）值，按 IP 的限流仍可被逐个请求伪造绕开；应写可信代理网段列表（如 `"loopback, 172.16.0.0/12"`），此时只有 socket 对端在列表内才解析 XFF，且 `req.ip` 取的是代理实际看到的下一跳
10. **前端代理必须透传 `X-Forwarded-For`**：否则所有访客共享一个限流桶，投稿第 6 位就被 429 挡住
11. **URL 形态查询要 `encodeURIComponent`**：`/api/sites/https://chatgpt.com` 会被切成多段 → 404（HTTP 路由固有行为）

### 7.5 常见症状速查

| 症状 | 原因 / 排查 |
| --- | --- |
| 搜索结果/标签/榜单全空 | `hubUrl` 双重前缀（`/api/hub/api/search`）——已修，见 [03-web.md §2.1](./03-web.md) |
| 语义检索不可用 | `curl :8787/api/health` 看 `capabilities.semantic` 与 `notes`；检查模型是否下载成功 |
| 保存 navigation.json 后站点消失 | D1 缺陷（已修）——`writeNavigationData` 的 source 过滤，跑 `node scripts/d1-regression.mjs` |
| MCP HTTP 启动失败 exit 2 | 未设 `NAVHUB_MCP_TOKEN` |
| Docker Hub 拉取 EOF | 配 `~/.docker/daemon.json` 的 `registry-mirrors`，或用 `docker.m.daocloud.io` 镜像前缀 |
| `apt update` 失败 | `--build-arg DEBIAN_MIRROR=mirrors.tuna.tsinghua.edu.cn` |
| overlay 改动在构建后丢失 | 忘了同步：`node scripts/sync-web-overlay.mjs`，校验 `node scripts/check-web-overlay.mjs` |
| PG 报 `boolean = integer` | 方言差异，应走 `enabledValue(dialect)`（SQLite `1` / PG `TRUE`） |
| FTS 中文查不到 | 确认 `sites.fts_tokens` 已写入（`updateSite` 负责重算） |

### 7.6 健康检查入口

```bash
curl http://localhost:8787/api/health
```

```json
{
  "ok": true,
  "mode": "lite",
  "capabilities": { "semantic": true, "fts": true, "llm": false, "notes": ["..."] },
  "stats": { "sites": 50, "categories": 12, "tags": 0, "broken": 0, "pending": 0 }
}
```

**所有 AI 能力都是可选的，缺任何一项系统都照常启动**，并在此如实上报——这是全仓的硬性要求，有测试覆盖。

## 8. 备份与恢复

### 8.1 在线热备（推荐，不需要停服务）

```bash
# 默认备份 ./data/navhub.db 到 ./data/backups/，保留最近 7 份
node scripts/backup.mjs

# 自定义路径 / 输出目录 / 保留份数
node scripts/backup.mjs --db /data/navhub.db --out /backups --keep 14
```

脚本走 better-sqlite3 的 `backup()`（sqlite3 在线备份 API）：

- **不要直接 `cp` 数据库文件**——SQLite 处于 WAL 模式，主库文件不含尚未
  checkpoint 的事务，cp 到的是旧快照甚至损坏文件；
- 备份与正常读写并发安全，读取期间服务不中断；
- 备份完成后自动执行 `integrity_check` 校验，不过则退出码 1（供 cron 告警）；
- 产物是自包含单文件（自动清理 -wal/-shm 附属），可直接拷贝传输。

### 8.2 定时备份（cron 示例）

```cron
# 每天凌晨 3 点热备，保留最近 14 份
0 3 * * * cd /opt/navhub && /usr/bin/node scripts/backup.mjs --keep 14 >> /var/log/navhub-backup.log 2>&1
```

### 8.3 Docker 场景

```bash
# 在 api 容器内执行（数据卷已挂载）
docker compose exec api node scripts/backup.mjs --out /data/backups
```

### 8.4 恢复步骤

```bash
# 1. 停服务（或 docker compose stop api）——恢复必须独占文件
# 2. 用备份替换数据文件（先留一份现状，万一恢复错文件）
cp data/navhub.db data/navhub.db.before-restore
cp data/backups/navhub-2026-10-16_03-00-00.db data/navhub.db
# 3. 清掉可能残留的 WAL 附属文件（旧 WAL 与新主库不匹配会损坏数据）
rm -f data/navhub.db-wal data/navhub.db-shm
# 4. 启动服务并验证
pnpm --filter @navhub/api start && curl http://localhost:8787/api/health
```

`standard` 模式（PostgreSQL）的备份不适用本脚本，请使用 `pg_dump`。

## 9. 相关文档

- [README.md](../../README.md) —— 项目背景与设计理念
- [docs/acceptance-report.md](../acceptance-report.md) —— PostgreSQL 分档验收报告
- [docs/navigation-enhancement-plan.md](../navigation-enhancement-plan.md) —— 导航增强能力规划
- [docs/research-notes.md](../research-notes.md) —— 调研笔记
