# NavHub 后端全功能扫描与优化方案（2026-10-30）

> 代码基线：`main` @ `0fe92e12`（扫描开始时）。只读静态审查，未启动服务、未修改业务代码、未触碰并行会话的开发栈或数据库。
>
> 扫描范围：`apps/api` 43 个路由模块（277 条路由声明）、`apps/web-overlay` 42 个 BFF `route.ts`（76 个方法导出）、`packages/{store,core,ai,mcp}`、任务/存储/鉴权/搜索/视频/CI/Docker。
>
> 计数口径：路由数按 `app.(get|post|put|patch|delete)` 声明统计；scope 标签为 94 public / 39 read / 42 write / 52 admin，其余未显式声明、注册时按 public 处理，并由 `apps/api/test/route-policy.test.ts` 的匿名写面快照兜底。多行 config 会让正则计数有少量误差，具体结论均已回读源文件确认。

## 0. 结论先行

后端的**边界设计是成熟的**：scope 分级、身份签名 v1/v2、个人令牌实例写拦截、匿名写面台账、快照写回来源过滤、PG 测试套件、BFF 路由策略都已有明确护栏。当前主要问题不是“没有鉴权”，而是：

1. **已有权限的破坏半径过大**：`write` 令牌可以入队不可逆的恢复/清理任务；token 场景跳过身份签名；单请求可放大成数分钟出站探测。
2. **读路径有结构性放大**：导航快照每次读要做全库指纹、逐站点相关子查询和全量对象组装；exact 搜索使用前导通配符。
3. **队列是串行的，且超时是“假取消”**：一个长任务阻塞全部任务；`Promise.race` 超时后 handler 仍可能继续写库。
4. **可观测性与契约不足**：没有任务队列指标；OpenAPI 只有 25 个请求绑定 / 47 个响应绑定，对应 277 条路由。

建议按“先收破坏半径、再拆读放大、最后补工程化”的顺序推进。总计约 35–50 人日，P0 约 8–12 人日。

## 1. 后端功能地图

| 域 | 代表入口 | 主要落库 | 关键机制 / 现状 |
|---|---|---|---|
| 导航内容 | `/api/storage`、`/api/sites`、`/api/categories`、`/api/tags`、`/api/facets`、`/api/taxonomy`、`/api/relations`、`/api/collections`、`/api/trash`、`/api/submissions` | `sites`、`categories`、`tags`、`site_tags`、`site_facets`、关系表；NavSphere 文档走 `jobs` 表的 `kv:` 键 | 快照缓存 30s + 数据指纹；写回为事务内全量对齐，按 source 限定删除范围 |
| 搜索与排序 | `/api/search`、`/api/search/linucb`、`/api/rank/*`、`/api/stats` | 站点主表、FTS 影子表、向量表、事件表 | 五通道 RRF（exact/FTS/拼音/语义/个性化）；搜索 120/min、20s 缓存 |
| 用户域 | `/api/users/sync`、`/api/me*`、`/api/favorites*`、`/api/profile`、`/api/history`、`/api/vault/*`、`/api/workspaces*`、`/api/crdt/sync` | `users`、`favorites`、用户设置、`user_workspace_blobs`、`user_vault_sync` | 身份签名、令牌 owner、`userDomainWriteAllowed`；公开注册/空间创建有身份但不一定有配额 |
| 插件域 | `/api/plugins*`、`/api/plugins/:slug/audit`、`/ai-heal`、`/overlap`、治理任务 | 插件、清单、评价、审计台账 | 清单校验、路由策略、探活 SSRF 守卫；审计路由本身缺少限流 |
| AI 域 | `/api/enrich`、`/api/ai-config`、`/api/copilot`、`/api/visual`、`/api/recipes` | `llm_usage`、AI 配置、成本快照 | 配额三档、成本单价簿、模型降级；配额是 check-then-act |
| 视频域 | `/api/videos*`、`videos.json`、BFF `/api/videos/bili-stream`、`webhook-harvest` | KV `videos.json` + 关系影子表 | 双写、80% 缩水保护、乐观版本、HMAC webhook、游标分页 |
| 运维域 | `/api/health`、`/api/ready`、`/api/metrics`、`/api/jobs*`、`/api/backup/*`、`/api/export/*`、`/api/audit`、`/api/errors`、通知 | `jobs`、`audit_logs`、`events`、`notifications` | 单一 Runner 锁、任务预算、SSE、Prometheus 指标；无任务队列指标 |
| 接入与契约 | BFF `/api/hub/*`（42 个 `route.ts` / 76 个方法导出）、MCP 工具、OpenAPI | 无独立存储 | BFF 路由白名单、管理员会话、请求体上限；OpenAPI 契约覆盖偏低 |

## 2. 已闭环项（不要重做）

| 已闭环项 | 证据 | 说明 |
|---|---|---|
| 工作区 blob 迁移不会“先删后失败” | `packages/store/src/migrate.ts:258-270` | DELETE 带 `AND EXISTS`，未复制成功的行不会被删 |
| URL 唯一索引重建顺序 | `packages/store/src/migrate.ts:303-324` | 先建 `sites_url_uniq_v2` 再删旧索引 |
| 站点分页稳定排序 | `packages/store/src/repository/sites.ts:68` | `sort ASC, weight DESC, id ASC`，已有 id 兜底 |
| 个人令牌不得触达实例写面 | `apps/api/src/server.ts:472-488`、`592-604` | 开放模式与鉴权模式共用同一条边界 |
| 匿名写面台账与登记闸门 | `packages/core/src/route-policy.ts:67-75`、`apps/api/test/route-policy.test.ts:82+` | 新增匿名写路由必须显式复核 |
| 全站计数合并为一条 SQL | `packages/store/src/repository/stats.ts:11-32` | 避免 6 次 COUNT 往返 |
| `getSite` 的 OR 查询拆分 | `packages/store/src/repository/sites.ts:149-165` | 避免 SQLite 放弃主键索引 |
| 就绪探针真实 ping 数据库 | `apps/api/src/routes/health.ts:44-77`、`docker/docker-compose.yml:134-137` | 容器健康检查指向 `/api/ready` |
| PG 套件在 CI 中真实执行 | `.github/workflows/ci.yml:163-200` | pgvector 服务 + `pnpm test:pg:suite`，不再静默 skip |
| 快照写回按 source 限定删除范围 | `apps/api/src/storage.ts:265-368` | 保护 API/MCP/AI/投稿创建的记录，避免 D1 数据丢失 |
| 媒体代理签名、SSRF、并发合并 | `apps/web-overlay/src/app/api/media/proxy/route.ts:14-22`、`54-69`、`100-157` | 只剩“总字节数无上限”未处理 |
| 视频写入保护与乐观版本 | `apps/api/src/storage.ts:490-491` 等 | 80% 缩水拒绝、`ifVersion` 冲突 409、HMAC webhook |

**特别提醒**：不要为了“读侧可见性”在 `buildNavigationData` 里直接过滤 `enabled=false` / `status`。快照写回把“快照里没有”当成“用户删了”，读侧预过滤会导致停用类目/站点被下一次保存硬删（D1 回归）。可见性应在路由边界做投影，见 P1-6。

## 3. P0：先收破坏半径

### P0-1 任务队列：破坏性任务没有按 kind 分级

**证据**

- `POST /api/jobs` 只要求 `write`，限流 30/min：`apps/api/src/routes/jobs.ts:58-60`。
- `RunJobInput` 的 kind 枚举包含 `backup_restore`、`purge_trash`、`data_retention`：`packages/core/src/mcp-schemas.ts:215-230`。
- `validateJobPayload` 对 `backup_restore` 只校验 `stagingPath` 非空：`packages/core/src/job-payloads.ts:87-91`。
- `runBackupRestore` 直接 `readFile(stagingPath)` 并应用分类/站点计划：`apps/api/src/jobs.ts:1351-1374`。
- `MANUAL_ONLY_KINDS` 只阻止 cron 排期，不阻止 API 入队：`apps/api/src/jobs.ts:141`。

**影响**

任意 `write` 令牌可以入队不可逆恢复；`purge_trash` 可物理清理回收站；`data_retention` 带 `apply:true` 可删除事件/审计。`stagingPath` 没有目录白名单，进程可被诱导读取任意 JSON 文件并把其中的结构应用到库。属于“已有权限的破坏半径”问题，不依赖外部未授权入口；开放模式下匿名请求同样拥有全部 scope，风险面更大。

**改法**

1. 增加按 kind 的权限分级（建议放在 `@navhub/core`，REST/MCP 共用）：
   - `write`：`health_check`、`refetch_metadata`、`recompute_rank`、`reindex`、`site_self_healing`、`token_audit`、`taxonomy_audit`、`plugin_governance`、`user_data_audit`。
   - `admin`：`backup_restore`、`purge_trash`、`data_retention`（`apply:true` 时）。
2. 从通用 `POST /api/jobs` 移除 `backup_restore`；恢复只能经 `/api/backup/restore/async` 入队，由该端点生成 staging 文件。
3. 如果保留通用入口，`runBackupRestore` 必须做 `realpath(stagingPath)` 前缀校验（`NAVHUB_RESTORE_STAGING_DIR`，默认 `data/restore-staging`）并限制文件大小。
4. 破坏性 kind 入队时要求显式 `confirm: true`，并写 `job.enqueue_destructive` 审计（actor、kind、目标）。

**验收**

- write 令牌请求 `backup_restore` → 403；admin → 201/202。
- `stagingPath` 指向目录外 → 400；指向超大文件 → 413。
- 现有“手动专属任务绝不被排期”测试保持绿色。
- 消融：移除分级判断后新增测试必须转红，恢复后逐字节一致。

**工作量**：1–2 人日。

### P0-2 身份同步：token 场景未校验 targetId 与 owner

**证据**

- `/api/users/sync` 是 public 路由：`apps/api/src/routes/identity.ts:22`。
- 鉴权模式下 `identityAllowed` 只要求“不是 anonymous”：`apps/api/src/routes/shared.ts:343-346`。
- 签名校验只在 `ctx.config.identitySecret && auth.kind === "anonymous"` 时执行：`apps/api/src/routes/identity.ts:54-65`。
- `targetId` 由请求体的 `provider:providerId` 决定，没有与 `auth.ownerIdentity` 比对：`apps/api/src/routes/identity.ts:53`。

**影响**

任何有效 token（包括 read/个人令牌）调用 `/api/users/sync` 时不走签名校验，且可以指定任意 `provider:providerId` 写入 `users` 表，覆盖 username/email/avatar。它破坏了“token 即身份”的不变量；如果下游把 providerId 当账号键，可能造成账号冒用或资料覆盖。

**改法**

1. 若 `auth.ownerIdentity` 存在：解析别名后要求 `targetId === ownerIdentity`，否则 403 并审计。
2. 若 `auth.kind !== "anonymous"` 且没有 owner（实例令牌）：要求 `write/admin` scope，并对 `targetId` 走身份签名校验；不能因为“是 token”就跳过签名。
3. 开放模式（未开鉴权、无 identitySecret）保持历史行为不变。
4. 增加 `identity.sync_forbidden` 审计，记录 tokenId（不记录明文）。

**验收**

- owner 匹配 → 200；owner 不匹配 → 403。
- 匿名 + 无签名（配了 identitySecret）→ 401；匿名 + 有效签名 → 200。
- 实例令牌 + 无签名 → 401；实例令牌 + 有效签名 + write → 200。
- 开放模式回归通过。

**工作量**：0.5–1 人日。

### P0-3 LLM 配额：check-then-act

**证据**

- `checkLlmQuota` 先 `sumLlmUsage`，再判断是否超限：`apps/api/src/llm-quota.ts:96-125`。
- 当前没有预留（reservation）或原子计数；配额判断与用量落库之间存在窗口。

**影响**

并发请求可以同时看到“未超限”，一起通过检查，导致成本超支；对按 token 计费的模型尤其明显。配额是成本护栏，不能只在单请求视角正确。

**改法**

1. 增加预留表或原子计数器：`llm_quota_reservations(identity, window_start, reserved_calls, reserved_tokens, expires_at)`。
2. `reserveLlmQuota(ctx, identity, estimatedTokens)` 在一个事务里完成“已用 + 已预留 vs 上限”的判断并插入预留；超限返回 429 + `Retry-After`。
3. 生成结束后 `settleLlmQuota(reservationId, actualTokens)`；失败/断流在 `finally` 释放；预留带 TTL，由清理任务回收。
4. 三档（identity / anonymous / system）都走同一套预留；流式响应在连接断开时也要结算。
5. 增加 `llm_quota_rejected_total`、`llm_quota_reserved_tokens` 指标。

**验收**

- 20 个并发请求、上限 5：恰好 5 个通过，其余 429。
- SQLite 与 PG 各跑一遍；成本看板实际用量与结算值一致。
- 断流/异常路径不泄漏预留（TTL 后自动回收）。

**工作量**：2–3 人日。

### P0-4 出站/CPU 预算：插件审计、公开写与计算端点

**证据**

- `POST /api/plugins/:slug/audit` 只有 `scope: "write"`，没有路由级 rateLimit：`apps/api/src/routes/plugin-audit.ts:462`；同文件的 `ai-heal` 有 20/min：`891-893`。
- 审计参数 `limit` 最大 200、`timeoutMs` 最大 30s：`apps/api/src/routes/plugin-audit.ts:55-58`、`471-472`；探活并发 12：`apps/api/src/plugin-audit.ts:105-110`、`242-249`。单请求最坏约 200×30s/12 ≈ 8 分钟出站。
- `POST /api/events`、`/api/vitals` 没有路由级限流；`query`、`siteId`、`categoryId` 没有长度上限：`apps/api/src/routes/telemetry.ts:57-91`、`159`。
- `POST /api/workspaces` 只要求可信身份，没有数量/大小配额：`apps/api/src/routes/workspaces.ts:164-167`、`199-201`。
- `POST /api/rank/federated` 是 public 且无路由限流，候选最多 200 条、每条 1024 维：`apps/api/src/routes/rank.ts:191-203`。

**影响**

- 有写权限的令牌可把审计端点当免费探活器，出口 IP 被目标站拉黑，并长时间占用连接。
- 匿名/低权限调用方可让 `events` 表按 4MB 请求体级别增长；workspaces 可无限创建 blob；federated 可消耗 CPU。
- 这些都不是“未授权访问”，而是“授权后没有预算”。

**改法**

1. 插件审计：加 `rateLimit: { max: 5, timeWindow: "1 minute" }`；把 `limit` 公共上限降到 100；对同一插件同一时间窗口做单飞（in-flight coalescing）；增加进程级出站信号量（例如 30 并发、600 次/分钟），超限返回 429。
2. `/api/events`、`/api/vitals`：加路由级 120/min；`query.max(512)`、`siteId.max(128)`、`categoryId.max(128)`；按 IP + kind 做采样/丢弃上限。
3. `/api/workspaces`：每身份最多 20 个空间、单 blob 512KB、创建 10/min；写入前校验总大小。
4. `/api/rank/federated`：public 调用把候选上限降到 50、维度 256；或改为 `read`/`write` scope；加 60/min。
5. `/api/sites/:id/archive` 已有 20/min、3s、256KB 守卫，建议再加同站点 24h 内复用上一次快照，避免重复抓取和表膨胀。

**验收**

- 100 个并发审计请求：超过 5/min 后 429，服务端出站并发不超过阈值。
- `query` 长度 513 → 400；events 写入速率受限。
- 单身份创建第 21 个 workspace → 409/429。
- federated 传 200 个候选 → 400（public）或明确降级。

**工作量**：3–4 人日。

### P0-5 代理资源上限：媒体缓存与 B 站流

**证据**

- 媒体代理只按“800 个条目”做 LRU，没有总字节上限：`apps/web-overlay/src/app/api/media/proxy/route.ts:14-17`。
- 上游响应直接 `arrayBuffer()` 全量读入内存，没有 `Content-Length` 预检或流式截断：同文件 `121-147`。
- B 站流代理的 `fetch` 没有 `signal`/超时：`apps/web-overlay/src/app/api/videos/bili-stream/route.ts:51-55`；响应体直接透传：`89-92`；没有路由级限流。

**影响**

签名媒体 URL 可指向超大图片/伪装的非图片响应，800 个条目足以耗尽 Node 进程内存；B 站流可被慢速上游/长连接占住 socket，且没有每 IP/每进程并发上限。

**改法**

1. 媒体代理：先检查 `Content-Length`（超过 5MB 直接 413）；无长度时用流式读取并在 5MB 处中止；缓存按 `buffer.length` 累计，设总预算（如 128MB）而不是只数条目；限制 `Content-Type` 为图片白名单。
2. B 站流：头部请求 `AbortSignal.timeout(8000)`；响应体增加空闲超时（30s 无数据中止）；限制每 IP/每进程并发流（如 32）；加 60/min 路由限流；对 `Range` 响应设置单次最大字节数。
3. 能走 CDN/边缘的流量不要回源代理；至少把 `bili-stream` 标记为“尽力而为”，失败时回退直链。

**验收**

- mock 上游返回 100MB 图片：媒体代理 413，进程内存不增长。
- mock 上游延迟发送：B 站代理在空闲超时后断开，返回 504。
- 并发压测 100 条流：超过并发上限返回 429/503。

**工作量**：2–3 人日。

## 4. P1：拆读放大与队列瓶颈

### P1-1 导航快照读放大

**证据**

- 缓存 TTL 30s：`apps/api/src/storage.ts:93-98`。
- 每次读缓存都要做指纹：`COUNT(*)` `sites`/`categories`/`site_tags` + `MAX(updated_at)`：`apps/api/src/storage.ts:117-132`。
- 缓存未命中时重建全量快照，站点上限 8,000：`storage.ts:72`、`144-159`、`165-243`。
- 站点查询的 `selectSitesSql` 对每一行做 tag/facet 相关子查询：`packages/store/src/repository/sites.ts:139-146`。
- `listAllSites` 复用同一 SQL：`packages/store/src/repository/sites.ts:114-121`。

**影响**

8,000 站点时一次冷读要做约 16,000 次相关子查询，再逐站点组装增强数据；PG 上 `COUNT(*)` 在大表通常需要全表/全索引扫描。指纹在每次热读都执行，等于把“缓存命中”也变成一次重查询。多实例下缓存失效只能靠 TTL，最长滞后 30s。

**改法**

1. 用 `data_version` 单行表替代指纹：在站点/类目/标签/关系/快照写入事务里 `version = version + 1`；读侧 `SELECT version`（单行主键，微秒级），缓存键带版本。版本在数据库里，多实例天然一致，不需要等 TTL。
2. 标签/分面改成两条批量聚合查询（`GROUP BY site_id`），在 JS 合并；或写路径维护 `tag_slugs`/`facet_pairs` 冗余列。不要在 `selectSitesSql` 里保留逐行相关子查询作为默认路径。
3. 快照增加 `slim` 投影（NavSphere 写回所需的字段）和 gzip；增强数据按站点缓存，避免每次全量重算。
4. 增加 `snapshot_build_ms`、`snapshot_bytes`、`snapshot_cache_hit_total` 指标，并用 `Server-Timing` 分段。

**验收**

- 5k/10k 站点基准：热读 p95 < 100ms，冷读 < 1.5s；每次快照的 SQL 数 ≤ 5。
- 指纹查询 < 1ms；多实例写入后另一实例下一次读立即看到新版本。
- 消融：改回逐站点子查询后基准退化可复现。

**工作量**：4–6 人日。

### P1-2 导航快照写放大

**证据**

- `writeNavigationData` 在事务内逐站点 `await upsertSite`、逐条删除：`apps/api/src/storage.ts:265-368`、`372+`。
- `updateSite` 内部先 `getSite` 再 UPDATE、再 `getSite` 返回：`packages/store/src/repository/sites.ts:435-479`；而 `getSite` 使用带 tag/facet 相关子查询的 `selectSitesSql`（`139-146`）。

**影响**

保存 8,000 站点时大约是 16,000 次重读 + 8,000 次 UPDATE，全部在同一个写事务里；SQLite 会长时间持有写锁，PG 事务膨胀，前端保存超时/重试又会叠加写压力。

**改法**

1. 增加仓储级批量写入：多行 `INSERT ... ON CONFLICT DO UPDATE`（分块 500），批量 `DELETE ... WHERE id IN (...)`，批量类目更新；不返回 hydrated 对象。
2. 用已经读出的 `existingSites` 做内存 diff，只更新真正变化的字段；未变化站点跳过 UPDATE。
3. SQLite 分块提交 + 版本号保证可重试；PG 保持单事务或按分片事务 + 幂等 upsert。
4. 保留现有 source 过滤与可见集删除语义，增加针对 MCP/API 创建站点的回归测试。

**验收**

- 8k 站点保存：SQLite < 5s、PG < 10s；事务失败不产生半写。
- 保存后抽查：source 过滤、停用类目不硬删、不可见记录不误删三类测试保持绿色。

**工作量**：3–4 人日。

### P1-3 exact 搜索的前导通配符

**证据**

- exact 通道对 `title`/`url`/`description` 使用 `lower(...) LIKE ?`，参数是 `containsLike` 生成的 `%term%`：`packages/store/src/search.ts:596-601`、`609`、`630`、`644-649`。
- `containsLike` 固定返回 `%value%`：`packages/store/src/sql-like.ts:16-18`。
- 拼音通道也使用 `LIKE`，仅在非 fuzzy 时用前缀：`packages/store/src/search.ts:707-713`。

**影响**

前导通配符无法使用普通 B-tree 索引；每次搜索都要扫 `sites` 和 `site_tags`。在 10k 站点 + 标签表上，120/min 的搜索额度足以把 CPU 打满；随着库增长会先于其他接口退化。

**改法**

1. 先走 FTS5/PG FTS；exact 只作为短词/符号/URL 的补充通道，并加 `LIMIT` 预筛。
2. SQLite 使用 FTS5 trigram tokenizer（或单独的 trigram 索引表）；PG 使用 `pg_trgm` GIN 索引，专门服务 `%term%`。
3. 多列 `OR` 改为各通道 `UNION ALL` + 外层排序，避免优化器放弃索引。
4. 增加 10k 站点基准与 `EXPLAIN QUERY PLAN` 断言；`pnpm eval:search` 纳入回归。

**验收**

- 10k 站点：搜索 p95 < 100ms；`EXPLAIN` 显示 trigram/FTS 索引使用。
- 黄金查询集结果不回归；空结果率与点击率指标不恶化。

**工作量**：3–5 人日。

### P1-4 JobRunner 串行与“假取消”

**证据**

- `tick()` 单锁、单循环、`claimNextJob` 串行消费：`apps/api/src/jobs.ts:490-531`。
- `maxConcurrency` 只是声明值，Runner 全程串行：`apps/api/src/jobs.ts:250-258`、`263-282`。
- `runWithBudget` 只是 `Promise.race` 看门狗：`apps/api/src/jobs.ts:195-203`；注释明确“handler 没有 AbortSignal，可能仍在后台跑”：`704-713`。
- 超时任务落 failed 且不自动重试，但旧 handler 仍可能继续写库。

**影响**

一个 10 分钟的 `reindex`/`backup_restore` 会阻塞所有任务和 cron 入队；超时后“任务已失败但代码还在跑”，用户重试会制造两个并发执行流，写同一批数据。SQLite 下还会放大写锁竞争。

**改法**

1. 把 `AbortSignal` 贯穿到长任务 handler：`runHealthCheck`/`runReindex`/`runDataRetention`/`runBackupRestore` 在分片边界检查；网络调用传 `signal`。
2. 超时后不立即标 failed，而是标 `cancel_requested`，等 handler 确认停止；确认不了才进入失败终态并阻止重试窗口内重跑。
3. PG 模式按 kind 做并发 worker：`SELECT ... FOR UPDATE SKIP LOCKED` + 每 kind 信号量；SQLite 保持串行，但按“短任务优先”排序并把长任务分片。
4. cron 检查拆成独立定时器，不再依赖 worker tick。
5. 增加 `jobs_pending`、`jobs_running`、`job_duration_seconds{kind}`、`job_failures_total{kind}` 指标。

**验收**

- 模拟 10 分钟 reindex + 新入队 health_check：health_check 在下一 tick 内开始。
- 超时 handler 在分片边界停止；重试不会与旧执行并发。
- PG 集成测试验证不会双重认领；指标可见。

**工作量**：5–8 人日。

### P1-5 高频 COUNT：health、stats、dashboard

**证据**

- `/api/health` 每次轮询都调用 `repo.stats()`：`apps/api/src/routes/health.ts:16-33`。
- `stats()` 虽合并为一条 SQL，但仍包含 6 个 COUNT 子查询：`packages/store/src/repository/stats.ts:11-32`。
- 管理台 SSE 每 3 秒调用 `stats()`：`apps/api/src/routes/stats.ts:130-150`。
- 管理总览一次并发 22 个 COUNT，后续还有多组查询：`packages/store/src/repository/dashboard.ts:22-67`、`114`、`122`、`130`、`149`、`153`、`200-208`、`220-224`、`275-277`。

**影响**

PG 上 `COUNT(*)` 在大表是顺序扫描；health 是高频探针，SSE 是 24×7 心跳，dashboard 是管理端重查询。三者叠加会让“看板打开一天”变成大量重复扫描。

**改法**

1. `stats` 结果做 3–5s 的进程内单飞缓存，health、stats、SSE 共用；或在写入时维护计数表。
2. `/api/health` 默认只返回进程/能力状态，不返回全站统计；需要时用 `?detail=1` 或 `/api/stats`。
3. dashboard 用 30s 缓存或物化快照表；非精确指标用 `pg_class.reltuples` / 统计视图。
4. 增加 `health_stats_cache_hit_total` 与 dashboard 查询耗时指标。

**验收**

- 100k events 下 dashboard p95 < 100ms；health p95 < 5ms，查询日志中不再出现 COUNT。
- SSE 心跳查询量下降一个数量级。

**工作量**：2–3 人日。

### P1-6 `/api/storage` 读可见性

**证据**

- `GET /api/storage` 是 `read` scope：`apps/api/src/routes/navsphere.ts:44`。
- 返回 `readStoragePath`，即未过滤的 `buildNavigationData` 投影：`apps/api/src/storage.ts:165-243`；该函数刻意不过滤 `enabled`/`status`（见第 2 节提醒）。
- 开放模式下未配鉴权时，匿名即可访问该路由。

**影响**

read 令牌/匿名调用方可以拿到停用类目、停用站点、pending/broken/archived 站点等“后台态”数据；如果这些记录包含未发布内容，属于可见性泄漏。写回仍需原始快照，所以不能直接改 `buildNavigationData`。

**改法**

1. 增加 `?view=public` 投影：过滤 `enabled=false`、非 active 站点，以及不可见类目；只返回展示字段。
2. 原始快照仅对 `write/admin` 开放；NavSphere 后台写回继续用原始路由。
3. 或者拆成 `/api/storage/public` 与 `/api/storage/admin`，路由策略登记两者。
4. 用 ETag 区分 view，避免公共与管理缓存串用。

**验收**

- public/read 令牌看不到停用站点；admin 能看到；写回 round-trip 不变。
- 现有快照写回测试与 route-policy 快照保持绿色。

**工作量**：1–2 人日。

### P1-7 `/api/jobs` 列表无分页

**证据**

- `GET /api/jobs` 只取 `limit`，不解析 `offset`：`apps/api/src/routes/jobs.ts:108-111`；仓储 `listJobs(status, limit)` 同样没有 offset。

**影响**

任务历史只能看最近 N 条，无法翻页；排查历史失败任务时只能改代码/直连数据库。

**改法**

- 增加 `offset` 或 `(created_at, id)` 游标，返回 `nextOffset`；补 `(status, created_at)` 索引；限制最大页大小。

**验收**

- 1,000 条任务可完整翻页、无重复/漏项；空页返回稳定。

**工作量**：1 人日。

### P1-8 OpenAPI 契约覆盖

**证据**

- `REST_SCHEMA_BINDINGS` 目前 25 个键：`packages/core/src/mcp-schemas.ts:547`。
- `RESPONSE_SCHEMA_BINDINGS` 目前 47 个键：`packages/core/src/rest-responses.ts:945`。
- 对应 277 条路由；未绑定的请求/响应退化为通用对象：`apps/api/src/openapi.ts:130-208`。

**影响**

自动生成的 OpenAPI 与真实契约脱节，客户端/MCP/第三方集成只能读源码猜测；响应字段变更不会在文档层暴露。

**改法**

1. 优先补齐 write/admin 路由与 public 高频读路由（search/sites/videos/stats）的请求与响应绑定。
2. 增加 CI 覆盖率门槛：write/admin 必须 100% 有绑定；public 读路由至少覆盖 Top 20；未绑定项进入 allowlist 并写原因。
3. 统一错误响应 schema（见 P2-2），让 4xx/5xx 也可被客户端生成。

**验收**

- `pnpm check:rest-contracts` 输出覆盖率；新增未绑定 write 路由时 CI 转红。
- 生成的 OpenAPI 能通过至少一个客户端代码生成器（如 openapi-typescript）编译。

**工作量**：5–8 人日（可分批）。

## 5. P2：工程化与长期项

| 项 | 现状 | 建议 |
|---|---|---|
| 多实例一致性 | `@fastify/rate-limit` 默认进程内；快照缓存进程内；鉴权失败节流也是进程内（`server.ts:178`、`storage.ts:93-98`） | lite 单实例可接受；standard 横向扩展时接 Redis/PG 共享限流与缓存失效，或在部署文档中明确单实例约束 |
| 统一错误包络与版本 | 全局 500 返回 `{error}`，各路由混用 `{ok,error,message}`；无 `/api/v1` | 定义 `{error:{code,message,requestId,details}}`；保留旧字段一个版本；新增路由走版本前缀 |
| 视频双写收敛 | `videos.json` 实测约 6.37MB，KV + 关系影子表双写；三个写入口 | 完成回填后把 `NAVHUB_VIDEO_STORE=db` 设为默认，KV 只做只读回退；增量写/压缩；保留回滚开关 |
| 视频缩水保护可操作性 | 写入少于库内 80% 直接拒绝（`storage.ts:490-491`），合法的大规模删除也会被挡 | 增加 `confirmLargeDeletion` / `expectedCount` 二阶段确认，审计后放行；不要移除保护 |
| 任务与出站可观测性 | `metrics.ts` 有 HTTP/搜索指标，没有任务队列/出站/快照指标 | 增加 job pending/running/duration/failure、outbound requests、snapshot build；接入 OpenTelemetry trace |
| 压测基线 | 仓库没有 k6/autocannon 脚本 | 增加 nightly/手动压测：search、storage、sites list、jobs、health；用 10k 站点种子数据 |
| 部署默认值 | 根 `docker-compose.yml` 已弃用但仍指向 `/api/health`；CORS 默认 `*`（`config.ts:498`） | 删除或改写弃用 compose；生产模板显式配置 CORS 白名单；把 `/api/ready` 作为唯一健康检查 |
| 数据保留策略 | `data_retention` 默认 dry-run（`jobs.ts:126`） | 运维确认后开启 apply；先在 staging 观察 rollup 结果，再设定保留天数 |
| 契约/类型漂移 | 历史文档登记过 schema/export 手写漂移，本轮未逐文件复核 | 纳入 `pnpm check:rest-contracts` 之前先做一次专项复核，避免重复劳动 |

## 6. 路线图

| 阶段 | 周期 | 内容 | 退出标准 |
|---|---|---|---|
| Sprint 0 | 1 周 | P0-1、P0-2、P0-5、P1-6 | 破坏性任务分级、身份绑定、代理上限、存储可见性全部有测试；`pnpm verify` 绿 |
| Sprint 1 | 2 周 | P0-3、P0-4、P1-1、P1-7 | 配额并发测试通过；审计/事件/空间有预算；快照版本化与批量标签查询落地 |
| Sprint 2 | 2–3 周 | P1-2、P1-3、P1-4、P1-5 | 8k 快照保存 < 5s；10k 搜索 p95 < 100ms；队列可按 kind 并发且可中止；health 无 COUNT |
| Sprint 3 | 并行/持续 | P1-8、P2-1、P2-4、P2-5、P2-6 | 契约覆盖率达标；多实例方案定型；任务/出站/快照指标上线；压测基线进 CI |

依赖关系：P1-2 依赖 P1-1 的批量查询/版本号；P1-4 依赖 P0-1 的任务分级（先有权限模型再拆并发）；P1-8 依赖 P2-2 的错误包络。

## 7. 验证与护栏

### 必跑命令

```bash
pnpm verify                     # 默认门禁（类型、overlay、CI gate、镜像、契约等）
pnpm verify:full                # 完整门禁
pnpm test:pg:suite              # 需要 NAVHUB_TEST_DATABASE_URL；CI 已配 pgvector
pnpm check:hub-policy           # BFF 路由策略新鲜度
pnpm check:overlay              # overlay 与镜像一致性
pnpm check:rest-contracts       # REST 契约生成物
pnpm lint:backend
pnpm eval:search                # 搜索黄金集回归（P1-3）
```

### 定向测试

```bash
pnpm vitest run apps/api/test/route-policy.test.ts \
  apps/api/test/upgrade-batch1.test.ts \
  apps/api/test/job-payload-schema.test.ts
```

### 新增测试建议

- `apps/api/test/job-tiers.test.ts`：write/admin 分级 + staging 目录白名单。
- `apps/api/test/identity-sync-binding.test.ts`：owner/target 绑定与签名分支。
- `apps/api/test/llm-quota-concurrency.test.ts`：并发预留，SQLite + PG。
- `apps/api/test/snapshot-version.test.ts`：版本号失效、批量标签/分面查询。
- `apps/api/test/job-runner-abort.test.ts`：超时/取消后 handler 停止。

### 消融纪律

任何新护栏都必须做一次消融：移除判断 → 测试转红 → 恢复后 `md5`/`cmp` 逐字节一致。禁止只写测试不验证它会咬人。

## 8. 需要确认的决策点

1. **破坏性任务是否一律 admin？** 建议是；如果运维脚本需要 write 令牌执行，另开 `ops` scope，而不是放宽 `write`。
2. **是否引入 Redis？** 单实例 lite 可继续进程内限流/缓存；standard 多副本前必须决定 Redis 或“单实例部署”约束。
3. **视频是否切到 db-only？** 需要回填校验、双读对账和回滚开关；建议先完成 P2 的收敛项再切换默认值。
4. **`/api/storage` 是否拆公开/管理两条路由？** 建议拆，避免在同一个响应里做条件投影导致缓存键复杂化。
5. **OpenAPI 覆盖率目标**：write/admin 100%、public Top 20，还是全量 277？目标不同，工作量差 2–3 倍。

## 9. 证据索引

| 文件 | 关键行 | 用途 |
|---|---|---|
| `apps/api/src/routes/jobs.ts` | 58-60、108-111 | 入队 scope/限流、列表无分页 |
| `packages/core/src/mcp-schemas.ts` | 215-230、547 | `RunJobInput` 含破坏性 kind；请求绑定数 |
| `packages/core/src/rest-responses.ts` | 945 | 响应绑定数 |
| `packages/core/src/job-payloads.ts` | 87-91 | `backup_restore` 只校验非空 |
| `apps/api/src/jobs.ts` | 141、195-203、250-258、263-282、490-531、704-713、1351-1374 | 手动专属、预算看门狗、串行 Runner、恢复读文件 |
| `apps/api/src/routes/identity.ts` | 22-25、53-65 | token 场景跳过签名 |
| `apps/api/src/routes/shared.ts` | 343-346 | `identityAllowed` 只排除 anonymous |
| `apps/api/src/llm-quota.ts` | 96-125 | 配额 check-then-act |
| `apps/api/src/routes/plugin-audit.ts` | 55-58、462、471-472、891-893 | 审计上限、无限流、ai-heal 限流 |
| `apps/api/src/plugin-audit.ts` | 105-110、242-249 | 默认抽样/并发/超时 |
| `apps/api/src/routes/telemetry.ts` | 57-91、159 | events 字段无上限、无路由限流 |
| `apps/api/src/routes/workspaces.ts` | 164-167、199-201 | 空间创建无配额 |
| `apps/api/src/routes/rank.ts` | 191-203 | federated public + 大向量 |
| `apps/api/src/storage.ts` | 72、93-98、117-132、144-159、165-243、265-368、490-491、837-876 | 快照读/写、视频保护、存储分发 |
| `apps/api/src/routes/navsphere.ts` | 44、54 | `/api/storage` 读写 scope |
| `apps/api/src/routes/health.ts` | 16-33、44-77 | health 调 stats；ready 真 ping |
| `apps/api/src/routes/stats.ts` | 130-150 | SSE 3s 调 stats |
| `packages/store/src/repository/sites.ts` | 68、114-121、139-146、435-479 | 排序、全量站点、相关子查询、updateSite 双读 |
| `packages/store/src/repository/stats.ts` | 11-32 | 单条聚合 COUNT |
| `packages/store/src/repository/dashboard.ts` | 22-67、114、122、130、149、153、200-208、220-224、275-277 | dashboard 多组 COUNT |
| `packages/store/src/search.ts` | 596-601、609、630、644-649、707-713 | exact/pinyin 前导通配符 |
| `packages/store/src/sql-like.ts` | 16-18 | `%value%` 生成 |
| `packages/store/src/migrate.ts` | 258-270、303-324 | 已闭环迁移/索引 |
| `apps/api/src/metrics.ts` | 87、239、295、319 | 现有指标，无任务指标 |
| `apps/api/src/openapi.ts` | 130-208 | 绑定/回退逻辑 |
| `packages/core/src/route-policy.ts` | 67-75 | 匿名写面台账 |
| `apps/api/test/route-policy.test.ts` | 82+ | 匿名写快照 |
| `apps/web-overlay/src/app/api/media/proxy/route.ts` | 14-22、100-157 | LRU 条目上限、全量读入 |
| `apps/web-overlay/src/app/api/videos/bili-stream/route.ts` | 51-55、89-92 | 无超时透传 |
| `docker/docker-compose.yml` | 134-137 | `/api/ready` 健康检查 |
| `.github/workflows/ci.yml` | 163-200 | PG 套件 |
| `apps/api/src/config.ts` | 498、512 | CORS 默认 `*`、限流默认 300/min |

---

**结论**：这不是一次“重写后端”的方案。现有边界可以保留，优先做五件小而关键的事：给破坏性任务分级、把 token 与身份绑定、把配额变成原子预留、给出站/公开写加预算、给代理加字节上限。完成这些后，再按 P1 的顺序拆快照与搜索的读放大、拆队列串行；P2 的契约/可观测性/多实例项可以与业务迭代并行推进。
