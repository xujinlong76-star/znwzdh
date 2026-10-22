# NavHub 用户中心升级建议方案

> 版本：v1.0 · 2026-10-22 · 基于对 `apps/web-overlay`（前端）、`apps/api` + `packages/store`（后端与数据层）的只读研究，关键结论已由主理人独立复核代码。
> 研究口径：全部结论带 `文件:行号`；标 ✅ 者为已复核，标 ⚠️ 者为待验证。

---

## 实施进度（2026-10-22 18:00 更新）

| 项 | 状态 | 提交 |
|---|---|---|
| S1 身份授权收口 | ✅ 已落地 | 58f1303 |
| S2 降级三态 | ✅ 已落地 | 58f1303 |
| S3 收藏状态全局化 | ✅ 已落地 | 58f1303 |
| S4 重试同步完整性 | ✅ 已落地 | 58f1303 |
| S5 写路径幂等与闸门 | ✅ 已落地 | 58f1303 |
| S6 合并补 settings + 三索引 | ✅ 已落地 | 58f1303 |
| M2 数据主权闭环 | ✅ 已落地 | 8e9d3fd |
| M3 工作区明文迁出 E2EE 表 | ✅ 已落地（新表 + 幂等迁移） | 8e9d3fd |
| M7 无障碍细节（金库密码） | ✅ 已落地 | 8e9d3fd |
| M8 重接口限流 | ✅ 已落地 | 8e9d3fd |
| M9 互操作导出（Netscape） | ✅ 已落地（收藏 → 浏览器书签 HTML） | 89d434a |
| M10 用户可见操作记录 | ✅ 已落地（/api/me/activity） | 8e9d3fd |
| M11 域文档补齐 | ✅ 已落地（docs/wiki/12-user-center.md + 三处漂移修正） | 11ec23c |
| M1 同步引擎换代 | ✅ 已落地（批量 ops + 版本游标 + 墓碑软删 + 分片；客户端双分支） | 5a6e49c |
| M4 身份模型收口 | ✅ 已落地（去 email 静默绑定 + 唯一索引 + 存量去重） | 5a6e49c |
| M5 `/me` SSR 化 | ✅ 已落地（服务端壳注入首屏 + 客户端岛保底） | 同日 web 批 |
| M6 移动端导航 | ⬜ 未开始（需改全局 layout，当前与并行会话冲突） | — |

> 落地口径：每个批次都跑过钩子全量（S 批 2609 passed；M 批 2625 passed），专项用例随批新增。

---

## 0. 摘要（TL;DR）

用户中心已经是一个**功能闭环完整**的产品域：登录身份（NextAuth → BFF → 中枢）、收藏与文件夹、搜索历史、画像与信号管理、数据导出/注销、工作区名册、个人 AI 配置、E2EE 金库备份，共 30+ 端点、12 张用户域表、21 个相关测试文件 / 209 条用例（前端仅 `favorites-*` 5 个行为测试）。前端 4 个页面（`/me`、`/me/history`、`/me/data`、`/favorites`）+ 1 个偏好页（`/preferences`）全部 noindex，入口收敛在顶栏图标、页脚与页内子导航。

**最优先的结构性问题（P0-1）已在 `58f1303` 修复**：此前 Web 侧有两条互不相通的信任通道——BFF `/api/me/*`（会话派生身份）与通用代理 `/api/hub/*`（对客户端自报身份无条件签名）。后者承载收藏、历史、画像、金库的全部读写，签名只证明「代理见过这个字符串」，换个 `anonId` 即可读写他人数据。现在代理先做身份裁决（会话优先 / 仅匿名域 / 非匿名自称 403），`/api/me/merge` 校验浏览器绑定 cookie。**签名 ≠ 授权**仍是理解整份方案的第一性判断；剩余风险集中在 P0-2（username/email 绑定）与 §5.3（共享设备 TOFU）。

除此之外的主要改进空间集中在三类：

1. **降级语义**（会话故障显示"你是匿名"、历史取数失败显示"没有记录"）——S2 已修（`me-degrade-states` 守卫）；
2. **同步引擎**（逐条 POST、无版本/墓碑、多实例状态不联动）——S4/S5 已补共享状态与重试刷新，**增量协议与墓碑仍未做**；
3. **数据主权**（注销/导出范围、workspaces 明文、retention）——M2/M3 已补导出/注销范围与密文存储，retention 与 PG 覆盖仍缺。

**建议节奏**：短期（1–2 周）先做**安全收口 + 降级语义 + 同步一致性**五件事；中长期（1–2 月）做**同步引擎换代、数据主权闭环、身份模型收口、SSR/性能**。全部建议均给出实施要点、验收标准与硬约束（见 §5）。

---

## 1. 现状梳理

### 1.1 功能全景

| 能力 | 入口 | 实现状态 | 测试 |
|---|---|---|---|
| 身份建立与同步 | 全站 `<SessionSync />`（`app/layout.tsx:183`） | ✅ 可用；`POST /api/me/sync` upsert OAuth 用户 | `me-identity.test.ts`、`identity-signature.test.ts` |
| 概览面板 | `/me` | ✅ 可用；纯客户端三态（loading/anonymous/ready/error）+ 画像 explain | `me-pages.test.ts`（仅源码字符串） |
| 搜索历史 | `/me/history` | ✅ 可用；分页 10/50、单删/全清 | `me-pages.test.ts`（仅字符串） |
| 数据管理 | `/me/data` | ✅ 可用；导出 JSON、注销（`confirm:'DELETE'`） | `me-pages.test.ts`（仅字符串） |
| 收藏 + 文件夹 + 备注 + 筛选 | `/favorites` | ✅ 可用；本地优先 + 云端权威合并 + 三态空态 | 4 个专项测试（最完整） |
| E2EE 金库 | `/favorites`（导出/导入） | ⚠️ 仅本地文件；云端金库端点只被首页 DIY 使用 | `me-data-api.test.ts`、`end-user-identity-plane.test.ts` |
| 画像与信号 | `/me`、`/preferences` | ✅ 可用；60s 节流聚合 | `profile-view.test.ts` |
| 个人 AI 配置 | `/preferences` | ✅ 可用；密钥加密信封 | `ai-config-api.test.ts` |
| 工作区名册 | 工作台页 | ✅ 可用；**数据明文存 `user_vault_sync`** | `workspaces-api.test.ts` |
| 导出 / 注销 | `/me/data` | ⚠️ 有缺口（见 P1-4） | `me-data-api.test.ts` |

### 1.2 架构分层

```
浏览器            BFF（Next Route Handler）              中枢（Fastify）            Store
─────────────────────────────────────────────────────────────────────────────────────────
/me 页 ──► /api/me/*        ──(会话派生身份 + HMAC)──►  routes/me.ts     ──► repository/*
/favorites ─► /api/hub/*    ──(客户端自称身份 + HMAC)─►  routes/favorites  ──► favorites.ts
/me/history ─► /api/hub/*   ──(同上)──────────────────►  routes/history    ──► history.ts
/preferences ─► /api/hub/*  ──(同上)──────────────────►  routes/profile    ──► behavior/profiles
```

两条通道的语义差异是 §2.1 P0 的根源：

| | `/api/me/*`（BFF） | `/api/hub/*`（通用代理） |
|---|---|---|
| 身份来源 | `auth()` 会话 → `canonicalUserId()` | **请求头/query/body 自报**（`hub-proxy.ts:23-35` 白名单转发 + `identityFromRequest` 取值） |
| 签名 | 签"会话派生身份" | 签"客户端自称身份" |
| 客户端身份头 | **不转发**（`api/me/route.ts` 头白名单构造） | 原样转发并签名 |
| 可伪造性 | 需伪造 NextAuth 会话 | **改一个 query 参数即可** |

### 1.3 数据模型（12 张用户域表）

| 表 | 关键事实 |
|---|---|
| `users` | `username` 唯一；**`email` 无唯一索引**；OAuth 绑定先按 username 再按 email 命中（`users.ts:53-63`）→ 可误绑内置账号 |
| `favorites` | UNIQUE(user_id, site_id)；`ORDER BY created_at` **无索引**；硬删 |
| `favorite_folders` | 无 `(user_id,name)` 唯一；无 `updated_at`；`sort` 创建恒 0 |
| `search_history` | 分页索引完备（`(user_id, created_at DESC, id DESC)`）；硬删 |
| `user_profiles` | 整行 JSON **全量覆盖**（`profiles.ts:80-102`） |
| `user_vault_sync` | E2EE 密文表，但 **workspaces 明文混存同表** |
| `user_settings` | 迁移期补建；`personalization_enabled` + `favorite_signal_cutoff` |
| `events` | 画像唯一原料；**缺 `(identity, created_at)` 复合索引**；180 天 retention |
| `identity_aliases` / `identity_merges` | 合并 5 跳上限；幂等靠唯一索引 |
| `api_tokens` | sha256 落库、明文只回一次 |
| `sessions` | **全库零读写的死表** |
| — | 所有用户域表**无外键**，级联靠应用层手写；**只有 `sites` 有软删除**，用户数据一律物理删 |

### 1.4 身份与信任链（核心风险区）

```
NextAuth 会话 ──► canonicalUserId() ──► BFF 签名 ──► 中枢 preValidation 校验 ──► 路由 identityTrusted
                                                            │
匿名用户 anon-<uuid> ──► /api/hub/* 代理：identityFromRequest(自称) ──► 签同一个值 ──► 校验通过
```

- 签名算法：HMAC-SHA256，hex，常量时间比较，签名对象是 `identityOf` **截断 64 字符后**的原始值（`identity-signature.ts:25-46`）。
- 硬不变量：任何路由必须 `identityOf` + `identityTrusted` 成对出现，否则签名 hook 覆盖不到（`shared.ts:300-310` 有反例注释）。
- `identityTrusted` 在配置 secret 时**恒真**（`shared.ts:311`）——其正确性完全依赖"没有旁路身份入口"。
- 生产启动仅校验 `identitySecret` 存在且 ≥32 字符（`security-readiness.ts:36-54`）；开发/预发不校验。

### 1.5 同步与离线策略

- **localStorage 契约**（不可改）：`navhub.favorites.v1`、`navhub.anonId`、`navhub.userId`、`navhub.merge.<id>.<anon>`、`navhub_api_token`；损坏数据备份到带时间戳的 `.corrupt.*` 键。
- **同步**：进入 `/favorites` → 逐条 `POST /api/favorites`（**首条失败即 break**）→ `GET` 全量 → **云端成员集合覆盖本地**（`favorites-merge.ts`），`note`/`folderId` 严格取云端（云端 null = 已清除，不可回退）。
- **无版本号/墓碑/批量接口**；唯一带乐观并发控制的是云端金库（409 + ETag），但仅首页 DIY 在用。
- 离线缓存只有收藏；历史/画像/金库无本地缓存。

### 1.6 质量基线（2026-10-22 15:30 复核）

- **测试规模**：用户域直接相关的 **21 个文件 / 209 条用例**（api 7 / web 11 / store 3，见附录 A）。
  - 后端 7 个文件 92 条，全部是真实 Fastify + SQLite 的行为测试（`me-api` 8、`me-data-api` 11、`workspaces-api` 7、`ai-config-api` 17、`identity-signature` 15、`end-user-identity-plane` 22、`identity-plane-extensions` 12）。
  - store 3 个文件 11 条，覆盖身份合并、注销事务与工作区密文（`identity-merge` 2、`user-data` 8、`workspace-blobs` 1）。
  - 前端 11 个文件 106 条中，`favorites-*` 五个（49 条，含 shared-state）+ `hub-identity-guard`（10 条）是行为/纯函数测试；`/me`、`/me/history`、`/me/data` 仍只有源码字符串守卫——`me-pages.test.ts` 自述「刻意检查源码字符串而不是渲染」。全仓 web 测试只有 `highlight`、`latest-request-sites` 两个文件使用 render，且与用户域无关。
- **E2E 盲区**：Playwright 只有 `e2e/front-pages.spec.ts` 冒烟 `/favorites` 与 `/preferences`；`/me`、`/me/history`、`/me/data` 无 E2E，也没有「匿名 / 持票 / 签名 / 会话」四态矩阵。
- **身份面守卫**：`end-user-identity-plane`（22）、`identity-plane-extensions`（12）、`plugin-identity-idor`（25）锁住第二轴；`hub-identity-guard.test.ts`（10）随 S1 于 `58f1303` 落地（会话优先 / 仅 anon 域 / 非匿名自称 403），`hub-identity-signature.test.ts`（13）已同步改为「签名对象是裁决后的身份」。
- **全量基线**：**923 个套件 / 2,670 条用例，2,655 passed / 15 skipped / 0 failed**（2026-10-22 15:30 实测，对应 `8e9d3fd`）。文中不再引用旧的 2,481 / 2,577。
- **CI 门禁**（`.github/workflows/ci.yml`）：`typecheck`、`test`（SQLite 全量 vitest）、`test-postgres`（只跑 `pg-dialect.e2e.test.ts` + `rollup-pg.e2e.test.ts`）、`test-web`（vendor → tsc → eslint → build → `check-bundle-budget`）、`check-web-overlay`（含 `sync-core-mirrors --check`、`check-upstream-ref`、`check-extensions`）、`test-e2e`、`docker-smoke`、`audit`。`array-caps` / `sql-in-budget` 是 vitest 用例，不是独立 CI job。
- **bundle 预算**：`/me*` 不在 `scripts/bundle-budget.json` 的 routes 表，落 `default = 1,270,784 B`（≈1.21 MiB）；`/favorites = 965,632 B`（≈943 KiB）是唯一有专属棘轮的用户中心页，`/me` 比它宽松约 31%。M5 SSR 化后应补 `routes` 条目，且只降不升。
- **PG 侧缺口**：`pg-dialect.e2e.test.ts` 对 `mergeIdentity` / `deleteUserData` / `addFavorite` / `saveUserVault` / `user_settings` **零命中**；CI 的 `test-postgres` 只覆盖该文件与 rollup，整套用户域在 PG 上无用例。改动这些路径必须新增 PG 测试（需 `NAVHUB_TEST_DATABASE_URL`）。

### 1.7 既有文档与域文档缺口（重要上下文）

- **域文档**：本方案是 `docs/` 下**首份**用户中心域文档（撰写前 `grep -rn "用户中心" docs/` 仅审计报告零星命中，无域文档）。三处 wiki 仍漂移：
  - `wiki/03-web.md:130-131` 页面表只有 `/favorites`、`/preferences`，缺 `/me`、`/me/history`、`/me/data`；
  - `wiki/02-api.md:264` 仍写「不引入终端用户鉴权体系」——HMAC 签名、`identityTrusted` 都已落地，口径需改写；
  - `wiki/05-store.md` 缺 `user_settings`、`identity_aliases`、`identity_merges`、`user_vault_sync` 四张表（`favorites` / `user_profiles` / `search_history` 已有）。
- **原始分期计划**：`.trae/documents/用户中心第二批改造计划.md`（**未被 git 跟踪**）：第一批「能看」、第二批「能管」；验收是**手工清单**（开关个性化后搜索不再带 personal 通道、导出不含明文密钥、删除后 `/api/me` 返回空概览、两标签页 PUT 旧 version 必须 409），未转成自动化行为测试。建议按 §7.2 迁入 `docs/` 并标注已由本方案接续。
- **P0 是「预登记」过的**：`docs/acceptance-report.md:503` 明示「收藏夹云端同步的身份由调用方传入（anonId / userId），**未做终端用户鉴权**——多用户公开场景需加 Bearer token」；`docs/security-notes.md:82` 记「仍未覆盖：绕过 Web 代理、直接以无身份调用的路径」；`docs/AUDIT-2026-10-20-PASS3.md` §10.6（491-493 行）把「开放模式身份可自报（≈110 条公共路由）」列为产品口径决策，并记「身份仍是 `slice(0, 64)` 截断而非校验」。**这是当时明示的口径，不是实现失手**。
- **已落地的相关修复（避免重复设计）**：`9dd2ecf` 引入 `identityTrusted` / `isAdminScope`，堵住「无票直连 API 自称身份」与「匿名请求携带默认 admin scopes」；`58f1303` 落地 S1–S6（hub 身份裁决、匿名绑定 cookie、降级语义、收藏共享状态）；`8e9d3fd` 落地 M2/M3/M7/M8/M10（数据主权、工作区密文、身份合并设置）。**P0-1 已修复**：`/api/hub/*` 只对裁决后的身份签名，非匿名自称在没有会话时直接 403；`/api/me/merge` 的匿名所有权改为校验浏览器绑定 cookie。剩余身份风险见 P0-2 与 §5.3（TOFU 共享设备、扩展/MCP 仅 anon 域）。
- **工作树事实**：第二批 21 个文件已随 `682aada` / `7f3001c` / `d068e3b` / `d5034d2` 提交；身份第二轴在 `9dd2ecf`，S1–S6 在 `58f1303`，M2/M3/M7/M8/M10 在 `8e9d3fd`。撰写时工作树只剩本方案文档与并行会话的 SEO 改造——**任何实施前必须重新取 `git status` 与全量基线，不要按本文快照直接动手**。

### 1.8 外部产品能力基线（用于定位差距）

1. **组织维度**：成熟产品把标签当一等公民（Raindrop 集合+标签+类型 / Pinboard 纯标签 / 浏览器纯层级）。NavHub 现状只有单一 `favorite_folders`（name≤30 + sort）+ 单条 `note`，无标签、无多集合、无智能视图。
2. **收藏内检索与排序是默认能力**：NavHub 的 `listFavorites` 无 LIMIT、无检索参数，前端全量拉取后做客户端筛选。
3. **跨端同步是"增量 + 可判定冲突"**：成熟产品有 per-record 版本/变更游标、墓碑软删、一次同步一个请求；NavHub 是逐条 POST + 集合覆盖 + 无版本无墓碑。
4. **导入导出是互操作格式**：行业基线可导入/导出浏览器书签 HTML（Netscape 格式）、Pocket、Instapaper。NavHub 导入有（`/import`），**用户级导出只有私有 JSON**，无法搬回浏览器或迁到别家。
5. **数据主权是自服务闭环**：导出全部数据 + 删除账号 + 删除范围可核对。NavHub 有入口但范围有缺口（P1-6）。
6. **分享/协作需要"公开集合 + 权限"模型**——NavHub 现状无可见性字段、无公开页，且与 noindex 策略相冲突（列入 Non-goals）。

---

## 2. 问题与改进空间

> 状态（2026-10-22 15:30）：S1–S6 已由 `58f1303` 落地（hub 身份裁决、匿名绑定、降级语义、收藏共享状态、写入一致性），M2/M3/M7/M8/M10 已由 `8e9d3fd` 落地（数据主权、工作区密文、身份合并设置）；P0-1 已关闭。下表保留原始问题描述作为背景，**未逐行改写状态**——实施前以最新代码与 §1.6 基线为准。

### 2.1 P0（安全 / 数据完整性，必须先修）

**P0-1｜通用代理对客户端自称身份无条件签名，`/api/hub/*` 无真实授权**（✅ 主理人复核）
- 位置：`apps/web-overlay/src/lib/hub-proxy.ts:23-35`（转发 `x-navhub-user-id`/`x-navhub-anon-id`）、`app/api/hub/[...path]/route.ts:104-108`（对 `identityFromRequest` 结果签名）、`identity-signature.ts:36-50`（Header 优先取自称值）。
- 影响：任何持有会话的浏览器把 `?anonId=github:victim` 带进 `/api/hub/api/favorites` 即可读写他人收藏；历史、画像、`/api/vault/sync` 同理。canonical id 形如 `github:<id>`，可从插件作者页等公开面推断。
- 同类：**`/api/me/merge` 的匿名所有权签名同样失效**——BFF 对 body 里客户端自报的 `anonId` 直接签名（`api/me/route.ts:114-123`），中枢据此放行（`me.ts:153-165`）。签名只证明"BFF 收到了这个字符串"。
- **前史（必须知道）**：这是**明示过的产品口径**而非实现失手——`docs/acceptance-report.md:499-503` 原文登记「收藏夹云端同步的身份由调用方传入，未做终端用户鉴权」；`security-notes.md:59-90` 记「仍未覆盖：绕过 Web 代理、无身份直连」；PASS3 §10.6.1 记「开放模式身份可自报（≈110 条公共路由）属产品口径决策」。本次升级的本质是把口径从"单机/自托管单用户"推进到"多实例/多端默认安全"。
- **隐性成本（不改会直接红）**：`apps/web/test/hub-identity-signature.test.ts:33-52` **把当前的"客户端自报优先 + slice(0,64) 截断"锁成了测试**。任何会话优先的修复必须同步改写该测试的期望，并在提交信息中说明口径变更。
- **状态（2026-10-22 15:30）**：**已修复**（`58f1303`）。`/api/hub/*` 先经 `resolveHubIdentity` 裁决（有会话用会话身份；无会话只允许 `anon-*`；其它自称直接 403），签名对象不再是客户端自称；`/api/me/merge` 校验浏览器绑定的 HttpOnly cookie。残余风险：共享设备的 TOFU 绑定（§5.3），以及扩展/MCP 无会话时只能使用匿名域。

**P0-2｜`/api/users/sync` 的身份绑定靠 username/email 且返回值与后续签名身份不一致**（后端研究）
- `upsertOauthUser` 先按 username、再按 email 命中就 UPDATE 既有行（`users.ts:53-63`）；`users.email` 无唯一索引。
- BFF 之后仍用会话派生的 `<provider>:<id>` 签名，从不使用 sync 返回的 `data.id` → 这些用户的 `/api/me.user` 恒为 null，而 email/avatar 已被改写。
- **状态（2026-10-22 15:30）**：客户端已改为消费 sync 返回的 canonical identity（`session-sync.tsx:48-53` 写入 localStorage）；但 `users.email` 无唯一索引、`upsertOauthUser` 仍按 username/email 命中更新既有行的绑定风险未变。

### 2.2 P1（正确性 / 可用性，短期修）

| 编号 | 问题 | 位置 | 影响 |
|---|---|---|---|
| P1-1 | 会话探测失败被渲染成「匿名」 | `me/page.tsx:85-91`、`me/data/page.tsx:34-40` | 已登录用户被明确告知"你是匿名，登录后可同步"——把故障说成事实 |
| P1-2 | 历史取数失败被渲染成「没有记录」 | `me/history/page.tsx:56-60`（未接 `onDegraded`） | 中枢抖动 → 用户以为历史被清空；该页 `error` 状态从未被设置 |
| P1-3 | `useFavorites` 每实例一份状态，页内不联动 | `hooks/useFavorites.ts:89-131`；`storage` 事件同文档不触发 | 收藏页点星取消收藏，卡片不消失、计数不同步，需刷新 |
| P1-4 | 「重试同步」成功不刷新本地与文件夹 | `favorites/page.tsx:487-497` | 重试成功后仍显示旧数据，需手动刷新 |
| P1-5 | 乐观更新承诺「已在本机保留」但下次被云端覆盖 | `favorites/page.tsx:172-196` vs `favorites-merge.ts:48-57` | 提示与实际结果不符：本地改动静默丢失 |
| P1-6 | 注销与导出不完整 | `user-data.ts:128-169`、`71-105` | 漏 reviews 正文、sessions、users 行、`workspaces:*` 键、`llm_usage`；导出漏 events/stars/workspaces——数据主权承诺不成立 |
| P1-7 | workspaces 明文落在 E2EE 表 | `workspaces.ts:203/319/366` | 隐私表述失真；备份/运维可见工作区名与成员邮箱 |
| P1-8 | canonical 解析只在 `/api/me*` | `favorites.ts:31`、`history.ts:17`、`profile.ts:26`、`vault.ts:21` | 合并后旧 id 客户端写入产生孤儿行；扩展/MCP/旧标签页读不到自己数据 |
| P1-9 | 匿名用户也在向云端写收藏，与页面文案三种说法冲突 | `useFavorites.ts:162-166` vs `favorites/page.tsx:883/1014` | 同一份数据的"是否上云"在 UI 上说法不一 |
| P1-10 | 身份就绪与页面取数竞态 | `session-sync.tsx:23-53` vs `me/history:49`、`favorites:108` | 刚登录首次进入这两页读到 anon 身份且不再重试 |

### 2.3 P2（性能 / 一致性，中期修）

| 编号 | 问题 | 位置 |
|---|---|---|
| P2-1 | `addFavorite` 先查后插，无 `ON CONFLICT` → 并发双写 500 | `favorites.ts:60-76` |
| P2-2 | `listFavorites` 无 LIMIT，三处复用（GET/导出/画像） | `favorites.ts:52-58` |
| P2-3 | `mergeIdentity` 逐行往返 + 逐条计数，全程持写锁 | `identity.ts:139-156/216-275` |
| P2-4 | 合并遗漏 `user_settings` / `llm_usage` / `audit_logs`；评价合并重置主键 | `identity.ts:118-291` |
| P2-5 | `deleteFavoriteFolder` 两条语句无事务 | `favorites.ts:103-110` |
| P2-6 | 画像节流表是进程内 Map（多实例失效、重启丢状态） | `profile-service.ts:20-46` |
| P2-7 | `/api/events` 无身份闸门（可写他人行为事件、污染画像） | `telemetry.ts:31-56` |
| P2-8 | 无路由级限流的重接口：`/api/me/export`、`/api/favorites`、`/api/me/merge` | `server.ts:133` |
| P2-9 | 每次进入 `/favorites` 产生 N 次串行 POST | `useFavorites.ts:287-292` |
| P2-10 | 收藏夹无 `(user_id,name)` 唯一、无 `updated_at`、`sort` 恒 0 | `schema.ts:329-335` |
| P2-11 | 事件-收藏非原子；清空收藏不写事件 | `favorites.ts:45-109` |
| P2-12 | 收藏无服务端检索/分页（全量拉取 + 客户端筛选） | `favorites.ts:52-58`；基线产品默认可在集合内检索排序 |
| P2-13 | 用户级导出只有私有 JSON，无互操作格式（Netscape HTML/Pocket） | `me.ts:79-105`；`/import` 有入口但导出无法回流 |
| P2-14 | 用户域审计已落库但无用户侧读接口（`user.export` 本身被审计，用户却看不到） | `me.ts:85/122/185`、`audit.ts:24` |

### 2.4 P3（技术债 / 体验细节）

- 索引补齐：`events(identity, created_at)`、`plugins.owner_identity`、`favorites(user_id, created_at)`（`schema.ts:237-242/482`、`identity.ts:306`）。
- drizzle `schema` 导出缺 4 张表（"单一事实源"名不副实，`schema.ts:595-600`）。
- 死表 `sessions`（`schema.ts:185`）。
- `/me` 骨架与内容形状不符；`/favorites` 双骨架形状不同（`loading.tsx` vs 页内）；`/me/history`、`/me/data` 无 loading。
- 无障碍：密码明文切换是裸 `<button>` 无名字（`favorites/page.tsx:577-583`），现有扫描只匹配 `<Button size="icon">`；`<label>` 缺 `htmlFor`（`:566`）。
- 移动端无底部导航；`/me` 入口在窄屏隐藏（`navigation-toolbar.tsx:217-227`）；命令面板无用户中心入口。
- 三页导航层级不同构（`/favorites` 有面包屑 + 子导航，其余只有返回按钮）。
- `clearCloudFavorites` 导出但无调用方（无"清空云端收藏"UI）。
- `/me/history` 的 `no-identity` 分支不可达（`getIdentity()` 恒非空）。
- **域文档缺失**：`docs/` 里 `grep "用户中心"` = 0 命中；`wiki/03-web.md` 无 `/me*` 三页、`wiki/02-api.md §3.7` 鉴权口径过时、`wiki/05-store.md` 缺 4 张表；分期计划原件 `.trae/documents/用户中心第二批改造计划.md` **未被 git 跟踪**。
- **令牌能力无法下放**：`api_tokens` 表无 owner/identity 列（`schema.ts:209-225`），要做"用户自建 API 令牌"必须先改 schema + scope 模型。
- **无任何用户侧通知能力**：全仓 `notification|subscribe` 零命中；`jobs` 的 10 种任务无一面向终端用户（`token_audit` 只写审计日志）。
- **`/me*` 无 bundle 棘轮**（落 default 1.27MB）且三页零 E2E。

---

## 3. 升级建议（按优先级）

### 3.1 短期（S 系列，1–2 周，目标：止血 + 语义正确 + 一致性）

> 排序即执行顺序；S1 未完成前，其余改动不要碰身份链路。

#### S1【P0｜高】身份授权收口：把"签名"升级为"授权"
- **目标**：任何浏览器只能读写**自己**的数据，与是否知道他人 anonId 无关。
- **实施要点（推荐 b + c 组合，a 为中期目标）**：
  - (a) *中期*：`/api/hub/api/{favorites,search-history,profile,vault,workspaces}` 收敛为 BFF `/api/me/*`（会话派生身份），停止从 query 取身份。
  - (b) *短期*：在 hub 代理 `app/api/hub/[...path]/route.ts` 增加**会话优先策略**——若存在会话，则身份强制取会话 canonical id，**忽略并剥离**客户端自称的 `x-navhub-*`/query `anonId`；无会话时仅允许 `anon-` 前缀身份（匿名域）。
  - (c) **merge 所有权**：BFF 首次为匿名用户下发 `HttpOnly` cookie（如 `navhub_anon_owner`，值 = anonId 的 HMAC）；`POST /api/me/merge` 仅当 body.anonId 与 cookie 校验一致时才签 `x-navhub-anon-signature`。撤销"对任意 body.anonId 直接签名"。
- **验收标准**：① 新增端到端测试：登录用户 A 以 `?anonId=<B 的身份>` 请求 `/api/hub/api/favorites`，返回 A 自己的数据或 403，**不得返回 B 的数据**；② 同测试覆盖 history/profile/vault；③ merge 在两个浏览器会话间不可窃取（B 的 anonId 无 cookie 时 403）；④ 既有 `identity-signature` / `end-user-identity-plane` / `me-api` 全绿；⑤ **同步改写 `hub-identity-signature.test.ts:33-52`**（该测试目前把"客户端自报优先"锁成了期望值），并在提交信息中声明口径变更。
- **预期收益**：消除越权读写（收藏/历史/画像/金库四处），并让未来所有 `/api/hub/*` 端点自动获得会话保护。

#### S2【P1｜高】降级语义三态化：故障 ≠ 匿名 ≠ 空
- **目标**：所有用户中心页把「未知/故障」与「事实」分开表达。
- **实施要点**：`/me` 与 `/me/data` 的会话探测引入 `unknown` 态（非 2xx/网络错误 → `error` + 重试，仅 401/无 user → `anonymous`）；`/me/history` 接入 `onDegraded` 回调 → `error` 态 + 重试按钮 + 文案「历史暂时取不到，稍后重试」。
- **验收**：新增 `me-states.test.ts` 行为测试（mock fetch 三分支）；文案断言互不串味（沿用 `profile-view.test.ts` 的断言风格）。
- **收益**：消除"把故障说成事实"的信任损耗；与仓库既有降级原则对齐。

#### S3【P1｜高】收藏状态全局化 + 乐观更新可靠化
- **目标**：页内多实例联动；"已在本机保留"在下一次同步时真的保留。
- **实施要点**：`useFavorites` 升级为 Context Provider（不引入新依赖），暴露 `subscribe`；`persist` 后派发自定义事件（或直接走 Context 更新）；`assignFolder`/`saveNote` 失败时写入本地 `pendingOps` 队列（带 `updatedAt`），下次同步先推 pending 再拉云端；`mergeCloudFavorites` 对 pending 条目保留本地值。
- **验收**：新增 hook 测试（双实例、toggle 后列表移除、pending 推送顺序）；`favorites-merge.test.ts` 增加 pending 语义用例；现有 4 个收藏测试全绿。
- **收益**：修掉「点星不消失」「乐观更新被抹掉」两类高频体感缺陷。

#### S4【P1｜中】重试同步的完整性
- **实施要点**：`runCloudSync()` 成功后执行与首挂载相同的 `setFolders` + `replaceAll(mergeCloudFavorites(...))`；抽公共 `applyCloudResult()` 供两处共用。
- **验收**：`favorites-sync.test.ts` 增加"重试成功后本地被替换"用例。

#### S5【P2｜中】写路径幂等与事务
- **实施要点**：`addFavorite` 改 `INSERT ... ON CONFLICT(user_id,site_id) DO NOTHING` 并回读判断 `existed`；`deleteFavoriteFolder` 包进 `withTransaction`；`/api/events` 加 `identityTrusted` 闸门。
- **验收**：并发双写测试（两请求同 siteId → 均 200/201 且只有一行）；`me-data-api`/`favorites` 用例全绿。

#### S6【P2｜中】孤儿数据与合并完整性（小步版）
- **实施要点**：`mergeIdentity` 补 `user_settings`（目标继承 `favoriteSignalCutoff` 取较大值）；合并移动到 `withTransaction` 内的集合操作（先 `UPDATE ... WHERE identity IN (...)` 再处理冲突行）；`plugins.owner_identity` 加索引。
- **验收**：`identity-merge.test.ts` 增加 settings 继承与合并后计数一致性；`EXPLAIN` 断言无全表扫（可选）。

**短期不建议做**：任何 localStorage 键/结构变更、收藏协议（版本/墓碑）改造、workspaces 存储迁移——这些牵一发动全身，放中期。

### 3.2 中长期（M 系列，1–2 月）

| 编号 | 建议 | 优先级 | 核心实施要点 | 预期收益 |
|---|---|---|---|---|
| M1 | **同步引擎换代**：批量接口 + 版本 + 墓碑 | 高 | 新 `POST /api/me/favorites/sync`（body: ops[] + sinceVersion），服务端返回 diff；`favorites` 加 `updated_at` 与 `deleted_at`（墓碑）；客户端改为"推送 ops + 拉 diff"；保留旧端点兼容一个版本 | 每次进页从 N 次请求 → 1 次；删除可传播；多端冲突可判定 |
| M2 | **数据主权闭环**：导出/注销/retention 补全 | 高 | 导出补 events（脱敏聚合）、stars、reviews、workspaces；注销补 `plugin_reviews`（正文置空或删除）、`sessions`、`users` 行、`workspaces:*`/`ws_members:*` 键、`llm_usage`；retention 白名单扩到 `search_history`(可配) 与 `llm_usage`；PG 侧新增 delete/export 用例 | GDPR 级承诺可兑现；注销可验证 |
| M3 | **E2EE 边界修正**：workspaces 明文迁出 | 高 | 新表 `user_workspaces`（明文，明确非 E2EE）或客户端加密后入 vault；`/api/me/export` 与 `deleteUserData` 同步覆盖；旧键一次性迁移 + 清理 | 隐私表述与实现一致；备份/导出语义清晰 |
| M4 | **身份模型收口** | 高 | `users.email` 加唯一索引（迁移需去重策略）；OAuth 绑定改为"仅 username 精确命中 + 首次登录确认页"，禁止 email 静默绑定；`canonicalUserId` 解析下沉到发布订阅层（**在签名校验之后**，签 raw、解析后使用）；`merge` 压缩别名链 | 消除误绑与孤儿行；扩展/MCP 直连也正确 |
| M5 | **`/me` SSR 化与服务端壳** | 中 | 参照 `/site/[id]` 的服务端壳 + 岛模式：会话命中时服务端注入 overview 初始值（复用 BFF 逻辑），`SessionSync` 只做变更检测；列表分页 20/页；骨架形状与真实内容对齐 | 首屏从骨架 → 真实数据；LCP 改善；SEO 无关（noindex）但体感强 |
| M6 | **移动端与导航一致性** | 中 | 底部导航（复用 footer 预留给 safe-area 的空间）；命令面板加「用户中心/收藏/历史」三条；三页统一面包屑层级 | 移动端可达性；入口一致性 |
| M7 | **无障碍与骨架细节** | 低 | 裸 `<button>` 补 `aria-label`；`<label htmlFor>` 修正；扩展 `control-names.test.ts` 扫描面（覆盖裸 button 图标按钮）；`/favorites` 双骨架统一 | 审计可过；体验细节 |
| M8 | **可观测性** | 中 | 用户中心关键路径埋点（同步成功率、merge 成功率、降级率）；`/api/me/export`、`merge`、`favorites` 路由级限流（10–30/min/身份） | 问题可发现；滥用可控 |
| M9 | **互操作与可检索性** | 中 | ① 用户级导出增加 Netscape HTML（复用 `/api/export/bookmarks.html` 的格式化逻辑，按身份过滤）；② 收藏服务端检索 + 分页（`q`/`folderId`/游标），`listFavorites` 加 LIMIT；③ 收藏夹 `(user_id,name)` 唯一 + `updated_at` | 可搬回浏览器/迁到别家；万级收藏可用 |
| M10 | **用户可见的操作记录** | 低 | 新增 `GET /api/me/activity`（读 `audit_logs` 按 actor 过滤 + 脱敏），`/me` 增加"最近操作"面板；复用既有 4 类审计事件，不新增写路径 | 数据主权感；导出/注销可追溯 |
| M11 | **域文档补齐** | 低 | 新增 `docs/wiki/` 用户中心域页（端点/表/信任链/同步语义/红线），修正三处 wiki 漂移，把 `.trae` 计划原件纳入 `docs/`；本方案 §5.1 与之合并为单一"硬约束"真相源 | 降低下次升级的认知成本（当前 `docs/` 零命中） |

### 3.3 明确不做（Non-goals，本轮）

- 收藏分享/协作（需要权限模型与公开页，与 noindex 策略冲突，单独立项）。
- 第三方 OAuth 扩展（GitHub 之外）——先修身份绑定语义。
- 收藏内容端到端加密上云（`favorites.note` 服务端可读是现状；改 E2EE 需要客户端密钥管理，工作量大且与跨端搜索冲突）。
- 引入新状态库（Zustand/Jotai 等）——Context 足够，避免依赖膨胀。

---

## 4. 收益与实施要点汇总

| 建议 | 优先级 | 工作量（人日） | 依赖 | 风险 |
|---|---|---|---|---|
| S1 身份授权收口 | 高 | 3–5 | 无（需协调扩展/MCP 兼容） | 高：改身份链路，破坏面广；需 e2e 矩阵 |
| S2 降级三态 | 高 | 1–2 | 无 | 低 |
| S3 收藏状态全局化 | 高 | 2–3 | 无 | 中：6 个消费组件需回归 |
| S4 重试同步完整性 | 中 | 0.5 | S3 可并行 | 低 |
| S5 幂等与事务 | 中 | 1 | 无 | 低 |
| S6 合并完整性 | 中 | 1–2 | 无 | 中：合并语义有测试锁 |
| M1 同步引擎换代 | 高 | 5–8 | S3/S5 完成 | 中高：协议变更需兼容期 |
| M2 数据主权闭环 | 高 | 3–4 | M3 部分耦合 | 中：注销范围变更需法务口径确认 |
| M3 E2EE 边界修正 | 高 | 2–3 | 迁移脚本 | 中：旧键清理不可逆，需备份 |
| M4 身份模型收口 | 高 | 4–6 | S1 完成 | 高：email 唯一索引迁移 |
| M5 `/me` SSR 化 | 中 | 3–4 | 无 | 中：与 SessionSync 时序冲突 |
| M6 移动端导航 | 中 | 2 | 无 | 低 |
| M7 无障碍细节 | 低 | 1 | 无 | 低 |
| M8 可观测性 | 中 | 1–2 | 无 | 低 |
| M9 互操作与可检索性 | 中 | 2–3 | M1（游标可复用） | 低 |
| M10 用户可见操作记录 | 低 | 1 | 审计已就位 | 低（需脱敏口径） |
| M11 域文档补齐 | 低 | 1 | 无 | 无 |

---

## 5. 风险与依赖

### 5.1 硬约束（改代码前必须知道）

1. **双目录镜像**：`vitest` 的 `@/` 指向 `apps/web/src`，源码守卫读 `apps/web-overlay/src`——只改一边会出现"测试绿、线上旧代码"或反之。任何改动必须 overlay → 镜像同步（`check-web-overlay` 钩子会拦）。
2. **生成文件**：`lib/vault.ts` 由 `packages/core/src/vault.ts` 生成（`@core-mirror`），改加密格式必须改 core + `sync-core-mirrors.mjs`。
3. **localStorage 契约**：`navhub.favorites.v1` 等键名与结构不可改（注释明示"改了等于丢老用户收藏"）；只能加新键 + 一次性读取旧键。
4. **签名链路**：任何新路由必须 `identityOf` + `identityTrusted` 成对；签名对象是**截断 64 字符的原始身份**——canonical 解析必须在签名校验**之后**，否则签名校验失败。
5. **双方言**：SQL 用 `?` 占位；布尔/`group_concat` 必须分支；新表登记三处（sqlite DDL、pg DDL、migrate 兜底）；新列进 `COLUMN_ALTERS`。
6. **事务**：只用 `repo.withTransaction`；事务内不做远程 IO；长事务阻塞整库读（`mergeIdentity` 是当前最大持有者）。
7. **同步 null 语义**：`note`/`folderId` 必须"云端 null = 已清除"，新增字段同样；`??` 回退会把用户的清除动作变回来。
8. **noindex 不能改 Disallow**（爬虫读不到 noindex）；用户中心页均为 client component，metadata 只能由 layout 提供。
9. **PG 测试缺口**：`pg-dialect.e2e.test.ts` 对 merge / deleteUserData / favorites 并发 / vault 冲突 / user_settings 零命中；改动这些必须新增 PG 用例（需 `NAVHUB_TEST_DATABASE_URL`）。
10. **行为锁测试**：`apps/web/test/hub-identity-signature.test.ts:33-52` 在已提交版本里把「客户端自报优先 + slice(0,64)」锁成期望值——S1 必须同步改写该测试。工作树中的 `hub-identity-guard.test.ts` 是 S1 的新锁，提交前不要同时引用两套口径。
11. **bundle 预算不得上调**（`ci.yml` 的 `test-web` job）；`/me*` 目前落 `default = 1,270,784 B`，无专属棘轮——M5 SSR 化后补 routes 条目，只降不升。
12. **E2E 盲区**：`/me`、`/me/history`、`/me/data` 零 E2E，也没有登录态/匿名态矩阵（Playwright 只覆盖 `/favorites`、`/preferences` 冒烟）——S2/S3 只能靠新增行为测试证明，别指望 E2E 兜底。
13. **无通知/订阅能力**：全仓零命中，`jobs` 的 10 种任务无一面向终端用户——任何"到期提醒/同步失败提醒"是净新增，不要误判为已有能力。
14. **令牌无 owner 列**：`api_tokens` 只有 `id/name/token_hash`，要做用户可自建令牌必须先改 schema + scope 模型（`scope:"admin"` 的 6 条路由需重设计）。

### 5.2 依赖项

| 依赖 | 说明 | 阻塞对象 |
|---|---|---|
| `NAVHUB_IDENTITY_SECRET`（生产） | 已强制 ≥32 字符；开发/预发未强制 | S1 的验证需要它打开（否则签名链路不生效） |
| `NAVHUB_TEST_DATABASE_URL`（PG） | 当前 CI 无 PG 实例 | M2/M4 的 PG 用例 |
| 扩展/MCP 客户端 | 它们直连 `/api/hub/*` 用自称身份；S1(b) 会话优先策略会改变它们的行为（无会话 → 仅 anon 域） | S1 发布前需回归 Raycast/Chrome 扩展 |
| 并行会话（市场/SEO 工作） | 共享工作区，提交窗口=对方两次 commit 间隙 | 全部改动 |
| 并行会话（tag canonical / hub 身份守卫） | 撰写时工作树仍有未提交改动（`app/tags/**`、`lib/hub-identity-guard.ts`、`app/api/hub/**`），全量基线含 1 条中间态红 | S1–S6 全部：动手前重取 `git status` 并等对方提交窗口 |
| 法务/隐私口径 | 注销范围、retention TTL 的产品承诺 | M2 |

### 5.3 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| S1 身份改动引入登录态回归 | 中 | 高 | 先写 e2e 矩阵（7 端点 × 匿名/持票/签名/会话），再改；灰度：先只对 favorites 生效 |
| M1 同步协议变更导致旧客户端丢数据 | 中 | 高 | 新旧双端点并行一个版本；客户端先升级推送逻辑再切换拉取 |
| M3 workspaces 迁移不可逆 | 低 | 高 | 迁移前 `navhub.db` 备份 + 只读校验脚本；旧键保留一个版本 |
| M4 email 唯一索引迁移失败 | 中 | 中 | 迁移前去重报告（只读），冲突账号列入人工处理清单 |
| 钩子全量测试在共享工作区被他人红灯阻断 | 高 | 低 | 提交前本地跑全量；抓提交窗口（对方 commit 间隙） |
| **S1 残余：匿名绑定是 TOFU** | 中 | 中 | 首次接触即绑定：攻击者若提前用自己的浏览器冒充受害者的 anonId 请求一次匿名接口，cookie 会被绑到受害者 id 上。缓解：anonId 已从"任何请求可签名"降级为"仅匿名域可签"，且 UUID 不可枚举；下一步可让 BFF 在首次访问时**服务端签发** anonId（HttpOnly），彻底消除 TOFU——排在 M1 之后 |
| `/me` SSR 化与 SessionSync 时序冲突 | 中 | 中 | 服务端壳读会话 cookie，SessionSync 只做"变更后刷新" |

---

## 6. 路线图（建议排期）

| 周 | 内容 |
|---|---|
| W1 | S1（先写 e2e 矩阵）+ S2 + S5 |
| W2 | S3 + S4 + S6；M1 设计评审 |
| W3–4 | M1 实现 + 兼容期；M3 迁移脚本 |
| W5–6 | M2 + M4（含 PG 用例） |
| W7–8 | M5 + M6；M9 起步；M7/M8/M10/M11 穿插 |

---

## 7. 治理与接管声明（避免与既有约定冲突）

1. **接管范围**：`docs/seo/SEO-UPGRADE-PLAN-V3-2026-10-21.md:372-380` 的红线 7 曾把 `auth/identity/me/user-center、API routes` 列为"不动并行 WIP"。本方案即该范围的正式接管文档——**用户中心域（`/me*`、`/favorites`、`/preferences`、`routes/{me,favorites,history,profile,identity,vault,workspaces,ai-config,telemetry}.ts`、用户域 store 表）自此以本方案为事实源**；SEO 侧对 `/me*` 的 noindex 结论（不进 sitemap、页面级 noindex、不改 Disallow）作为本方案红线继承。
2. **与 `.trae` 计划的关系**：`.trae/documents/用户中心第二批改造计划.md` 是本域原始分期计划（未跟踪），"第二批"范围已基本落地；本方案的 S/M 系列是**第三批**（安全授权收口 + 同步引擎 + 数据主权闭环）。建议把该文件迁入 `docs/` 并标注"已由本方案接续"。
3. **与并行会话的边界**：本方案只覆盖用户中心域；市场/SEO/插件域 WIP 不碰。实施 PR 提交前重新取 `git status`，坚持 pathspec 提交（index 中常驻他人暂存物）。
4. **口径变更的公开记录**：S1 会改变"身份可自报"的既有产品口径——该口径曾在 `acceptance-report.md:499-503`、`security-notes.md:59-90`、PASS3 §10.6.1 明示。S1 落地时需同步更新这三处文档，并在发布说明中记录破坏性变更（第三方扩展/MCP 直连需改为持会话或使用 anon 域）。

---

## 附录 A：验证清单（每个 PR 必跑）

```bash
node node_modules/vitest/vitest.mjs run          # 全量（当前 2,670 tests；2,655 passed / 15 skipped）
node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
node node_modules/eslint/bin/eslint.js <改动文件>
# 用户中心专项（21 文件 / 209 条，见 §1.6）
node node_modules/vitest/vitest.mjs run \
  apps/api/test/me-api.test.ts apps/api/test/me-data-api.test.ts \
  apps/api/test/workspaces-api.test.ts apps/api/test/ai-config-api.test.ts \
  apps/api/test/identity-signature.test.ts apps/api/test/end-user-identity-plane.test.ts \
  apps/api/test/identity-plane-extensions.test.ts \
  apps/web/test/favorites-sync.test.ts apps/web/test/favorites-merge.test.ts \
  apps/web/test/favorites-storage.test.ts apps/web/test/favorites-filter.test.ts \
  apps/web/test/favorites-shared-state.test.ts apps/web/test/hub-identity-guard.test.ts \
  apps/web/test/me-pages.test.ts apps/web/test/me-identity.test.ts apps/web/test/me-degrade-states.test.ts \
  apps/web/test/profile-view.test.ts apps/web/test/hub-identity-signature.test.ts \
  packages/store/test/identity-merge.test.ts packages/store/test/user-data.test.ts \
  packages/store/test/workspace-blobs.test.ts
```

## 附录 B：本研究的事实来源

- 前端：`apps/web-overlay/src/app/me/**`、`favorites/**`、`components/user-center/**`、`hooks/useFavorites.ts`、`lib/{hub-proxy,identity-signature,favorites-merge,favorites-storage,vault}.ts`
- 后端：`apps/api/src/routes/{me,favorites,history,profile,identity,vault,workspaces,telemetry,tokens}.ts`、`apps/api/src/profile-service.ts`
- 数据层：`packages/store/src/{schema.ts,driver.ts,migrate.ts,repository/*}`
- 测试：`apps/api/test/*`、`apps/web/test/*`、`packages/store/test/*`（21 个用户中心专项文件，见附录 A）
- 主理人复核：hub 代理转发白名单与签名取值（`hub-proxy.ts:23-35`、`api/hub/[...path]/route.ts:104-108`、`identity-signature.ts:36-50`）、merge 所有权签名（`api/me/route.ts:114-123`、`me.ts:153-165`）
