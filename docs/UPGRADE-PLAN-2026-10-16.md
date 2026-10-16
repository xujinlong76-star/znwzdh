# NavHub 升级改造建议方案

> 版本：v1.0 · 2026-10-16 · 基于 commit `c41febd`（89 个提交，制定当时全量 625 测试通过）
>
> **执行状态（2026-10-17 更新）**：本文 P0~P3 **已全部执行完毕**，详见
> `docs/P3-COMPLETION-REPORT-2026-10-16.md`。下文所有"现状/基线"描述是**制定时的快照**，
> 不代表当前代码状态——例如前端已无"零门禁"（CI `test-web` 跑 tsc + lint + build）、
> `apps/web` 已是 TypeScript 5.9.3 + React 19.3.1、全量测试数已增长到 **711 通过 / 11 跳过**。
> 下一轮建议见 `docs/UPGRADE-RECOMMENDATIONS-2026-10-16.md`。
>
> 研究方法：全仓配置与依赖清点、CI 矩阵审读、24 处审计调用点逐一核对、外部版本与 CVE 事实检索（next-auth 发布线状态、dnd 库 React 19 兼容性）。本文所有结论均附代码位置或检索证据，不含推测性建议。

---

## 0. 结论速览

| 级别 | 数量 | 主题 | 建议启动时机 |
| --- | --- | --- | --- |
| **P0** | 4 项 | 生产安全失守风险（next-auth v5 beta CVE / session 伪造 / 默认口令后门） | **当天** |
| **P1** | 4 项 | 质量门禁缺失（Web 侧零门禁）+ 审计容错不完整 + 文档漂移 + 单体拆分 | 本周 |
| **P2** | 8 项 | 依赖升级（React 19 / TS 5.9）、备份、可观测性、限流存储 | 两周内 |
| **P3** | 4 项 | DX 改进（hooks / lint 接线 / 扩展 CI） | 按需 |

一句话判断：**架构底子（双方言存储、降级策略、测试与 CI 矩阵）是本仓最厚的资产，问题集中在「生产默认配置不安全」与「自研前端代码无门禁」两个面**。升级改造应遵循「先止血、再设门禁、后升级、最后架构演进」的顺序，任何阶段都不重写 vendored 上游业务逻辑。

---

## 1. 现状评估：本仓的底子在哪里

先肯定已被证据支持的强项，改造方案必须保护它们：

1. **依赖图干净**：`core ← store/ai ← api ← mcp` 单向分层，`apps/web` 不 import 任何 `@navhub/*` 包，前后端经 `/api/hub/*` 运行时代理解耦（`docs/wiki/01-architecture.md` §6.1）。
2. **双方言收敛在适配层**：schema 只用四类通用列类型，SQLite/PG 差异收敛到 `driver.ts` 与 `vector/`，同一份表定义跑两种库（wiki §5.4）。
3. **降级策略有测试**：embedding 缺失 / sqlite-vec 加载失败 / FTS5 不可用均有明确降级路径且被测试覆盖（wiki §5.2）。
4. **CI 矩阵完整**：SQLite 全量 + pgvector 跨方言 E2E + overlay 字节级比对 + 聚合闸门 `ci-passed`（`.github/workflows/ci.yml`）。
5. **安全设计有纵深**：SSRF 三层防护、token 软吊销 + 前缀掩码 + 审计、GitHub token 仅存服务端（`auth.ts` L7-20 注释）、管理员白名单生产 fail-closed（`auth.config.ts` L53-56）。
6. **SQLite 调优到位**：WAL + synchronous=NORMAL + mmap 256MB + foreign_keys ON（`packages/store/src/driver.ts` L459-470）。

**改造的第一性原则：以上六条一条不破坏。**

---

## 2. P0——生产安全（公开部署即失守，当天处理）

### 2.1 next-auth v5 beta 线的 CVE 暴露面

**证据**：
- 本仓 `apps/web/package.json` L70：`"next-auth": "5.0.0-beta.32"`。
- 外部检索（2026-10）：next-auth v5 **自 2022 年起公测至今从未发布稳定版**；npm `latest` 标签仍是 4.24.15；维护权已转交 Better Auth 团队。2026-07 安全公告批次含**两个 CVSS 9.1 漏洞，其中一个为 fail-open 认证绕过，仅影响 v5 beta 线**；官方维护建议新项目使用 Better Auth。

**风险**：任何依赖 next-auth 内部会话校验的路径都可能被绕过。本仓应用层另有 middleware 自有守卫（`middleware.ts`）与 `verifyAdminSession`（`auth.ts` L159-183），构成第二道防线，但 `/api/auth/*` 路由本身与 session 签发逻辑仍在库内。

**行动**：
1. 当天：核实该 CVE 编号与本版本（beta.32）是否有补丁；若 v5 线无补丁，将 next-auth 相关路由在反代层加 IP 白名单或额外 token 校验作为临时缓解。
2. 本周：完成应用层加固——确认所有 `/admin` 与 admin API 的鉴权判定不经过 next-auth 的可疑内部路径（当前 middleware + verifyAdminSession 已自成体系，需补测试锁定行为）。
3. 中期（单独立项，不在本方案内承诺）：评估迁移 Better Auth 或回退 next-auth@4.24.15。这是 4.x 级改动，必须单独排期与回归，**禁止**夹带在其他升级里做。

### 2.2 AUTH_SECRET 硬编码回退 → session 可伪造

**证据**：`apps/web-overlay/src/lib/auth.config.ts` L28-36：

```typescript
export const authSecret =
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  process.env.NAVHUB_SESSION_SECRET ||
  'navhub-session-secret-dev-default-32-chars-long-auth-key'
```

该回退值公开写在仓库里。生产环境若未显式设置任一 secret，**任何人可用公开密钥签发合法 session cookie，直接登录后台**。

**修复**（最小且安全，保留数据结构与命名）：
- `NODE_ENV=production` 且四个变量均未设置时，启动即抛错（fail-closed）；开发环境保留现有回退，行为不变。
- 同步修 `docker/docker-compose.yml` L45/L136：`NAVHUB_SESSION_SECRET` 默认值是众所周知的 `change-me-in-production-min-32-chars-secret-key`，改为必填（`${NAVHUB_SESSION_SECRET:?生产必须设置}`）或首次启动生成随机值落盘到 volume。

### 2.3 默认口令后门

**证据**：`auth.ts` L92-103——当未配置 `NAVHUB_ADMIN_PASSWORD` 且无任何有效 token 时，接受 `admin / admin123 / navhub / 123456`；该分支**没有生产环境判断**。叠加 `NAVHUB_AUTH_REQUIRED` 默认 `false`（`.env.example` L33）= 公开部署任何人可登录后台。

**修复**：默认口令路径增加 `isDev` 限定；生产需要默认口令必须显式 `NAVHUB_ALLOW_DEFAULT_PASSWORD=1` 并在启动日志打印红色警告。

### 2.4 验证方式（P0）

| 场景 | 期望结果 |
| --- | --- |
| `NODE_ENV=production` + 无 secret 启动 | 进程退出，错误信息指明需设置 AUTH_SECRET |
| 生产模式 + 未配密码，尝试 `admin/admin123` 登录 | 401，signin 页提示需配置管理员密码 |
| 开发模式现状行为 | 完全不变（回归 625 测试 + 现有 bypass 登录流程） |

---

## 3. P1——质量门禁与正确性（本周）

### 3.1 审计容错只覆盖了一半（正确性缺陷）

**证据**：`apps/api/src/server.ts` 共 **24 处** `ctx.repo.audit` 调用；上次修复仅包裹了 token 相关 5 处（`auditSafely`）。剩余 ~19 处（site.create/update/delete/restore/purge、category.*、tag.*、submission 等）仍为裸调——audit 表写入失败（锁竞争/磁盘满/schema 漂移）会把**已成功的写操作变成 500**。site.delete 场景同样致命：站点已删、audit 抛错、客户端收到 500 以为失败。

**修复**（最小全局方案，一处改动全覆盖）：在 `packages/store` 的 audit 实现内部加 try/catch，失败仅 `console.error` 不外抛；与已落地的 `auditSafely` 语义对齐。token 侧的 `auditSafely` 可保留（双保险），也可在确认仓库层容错后简化。

**测试**：mock `repo.audit` 抛错 → `POST /api/sites` 仍 201 且站点可查；`DELETE /api/sites/:id` 仍 200。

### 3.2 Web 自研代码零门禁

**证据**：
- 根 `typecheck` 为 `pnpm -r --filter "@navhub/*" exec tsc --noEmit`——**不含 apps/web**（`package.json` L13）。
- `apps/web/next.config.js` L16/L19：`ignoreBuildErrors: true` + `ignoreDuringBuilds: true`。
- CI 无 web typecheck / lint / `next build` 任何一门禁（`ci.yml` 全文可证）。

结果：**166 个 overlay 自研文件（含 /admin 全部 14 个页面、hub 代理、navhub-api）没有任何自动门禁**，只有靠人记得手动跑 tsc。这是本次「Token 创建报错」问题里前端错误不可读能潜伏至今的制度原因。

**修复**：CI 新增 `test-web` job（在 vendor 重建 apps/web 之后）：
```yaml
- run: node scripts/vendor-web.mjs
- run: cd apps/web && node node_modules/typescript/bin/tsc --noEmit   # 本地 TS 5.1.6
- run: cd apps/web && node node_modules/next/dist/bin/next lint
- run: node scripts/run.mjs --filter navsphere build                    # next build 冒烟
```
策略：前两周 `continue-on-error` 收集真实错误基线，清零后转硬门禁（与 audit job 现行策略一致）。

### 3.3 server.ts 单体拆分（架构演进，低风险版）

**证据**：`apps/api/src/server.ts` 单文件 **2619 行**，42+ 路由混排（REST、存储兼容 API、任务、favicon 代理、OpenAPI 注册）。

**方案**：按 fastify 插件拆为 `apps/api/src/routes/{sites,categories,tags,tokens,search,jobs,submissions,admin}.ts`，每文件导出注册函数；`routeEntries` 收集逻辑移入共享模块供 `openapi.ts` 消费。**每域一个独立 PR，行为零改**，以 625 测试 + OpenAPI 文档快照比对作为回归网。不新增抽象、不改路由契约。

### 3.4 验证方式（P1）

- `pnpm verify`（overlay 180 一致 + 双侧 tsc + 625 测试）全绿；
- 新 `test-web` CI job 出现且错误基线可见；
- mock audit 失败的主操作测试新绿（见 3.1）；
- server.ts 拆分后 `GET /api/openapi.json` 与拆分前 diff 为空。

---

## 4. P2——依赖升级与运维韧性（两周内）

### 4.1 React 18.2 → 19.x（前端最大单项升级）

**证据与可行性**：
- 现状 `react: 18.2.0` 精确锁定（`apps/web/package.json` L72-74）；React 19.3 已发布（2026-09）。
- `@hello-pangea/dnd` 需从 `^17.0.0` 升到 `^18.0.1`——18.x 已声明 `react: ^18.0.0 || ^19.0.0`（外部检索实证）。
- Radix UI 全系、swr@2、next-auth beta、monaco 均已兼容 React 19。
- 已知风险点：vendored 上游表单组件（`@hookform/resolvers@3 + zod v3` 组合，`next.config.js` L12-16 注释自述）——这正是构建期忽略类型的原因，升级后需复测。

**策略**：独立分支；顺序 = 先 `@hello-pangea/dnd@18` → 再 react/react-dom 19 → overlay 全量 tsc → `next build` → 手测核心流程（搜索、Bento 拖拽、admin 全页面、Token 创建/吊销/轮换）。保留 `ignoreBuildErrors` 作为安全网直至 TS 5.9 门禁就位。**收益**：并发渲染特性 + React 19.3 安全修复。

### 4.2 apps/web TypeScript 5.1.6 → 5.9.x

**证据**：本仓 TS 三套版本并存——root 5.9.3 / apps/api 5.9.3 / apps/web **5.1.6**；此前排查中已实际踩坑（`vault.ts` 的 `Uint8Array<ArrayBufferLike>` 泛型为 TS 5.7+ lib 定义，版本用错报假错误）。

**策略**：**必须放在 3.2 门禁之后**——先让 5.1.6 在 CI 有人看守，再升级。升级预计在 vendored 上游代码中产生噪音，处理顺序：`skipLibCheck` 已开 → 仅修 overlay 自研文件的真错误 → 上游噪音局部断言或维持 ignore。收益：全仓一套 TS，消除版本错位类假错误。

### 4.3 其他依赖

| 依赖 | 现状 | 建议 |
| --- | --- | --- |
| next | 15.5.21（override 15.5.28） | 保持跟随补丁，override 已统一 |
| undici / sharp / esbuild / tinypool / postcss / ws | 已有安全线 override | 维持，定期 `pnpm audit` |
| vitest | 4.1.11（wiki 误记 3.2.4） | 已是最新系，同步文档即可 |
| drizzle-orm | 0.45.4 | 跟随 minor，锁 lockfile |
| @modelcontextprotocol/sdk | 1.32.1 | 跟随 minor |
| zod | 全仓 v3 | **不动**——`@hookform/resolvers@3` 只支持 v3，`pnpm-workspace.yaml` L25-29 的决策正确 |

### 4.4 备份机制缺失（自托管第一风险）

**证据**：数据仅在 `data/navhub.db`（WAL 模式）+ docker volume `navhub-data`；全仓无任何备份/恢复脚本或文档。

**修复**：新增 `scripts/backup.mjs`——用 better-sqlite3 的 `.backup()` API 在线热备（WAL 模式下安全），输出带时间戳的 `.db` 文件；`docs/wiki/09-run-and-test.md` 补恢复步骤；compose 加注释示例（cron sidecar 或宿主机 crontab）。

### 4.5 可观测性与限流存储

- **指标**：新增 `GET /api/metrics`（Prometheus 文本格式：请求计数/延迟分位/五路检索通道可用性/JobRunner 队列深度），与现有 `/api/health` 能力降级报告互补。
- **限流存储**：`@fastify/rate-limit` 默认进程内存（`server.ts` L121 全局 300/min，search 120/min）。单实例够用；**standard 多实例部署时限流形同虚设**——在 wiki 明确标注，并提供 PG 存储实现选项（或接受前置反代限流的文档化方案）。

### 4.6 验证方式（P2）

- React 19：`pnpm verify` + `next build` + 手测清单（搜索/Bento 拖拽/admin 14 页/Token 全生命周期）全过；
- 备份：脚本实跑一次 → 删库 → 恢复 → 服务正常启动且数据完整；
- `/api/metrics` 可被 `curl` 抓取且指标值随请求变化。

---

## 5. P3——DX 改进（按需）

1. **overlay 漂移防护前移**：加 git pre-commit hook 跑 `check-web-overlay.mjs`（husky 或 `.git/hooks` 脚本），把「改完 apps/web 忘记同步」拦截在提交前而非 CI。
2. **lint 接线**：根 package.json 增加 `"lint": "cd apps/web && next lint"`（eslint 9 + eslint-config-next 已在 devDependencies，从未被运行过）。
3. **extensions 零 CI**：chrome/raycast 扩展无任何自动化——最低成本加 manifest JSON 校验 + 构建冒烟 job。
4. **文档漂移同步**（随各项改动顺手修）：
   - README L94-95：Node `v18.18.0+` / pnpm `v9+` → 实际 **Node 22（`--experimental-strip-types` 必需，Dockerfile 与 CI 均为 22）/ pnpm 11.7.0**；
   - wiki §8：vitest 3.2.4 → 4.1.11；测试数 381 → **625**；Next 15.5.21 → 15.5.28（override 实际生效版）；
   - `apps/web/package.json` engines `>=20` → `>=22`。

---

## 6. 分阶段实施路线图

```
阶段 0（当天）安全止血
  ├─ 2.1 next-auth CVE 核实 + 临时缓解 + 应用层守卫测试锁定
  ├─ 2.2 AUTH_SECRET 生产 fail-closed（web + compose）
  └─ 2.3 默认口令生产关闭
  门槛：2.4 全部场景复现通过；625 测试不回归

阶段 1（本周）门禁与正确性
  ├─ 3.1 audit 仓库层全局容错 + 测试
  ├─ 3.2 CI test-web 三门禁（先 continue-on-error 建基线）
  └─ 3.3 server.ts 拆分（每域一 PR，OpenAPI 快照回归）
  门槛：pnpm verify 全绿；新 job 可见；基线错误清零时间表明确

阶段 2（两周内）文档与运维
  ├─ 4.4 备份脚本 + 恢复文档
  ├─ 4.5 /api/metrics + 限流存储文档化
  └─ 5.4 文档漂移同步 + engines 修正
  门槛：备份实跑恢复成功；指标可抓

阶段 3（按需）升级与架构
  ├─ 4.1 React 19（dnd@18 先行）
  ├─ 4.2 TS 5.9 统一（门禁就位后）
  └─ 5.1-5.3 DX 三件套
  门槛：每步独立分支 + pnpm verify + next build + 手测清单
```

**提交纪律**（沿用本仓惯例）：每个阶段内按「单文件隔离提交」拆分——API 改动、web-overlay 改动、CI、docs 各自成 commit，保证任何单点可独立回滚。

---

## 7. 明确不做的事（反目标）

1. **不重写 vendored 上游 NavSphere 业务逻辑**——接缝策略（`github.ts` 两函数）是本仓核心资产，升级只碰 overlay 自研层。
2. **不迁移 zod v4**——`@hookform/resolvers@3` 只支持 v3，全仓统一 v3 是已验证的正确决策。
3. **不引入 Redis 等新中间件**——除非 standard 模式确有多实例部署需求；当前单卷 SQLite/PG 架构不增加外部依赖。
4. **不把 Better Auth 迁移塞进普通升级**——next-auth 的处置（2.1）是独立安全项目，需专门排期与全量鉴权回归。
5. **不为升级而升级**——每个版本变动必须对应本方案列出的具体收益（安全修复 / 门禁 / 性能），否则维持现状。

---

## 8. 总体验证路线（任何阶段完成后都必须满足）

```bash
pnpm check:overlay        # 180 文件字节一致
pnpm typecheck            # packages/* + apps/api 零错误
pnpm test                 # 625 测试全绿（PG e2e 视环境）
# + 阶段 1 起新增：apps/web tsc / next lint / next build（CI test-web job）
# + 阶段 0 起新增：P0 四个安全场景手工复现（见 2.4）
```

---

*本方案所有代码行号基于 commit `c41febd`；外部事实（next-auth 发布线状态、CVE、dnd React 19 兼容性）检索于 2026-10-16，执行前建议复核一次最新状态。*
