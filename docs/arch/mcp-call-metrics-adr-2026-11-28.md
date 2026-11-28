# ADR-0009 · MCP 调用量可度量最小契约

> 作者：架构师 ｜ 状态：**Accepted** ｜ 双签人：架构师 + 山羊胡网总管 ｜ 日期：2026-11-28
> 性质：只冻结契约，不改源码 / 公共类型 / CI / gates.json；不碰已 Accepted 的 ADR-0008。
> 证据口径：下列 file:line 取自 2026-11-28 当前工作树（ADR-0008 三道门已落地后）。

---

## 0. 结论先行

**调用量可度量不需要新表、不需要新写入——直接复用 ADR-0008 门二审计在 audit_logs 里落的 mcp.tool.call 记录作为指标源。** 门二已对每次工具调用记一行（actor + target + count + created_at），这本身就是一座按调用方可聚合、跨实例跨重启持久的调用量数据仓。要验证「第三方接入量可度量」，只差一个按 actor 聚合的查询视图，不差采集。

这是「立足硬前提」的最小实现：零新增写入路径、零新表、零首屏/进程开销。

---

## 1. 为什么现有 recordHttpMetric 不能复用（问题④）

| 维度 | recordHttpMetric（apps/api/src/metrics.ts:99-117） | MCP 调用量需求 |
|---|---|---|
| 载体 | 进程内 Map（metrics.ts:25 httpCounts），重启即丢 | 跨实例、跨重启持久 |
| 维度 | method + route + status，**故意不含 actor**（metrics.ts:3-5 有界基数纪律） | **核心就是 actor**（要回答"谁在调用、调多少"） |
| 挂载 | Fastify onResponse hook（server.ts:282-286） | MCP 是独立 node:http 进程（apps/mcp/src/http.ts），不经过 Fastify hook |
| 出口 | /metrics 导出 Prometheus 文本 | 需按 actor 聚合查询（SQL 即可） |

**不能复用的决定性理由两条**：① 进程内 Map 在多实例下无法合并、重启清零，而 MCP 对外服务必然多实例；② recordHttpMetric 按设计不记 actor（防止 URL/身份导致基数爆炸），而"调用量可度量"要度量的正是 actor。**对齐点**：口径上两者都只记有界维度——MCP 记工具名（target），不记 params / 返回值 / 原始 URL，呼应 metrics.ts:3-5 的基数纪律；两者都 fail-open，观测失败不影响主链路。

---

## 2. 指标源契约（问题①②）

### 数据源：audit_logs 表（复用，零新建）

schema 见 packages/store/src/schema.ts:460-469：
- actor TEXT NOT NULL（有索引 audit_logs_actor_idx）
- actor_kind TEXT
- action TEXT NOT NULL
- target TEXT（工具名）
- diff TEXT（JSON 元数据）
- ip TEXT
- created_at INTEGER NOT NULL（有索引 audit_logs_created_idx）

ADR-0008 门二每次工具调用写一条 action="mcp.tool.call"（见 apps/mcp/src/egress-gates.ts:104-117）：
- actor = ToolContext.actor（静态 token = opts.actor；表内 token = "mcp:"+name）
- actor_kind = "mcp"
- action = "mcp.tool.call"
- target = 工具名（search_sites / export_sites / …）
- diff = {count:1, scope, mutating, tookMs, quotaRemaining}（**不含 params / 返回值**）

### 写入时机与三条入口（问题①）

统一写入点 = ADR-0008 三道门执行点 runGates（apps/mcp/src/http-server.ts:239-256）→ enforceEgressGates（egress-gates.ts:77-123）内的 repo.audit。

| 入口 | 是否计入调用量 | 时机 | 依据 |
|---|---|---|---|
| 标准通道 POST /mcp | 计入 | 鉴权后、分发前；toolCallNames(parsed.body) 识别（http-server.ts:343），每个 tools/call 记一条 | runGates 在 auth()（:247）之后 |
| 兼容端点 POST /tools/<name> | 计入 | 鉴权后、分发前；与标准通道共用 runGates | ADR-0008 裁定③要求两条路径统一覆盖 |
| stdio（apps/mcp/src/stdio.ts） | **不计入** | 无鉴权、无 runGates（grep egress/gate/audit/metric 0 命中） | 本地单用户进程，无"第三方接入量"语义；强行记会污染聚合口径 |

**鉴权前 vs 鉴权后**：必须在鉴权后写。鉴权前没有可信 actor，401 请求也不该算作"成功调用"。失败鉴权（401）与超限（429）是否计入：egress-gates.ts 的实际顺序是 :90 bumpQuota → :97 allowed 判定 → :104-117 audit 无条件执行 → :122 return，即 **allowed 判定在 audit 之前，但 audit 在判定之后仍无条件执行**，故**被配额拒绝的调用也已留痕**——这是有意的，拒绝本身是调用量的一部分；401 不计入（无 actor）。

**【协议语义注意事项 · 红队复核补充】** 标准 `/mcp` 通道的写工具被拒（只读 token 调 create_site 等）返回的是 **HTTP 200 + result.isError=true**（MCP 协议约定：工具失败走结果体，不改 HTTP 状态码），**不是 403**。因此未来任何针对三道门的 E2E / smoke 门禁，判断"只读 token 调写工具被拒"必须检查 `isError` 判据（并核对 sites 等未落库），**不能用 HTTP 状态码**——否则会把 isError 的 200 误判为"放行"，造成假绿。兼容端点 `POST /tools/<name>` 另有 403 分支，两条路径判据不同，门禁须分别处理。

---

## 3. 按 actor 聚合查询（问题③）

最小查询直接走 SQL（audit_logs 已有 actor / created_at 索引）：

    SELECT actor, target, COUNT(*) AS calls,
           MIN(created_at) AS first_call, MAX(created_at) AS last_call
    FROM audit_logs
    WHERE action = 'mcp.tool.call' AND created_at >= ?
    GROUP BY actor, target
    ORDER BY calls DESC;

现有接口已能取到逐条数据：GET /api/admin/audit?action=mcp.tool.call&actor=mcp%3Axxx（apps/api/src/routes/audit.ts:20-46）→ ctx.repo.listAuditLogs（packages/store/src/repository/events.ts:203）。**本契约只要求新增一个聚合视图**（可选 /api/admin/mcp/call-metrics，或直接用上面 SQL），不改现有审计接口。

北极星口径建议：unique actors（近 7 日 DISTINCT actor）= 第三方接入方数；calls（近 7 日 COUNT）= 调用量；两者趋势即"能否立足"的量化答案。

---

## 4. 写入失败语义（问题⑤，呼应 ADR-0008 门二）

**fail-open，与 ADR-0008 门二裁定②一致。** repo.audit() 内部 catch 后 console.error 吞掉（events.ts:143-153），调用量漏记不影响工具调用本身。理由同审计：fail-closed 会让 DB 抖动变成对外 5xx，对要公网开的目录服务伤害大于漏记。

fail-open 的固有风险是漏记无人知。ADR-0008 裁定②已定"每日 count 对账告警"。本契约补一个**独立交叉对账信号**：配额计数写 system_states 的 mcp:quota:*（egress-gates.ts:59-70），与审计是两次独立写入、不同表、不同代码路径，同时失败概率低。对账口径：

    SELECT SUM(CAST(value AS INTEGER)) FROM system_states WHERE key LIKE 'mcp:quota:%';

该值与 audit_logs 的 mcp.tool.call 计数按日比对，差异超阈值即告警。注意配额 key 带窗口起点且无清理，此值为**累计近似**（含被 429 拒绝的调用），仅作对账信号，不作精确指标——精确值仍以 audit_logs 为准。

---

## 5. 兼容性与影响面

- **不破坏**：不新增表、不改 schema、不改现有审计接口；stdio 行为不变。
- **零成本**：采集已由 ADR-0008 门二完成，本契约不加任何写入。
- **回滚**：无需回滚采集；若不接受聚合视图，删掉视图即可，底层数据仍在。
- **限制（须如实报）**：audit_logs 保留 365 天（见 packages/store/src/repository/safety.ts 关于 365 天保留的说明），超期数据不可查——对"趋势"验证够用，对"全历史"不够。

---

## 6. 是否能支撑「第三方接入量可度量」验证

**能。** 三个验证标准逐条对照：① "有第三方接入" — DISTINCT actor 按日趋势可直接读出接入方数；② "调用量能被度量" — mcp.tool.call 的 COUNT 按 actor + target 可聚合，且跨实例持久；③ "替换成本来自数据质量" — 这条不由本契约负责（属数据侧），但调用量埋点已把前两条从"空白"变成"可查"。采集零增量，缺的只有一个聚合视图，成本极低。

---

## 7. 实际读取的文件（证据）

apps/api/src/metrics.ts、apps/api/src/server.ts、apps/api/src/routes/audit.ts、apps/mcp/src/http.ts、apps/mcp/src/http-server.ts、apps/mcp/src/stdio.ts、apps/mcp/src/egress-gates.ts、packages/mcp/src/tools.ts、packages/store/src/schema.ts、packages/store/src/repository/events.ts、packages/store/src/repository/events.ts(audit/listAuditLogs)、packages/store/src/repository/safety.ts、docs/arch/mcp-egress-security-gates-adr-2026-11-28.md。未改任何文件（本文除外），未 commit/push。
