# ADR-0001 · lite 模式明确单进程约束（多实例语义决策）

- **状态**：proposed（2026-11-06，待运维/架构评审）
- **背景**：packages/store/src/repository.ts:90-148 的 DbAccessGate 是**进程内**队列；driver.ts:1204 在 lite 模式全进程只开一个 better-sqlite3 连接（busy_timeout=10000）；jobs.ts:57-59 自认 enqueueJobIfAbsent 在两实例下可能重复入队；identity-signature.ts 的重放缓存、llm-quota.ts 的预留、StreamBudget、categoryTreeCache/expansionCache 全是进程内状态。docs/BACKEND-OPTIMIZATION-PLAN-2026-10-30.md §8 已把「是否引入 Redis」列为待决策，但**无 ADR、无结论**。
- **风险**：K8s 多 pod / PM2 cluster / 同时跑 taxonomy-migrate.mjs 与 API 时，① 两个进程各自 BEGIN IMMEDIATE 只靠 busy_timeout 排队，长事务（8k 快照保存、reindex 10 分钟）把另一进程拖到 10s 超时；② 配额与出站预算各副本独立计数（总量约等于副本数乘阈值）；③ 缓存只能靠 60s TTL 陈旧；④ SQLite 侧 claimNextJob 靠进程内事务，跨进程会重复认领。
- **决策（分阶段）**：
  1. **立即（零成本）**：在 README / docker/docker-compose.yml / .env.example 明确写「**lite 模式 = 单进程单实例**；standard 模式才支持多副本」。compose 的 api 服务不设 deploy.replicas。这条不改变任何代码，只消除「以为能横向扩容」的误解。
  2. **若确需多实例**：standard 模式（PostgreSQL）已用 FOR UPDATE SKIP LOCKED + maxConcurrency + per-kind lane，是官方支持路径。仍缺的三处需另行立项：Redis（或 PG LISTEN/NOTIFY）统一限流/缓存失效/LinUCB 模型快照；enqueueJobIfAbsent 改 UNIQUE(kind) WHERE status IN (...) 部分唯一索引；claimNextJob 统一 UPDATE ... WHERE status='pending' RETURNING 原子语句。
  3. **不引入 Redis 的替代**：把身份重放缓存迁到 llm_quota_reservations 同款事务表（已有先例），用 data_version 做缓存失效广播。代价是每次请求多一次 DB 往返。
- **验收**：4 副本压测下配额/任务认领总量误差 <5%；缓存陈旧窗口 <1s；README 与 compose 有显式单实例声明。
- **后果**：接受「lite 不能横向扩容」这一约束，换取零外部依赖的 NAS/个人部署体验；多实例需求引导到 standard 模式。
