# 07 · packages/mcp —— MCP Server

> 包名 `@navhub/mcp`，bin `navhub-mcp`。让 AI Agent（Claude Desktop / Cursor 等）通过标准 MCP 协议**读写导航数据**。
> 两种传输：**stdio**（本地）与 **HTTP**（远程）。
> 核心安全模型对齐 MCP 官方 Security Best Practices——**这些约束不是「文档建议」，而是写在代码里、有测试覆盖的硬边界**。

## 1. 模块文件清单

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| [tools.ts](file:///c:/Users/许进龙/Desktop/web/packages/mcp/src/tools.ts) | ~230 | **15 个工具定义** + zod 输入 schema + 权限模型（`requireScope` / `MAX_BATCH_ITEMS`） |
| [handlers.ts](file:///c:/Users/许进龙/Desktop/web/packages/mcp/src/handlers.ts) | ~360 | **工具实现**（`createHandlers(ctx)`）：权限校验 → 幂等去重 → 审计落库 |
| [stdio.ts](file:///c:/Users/许进龙/Desktop/web/packages/mcp/src/stdio.ts) | 98 | **stdio 传输**：MCP SDK `Server` + `StdioServerTransport` |
| [http.ts](file:///c:/Users/许进龙/Desktop/web/packages/mcp/src/http.ts) | 130 | **HTTP 传输**：`node:http` 裸服务，Bearer token + Origin 校验 |

依赖：`@modelcontextprotocol/sdk 1.32.1`、`@navhub/api`（复用 `createContext`/`loadConfig`）、`@navhub/core`、`@navhub/store`、`@navhub/ai`、`zod`、`zod-to-json-schema`。
测试：`test/mcp.test.ts`——权限硬边界、dryRun 默认行为、幂等、审计、admin 级工具。

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

## 3. 工具清单（15 个）

| 工具 | scope | mutating | 输入参数 | 行为 |
| --- | --- | --- | --- | --- |
| `search_sites` | read | ✗ | `query`(必)、`limit`(1-50, 默认10)、`categoryId`、`tag` | 混合检索，返回 `matchedBy`（**每路召回的名次**）作为可解释依据 |
| `get_site` | read | ✗ | `idOrUrl` | 按 id 或网址取详情 |
| `list_categories` | read | ✗ | `includeCounts`(默认 true) | 类目列表 + 站点数 |
| `get_stats` | read | ✗ | — | 统计 + `capabilities` |
| `get_trending` | read | ✗ | `limit`(1-50, 默认10) | 热度榜，带 `visits7d` / `trendScore` 分量 |
| `list_tags` | read | ✗ | `minCount`(默认1)、`limit`(1-200, 默认50) | 标签 + 关联站点数（热度降序） |
| `create_site` | **write** | ✓ | `url`(必)、`title`、`description`、`categoryId`、`tags`(≤8)、`enrich`(默认 true)、`idempotencyKey` | 自动抓取 + AI 富化；**网址已存在返回已存在站点而非报错** |
| `update_site` | **write** | ✓ | `id`(必)、`title`、`description`、`categoryId`、`tags`、`featured` | 更新并重建索引 |
| `set_status` | **write** | ✓ | `id`(必)、`status` | 审核投稿 / 标记失效 |
| `batch_import` | **write** | ✓ | `sites`(1-100)、`defaultCategoryId`、**`dryRun`(默认 true)**、`idempotencyKey` | 先预览 `plan`（create/skip），确认后再执行 |
| `health_check` | **write** | ✓ | `limit`(1-200, 默认50)、`onlyUnchecked` | 巡检并写回健康状态；**经 `repo.updateSiteHealth()` 走仓储抽象，lite(SQLite) 与 full(PostgreSQL) 均可用**（此前直写 SQLite，PG 模式直接 fail） |
| `delete_site` | **write** | ✓ | `idOrUrl`(必)、`idempotencyKey` | **软删除**（进回收站，可经 `/api/trash/:id/restore` 恢复）；站点不存在返回 `reason:"not_found"` 而非报错（幂等重试） |
| `export_sites` | read | ✗ | `categoryId`、`status`、`format`(json/csv，默认 json)、`limit`(1-1000, 默认200) | 导出站点清单；**CSV 对 `=+-@` 开头的值加前导单引号转义**（防 Excel 公式注入） |
| `refresh_site` | **write** | ✓ | `idOrUrl`、`llm`(默认 false) | **入队** `refetch_metadata`，异步执行（不立即返回新元数据） |
| `run_job` | **admin** | ✓ | `kind`(4选1)、`payload` | 入队后台任务；需 admin——会触发全站扫描 |

> **只读 7 个 / 写 8 个**（`mutating` 字段划分），测试 `工具清单 > 包含 7 个只读工具与 8 个写工具` 锁死该名单。

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

富化链：`enrichUrl()` → 用 `suggestedCategory` 匹配已有类目 → 匹配不到用第一个类目 → 兜底新建「未分类」。
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

### 5.1 stdio（[stdio.ts](file:///c:/Users/许进龙/Desktop/web/packages/mcp/src/stdio.ts)）

**本地客户端直接拉起，没有网络攻击面**，权限由启动它的用户决定——因此 **scope 默认 `read,write`**（仍可用环境变量收紧）。

```json
{
  "mcpServers": {
    "navhub": {
      "command": "node",
      "args": ["--experimental-strip-types", "packages/mcp/src/stdio.ts"],
      "env": {
        "NAVHUB_MODE": "lite",
        "NAVHUB_SQLITE_PATH": "./data/navhub.db",
        "NAVHUB_MCP_SCOPES": "read,write"
      }
    }
  }
}
```

| 机制 | 实现 |
| --- | --- |
| 身份 | `NAVHUB_MCP_ACTOR`（默认 `mcp:stdio`） |
| scope | `NAVHUB_MCP_SCOPES`（默认 `read,write`） |
| 工具发现 | `ListToolsRequestSchema` → `TOOL_DEFS`，**写工具的 description 追加「（写操作，会修改数据）」** |
| 入参描述 | `zodToJsonSchema(schema, { $refStrategy: "none" })`——全仓 zod 固定 v3，v3 无内置 `toJSONSchema`，故用社区实现 `zod-to-json-schema`；**转换失败退回宽松描述** `{type:"object", additionalProperties:true}`，保证工具仍可被发现与调用 |
| 错误 | 捕获后返回 `isError: true` + `调用失败：<message>` |

### 5.2 HTTP（[http.ts](file:///c:/Users/许进龙/Desktop/web/packages/mcp/src/http.ts)）

**HTTP 模式暴露在网络里，因此必须显式鉴权。**

| # | 安全措施 | 实现 |
| --- | --- | --- |
| 1 | **默认只监听 `127.0.0.1`** | `NAVHUB_MCP_HTTP_HOST` 默认 `127.0.0.1`，要对外必须显式改 |
| 2 | **必须提供 Bearer token** | `NAVHUB_MCP_TOKEN`；缺省且未设 insecure → **拒绝启动，`process.exit(2)`** |
| 3 | **校验 `Origin`** | 只有显式配置在 `NAVHUB_MCP_ALLOWED_ORIGINS` 里的来源才接受浏览器请求——**防 DNS rebinding / CSRF** |
| 4 | token 的 scope 决定可调用的工具集合 | `NAVHUB_MCP_SCOPES`（默认 `read,write`） |

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
| GET | `/health` | `{ ok, capabilities, tools }`——**无需鉴权** |
| GET | `/tools` | 工具清单（**按 scope 过滤**：`toolCtx.has(t.scope) \|\| t.scope === "read"`） |
| POST | `/tools/<name>` | 调用工具；请求体上限 **1MB**（超限 413） |
| — | 其他 | 404 + hint |

**错误映射**：消息含「权限」→ **403**，其他 → **400**；未知工具 → 404；未实现 → 501。

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

compose 里的服务 `mcp`（[docker/docker-compose.yml](file:///c:/Users/许进龙/Desktop/web/docker/docker-compose.yml#L128-L156)）：

| 配置 | 值 |
| --- | --- |
| command | `node --experimental-strip-types packages/mcp/src/http.ts` |
| 端口 | `${NAVHUB_MCP_PORT:-8790}:8790` |
| `NAVHUB_MCP_HTTP_HOST` | `0.0.0.0`（容器内必然要对外） |
| `NAVHUB_MCP_TOKEN` | `${NAVHUB_MCP_TOKEN:-}` |
| `NAVHUB_MCP_SCOPES` | 默认 `read,write` |
| 数据 | 共享 `navhub-data:/data`（同一 SQLite + 模型缓存） |

> ⚠️ **compose 刻意不用 `:?` 强制校验**：Compose 会在**解析期**校验所有 profile 的变量，用 `:?` 会导致「仅想启动 postgres」的命令也直接失败。**真正的强制校验放在 `mcp/src/http.ts` 启动逻辑里**（未设 token 时拒绝启动，退出码 2）。

## 8. 环境变量汇总

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NAVHUB_MCP_SCOPES` | `read,write` | 逗号分隔 scope（stdio 与 HTTP 共用） |
| `NAVHUB_MCP_ACTOR` | `mcp:stdio` / `mcp:http` | 审计 actor 标识 |
| `NAVHUB_MCP_HTTP_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `NAVHUB_MCP_HTTP_PORT` | `8790` | HTTP 端口 |
| `NAVHUB_MCP_TOKEN` | `""` | **HTTP 模式必填**，缺失拒绝启动 |
| `NAVHUB_MCP_ALLOW_INSECURE` | `false` | 本地调试降级为只读 |
| `NAVHUB_MCP_ALLOWED_ORIGINS` | `""` | Origin 白名单（逗号分隔） |

其余（`NAVHUB_MODE` / `NAVHUB_SQLITE_PATH` / `NAVHUB_LLM_*` / `NAVHUB_EMBEDDING_*`）由 `@navhub/api` 的 `loadConfig()` 消费，见 [09-run-and-test.md](./09-run-and-test.md)。
