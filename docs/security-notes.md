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
- [ ] 执行 AI / 用户代码的容器**不许**带 `allow-same-origin`，全仓**不许**有 `eval` / `new Function`
      （由 `opaque-code-sandbox-guard.test.ts` 锁定；机制见 [`CODE-EXECUTION-ISOLATION-2026-11-01.md`](CODE-EXECUTION-ISOLATION-2026-11-01.md)）
- [ ] **凭据不进 URL**（query 会留在浏览器历史与反代/服务端访问日志），**匿名可访问的出站通道必须有预算**
      （否则出口 IP 被目标站拉黑的代价由全体真实用户承担）；带凭据的响应必须 `no-store`，
      缓存必须按「真正出站的那把凭据」分桶（由 `bili-parse-route.test.ts` + `video-bilibili-hd-parser.test.ts`
      的 A3 组锁定；机制见 [`BILI-PARSE-CREDENTIAL-BUDGET-2026-11-01.md`](BILI-PARSE-CREDENTIAL-BUDGET-2026-11-01.md)）

---

## 四、2026-10-17 全库审查：身份信任模型与 SSRF 加固

| 级别 | 问题 | 处置 | 验证 |
| --- | --- | --- | --- |
| P0 | Web 后台：jwt/session 回调把 `role` 默认成 `admin`，`verifyAdminSession` 又凭 `role === 'admin'` 放行 → 任何 GitHub 登录用户即管理员（API 路由全部失守） | 去掉 role 默认值；只认 Credentials 固定身份（id/email），历史旧 session 一并失效 | `admin-auth-source-guard.test.ts` |
| P0 | 中枢身份（`userId`/`anonId`）是纯字符串，任何持票人都能自称任意身份读写他人数据（IDOR） | 新增可选 `NAVHUB_IDENTITY_SECRET`（见下节） | `identity-signature.test.ts` 9 例 + 两侧共用同一 HMAC 向量 |
| P1 | 投稿审核「拒绝」分支只校验登录；`GET /api/submissions` 完全无鉴权 | PATCH 入口统一 `requireAdmin`；GET 补门禁 | 源码守卫 |
| P1 | `createGuardedApiExecutor` 用默认 fetch 自动跟随重定向，`isSafeUrl` 只看首跳 → 公网 URL 302 到云元数据即可读凭证；`localhost.`、`[::ffff:127.0.0.1]` 亦绕过 | `redirect: 'manual'` + 逐跳重校验（上限 3 跳）；hostname 归一化与等价写法封堵 | `packages/core/test/ssrf-guard.test.ts` 13 例 |
| P2 | 工作台布局 JSON 损坏时回退默认模板并立即写回同一 key → 现场静默丢失 | 备份为 `<key>.corrupt.<ts>` + 抑制首次回写 | `workspace-storage.test.ts` |
| P2 | `Promise.race` + `setTimeout` 超时写法在任务先完成时不清定时器（持闭包、拖住事件循环） | `packages/ai/src/with-timeout.ts` 统一封装 | `with-timeout.test.ts`（假定时器断言 timer 数归零） |
| P2 | 兜底注入的 `<link rel=prefetch/prerender>` 卸载时不清理，跨路由累积 | 打 `data-navhub-speculation` 标记后按标记清理（**不按** `rel=prefetch` 全删，Next 自己也在用） | `prerender-cleanup-guard.test.ts` |

### 身份签名（`NAVHUB_IDENTITY_SECRET`）的边界

- **开启条件**：中枢与 Web 端配同名密钥。生产环境（`NODE_ENV=production`）且
  `NAVHUB_AUTH_REQUIRED=true` 时必须配置至少 32 个非空白字符，否则中枢在
  `buildServer` 装配路由前拒绝启动；非生产或开放模式不强制，保持历史行为。
- **生产强校验**：`apps/api/src/security-readiness.ts` 在 `buildServer` 入口检查
  `authRequired + identitySecret`，防止「已开启鉴权但忘记配签名」导致任意持票人
  冒充其他 `userId`。配置错误会在启动阶段暴露，而不是等运行期数据被越权读写。
- **保护范围**：凡是中枢能解析出身份的请求（Header / Query / Body），都必须携带
  `x-navhub-identity-signature = HMAC-SHA256(secret, identity)`，由 Web 的 `/api/hub/*`
  代理自动附带；缺失或错误一律 401，且签名与身份强绑定（拿 A 的签名不能冒充 B）。
- **仍未覆盖**：绕过 Web 代理、直接以「无身份」调用的路径不受本机制约束（与历史一致）；
  密钥轮换需要中枢与 Web 同时改并重启。
- **部署前提**：代理与中枢之间的链路必须可信（同机 / 内网）；密钥泄露等于身份可伪造。
- **其余基线**：`NAVHUB_TRUST_PROXY` 只应在前置反向代理**会覆写** `X-Forwarded-For` 时开启，
  否则客户端可伪造 XFF 绕过中枢限流（Web 代理会显式转发 XFF，见 `hub-proxy` 注释）。
  开启方式也分档：`1`/`true` 采信的是**链首**（客户端自报）条目，等于逐请求换限流桶；
  正确配法是可信代理网段列表（proxy-addr 语法，如 `"loopback, 172.16.0.0/12"`），
  只有 socket 对端落在列表内才解析 XFF，`req.ip` 取代理实际看到的那一跳。
  数字值（`2` 等）不是跳数——Fastify 不认，会让 XFF 整段失效，配置层直接拒绝启动。

---

## 五、2026-11-01：AI / 用户代码曾在页面同源 realm 里执行

| 项 | 内容 |
| --- | --- |
| 事实 | 视频页两个「即时运行」面板用 `new Function` 在**页面自己的 realm** 执行 AI 生成与用户粘贴的代码：可读本域 `localStorage`（含会话）、拿 cookie、伪造 `fetch`、改写 DOM。代码来源是输入框，属于最低信任输入 |
| 附带发现 | 本仓 CSP 是 `script-src 'self' 'unsafe-inline'`，**无** `'unsafe-eval'` ⇒ 这段代码在真人浏览器里**从来没跑通过**，报的是 CSP 违规而不是用户代码的错误。不是「安全 vs 能用」的取舍，两边本来都坏 |
| 处置 | 执行面整体搬进 `<iframe sandbox="allow-scripts">`（**不给** `allow-same-origin` ⇒ 不透明源）。全仓 `eval` / `new Function` 归零：代码经 postMessage 进沙盒后交给 `document.createElement('script')` 的 `textContent`，由浏览器按普通内联脚本编译，**不需要放宽 CSP**。环境不具备时 `stopReason` 如实申报「未执行」，**不降级回同源** |
| 验证 | `opaque-code-sandbox-guard.test.ts`（A–F 六组 29 条：零求值 / 容器无 `allow-same-origin` / 回信验 `event.source` / 不可用时不跑 / 行为 / 判据自证）；真人浏览器按本仓 CSP 实测：`localStorage` 与 `parent` DOM 均 `SecurityError`、帧 origin 为 `null`、`</script>` 贴进代码越不出边界；9 条消融全部变红。机制与契约见 [`CODE-EXECUTION-ISOLATION-2026-11-01.md`](CODE-EXECUTION-ISOLATION-2026-11-01.md) |
| 已知残留 | 沙盒 iframe 与页面共用主线程 ⇒ 同步死循环仍会卡住标签页（改造前后相同，未变差）。换 Worker 需把 CSP `worker-src` 放开到 `blob:`，**为省一次卡顿去放宽安全策略不做** |


---

## 六、2026-11-01：B 站解析把访客凭据写进 URL，且匿名出站无闸门

| 项 | 内容 |
| --- | --- |
| 事实 | `/api/videos/bili-parse` 的 GET 直接收 `access_key` 并拼进上游请求 ⇒ 访客的 B 站登录凭据留在**浏览器历史、反代与服务端访问日志、任何一层的错误上报**里。同一条通道**匿名可访问且没有闸门**：一次解析最多顺序打 6 个第三方上游，任何人都能把本站当免费解析代理，而**出口 IP 被目标站拉黑的是我们** |
| 附带发现 | ① 解析缓存只分 `custom\|default` 两桶 ⇒ 两把不同账号的 key 共用同一份结果，而结果里是带 `deadline`/`uipk` 的**可播放签名流地址**（跨账号 bearer capability 泄漏）。② 全仓只有星之阁引擎消费 `access_key`，也就是说「贴 key」这一动作的真实含义是**把账号交给一个不受我们控制的第三方**，而界面从未说过 |
| 处置 | ① `access_key` 只允许走 POST body；GET 一旦发现 query 里有 key 就在**拿预算、进解析链之前** `400 code=credential_in_query`。② 接既有 `StreamBudget` 原语（与 `bili-stream` 同一套，不新造限流器）：按调用方分桶限流 `429 rate_limited`、进程并发满 `503 saturated`，两者分开报并带 `Retry-After`；额度在 `finally` 归还。③ 缓存键改为按**真正出站的那把 key** 的 SHA-256 前 8 字节分桶，key 明文不进缓存键；没有 WebCrypto 时对带 key 的请求**一律不缓存**（安全侧失败，不是降级）。④ 出站闸门 `resolveOutboundAccessKey()`：**默认不把访客 key 交给第三方**，只有部署显式 `NAVHUB_BILI_FORWARD_USER_KEY=1` 才转发；被拦下时结果带 `accessKeyIgnored`，界面写明「等同于 B 站登录凭据 / 默认不出站 / 需要管理员显式开启」 |
| 验证 | 路由守卫 14 条 + 解析器 A3 组 9 条 + compose 透传守卫 8 条；14 条消融逐条变红并按 md5 还原。真人浏览器 + 独立进程实测：query 带 key ⇒ 400；页面里 `fetch` 拦截器记到 `POST /api/videos/bili-parse`（无 query，key 在 body）；同调用方 12 次后 429 + `retry-after: 10`，换一个 XFF 立刻回 200；额度打满后页面出现「解析太频繁…等十几秒再点【立即换源】」而非静默降画质；`NAVHUB_BILI_FORWARD_USER_KEY=1` 下两把 key 各自重新出站、同 key 命中同桶。机制与残留见 [`BILI-PARSE-CREDENTIAL-BUDGET-2026-11-01.md`](BILI-PARSE-CREDENTIAL-BUDGET-2026-11-01.md) |
| 实测中修出的第二条 | 兜底的 `iframe_fallback` 结果原先不带 `accessKeyIgnored` ⇒ 被限流后徽标继续显示「VIP 密钥已启用」，而请求根本没进解析器。已改为「未被使用」，并由消融第 14 条钉住 |
| 已知残留 | 预算按**进程**计，多副本总量 ≈ 副本数 × 阈值；`callerKey` 取自 `x-forwarded-for` 首段，未经信任反代时**可伪造**，只当限流桶、绝不当身份（前反代必须覆写该头，与 `bili-stream` 同一前提）；桶摘要不是加密承诺，不可当可公开的反查依据 |
