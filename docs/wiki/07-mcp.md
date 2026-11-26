# 07 · MCP Server —— packages/mcp（库）+ apps/mcp（可执行）

> 库包 `packages/mcp`（包名 `@navhub/mcp`，**无 bin**，提供工具定义、实现与 Server 工厂）；可执行入口在 `apps/mcp`（包名 `@navhub/mcp-app`，bin `navhub-mcp` → `./src/stdio.ts`）。让 AI Agent（Claude Desktop / Cursor 等）通过标准 MCP 协议**读写导航数据**。
> 两种传输：**stdio**（本地）与 **HTTP**（远程）。
> 核心安全模型对齐 MCP 官方 Security Best Practices——**这些约束不是「文档建议」，而是写在代码里、有测试覆盖的硬边界**。

## 1. 模块文件清单

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| [tools.ts](../../packages/mcp/src/tools.ts) | ~230 | **45 个工具定义** + zod 输入 schema + 权限模型（`requireScope` / `MAX_BATCH_ITEMS`） |
| [handlers.ts](../../packages/mcp/src/handlers.ts) | ~360 | **工具实现**（`createHandlers(ctx)`）：权限校验 → 幂等去重 → 审计落库 |
| [mcp-server.ts](../../packages/mcp/src/mcp-server.ts) | ~75 | **Server 工厂**：`createMcpServer(ctx, toolCtx)`——`ListToolsRequestSchema` / `CallToolRequestSchema` 装配，stdio 与 HTTP 共用 |
| [stdio.ts](../../apps/mcp/src/stdio.ts) | ~45 | **stdio 传输**：`createMcpServer` + `StdioServerTransport` |
| [http-server.ts](../../apps/mcp/src/http-server.ts) | ~270 | **HTTP 传输**：标准 MCP Streamable HTTP（`/mcp`）+ 兼容 REST + Bearer/Origin 鉴权；导出 `createMcpHttpServer(options)` 便于测试 |
| [http.ts](../../apps/mcp/src/http.ts) | ~55 | **HTTP 启动入口**：读环境变量 → 校验生产约束 → `listen` |

依赖：`@modelcontextprotocol/sdk 1.32.1`、`@navhub/api`（复用 `createContext`/`loadConfig`）、`@navhub/core`、`@navhub/store`、`@navhub/ai`、`zod`、`zod-to-json-schema`。
测试：`test/mcp.test.ts`——权限硬边界、dryRun 默认行为、幂等、审计、admin 级工具；`test/mcp-http.test.ts`——标准 Streamable HTTP 全链路（真实端口 + fetch）、会话头规范行为、scope 收紧、Origin 白名单。

## 2. 权限模型

```ts
export type McpScope = "read" | "write" | "admin";

export interface ToolContext {
  actor: string;              // 当前调用身份（token 名），用于审计
  scopes: McpScope[];
  has(scope: McpScope): boolean;
}

export class McpAuthError extends Error { readonly requiredScope: McpScope }

export function requireScope(ctx: ToolContext, scope: McpScope): void {
  if (!ctx.has(scope)) throw new McpAuthError("缺少 " + scope + " 权限（当前身份：" + ctx.actor + "）", scope);
}

export const MAX_BATCH_ITEMS = 100;   // 批量写入硬上限
```

### 五条硬约束

| # | 约束 | 实现位置 |
| --- | --- | --- |
| 1 | **读写分级**——只读 token 调用写工具会被拒绝 | `requireScope(tc, "write")` 每个写工具入口 |
| 2 | **危险操作默认 dryRun**——批量导入先返回计划，不落库 | `BatchImportInput.dryRun.default(true)` |
| 3 | **幂等键**——Agent 重试是常态，重复调用不产生重复站点 | `withIdempotency(key, compute)` |
| 4 | **审计**——所有写操作落 `audit_logs`，actor 标记 `mcp:<身份>` | 每个写 handler 的 `repo.audit({actorKind: "mcp"})` |
| 5 | **输入上限**——批量导入单次最多 **100** 条 | `MAX_BATCH_ITEMS` + zod `.max(100)` |

> **设计细节**：`McpAuthError` 用**显式字段声明**而非构造函数参数属性——Node 的 `--experimental-strip-types` 只做类型擦除，参数属性会生成运行时代码导致 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。

## 3. 工具清单（17 个）

| 工具 | scope | mutating | 输入参数 | 行为 |
| --- | --- | --- | --- | --- |
| `search_sites` | read | ✗ | `query`(必)、`limit`(1-50, 默认10)、`categoryId`、`tag` | 混合检索，返回 `matchedBy`（**每路召回的名次**）作为可解释依据 |
| `get_site` | read | ✗ | `idOrUrl` | 按 id 或网址取详情 |
| `list_categories` | read | ✗ | `includeCounts`(默认 true) | 类目列表 + 站点数 |
| `get_stats` | read | ✗ | — | 统计 + `capabilities` |
| `get_trending` | read | ✗ | `limit`(1-50, 默认10) | 热度榜，带 `visits7d` / `trendScore` 分量 |
| `list_tags` | read | ✗ | `minCount`(默认1)、`limit`(1-200, 默认50) | 标签 + 关联站点数（热度降序） |
| `list_collections` | read | ✗ | `all`(默认 false) | 精选专题（合集）列表；默认只含启用中的专题 |
| `create_site` | **write** | ✓ | `url`(必)、`title`、`description`、`categoryId`、`tags`(≤8)、`enrich`(默认 true)、`idempotencyKey` | 自动抓取 + AI 富化；**网址已存在返回已存在站点而非报错** |
| `update_site` | **write** | ✓ | `id`(必)、`title`、`description`、`categoryId`、`tags`、`featured` | 更新并重建索引 |
| `set_status` | **write** | ✓ | `id`(必)、`status` | 审核投稿 / 标记失效 |
| `batch_import` | **write** | ✓ | `sites`(1-100)、`defaultCategoryId`、**`dryRun`(默认 true)**、`idempotencyKey` | 先预览 `plan`（create/skip），确认后再执行 |
| `health_check` | **write** | ✓ | `limit`(1-200, 默认50)、`onlyUnchecked` | 巡检并写回健康状态；**经 `repo.updateSiteHealth()` 走仓储抽象，lite(SQLite) 与 full(PostgreSQL) 均可用**（此前直写 SQLite，PG 模式直接 fail） |
| `delete_site` | **write** | ✓ | `idOrUrl`(必)、`idempotencyKey` | **软删除**（进回收站，可经 `/api/trash/:id/restore` 恢复）；站点不存在返回 `reason:"not_found"` 而非报错（幂等重试） |
| `export_sites` | read | ✗ | `categoryId`、`status`、`format`(json/csv，默认 json)、`limit`(1-1000, 默认200) | 导出站点清单；**CSV 对 `=+-@` 开头的值加前导单引号转义**（防 Excel 公式注入） |
| `refresh_site` | **write** | ✓ | `idOrUrl`、`llm`(默认 false) | **入队** `refetch_metadata`，异步执行（不立即返回新元数据） |
| `run_job` | **admin** | ✓ | `kind`(7选1)、`payload` | 入队后台任务；需 admin——会触发全站扫描 |
| `list_jobs` | read | ✗ | `status`(5 选 1)、`limit`(1-100, 默认20) | 任务队列（最近在前）。补上「`run_job` 只负责入队、Agent 却查不到执行结果」的口子 |
| `list_favorites` | read | ✗ | `folder`、`limit`(1-200, 默认50)、`offset` | **本人**收藏（JOIN 站点标题/网址/描述）；仅带 `owner_identity` 的个人令牌可用 |
| `compare_sites` | read | ✗ | `siteIds`(2–3 个，必) | **本人**收藏里的 2–3 站横向对照（计费/平台/形态/维护/备注/迁移，每格带来源与核实时间）；任一站不在本人收藏里则整单失败；仅个人令牌可用 |
| `search_favorites` | read | ✗ | `query`(必)、`folder`、`tag`、`limit`(1-50, 默认10)、`offset` | **本人**收藏内检索（词法 + 语义两路召回，与 `/api/ask` 同口径，只返回候选、不做 LLM 问答）；仅个人令牌可用 |
| `list_favorite_folders` | read | ✗ | — | **本人**收藏夹（id / 名称 / 条数）+ 未分夹条数；`list_favorites` / `search_favorites` 按夹过滤的前置 |
| `list_search_history` | read | ✗ | `limit`(1-200, 默认20)、`offset` | **本人**最近搜索记录；仅个人令牌可用 |
| `get_profile_summary` | read | ✗ | — | **本人**画像摘要；仅个人令牌可用 |
| `list_facets` | read | ✗ | `categoryId`、`tag` | 受控分面定义与取值分布；检索前了解可筛维度 |

> **全部 45 个工具：只读 32 / 写 12 / admin 1（其中 run_job 为 admin 专属）**（由 `scope` + `mutating` 字段划分；下表只列核心 17 个 + 用户域/目录域 6 个，算法 / 发现 / 开发者类工具见 wiki 10）。测试 `工具清单 > 包含 32 个只读工具与 13 个写工具` 锁死只读名单；`packages/mcp/test/read-only-tools-list.test.ts` 锁死「read token 的 tools/list 只返回 32 个只读工具」。

`ToolDefinition` 还带 `mutating: boolean`——**用于让宿主（MCP 客户端）决定是否需要人工确认**。

### 3.1 `search_sites` 的可解释输出

```js
{
  query, count, channelsUsed, semanticAvailable, tookMs,
  results: [{
    title, url, description, icon, tags,
    matchScore,                       // 6 位小数
    matchedBy: { exact: 1, fts: 3, semantic: 2 }   // ← 每路召回的名次
  }]
}
```

### 3.2 `create_site` 的去重语义

```ts
const dup = await ctx.repo.findSiteByUrl(input.url);
// 已存在不算错误：Agent 无法预知库里有什么，报错会让它进入无效重试
if (dup) return { created: false, reason: "already_exists", site: dup };
```

富化链：`enrichUrl()` → 用 `suggestedCategory` **唯一**匹配已有类目（标题或 SKOS altLabel）→ 未命中（含重名歧义）落固定 id 的「未分类」，并记一条 `category_gap` 提案，返回值里带 `categoryGap`。
建议名**不再自动建类目**——那是 106 个平铺根的成因；是否新建由编辑在 `admin/taxonomy` 采纳（新建只允许挂在指定父下，见 [02-api.md](./02-api.md)）。
`source: "mcp"`（批量为 `"mcp-batch"`）——**这个 source 决定了它不会被前端 navigation.json 快照误删**（见 [02-api.md §4.3](./02-api.md)）。

### 3.3 `batch_import` 的两段式

```
dryRun=true（默认）
  → 逐条 findSiteByUrl → plan[] (action: "create" | "skip", reason)
  → 返回 { dryRun: true, total, wouldCreate, plan }     ← 不落库

dryRun=false
  → withIdempotency(idempotencyKey, ...) → 实际创建
  → audit({ action: "site.batchImport", diff: { created: n } })
```

> 即使 zod 已 `.max(100)`，handler 里仍**二次校验** `input.sites.length > MAX_BATCH_ITEMS` 并返回友好错误——防御深度。

## 4. 幂等机制（handlers.ts）

```ts
async function withIdempotency(key: string | undefined, compute: () => Promise<unknown>): Promise<ToolResult> {
  if (!key) return ok(await compute());
  // ① 查 idempotency 表：命中直接回放上次结果
  //    SQLite: SELECT response FROM idempotency WHERE key = ?
  //    PG:     SELECT response FROM idempotency WHERE key = $1
  if (existing?.response) return ok({ replayed: true, result: JSON.parse(existing.response) });
  // ② 执行
  const result = await compute();
  // ③ 写入（PG 用 ON CONFLICT DO UPDATE）
  //    INSERT OR REPLACE INTO idempotency (key, response, created_at) VALUES (?,?,?)
  return ok(result);
}
```

**关键点**：命中时返回 `replayed: true` + 上次结果——Agent 能明确知道这是回放而非新创建。

> **为什么必要**：Agent 重试是常态，不是异常。没有幂等键，网络抖动就会产生重复站点。

## 5. 两种传输

### 5.1 stdio（[stdio.ts](../../apps/mcp/src/stdio.ts)）

**本地客户端直接拉起，没有网络攻击面**，权限由启动它的用户决定——但默认仍然只给只读：**scope 默认 `read`**（2026-11-06 深扫 P2-12：客户端配置文件可能来自第三方粘贴，不等于用户本人显式授权写操作；需要 `create_site` / `update_site` 等写工具时由运维显式设置 `NAVHUB_MCP_SCOPES=read,write`）。

```json
{
  "mcpServers": {
    "navhub": {
      "command": "node",
      "args": ["--experimental-strip-types", "apps/mcp/src/stdio.ts"],
      "env": {
        "NAVHUB_MODE": "lite",
        "NAVHUB_SQLITE_PATH": "./data/navhub.db",
        "NAVHUB_MCP_SCOPES": "read"
      }
    }
  }
}
```

| 机制 | 实现 |
| --- | --- |
| 身份 | `NAVHUB_MCP_ACTOR`（默认 `mcp:stdio`） |
| scope | `NAVHUB_MCP_SCOPES`（stdio 默认 `read`；见 §9：HTTP / compose 默认 `read,write`，两处默认并不一致） |
| 工具发现 | `ListToolsRequestSchema` → `TOOL_DEFS`，**按当前 scope 过滤**（read 明明看不到写工具，也不必列出必然 403 的 admin 工具），**写工具的 description 追加「（写操作，会修改数据）」** |
| 入参描述 | `zodToJsonSchema(schema, { $refStrategy: "none" })`——全仓 zod 固定 v3，v3 无内置 `toJSONSchema`，故用社区实现 `zod-to-json-schema`；**转换失败退回宽松描述** `{type:"object", additionalProperties:true}`，保证工具仍可被发现与调用 |
| 错误 | 捕获后返回 `isError: true` + `调用失败：<message>` |

### 5.2 HTTP（[http.ts](../../apps/mcp/src/http.ts)）

**HTTP 模式暴露在网络里，因此必须显式鉴权。**

| # | 安全措施 | 实现 |
| --- | --- | --- |
| 1 | **默认只监听 `127.0.0.1`** | `NAVHUB_MCP_HTTP_HOST` 默认 `127.0.0.1`，要对外必须显式改 |
| 2 | **必须提供 Bearer token** | `NAVHUB_MCP_TOKEN`；缺省且未设 insecure → **拒绝启动，`process.exit(2)`** |
| 3 | **校验 `Origin`** | 只有显式配置在 `NAVHUB_MCP_ALLOWED_ORIGINS` 里的来源才接受浏览器请求——**防 DNS rebinding / CSRF** |
| 4 | token 的 scope 决定可调用的工具集合 | `NAVHUB_MCP_SCOPES`（HTTP 入口默认 `read,write`；stdio 默认 `read`，见 §9） |

```ts
function secureEqual(a, b) {  // timingSafeEqual（防时序攻击）
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
function auth(req): ToolContext | null {
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return null;              // Origin 白名单
  if (ALLOW_INSECURE && TOKEN === "") return { actor: "mcp:insecure", scopes: ["read"], ... };
  if (TOKEN === "") return null;
  if (!secureEqual(match[1], TOKEN)) return null;                            // Bearer 比对
  return { actor: NAVHUB_MCP_ACTOR ?? "mcp:http", scopes, ... };
}
```

> `NAVHUB_MCP_ALLOW_INSECURE=true` 仅本地调试用，此时降级为 **只读** scope。

**端点**：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | `{ ok: true }`——**无需鉴权**，且不泄露 capabilities / 工具数（防能力枚举） |
| POST | `/mcp` | **标准 MCP Streamable HTTP**：JSON-RPC 2.0（`initialize` / `tools/list` / `tools/call`…）。请求需 `Accept: application/json, text/event-stream` 与 `Content-Type: application/json` |
| GET | `/mcp` | **标准 MCP**：服务端 → 客户端 SSE 流，需携带有效 `Mcp-Session-Id` |
| DELETE | `/mcp` | **标准 MCP**：结束会话 |
| GET | `/tools` | 工具清单（**按 scope 过滤**：`toolCtx.has(t.scope)`），兼容旧脚本 |
| POST | `/tools/<name>` | 调用工具；请求体上限 **1MB**（超限 413），兼容旧脚本 |
| — | 其他 | 404 + hint |

**会话流程**（[MCP Streamable HTTP 规范](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http)）：

1. `POST /mcp`（`initialize`，**无** `Mcp-Session-Id`）→ 响应头带 `Mcp-Session-Id`；
2. 之后所有请求（含 `notifications/initialized`）都必须带该头；无头且非 `initialize` → **400**，头无效 → **404**；
3. 会话建立后传输层独立处理 JSON-RPC，会话空闲 **30 分钟**自动回收（有活跃 SSE 流则不回收），`DELETE /mcp` 可主动结束。

> 本服务用 `enableJsonResponse: true`：带 id 的请求直接返回 `application/json` 响应体（而非 SSE 流），对脚本与简单客户端更友好；规范允许服务端在两者间选择。

**错误映射**：`/mcp` 一律返回 **JSON-RPC 2.0 错误体**（`{jsonrpc, error:{code,message}, id:null}`）——400 / 404 / 405 / 413；兼容端点 `/tools/<name>` 保持消息含「权限」→ **403**，其他 → **400**；未知工具 → 404；未实现 → 501。

## 6. 共用上下文：与 REST 行为完全一致

```ts
import { createContext, loadConfig } from "@navhub/api";
const ctx = await createContext(loadConfig());
const handlers = createHandlers(ctx);
```

`@navhub/api` 的 `index.ts` 导出 `config / context / server / storage`，**MCP 包与 HTTP 服务共用同一套上下文装配**（数据库 / 仓储 / 检索 / AI），保证两条入口的检索与写入行为完全一致——**不会出现「两套逻辑算出两个答案」**。

## 7. Docker 部署（HTTP 模式）

```bash
NAVHUB_MCP_TOKEN=xxx docker compose --profile mcp up -d
```

compose 里的服务 `mcp`（[docker/docker-compose.yml](../../docker/docker-compose.yml#L128-L156)）：

| 配置 | 值 |
| --- | --- |
| command | `node --experimental-strip-types apps/mcp/src/http.ts` |
| 端口 | `${NAVHUB_MCP_PORT:-8790}:8790` |
| `NAVHUB_MCP_HTTP_HOST` | `0.0.0.0`（容器内必然要对外） |
| `NAVHUB_MCP_TOKEN` | `${NAVHUB_MCP_TOKEN:-}` |
| `NAVHUB_MCP_SCOPES` | 默认 `read,write` |
| 数据 | 共享 `navhub-data:/data`（同一 SQLite + 模型缓存） |

> ⚠️ **compose 刻意不用 `:?` 强制校验**：Compose 会在**解析期**校验所有 profile 的变量，用 `:?` 会导致「仅想启动 postgres」的命令也直接失败。**真正的强制校验放在 `mcp/src/http.ts` 启动逻辑里**（未设 token 时拒绝启动，退出码 2）。

## 8. 环境变量汇总

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NAVHUB_MCP_SCOPES` | stdio: `read`；HTTP / compose: `read,write`（见 §9） | 逗号分隔 scope（stdio 与 HTTP 共用变量名、默认不同） |
| `NAVHUB_MCP_ACTOR` | `mcp:stdio` / `mcp:http` | 审计 actor 标识 |
| `NAVHUB_MCP_HTTP_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `NAVHUB_MCP_HTTP_PORT` | `8790` | HTTP 端口 |
| `NAVHUB_MCP_TOKEN` | `""` | **HTTP 模式必填**，缺失拒绝启动 |
| `NAVHUB_MCP_ALLOW_INSECURE` | `false` | 本地调试降级为只读 |
| `NAVHUB_MCP_ALLOWED_ORIGINS` | `""` | Origin 白名单（逗号分隔） |

其余（`NAVHUB_MODE` / `NAVHUB_SQLITE_PATH` / `NAVHUB_LLM_*` / `NAVHUB_EMBEDDING_*`）由 `@navhub/api` 的 `loadConfig()` 消费，见 [09-run-and-test.md](./09-run-and-test.md)。

## 9. 只读接入：个人令牌与客户端配置（Batch 3 第 4 项）

### 9.1 默认 scope 在各入口并不一致（已按代码实锤）

| 入口 | 默认 `NAVHUB_MCP_SCOPES` | 代码位置 |
| --- | --- | --- |
| stdio（本地客户端拉起） | `read` | `apps/mcp/src/stdio.ts`（`?? "read"`） |
| HTTP（`apps/mcp/src/http.ts`） | `read,write` | `apps/mcp/src/http-server.ts` 的 `mcpHttpOptionsFromEnv`（`?? "read,write"`） |
| Docker compose（`mcp` 服务） | `read,write` | `docker/docker-compose.yml`（`${NAVHUB_MCP_SCOPES:-read,write}`） |

**不要按「默认」推断另一入口的行为**：同一个环境变量名在 stdio 与 HTTP 下的默认值不同。只读接入一律显式写 `NAVHUB_MCP_SCOPES=read`（下面三份配置都已写死），不要依赖默认。

### 9.2 只读个人令牌：签发流程

用户域工具（`list_favorites` / `search_favorites` / `list_favorite_folders` / `list_search_history` / `get_profile_summary` / `compare_sites`）只认**带 `owner_identity` 的个人令牌**：数据范围 = 令牌归属人，调用方传什么身份都不算；实例级令牌（`ownerIdentity` 为 null）一律被拒。

签发（用户本人操作，不经过管理员）：

1. 登录后打开 **`/me/account`** 页的「API 令牌」面板（`ApiTokensPanel`）；
2. 填名称，权限档位选 **只读**（默认就是只读），创建；
3. 明文（`nh_…`）只在创建或轮换响应里出现一次，立即复制保存——库里只存 sha256，丢了只能吊销重建。
4. 令牌需要定期更换时，在同一面板点击「轮换」；系统以 `rotatedAt` 版本做 CAS，并发重复提交只有一个成功，旧明文立即失效。

对应接口：`POST /api/me/tokens`（`{ name, permission: "read" }`）、`POST /api/me/tokens/:id/rotate`（必须提交列表中的 `expectedRotatedAt` 版本）与 `DELETE /api/me/tokens/:id`；登录身份受信才放行，匿名身份 403；每人最多 10 条未吊销令牌。落库形态：`api_tokens.scopes = "read"`，`owner_identity = 登录身份的规范化 identity`。

> ⚠️ **不要去 `/admin/tokens` 签发**：那是管理员的实例级凭据（`POST /api/tokens`，不带 `owner_identity`），能管站点但**读不到任何个人数据**——拿它调 `search_favorites` 会直接被「要求用户级个人令牌」拒绝。反过来，个人令牌即使带 `write` 也写不了实例级站点（`evaluateInstanceWrite` 拦截），两类凭据的边界是单向的。

**只读个人令牌下 `tools/list` 应为 32 个只读工具**（28 个现有只读 + 本批新增的 `search_favorites` / `list_favorite_folders` / `list_facets` / `compare_sites`）；13 个写/admin 工具全部不可见，`CallTool` 调它们会被权限拒绝。由 `packages/mcp/test/read-only-tools-list.test.ts` 锁死。

### 9.3 可复制配置

**Claude Desktop（stdio，只读）**——`claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "navhub": {
      "command": "node",
      "args": ["--experimental-strip-types", "apps/mcp/src/stdio.ts"],
      "env": {
        "NAVHUB_MODE": "lite",
        "NAVHUB_SQLITE_PATH": "./data/navhub.db",
        "NAVHUB_MCP_SCOPES": "read"
      }
    }
  }
}
```

**Cursor（`mcp.json`，只读）**：

```json
{
  "mcpServers": {
    "navhub": {
      "command": "node",
      "args": ["--experimental-strip-types", "apps/mcp/src/stdio.ts"],
      "env": {
        "NAVHUB_MODE": "lite",
        "NAVHUB_SQLITE_PATH": "./data/navhub.db",
        "NAVHUB_MCP_SCOPES": "read"
      }
    }
  }
}
```

> stdio 模式没有网络鉴权：能拉起进程的人就是调用者。只读是底线——不要在 stdio 配置里写 `read,write`，除非你明确要让这个客户端改库。

**HTTP（`mcp-remote` + 只读个人令牌）**——服务端须以 `NAVHUB_MCP_SCOPES=read` 启动（不要依赖 HTTP 默认的 `read,write`），客户端：

```json
{
  "mcpServers": {
    "navhub": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://127.0.0.1:8790/mcp",
        "--header",
        "Authorization: Bearer nh_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      ]
    }
  }
}
```

其中 `nh_…` 是 §9.2 签发的只读个人令牌明文（不是静态 `NAVHUB_MCP_TOKEN`，也不是 `/admin/tokens` 的实例级令牌）。HTTP 层按表内 token 的 `scopes` / `owner_identity` 建会话：同一个只读个人令牌在 HTTP 下同样只能看到 32 个只读工具、只能读自己的收藏。

### 9.4 本批新增工具的使用示例

```jsonc
// 1. 先看自己有哪些夹子
{ "name": "list_favorite_folders", "arguments": {} }
// → { "folders": [{ "id": "…", "name": "工作", "count": 12 }], "unfiledCount": 3 }

// 2. 在收藏里搜（备注/标签都算检索文本，不用先复制到对话里）
{ "name": "search_favorites", "arguments": { "query": "做 PPT 找配色", "limit": 5 } }
// → { "results": [{ "siteId": "…", "title": "设计灵感库", "url": "…",
//      "note": "做 PPT 找配色", "tags": ["设计"],
//      "matchScore": 8.5, "matchedBy": { "lexical": 1 } }],
//     "correction": null, "semanticAvailable": false }

// 3. 列收藏（现在带站点标题/网址/描述）
{ "name": "list_favorites", "arguments": { "folder": "…", "limit": 20 } }
```

`search_favorites` 的返回字段：`siteId` / `title` / `url` / `description` / `note` / `tags` / `folderId` / `createdAt` + `matchScore`（词法分或语义相似度，6 位小数）/ `matchedBy`（每路召回的名次）/ `correction`（仅词法 0 命中且纠出替代问法时出现）/ `semanticAvailable`（模型缺失/编码失败时为 false，只剩词法）。空白查询返回空结果不报错；超长查询（>256 字）被契约拒绝。语义路阈值与 `/api/ask` 同口径（有词法命中 0.4、纯语义 0.55），但**不做 LLM 问答**——想让模型基于收藏回答，仍走网页端的 `/api/ask`。
