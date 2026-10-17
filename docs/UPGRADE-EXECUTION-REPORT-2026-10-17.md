# 升级建议执行报告（2026-10-17）

> 输入：`docs/UPGRADE-RECOMMENDATIONS-2026-10-16.md`（25 项，按 立刻 / 近期 / 中期 分档）。
> 指令：**执行全部**。本报告记录每项做了什么、验证证据、以及剩什么没做。

## 一、总览

| 档位 | 项数 | 已完成 | 部分/受阻 |
| --- | --- | --- | --- |
| 立刻做（P0，建议 1–6） | 6 | **6** | — |
| 近期（建议 7–16） | 10 | **8** | 2（Docker 层缓存、前端拆分前置） |
| 中期（建议 11–17，独立立项） | 7 | **3**（运维文档、PG 备份、数据治理：TTL 清理 + rollup 聚合） | 4（需立项，见 §4） |

提交链（本轮，含并行会话合并进来的改动）：

```
896c9e0 fix(api): production public deployment without auth now fails closed (P0-1)
167326e feat(api): wire job failure alerts to NAVHUB_ALERT_WEBHOOK (P0-2)
f4f539b docs: mark UPGRADE-PLAN as executed + unify test counts (P0-6)
9749c2c build: pin upstream NavSphere ref + CI docker smoke (P0-可复现性)
ceca158 chore(hooks): pre-commit gains upstream-ref check, tsc gate, changed-tests
3684428 fix(overlay): hard-fail on git-tracked apps/web files missing from overlay
2705985 fix(api): annotate site row types + snapshot write perf
4e4b70d docs+ops: operations runbook (wiki 11) + PostgreSQL backup script
e235970 chore(deps+docker): Cloudflare leftovers, overrides unified, api image multi-stage
```

## 二、立刻做（P0）—— 全部完成

| # | 项 | 落地 | 验证证据 |
| --- | --- | --- | --- |
| 1 | 鉴权 fail-closed | `apps/api/src/config.ts`：生产 + 公网 `NAVHUB_PUBLIC_URL` + `authRequired=false` → 启动即 throw；逃生阀 `NAVHUB_ALLOW_INSECURE_PUBLIC`；compose 与 `.env.example` 同步 | `apps/api/test/auth.test.ts` 新增 4 条断言（公网阻断 / 逃生阀 / 内网放行 / 开鉴权放行），49 tests 通过 |
| 2 | 任务告警接线 | config 新增 `alertWebhook` / `alertTimeoutMs`；`main.ts` 注入 `JobRunner.onAlert → sendWebhookAlert`；启动横幅显示状态；wiki 09 新增 5.2.1 节 | auth.test.ts 新增 2 条断言（默认 null / 去空格透传 / 超时可配）；jobs 22 tests 通过 |
| 3 | 恢复 web lint 门禁 | 本机 pnpm 链接层断裂是根因（`eslint-config-next` 及依赖未链入）；重建 `.pnpm` 实例内 junction 后恢复 | `pnpm lint` 退出 0：**0 error / 269 warning**；`next.config.js` 注释记录门禁位置与历史故障 |
| 4 | 安全头 + 图片白名单 | `next.config.js` 新增 `headers()`：nosniff / Referrer-Policy / X-Frame-Options / Permissions-Policy 常开；HSTS 在 https 时自动；CSP 由 `NAVHUB_CSP=1` 开启；`remotePatterns` 可用 `NAVHUB_IMAGE_HOSTS` 收紧 | overlay 校验 187 文件一致；本地 `next lint` 与构建路径不受影响 |
| 5 | engines + 依赖审计 | 根 `engines`（node >=22 / pnpm >=11.7.0）；新增 `.github/dependabot.yml`（周更、分组、actions/docker 月度）；CI audit 增加 `--prod` 维度；`pnpm-workspace.yaml` 的 GHSA 例外补来源/不可 override 原因/复审期 | CI 文件语法改动，`ci-passed` 已把新 job 纳入 |
| 6 | 文档纠偏 | `UPGRADE-PLAN` 顶部标注"P0–P3 已执行，基线是快照"；测试计数统一为 711 通过 / 11 跳过；wiki 01 React 18.2 → 19.3.1 | wiki README 索引同步 |

## 三、近期项 —— 8/10 完成

| # | 项 | 状态 | 说明 |
| --- | --- | --- | --- |
| 7 | storage 快照批量化 | ✅ | `writeNavigationData` 改用 Map 索引（原 O(n²) 线性 find）；`upsertSite` 去掉 `setSiteTags(id, 已有 tags)` 这个 no-op 往返（每站点省 1+2n 次 SQL）。全量 711 测试通过 |
| 8 | reindex 批量化 | ✅ | 由并行会话落地：`runReindex` 按 32 一批走事务 + `indexSitesBatch`（并发 encode + 批量 upsert）。我补了随之出现的 `SiteRow` 隐式 any 类型修复（否则 tsc 红） |
| 9 | vendor 固定 SHA + CI docker build | ✅ | 上游 ref 固定到 `6ba74fa…`（vendor 脚本 / Dockerfile.web / UPSTREAM.md 三处同源）；新增 `scripts/check-upstream-ref.mjs`（含"已 vendored 产物未漂移"校验）；CI 新增 `docker-smoke` job |
| 10 | pre-commit 加强 | ✅ | 钩子增加 upstream-ref + `tsc --noEmit`（限 `@navhub/*`）+ `vitest run --changed`；`NAVHUB_SKIP_PRECOMMIT=1` 可跳过 |
| 11 | overlay 反向硬化 | ✅ | git 跟踪的 apps/web 文件必须进 overlay（此前仅告警）；顺带补入 `package.json` 与 4 个 `test/*.test.ts`（此前会被 vendor/Docker 丢弃） |
| 12 | 死依赖清理 + 版本对齐 | ✅ | 删 `cf:build` / `cf:deploy` 脚本与 `wrangler` 依赖（部署形态收敛为 Docker）；`next 15.5.21 → 15.5.28`、`@types/node → 22.18.13`；`iron-session` / `@tanstack/react-query` 由并行会话移除；`drizzle-orm` / `drizzle-kit` **保留**（见 §5） |
| 13 | Docker 瘦身 | ✅（api） | `Dockerfile.api` 改多阶段：编译链（python3/make/g++）只留在 deps 阶段，运行镜像仅 ca-certificates + curl；`--filter "@navhub/api..."` 不装前端依赖 |
| 14 | 部署形态收敛 | ✅ | Cloudflare 残留（cf 脚本 / wrangler）已删；`Dockerfile.api` 注释说明容器内 overrides 校验冲突 |
| 15 | Dockerfile.web 依赖层缓存 | ✅（后续修订） | 原判断（"web 镜像的清单来自上游 tarball + overlay 覆盖，先拷清单再拷源码会破坏 frozen 安装"）已被推翻：根因是镜像布局，不是 pnpm。前端在镜像里改成 workspace 成员 `apps/web` 后，依赖层只拷清单就能做 frozen 安装，改自研源码也不会让该层失效（详见 §5.2 修订说明） |
| 16 | 前端拆分 / loading / 组件测试 | ⏸ | 属中期（建议 22），见 §4 |

## 四、中期项 —— 已落地与待立项

**已落地**

- **运维文档三件套**（建议 24）：新增 `docs/wiki/11-operations.md` —— 发布/回滚流程（含"只回代码不回数据"约束）、on-call runbook（8 类症状 → 检查 → 处置）、SLO/SLI 与告警分级、备份恢复与演练清单、数据治理建议。
- **PG 备份脚本**（建议 24 的一半）：新增 `scripts/backup-pg.mjs`（`pg_dump -Fc`、轮换、产物校验、`--docker <container>` 模式），补上 standard 模式此前"有 SQLite 备份、无 PG 备份"的缺口。
- **数据保留自动化**（建议 25 的前半）：新增 `packages/store/src/retention.ts` + `scripts/data-retention.mjs` —— `events` / `audit_logs` 两张只增不删的表终于不用靠人工归档了。默认 dry-run、先归档后删除、小批量 `id IN (...)` 避免长事务、SQLite/PG 同一套逻辑（注入占位符风格适配）。10 个单测覆盖分批/扫描上限/归档优先/参数白名单，并在临时 SQLite 上做了真实删除与幂等验证。
- **明细聚合 rollup**（建议 25 的后半，`--rollup`）：新增 `packages/store/src/rollup.ts` —— 把到期的**整天**压成 `events_daily`（日 × 类型 × 站点，含 `total` / 去重 `identities`）与 `audit_daily`（日 × 动作 × 操作者类型，含 `total` / 去重 `actors`），写完后才删这一天的明细，于是"保留趋势、不堆积归档"这条路也通了。
  几个刻意的取舍：**只推进整天**（某天里还有未到期行时那天整轮不动，否则重跑会把半天的聚合值越算越小）、**upsert 覆盖而非累加**（累加语义重跑会翻倍）、**单天分组超限则整天跳过**（宁留明细不写半份聚合）、**dry-run 不建表**。另有三重刹车：单表单轮最多 30 天（`--max-days`）、单天最多 5000 分组（`--max-groups`）、dry-run 因为不删行所以只推进一趟（否则重复查询会一直拿到同一批日期）。
  13 个单测 + 临时 SQLite 端到端：dry-run 零改动 → apply 写入正确聚合值 → 半天过期的那天原样保留 → 二次运行全 0（幂等）。
- **30 万行压测 + 空间回收（`--vacuum`）**：压测暴露了一个此前没说破的真相 —— **删了行不等于腾了空间**。SQLite 与 PG 都只是把页标记为空闲等复用，文件不整理就不会变小，实测差 4.5 倍（29.22 MB → VACUUM 后 6.53 MB）。此前脚本删完就退，运维会发现"清理执行了但磁盘没降"，容易误判成没删掉。于是加了 `--vacuum`（SQLite 跑 VACUUM，PG 只给提示——`VACUUM FULL` 要锁表，属于运维决策不该由脚本替判），两条路径执行完都会打印下一步该做什么。
  压测数据：30 万行 events（400 天 × 750 行/天）→ rollup 追平 220 天耗时 **9 轮 / 2.1s**，聚合 164,250 行明细成 2,628 行日统计；完整性校验 **聚合行数 + 剩余明细 = 原始 300,000**（不重不漏）；清理模式对照：60,700 行归档 + 删除 4.3s。数字已写入 wiki §6.4。
  仍未做的部分：`events_daily` / `audit_daily` **还没有消费方**（后台趋势与看板暂未读它），也没有接进定时任务框架 —— 都写进 `docs/wiki/11-operations.md` §6.5 待办。

**需独立立项（本次未动，避免一次性大改）**

| 建议 | 主题 | 为什么不在本轮做 |
| --- | --- | --- |
| 18 | 鉴权架构演进（next-auth v5 beta → Better Auth / 4.x + token 出内存） | 影响登录与会话全链路，必须配套迁移测试与灰度方案 |
| 19 | zod 3 → 4 | 阻塞点明确：`@hookform/resolvers@3` 只支持 zod v3，需先替换 resolver |
| 20 | drizzle 路线二选一 | **前提需修正（见 §5.5）**：drizzle 不是"零调用"，而是已在用——`driver.ts` 两种方言都创建 `drizzle()` 实例、`schema.ts` 用它定义表，只是**所有查询仍走 raw SQL**。真正待决的是要不要把查询也迁过去，属架构决策，本轮不动 |
| 21 | 多实例语义（SSE 总线、限流、token touch 共享化） | 需引入外部总线（PG LISTEN/NOTIFY 或 Redis），属架构变更 |
| 22 | 前端拆分（8 个 >800 行组件、loading/error 边界、组件测试） | 机械拆分收益有限，应按模块逐个重构并补测试 |
| 23 | tsconfig 现代化（`moduleResolution: bundler`） | 会一次性改变全前端类型解析结果，需要专门回归 |
| ~~25~~ | ~~数据治理自动化~~ | **已全部落地**：TTL 清理（原样归档 + 删除）与 rollup（聚合后删明细）两条路都在 `scripts/data-retention.mjs`，详见 §4 已落地；剩"聚合表接入消费方 / 接定时任务"见 wiki §6.5 |

## 五、已知问题与遗留（重要）

1. **本机 pnpm 链接层损坏（未根治）**：`pnpm install` 会判定 "Already up to date" 但 importer 链接大量缺失（本次曾只剩 8 个）。删除 state 文件、`.modules.yaml`、importer `node_modules`、`--force` 均无效；最终用脚本按 `package.json` 索引重建约 3100 条 junction 恢复。
   **再跑 `pnpm install` 会清掉这些手工链接**——建议在停机窗口做一次干净重装（并确认 better-sqlite3 / onnxruntime 的原生产物可用）。
2. **【已修复·后续修订】web 镜像现在也用 `--frozen-lockfile`**：原文描述的"只拷后端清单时 pnpm 重算的 overrides 与仓库 lockfile 不一致（`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`）"是 `Dockerfile.api` 历史上的临时方案——该镜像随后已恢复 frozen 安装（overrides 收敛进根 `pnpm-workspace.yaml`，无需在镜像里重算）。web 镜像的根因则是**布局**：当时 `/app/web` 在镜像里是独立项目，既读不到仓库 workspace 配置、也读不到仓库 lockfile，只能退回上游 tarball 自带的那份（与覆盖层清单永不匹配）。现在两个镜像都以仓库 `pnpm-lock.yaml` 为准做 frozen 安装：前端在镜像里是 workspace 成员 `/app/apps/web`，依赖层只拷清单后跑 `pnpm install --frozen-lockfile --filter "./apps/web"`（可复现、可缓存），上游 tarball 在其后解包、覆盖层再覆盖其上，保证"清单先、源码后"。原"需专项修复"的两种备选（前端移出 workspace / 单项目 lockfile）都不需要。
3. **Docker 镜像本机未能完整导出**：web 镜像的依赖安装与 `next build` 全部通过、api 镜像的依赖安装与多阶段拷贝通过，但两次都在最后的镜像导出阶段遇到 Docker Desktop 的 `rpc error: Unavailable`（本机 daemon 问题，非 Dockerfile）。CI 的 `docker-smoke` job 会完整验证。
4. **`apps/web/src/lib/session.ts` 被覆盖为空模块**：上游该文件 import 已移除的 `iron-session` 且全仓无引用，vendor 后会让 tsc 失败；覆盖层置空是唯一能在 vendor 后生效的手段，已在文件头注释说明。
5. **`drizzle-orm` / `drizzle-kit` 在 `packages/store` 的实际状态（结论已纠偏）**：一度被写成"零调用、仅 `db:generate` 引用"，**不准确**。真实用法是：
   - `driver.ts:502/579` —— SQLite 与 PG 两条分支都 `await import(...)` 后 `drizzle(...)`，实例挂在 `Db.orm` 上；第 1 行 `import { sql }` 并在文件末 `export { sql }`；
   - `schema.ts:11` —— 表定义走 `drizzle-orm/sqlite-core`（`sqliteTable` / `index` / `uniqueIndex`）；
   - 但**业务查询全是 raw SQL**（`Db.orm` 声明为 `any`，除创建处外全仓无第二个调用点），实际 DDL 也是手写的 `DDL_SQLITE` / `DDL_PG`。

   所以现状是"**已引入、用于连接实例与 schema 类型；查询未迁移**"。讨论建议 20 时按这个前提来，别误判成"删依赖即可"。

## 六、验证矩阵（本轮结束状态）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 后端/包类型 | `pnpm typecheck` | 0 错误 |
| 前端类型 | `pnpm --filter navsphere exec tsc --noEmit` | 0 错误 |
| 前端 lint | `pnpm lint` | 0 error / 269 warning（退出 0） |
| 单测 | `npx vitest run` | 61 文件 / **919 通过** / 11 跳过（其中 rollup 13 例；其余增量来自并行推进的分类体系工作） |
| 数据保留 | `packages/store/test/retention.test.ts`（10 例）+ 临时 SQLite 端到端 | dry-run 一行不删、`--apply` 只删到期行且边界正确、归档内容逐行可读、二次运行幂等且不留空归档、缺表时报可读错误 |
| 明细聚合 | `packages/store/test/rollup.test.ts`（13 例）+ 临时 SQLite 端到端 + CLI `--rollup` 实跑 | dry-run 不建表不写行；apply 后 `events_daily` 的 total/identities 与明细一致；半天过期的那天原样保留；二次运行 0 天且聚合值不翻倍；分组超限时整天跳过且明细未动 |
| 量级压测 | 30 万行 events 的临时 SQLite | rollup 追平 220 天：9 轮 / 2.1s；**聚合行数 + 剩余明细 = 原始 300,000**（完整性）；清理模式 60,700 行 4.3s；`--vacuum` 后文件 29.22 MB → 6.53 MB |
| 覆盖层 | `node scripts/check-web-overlay.mjs` | 187 文件一致 + 15 个 git 跟踪自研文件全部在 overlay |
| 上游 ref | `node scripts/check-upstream-ref.mjs` | 三处声明一致 `6ba74fa…`，产物未漂移 |
| 扩展 | `node scripts/check-extensions.mjs` | 100% 通过 |
| 镜像 | `docker build -f docker/Dockerfile.{api,web}` | 构建步骤通过（导出阶段受本机 daemon 影响，CI 复验） |
