# 11 · 运维手册：发布回滚、on-call runbook、SLO 与备份恢复

> 面向"服务已经跑起来之后"的日常工作：怎么发版、出问题怎么处置、怎么用指标判断好坏、数据怎么备份与恢复。
> 相关：[08 · 扩展 / 脚本 / Docker](./08-extensions-scripts-docker.md)、[09 · 运行方式、配置与测试](./09-run-and-test.md)。

## 1. 部署形态一览

| 形态 | 入口 | 数据 | 适用 |
| --- | --- | --- | --- |
| 本仓 Docker Compose（推荐） | `docker/docker-compose.yml` | 卷 `navhub-data`（SQLite，lite）或 `postgres` 服务（standard） | 个人 / NAS / 小团队 |
| 裸机 | `pnpm dev` / `node --experimental-strip-types apps/api/src/main.ts` | `./data/navhub.db` | 本地开发 |
| 前端独立 | `pnpm dev:web`（`apps/web`，vendored 上游 + overlay） | 走中枢 HTTP 适配器 | 本地开发 |

镜像与容器名：`navhub/api:0.1.0`（容器 `navhub-api`）、`navhub/web:0.1.0`（容器 `navhub-web`），
compose 里还有可选的 `postgres`（pgvector/pg17）与 `mcp`。

---

## 2. 发布与回滚

### 2.1 发布（Docker Compose）

```bash
# 1) 备份当前数据（lite: SQLite 热备；standard: pg_dump，见 §5）
node scripts/backup.mjs                 # lite
node scripts/backup-pg.mjs              # standard（需本机或容器内 pg_dump）

# 2) 构建新镜像（tag 用 git short sha，别用 latest，回滚时才知道回哪里）
export TAG=$(git rev-parse --short HEAD)
docker build -f docker/Dockerfile.api -t navhub/api:$TAG .
docker build -f docker/Dockerfile.web -t navhub/web:$TAG .

# 3) 灰度替换（compose 里把 image 指到 $TAG）
docker compose -f docker/docker-compose.yml up -d

# 4) 观察 5 分钟：健康、任务、关键指标
curl -fsS http://127.0.0.1:8787/api/health
curl -fsS http://127.0.0.1:8787/api/metrics | head
```

发布前必跑（与 CI 同款）：`pnpm verify`（overlay + 扩展 + typecheck + 711 单测），
涉及前端再跑 `pnpm verify:all`（含 Playwright 与 lint）。

### 2.2 回滚

```bash
export PREV=<上一个已知可用的 tag>
docker compose -f docker/docker-compose.yml down          # 只停容器，卷保留
# 把 compose / 部署配置里的 image 改回 $PREV 后：
docker compose -f docker/docker-compose.yml up -d
curl -fsS http://127.0.0.1:8787/api/health
```

**关键约束**：回滚只回代码，不回数据。
- 数据库 schema 变更必须向前兼容（只加列 / 只加表，不删列、不改语义），否则旧代码读新库会炸。
- 真需要回退数据结构时，走 §5 的恢复流程（用备份文件重建），并接受备份点之后的数据丢失。
- 前端 `apps/web` 是构建期产物（vendored 上游 + overlay），回滚时随镜像整体回退，不需要单独处理。

### 2.3 发布前的门禁清单

| 项 | 命令 | 失败含义 |
| --- | --- | --- |
| 覆盖层一致 | `node scripts/check-web-overlay.mjs` | apps/web 改了没同步回 overlay，镜像里会丢改动 |
| 上游 ref 一致 | `node scripts/check-upstream-ref.mjs` | vendor / Dockerfile / UPSTREAM.md 三处声明不一致 |
| 扩展规范 | `node scripts/check-extensions.mjs` | Chrome / Raycast 扩展产物不合规 |
| 类型 | `pnpm typecheck` | 包层类型错误 |
| 单测 | `pnpm test` | 711 通过 / 11 跳过（PG 套件未配置时跳过） |
| 前端 lint | `pnpm lint` | 0 error（warning 不卡门禁，当前 269 条） |
| 镜像可构建 | `docker build -f docker/Dockerfile.{api,web}` | CI 的 docker-smoke job 同款 |

---

## 3. on-call runbook（症状 → 检查 → 处置）

| 症状 | 快速检查 | 处置 |
| --- | --- | --- |
| 容器起不来，日志出现 `SESSION_SECRET` | 生产未配 ≥32 字符密钥 | 设置 `NAVHUB_SESSION_SECRET`；compose 未设时由 `entrypoint.sh` 生成并持久化到 `/data/.session-secret` |
| 容器起不来，日志出现 `NAVHUB_AUTH_REQUIRED` | 生产 + 公网 `NAVHUB_PUBLIC_URL` + 未开鉴权（fail-closed） | 设 `NAVHUB_AUTH_REQUIRED=true` + `NAVHUB_BOOTSTRAP_TOKEN`；确认不可公网访问时设 `NAVHUB_ALLOW_INSECURE_PUBLIC=1` |
| `/api/health` 非 200 | `docker logs navhub-api`、`/api/metrics` | 先看是 DB 连不上（PG 未就绪 → 等容器健康）还是端口占用 |
| 搜索结果明显变差 | `/api/health` 的 `fts` / 语义能力位，`capabilities.notes` | embedding 不可用时降级为关键词+拼音，属预期；恢复模型后可跑一次 `reindex` 任务补向量 |
| 任务长时间 pending / failed | 管理面板「后台任务」或 `GET /api/jobs` | 重试耗尽会写 `console.error` 并按 `NAVHUB_ALERT_WEBHOOK` 投递告警；单实例锁没拿到说明有多个副本在抢 |
| 磁盘快速增长 | `events` / `audit_logs` 表体积 | 见 §6 数据治理（TTL / 归档） |
| 搜索或写接口变慢 | `/api/metrics` + 慢查询日志 | 先看是否触发限流（`NAVHUB_TRUST_PROXY` 配置错误会被伪造 IP 绕过），再看快照保存是否处于大库首次全量 |
| 前端 500 / 白屏 | `docker logs navhub-web` | 多为存储适配器连不上中枢：检查 `NAVHUB_STORAGE_BASE_URL` 与网络（`http://api:8787`） |

**告警通道**：任务重试耗尽（默认 3 次）会触发一次 webhook。配置 `NAVHUB_ALERT_WEBHOOK`（飞书/钉钉/自建机器人均可），
超时用 `NAVHUB_ALERT_TIMEOUT_MS`（默认 5000，钳制 1s~30s）。未配置时只落 `console.error`——生产请务必配置。

---

## 4. SLO / SLI 与告警建议

| SLI | 采集点 | 建议 SLO（单实例 / 个人站可放宽） |
| --- | --- | --- |
| 可用性 | `GET /api/health` 返回 200 的比例 | 99.5% / 30 天 |
| 搜索延迟 | 服务端埋点 / `/api/metrics` | P95 < 300ms（lite 小库）、< 800ms（standard 大库） |
| 写入成功率 | 非 5xx 比例（管理面写接口） | > 99% |
| 后台任务成功率 | `jobs` 表 failed / 总数 | > 95% / 24h |
| 数据新鲜度 | 最近一次成功的 `reindex` / 巡检时间 | < 24h |

告警建议（按严重度）：
- **P1**：健康检查连续 3 次失败、任务成功率跌破 80%。
- **P2**：搜索 P95 连续 15 分钟超阈值、磁盘剩余 < 15%。
- **P3**：单条任务失败（已有 webhook，不必单独告警）。

---

## 5. 备份与恢复

### 5.1 lite（SQLite）

```bash
node scripts/backup.mjs [--db <path>] [--out <dir>] [--keep <n>]
```

- 走 `better-sqlite3` 的在线备份 API（含 WAL 中已提交事务），不停服；
- 备份后自动 `integrity_check`，不通过即失败退出（坏的备份等于没备份）；
- 默认写到 `data/backups/`，保留最近 7 份。

恢复：停服 → 用备份文件覆盖 `data/navhub.db` → 删除同目录的 `-wal` / `-shm` → 启动。

### 5.2 standard（PostgreSQL / pgvector）

```bash
# 需要 pg_dump 在 PATH，或用 --docker <container> 在容器内执行
node scripts/backup-pg.mjs [--out <dir>] [--keep <n>] [--docker navhub-postgres]
```

脚本产出 `navhub-pg-<时间戳>.dump`（`pg_dump -Fc` 自定义格式），并在失败时给出可直接复制的等价命令。

恢复：

```bash
# 自定义格式：先建空库，再 pg_restore
createdb navhub_restore
pg_restore -d navhub_restore --no-owner navhub-pg-<时间戳>.dump
# 确认无误后切换 NAVHUB_DATABASE_URL 指向新库并重启服务
```

**演练清单（每季度至少一次）**：备份 → 恢复到临时库 → 起服务 → 抽查 10 个站点与一次搜索 → 记录耗时 → 删除临时库。

---

## 6. 数据治理（events / audit_logs）

`events`（点击、搜索、曝光）与 `audit_logs`（管理操作）是持续增长的两张表：

- **短期**：按月归档——把 N 个月前的行导出到冷存储后删除（保留统计聚合结果即可）；
- **中期**：加 TTL 任务（复用现有 job 框架，新增一个 `purge_events` 类型的定时任务）；
- **查询预算**：热点列表查询必须带 `limit`，新增聚合查询要在测试里断言扫描行数不随数据量线性爆炸。

当前没有自动清理，靠 §5 的备份 + 人工归档；数据量到百万级前完成自动化即可。
