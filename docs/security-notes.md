# NavHub 安全记录（Security Notes）

> 维护原则：只记录**已核实的事实**与**本仓的实际处置**，每条附证据来源与日期。
> 新增安全事件 / 依赖公告按时间倒序追加在「事件记录」章节。

## 一、next-auth v5 beta 线 CVE 状态（2026-10-16 核实）

### 事实

| 项 | 内容 |
| --- | --- |
| 本仓依赖 | `next-auth@5.0.0-beta.32`（`apps/web/package.json`） |
| v5 发布线状态 | **自 2022 年公测至今从未发布稳定版**；npm `latest` 标签仍为 4.24.15（v4 线），v5 仅存在于 `beta` tag |
| 维护状态 | 2025-09 起移交 Better Auth 团队；官方维护建议新项目使用 Better Auth |
| 2026-07 安全公告 | 一批次含**两个 CVSS 9.1 漏洞，其中一个为 fail-open 认证绕过，仅影响 v5 beta 线** |
| 检索日期 | 2026-10-16（执行升级前建议复核一次最新状态） |

### 本仓处置（升级改造方案 P0）

1. **应用层第二道防线已就位并被测试锁定**（不依赖 next-auth 内部校验路径）：
   - `src/middleware.ts`：`/admin/:path*` 未登录 307 回登录页；
   - `src/lib/auth.ts` `verifyAdminSession()`：管理员身份 + 白名单双重判定，生产 fail-closed；
   - `src/lib/auth.config.ts` `authorized` 回调：白名单未配置时生产拒绝、开发放行。
   - 以上行为由 `apps/web/test/auth-guard.test.ts` 14 个用例锁定，任何削弱直接 CI 红灯。
2. **P0-1 / P0-2 已消除「默认配置即失守」的两个放大器**：
   - 生产无显式 secret 拒绝启动（session 签名密钥不再回退到仓库内公开值）；
   - 生产默认关闭快捷登录与默认口令（`NAVHUB_ALLOW_DEFAULT_PASSWORD=1` 可显式覆盖并告警）。
3. **待办（单独立项，不夹带其他升级）**：评估迁移 Better Auth 或回退 `next-auth@4.24.15`。
   这是 4.x 级改动，需专门排期与全量鉴权回归（登录 / session / middleware / admin API 四层）。

### 临时缓解建议（迁移排期前）

- 公网部署时在反代层对 `/api/auth/*` 增加额外访问控制（IP 白名单或速率限制）；
- 保持 `NAVHUB_ADMIN_IDS` 显式配置，不依赖「未配置时开发放行」的兜底。

---

## 二、已处置问题台账（2026-10-16，升级改造方案执行）

| 编号 | 问题 | 处置 | 验证 |
| --- | --- | --- | --- |
| P0-1 | `auth.config.ts` 硬编码 authSecret 回退值公开可查，生产未设 secret 可伪造 session | 生产运行期无显式 secret 导入即抛错；`next build` 期豁免；compose 改由 entrypoint 生成并持久化到 `/data/.session-secret`（api/web 共享） | `auth-guard.test.ts` 5 个 secret 用例 |
| P0-2 | `auth.ts` 默认口令分支无生产判断（`admin/admin123/navhub/123456`），叠加 `NAVHUB_AUTH_REQUIRED` 默认 false = 公开部署可登录后台 | 不安全登录通道（bypass + 默认口令）生产总闸 `allowInsecureLogin`，仅 dev 或显式 `NAVHUB_ALLOW_DEFAULT_PASSWORD=1` 开启，后者启动打印警告 | `auth-guard.test.ts` 守卫矩阵 7 例 + `.env.example` 文档 |
| P0-3 | API 侧 secret 生产校验漏掉 compose 历史默认值（41 字符通过长度检查） | `config.ts` 屏蔽名单补 `change-me-in-production-min-32-chars-secret-key` | 全量测试 + 启动期行为 |

---

## 三、长期安全基线（防回归检查单）

- [ ] `NAVHUB_ADMIN_IDS` 生产必配（白名单 fail-closed 的最后一道保险）
- [ ] `NAVHUB_SESSION_SECRET` / `AUTH_SECRET` 生产必配（>=32 随机；容器部署由 entrypoint 自举）
- [ ] `NAVHUB_CORS_ORIGINS` 生产收紧为前端域名（默认 `*`）
- [ ] `NAVHUB_AUTH_REQUIRED=true` + 引导 token 流程创建正式凭据
- [ ] `NAVHUB_MCP_TOKEN` / `NAVHUB_STORAGE_TOKEN` 生产必改（http 适配器写接口）
- [ ] 定期 `pnpm audit --audit-level high`（CI audit job 转硬门禁的进度见 ci.yml）
