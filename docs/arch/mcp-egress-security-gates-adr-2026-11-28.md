# ADR-0008 · MCP HTTP 出口三道安全门契约冻结

> 作者：架构师 ｜ 状态：**Accepted** ｜ 双签人：架构师 + 山羊胡网总管 ｜ 日期：2026-11-28
> 性质：只冻结契约，不改业务代码 / 公共类型 / CI / gates.json；capabilities 下沉不在本文范围。
> 证据口径：下列 file:line 全部取自 2026-11-28 22:5x 当前工作树（P0 修复后，http-server.ts:33-34 已无重复 import）。

---

## 0. 决策一句话

**三道门全部挂在传输层 apps/mcp/src/http-server.ts 的鉴权之后、分发之前，封装为单个 enforceEgressGates()；不挂 packages/mcp/src/mcp-server.ts。** 理由：标准 MCP 通道的逐工具分发在 SDK 内部（mcp-server.ts:34-49 的 CallTool handler 拿不到 ServerResponse，无法回 429）；HTTP 层虽看不到工具名，但请求 body 里有 method:"tools/call" 与 params.name，足以识别工具调用。挂在传输层可同时覆盖标准通道与兼容端点，且能回真实 HTTP 429；挂在协议层要改契约域且只能回 JSON-RPC error。

**P0 判据：三道门未全部落齐并通过可复现验收前，NAVHUB_MCP_HTTP_HOST 保持 127.0.0.1，禁止改 0.0.0.0，禁止对公网开放。** 这是发布阻断项，不放宽。

---

## 1. 问题与攻击面（证据）

- packages/core/src/mcp-schemas.ts:864-866 定义 export_sites：scope: "read", mutating: false。**一个只读 token 即可全量导出 4823 条数据**，且现有读操作不落审计。
- apps/mcp/src/http-server.ts:173-177：静态引导 token（NAVHUB_MCP_TOKEN）视同 admin，默认 scopes read,write（:414-415，:141）。
- apps/mcp/src/http-server.ts:274 与 :326 的 429 是**会话/流资源上限**，不是 per-token 配额；同一 token 反复建会话与调用工具没有次数上限。
- packages/store/src/repository/events.ts:143 的 audit() 已存在，写 audit_logs(actor, actor_kind, action, target, diff, ip, created_at)，但 MCP 侧只有**写工具**在 handler 内调用（如 packages/mcp/src/handlers/sites.ts:106 的 actorKind:"mcp"），读工具一律不留痕。
- packages/store/src/repository/tokens.ts:108-114 的 findApiTokenByHash 已过滤吊销/过期；:96 的 revokeApiToken、:60 的 revokeApiTokenByOwner 已提供吊销能力。**专用只读可吊销 token 无需新表。**

---

## 2. 门一 · per-token 配额（429 可复现）

### 请求/响应契约

| 项 | 定义 |
|---|---|
| 计数键 | sha256(actor)，actor 来自 ToolContext.actor（packages/mcp/src/tools.ts:20-30）；静态 token 用 opts.actor，表内 token 用 "mcp:"+record.name（http-server.ts:189） |
| 计数粒度 | **每次工具调用 +1**，不含 initialize / tools/list / ping / SSE GET /mcp |
| 识别工具调用 | 标准通道：JSON-RPC body method === "tools/call"，工具名取 params.name；兼容端点：POST /tools/<name>（http-server.ts:357），工具名取 URL 段 |
| 窗口 | 固定窗口 60s；配额默认 120 次/分钟，环境变量 NAVHUB_MCP_RATE_LIMIT 覆盖；配到 0 = 禁用新调用（显式熔断） |
| 超限响应（标准通道） | HTTP 429，响应头 Retry-After: <剩余秒>，body {jsonrpc:"2.0", error:{code:-32029,message:"MCP_QUOTA_EXCEEDED"}, id:null} |
| 超限响应（兼容端点） | HTTP 429，{error:"MCP_QUOTA_EXCEEDED", retryAfterSeconds:n} |
| 错误码 | MCP_QUOTA_EXCEEDED / JSON-RPC -32029，与现有 -32000（通用）区分 |

### 挂载点

- apps/mcp/src/http-server.ts:246-253（auth() 返回 toolCtx 之后、currentBinding 计算之前）插入 enforceEgressGates()。
- 计数器建议新文件 apps/mcp/src/egress-gates.ts（后端域，本次只指定、不落地）。

### 代价与约束（必须让后端知道）

- **【双签裁定①】配额门用共享存储 system_states，不用进程内 Map。** 固定窗口 key = mcp:quota:<sha256actor>:<窗口起点ms>，单条原子 UPSERT 递增，多实例天然安全（system_states 的 CAS 原语见 packages/store/src/repository/system.ts:43-58）。不采用进程内 Map——会被多实例放大 N 倍，等于门白装。
- 固定窗口在窗口边界有 2 倍突发（59s 末 + 0s 初）。验收只需 429 可复现，不要求严格限流；若后续要严格，换令牌桶属独立 ADR。

---

## 3. 门二 · 读操作审计（actor + count 可查）

### 请求/响应契约

| 项 | 定义 |
|---|---|
| 落库 | 复用 audit()（events.ts:143），不新建表 |
| actor | ToolContext.actor（静态 token = opts.actor，表内 = "mcp:"+record.name） |
| actorKind | "mcp"（与现有写操作一致，见 sites.ts:106） |
| action | "mcp.tool.call" |
| target | 工具名（search_sites / export_sites / …） |
| diff | {count:1, scope:"read", mutating:false, tookMs:n, quotaRemaining:n}；**禁止把 params 或返回值写进 diff**（4823 条站点会被复制进审计表） |
| 查询 | 现有审计查询 apps/api/src/routes/audit.ts + listAuditLogs，按 actor + action 过滤后 count(*) |
| 成功判据 | 同一 actor 调 N 次读工具后，按 actor+action 查询得 count=N，且 target 分布可列 |

### 挂载点

与门一同一处（http-server.ts:246 之后），在配额通过后、分发前落审计。两个通道统一覆盖。

### 失败语义（双签裁定②）

**【双签裁定②】审计门保持 fail-open（events.ts:143-153 现状）+ 每日 count 对账告警；不改 fail-closed。** 理由：fail-closed 会让 DB 抖动变成对外 5xx，对要公网开的目录服务伤害大于漏记；且写操作本身走同一 DB，DB 挂了攻击也进行不了。fail-open 必须配对账告警，否则漏记无人知——每日 count 对账为强制配套项。

---

## 4. 门三 · 专用只读可吊销 token

### 契约

| 项 | 定义 |
|---|---|
| 判定 | 表内 token 且 parseScopes(record.scopes) 恰为 {read}（无 favorites/write/admin）即为"专用只读 token"；静态引导 token NAVHUB_MCP_TOKEN **不算**（它是应急引导凭据） |
| 签发 | 复用 createApiToken（tokens.ts:17），scopes="read"；管理页 /admin/tokens 勾 read 即可，无需新 UI |
| 吊销 | 复用 revokeApiToken（tokens.ts:96）或 revokeApiTokenByOwner（tokens.ts:60）；吊销后 findApiTokenByHash（:108-114）立即返回 null → auth()（http-server.ts:183-184）返回 null → 下一请求 401（http-server.ts:248-251） |
| 即时性 | 吊销在**下一个 HTTP 请求**生效；已建立的 SSE 会话在下次请求重校验时被 bindingMatches（http-server.ts:267-271 / :311-314）拆掉。无须主动推送关闭 |
| 兼容迁移 | ① NAVHUB_MCP_SCOPES 默认值由 read,write（http-server.ts:414）降为 read——静态 token 默认只读，要写权限须显式配置；② 存量表内 read,write token 继续有效（不强制轮换），但**公网部署只允许挂 read-only 表内 token**，由部署检查而非代码强制 |
| **【双签裁定④】越权验收** | 只读表内 token 调 create_site 须被拒（requireScope 已覆盖，纳入验收用例） |

### 理由

不引入 token 类型新列：scopes 已能表达"只读"，再加一个 purpose 列是重复抽象（违反"能用一个字段解决不引入一层"）。可吊销能力已完整存在，缺的只是**默认值与部署纪律**。

---

## 5. 兼容性与影响面

- **不破坏**：现有 read token、stdio 传输（apps/mcp/src/stdio.ts，默认 read）、兼容端点 /tools/<name> 全部继续可用。
- **改变**：静态 token 默认 scopes 从 read,write → read（需写权限者显式设 NAVHUB_MCP_SCOPES）；超限调用从"永远成功"变成 429。
- **回滚**：三道门封装在单一 enforceEgressGates() 调用点，回滚=删除该调用 + 恢复默认 scopes 常量；不触碰 token 表结构，无数据迁移。
- **前后端同步**：无前端改动；审计查询沿用 /admin/audit 现有页，无需新 UI。

---

## 6. P0 放行判据（全部满足才允许 HOST=0.0.0.0）

1. 门一：同一 token 第 N+1 次工具调用实测 HTTP 429、Retry-After 存在、标准通道错误码 -32029。
2. 门二：N 次读操作后按 actor+action 查询 audit_logs 得 count=N，diff 中无站点正文。
3. 门三：签发 read-only token → 吊销 → 下一请求实测 401，已建会话下一请求 403。
4. 门三越权：只读表内 token 调 create_site 实测被拒（requireScope）。
5. 三道门在**标准通道 POST /mcp 与兼容端点 POST /tools/<name> 两条路径**都验证过（防止绕道）。
6. CI smoke（mcp-http-smoke job）仍绿，check:generated / check:overlay EXIT=0。

任一不满足 → 维持 127.0.0.1，不对公网开。

---

## 7. 实际读取的文件（证据）

apps/mcp/src/http-server.ts、apps/mcp/src/stdio.ts、apps/mcp/src/http.ts、apps/mcp/package.json、packages/mcp/src/tools.ts、packages/mcp/src/mcp-server.ts、packages/mcp/src/host-context.ts、packages/mcp/src/handlers/shared.ts、packages/mcp/src/handlers/sites.ts、packages/core/src/mcp-schemas.ts、apps/api/src/auth.ts、packages/store/src/repository/tokens.ts、packages/store/src/repository/events.ts、docs/arch/arch-optimization-2026-11-28.md。未读取任何凭证值，未开公网，未改仓库任何文件（本文除外）。

---

## 8. 双签裁定（Accepted · 2026-11-28）

以下为架构师 + 山羊胡网总管双签逐字裁定，与 §2-§4 的落地条目一一对应：

【双签裁定①】配额门：共享存储 system_states，固定窗口 key=mcp:quota:<sha256actor>:<窗口起点ms>，单条原子 UPSERT 递增，多实例安全；不采用进程内 Map（会被多实例放大 N 倍）。

【双签裁定②】审计门：保持 fail-open（events.ts:143-153 现状）+ 每日 count 对账告警；不改 fail-closed（DB 抖动会变对外 5xx）。

【双签裁定③】挂载层：三道门统一挂传输层 http-server.ts:246-253 鉴权后，封装 enforceEgressGates()，覆盖标准通道 /mcp + 兼容端点 POST /tools/<name> 两条路径。不采纳挂 mcp-server.ts CallTool 入口——兼容端点 :357-368 直接调 handlers[name] 不经过它，且 CallTool 无 ServerResponse 回不了 429。

【双签裁定④】门三验收补一条：只读表内 token 调 create_site 须被拒（requireScope 已覆盖，纳入验收用例）。
