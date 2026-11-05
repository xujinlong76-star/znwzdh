# 用户自助账号生命周期 + 邮件投递（2026-11-01）

> 目标：把「只有管理员口令 + GitHub OAuth、普通用户无法开户/找回、邮件永远发不出去」
> 的站点，升级为「访客可自助注册、验证邮箱、登录、找回密码」的商用级站点。

## 1. 为什么做这件事

扫描（`PROJECT-PROGRESS-SCAN-2026-10-28`、`deep-scan-report-2026-10-31`）显示仓库完成度约 85%，
真正的商用缺口集中在四处：**账号自助、多语言、商业化、通知外发**。其中账号自助是**第一硬门槛**：

- `users.password_hash` 列存在但**从未被使用**——`CredentialsProvider` 只认环境变量管理员口令与静态 token；
- 无注册、无邮箱验证、无找回密码，普通用户无法成为用户；
- 通知 outbox 的 `email`/`push` 渠道**声明但从未投递**：`relayNotifications` 只投递 `inapp`，
  email 行入队即 `deferred` 且永不重试，属静默失败。

注册、邮箱验证、找回密码三者强耦合（后两者都依赖邮件投递），因此作为一个完整功能交付，
不做半截。

## 2. 交付范围

| 层 | 文件 | 内容 |
|---|---|---|
| core | `packages/core/src/password.ts` | scrypt 口令哈希/校验、令牌生成、口令策略 |
| ai | `packages/ai/src/mail.ts` | 邮件投递适配器（SMTP / 日志降级） |
| store | `schema.ts` / `migrate.ts` | `auth_tokens` 表、`users.email_verified` 列 |
| store | `repository/auth-tokens.ts` | 一次性令牌的创建与**原子消费** |
| store | `repository/users.ts` | 注册 / 按邮箱查 / 验密 / 改密 / 标记已验证 |
| store | `repository/notifications.ts` | email 渠道真实投递 + 退避重试 |
| api | `routes/account.ts` | register / verify-email / resend / forgot / reset / login / email-status |
| web | `app/auth/{signup,verify-email,forgot-password,reset-password}` | 四个前端页面 |
| web | `lib/auth.ts` | next-auth 凭证登录接入真实用户校验 |

## 3. 关键安全决策

### 3.1 口令存储：scrypt，不是 SHA-256

依据 OWASP Password Storage Cheat Sheet：

- 首选 Argon2id；Node 内置 `crypto` 无 argon2，退而取 **scrypt**（同为 memory-hard）；
- 参数 `N=2^14, r=8, p=1`（16 MiB），单次哈希百毫秒级，抗 GPU 爆破；
- 每口令独立随机盐；比较用 `timingSafeEqual`；
- 存储格式自描述：`scrypt$N$r$p$salt$hash`，便于将来换算法/升参数。

### 3.2 令牌：只存哈希 + 一次性消费

- 验证/重置令牌的明文只出现在邮件里；库里存 `sha256(token)`，库泄露也无法直接冒用；
- 消费用**单条原子 UPDATE**（`WHERE ... consumed_at IS NULL AND expires_at > now`），
  避免「先查后改」的重放窗口——两个并发请求不能各重置一次密码；
- `purpose` 隔离：邮箱验证令牌不能当密码重置用（CHECK 约束 + 查询条件双重隔离）；
- 过期即失效：验证链接 24h、重置链接 1h。

### 3.3 防账号枚举

- 登录对「用户不存在」与「密码错误」返回同一 `null`；用户不存在时仍做一次哈希校验抹平时序；
- 忘记密码对「邮箱已注册」与「邮箱不存在」返回同一文案。

### 3.4 邮件投递：未配置不阻断，生产必须配

- 未配 `NAVHUB_SMTP_HOST` 时退化为**日志投递**（正文打到服务端日志），注册/重置流程仍可用；
- 配置后自动切换真实 SMTP（nodemailer）；投递失败返回 `ok:false`，由 outbox 退避重试，
  **绝不让一封邮件拖垮注册/重置事务**。

## 4. 配置

```bash
# 生产必须配置（未配置则邮件只打日志，用户收不到）
NAVHUB_SMTP_HOST=smtp.example.com
NAVHUB_SMTP_PORT=587
NAVHUB_SMTP_SECURE=false        # 465 端口用 true
NAVHUB_SMTP_USER=...
NAVHUB_SMTP_PASS=...
NAVHUB_SMTP_FROM=山羊胡 <noreply@example.com>
```

前端通过 `/api/hub/account/*` 访问（BFF 代理到中枢）。

## 5. 验证

| 测试 | 覆盖 |
|---|---|
| `packages/core/test/password.test.ts` | 哈希/校验/令牌/策略 |
| `packages/store/test/auth-accounts.test.ts` | 注册/验证/登录/重置/用途隔离/过期 |
| `packages/store/test/notification-email-relay.test.ts` | email 渠道投递/失败退避/未注入不误投 |
| `apps/api/test/account-api.test.ts` | 全链路 API（捕获式假邮件器驱动令牌） |

全部通过。
