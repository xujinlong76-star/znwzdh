# NavHub 用户中心升级建议方案（第四批）

> 版本：v2.1 · 2026-10-24 · 基于 `apps/web-overlay`（前端）、`apps/api` + `packages/store`（后端与数据层）、`packages/{core,mcp}`、`extensions/` 的只读研究。
> 前置文档：`docs/USER-CENTER-UPGRADE-PLAN-2026-10-22.md`（第三批，S1–S6 + M1–M11 已全部落地）。
> 研究口径：v2.0 为第一轮（工程与治理维度），v2.1 增补第二轮（产品能力、AI/个性化、跨端令牌、内容类型覆盖、实时/离线/可观测/缓存五维）。关键结论带 `文件:行号`；标 ✅ 者为主线亲自复核。

---

## 实施进度（2026-10-24 11:00 更新，第四批实施会话）

| 项 | 状态 | 要点 |
|---|---|---|
| T1 前端取数收敛 | ✅ 已落地 | Overview 下沉 lib/me-types；useMeOverview 支持 initialOverview 注入（me-view 不再自带状态机）；Save-then-Verify 抽 lib/me-settings-save；AnonymousHint/Inline 统一 4 处匿名提示；`?anonId=` query 全量下线（navhub-api 27 处 + preferences 2 处，全部只走 header）；identity 事件重取加 inflight 去重；history 匿名身份透明提示 |
| T2 导入导出对称化 | ✅ 已落地 | 导出加 schemaVersion=1 + favoritesTruncated（截断上限 20000 与导入同源）；导入支持 pluginStars/pluginReviews 重放（星标幂等守恒、评价遵守已安装门禁、四类跳过分开计数）；超新版本备份 400 点名版本；续导 sessionStorage 化（刷新不丢）；浏览器书签 Netscape HTML 导入（客户端解析入本机收藏，解析器+按钮均按需加载） |
| T3 账号能力 | ⚠️ 部分落地 | 邮箱绑定/解绑（PATCH /api/me/profile 扩展 email + 唯一性 409 + account 页表单）✅；头像 onError 回落字母头像 + no-referrer + lazy ✅；**改密不适用**：凭证通道是 env 管理员口令 + 静态 token（无用户级密码存储），需净新增凭证子系统——转 T8 会话治理评审 |
| T4 历史批量清理 | ✅ 已落地 | POST /api/search-history/batch-delete（ids≤200 / filter=zero_results 服务端筛选，归属过滤）；前端串行循环改单请求 |
| T5 SectionState + a11y | ✅ 已落地 | me-view / me-settings-view 接入统一组件（error 视觉统一 amber，守卫测试扩到 6 页 + favorites 有意例外清单）；history 筛选 aria-pressed；recent-activity 语义化列表 + `<time>`；stats-grid 末项跨列；子导航滚动渐隐暗示；hint aria-hidden；quarantine aria-expanded + 展开内容 live 通告 |
| T6 工程卫生 | ✅ 已落地 | theme-provider 判定**非缺陷**（上游底座文件，overlay 只承载自研层，反向候选告警属设计）；删除空目录 app/api/me/[...path] 与 apps/brain；/me 外壳与隔离区/书签导入/续导横幅 dynamic 化；/me/data 棘轮 +874B 重定（893802，重部件已全部按需加载） |
| T7 身份收口 | ✅ 已落地 | username 兜底收紧：带规范 id 的调用只可认领未绑定行（拦截改名抢注冒领），无 id 旧式调用保持历史行为（不构成新风险面）；IDENTITY_SECRET 生产拒绝启动**核实为已实现**（authRequired 路径 + 公网强制开鉴权）；TOFU 维持后置 |
| T15 收藏正确性 | ✅ 已落地 | note 三层截断（输入框 maxLength / 本地写入与建 op 截断 / 服务端逐条截断回传 truncatedNotes，结构上限 2000 仍整批 400）；created 排序显式时间戳比较（导入后顺序可信）；夹计数 O(n) memo；B7 站点校验**判定不做**：跳过 add 会破坏 href 兜底回环（全量合并会抹掉本地条目），孤儿行改由 user_data_audit 巡检上报 |
| T16 已建成接线 | ✅ 已落地 | 收藏夹上移/下移（PATCH sort 首次接线，乐观更新+失败回滚）；夹创建 sort 追加式（不再恒 0）；云端建夹同名去重；note 纳入前端筛选（与服务端 q 语义对齐）；书签 HTML 导出入口（登录态）；删夹批量置空（一次持久化，替代 N 次全量序列化） |
| T17 favoriteSiteIds | ✅ 已落地（方案 a） | 注入 personal 通道（fusion 消费，收藏 +0.3 档位高于 visited +0.2 低于类目命中）；preferences 页承诺兑现 |
| T18 协商缓存 | ✅ 已落地 | GET /api/me 声明 maxAge:0+etag（框架 304）；BFF 透传 if-none-match / etag / 304，etag 响应以 private,no-cache 取代 no-store，其余维持 no-store 安全默认 |
| T19 可观测接线 | ✅ 已落地 | favoritesSync.sharded（满批 500 触发）与 failureRetryable（仓储瞬时故障）接线；同步失败落审计 user.sync_failed；admin/stats 新增用户中心链路卡（消费此前无人用的指标端点）；dashboardOverview 新增 userCenter 块（DAU/7 日/收藏分布 P50/P95） |
| T11 保留期自动化 | ✅ 已落地 | data_retention 任务执行**用户显式设置**的 historyRetentionDays（逐用户删除 + 审计），默认 180 天口径不变（仍 CLI/dry-run） |
| T24 巡检+离线 | ✅ 已落地 | user_data_audit 每日任务（孤儿夹引用/站点缺失收藏，只报不动）；SW SHELL + /me（v5）；搜索历史离线快照（首页 ≤20 条，快照态明确标注且禁写操作） |
| T8 会话治理 | ✅ 已落地 v1 | sessions 死表激活（+user_agent/revoked_at/last_seen_at 三方言登记）；sid=JWT 随机 sid 的 sha256（原文不出 Web 服务端）；BFF 每次 /api/me/* 一次往返「登记活跃 + 核对吊销」（fail-open：核对故障不阻断）；设备列表/踢出（/api/me/sessions + DELETE :id，跨用户 404）+ account 页设备面板（当前设备标记、两步确认）；注销清单 +sessions 原有覆盖不变；**改密/凭证子系统维持评审结论**：现行凭证通道是 env 管理员口令 + 静态 token（users.password_hash 空），per-user 密码需身份映射重构 → v2 |
| T13 通知中心 v1 | ✅ 已落地 | notifications 表（三方言 + 身份索引）；触发源两个且各自降噪：收藏同步失败（60 分钟去重，随 T19 failureRetryable 路径）、备份超期（user_data_audit 每日扫描：有收藏且 30 天无 user.export → 提醒，7 天去重，首批 500 身份）；GET /api/me/notifications（含 unread/分页/unread=1）+ 单条已读 + 全部已读；/me/notifications 页 + 导航项；注销清 notifications |
| T20 用户级 API 令牌 | ✅ 已落地 v1（只读） | api_tokens.owner_identity 列（三方言 + 索引）；AuthIdentity.ownerIdentity；开放/鉴权两种模式都挂 owner；requestIdentityOf（owner 优先，自称头不可覆盖真实凭据）替换用户域四文件全部取数；userDomainWriteAllowed 守卫（个人令牌 v1 只发 read，写自己数据需 write scope → 403）；/api/me/tokens 自服务（创建明文一次/列表/吊销，上限 10 条，匿名 403）；account 页 ApiTokensPanel（一次性明文展示+复制）；MCP HTTP 查同表自动继承；注销清 owner 令牌；**跨用户隔离/越权/只读守卫/吊销失效有端到端测试** |

| T21 Copilot 上下文 + 用量可见 | ✅ 已落地 | GET /api/me/llm-usage（24h 滚动窗口用量 + 档位上限）；preferences 页 LlmUsageCard（80% 预警、上限 0=无上限如实展示）；Copilot systemPrompt 注入个人上下文（画像摘要 + 收藏夹结构 + 受 searchHistoryEnabled 开关控制的最近搜索，身份与取密钥同源）；personal 徽标 title 解释（palette + spotlight 两处） |
| T23 访问历史页 | ✅ 已落地（访问部分） | GET /api/me/visits（events kind=click 按身份分页 + 站点 join，他人的/搜索事件不出现）；/me/history 双 tab（搜索/访问），访问 tab 独立四态 + 清空入口（复用 DELETE /api/profile/signals/click）+ 加载更多；收藏多选批量操作未做（1202 行页面的 UI 大改，随 T14 拆分一并） |
| T10 设置冲突 | ✅ 已收口（口径修正） | **核实：服务端 updateUserSettings 本就是 partial patch 逐字段合并**（patch.X ?? current.X）——不同设备改不同字段互不覆盖，研究阶段「全量覆盖互覆盖」为误报；无需 version 列改造，新增 settings-merge.test.ts 钉住语义（含布尔显式 false 不丢）防未来改坏 |
| T22 收藏标签系统 v1 | ✅ 已落地 | favorites.tags 列（三方言 + ALTER）；normalizeFavoriteTags 契约（≤8 个、各 ≤24 字符、trim/去重，坏数据收敛 null）；同步协议 tags（add 全量覆盖 / update 显式传入才写 / null=清除，LWW 有专项测试）；favorites POST/PATCH + /api/me/favorites/sync + 备份导入 + 书签 HTML TAGS 属性全链路；前端 LocalFavorite.tags + ops/delta/merge/导入归一；卡片标签 chips（点击即筛选）+ 行内编辑器（逗号分隔）；检索 haystack 纳入标签 |
| T14 收藏页拆分（第一刀） | ✅ 已落地 | 夹管理 CRUD/重排/本地夹上云迁移（约 120 行 + 4 个状态）抽到 hooks/use-favorites-folder-manager，页面只留渲染与卡片级操作；守卫更新为联合文本；页面 1250 → 1230 行，后续拆分（卡片/同步横幅）沿同一模式 |
| T12 登录态 E2E | ✅ 已落地 | e2e/user-center-authed.spec.ts 4 用例全过（本地实跑）：登录复用 admin-token 验证过的旁路路径；/me ready 态（匿名文案不得出现）；账号页设备/令牌面板挂载；令牌创建→明文一次性展示→吊销端到端；通知页渲染 |
| T9 PG 用户域用例 | ✅ 已落地（本地 skip，CI test-postgres 跑） | pg-dialect.e2e 新增四组：mergeIdentity 迁移+别名解析+注销覆盖、addFavorite 幂等双写、saveUserVault 版本 CAS（409 语义）、user_settings per-field 合并；签名核对过仓储真实方法 |
| T20/T21/T22/T23 | ⏳ 未实施 | 用户级令牌（六层改造）、Copilot 上下文、标签系统、浏览历史页——见 §3.4 |

> 验证口径（2026-10-24 终检·第二批后）：**全量 339 套件 / 0 失败 / 1 skipped**（vitest run 退出码 0）；tsc 0 错误；eslint 0 errors；**bundle 预算全部路由在棘轮内**；next build 退出码 0；镜像 622 文件一致。实施期间被仓库守卫拦下并修正的问题：URL 卫生（visits 裸 href → safeHref）、剪贴板诚实（令牌面板 navigator.clipboard → copyText）、路由标题（/me/notifications 补 layout metadata）、Edge runtime（auth.ts 顶层 node:crypto → 全局 crypto.randomUUID）。

## 0. 摘要（TL;DR）

第三批（v1 方案）收口了**安全授权、降级语义、同步引擎、数据主权、身份模型、SSR/移动端**六条主线。第一轮研究（v2.0）发现第四批该做的是**对称性与完整度**：导入导出不对称、账号能力缺口（改密/邮箱/设备管理）、前端五处重复状态机、`?anonId=` query 残留、per-IP 限流、PG 测试空白。

第二轮研究（v2.1）把视野从"工程正确"扩展到"产品能力与跨端"，五个新维度各有一个核心结论：

1. **收藏产品能力**："已建成未接通"与隐性缺陷并存——服务端检索/分页/排序端点（`routes/favorites.ts:54-81`）与收藏夹 sort 重排（`routes/favorites.ts:188-191`）已建成但前端零调用；**一个正确性缺陷**：备注超 200 字会让整批收藏同步 400 且重试永久卡死（✅ `me.ts:740` 整批 zod 拒绝 + 前端 Input 无 maxLength）；无标签、无批量操作、无书签导入。
2. **AI/个性化**：画像管线与配额模型扎实，但**一处口径失真**——`favoriteSiteIds` 采集了却从未注入个性化通道（✅ 全仓仅 `navhub-api.ts:800` 类型定义出现），preferences 页"收藏参与重排"文案与实际不符；Copilot 不消费任何用户数据、会话不持久；LLM 用量用户侧不可见。
3. **跨端与令牌**：Chrome/Raycast 扩展与 MCP（37 个工具）对个人数据面**零能力**（不能读写收藏/历史）；根因是令牌体系只有实例级（read/write/admin）无用户级——`api_tokens` 无 owner 列，`navhub_api_token` 是手工粘贴的管理员凭据且 UI 入口已消失。
4. **内容类型覆盖**：用户中心个人数据面完全围绕 sites+搜索+插件；视频无任何用户动作（无表无事件无按钮）、合集只能收藏"合集内的站点"而非合集本身、标签/分类无关注；服务端有 click 流水（events 表带 identity）但用户中心没有"我看过的站点"列表页。
5. **实时/离线/可观测/缓存**：SSE 基建完备但用户域零推送（收藏同步只在进收藏页时触发）；搜索历史/画像离线不可用；`failureRetryable`/`sharded` 指标定义了从未发射（✅）、指标端点无前端消费、无 DAU/留存运营视图；`GET /api/me` 等三个用户域 GET 全 no-store 且 BFF 主动剥离 etag（✅）——而声明式 ETag 框架是现成的。

**建议节奏**：短期在 v2.0 的 T1–T7 基础上追加 T15–T19（收藏正确性三修、已建成能力接线、favoriteSiteIds 口径拍板、HTTP 缓存接入、可观测接线）；中期追加 T20–T24（用户级 API 令牌、Copilot 个人上下文、收藏标签系统、浏览历史页、用户数据巡检 job）。加上 v2.0 共 24 项建议 + 评审项。

---

## 1. 现状盘点（第四批基线）

### 1.1 信息架构与完成度

| 页面 | 形态 | 完成度 | 残留 |
|---|---|---|---|
| `/me` 概览 | 服务端壳（`force-dynamic`）+ 客户端岛四态 | ✅ 高 | 取数逻辑与 hook 重复（T1）；error 视觉与 SectionState 不统一（T5） |
| `/me/account` | 纯客户端 | ✅ 高 | 无改密/邮箱/设备管理（T3/T8）；头像无 onError（T3） |
| `/me/data` | 纯客户端 689 行 | ✅ 高 | 导入只收 4 类（T2）；续导靠内存（T2） |
| `/me/history` | 纯客户端 | ✅ 中 | 零结果清理串行逐条 DELETE（T4）；无 anonymous 态（T1）；筛选无 aria-pressed（T5） |
| `/me/plugins` | 纯客户端只读 | ✅ 高 | 管理动作全外跳，可接受 |
| `/me/settings` | 纯客户端 | ✅ 高 | 手写骨架/error（T5）；多端 LWW 互覆盖（T10） |
| `/favorites` | 纯客户端 1202 行 | ✅ 高 | 巨型组件（T14）；产品能力缺口见 §2.7（T15/T16/T22） |
| `/preferences` | 纯客户端 | ✅ 高 | 取数状态机另一套写法（T1）；favoriteSiteIds 口径失真（T17） |

### 1.2 后端能力基线

- **主路由**（`apps/api/src/routes/me.ts`）：概览/设置/资料/诊断自愈/插件聚合/导出/导入/五域清理/操作记录/收藏增量同步/书签 HTML 导出/注销/匿名合并，全部带路由级限流。
- **同步引擎**：收藏批量 ops + since 游标 + 墓碑 LWW、金库版本 CAS（409 + ETag）、CRDT 操作日志合流。
- **数据主权**：导出 15 类（脱敏 LLM 密钥、不导密文），注销单事务清 18 类，导入幂等合并 + 诚实申报。
- **身份信任**：hub 代理会话优先裁决、merge 匿名绑定 cookie、HMAC 签名第二轴。

### 1.3 质量基线

- 全量 2600+ 用例（含 `me-data-api.test.ts` 440 行专项）；E2E 13 例覆盖 `/me` 族**匿名 + 降级态**，**登录态旅程零 E2E**。
- SectionState 统一组件已接入 4 页；`/favorites` 有 bundle 专属棘轮（965,632 B），`/me*` 落 default。

### 1.4 第二轮研究新增的事实基线（速览）

| 维度 | 一句话结论 |
|---|---|
| 收藏 | 服务端有 `q/folderId/sort/limit/offset` 分页检索（`repository/favorites.ts:81-126`），web 客户端从未传参；夹 sort 恒 0 |
| AI | LLM 配额 identity 300 次/150 万 token 每 24h 滚动窗口；Copilot 上下文=15 分类+25 站点，无用户数据 |
| 跨端 | Chrome 扩展=搜索+收录；Raycast=搜索+插件；MCP=37 工具零用户域；均不能读写收藏/历史 |
| 内容 | events 只覆盖 sites+plugins 两类内容实体；视频/合集/标签的用户动作从采集端就不存在 |
| 基建 | SSE 三个调用方全在运维域；`/api/me` 三 GET 无协商缓存；jobs 10 类任务无用户域 |

---

## 2. 问题清单（第四批候选）

### 2.1 数据主权残留（第一轮）

| 编号 | 问题 | 位置 |
|---|---|---|
| D1 | **导出/导入往返不对称**：导出 15 类，导入 schema 只收 4 类（favoriteFolders/favorites/searchHistory/settings）——插件星标、评价、工作区等五类导出了恢复不回来 | ✅ `me.ts:431-476` vs `user-data.ts:54-87` |
| D2 | 收藏导入上限 20000 条而导出侧 `listFavorites` 无 LIMIT——超两万的合法备份整份 400 | `me.ts:445` vs `favorites.ts:52-58` |
| D3 | 导出 JSON 无 `schemaVersion` | `user-data.ts:105-190` |
| D4 | 导入续导依赖内存 `lastBackupRef`，刷新即丢 | `data/page.tsx:122` |
| D5 | `historyRetentionDays` 只在手动诊断时生效；全局任务固定 180 天 dry-run | `me.ts:247-267`、`retention.ts:211-216` |
| D6 | 书签 Netscape HTML 只出不进 | `me.ts:772` |

### 2.2 账号能力缺口（第一轮）

| 编号 | 问题 | 位置 |
|---|---|---|
| A1 | 无密码修改入口 | `account-view.tsx:53-58` |
| A2 | 无邮箱绑定/验证 | `account-view.tsx:186` |
| A3 | 无会话/设备管理；`sessions` 死表；GitHub token 进程内 Map 重启即失 | `schema.ts:185`、`auth.ts:26` |
| A4 | 头像裸 `<img>` 渲染用户 URL，无 onError/referrerPolicy | `dashboard/account-card.tsx:61-64` |
| A5 | 无通知中心（全仓 `notification` 零命中） | — |

### 2.3 前端工程收敛（第一轮）

| 编号 | 问题 | 位置 |
|---|---|---|
| F1 | 取数状态机五处实现；me-view 与 hook 逐行重复且 hook 反向 import 页面类型 | ✅ `me-view.tsx:133-178` vs `use-me-overview.ts:27-62` |
| F2 | Save-then-Verify 两份 | `me-view.tsx:219-266` vs `use-me-settings.ts:89-133` |
| F3 | `Overview` 类型定义在页面模块被反向 import | `me-view.tsx:50-71` |
| F4 | 匿名提示区 4+ 处重复手写 | `account-view.tsx:136-151` 等 |
| F5 | SectionState 采用率 4/7；error 视觉三套 | `section-state.tsx:66`、`me-view.tsx:318-352` |
| F6 | /me 页面绕过统一错误封装裸 fetch | `me-view.tsx:157,201,227` 等 |
| F7 | `?anonId=` query 未下线（文件头自注释泄漏风险） | ✅ `navhub-api.ts:274,351,559…` |
| F8 | me-view identity 事件回调无去重可能连发请求 | `me-view.tsx:189-191` |
| F9 | history 状态机无 anonymous 态 | `history/page.tsx` |

### 2.4 体验与无障碍（第一轮）

U1 零结果清理串行 DELETE（`history/page.tsx:147-170`）；U2 history 筛选无 aria-pressed（`:280-289`）；U3 quarantine 展开无焦点管理；U4 recent-activity 零语义标签；U5 子导航无滚动暗示；U6 stats-grid 落单；U7 链接 hint 读屏噪声。

### 2.5 服务端治理（第一轮）

G1 限流 per-IP 共享出口误伤、无配额；G2 审计尽力而为；G3 身份链路残余（IDENTITY_SECRET 退化路径、username 兜底绑定、TOFU）；G4 PG 用户域测试空白；G5 偏好多端 LWW 互覆盖（`user-settings.ts:268-272`）。

### 2.6 工程卫生（第一轮）

H1 overlay 缺 `theme-provider.tsx`（✅）；H2 空目录 `app/api/me/[...path]/`；H3 /me 零 dynamic import；H4 favorites 页 1202 行；H5 类型契约无共享；H6 登录态 E2E 缺位；**H7（第二轮新增）`apps/brain/` 是空目录**——不被 git 跟踪、不在 workspace 清单、全仓零引用，疑似误建占位，应删除。

### 2.7 收藏产品能力（第二轮）

| 编号 | 问题 | 位置 |
|---|---|---|
| B1 | **超长备注阻断整批同步（正确性缺陷）**：服务端三处 zod 限 note ≤200，前端 Input 无 maxLength——本地可存任意长，单条超 200 的脏 op 让整批 sync 400，且客户端重试反复撞同一错误，**同步链路永久卡死** | ✅ `me.ts:740`、`favorites.ts:25,134`、✅ `favorites/page.tsx:1108-1115`（无 maxLength） |
| B2 | 前端筛选不含 note（用户写的备注搜不到），服务端 `q` 含 note——前后端检索语义不一致 | `favorites-filter.ts:36` vs `repository/favorites.ts:81-126` |
| B3 | "最近收藏"排序依赖隐式约定（toggle unshift + 服务端 DESC），明文/金库导入后顺序不可信 | `page.tsx:144-146`、`useFavorites.ts:288-291` |
| B4 | 服务端检索/分页/排序端点已建成无消费者（`q/folderId/sort/limit/offset` + total/hasMore） | ✅ `routes/favorites.ts:66`、`repository/favorites.ts:81-126` |
| B5 | 收藏夹 sort 列恒 0；PATCH 支持 sort 但前端从未传——"夹拖拽重排"服务端已建成前端未接线 | `repository/favorites.ts:287-288`、`routes/favorites.ts:188-191` |
| B6 | 删夹后前端对夹内每条收藏逐条 PATCH（N+1 冗余——云端删夹事务已置空 folder_id） | `page.tsx:337-339`、`repository/favorites.ts:295-305` |
| B7 | 两条写路径约束不一致：逐条 POST 校验站点存在（404），批量 `applyFavoriteOps` 盲插不校验——批量通道可写入孤儿行，靠前端"装看不见" | ✅ `routes/favorites.ts:93-94` vs ✅ `repository/favorites.ts:216-234` |
| B8 | 云端可建重名夹（无 UNIQUE(user_id,name)，repo 不查重）；仅前端本地拒绝重名 | `schema.ts:329-335`、`repository/favorites.ts:283-293` |
| B9 | 夹计数 O(条数×夹数) 渲染时 filter，`countByFolder` 工具闲置 | `page.tsx:859` vs `favorites-folders.ts:126-136` |
| B10 | 无标签、无多选批量操作、无拖拽排序（收藏条目无 position 列）、无重复检测、无死链检查、无浏览器书签导入（HTML 只出不进）、卡片不显示 URL/域名 | `schema.ts:315-335`；导出插件把 note 当 tag 用（`page.tsx:1192`） |
| B11 | 移动端触控目标远低于 44px（夹操作 h-6、卡片操作 h-7、字号 11px） | `page.tsx:895-915,1097-1142` |

### 2.8 AI 与个性化（第二轮）

| 编号 | 问题 | 位置 |
|---|---|---|
| I1 | **favoriteSiteIds 口径失真**：画像采集了收藏站点清单（`profile.ts`、`profile-service.ts:74-77`），但搜索注入时未传（`search.ts:95-99` 只传 topCategories/topTags/visitedSiteIds），fusion 也不消费——preferences 页"收藏站点参与重排"文案与实际行为不符；收藏只通过 favorite 事件 ×2 权重间接影响画像 | ✅ 全仓仅 `navhub-api.ts:800` 类型定义出现 |
| I2 | Copilot 上下文不含任何用户数据（无收藏/历史/画像）；会话不持久（React state，关抽屉即丢），无历史管理 | `copilot.ts:79-105,122`、`ai-copilot-drawer.tsx:84` |
| I3 | LLM 用量用户侧不可见——三档配额（identity 300 次/24h、150 万 token）只在 429 时暴露，无"今天还剩多少"常态视图；`sumLlmUsage({identity})` 现成 | `config.ts:491-496`、`repository/llm-usage.ts:267-299` |
| I4 | 每身份仅一套 LLM 配置（identity 主键单行），无按场景切换（copilot/画布/插件共用一套）；备用模型池仅系统级 | `repository/llm-config.ts:52-58`、`llm-config.ts:76-77` |
| I5 | 画像不可编辑：手工置顶/剔除类目标签会被下次行为刷新冲掉（需持久标记机制）；个性化开关无按分类粒度 | `repository/profiles.ts:37-59`、`profile-service.ts` |
| I6 | 个性化透明度只到通道徽标级（"个性化"），未展开"因为你近 30 天常点击 X 分类"——`hit.contributions` 数据已存在 | `fusion.ts:66-72`、`spotlight-modal.tsx:111` |

### 2.9 跨端客户端与令牌（第二轮）

| 编号 | 问题 | 位置 |
|---|---|---|
| K1 | 扩展与 MCP 对个人数据面零能力：Chrome 扩展只有搜索+收录+插件浏览（无任何收藏/历史调用）；Raycast 同；MCP 37 个工具无 favorites/search-history/profile/vault 工具 | `extensions/chrome-extension/popup.js`、`packages/core/src/mcp-schemas.ts:530-716` |
| K2 | **令牌体系无用户级维度**：`api_tokens` 无 owner 列、scope 是全局三级（read/write/admin）与数据归属正交、tokens 管理 6 条路由全 admin——用户无法持有"只能动自己数据"的 token | `schema.ts:209-225`、`auth.ts:75-80`、`routes/tokens.ts:87-223` |
| K3 | `navhub_api_token` 是手工粘贴的管理员凭据：填入 UI 入口已消失（全仓无 `setApiToken` 调用方）、localStorage 永不过期、不随登出清理、与扩展侧同名词法互不同步 | `navhub-api.ts:243-269` |
| K4 | MCP 仅有的用户域触达是 CRDT 工具以自报 `crdt:<userId>` 写 `user_vault_sync` 表 | `packages/mcp/src/handlers/state-sync.ts:15-56` |

### 2.10 内容类型覆盖面（第二轮）

| 编号 | 问题 | 位置 |
|---|---|---|
| C1 | 视频零用户面：无表、无事件 kind、无点赞/收藏/历史/进度按钮（schema 与 telemetry 白名单均无 video） | `storage.ts:23,452-457`、`telemetry.ts:26-30`、`video-card.tsx:41-48` |
| C2 | 合集无合集级收藏/订阅——只能收藏"合集内的站点"（FavoriteButton 传 site.id）；合集 API 纯只读 | `collection-detail-view.tsx:230-238`、`routes/collections.ts:15-22` |
| C3 | 标签/分类无关注机制；首页"置顶到工作台"是纯本地不落服务端 | `tags/[slug]/page.tsx`、`navigation-card.tsx:17` |
| C4 | **服务端有浏览历史但未暴露**：events 表 kind=click 带 identity 列就是按身份的访问历史，用户中心只有画像摘要（visitedSiteIds 50 个）与计数，无"我看过的站点"列表页 | `schema.ts:227-242`、`repository/events.ts:9-21` |
| C5 | /me 概览 7 项计数全部围绕 sites+搜索+插件；画像聚合窗口 30 天、7 天半衰期、收藏权重 ×2（机制扎实，是 C4/I 系列升级的现成地基） | `identity.ts:434-503`、`profile.ts:39-93` |

### 2.11 实时 / 离线 / 可观测 / HTTP 缓存（第二轮）

| 编号 | 问题 | 位置 |
|---|---|---|
| R1 | SSE 基建完备（`setupSseStream` + jobEventBus 模板）但三个调用方全在运维域；用户域零推送，收藏同步只在进收藏页/手动重试时触发 | `shared.ts:203-212`、`jobs.ts:184,225`、`stats.ts:100` |
| R2 | 搜索历史/画像离线不可用（收藏/设置离线可读写——user-settings 的"本地镜像 + Save-then-Verify"模式可复制）；SW SHELL 不含 `/me` | `navhub-api.ts:731,757`、`sw.js:21-29` |
| R3 | `favoritesSync.failureRetryable`/`sharded` 指标定义了从未发射；`/api/admin/user-center/metrics` 端点无前端消费；测试不测"接线"（测不出忘了 record 的回归） | ✅ `user-center-metrics.ts:56-63`（仅定义）、`stats.ts:93-97` |
| R4 | 无用户域运营视图：dashboardOverview 无 DAU/MAU、留存、收藏量分布、历史写入量；sync 成败不落持久存储（进程内计数重启清零，audit 不记 sync） | `repository/dashboard.ts:8-100` |
| R5 | `GET /api/me`、`GET /api/favorites`、`GET /api/search-history` 全 no-store 无协商缓存；**BFF 强制覆盖 `cache-control: no-store` 且只透传 3 个头——中枢将来加 ETag 也会被剥掉**；声明式 ETag 框架现成（公开端点十余处在用） | ✅ `route.ts:191-209`、`server.ts:300-347` |
| R6 | jobs 10 类任务无用户域；孤儿收藏引用/超期历史的检测 SQL 已写好（在 diagnostics）但没有定时巡检任务跑全库 | `jobs.ts:64-66,109-120`、`me.ts:216-275` |

---

## 3. 升级建议（第四批）

### 3.1 短期·第一批（S 系列，1–2 周）

#### T1【P1｜高】前端取数与状态机收敛：一处一义
1. `me-view` 的 `load()` 改用 `useMeOverview`（hook 加 `initialOverview` 入参）；2. `Overview` 类型下沉 `lib/me-types.ts`；3. `togglePersonalization` 改调 `use-me-settings.patch`；4. 抽 `<AnonymousHint />`；5. BFF 裸 fetch 收敛为 `lib/me-api.ts` 薄封装；6. identity 事件回调加 inflight 去重；7. **`?anonId=` query 下线**（全改 header，服务端兼容读取一个版本）；8. history 补 anonymous 态。
**验收**：`?anonId=` 在 `lib/` grep 归零（注释除外）；守卫测试全绿。**风险**：低。

#### T2【P1｜高】导入/导出对称化 + 备份格式版本化
1. 导入补 `pluginStars`（重放 star、守恒计数）与 `pluginReviews`（唯一键 upsert）；`workspaces`/`crdt` 列入评审；2. 收藏导入上限与导出侧对齐（同 EXPORT_HISTORY_LIMIT 修法）；3. 导出加 `schemaVersion: 1`，未知大版本给明确文案；4. 续导暂存 sessionStorage；5. 书签 HTML 导入（Netscape 解析 → 诚实申报框架）。
**验收**：round-trip 测试；超上限备份不整份 400。**风险**：中。

#### T3【P1｜高】账号基础能力：改密 + 邮箱绑定 + 头像健壮化
1. `PATCH /api/me/password`（OAuth-only 用户 409 提示）；2. `POST /api/me/email`（无 SMTP 降级"已绑定未验证"明示）；3. 头像 onError 兜底 + no-referrer + lazy。
**风险**：低。

#### T4【P1｜中】历史批量清理 API
`POST /api/search-history/batch-delete`（ids[] ≤200 或 `filter:"zero_results"`），前端串行 for 改单请求。

#### T5【P2｜中】SectionState 7/7 + 无障碍/移动端收尾
me-view/me-settings/favorites 三处手写状态改接 SectionState（error 视觉统一）；history 筛选 radiogroup；quarantine 焦点管理；recent-activity 语义化；子导航滚动暗示；stats-grid 消落单；hint aria-hidden。

#### T6【P1｜中】工程卫生
1. 排查 `theme-provider.tsx` 镜像缺口（同步脚本清单为何漏）；2. 删空目录 `app/api/me/[...path]/`；3. `/me` 非首屏区块 dynamic 拆分 + bundle-budget 补 `/me` 棘轮（只降不升）；4. **删除 `apps/brain/` 空目录**（H7）。

#### T7【P0｜高】身份链路残余风险决策（拍板项）
1. username 兜底绑定收紧或取消（自托管场景保留需文档明示）；2. `NAVHUB_IDENTITY_SECRET` 未配时生产拒绝启动（参照 AUTH_SECRET 先例）；3. TOFU 维持 M1 后置。

### 3.2 中期·第一批（3–8 周）

T8 会话治理（激活 sessions 表 + 设备管理 + 踢出）；T9 PG 用户域测试 + per-identity 限流与存储配额；T10 偏好多端冲突解决（version + If-Match，复用金库 CAS 先例）；T11 保留期自动化（data_retention 读用户设置）；T12 登录态 E2E 矩阵（seed 账号 + storageState）；T13 通知中心（触发源：同步失败/备份超期/审核状态，评审后立项）；T14 代码组织长线（收藏页拆分、契约入 core zod、SSE 评审）。

### 3.3 第二批建议·短期（T15–T19，快赢：修缺陷 + 接线 + 透明度）

#### T15【P1｜高】收藏正确性三修（含一个同步链路卡死缺陷）
- **实施要点**：
  1. **B1 超长备注**：前端 note Input 加 `maxLength={200}` + 计数提示；服务端 sync 端点把"整批 zod 拒绝"改为 **per-op 容错**——单条 note 超长的 op 跳过并计入响应 `skippedInvalid`（沿用诚实申报框架），不再让一条脏数据卡死整批同步；
  2. **B3 排序可信**：`created` 排序从"沿用数组现状"改为显式 `created_at` 时间戳比较（导入/金库恢复后顺序不再依赖隐式约定）；
  3. **B7 孤儿行**：`applyFavoriteOps` 的 add 分支加站点存在性校验（与逐条 POST 对齐；不存在计入 `skippedMissingSite`），存量孤儿行由 T24 巡检任务报出；
  4. 顺手：B9 夹计数用 `countByFolder` 替代渲染期 O(条×夹) filter。
- **验收**：`me-favorites-sync.test.ts` 补"单条超长 note 不阻断批次，其余 ops 落库且 skippedInvalid=1"；"add 不存在站点计入跳过"；前端行为测试 maxLength 生效。
- **风险**：低。zod 从严格拒改为结构化申报，需同步更新既有测试期望（硬约束 10）。

#### T16【P2｜中】"已建成未接通"接线包（零 schema 变更的产品增量）
- **实施要点**：
  1. **收藏夹拖拽重排**：前端建夹/重排时传 `sort`（PATCH 端点已支持，`routes/favorites.ts:188-191`），夹列表按 sort 渲染；HTML5 drag 或上移/下移按钮起步；
  2. **前端筛选纳入 note**（`favorites-filter.ts` haystack 加 note，与服务端 q 语义对齐）；
  3. **书签 HTML 导出入口**暴露到收藏页导出菜单（端点现成 `me.ts:772`，收藏页只有 JSON/金库/插件三种）；
  4. **B6 删夹去 N+1**：删夹后本地直接置空 folder_id，不再逐条 PATCH（云端事务已做同语义）；
  5. B8 云端建夹查重（repo 层先查同名再插，或迁移加 UNIQUE——走硬约束 5 三处登记）。
- **验收**：拖拽后刷新顺序保持；收藏页导出菜单四项；行为测试覆盖 note 命中。
- **风险**：低。

#### T17【P1｜高】favoriteSiteIds 口径拍板（诚实申报纪律在个性化维度的延伸）
- **实施要点**：二选一拍板——
  - **方案 a（推荐）**：把 favoriteSiteIds 注入 personal 通道（`search.ts:95-99` 补传 + `fusion.ts` 的 `personalCandidates` 消费，加"收藏过的站点 +0.3"打分项，与既有 visited +0.2 拉开档位），文案不变、行为兑现承诺；
  - **方案 b**：不注入，改 preferences 页与画像 explain 文案（"收藏通过行为权重间接影响"），并从画像导出面移除误导性字段。
- **验收**：方案 a 需 fusion 单测（收藏站点命中 personal 分值）+ `me-data-api.test.ts` 关闭个性化后不注入的既有用例不回退；方案 b 需文案测试更新。
- **风险**：低-中（a 会实际改变搜索排序，需在 E2E 里确认无意外回归）。

#### T18【P2｜中】用户域 GET 协商缓存接入（省全量聚合查询）
- **实施要点**：
  1. 中枢：`GET /api/me` 加 `{ cache: { maxAge: 0, etag: true } }`（框架一行，自动 `private, no-cache` + ETag + 304，`server.ts:300-347`）；`GET /api/favorites`、`GET /api/search-history` 顺手同批；
  2. **BFF 改造（真正的活）**：`route.ts` 透传上游 `etag` 头、转发浏览器 `if-none-match`、304 原样回传（当前 text() 中转模式会吞掉 304 语义，且强制覆盖 no-store）；身份请求天然 private，无共享缓存串数据风险；
  3. 收藏增量同步的纯拉取请求（空 ops）可用已有 `version` 水位做轻量变更探测（`GET /api/me/favorites/version` 或 ETag 化），为多端一致性提供 1/5 成本的 SSE 替代（R1 的低成本前置）。
- **验收**：`me-api.test.ts` 补 304 用例（二次请求带 If-None-Match）；BFF 透传测试。
- **风险**：中低。BFF 是所有 /me 请求的必经路，改动需全量回归 /me 族页面。

#### T19【P2｜中】可观测接线（把已建成的指标体系用起来）
- **实施要点**：
  1. 发射 `favoritesSync.failureRetryable`（sync 400 时按 detail 分类）与 `favoritesSync.sharded`（客户端分片提交时上报或服务端按 ops=500 满额计数）；
  2. sync 成败落持久存储（audit_logs 加轻量 `user.sync` 事件或 llm_usage 式 rollup），解决"进程内计数重启清零、历史趋势不可得"；
  3. `/api/admin/user-center/metrics` 接前端消费页（admin 下用户中心运营 tab）；
  4. dashboardOverview 补用户域维度：DAU（events 按天去重 identity）、收藏量分布（人均/分位）、历史写入量——留存（次日/7 日）二期；
  5. user-center-metrics 测试补"路由→指标接线"断言（对 me.ts 关键行 grep record 调用，防"忘了 record"回归）。
- **验收**：admin 页可见三链路指标与 DAU；测试覆盖接线。
- **风险**：低。

### 3.4 第二批建议·中期（T20–T24）

#### T20【P1｜高】用户级 API 令牌（让用户数据走出浏览器）
- **目标**：用户可自建"只能动自己数据"的 token，扩展/MCP/Raycast 获得收藏读写能力（K1/K2/K3 的根治）。
- **实施要点**（六层，依赖 T7/T8 口径）：
  1. schema：`api_tokens` 加 `owner_identity` + 索引（三处方言登记，硬约束 4）；
  2. scope 模型：新增用户域能力位（`favorites:read/write`、`history:read`、`profile:read`），`AuthIdentity` 携带 ownerId；
  3. 路由：`/api/me/tokens` 自服务 CRUD（创建即显一次明文，同 tokens.ts 先例），list 只见自己的；
  4. 用户域路由加"token 即身份"分支（持个人 token 时 identity=owner，过别名解析）；
  5. 前端：`/me` 或 account 页 token 管理面板；`navhub_api_token` 键语义升级为用户 token（清退旧管理员凭据残留，K3）——注意 localStorage 键契约只加不清；
  6. 合规联动：注销/导出/身份合并覆盖 `api_tokens.owner_identity`；MCP HTTP 已查同表自动继承，后续可加 favorites 工具。
- **验收**：用户 A 的 token 读不到 B 的收藏（越权测试）；注销后 token 失效；扩展持 token 可收藏。
- **风险**：高（身份链路 + scope 模型结构性改动）。先做 e2e 矩阵再动手，灰度仅 favorites:read 起步。

#### T21【P2｜中】Copilot 个人上下文 + 用量可见
- **实施要点**：
  1. copilot/user-ai-chat 组装 systemPrompt 时注入用户上下文：画像摘要（topCategories/topTags）+ 收藏夹结构（夹名+条数）+ 最近搜索 N 条（尊重 `searchHistoryEnabled` 与 token 预算，分级：画像常驻、收藏按需、历史开关控制）——仓储方法全部现成（B2 地基）；
  2. Copilot 会话持久化：localStorage 起步（最近 N 轮，与 search_history 保留期口径一致），/me 加管理入口；服务端表版本二期；
  3. LLM 用量用户侧可见：`GET /api/me/llm-usage`（复用 `sumLlmUsage({identity})`），preferences 的 AI 卡片加"今日已用/剩余"进度条，超 80% 提前预警；
  4. 个性化透明度增强：personal 通道徽标 hover 展开"来自你近 30 天的偏好（类目 X、标签 Y）"（contributions 数据现成）。
- **验收**：配额将尽时 UI 提前可见；Copilot 回答能引用收藏上下文；关闭 searchHistoryEnabled 后历史不入 prompt。
- **风险**：中。prompt 注入需防泄漏用户数据到系统级日志。

#### T22【P2｜中】收藏标签系统 v1（对照 Raindrop 基线的最大产品差距）
- **实施要点**：
  1. schema：favorites 加 `tags` JSON 文本列（双方言 LIKE/JSON 函数，参照既有双方言排序先例）；`FavoriteOp` 加 tags 字段并定义 LWW 行为（与 note 同法：null=清除）；
  2. 同步：ops 携带 tags，墓碑语义不变；
  3. 前端：卡片加标签行（点击即筛）、标签筛选 chips（复用收藏夹筛选交互）、批量打标签依赖多选（与 T23 后续）；
  4. 导入导出/书签 HTML：tags 进导出 JSON（schemaVersion 已就位）与 Netscape HTML 的 TAGS 属性；
  5. 检索：前端 filter haystack 加 tags；服务端 q 参数纳入 tags。
- **验收**：round-trip 保留标签；双端同步冲突按 LWW 收敛；`me-favorites-sync.test.ts` 扩展。
- **风险**：中。涉及 schema + 同步协议 + 全部导出面，须走完整三处方言登记与 parity 测试。

#### T23【P3｜低】浏览历史页 + 多选批量操作
- **实施要点**：
  1. C4：`GET /api/me/visits`（events kind=click 按 identity 分页，脱敏字段）+ `/me/visits` 页（或并入 /me/history 双 tab："搜索 / 访问"），清理入口复用 `DELETE /api/profile/signals/click`；数据已在采集，纯暴露成本；
  2. 收藏多选模式（checkbox + 批量移动到夹/批量删除/批量打标签），依赖 T4 的 batch-delete 模式扩展到 favorites。
- **验收**：访问历史分页可见可清；批量操作单请求完成。
- **风险**：低。

#### T24【P3｜低】用户数据巡检 job + 离线补强
- **实施要点**：
  1. R6：新增 `user_data_audit` 定时任务——把 diagnostics 里两条检测 SQL（孤儿收藏引用、超期历史）抽成仓储方法，全库巡检**只报不动**（写 audit + 指标，符合 jobs"先看见再决定"哲学），顺带产出运营指标；
  2. R2：SW SHELL 加 `/me` 外壳（弱网首开提速；`/api/*` 不进 SW 缓存的安全默认不变）；搜索历史本地镜像最近 50 条（复制 user-settings 的 Save-then-Verify 模式，离线可读最近历史）。
- **验收**：job 报表含孤儿数/超期数；飞行模式下 `/me` 外壳可打开、最近历史可读。
- **风险**：低。

### 3.5 明确不做 / 评审项（继承 + 第二批新增）

- **继承 v1/v2.0**：收藏分享协作、GitHub 外 OAuth、收藏内容 E2EE 上云、新状态库、MFA、头像上传、workspaces/crdt 导入恢复、实时协作编辑。
- **第二批评审项**（有产品价值但需先拍板口径，不在本批直接实施）：
  1. **视频用户面**（点赞/收藏/观看历史/进度）——需要净新增事件 kind + 表 + UI，且视频内容本身是 KV blob 无独立表，先评审内容域架构；
  2. **合集订阅/标签关注**（C2/C3）——需要可见性模型与通知体系（T13）配合；
  3. **收藏多集合**（一条收藏进多个夹）——必须先动 `favorites(user_id, site_id)` 唯一约束（schema.ts:324），破坏面大；
  4. **嵌套夹 / 自定义顺序**——Netscape 导出只支持一层、position 全序与 LWW 同步有语义冲突，随 T22 标签系统一并评审（标签可替代大部分多集合诉求）；
  5. **多套 LLM 配置/按场景切换**（I4）——结构性改动，等 T21 验证单套+上下文注入的收益后再评；
  6. **用户域 SSE 推送**——先用 T18 的 version/ETag 轻量探测验证需求强度，SSE 成本约 5 倍。

---

## 4. 收益与实施要点汇总

| 建议 | 优先级 | 工作量（人日） | 依赖 | 风险 |
|---|---|---|---|---|
| T1 前端取数收敛 | 高 | 2–3 | 无 | 低 |
| T2 导入导出对称化 | 高 | 3–4 | 无 | 中 |
| T3 账号基础能力 | 高 | 3–4 | T7 口径 | 低 |
| T4 历史批量清理 API | 中 | 1 | 无 | 低 |
| T5 SectionState 7/7 + a11y | 中 | 1–2 | 无 | 低 |
| T6 工程卫生 + bundle 棘轮 | 中 | 1–2 | 无 | 低-中 |
| T7 身份残余决策 | 高 | 0.5–1 | 产品拍板 | 中 |
| T8 会话治理 | 高 | 3–4 | 无 | 中 |
| T9 PG 测试 + 限流配额 | 高 | 3–4 | PG 环境 | 中 |
| T10 设置冲突解决 | 高 | 2–3 | 无 | 中 |
| T11 保留期自动化 | 中 | 1–2 | 无 | 低 |
| T12 登录态 E2E | 中 | 2–3 | 测试账号 | 低-中 |
| T13 通知中心 | 中 | 4–5 | 评审 | 中 |
| T14 代码组织长线 | 低 | 持续 | — | 低 |
| **T15 收藏正确性三修** | 高 | 1–2 | 无 | 低 |
| **T16 已建成能力接线** | 中 | 2 | 无 | 低 |
| **T17 favoriteSiteIds 拍板** | 高 | 0.5–1.5 | 二选一拍板 | 低-中 |
| **T18 用户域协商缓存** | 中 | 1–2 | 无 | 中低 |
| **T19 可观测接线** | 中 | 2 | 无 | 低 |
| **T20 用户级 API 令牌** | 高 | 5–8 | T7/T8 | 高 |
| **T21 Copilot 上下文+用量** | 中 | 3–4 | 无 | 中 |
| **T22 收藏标签系统 v1** | 中 | 4–6 | T15 | 中 |
| **T23 浏览历史页+多选** | 低 | 2–3 | T4 | 低 |
| **T24 数据巡检+离线补强** | 低 | 1–2 | 无 | 低 |

---

## 5. 硬约束（继承 v1 §5.1，第四批适用）

1. **双目录镜像**：改动必须 overlay → 镜像同步；`navhub-api.ts`（T20 令牌改动）、`favorites-filter.ts`（T16）等双份文件必须同改，CI `check-web-overlay` 会拦；core 镜像文件走 `sync-core-mirrors`。
2. **localStorage 契约不可改**；只能加新键（T21 Copilot 会话、T24 历史镜像均用新键）。
3. **签名链路**：新路由必须 `identityOf` + `identityTrusted` 成对；T1 下线 query 身份时服务端兼容读取顺序 header > query 保持一个版本；T20 的"token 即身份"分支同样必须过 `resolveIdentity` 别名解析。
4. **双方言**：新列/新表登记三处（sqlite DDL、pg DDL、migrate 兜底），新列进 `COLUMN_ALTERS`，跑 `schema-parity.test.ts`（T20 owner 列、T22 tags 列）。
5. **事务**：只用 `repo.withTransaction`，事务内不做远程 IO。
6. **同步 null 语义**：云端 null = 已清除，`??` 回退会把用户的清除动作变回来——T15 的 note 容错、T22 的 tags LWW 同样适用。
7. **bundle 预算只降不升**：T6 补 `/me` 棘轮、T21/T23 新增面板时同批核对。
8. **noindex 红线**：`/me*` 不进 sitemap、页面级 noindex、不改 Disallow。
9. **诚实申报原则**：T15 的 per-op 容错（skippedInvalid）、T2 的导入申报、T24 的巡检"只报不动"一脉相承。
10. **行为锁测试**：改 `me-favorites-sync` / `me-data-api` / `section-state` / `me-degrade-states` 锁定语义时，先改测试期望并在提交信息说明口径变更（T15 的 zod 严格拒→结构化申报、T17 的排序行为变更均属此类）。
11. **SW 不缓存 `/api/*`**（安全默认，T24 只加静态外壳）；**BFF 剥头是历史安全选择**，T18 透传 etag 时必须保持 `private` 语义与身份绑定。

---

## 6. 路线图（建议排期）

| 周 | 内容 |
|---|---|
| W1 | T7（拍板 + 启动检查）+ T1（取数收敛 + query 下线）+ **T15（收藏正确性三修，含同步卡死缺陷）** |
| W2 | T2（导入导出对称化）+ T4（批量清理）+ **T17（favoriteSiteIds 拍板落地）** |
| W3 | T3（账号能力）+ T5（a11y 收尾）+ T6（工程卫生）+ **T16（已建成能力接线）** |
| W4–5 | T8（会话治理）+ T9（PG 测试 + 限流）+ **T18（协商缓存）+ T19（可观测接线）** |
| W6 | T10（设置冲突）+ T11（保留期自动化）+ **T24（数据巡检 + 离线补强）** |
| W7–8 | T12（登录态 E2E）+ **T21（Copilot 上下文 + 用量可见）**；T13/T20 设计评审 |
| W9–12 | **T20（用户级令牌，先 e2e 矩阵再实现）**、**T22（标签系统）**、**T23（浏览历史页）** 穿插；T14 持续 |

---

## 7. 附录：验证清单（每个 PR 必跑）

```bash
node node_modules/vitest/vitest.mjs run          # 全量基线（2600+，0 failed 为准）
node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
node node_modules/eslint/bin/eslint.js <改动文件>
# 用户中心专项（在 v1 附录 A 的 21 文件基础上按改动扩展）：
#   api: me-api / me-data-api / me-favorites-sync / user-center-canonical / user-center-metrics
#   web: me-pages / me-degrade-states / me-settings / me-plugins / me-account / me-identity
#        me-import-honesty / section-state / favorites-* / user-preferences / a11y-contrast
#   store: identity-merge / user-data / workspace-blobs
# 第二批新增改动另跑：schema-parity（T20/T22 动 schema 时）、profile-view（T17）、pwa-offline（T24）
```

## 8. 附录：本研究的事实来源

- **第一轮**：前端 `app/me/**`、`app/favorites/page.tsx`、`app/preferences/page.tsx`、`components/user-center/**`、`hooks/*`、`lib/{navhub-api,client-session,user-settings}.ts`；后端 `routes/{me,favorites,history,profile,vault,identity}.ts`、`auth.ts`、`packages/store/src/{schema,retention}.ts`、`repository/{user-data,identity,users}.ts`；测试 `me-data-api.test.ts` 等。
- **第二轮**：收藏——`app/favorites/page.tsx`（全读）、`lib/favorites-{filter,folders,merge,storage}.ts`、`hooks/useFavorites.ts`、`routes/favorites.ts`、`repository/favorites.ts`；AI——`routes/{copilot,ai-config}.ts`、`llm-{config,quota,usage}.ts`、`profile-service.ts`、`packages/core/src/{profile,fusion,channels}.ts`、`routes/search.ts`、`components/ai/*`；跨端——`extensions/{chrome,raycast}-extension/**`、`packages/mcp/src/**`、`packages/core/src/mcp-schemas.ts`、`scripts/{sync-core-mirrors,check-web-overlay,sync-web-overlay,apply-web-overlay}.mjs`；内容——`routes/{collections,rank,telemetry,navsphere,videos 相关}.ts`、`schema.ts` 全表扫描、`app/{videos,collections,tags,graph,hot}/**`；基建——`routes/shared.ts`、`public/sw.js`、`lib/offline-recent.ts`、`metrics.ts`、`user-center-metrics.ts`、`routes/stats.ts`、`server.ts:300-347`、`app/api/me/[[...path]]/route.ts`、`jobs.ts`。
- **主线亲自复核（✅）**：me-view/use-me-overview 重复；导入 schema 四类；`?anonId=` query；overlay 缺 theme-provider；**me.ts:740 note 整批 zod 拒绝 + favorites/page.tsx:1108 Input 无 maxLength（同步卡死链路两端）**；listFavoritesPage 建成且 favorites.ts:66 已接线但 web 客户端零调用；favoriteSiteIds 仅 navhub-api.ts:800 类型定义出现；BFF 强制 no-store 且只透传 3 头；failureRetryable/sharded 仅定义无发射；applyFavoriteOps 盲插不校验站点；apps/brain 空目录。
