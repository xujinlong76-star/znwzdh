# Agnes 大模型接入与双端模型配置 · 开发方案

> 版本：V1（2026-10-19）  
> 状态：**待确认，未写任何业务代码**  
> 目标读者：项目维护者  
> 关联文档：`docs/UPGRADE-PROPOSAL-V3-2026-10-19.md`

---

## 0. 结论先行（TL;DR）

1. **现状比预期简单**：全仓只有一条 LLM 链路——站点元数据富化 `enrichUrl()`，只读环境变量（默认 DeepSeek），无数据库配置层、无管理界面、无用户级覆盖。所谓「管理端站点设置」是上游演示页，保存请求打到不存在的 `/api/site`，**静默失败**。
2. **接入 Agnes 无需适配层**：Agnes 3.0 Flash 提供 OpenAI 兼容的 `POST /v1/chat/completions`，现有客户端拼接方式（`baseUrl + "/chat/completions"`）天然兼容，只需改默认值与密钥。
3. **本方案的真正工作量在「配置体系」而非「接入」**：新增统一 LLM 网关（全仓唯一出口）、四级配置解析链（用户 → 系统 → 环境 → 内置默认=Agnes）、系统级（管理端）与用户级（个人设置中心）两套配置 API 与界面、密钥加密落库与掩码回显。
4. **两个必须先定的风险点**：
   - Agnes 文档**未列 `response_format` 字段**，而现有富化强依赖 JSON 模式 → 网关内置「自动降级」策略（400/422 时去参重试）；
   - 自定义 `baseUrl` 是服务端发起请求 → **SSRF 面**，必须复用现有 SSRF 护栏并对普通用户默认禁私网。
5. 预估改动：**新增 9 个文件、修改 16 个文件**，分 6 个实施阶段；后端先行（S1–S3）即可用 curl 验收，两端 UI（S4–S5）随后。

---

## 1. 现状实测（深度扫描结果）

### 1.1 LLM 链路：仅富化一条，且配置静态

| 要素 | 实测现状 | 证据位置 |
| :--- | :--- | :--- |
| 客户端实现 | 内联在富化模块里，非独立客户端 | `packages/ai/src/enrich.ts:255-320` |
| 配置结构 | `LlmConfig { baseUrl, apiKey, model, timeoutMs, fallbacks? }` | `packages/ai/src/enrich.ts:18-25` |
| 内置默认 | **DeepSeek**：`https://api.deepseek.com` / `deepseek-chat` | `packages/ai/src/enrich.ts:27-32` |
| 环境变量 | `NAVHUB_LLM_BASE_URL` / `NAVHUB_LLM_API_KEY` / `NAVHUB_LLM_MODEL` / `NAVHUB_LLM_TIMEOUT_MS` | `apps/api/src/config.ts:195-200`、`.env.example:31-34` |
| 调用方式 | `fetch(baseUrl + "/chat/completions")`，`Authorization: Bearer`，固定带 `response_format: {type:"json_object"}` | `packages/ai/src/enrich.ts:284-300` |
| 重试策略 | 同模型 2 次（温度 0.2 → 0）；再走 `fallbacks` 轮换池；全失败降级启发式 | `enrich.ts:205-232`、`280-315` |
| 降级标记 | `provenance: "llm" \| "heuristic"`，前端可标注可信度 | `enrich.ts:48` |
| 输出校验 | 强制 zod `EnrichmentSchema`，失败重试一次再降级 | `enrich.ts:52-59` |
| 能力上报 | `capabilities.llm = Boolean(config.llm.apiKey)`（启动时定死） | `apps/api/src/context.ts:164` |

**全部调用点（4 处，均为富化）：**

| 调用点 | 身份上下文 | 说明 |
| :--- | :--- | :--- |
| `POST /api/enrich` | 无（public + 限流 20/min） | `apps/api/src/routes/enrich.ts:20-33` |
| `POST /api/sites/auto` | 无（public + 限流 15/min） | `apps/api/src/routes/enrich.ts:38-80` |
| `POST /api/sites`（`enrich: true`） | write scope | `apps/api/src/routes/sites.ts:71-95`（浏览器插件自动入库） |
| `refetch_metadata` 任务（`payload.llm=true`） | 服务端无身份 | `apps/api/src/jobs.ts:632-641` |

### 1.2 配置与鉴权体系

| 机制 | 现状 | 位置 |
| :--- | :--- | :--- |
| 全局 KV 存储 | `system_states(key TEXT PK, value TEXT, updated_at)`，已封装 `getSystemState/setSystemState` | `packages/store/src/schema.ts:367`、`repository/system.ts:52-79` |
| DB 建表 | 双方言 DDL：`DDL_SQLITE` / `DDL_PG`（各 64 张表） | `packages/store/src/driver.ts:766` |
| 列迁移 | `COLUMN_ALTERS` 幂等补列（只补列，不建表） | `packages/store/src/migrate.ts:31+` |
| API 鉴权 | 路由级 `scope: public < read < write < admin`；默认开放模式 | `apps/api/src/auth.ts`、各路由 `config.scope` |
| 管理会话委托 | 前端 `/api/hub/*` 转发时，若 NextAuth 管理员会话有效则自动注入服务端凭据 | `apps/web-overlay/src/app/api/hub/[...path]/route.ts` |
| 用户身份 | `X-Navhub-Anon-Id`（匿名）或 Bearer token → `token:<id>`；`identityOf/identityAllowed` | `apps/api/src/routes/shared.ts`、`apps/web-overlay/src/lib/identity.ts` |
| 加密工具 | AES-256-GCM + PBKDF2（WebCrypto）：`encryptGenericPayload/decryptGenericPayload` | `packages/core/src/vault.ts:203-290` |
| 密钥落盘 | Token 只存 sha256（不可逆）；LLM Key 需**可逆加密**（调用时要解密） | `apps/api/src/auth.ts` |

### 1.3 双端 UI 现状（关键发现）

| 页面 | 现状 | 结论 |
| :--- | :--- | :--- |
| 管理端 `/admin/site` | `runtime='edge'`，走 `SiteConfigService`；该服务 `fetch('/api/site')`，而**中枢根本没有 `/api/site` 路由**——失败后静默回退默认值，保存返回 false | **演示页，不可作为新配置页的范式** |
| 管理端 `/admin/tokens`、`/admin/plugins` | 真实 API：`hubGet/hubSend` + NextAuth 委托鉴权 | **应作为新页面范式** |
| 用户端 `/preferences` | 真实 API（`/api/profile`），身份 = `getIdentity()`（anonId/userId） | 新增「个人模型」卡片应并入此页 |
| 管理导航 | `AdminLayoutClient.tsx:65-170` 的 `menuItems` 静态数组 | 新增「AI 模型」菜单项 |

### 1.4 测试基建

- API 集成测试范式：`buildServer()` + `app.inject()` + 临时 SQLite（`apps/api/test/plugins-api.test.ts`）；
- 包单测：vitest（`packages/ai/test/ai.test.ts` 等）；
- 仓库风格偏好「硬防线」测试：契约同源（`schema-parity.test.ts`）、覆盖层零漂移（`check-web-overlay.mjs`）→ 本方案同样加一条「LLM 调用唯一出口」守卫测试。

---

## 2. 目标与设计原则

### 2.1 功能目标

1. Agnes 3.0 Flash 成为**系统默认模型**：无任何额外配置时，所有 LLM 能力默认走 Agnes；
2. **管理端**可配置系统级模型（名称 / Base URL / 模型 ID / 密钥 / 超时 / 温度 / 最大输出 / JSON 模式 / 备用池），支持连通性测试与恢复默认；
3. **用户端个人设置中心**可配置个人模型，覆盖系统默认（仅影响以该身份发起的 AI 请求）；
4. **后续所有 AI 功能统一调用同一网关**，禁止散落 fetch（加守卫测试）。

### 2.2 设计原则（与仓库既有约束对齐）

| 原则 | 落地 |
| :--- | :--- |
| LLM 不是硬依赖 | 任何配置缺失/调用失败 → 沿用既有启发式降级，`provenance` 如实标记 |
| 密钥不进日志、不回显 | 读接口只返回 `apiKeyMasked`（`sk-****abcd`）；审计只记动作不记值 |
| 默认安全 | 用户级 Base URL 默认禁私网（SSRF）；管理员可显式放开（本地 Ollama 场景） |
| 不破坏存量部署 | 解析链最后一级回退环境变量与旧默认值；DB 无配置时行为等价于「只改默认模型」 |
| 单一事实源 | 配置 schema 用 zod 定义一次，API 校验、UI 类型、网关入参三处引用 |

---

## 3. 总体架构

### 3.1 配置解析链（四级，优先级从高到低）

```
① 用户级配置（user_llm_configs.identity）         ← 个人设置中心，仅当请求带可验证身份
② 系统级配置（system_states: ai.llm.config.v1）    ← 管理端写入（密钥加密）
③ 环境变量（NAVHUB_LLM_*）                        ← 部署期引导，.env.local
④ 内置默认（Agnes 3.0 Flash）                      ← 代码常量，兜底
```

解析规则：

- **无身份请求**（任务队列、系统作业）→ ② → ③ → ④；
- **有身份请求**（带 `X-Navhub-Anon-Id` 或有效 Bearer）→ 若用户配置存在且 `enabled` → ①；否则降级到 ②；
- 用户配置**只允许覆盖连接参数**（baseUrl/model/apiKey/timeoutMs/temperature/maxTokens/jsonMode），不允许覆盖 `allowPrivateNetwork` 等安全开关（该开关仅系统级可设）。

### 3.2 模块时序

```
┌ web (admin / preferences)
│   hubGet / hubSend
▼
┌ Next /api/hub/[...path]  ── NextAuth 管理员会话委托 ──┐
▼                                                      │
┌ Fastify API                                           │
│  routes/ai-config.ts  (admin scope / identity scope)  │
│        │                                              │
│        ▼                                              │
│  llm-config.ts  ── 解析链 + 加密/掩码 + 校验 ─────────┘
│        │
│        ▼
│  packages/ai  llm.ts（唯一网关）──> Agnes / 自定义端点
│        ▲
│  enrich.ts（现有富化，改为委托网关）
└──────────────────────────────────────────────────────
```

---

## 4. 数据模型设计

### 4.1 系统级配置（复用 KV，零迁移）

- 位置：`system_states`，key = `ai.llm.config.v1`
- value（JSON）：

```jsonc
{
  "enabled": true,
  "name": "Agnes 3.0 Flash",
  "baseUrl": "https://api.agnes-ai.cn/v1",
  "model": "agnes-3.0-flash",
  "apiKeyEnc": { "version": 1, "cipherTextBase64": "...", "ivHex": "...", "saltHex": "...", "type": "llm-api-key" },
  "timeoutMs": 20000,
  "temperature": 0.2,
  "maxTokens": 1024,
  "jsonMode": "auto",              // auto | response_format | prompt
  "allowPrivateNetwork": false,
  "fallbacks": [],                 // 备用池（P2，结构同 provider，不含 apiKeyEnc 以外的新字段）
  "updatedAt": 1792364414000,
  "updatedBy": "admin"
}
```

> 选型理由：单条配置、读多写少、无需按字段查询；`getSystemState/setSystemState` 已覆盖双方言，省去 DDL 与迁移成本。密钥字段单独加密，不与其他参数混存明文。

### 4.2 用户级配置（新表）

```ts
// packages/store/src/schema.ts
export const userLlmConfigs = sqliteTable("user_llm_configs", {
  /** 身份：anon-xxx / userId / token:<id>（与收藏、画像同一口径） */
  identity: text("identity").primaryKey(),
  /** 单条 provider JSON（密钥字段加密） */
  provider: text("provider").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});
```

- DDL 需同时登记 `DDL_SQLITE` 与 `DDL_PG`（`CREATE TABLE IF NOT EXISTS`，幂等）；
- 仓储函数：`getUserLlmConfig` / `upsertUserLlmConfig` / `deleteUserLlmConfig`（新增 `repository/llm-config.ts`，在 `repository.ts` 类上挂 3 个方法）；
- 选型理由：用户数据按 identity 主键、可单条删除（重置画像/注销时联动清理）、可枚举；避免把用户数据塞进 `system_states` 造成 KV 污染。

### 4.3 密钥加密与掩码

| 项 | 设计 |
| :--- | :--- |
| 算法 | AES-256-GCM + PBKDF2（复用 `packages/core/src/vault.ts` 的 `encryptGenericPayload/decryptGenericPayload`） |
| 口令 | `NAVHUB_SECRETS_KEY`（推荐，独立密钥）→ 缺省回退 `NAVHUB_SESSION_SECRET` |
| 存储 | 仅存加密信封；明文只在「保存请求 → 加密」的瞬间存在内存 |
| 回显 | `GET` 返回 `apiKeyMasked`（保留前 3 后 4，中间 `****`）+ `hasApiKey: true`；**永不返回明文** |
| 更新语义 | `PUT` 时 `apiKey` 省略 = 保持不变；空串 = 清除；非空 = 覆盖 |
| 审计 | 写 `audit_logs`：动作（set/reset/test）、操作者、来源（admin/user）、不含密钥 |
| 轮换提示 | 文档注明：更换 `NAVHUB_SECRETS_KEY` 会导致已存密钥无法解密，需在管理端重填 |

---

## 5. 后端模块设计

### 5.1 统一网关 `packages/ai/src/llm.ts`（新增）

```ts
export interface LlmProvider {
  name?: string;
  baseUrl: string;
  model: string;
  apiKey?: string | null;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: "auto" | "response_format" | "prompt";
  allowPrivateNetwork?: boolean;
}

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

export interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;          // 需要严格 JSON 输出
  signal?: AbortSignal;
  tools?: unknown[];       // 预留：Agnes 支持 tools/tool_choice
}

export interface ChatResult {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs: number;
  jsonModeUsed: "response_format" | "prompt";
}

export async function chatCompletion(provider: LlmProvider, opts: ChatOptions): Promise<ChatResult>;
export async function chatStream(provider: LlmProvider, opts: ChatOptions): AsyncIterable<string>; // P2，供未来对话式功能
export function maskApiKey(key: string): string;
```

**JSON 模式自动降级（关键兼容逻辑）**

1. `jsonMode === "response_format"` → 首次请求带 `response_format:{type:"json_object"}`；
2. `jsonMode === "auto"`（默认）→ 同上，但遇到 **400/422 且响应体提及 `response_format`/`json_object`/`unknown field`** 时，进程内按 `baseUrl|model` 记住「不支持」，本次立即去参重试；
3. `jsonMode === "prompt"` → 从不带参，靠系统提示词约束 + `stripCodeFence` 提取；
4. JSON 解析仍由调用方 zod 校验（沿用 `EnrichmentSchema`），网关只负责「拿到文本」。

**错误归一化**：`LlmError { code: "timeout" | "auth" | "rate_limit" | "http" | "network" | "invalid_response"; status?: number; message }`。

**SSRF**：`assertLlmEndpoint(baseUrl, { allowPrivateNetwork })` —— 仅 http/https；默认拒绝回环、私网、链路本地、metadata 地址；管理员显式放开后仅允许 http（本地 Ollama）。

### 5.2 `enrich.ts` 改造（最小 diff）

- 删除内联 `fetch` 与 `DEFAULT_LLM`，`tryLlm()` 改为调用 `chatCompletion(provider, { json: true })`；
- `LlmConfig` 类型保留（外部调用点不动），新增可选 `jsonMode`（映射到 `LlmProvider`）；
- 现有 prompt、2 次重试、fallbacks 轮换、zod 校验、启发式降级**全部保持不变**；
- 单测补：网关 400 → 去参重试成功；超时降级；坏 JSON 降级。

### 5.3 配置解析器 `apps/api/src/llm-config.ts`（新增）

```ts
export interface ResolvedLlm { provider: LlmProvider; source: "user" | "system" | "env" | "default"; }

export async function resolveLlm(ctx: AppContext, identity?: string | null): Promise<ResolvedLlm>;
export async function getSystemLlmConfig(ctx): Promise<SystemLlmConfigView>;  // 掩码视图
export async function saveSystemLlmConfig(ctx, input, actor): Promise<SystemLlmConfigView>;
export async function resetSystemLlmConfig(ctx, actor): Promise<void>;
export async function getUserLlmConfigView(ctx, identity): Promise<UserLlmConfigView>;
export async function saveUserLlmConfig(ctx, identity, input): Promise<UserLlmConfigView>;
export async function deleteUserLlmConfig(ctx, identity): Promise<void>;
export async function testLlmProvider(provider): Promise<{ ok: boolean; latencyMs: number; replyPreview: string; error?: string }>;
```

职责：读 DB → 解密 → 合并 env/默认 → 交给网关；写入时校验（zod）→ 加密 → 落库 → 刷新 `ctx.capabilities.llm`。

### 5.4 API 契约（新增 `apps/api/src/routes/ai-config.ts`）

**管理端（`scope: "admin"`）**

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | `/api/admin/ai/config` | 返回系统配置（掩码）+ `source`（db/env/default）+ `capabilities` |
| PUT | `/api/admin/ai/config` | 保存系统配置；密钥省略=不改，空串=清除 |
| POST | `/api/admin/ai/config/test` | 连通性测试；可传候选配置（未填密钥则用已存的），限流 5/min |
| POST | `/api/admin/ai/config/reset` | 清除 DB 覆盖，回退 env/默认 |

**用户端（identity + `identityAllowed`）**

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | `/api/user/ai/config` | 返回个人配置（掩码）+ 系统默认摘要（模型名/来源，不含密钥） |
| PUT | `/api/user/ai/config` | 保存个人配置（密钥空串=清除；不允许设置 `allowPrivateNetwork`） |
| DELETE | `/api/user/ai/config` | 删除个人配置（回退系统默认） |
| POST | `/api/user/ai/config/test` | 个人连通性测试，限流 5/min |

**请求体（两端口径一致，用户端去掉安全开关）**

```jsonc
{
  "enabled": true,
  "name": "Agnes 3.0 Flash",
  "baseUrl": "https://api.agnes-ai.cn/v1",
  "model": "agnes-3.0-flash",
  "apiKey": "sk-...",        // 可选，见更新语义
  "timeoutMs": 20000,
  "temperature": 0.2,
  "maxTokens": 1024,
  "jsonMode": "auto"
}
```

**校验规则（zod）**：`baseUrl` 必须 http(s) 且经 SSRF 判定；`model` 1–120 字符；`timeoutMs` 1000–120000；`temperature` 0–2；`maxTokens` 1–65536（Agnes 上限）；`jsonMode` 枚举。

### 5.5 现有 4 个调用点收口

| 调用点 | 改法 |
| :--- | :--- |
| `routes/enrich.ts`（2 处） | `const { provider } = await resolveLlm(ctx, identityOf(req)); llm: provider` |
| `routes/sites.ts:81` | 同上（write scope 请求携带身份） |
| `jobs.ts:639` | `resolveLlm(ctx)`（无身份 → 系统级） |
| `context.ts:164` | 启动时读一次系统配置：`capabilities.llm = Boolean(resolved apiKey)`；配置保存后热更新该字段 |

### 5.6 健康检查与指标

- `/api/health` 的 capabilities 增加非敏感明细：`{ llm: { configured: true, model: "agnes-3.0-flash", source: "system" } }`；
- `navhub_capability{name="llm"}` 保持 0/1，语义不变；
- 每次真实调用记一条 `events`（`llm_call`，meta：model、source、latencyMs、tokens、ok），不记密钥。

---

## 6. 前端设计

### 6.1 管理端 `/admin/ai`（新增页 + 导航项）

- 位置：`apps/web-overlay/src/app/admin/ai/page.tsx`（client component，照 `admin/tokens` 范式）；
- 导航：`AdminLayoutClient.tsx` 的 `menuItems` 在「插件市场」后插入 `{ title: "AI 模型", href: "/admin/ai", icon: Bot }`；
- 结构：
  1. **状态卡**：当前生效来源（系统配置 / 环境变量 / 内置默认）、是否已配置密钥、模型名；
  2. **默认模型表单**（字段见 §7）；API Key 为 password 输入，placeholder 显示掩码，留空不修改；
  3. **连通性测试**：按钮 → `POST .../test` → 显示延迟/模型回显/错误原因；
  4. **高级（折叠）**：JSON 模式策略、允许私网地址、备用模型池（P2）；
  5. **底部**：保存 / 恢复环境变量默认（二次确认）。

### 6.2 用户端 `/preferences`（新增卡片）

- 在现有「我的偏好」页末尾新增 **`AI 模型（个人）`** 区（`<section className="rounded-md border p-4">`，与现有版式一致）；
- 模式切换：`跟随系统默认` / `使用我的模型`；
- 字段：Base URL、模型 ID、API Key、超时、温度；
- 操作：保存、测试连接、清除（恢复跟随系统）；
- 文案明确：「仅影响以你的身份发起的 AI 请求；密钥加密存储，仅显示掩码」。

### 6.3 共享组件与客户端类型

- `apps/web-overlay/src/components/ai/llm-config-form.tsx`（新增）：受控表单，两端复用（props 控制是否展示安全开关/备用池）；
- `apps/web-overlay/src/lib/navhub-api.ts`（修改）：新增 `HubLlmConfig` 类型与 `fetchAdminLlmConfig / saveAdminLlmConfig / testAdminLlmConfig / resetAdminLlmConfig / fetchUserLlmConfig / saveUserLlmConfig / deleteUserLlmConfig / testUserLlmConfig`；
- 错误展示沿用 `lib/degrade.ts` 的「降级必须说出来」原则，不静默吞错。

---

## 7. 配置项定义（完整表格）

| 配置项 | 类型/范围 | 默认值 | 系统级 | 用户级 | 环境变量 | 说明 |
| :--- | :--- | :--- | :---: | :---: | :--- | :--- |
| `enabled` | boolean | `true` | ✓ | ✓ | — | 关闭后该层不参与解析 |
| `name` | string(1–60) | `Agnes 3.0 Flash` | ✓ | ✓ | — | 仅展示用 |
| `baseUrl` | http(s) URL | `https://api.agnes-ai.cn/v1` | ✓ | ✓ | `NAVHUB_LLM_BASE_URL` | 网关自动拼 `/chat/completions` |
| `model` | string(1–120) | `agnes-3.0-flash` | ✓ | ✓ | `NAVHUB_LLM_MODEL` | 模型 ID |
| `apiKey` | secret | 空 | ✓ | ✓ | `NAVHUB_LLM_API_KEY` | 加密落库；回显掩码 |
| `timeoutMs` | 1000–120000 | `20000` | ✓ | ✓ | `NAVHUB_LLM_TIMEOUT_MS` | 单次请求超时 |
| `temperature` | 0–2 | `0.2` | ✓ | ✓ | `NAVHUB_LLM_TEMPERATURE` | 富化首次尝试值 |
| `maxTokens` | 1–65536 | `1024` | ✓ | ✓ | `NAVHUB_LLM_MAX_TOKENS` | Agnes 最大输出 65536 |
| `jsonMode` | `auto`/`response_format`/`prompt` | `auto` | ✓ | ✓ | `NAVHUB_LLM_JSON_MODE` | 兼容性开关，见 §5.1 |
| `allowPrivateNetwork` | boolean | `false` | ✓ | ✗ | `NAVHUB_LLM_ALLOW_PRIVATE` | 仅管理员；放开后允许私网/回环 |
| `fallbacks[]` | provider[] | `[]` | ✓ | ✗ | — | 备用模型池（P2） |
| `secrets key` | base64(32B) | 空 | — | — | `NAVHUB_SECRETS_KEY` | 加密口令；缺省回退 SESSION_SECRET |

**.env.example 增补：**

```bash
# ---- LLM（默认 Agnes 3.0 Flash；缺 Key 时富化降级为启发式）----
NAVHUB_LLM_BASE_URL=https://api.agnes-ai.cn/v1
NAVHUB_LLM_MODEL=agnes-3.0-flash
NAVHUB_LLM_API_KEY=
NAVHUB_LLM_TIMEOUT_MS=20000
NAVHUB_LLM_MAX_TOKENS=1024
NAVHUB_LLM_TEMPERATURE=0.2
NAVHUB_LLM_JSON_MODE=auto
# 允许 baseUrl 指向内网（本地 Ollama 等）；仅对系统级生效
NAVHUB_LLM_ALLOW_PRIVATE=false
# 可选：独立密钥加密 LLM Key（不设则回退 NAVHUB_SESSION_SECRET）
# NAVHUB_SECRETS_KEY=
```

> 本次提供的 Agnes 密钥在实施阶段写入 `.env.local`（已被 `.gitignore` 覆盖），**不进入任何提交文件、不写入本文档**。

---

## 8. 改动范围清单（文件级）

### 新增（9）

| 文件 | 职责 |
| :--- | :--- |
| `packages/ai/src/llm.ts` | 统一网关：chat/chatStream、JSON 模式降级、错误归一化、掩码 |
| `packages/ai/test/llm.test.ts` | 网关单测（fetch mock） |
| `packages/store/src/repository/llm-config.ts` | 用户配置仓储（get/upsert/delete） |
| `apps/api/src/llm-config.ts` | 解析链、加密、掩码、校验、测试连接 |
| `apps/api/src/routes/ai-config.ts` | 管理端/用户端 8 个端点 |
| `apps/api/test/ai-config.test.ts` | API 集成测试 |
| `apps/api/test/llm-gateway-guard.test.ts` | 守卫：`/chat/completions` 只允许出现在 `packages/ai/src/llm.ts` |
| `apps/web-overlay/src/app/admin/ai/page.tsx` | 管理端 AI 模型页 |
| `apps/web-overlay/src/components/ai/llm-config-form.tsx` | 双端共享表单 |

### 修改（16）

| 文件 | 改动 |
| :--- | :--- |
| `packages/ai/src/enrich.ts` | 去内联 fetch / DEFAULT_LLM，委托网关；类型加 `jsonMode` |
| `packages/ai/src/index.ts` | 导出 `llm.ts` |
| `packages/store/src/schema.ts` | 新增 `userLlmConfigs` |
| `packages/store/src/driver.ts` | DDL 双方言新增表 |
| `packages/store/src/repository.ts` | 挂 3 个方法 |
| `apps/api/src/config.ts` | 默认值改 Agnes；新增 `maxTokens/temperature/jsonMode/allowPrivate/secretsKey` |
| `apps/api/src/context.ts` | `capabilities.llm` 改读解析结果；暴露 repo 配置方法 |
| `apps/api/src/server.ts` | 注册 `aiConfigRoutes` |
| `apps/api/src/routes/enrich.ts` | 2 处改为 `resolveLlm` |
| `apps/api/src/routes/sites.ts` | 1 处改为 `resolveLlm` |
| `apps/api/src/jobs.ts` | 1 处改为 `resolveLlm` |
| `apps/api/src/metrics.ts` | capability 明细（可选） |
| `apps/web-overlay/src/lib/navhub-api.ts` | 类型 + 8 个客户端函数 |
| `apps/web-overlay/src/app/preferences/page.tsx` | 新增个人模型卡片 |
| `apps/web-overlay/src/app/admin/AdminLayoutClient.tsx` | 新增菜单项 |
| `.env.example` | LLM 段重写（Agnes + 新项） |

> 另：实施完成后在 `docs/` 补一篇运维说明（密钥轮换 / 私网开关 / 回退流程）。
>
> 注：`apps/web/` 下的镜像文件由 overlay 同步（`check:overlay` 强制 0 漂移），实施时按 `apps/web-overlay → apps/web` 方向同步，勿反向。

---

## 9. 实施步骤（含验收标准）

### S1 网关层（半天）
1. 新建 `packages/ai/src/llm.ts`（chat + JSON 降级 + 错误归一化 + SSRF 断言 + mask）；
2. `enrich.ts` 改为委托网关，保持外部行为不变；
3. 单测：400/422 去参重试、超时、坏 JSON、usage 透传、掩码。

**验收**：`pnpm vitest run packages/ai` 全绿；既有 enrich 测试不改用例即通过。

### S2 存储与解析（半天）
1. `schema.ts` + `driver.ts` 双方言 DDL + `repository/llm-config.ts` + 类方法；
2. `apps/api/src/llm-config.ts`：解析链、加解密（复用 vault）、zod 校验、掩码视图；
3. 单测：加解密往返、四级优先级、更新语义（省略/空串/覆盖）。

**验收**：空 DB 时解析结果为 env；写 DB 后优先于 env；用户配置优先于系统；DB 中查不到明文密钥。

### S3 API 路由（半天）
1. 8 个端点 + 限流 + 审计；
2. 守卫测试（唯一出口）；
3. 集成测试：鉴权（未授权 401/403）、掩码、重置、身份隔离（A 看不到 B）、测试端点（fetch mock）。

**验收**：`pnpm --filter @navhub/api test` 全绿；`curl` 可完成「配置 → 测试 → 生效」闭环。

### S4 管理端 UI（1 天）
1. `/admin/ai` 页 + 导航项 + 共享表单组件；
2. `navhub-api.ts` 客户端函数；
3. 手工验收：保存 → 刷新 → 掩码回显正确；测试连接显示延迟；恢复默认生效。

### S5 用户端 UI（半天）
1. `/preferences` 卡片（跟随系统 / 自定义 / 清除）；
2. 验收：匿名身份保存后仅该 anonId 生效；换身份看不到他人配置。

### S6 收口与回归（半天）
1. 4 个调用点切 `resolveLlm`；`capabilities` 热更新；
2. 跑 `pnpm lint`、`pnpm typecheck`、API/包全量测试、`check:overlay`；
3. 端到端：用真实 Agnes Key 走一遍 `/api/enrich`（`provenance=llm`），再故意填错 Key 验证降级为 `heuristic`；
4. 文档：密钥轮换、私网开关、成本说明。

---

## 10. 测试计划（清单）

| 层 | 用例 |
| :--- | :--- |
| 网关 | JSON 模式三策略；400 去参重试仅一次；超时中断；401/429 错误码归一；usage 解析；SSE 分块解析（P2） |
| 加密 | 往返一致；篡改密文解密失败；缺失口令拒绝；换口令后旧密文失败（预期） |
| 解析链 | user > system > env > default；`enabled=false` 跳过；无身份走系统 |
| API | 鉴权矩阵（public/read/write/admin）；密钥永不回显；PUT 三种密钥语义；reset；限流 |
| 隔离 | 用户 A 的配置不影响 B；jobs 无身份用系统配置 |
| 回归 | enrich 既有单测；`provenance` 标记；降级提示不变 |
| 守卫 | 除 `llm.ts` 外无 `/chat/completions` 字面量 |

---

## 11. 风险与待确认事项

| # | 事项 | 影响 | 建议 / 待定 |
| :--- | :--- | :--- | :--- |
| R1 | **Agnes 未文档化 `response_format`** | 富化首调可能 400 | 网关 `auto` 降级已覆盖；S1 完成后用真实 Key 实测一次并记录 |
| R2 | 自定义 `baseUrl` 的 SSRF 面 | 服务端可被诱导访问内网 | 复用 `guardedFetch` 判定；用户级默认禁私网；管理员开关显式开启 |
| R3 | 密钥加密口令来源 | 换口令导致旧密文不可解 | 新增 `NAVHUB_SECRETS_KEY`；文档写明轮换流程 |
| R4 | 个人配置的生效范围 | 目前仅富化链路消费，用户感知弱 | 待确认：是否同期增加「个人 AI 助手」入口（对话式），否则个人配置仅影响富化/未来功能 |
| R5 | 是否保留 DeepSeek 兜底 | 影响解析链第④级 | 建议：不内置；需要时由管理员在备用池添加 |
| R6 | 管理端旧「站点设置」页 | 演示页静默失败，易误导 | 本方案不改它；建议另立小任务明确「下线或接真 API」 |
| R7 | `fallbacks` 备用池 UI | 增加前端复杂度 | 建议后端先支持、UI 折叠为 P2 |

**需要你确认的 4 个问题：**

1. 密钥落点：同意「`.env.local` 作为引导 + 管理端可加密存库覆盖」吗？
2. 是否允许个人用户配置**私网**地址（本地 Ollama）？默认否，是否给用户级也开一个显式开关？
3. 个人模型配置当前只会影响富化链路——是否需要同期做一个最小的「个人 AI 对话/测试」入口，让用户能直接感知自己的配置生效？
4. 备用模型池（fallbacks）是否本期就要 UI？

---

## 12. 附录：Agnes 3.0 Flash 关键事实（来自官方文档）

| 项 | 值 |
| :--- | :--- |
| Base URL | `https://api.agnes-ai.cn/v1` |
| Chat Completions | `POST /v1/chat/completions`（OpenAI 兼容） |
| 其他端点 | `/v1/responses`、`/v1/messages`（Anthropic 兼容） |
| 模型 ID | `agnes-3.0-flash` |
| 认证 | `Authorization: Bearer <key>`（Messages 用 `x-api-key`） |
| 上下文 / 最大输出 | 512K / 65,536 tokens |
| 支持字段 | `model` `messages` `temperature` `top_p` `max_tokens` `stream` `tools` `tool_choice` `chat_template_kwargs` |
| 输入模态 | 文本 + 图像 URL |
| 计费 | 当前现价 ¥0（输入缓存命中 ¥0.035、输入 ¥0.35、输出 ¥1.00 / 百万 token 为刊例价） |
| 未列字段 | `response_format`（→ 本方案的自动降级策略） |
