# NavHub 用户中心升级建议方案

> 版本：v1.0 · 2026-10-22 · 基于对 `apps/web-overlay`（前端）、`apps/api` + `packages/store`（后端与数据层）的只读研究，关键结论已由主理人独立复核代码。
> 研究口径：全部结论带 `文件:行号`；标 ✅ 者为已复核，标 ⚠️ 者为待验证。

---

## 0. 摘要（TL;DR）

用户中心已经是一个**功能闭环完整**的产品域：登录身份（NextAuth → BFF → 中枢）、收藏与文件夹、搜索历史、画像与信号管理、数据导出/注销、工作区名册、个人 AI 配置、E2EE 金库备份，共 30+ 端点、12 张用户域表、8 个专项测试文件。前端 4 个页面（`/me`、`/me/history`、`/me/data`、`/favorites`）+ 1 个偏好页（`/preferences`）全部 noindex，入口收敛在顶栏图标、页脚与页内子导航。

**但它有一个必须先解决的结构性问题**：Web 侧存在**两条互不相通的信任通道**——BFF `/api/me/*`（会话派生身份，可信）与通用代理 `/api/hub/*`（**对客户端自报身份无条件签名**）。后者承载了收藏、历史、画像、金库的**全部读写**，意味着任何登录用户只要把 `anonId` 换成目标身份，就能读写他人数据（主理人已复核：代理转发白名单含 `x-navhub-user-id`/`x-navhub-anon-id`，签名对象就是请求自称值；`/api/me/merge` 的"匿名所有权签名"同样由 BFF 对 body 里的客户端自报值签发）。**签名 ≠ 授权**是整份方案的第一性判断。

除此之外的主要改进空间集中在三类：

1. **降级语义说谎**（会话故障显示"你是匿名"、历史取数失败显示"没有记录"）——与该仓库 `degrade.ts` 反复修复的是同一类错误；
2. **同步引擎原始**（逐条 POST、无版本/墓碑、乐观更新被下一次云端覆盖、多实例状态不联动）；
3. **数据主权不完整**（注销漏 reviews/工作区键、导出漏 events/stars、workspaces 明文落在 E2EE 表、retention 未覆盖用户数据）。

**建议节奏**：短期（1–2 周）先做**安全收口 + 降级语义 + 同步一致性**五件事；中长期（1–2 月）做**同步引擎换代、数据主权闭环、身份模型收口、SSR/性能**。全部建议均给出实施要点、验收标准与硬约束（见 §5）。

---

## 1. 现状梳理

### 1.1 功能全景

| 能力 | 入口 | 实现状态 | 测试 |
|---|---|---|---|
| 身份建立与同步 | 全站 `<SessionSync />`（`app/layout.tsx:179`） | ✅ 可用；`POST /api/me/sync` upsert OAuth 用户 | `me-identity.test.ts`、`identity-signature.test.ts` |
| 概览面板 | `/me` | ✅ 可用；纯客户端三态（loading/anonymous/ready/error）+ 画像 explain | `me-pages.test.ts`（仅源码字符串） |
| 搜索历史 | `/me/history` | ✅ 可用；分页 10/50、单删/全清 | `me-pages.test.ts`（仅字符串） |
| 数据管理 | `/me/data` | ✅ 可用；导出 JSON、注销（`confirm:'DELETE'`） | `me-pages.test.ts`（仅字符串） |
| 收藏 + 文件夹 + 备注 + 筛选 | `/favorites` | ✅ 可用；本地优先 + 云端权威合并 + 三态空态 | 4 个专项测试（最完整） |
| E2EE 金库 | `/favorites`（导出/导入） | ⚠️ 仅本地文件；云端金库端点只被首页 DIY 使用 | `vault-and-prefetch.test.ts`（引擎层） |
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

- 签名算法：HMAC-SHA256，hex，常量时间比较，签名对象是 `identityOf` **截断 64 字符后**的原始值（`identity-signature.ts:24-47`）。
- 硬不变量：任何路由必须 `identityOf` + `identityTrusted` 成对出现，否则签名 hook 覆盖不到（`shared.ts:300-309` 有反例注释）。
- `identityTrusted` 在配置 secret 时**恒真**（`shared.ts:312`）——其正确性完全依赖"没有旁路身份入口"。
- 生产启动仅校验 `identitySecret` 存在且 ≥32 字符（`security-readiness.ts:36-54`）；开发/预发不校验。

### 1.5 同步与离线策略

- **localStorage 契约**（不可改）：`navhub.favorites.v1`、`navhub.anonId`、`navhub.userId`、`navhub.merge.<id>.<anon>`、`navhub_api_token`；损坏数据备份到带时间戳的 `.corrupt.*` 键。
- **同步**：进入 `/favorites` → 逐条 `POST /api/favorites`（**首条失败即 break**）→ `GET` 全量 → **云端成员集合覆盖本地**（`favorites-merge.ts`），`note`/`folderId` 严格取云端（云端 null = 已清除，不可回退）。
- **无版本号/墓碑/批量接口**；唯一带乐观并发控制的是云端金库（409 + ETag），但仅首页 DIY 在用。
- 离线缓存只有收藏；历史/画像/金库无本地缓存。

### 1.6 质量基线

- 用户中心相关测试 8 个文件，**纯函数与源码字符串守卫为主**；`/me`、`/me/history`、`/me/data` 的**行为**（三态切换、删除链路、分页）零测试。
- CI 门禁：`scripts/check-syntax`、`tsc`（5 包）、全量 vitest（当前 2481 passed）、`array-caps`/`sql-in-budget`/`bundle-budget`。
- **PG 侧缺口**：`pg-dialect.e2e.test.ts` 未覆盖 merge / deleteUserData / favorites 并发 / vault 冲突。

---

## 2. 问题与改进空间

### 2.1 P0（安全 / 数据完整性，必须先修）

**P0-1｜通用代理对客户端自称身份无条件签名，`/api/hub/*` 无真实授权**（✅ 主理人复核）
- 位置：`apps/web-overlay/src/lib/hub-proxy.ts:23-35`（转发 `x-navhub-user-id`/`x-navhub-anon-id`）、`app/api/hub/[...path]/route.ts:104-108`（对 `identityFromRequest` 结果签名）、`identity-signature.ts:36-50`（Header 优先取自称值）。
- 影响：任何持有会话的浏览器把 `?anonId=github:victim` 带进 `/api/hub/api/favorites` 即可读写他人收藏；历史、画像、`/api/vault/sync` 同理。canonical id 形如 `github:<id>`，可从插件作者页等公开面推断。
- 同类：**`/api/me/merge` 的匿名所有权签名同样失效**——BFF 对 body 里客户端自报的 `anonId` 直接签名（`api/me/route.ts:114-123`），中枢据此放行（`me.ts:153-165`）。签名只证明"BFF 收到了这个字符串"。

**P0-2｜`/api/users/sync` 的身份绑定靠 username/email 且返回值与后续签名身份不一致**（后端研究）
- `upsertOauthUser` 先按 username、再按 email 命中就 UPDATE 既有行（`users.ts:53-63`）；`users.email` 无唯一索引。
- BFF 之后仍用会话派生的 `<provider>:<id>` 签名，从不使用 sync 返回的 `data.id` → 这些用户的 `/api/me.user` 恒为 null，而 email/avatar 已被改写。

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
- **验收标准**：① 新增端到端测试：登录用户 A 以 `?anonId=<B 的身份>` 请求 `/api/hub/api/favorites`，返回 A 自己的数据或 403，**不得返回 B 的数据**；② 同测试覆盖 history/profile/vault；③ merge 在两个浏览器会话间不可窃取（B 的 anonId 无 cookie 时 403）；④ 既有 `identity-signature` / `end-user-identity-plane` / `me-api` 全绿。
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
9. **PG 测试缺口**：merge/delete/favorites 并发/vault 冲突无 PG 用例；改动这些必须新增（需 `NAVHUB_TEST_DATABASE_URL`）。

### 5.2 依赖项

| 依赖 | 说明 | 阻塞对象 |
|---|---|---|
| `NAVHUB_IDENTITY_SECRET`（生产） | 已强制 ≥32 字符；开发/预发未强制 | S1 的验证需要它打开（否则签名链路不生效） |
| `NAVHUB_TEST_DATABASE_URL`（PG） | 当前 CI 无 PG 实例 | M2/M4 的 PG 用例 |
| 扩展/MCP 客户端 | 它们直连 `/api/hub/*` 用自称身份；S1(b) 会话优先策略会改变它们的行为（无会话 → 仅 anon 域） | S1 发布前需回归 Raycast/Chrome 扩展 |
| 并行会话（市场/SEO 工作） | 共享工作区，提交窗口=对方两次 commit 间隙 | 全部改动 |
| 法务/隐私口径 | 注销范围、retention TTL 的产品承诺 | M2 |

### 5.3 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| S1 身份改动引入登录态回归 | 中 | 高 | 先写 e2e 矩阵（7 端点 × 匿名/持票/签名/会话），再改；灰度：先只对 favorites 生效 |
| M1 同步协议变更导致旧客户端丢数据 | 中 | 高 | 新旧双端点并行一个版本；客户端先升级推送逻辑再切换拉取 |
| M3 workspaces 迁移不可逆 | 低 | 高 | 迁移前 `navhub.db` 备份 + 只读校验脚本；旧键保留一个版本 |
| M4 email 唯一索引迁移失败 | 中 | 中 | 迁移前去重报告（只读），冲突账号列入人工处理清单 |
| 钩子全量测试在共享工作区被他人红灯阻断 | 高 | 低 | 提交前本地跑全量；抓提交窗口（对方 commit 间隙） |
| `/me` SSR 化与 SessionSync 时序冲突 | 中 | 中 | 服务端壳读会话 cookie，SessionSync 只做"变更后刷新" |

---

## 6. 路线图（建议排期）

| 周 | 内容 |
|---|---|
| W1 | S1（先写 e2e 矩阵）+ S2 + S5 |
| W2 | S3 + S4 + S6；M1 设计评审 |
| W3–4 | M1 实现 + 兼容期；M3 迁移脚本 |
| W5–6 | M2 + M4（含 PG 用例） |
| W7–8 | M5 + M6；M7/M8 穿插 |

---

## 附录 A：验证清单（每个 PR 必跑）

```bash
node node_modules/vitest/vitest.mjs run          # 全量（~2480 tests）
node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
node node_modules/eslint/bin/eslint.js <改动文件>
# 用户中心专项
node node_modules/vitest/vitest.mjs run \
  apps/api/test/me-api.test.ts apps/api/test/me-data-api.test.ts \
  apps/api/test/identity-signature.test.ts apps/api/test/end-user-identity-plane.test.ts \
  apps/web/test/favorites-sync.test.ts apps/web/test/favorites-merge.test.ts \
  apps/web/test/favorites-storage.test.ts apps/web/test/favorites-filter.test.ts \
  apps/web/test/me-pages.test.ts packages/store/test/identity-merge.test.ts \
  packages/store/test/user-data.test.ts
```

## 附录 B：本研究的事实来源

- 前端：`apps/web-overlay/src/app/me/**`、`favorites/**`、`components/user-center/**`、`hooks/useFavorites.ts`、`lib/{hub-proxy,identity-signature,favorites-merge,favorites-storage,vault}.ts`
- 后端：`apps/api/src/routes/{me,favorites,history,profile,identity,vault,workspaces,telemetry,tokens}.ts`、`apps/api/src/profile-service.ts`
- 数据层：`packages/store/src/{schema.ts,driver.ts,migrate.ts,repository/*}`
- 测试：`apps/api/test/*`、`apps/web/test/*`、`packages/store/test/*`（8 个用户中心专项文件）
- 主理人复核：hub 代理转发白名单与签名取值（`hub-proxy.ts:23-35`、`api/hub/[...path]/route.ts:104-108`、`identity-signature.ts:36-50`）、merge 所有权签名（`api/me/route.ts:114-123`、`me.ts:153-165`）
