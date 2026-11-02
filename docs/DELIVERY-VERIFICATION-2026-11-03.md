# 交付验证记录 · Feature 1 & 2（2026-11-03）

> 本文件只记录**可复跑的验证事实**，不写感想。每条都给出命令或路径。

## 交付物清单

### Feature 1：用户自助账号生命周期 + 邮件投递

| 类型 | 文件 |
|---|---|
| 核心 | `packages/core/src/password.ts`（scrypt 哈希/校验、令牌生成、口令策略） |
| 邮件 | `packages/ai/src/mail.ts`（SMTP 真实投递 + 未配置时日志退化） |
| 存储 | `packages/store/src/repository/auth-tokens.ts`（令牌只存哈希、单条原子消费） |
| 存储 | `packages/store/src/repository/users.ts`（注册/登录/改密/验证状态） |
| 存储 | `packages/store/src/repository/notifications.ts`（email 渠道 relay + 退避重试） |
| 存储 | `packages/store/src/schema.ts`、`migrate.ts`（`auth_tokens` 表、`users.email_verified`） |
| API | `apps/api/src/routes/account.ts`（6 个 POST + 1 个 GET，全 public scope、限流） |
| API | `apps/api/src/context.ts`（注入 `mail`）、`apps/api/src/jobs.ts`（注入发送器） |
| 前端 | `apps/web-overlay/src/app/auth/{signup,verify-email,forgot-password,reset-password}/` |
| 前端 | `apps/web-overlay/src/lib/auth.ts`（credentials 走 `/api/account/login`）、`signin/page.tsx` |
| 文档 | `docs/ACCOUNT-LIFECYCLE-2026-11-01.md`、`README.md` 第 7 节、`.env.example` |

### Feature 2：站点健康度历史 + 死链替代回退

| 类型 | 文件 |
|---|---|
| API | `apps/api/src/routes/sites.ts` → `GET /api/sites/:id/health-history` |
| 前端 API | `apps/web-overlay/src/lib/navhub-api.ts` → `fetchSiteHealthHistory` / `fetchSiteAlternatives` |
| 前端 UI | `apps/web-overlay/src/components/site-detail-view.tsx` → `HealthSparkline` + 死链替代回退区块 |
| 文档 | `docs/SITE-HEALTH-HISTORY-2026-11-01.md` |

## 自动化测试（可复跑）

```
pnpm vitest run \
  packages/core/test/password.test.ts \
  packages/store/test/auth-accounts.test.ts \
  packages/store/test/notification-email-relay.test.ts \
  apps/api/test/account-api.test.ts \
  apps/api/test/site-health-history.test.ts
```

结果：**5 个文件 / 34 项全部通过**。

其他相关门禁（均通过）：

| 命令 | 结果 |
|---|---|
| `pnpm --filter @navhub/api exec tsc --noEmit` | **0 错误** |
| `pnpm --filter @navhub/core exec tsc --noEmit`（过滤我的文件） | 无错误 |
| `pnpm --filter @navhub/store exec tsc --noEmit`（过滤我的文件） | 无错误 |
| `node scripts/check-web-overlay.mjs` | OK，1028 个覆盖层文件一致 |
| `node scripts/gen-hub-route-policy.mjs --check` | OK，288 条路由 |
| `node scripts/check-committed-refs.mjs` | OK，2122 个文件无悬空引用 |
| `apps/api/test/response-contracts.test.ts` | 49 项通过（新路由已登记豁免） |
| `apps/web/test/route-titles.test.ts` + `main-landmark.test.ts` | 38 项通过 |

## 真实服务端到端验证

服务：API `http://127.0.0.1:8787`、Web `http://127.0.0.1:3000`（运行中进程）。

### 账号生命周期

| 请求 | 结果 |
|---|---|
| `GET /api/account/email-status?email=none@example.com` | 200 `{"ok":true,"verified":false,"registered":false}` |
| `POST /api/account/register`（真实新邮箱） | **201**，返回 `user.id` / `username` / `email` |
| `POST /api/account/login` 正确口令 | **200**，含 `role:"user"`、`emailVerified:false` |
| `POST /api/account/login` 错误口令 | **401** |
| `POST /api/account/login` 不存在的用户 | **401**（同状态 → 防账号枚举生效） |
| `GET /auth/signup` `/auth/forgot-password` `/auth/reset-password` `/auth/verify-email` | 全部 **200** |

### 站点健康历史

| 请求 | 结果 |
|---|---|
| `GET /api/sites/0035b857-030f-46f9-b074-c0502fbc2497/health-history?limit=10` | **200**，6 条真实巡检，`checkedAt` 严格递增 |

> 注：用分类 id 请求该端点返回 404——端点先校验站点存在性，这是正确行为。

### 清理

端到端产生的测试账号已从真实库 `data/navhub.db` 删除，`e2e-%@example.com` 残留计数为 **0**。

## 已知的非本次问题

以下失败来自**并行会话的未完成改动**，不在本次交付范围，未触碰：

- `packages/mcp` 的 import-boundary 违规（`handlers/*.ts`、`http-server.ts`、`stdio.ts` 引用 `@navhub/api`）
- `packages/mcp/test/http-body-encoding.test.ts`、`mcp-http.test.ts`（模块已删除）、`mcp.test.ts`
- `packages/core/src/speculative-intent/hash-calc.ts` 的 `noUncheckedIndexedAccess` 类型错误
