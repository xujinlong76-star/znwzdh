# 12 · 用户中心（/me · 收藏 · 历史 · 画像 · 数据主权）

> 域文档。覆盖 `/me`、`/me/history`、`/me/data`、`/favorites`、`/preferences` 五个页面，
> 以及 `routes/{me,favorites,history,profile,identity,vault,workspaces,ai-config,telemetry}.ts`
> 与用户域 13 张表。**升级方案与实施记录**见 [USER-CENTER-UPGRADE-PLAN-2026-10-22](../USER-CENTER-UPGRADE-PLAN-2026-10-22.md)。

## 1. 端点清单

### 1.1 BFF（`apps/web-overlay/src/app/api/me/[[...path]]`）——会话派生身份
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/me` | 概览：身份/计数/画像/金库/AI 配置存在性/别名/设置（6 次往返，7 个标量子查询） |
| GET | `/api/me/export` | 全量导出（脱敏；不含密钥与金库密文），5/min |
| GET | `/api/me/export/bookmarks.html` | 收藏 → Netscape 书签 HTML（可导入浏览器），5/min |
| GET | `/api/me/activity` | 我的操作记录（audit_logs 按 actor，只暴露 action/target/at），60/min |
| PATCH | `/api/me/settings` | `personalizationEnabled` |
| POST | `/api/me/merge` | 匿名数据并入登录身份（需 `x-navhub-anon-signature` + 绑定 cookie 校验） |
| POST | `/api/me/favorites/sync` | **批量同步**：ops(≤500) + since 游标，返回增量（含墓碑）+ site join，120/min |
| DELETE | `/api/me` | 注销（`{confirm:"DELETE"}`；匿名 403），3/min |

### 1.2 中枢其余用户域端点
| 组 | 端点 | 鉴权 |
| --- | --- | --- |
| 收藏 CRUD | `GET/POST/DELETE /api/favorites`、`PATCH /api/favorites/:siteId`、`/folders*` | `identityTrusted`；写 600/min |
| 搜索历史 | `GET/DELETE /api/search-history`、`DELETE /:id`（limit 默认 10 / 上限 50） | `identityTrusted` |
| 画像 | `GET /api/profile?explain=1`、`DELETE /api/profile`、`DELETE /api/profile/signals/:kind` | `identityTrusted` |
| 金库 | `GET/PUT/DELETE /api/vault/sync`（PUT 带 `version`/`If-Match`，冲突 409+ETag） | `identityTrusted` |
| 工作区 | `/api/workspaces` 5 条 | `identityTrusted`；存储见 §3.3 |
| 个人 AI | `GET/PUT/DELETE /api/user/ai/config`（密钥加密信封） | `identityTrusted` + 5-10/min |
| 身份 | `POST /api/users/sync` | `identityAllowed`（authRequired 时须持票） |
| 遥测 | `POST /api/events`（**必须走 `identityOf`，不得直读 body**） | `identityTrusted` |

## 2. 身份与信任链（改动前必读）

```
NextAuth 会话 ─► canonicalUserId() ─► BFF 签名 ─► preValidation 校验 ─► 路由 identityTrusted
匿名 anon-<uuid> ─► /api/hub/* 代理 ─► resolveHubIdentity（会话优先）──► 同上
```

**五条不可破坏的不变量**
1. 任何路由取身份必须 `identityOf` + `identityTrusted` 成对出现（`routes/shared.ts:290-309` 有反例注释）。
2. 签名对象是 `identityOf` **截断 64 字符的原始身份**；canonical 解析必须在签名校验**之后**。
3. `/api/hub/*` 代理对**会话**优先：有会话一律用 canonical 身份并剥离客户端自称头；无会话仅允许 `anon-*`，自称 `github:xxx` 一律 403（`lib/hub-identity-guard.ts`）。
4. 匿名绑定：`navhub_anon=<anonId>.<hmac>`（HttpOnly/Lax/1y）由代理写入；`/api/me/merge` 校验 body.anonId 与绑定一致，不一致 401。
5. BFF 不得转发客户端自报的身份头（`api/me/route.ts` 头白名单构造）。

## 3. 数据模型（用户域 13 张表）

| 表 | 关键事实 |
| --- | --- |
| `users` | `username` 唯一；`email` 部分唯一（非 NULL 且非空）；**email 不参与身份绑定**（只认 provider id / username，防接管） |
| `favorites` | UNIQUE(user_id, site_id)；**软删**（`deleted_at` 墓碑）；`(user_id, created_at)` + `(user_id, updated_at)` 索引 |
| `favorite_folders` | 无 `(user_id,name)` 唯一；`sort` 创建恒 0 |
| `search_history` | 分页索引 `(user_id, created_at DESC, id DESC)`；硬删 |
| `user_profiles` | 整行 JSON 全量覆盖；60s 节流聚合（进程内 Map） |
| `user_settings` | `personalization_enabled` + `favorite_signal_cutoff` |
| `user_vault_sync` | **仅密文**（DIY 布局备份）；版本冲突 409 |
| `user_workspace_blobs` | 工作区明文（独立表，命名不含 vault）；键 `workspaces:<id>` / `ws_members:<id>:<wsId>` |
| `events` | 画像唯一原料；180 天 retention；`(identity, created_at)` 索引 |
| `identity_aliases` / `identity_merges` | 合并 5 跳上限；幂等靠 `UNIQUE(source,target)` |
| `api_tokens` | sha256 落库；**无 owner 列**（不可下放终端用户） |
| `sessions` | 全库零读写的死表（注销时会清理） |
| `plugin_*`（installs/stars/reviews） | 注销时全删（评价正文属用户内容） |

## 4. 收藏同步语义（M1）

- **登录用户**：`POST /api/me/favorites/sync`，一次提交 ops（>500 由客户端分片，每片用同一 `since`）；响应 = 自 `since` 以来的行（**含墓碑**）+ site join。
- **匿名用户**：新端点仅会话身份，匿名仍走旧逐条端点（`/api/hub/api/favorites`）。
- **LWW**：`op.at` 不大于该行 `updated_at` 即跳过；`add` 是覆盖（清墓碑）、`update` 是补丁、`remove` 落墓碑（对新行也落，保证「先删后加」另一端可感知）。
- **落本地**：`since=0` 全量 → `mergeCloudFavorites`（云端覆盖）；`since>0` 增量 → `applyFavoriteDelta`（按 siteId upsert / 墓碑删除，白名单字段，**禁止**用全量合并）。
- **游标**：`navhub.favorites.sync.v1.<identity>`，仅全部请求成功后推进；`resetLocal` 一并清除。
- **失败语义**：`cloud`/`nextItems` 必须为 null（空数组只表示云端确实为空）；401 文案是「登录已过期」。

## 5. 数据主权

- **导出**：用户/收藏/文件夹/历史(≤5000)/画像/设置/AI 配置(脱敏)/安装/星标/评价/工作区/事件聚合/金库版本。
- **注销**：12 表 + 评价正文 + sessions + llm_usage 匿名化 + 工作区记录 + OAuth `users` 行（仅 id 含 `:` 的 canonical 形态，内置管理员不动）。
- **保留**：`events` 180 天、`audit_logs` 365 天；用户数据表无 TTL（产品决策）。

## 6. 测试矩阵

| 层 | 文件 | 说明 |
| --- | --- | --- |
| API | `me-api` / `me-data-api` / `me-favorites-sync` | 概览/导出/注销/合并/批量同步 |
| API | `identity-{signature,plane-extensions,plugin-impersonation}`、`end-user-identity-plane` | 身份平面矩阵（匿名/持票/签名/会话） |
| Web | `favorites-{sync,merge,storage,filter,shared-state}` | 同步双分支/墓碑/游标/损坏闸门/筛选/多实例联动 |
| Web | `me-pages` / `me-degrade-states` / `main-landmark`、`hub-identity-guard` | 页面接线/降级三态/地标/代理裁决 |
| Store | `favorites-sync-batch` / `users-binding` / `identity-merge` / `user-data` / `workspace-blobs` | 批量语义/绑定/合并/导出注销/迁移 |

## 7. 已知风险

| 风险 | 说明 |
| --- | --- |
| 匿名绑定是 TOFU | 首次接触即绑定；彻底解法是 BFF 服务端签发 HttpOnly anonId（未做） |
| 扩展/MCP 直连 | 走 `/api/hub/*` 时若无会话，只能使用 anon 域身份 |
| 画像节流进程内 | 多实例各算各的；重启后冷启动集中聚合 |
| 收藏无「只推脏条目」 | 每次进入仍会把本地全量当 ops 重发（LWW 跳过，正确但不经济） |
