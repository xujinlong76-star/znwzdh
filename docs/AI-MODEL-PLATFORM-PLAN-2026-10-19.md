# AI 模型平台：现状审计与开发方案

> 日期：2026-10-19 ｜ 状态：**待确认，未开始开发**
> 目标：Agnes 3.0 Flash 作为全站统一模型；后台与个人设置中心均可自由配置自定义模型。

---

## 0. 一句话结论

**「配好模型」和「统一出口」这两件事，仓库里已经做完了，而且我实测跑通了。**
真正缺的不是"接模型"，而是**可观测性**——后台的 AI 观测面板在没有任何真实调用时会伪造 168 次调用与 24 小时曲线，而业务调用（富化/巡检/任务）从来不记录 token 与延迟，于是面板永远只能造假。

所以本方案的重心是：**删掉假数据 → 补齐真实用量采集 → 再把"自定义模型"的体验补齐**（来源可见性、provider 预设、thinking 开关）。

---

## 1. 实测验证（不是读代码猜的）

| 验证项 | 方法 | 结果 |
| :--- | :--- | :--- |
| 密钥有效性 | `curl POST https://api.agnes-ai.cn/v1/chat/completions` | ✅ HTTP 200，`"content":"连通"`，6.7s |
| 服务端解析链 | 临时 E2E 测试跑 `resolveLlm(ctx)` + `chatCompletion` | ✅ `model=agnes-3.0-flash`、`baseUrl=api.agnes-ai.cn/v1`、密钥解密成功 |
| 真实生成 | 同上，prompt「只回复两个字：就绪」 | ✅ 返回「就绪」，usage 81 tokens，延迟 1219ms |
| 现有配置 | 读 `.env` + `system_states.ai.llm.config.v1` | ✅ 环境变量密钥与本次提供的一致；DB 系统级配置完整（含 AES-256-GCM 加密密钥） |
| 现有测试 | `ai-config.test.ts` / `llm-gateway-guard.test.ts` | ✅ 6 + 2 例全过 |

> 附注：审计开始时发现 `apps/api/` 整个目录被清空（86 个文件，git 全 `D`）且 `node_modules` 部分损坏。
> 已用 `git restore apps/api` + `pnpm install --force --ignore-scripts` 恢复，测试已可运行。
> `--ignore-scripts` 的副作用：`onnxruntime-node` 的 postinstall 被沙箱策略拦截（wmic 黑名单），
> **本地语义向量模型不可用**；线上/正常环境不受影响，但本机需要时可单独 `pnpm rebuild onnxruntime-node`。

---

## 2. 现状架构（已实现的部分）

```
┌──────────────────────────── 配置层 ────────────────────────────┐
│ ① 用户级  user_llm_configs(identity)      个人设置中心 /preferences │
│ ② 系统级  system_states: ai.llm.config.v1  后台 /admin/ai           │
│ ③ 环境变量 NAVHUB_LLM_*                    .env / compose           │
│ ④ 内置默认 Agnes 3.0 Flash（无密钥）        packages/ai/src/llm.ts   │
└──────────────────────────────┬─────────────────────────────────┘
                               │ resolveLlm(ctx, identity)  ← 每次请求实时解析
┌──────────────────────────────▼─────────────────────────────────┐
│ 统一网关 packages/ai/src/llm.ts（全仓唯一 /chat/completions 出口）│
│  · SSRF 校验（DNS 解析后按真实 IP 判定）                          │
│  · JSON 模式自动降级（response_format → prompt 重试）             │
│  · 超时 / 鉴权 / 错误归一化（config/ssrf/timeout/auth/…）         │
│  · 备用池（最多 3 个 fallback，主模型失败按序尝试）                │
└──────────────────────────────┬─────────────────────────────────┘
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
   enrich（元数据富化）    health-audit（AI 审计）   user/ai/chat（Copilot）
   sites（单站富化）       jobs（enrich 任务）       user/ai/canvas/generate
```

**已具备**（逐条核对过代码）：

- 唯一出口 + 守卫测试 `llm-gateway-guard.test.ts`（除网关外出现 `/chat/completions` 字面量即失败）；
- 密钥 AES-256-GCM 加密落库，读接口只回掩码，审计只记「是否变更」；
- 后台：系统级配置 + 3 个 fallback + 连通性测试 + 观测页；
- 个人：用户级覆盖 + 测试连接 + 一键恢复跟随系统；
- 部署：`.env.example` 完整注释，`main.ts` 用 Node 原生 `loadEnvFile` 加载根 `.env`。

---

## 3. 缺口清单（按严重度）

### P0-1 观测面板伪造数据 ⚠️ 最严重

`apps/api/src/routes/ai-config.ts:94-252`，三处造假：

| 位置 | 造假内容 |
| :--- | :--- |
| `:171` `if (totalCalls === 0)` | 伪造 **168 次调用 / 194200 tokens / 3 个场景**，还编了 4 条假日志 |
| `:216-236` `hourlyTrend` | 用 `Math.sin(h)` / `Math.cos(h)` **生成 24 小时曲线**（有真实数据时也照样编） |
| `:199-202` | `p95LatencyMs` 兜底 380ms、`avgLatencyMs` 兜底 320ms；`estimatedCostRmb` 用假 token 算 |

后果：管理员看到的是"AI 用得很健康"，实际可能一次都没调通。这与仓库前几轮治理的
「失败不能说成没数据」是同一类问题，只是方向相反（**没数据不能说成有数据**）。

### P0-2 业务调用不采集用量

只有 `ai_chat`（Copilot）与 `ai_canvas_generate`（工作台生成）在 `ai-config.ts:394/599` 记了事件。
`enrich` / `sites` / `jobs` / `health-audit` **一条用量都不记**（`enrich.ts:33` 只记了 url 与 provenance）。
→ 面板即使删掉假数据，也永远显示 0，因为没有数据源。

### P1-1 用户看不到"当前生效的是谁"

`/api/user/ai/config` 返回了 `system` 摘要（`llm-config.ts:571`），但**没有 `effective` 字段**：
用户配了自己的模型、或系统模型被管理员改过时，界面上没有任何地方告诉他
「你现在的请求实际走的是哪个模型、来自哪一层」。

### P1-2 "自定义模型"门槛偏高

表单要求手填 `baseUrl` + `model`（`llm-config-form.tsx:91-115`），没有常见 provider 预设。
填错一个字符就是 401/404，而错误提示只有一句"连通失败"。

### P1-3 thinking / vision 未接

Agnes 3.0 Flash 支持 `chat_template_kwargs.enable_thinking`（文档）与 `image_url` 输入，
网关类型里已预留 `ChatContentPart`（`llm.ts:51`），但**没有任何入口**：
Copilot 无法开启思考模式，也没有图像理解场景。

### P2 语义检索不走 Agnes（说明，非缺陷）

语义检索用本地 `Xenova/bge-small-zh-v1.5`（512 维，离线、零成本）。
Agnes 文档**未提供 embedding 端点**，因此「所有功能统一使用同一模型」在 chat 类功能成立，
向量空间仍由本地模型负责。若要真正统一，需引入远程 embedding（另立项，见 §5 阶段 3）。

---

## 4. 开发方案

### 阶段 1（P0，建议必做）：真实可观测

**1.1 新增 `llm_usage` 表**

```sql
CREATE TABLE IF NOT EXISTS llm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario   TEXT NOT NULL,        -- enrich / ai_chat / canvas / health_audit / config_test
  source     TEXT NOT NULL,        -- user / system / env / default
  model      TEXT NOT NULL,
  identity   TEXT,                 -- 仅存 HMAC 摘要，不存原值
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  ok         INTEGER NOT NULL,
  error_code TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS llm_usage_time_idx ON llm_usage(created_at);
CREATE INDEX IF NOT EXISTS llm_usage_scenario_idx ON llm_usage(scenario, created_at);
```

为什么新表而不是复用 `events`：`events` 已承载 click/favorite/vitals/client_error 等 5 类语义，
AI 调用是**高频 + 固定列**的结构化数据，混进去会让 `events` 膨胀且难以聚合；
新表可独立设 TTL（复用 `retention` 任务，默认保留 90 天）。

**1.2 网关层统一埋点（一次改，全覆盖）**

新增 `apps/api/src/llm-usage.ts`：

```ts
export async function callLlm(ctx, resolved, opts: { scenario, identity?, messages, ... }) {
  const t0 = Date.now();
  try {
    const res = await chatCompletion(resolved.provider, opts);
    await recordUsage(ctx, { scenario, source: resolved.source, ...res, latencyMs: Date.now()-t0, ok: true });
    return res;
  } catch (e) {
    await recordUsage(ctx, { scenario, source: resolved.source, ok: false, errorCode: LlmError.code(e) });
    throw e;
  }
}
```

改造 6 个调用点：`routes/enrich.ts`、`routes/sites.ts`、`jobs.ts`、`routes/health-audit.ts`、
`routes/ai-config.ts`（chat/canvas 两处）。**调用点不各自写埋点**，避免漏记。

**1.3 观测端点改为真实聚合**

- 删除全部伪造分支（`totalCalls===0` 的 168 次、正弦 `hourlyTrend`、p95/avg 兜底）；
- 真实 SQL 聚合：总量、成功率、p50/p95、按场景、按来源、按小时（`strftime('%H', created_at/1000)`）；
- 响应新增 `hasData: boolean` 与 `since`，**0 调用时返回全 0 与空数组**，由 UI 显示空态；
- 成本估算改用真实 token × 单价（Agnes 现价 ¥0，仍按刊例价计算并标注"按刊例价"）。

**1.4 UI 空态**

`ai-observability-panel.tsx`：`hasData === false` 时显示
「暂无调用记录（统计自 <时间>）· 可到配置页点『测试连接』产生第一条记录」，
不画空曲线、不显示 0.0% 成功率假象。

**验收**：制造一次真实 enrich → 面板 5 秒内出现 1 次调用、token 与延迟与日志一致；
清库后显示空态而非 168。

### 阶段 2（P1，建议做）：配置体验与来源可见

**2.1 `effective` 字段**

`getUserLlmConfigView` 增加：

```ts
effective: { source: "user"|"system"|"env"|"default", name, model, baseUrl }
```

个人设置中心顶部一行：「当前生效：**Agnes 3.0 Flash**（来自系统配置）」；
配置了自己的模型后变成「（来自你的个人配置）」。后台配置页同样显示系统级来源。

**2.2 Provider 预设**

`components/ai/provider-presets.ts`：Agnes / DeepSeek / OpenAI / 通义千问 / 本地 Ollama / 自定义。
一键填入 `baseUrl` + `model`（**密钥仍必须用户自己填**，预设不含任何密钥）。
本地 Ollama 预设只在系统级可选（用户级强制禁私网，与现有 SSRF 策略一致）。

**2.3 测试连接的错误可读化**

现在只有"连通失败"；改为透出归一化错误码对应的动作建议：
`auth` → 「密钥无效或已过期」；`timeout` → 「端点无响应，检查 baseUrl」；
`ssrf` → 「该地址指向内网，仅管理员可放开」。

**验收**：新用户从打开设置到保存成功 ≤3 次点击（选预设 → 填 key → 保存）。

### 阶段 3（P2，可选）：能力扩展

**3.1 thinking 开关**（`chat_template_kwargs.enable_thinking`）

- 按场景默认：Copilot 开（复杂问答），enrich / canvas **关**（结构化输出，省 token）；
- 配置页给一个「深度思考」开关，标注「更慢、更贵」；
- 网关增加 `thinking?: boolean`，只在 `true` 时带该字段（兼容不支持的服务商）。

**3.2 vision（图像 URL 理解）**

需要真实场景才有意义。候选：站点截图理解（生成分类/标签）。
前置依赖：截图管线（Playwright）+ 存储；**建议单独立项**，本阶段只落网关能力（已支持 `image_url`）。

**3.3 远程 embedding（若要"完全统一"）**

新增 `NAVHUB_EMBEDDING_PROVIDER=local|openai-compatible`，与 LLM 同一套解析链。
**注意**：换 embedding 意味着**全库向量重建**（5000 站点 × 512 维），需迁移脚本与回滚方案；
默认仍走本地模型。

### 工作量与顺序

| 阶段 | 内容 | 估时 | 依赖 |
| :--- | :--- | :--- | :--- |
| 1 | llm_usage 表 + 网关埋点 + 真实聚合 + 空态 | 2 人日 | 无 |
| 2 | effective + 预设 + 错误可读化 | 2 人日 | 阶段 1 的 source 字段 |
| 3 | thinking / vision / 远程 embedding | 2–4 人日 | 场景决策 |

### 回滚

- 阶段 1：`llm_usage` 表新增不影响旧逻辑；观测端点保留旧响应形状（只删假数据），前端无需同步回滚；
- 阶段 2：`effective` 为新增字段；预设为纯前端常量；
- 阶段 3：thinking 默认关、embedding 默认 local，不配即等于没做。

---

## 5. 需要你确认的 4 件事

1. **范围**：阶段 1 必做，阶段 2/3 是否一起做？
2. **用量存储**：新表 `llm_usage`（推荐）还是塞进 `events`？
3. **thinking 默认**：Copilot 默认开（更聪明但更慢）还是默认关（用户手动开）？
4. **vision**：现在有明确用途吗？没有就只留网关能力、不做界面。

---

## 6. 风险与注意

- **本机 `onnxruntime-node` 不可用**（沙箱拦截 wmic），语义检索在本机降级；不影响本次 AI 配置功能，但端到端验证语义检索需换环境。
- `resolveLlm` 每次请求读 2 次 DB + 解密，高频 enrich 场景建议后续加 30s 进程内缓存（与快照缓存同一套失效思路）——本次不含，列为优化项。
- 密钥已在 `.env` 与 DB 双份：**轮换时两处都要改**（DB 优先，`.env` 仅兜底）。建议后续加「密钥轮换」入口，本次不做。
