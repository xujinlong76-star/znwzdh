# ADR-0010 · MCP fail-open 对账兜底设计（审计/配额双写一致性）

> 作者：架构师 ｜ 状态：**Accepted** ｜ 双签人：架构师 + 山羊胡网总管 ｜ 日期：2026-11-28
> 性质：只设计契约，不改业务代码 / 公共类型 / CI / gates.json；不改 ADR-0008 / ADR-0009 核心结论（仅引用）。
> 背景：ADR-0008 裁定②与 ADR-0009 §5 写明「fail-open + 每日 count 对账告警」，但总管独立复验确认该对账任务全仓不存在（mcp:quota:* 与 mcp.tool.call 均只写不读）。这是当前唯一上线前阻断项。

---

## 0. 结论先行

对账不是「近似比对」，而是**精确相等校验**：配额计数与审计在 egress-gates.ts 的同一次调用里**无条件双写**，因此在同一时间窗口内 `SUM(mcp:quota:*) == COUNT(mcp.tool.call)` 应当严格成立。任何差异都是漏记或服务故障，直接可告警。

任务挂现有 JobRunner（新增 job kind，DAILY5AM 档），复用 sendWebhookAlert（alerts.ts:104）告警、claimSystemState（system.ts:43，CAS 原子）做多实例去重。对账同时顺带清理过期 mcp:quota key。

**一句话判定（问题④先说结论）**：对账对本项目威胁模型（远程只读 token 拖库）充分——远程调用方无法让 DB 写入失败，任何写失败都是系统故障；对「单边写失败」能抓、对「双边写都失败但读正常」抓不到（两边停在同一基线），后者必须靠写失败日志告警兜底。**对账 + 写失败日志告警双管齐下后可解除上线前阻断项，单靠对账不能。**

---

## 1. 数据源与语义（问题①）

| 数据源 | 写入点 | 写入形态 | 语义 |
|---|---|---|---|
| system_states 的 mcp:quota:* | egress-gates.ts:59-70 bumpQuota | key = mcp:quota:<sha256actor>:<windowStart ms>，value = 纯数字文本，单条 UPSERT CAST+1 | 每次 tools/call 尝试 +1，含被 429 拒绝的（bump 在 allowed 判定之前）；key 无清理、累计增长；windowStart 编码在 key 尾部 |
| audit_logs 的 mcp.tool.call | egress-gates.ts:103-120 repo.audit | 每调用一行，diff={count:1,scope,mutating,tookMs,quotaRemaining} | 每次 tools/call 无条件写一行；fail-open（events.ts:143-153）；保留 365 天（safety.ts） |

**关键等同性**：egress-gates 执行顺序是 `:90 bumpQuota → :97 allowed 判定 → :104-117 audit 无条件执行 → :122 return`。bump 与 audit 都在各自 try 内、都无条件执行，且都不区分 allowed 结果。因此除写失败外，两者一一对应——这是精确对账成立的基础。

**两处必须说清的差异**：
- 配额含 429、审计也含 429（两边都记），故「含 429」不是差异来源；差异只来自写失败。
- quota key 无清理 → 全局 SUM 是累计值；审计按 created_at 有保留期。对账必须按窗口对齐（见 §5 SQL），不能用全表 SUM 对全表 COUNT。
- audit 侧 actor 是明文（mcp:<name>），quota key 里是 sha256(actor)，无法反推——故对账按全局汇总为主，不按 actor 逐一比对（见 §6 能力边界）。

---

## 2. 对账任务挂点与频率（问题②）

- **挂载**：新增 job kind `mcp_audit_reconciliation`，走现有 JobRunner（apps/api/src/jobs.ts:147/149 的 JobKind/JOB_KINDS，:198 DEFAULT_CRON_SCHEDULES，:543-568 DEFAULT_SCHEDULES，:610-634 CRON_EXPRS）。这几处是 job 契约登记点，落地时需同步加一行；本 ADR 只指定、不改码。
- **频率**：DAILY5AM（与 user_data_audit 同档，避开业务高峰），intervalMs = 86_400_000。对账窗口取前一日 00:00–24:00（windowMs 整数倍边界）。
- **读什么**：system_states 的 mcp:quota:*（按 key 尾部 windowStart 过滤到对账窗口）+ audit_logs 的 mcp.tool.call（按 created_at 过滤到同一窗口）。
- **写什么**：仅写一条告警去重占位（claimSystemState，key=mcp:recon:<YYYYMMDD>，windowMs=24h）与过期 key 清理（§5）；不写业务数据。
- **为何不新起独立 cron**：JobRunner 已有单实例锁、失败告警、超时/并发控制（jobs.ts:543+），另起 cron 等于重造一套；多实例部署下 JobRunner 锁保证只有一个副本跑对账。

---

## 3. 告警阈值与通道（问题③）

- **判据**：quotaTotal 与 auditCount 不相等即异常。考虑进程在 bump 与 audit 之间崩溃的偶发窗口，给容差：差异绝对值 > max(5, ceil(quotaTotal × 0.01)) 才告警，且连续 2 个对账日超阈值才升级为 P0（防单日抖动误报）。
- **通道**：复用 sendWebhookAlert（alerts.ts:104-138），detail.kind = mcp_audit_reconciliation，text 写明窗口、quotaTotal、auditCount、diff。webhook URL 来自运维配置（alerts.ts:6 内网机器人允许、不走 SSRF 守卫，协议限 http/https）。
- **多实例去重**：用 claimSystemState（system.ts:43-58，CAS 原子）占坑 key=mcp:recon:<YYYYMMDD>，windowMs=24h；与 alerts.ts:37-42 的 AlertDeduper 二选一即可，建议用 claimSystemState（跨实例持久，MemoryAlertDeduper 只挡单副本）。
- **无 webhook 配置时**：退化为写 audit_logs 一条 action=mcp.recon.mismatch 的审计行（fail-open 场景下的兜底留痕），并在 /api/admin/audit 可查——不因缺配置而静默放过。

---

## 4. 写失败日志告警（问题④的配套，必须项）

对账抓不到的「双边写都失败 + 读正常」场景，唯一信号是 egress-gates 的两处 console.error：
- egress-gates.ts:92 「配额计数失败，按 fail-open 放行」
- egress-gates.ts:119 「出口审计写入失败（fail-open，主调用不受影响）」

要求运维在日志侧对这两条做告警（与 JobRunner 告警同通道）。**这不是可选项**：没有它，双边写失败时对账显示相等、日志也没人看，fail-open 就真的无兜底。

---

## 5. 能力边界（问题④，如实说）

| 场景 | 对账能否抓到 | 说明 |
|---|---|---|
| 远程只读 token 无限拖库（本项目威胁模型） | 能 | 远程调用方无 DB 连接，无法让写失败；每行工具调用都双写，对账精确 |
| 单边写失败：定向锁 audit_logs INSERT（读正常） | 能 | quota 正常写、audit 漏记 → quotaTotal > auditCount |
| 单边写失败：定向锁 system_states INSERT（读正常） | 能 | audit 正常写、quota 漏记 → auditCount > quotaTotal |
| 双边写都失败 + 读正常（如 DB 写锁被占） | **抓不到** | 两边停在同一基线、对账相等；只能靠 §4 写失败日志告警 |
| 跨 actor 精确定位哪个调用方漏记 | 抓不到 | quota key 存 sha256(actor) 无法反推；全局汇总只能发现总量异常，定位靠 audit 侧 actor 分布 |
| 对账窗口之前的历史漏记 | 抓不到 | 对账只看指定窗口；历史数据靠 audit 365 天保留期人工追溯 |

---

## 6. 关键 SQL（双方言）

对账窗口 [T1, T2)（毫秒，windowMs 整数倍边界）。quota 侧从 key 尾部提取 windowStart（key 固定格式 mcp:quota:<64hex>:<13位ms>，末 13 位）：

SQLite:
    SELECT SUM(CAST(value AS INTEGER)) AS quota_total
    FROM system_states
    WHERE key LIKE 'mcp:quota:%'
      AND CAST(substr(key, -13) AS INTEGER) >= ? AND CAST(substr(key, -13) AS INTEGER) < ?;

PostgreSQL:
    SELECT SUM(CAST(value AS BIGINT)) AS quota_total
    FROM system_states
    WHERE key LIKE 'mcp:quota:%'
      AND RIGHT(key, 13)::bigint >= ? AND RIGHT(key, 13)::bigint < ?;

audit 侧（双方言一致）：
    SELECT COUNT(*) AS audit_count
    FROM audit_logs
    WHERE action = 'mcp.tool.call'
      AND created_at >= ? AND created_at < ?;

聚合视图（runbook 用，给 /api/admin 或直接 SQL）：
    SELECT actor, target, COUNT(*) AS calls
    FROM audit_logs
    WHERE action = 'mcp.tool.call' AND created_at >= ?
    GROUP BY actor, target ORDER BY calls DESC;

过期 key 清理（用 updated_at，避免 key 文本解析的方言差异；只删对账窗口保留期之前的）：
    DELETE FROM system_states
    WHERE key LIKE 'mcp:quota:%' AND updated_at < ?;

---

## 7. 过期 key 清理策略（问题⑤）

清理（否则累计无限增长）：由对账任务顺带执行，保留期 = 对账回溯窗口 + 1 天（默认 8 天），用 updated_at < cutoff 删除。理由：quota key 只在当日窗口写入，updated_at 即最后写入时间；超过 8 天的 key 对任何对账都无用。

风险：清理会抹掉历史累计值，但 audit_logs 保留 365 天且对账只看近期窗口，不影响可追溯性。清理本身写 system_states，若与对账读同事务，需注意 WAL 下读写一致——建议清理放在对账读数之后、告警判定之后执行。

---

## 8. 影响面与回滚

- **不破坏**：不改三道门代码、不改 Accepted ADR 核心结论、不改现有审计接口。
- **新增**：一个 job kind 登记（jobs.ts 四处）+ 一个 webhook 告警配置 + 一个对账实现文件（apps/api 域）。
- **回滚**：不登记该 job kind 即停止对账；quota key 清理可独立关闭。无数据迁移。
- **容量**：mcp:quota:* key 数量 = 活跃 actor 数 × 窗口数，清理后稳定在 8 天量级；对 audit_logs 无额外写入（无 webhook 时加一条 mismatch 审计，频率极低）。

---

## 9. 实际读取的文件（证据）

apps/mcp/src/egress-gates.ts、apps/mcp/src/http-server.ts、packages/store/src/repository/system.ts、packages/store/src/repository/events.ts、packages/store/src/schema.ts、apps/api/src/jobs.ts、apps/api/src/alerts.ts、apps/api/src/routes/audit.ts、docs/arch/mcp-egress-security-gates-adr-2026-11-28.md、docs/arch/mcp-call-metrics-adr-2026-11-28.md。未改任何文件（本文除外），未 commit/push，未夹带 capabilities 下沉。
