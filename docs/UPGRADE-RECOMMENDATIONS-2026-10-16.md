# NavHub 全仓升级建议（2026-10-16 深度调研）

> 调研基线：commit `24ed0c5`，工作区干净。方法：三个方向实读核查（① 后端 `apps/api` + `packages/{core,store,ai,mcp}`；② 前端 `apps/web` + `apps/web-overlay`；③ 基建/CI/Docker/脚本/文档），所有结论均附 `file:line` 证据，未修改任何文件。
> 与既有 `docs/UPGRADE-PLAN-2026-10-16.md` 的关系：该方案的 P0~P3 已执行完毕（见 `docs/P3-COMPLETION-REPORT-2026-10-16.md`），本报告是**下一轮**的优先级建议。

---

## 一、现状体检（一页速览）

**规模**：`packages/core` 14.2k 行 / 40 文件；`packages/store` 6.7k（`repository.ts` 单文件 2388 行）；`packages/ai` 1.7k；`packages/mcp` 2.3k；`apps/api` ~6.0k（25 个路由插件、约 100 端点）；`apps/web` 219 个 tsx（43 页面 + 27 route handler），其中 NavHub 自研以 overlay 181 文件入库。

**健康面（值得肯定）**
- 分层干净：`core ← store/ai ← api ← mcp` 单向依赖；路由 → `AppContext` 装配 → Repository 三层职责可辨（`apps/api/src/context.ts:25-167`）。
- `apps/api/src/server.ts` 已从历史 2619 行单体拆分至 311 行，历史 P1-3 已落地。
- 安全纵深好：SSRF 三层防护（`packages/ai/src/ssrf.ts:48-108,196-264`，含逐跳复检、DNS 超时 fail-closed、敏感端口黑名单）；token 仅存 sha256 + `timingSafeEqual`（`auth.ts:34,72`）；生产无 secret fail-closed（`docker/entrypoint.sh:19-29`）；写路由普遍 zod 校验。
- 数据层考究：双方言 DDL/占位符/FTS/向量分层收敛（`driver.ts`、`fts{,-pg}.ts`、`sqlite-vec.ts`/`pgvector.ts`）；SQLite PRAGMA 调优齐全（`driver.ts:474-487`）；可重入事务 + BUSY 指数重试（`repository.ts:243-313`）。
- 测试与观测：709 通过 / 42 文件；CI 6 job + 聚合闸门；`/api/metrics`（Prometheus 文本）+ `/api/health`。

**五类主要债务**
1. **安全**：API 默认 `authRequired=false` 且"公网 + 未鉴权"仅 `console.warn`（`config.ts:142,170-174`）；next-auth 仍是 v5 beta（`apps/web/package.json:70`，`docs/security-notes.md:15` 记 2026-07 两个 CVSS 9.1）；web 生产缺安全头（`next.config.js` 无 `headers()`，`vercel.json` 在 Docker 部署下不生效）；图片 `remotePatterns` 放通 `**`（`next.config.js:21-23`）。
2. **门禁失真**：`next.config.js:16,19` 关闭构建期类型与 lint（注释已说明为 vendored 上游兼容取舍，但**实际效果是 `pnpm lint` 也跑不起来**——`eslint-config-next` 未链入 `apps/web/node_modules`，报 `couldn't find the config "next/core-web-vitals"`）；根 `typecheck`/`build` 仅覆盖 `@navhub/*`（`package.json:8,15`）；pre-commit 只跑 overlay + 扩展两项（`.git/hooks/pre-commit`）；overlay 反向检查仅告警（`check-web-overlay.mjs:126-136`）。
3. **可复现性**：`vendor-web.mjs:8` 与 `docker/Dockerfile.web:18` 默认跟随上游 `main`（SHA 只记录不校验）→ 构建不可复现；CI **从不 `docker build`**；根缺 `engines`（实际强依赖 Node 22 的 `--experimental-strip-types`）；Cloudflare 是"有脚本无配置无部署"的残留（`apps/web/package.json:20-21` + `wrangler.toml` 输出目录与脚本互相矛盾）。
4. **性能/规模**：storage 快照保存 O(n²) + N+1（`apps/api/src/storage.ts:162-245` 的 `find` 线性扫描、逐站 `updateSite`/`setSiteTags`）；`setSiteTags` 逐标签往返（`repository.ts:559-576`）；reindex 逐站串行 embedding（`jobs.ts:494-510`）；前端超大组件（`algorithm-lab.tsx` 2211 行、`admin/sitelist/page.tsx` 2031 行等 8 个 >800 行）；`React.memo` 仅 1 处、`useEffect` 170 处。
5. **架构存量**：死依赖（`drizzle-orm/drizzle-kit` 零调用、`@tanstack/react-query` 零引用、`iron-session` 未见使用、`wrangler` 无配置）；无 Service 层（业务规则内联在路由与 2388 行的 repository）；多实例语义缺失（SSE 总线、限流、token touch 均为进程内存态）；告警 webhook 是死代码（`alerts.ts:26` 无调用，`main.ts:22` 未注入 `onAlert`）。

---

## 二、建议总览（优先级矩阵）

| # | 主题 | 一句话建议 | 档位 | 风险 | 证据锚点 |
|---|---|---|---|---|---|
| 1 | 鉴权 fail-closed | 生产 + 公网 + 未开鉴权 → 直接 throw | **立刻** | 低 | `config.ts:170-174` |
| 2 | 任务告警接线 | 注入 `onAlert` → `sendWebhookAlert` + `NAVHUB_ALERT_WEBHOOK` | **立刻** | 低 | `main.ts:22`、`alerts.ts:26` |
| 3 | 恢复 lint 门禁 | 修 `eslint-config-next` 链接或迁 flat config，再摘 `ignoreDuringBuilds` | **立刻** | 低 | `next.config.js:19`、`.eslintrc.json` |
| 4 | 安全头与图片白名单 | `headers()` 补 CSP/HSTS/XFO；`remotePatterns` 收紧为域名白名单 | **立刻** | 低 | `next.config.js:21-23` |
| 5 | 根 engines | `"node": ">=22"`、`"pnpm": ">=11.7.0"` | **立刻** | 低 | 根 `package.json` 无 engines |
| 6 | 依赖审计补强 | 加 `dependabot.yml`；`audit` 区分 `--prod`；收敛 GHSA 忽略到单一来源 | 立刻 | 低 | `ci.yml:192`、`pnpm-workspace.yaml:26-27` |
| 7 | storage 批量化 | `Map` 索引替代线性 `find`；批量 upsert/tag | 近期 | 中 | `storage.ts:162-245`、`repository.ts:559-576` |
| 8 | reindex 批量化 | 批量事务 + `encodeBatch` | 近期 | 中 | `jobs.ts:494-510` |
| 9 | vendor 固定 SHA | 默认 REF 改为已记录 commit；CI 校验未漂移 | 近期 | 低 | `vendor-web.mjs:8`、`Dockerfile.web:18` |
| 10 | CI 加 docker build | 两个镜像各一条冒烟构建 | 近期 | 低 | `ci.yml` 无 docker job |
| 11 | pre-commit 加门禁 | `tsc --noEmit` + `vitest run --changed` | 近期 | 中（提交变慢） | `.git/hooks/pre-commit` |
| 12 | overlay 反向硬化 | 白名单外新增文件即失败（现仅告警） | 近期 | 低 | `check-web-overlay.mjs:126-136` |
| 13 | 死依赖清理 | 删 drizzle、react-query、iron-session、wrangler + `cf:*` 脚本 | 近期 | 低 | 各 `package.json` |
| 14 | 版本对齐 | `next` 声明=override 15.5.28；`tailwind-merge` 1→3；`next-themes` 0.2→0.4；`@types/node`→22 | 近期 | 低 | `apps/web/package.json:69,71,80,88` |
| 15 | Docker 瘦身 | `Dockerfile.api` 拆多阶段；`Dockerfile.web` 加依赖层缓存 | 近期 | 中 | `docker/Dockerfile.api:24-28` |
| 16 | 部署形态收敛 | Docker / Cloudflare 二选一并删残留 | 近期 | 低 | `wrangler.toml` vs `cf:deploy` |
| 17 | 文档纠偏 | 修 `UPGRADE-PLAN` 过时描述，统一测试计数（625/653/709） | 近期 | 低 | `docs/wiki/09:32` 等 |
| 18 | 鉴权架构演进 | next-auth v5 beta → Better Auth 或 4.x；GitHub token 出内存 | 中期 | 高 | `apps/web/lib/auth.ts:15` |
| 19 | zod 3 → 4 | 先解 `@hookform/resolvers`，`zod-to-json-schema`→`z.toJSONSchema` | 中期 | 高 | `pnpm-workspace.yaml:29-33` |
| 20 | drizzle 路线二选一 | 要么用它渐进替代裸 SQL，要么彻底移除 | 中期 | 中高 | `driver.ts:488-491` 零调用 |
| 21 | 多实例语义 | SSE→PG LISTEN/NOTIFY；限流/token touch→共享存储 | 中期 | 中高 | `jobs.ts:36-44`、`server.ts:107` |
| 22 | 前端拆分与边界 | 拆 8 个 >800 行组件；补 `loading.tsx`/`error.tsx`；上组件测试 | 中期 | 中 | `algorithm-lab.tsx` 等 |
| 23 | tsconfig 现代化 | `moduleResolution→bundler`、`target→es2019+`；确认 Tailwind v4 配置路径 | 中期 | 中 | `apps/web/tsconfig.json:16` |
| 24 | 运维文档三件套 | 回滚流程 / on-call runbook / SLO；PG 备份脚本 | 中期 | 中 | `docs/wiki/09:368` 仅一句 |
| 25 | 数据治理 | events/audit_logs TTL 或归档；查询预算断言 | 中期 | 中 | `store/src/schema.ts:167-204` |

---

## 三、立刻做（P0，1–3 天，全部低风险无迁移）

**1. 生产鉴权 fail-closed（最高优先）**
`packages/api/src/config.ts:170-174` 目前对「公网 `publicUrl` + `authRequired=false`」仅 `console.warn`。建议：`NODE_ENV=production` 且非本地地址且未开鉴权 → **启动即 throw**，同步更新 `.env.example`、`docker/docker-compose.yml` 注释。这是当前唯一"默认不安全"的入口。

**2. 任务告警接线（消灭死代码 + 恢复可观测闭环）**
`main.ts:22` 未注入 `onAlert`，`alerts.ts:26 sendWebhookAlert` 全仓无调用 → 重试耗尽只有 `console.error`（`jobs.ts:354-361`）。接线 + 新增 `NAVHUB_ALERT_WEBHOOK` 环境变量即可闭环。

**3. 恢复 web lint 门禁**
`eslint-config-next@15.4.6` 未链入 `apps/web/node_modules`，`next lint`/`npx eslint` 均报 `couldn't find the config "next/core-web-vitals"` → `pnpm lint` 实际失败，`no-explicit-any` 等规则从未执行；且仍用 legacy `.eslintrc.json`（ESLint 9.33，v10 将移除该格式）。建议：补链接以先恢复，随后迁 `eslint.config.mjs` flat config，最后才能安全摘掉 `ignoreDuringBuilds`。

**4. 安全头 + 图片域名白名单**
`next.config.js` 无 `headers()`；安全头只写在 `vercel.json:15-35`，而生产是 Docker `next start`（`docker/Dockerfile.web:30`）→ 自托管场景**零安全头**（无 CSP/HSTS/XFO）。建议把安全头下沉到 `next.config.js`；`images.remotePatterns` 由 `**` 收紧为实际站点域名白名单。

**5. 根 `engines` + 依赖审计补强**
根 `package.json` 缺 `engines`，但 Docker/CI 强依赖 Node 22 与 `--experimental-strip-types`（`docker/entrypoint.sh:35,40`）。补 `engines`；新增 `.github/dependabot.yml`；`ci.yml:192` 的 audit 增加 `--prod` 维度；`pnpm-workspace.yaml:26-27` 忽略的 GHSA 补理由与到期日。

---

## 四、近期（1–2 周，中风险）

**6. 消除 storage 快照 O(n²) 与 N+1（后端最大性能债）**
`storage.ts:162-245` 用 `existingCats.find`/`existingSites.find` 线性扫描（O(n²)）；每站 `updateSite`（内部 2 次 getSite + 事务）+ `setSiteTags` 单条往返。改 `Map` 索引 + 批量 upsert（复用 `getSitesByIds` 的 500/批范式，`repository.ts:340-354`）→ 大库保存从 O(n²) 降到 O(n)。靠 D1 回归测试 + 新增大批量用例兜底。

**7. 构建可复现性（vendor 固定 SHA + CI docker build）**
`vendor-web.mjs:8`、`Dockerfile.web:18` 跟随上游 `main`；`UPSTREAM.md:128` 只记录 SHA 不校验。改为固定已记录 commit + CI 校验；并新增两条 `docker build` 冒烟 job（当前 CI 完全不验证 Dockerfile）。

**8. 提交前门禁升级**
pre-commit 现仅 overlay + 扩展校验。建议加 `pnpm -r --filter "@navhub/*" exec tsc --noEmit` 与 `vitest run --changed`（保护已有 709 测试）；同时把 `check-web-overlay.mjs:126-136` 的反向告警改成「白名单外新增文件即失败」。

**9. 死依赖与版本对齐（一次 devDeps 大扫除）**
- 删：`drizzle-orm`/`drizzle-kit`（零调用，`driver.ts:488-491` 仅创建实例）、`@tanstack/react-query`、`iron-session`、`apps/web` 的 `wrangler` + `cf:build`/`cf:deploy` 脚本。
- 对齐：`next` 声明 15.5.21 → 15.5.28（与 override 一致）；`tailwind-merge ^1.14.0 → ^3`（v1 与 Tailwind v4 不匹配）；`next-themes ^0.2.1 → ^0.4`；`@types/node 20.4.5 → 22.18.13`（与根一致）。

**10. Docker 与文档收拾**
`docker/Dockerfile.api` 单阶段把 `python3 make g++` 编译链留在运行镜像（`:24-28`）；`Dockerfile.web` 无依赖层缓存。拆多阶段 + 加缓存。文档侧修正 `UPGRADE-PLAN` 的过时描述（仍称"无 test-web / 无 e2e CI / TS 5.1.6 / React 18.2"）与三处不一致的测试计数。

---

## 五、中期（1–2 月，需独立立项）

**11. 鉴权架构演进**：next-auth 5.0.0-beta.32 长期 beta（历史 CVSS 9.1 记录在案）→ 评估 Better Auth 或回退 `next-auth@4.24.15`；同时把 GitHub OAuth token 从进程内 `Map`（`lib/auth.ts:15`）迁到持久化/共享存储。

**12. zod 3 → 4**：收益是性能与维护性，但牵动前端表单链（`@hookform/resolvers@3` 只支持 zod v3）与 `zod-to-json-schema`（可用原生 `z.toJSONSchema` 替代，`apps/api/src/openapi.ts:22`）。建议先升级/替换 resolver 再动 zod。

**13. drizzle 路线决策 + 数据层治理**：`repository.ts` 2388 行裸 SQL 无类型安全，二选一（彻底移除 or 按域渐进引入 query builder）；同时给 `events`/`audit_logs` 加 TTL/归档，建立查询预算断言防回归。

**14. 多实例语义补齐**：SSE 事件总线（`jobs.ts:36-44`）改 PG LISTEN/NOTIFY 或外部总线；限流（`server.ts:107`）与 token touch 节流（`repository.ts:229`）改共享存储 —— 这是"标准模式可水平扩展"的前置条件。

**15. 前端工程化**：拆 8 个 >800 行组件（优先 `algorithm-lab.tsx` 2211、`admin/sitelist/page.tsx` 2031）；补 `loading.tsx`/`error.tsx`（现 43 页面 0 个 loading）；引入 `@testing-library/react` + 覆盖率阈值；`React.memo`/虚拟列表按需补。

**16. tsconfig 与构建现代化**：`moduleResolution: "node"` → `"bundler"`、`target: "es2017"` → `es2019+`；确认 Tailwind v4 的配置入口（`tailwind.config.js` 在新架构下可能失效，且 `postcss.config.js` 的 autoprefixer 在 v4 已内置冗余）。

**17. 运维文档三件套 + PG 运维**：部署回滚流程、on-call/告警 runbook、SLO/SLI 定义；`scripts/backup.mjs` 只覆盖 SQLite，standard 模式（PG）需补 `pg_dump` 包装脚本与恢复步骤（`docs/wiki/09:368` 仅一句）。

---

## 六、不建议做的（反目标）

1. **不要重写 vendored 上游业务逻辑**——继续用 overlay 覆盖层 + 一致性校验的既有机制，保持"分层隔离"这一核心约定。
2. **不要为了门禁硬刚 vendored 代码的严格类型**——正确做法是隔离：给 overlay 自研文件单独一个 `tsconfig`（严格门禁），vendored 部分保持现状，而不是笼统地开全局 `ignoreBuildErrors`。
3. **不要在清理死依赖之前引入新的 ORM/状态库**——先做减法（第 9 项），再评估加法。
4. **不要同时推进 Docker 与 Cloudflare 两条部署线**——先二选一收敛（第 16 项），再谈优化。

---

## 七、执行建议

- **顺序**：安全止血（1–6）→ 门禁与可复现性（7–10，含 overlay 硬化）→ 性能（6 项提前，因影响面大）→ 架构演进（11–17）。
- **节奏**：每项独立分支，按仓库既有约定"单文件隔离提交"；合并前跑 `pnpm verify`（overlay + 扩展 + typecheck + 709 单测），涉及前端再跑 `pnpm verify:all`（含 Playwright）。
- **回归保险**：涉及快照语义（第 6 项）与鉴权（第 11 项）的改造必须先补测试再改代码——当前 SSE 流与限流**完全无测试**，是这类改造的硬缺口。
