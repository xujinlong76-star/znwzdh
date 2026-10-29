# [AI-6] 模型成本与质量治理 · 实施与实测记录（2026-10-30）

## 1. 结论

AI 调用成本从「一个全局单价拍脑袋折算」升级为**按模型定价的成本快照**，并新增两条质量读数：

- **分模型单价簿**（`llm_model_prices`，输入/输出分开计价，元 / 1K tokens）。调用发生时按
  **实际应答模型**取价并快照到 `llm_usage` 行（`cost_rmb / prompt_price_per_1k /
  completion_price_per_1k / price_source`）——之后调价只影响新调用，历史成本不被重写。
- **解析链**：单价簿 → 旧版单一价（管理端 > 环境变量）→ 无价。无价写入 `NULL` 而不是 `0`；
  观测接口区分 `snapshot / legacy / none` 三种成本来源，并给出「有价调用 / 总调用、有价 tokens /
  总 tokens」覆盖率。
- **分模型成本与用量**：按实际应答模型拆调用数、tokens、异常、有价调用与成本；未覆盖模型显示
  「无价」而不是 ¥0——备用池换一家模型时，主模型的价与失败率不再套到它头上。
- **质量读数**：copilot 引用有效率/无法核验链接；画布生成首过率（干净 = 全部卡片通过 schema
  校验且未使用保底布局），数据源为新增的 `canvas_generate` 事件（只记结构维度，不记提示词）。

浏览器实测（真实隔离栈、真实接口、无头 Chrome）19 条断言全绿；实测中发现并修复一个读数缺陷：
**保底布局下「丢弃卡片」被错记为 0**（详见 §5）。

## 2. 代码位置

存储层（[AI-6a]）：

- `packages/store/src/schema.ts` — `llmUsage` 新增 4 列；新表 `llmModelPrices`
  （`model` 主键、`prompt_per_1k_rmb`、`completion_per_1k_rmb`、`updated_at`）。
- `packages/store/src/driver.ts` / `migrate.ts` — SQLite 与 PostgreSQL 两套 DDL +
  `COLUMN_ALTERS` 兼容既有库。
- `packages/store/src/repository/llm-prices.ts`（新）— 读取/全量替换：trim、去空、丢掉非有限值、
  负数夹 0、按模型名排序、最多 120 条、`ON CONFLICT` upsert。
- `packages/store/src/repository/llm-usage.ts` — 写入时算成本（6 位小数），无价或无 token 记
  `NULL`；聚合新增总额/有价调用/无价调用/有价 tokens、分场景成本、`byModel`。
- `packages/store/src/repository/events.ts` — `copilotEventSummary` 增加无法核验链接与引用有效率；
  新增 `canvasQualitySummary`（窗口内生成数、首过数、保底数、丢弃数、首过率）。

中枢 API（[AI-6b]）：

- `apps/api/src/llm-prices.ts`（新）— `resolveLlmPrice`：簿价命中优先、旧版单一价兜底、都没有回
  `null`；读取失败也只记一条 warn，绝不让成本观测反噬一次成功的模型调用。
- `apps/api/src/llm-usage.ts` — 5 个写入点（callLlm 成功/失败、流式成功/失败、富化回调）全部带上
  单价快照。
- `apps/api/src/llm-config.ts` — 「测试连接」的成功与失败两条路径同样快照。
- `apps/api/src/routes/ai-config.ts` — `GET/PUT /api/admin/ai/prices`（PUT 全量替换，Zod 校验
  0~10000，最多 200 条，审计 `ai.prices.update` 只记数量与前 50 个模型名）；观测响应新增
  `costSource / costCoverage / byModel / canvasQuality`；画布路由记录 `canvas_generate` 事件。
- `apps/web-overlay/src/lib/hub-route-policy.generated.ts` — 重新生成（277 条，含两条 prices 路由）。

前端（[AI-6c]）：

- `apps/web-overlay/src/lib/navhub-api.ts` — 类型与 `fetchAdminAiPrices / saveAdminAiPrices`。
- `apps/web-overlay/src/components/ai/ai-price-book-panel.tsx`（新）— 单价簿面板：增删行、前端校验
  （空模型/重复/0~10000）、全量替换说明、旧版单一价徽标、脏标记与保存时间。
- `apps/web-overlay/src/app/admin/ai/page.tsx` — 新 Tab「模型单价簿」。
- `apps/web-overlay/src/components/ai/ai-observability-panel.tsx` — 成本卡三种来源话术与覆盖率、
  分模型成本表、画布首过率、copilot 引用有效率。
- `apps/web/src/**` 已通过 `node scripts/check-web-overlay.mjs --fix` 同步（933 个文件一致）。

## 3. 成本口径（可手算）

单价簿 `stub-model-1`：输入 ¥0.002 / 输出 ¥0.006（元 / 1K tokens）。

| 调用 | 输入/输出 tokens | 成本 |
| --- | --- | --- |
| 测试连接（stub-model-1） | 40 / 80 | 0.00008 + 0.00048 = ¥0.00056 |
| 画布生成（干净） | 120 / 260 | 0.00024 + 0.00156 = ¥0.0018 |
| 画布生成（保底） | 120 / 260 | ¥0.0018 |
| 测试连接（stub-model-2，未进簿、无旧版价） | 40 / 80 | `NULL`（未采集） |

合计 ¥0.00416 → 面板显示 `¥0.0042`，覆盖率 `3/4 次调用有单价，0.9k / 1.0k tokens`；
`byModel` 两行：`stub-model-1 3 次 / 3/3 有价 / ¥0.0042`、`stub-model-2 1 次 / 0/1 有价 / 无价`。

## 4. 浏览器实测（隔离栈，真实接口）

隔离栈（并行会话的 8787 / 3200 / 3411 全程未碰）：

- 中枢 `127.0.0.1:8920`，空库 `data/ai6/navhub.db`，`NAVHUB_MODE=lite`、embedding 关闭；
- 前端 `127.0.0.1:3420`（`NEXT_DIST_DIR=.next-ai6`，`NEXT_PUBLIC_API_URL` 指向中枢，
  凭证管理员登录）；
- 假上游 `127.0.0.1:8929`（`harness/stub-llm.mjs`）：普通对话回 pong，画布提示词按「保底」
  触发词回来本部署不存在的类型。

驱动：无头 Chrome（Playwright）。in-app 浏览器当前处于隐藏冻结状态，`take_snapshot`/`evaluate_script`
均报页面为空，因此判据来自真实浏览器的 DOM 文本、真实接口响应与截图，而不是源码断言。

主流程 `harness/browser.mjs` 共 19 条断言全部通过（`results/browser-evidence.json`）：

1. 单价簿空态与「旧版单一价未配置」徽标；
2. 空模型名、负数单价、重复模型三种校验都被前端拦下；
3. 合法保存后服端 `GET /api/admin/ai/prices` 返回同值；
4. `stub-model-1` 与 `stub-model-2` 各测试连接一次（第二次确实由 stub-model-2 应答）；
5. 经真实中枢接口生成两次画布：干净一次（`fallbackUsed=false`、1 张卡）、全幻觉一次
   （`fallbackUsed=true`、2 条 issue）；
6. 观测大盘：成本卡「按调用时单价快照折算：3/4 次调用有单价，覆盖 0.9k / 1.0k tokens」、
   总额 `¥0.0042`；分模型表两行（含「无价」）；画布首过率 50.0%（1/2）、丢弃 2 张、保底 1 次；
   copilot「引用有效率 无引用样本」如实标注；
7. 服务端 `observability` 数值与页面逐项一致。

分支渲染 `harness/browser-branches.mjs` 共 4 条断言（`results/browser-branches-evidence.json`）：
单价簿「旧版单一价 ¥0.003/1K」徽标、成本卡 legacy 话术、none 来源金额显示「未配置」且不出现
任何 `¥` 假数、指引到单价簿/环境变量。这两个分支的**服务端计算**由 API 测试的两个独立上下文
（legacy 0.003 / 无价）覆盖；浏览器这层只验证渲染话术，故用 Playwright route 注入受控响应。

截图：`results/shot-price-book.png`、`results/shot-observability-cost.png`、
`results/shot-canvas-quality.png`。

## 5. 实测发现的缺陷（已修复并加测试）

**保底布局时「丢弃卡片」恒为 0。** 事件里 `dropped = planned - validation.widgets.length`，而
保底时 `validation.widgets` 是系统三张保底卡，不是模型计划的存活项：计划 2 张全非法、保底 3 张，
`2 - 3` 被 `max(0, …)` 收敛成 0。面板于是把「一次计划全被丢弃的生成」显示成没丢卡。

修复（`apps/api/src/routes/ai-config.ts`）：

```ts
const dropped = validation.usedFallback ? planned : Math.max(0, planned - validation.widgets.length);
```

守卫：`apps/api/test/ai-config-api.test.ts` 的保底用例新增 `waitForCanvasEvent` 断言
`planned=2 / fallback=true / dropped=2`。浏览器复测前页面显示「丢弃卡片 0」，修复后为 2。

## 6. 测试与门禁

| 门禁 | 结果 |
| --- | --- |
| `packages/store` 全量 | 439 passed / 28 skipped（PG e2e 未设 `NAVHUB_TEST_DATABASE_URL`，如实跳过） |
| `apps/api` AI 相关 7 个套件 | 89/89（llm-prices-api、ai-config-api、ai-config、llm-usage、llm-quota、copilot-cancel、copilot-stream） |
| 新增存储测试 `packages/store/test/llm-prices.test.ts` | 11/11（簿 CRUD/全量替换/夹负数/丢弃非有限值/快照/NULL/聚合/分模型/canvas 质量） |
| 新增 API 测试 `apps/api/test/llm-prices-api.test.ts` | 10/10（端点、校验、审计、清空、解析链、快照、覆盖率、首过率、无价 ctx） |
| `node scripts/typecheck.mjs` | 5 个包通过 |
| `apps/web` tsc | 1 错，位于并行会话未提交的 `apps/web/src/app/videos/page.tsx`（`NavigationData`），本项贡献 0 条 |
| `node scripts/check-web-overlay.mjs` | OK：933 个覆盖层文件一致 |
| `node scripts/gen-hub-route-policy.mjs --check` | OK：277 条路由 |
| `node scripts/generate-rest-contract-types.mjs --check` | OK |

测试质量修正：`llm-prices-api.test.ts` 原先按 `id` 顺序断言两条 `llm_usage` 行，但
`recordLlmUsage` 是 fire-and-forget，合并运行时会偶发颠倒（实测复现 1/3 次）。已改为轮询到两条都
落库后按模型取行；`llm-usage.test.ts` 的最小假上下文补上 `getLlmModelPrice/getSystemState`，
避免预期的「无价」路径把 warn 打成 stderr 噪声。

## 7. 消融（改坏实现，断言必须变红）

每条消融后都用备份 `cp` 还原并 `cmp` 验证字节一致。

| 消融 | 期望 | 实测 |
| --- | --- | --- |
| `resolveLlmPrice` 不再查单价簿（`if (row && false)`） | 簿价优先 + 快照 + 总额三条红 | 3 failed（`expected 0.003 … to match 0.002`） |
| 无价成本写 `0` 而不是 `NULL` | NULL/覆盖率三条红 | 3 failed（`expected +0 to be null`） |
| 撤销保底丢弃计数修复 | 保底 `dropped=2` 那条红 | 1 failed（`expected +0 to be 2`） |
| 全量替换不再删除缺席模型 | 「旧模型退出定价」那条红 | 1 failed（`length 1 vs 2`） |
| 关闭旧版单一价兜底 | 解析链 + 快照 + 总额三条红 | 3 failed（`expected null to match 0.003`） |
| 首过判定不再排除保底布局 | 首过率 1/3 那条红 | 1 failed（`expected 2 to be 1`） |

## 8. 已保留的边界（如实申报）

- **单价是管理端手工填写**，不是供应商账单或汇率换算结果；「预估折合资费」只能当量级参考。
- **旧版单一价不区分输入/输出**，用它算出的成本天然是近似值；面板明确提示配置分模型单价后更准。
- **没有 token 读数就没有成本**：模型成功但未回 `usage` 时记 `NULL`，不按 0 计，避免「不知道」
  被当成「免费」。
- **画布首过率只统计画布生成**（`canvas_generate` 事件），不包含工作台手工编辑；事件不记提示词、
  布局内容与身份。AI 采纳率目前仍**没有采集**，本次没有新增该指标。
- **引用有效率依赖 copilot 引用事件**：没有引用样本时显示「无引用样本」而不是 0%。
- PostgreSQL 方言的 DDL/聚合由 `packages/store/test/llm-usage-pg.test.ts` 覆盖（3/3）；完整 PG
  e2e 需外部数据库，本次未连真实 PG 实例。
- `byModel` 的模型名来自接口响应回显；上游若不回 `model`，该行落到空名/默认名，成本按解析时的
  配置模型取价（与实际计费可能不一致），这是上游契约问题而非本项可兜底的。

## 9. 复现

```bash
# 1) 假上游
STUB_PORT=8929 node deliverables/ai6-cost-2026-10-30/harness/stub-llm.mjs &
# 2) 隔离中枢（空库）
(cd apps/api && NAVHUB_PORT=8920 NAVHUB_MODE=lite \
  NAVHUB_SQLITE_PATH="$PWD/../../data/ai6/navhub.db" NAVHUB_EMBEDDING_ENABLED=0 \
  NAVHUB_LLM_BASE_URL=http://127.0.0.1:8929/v1 NAVHUB_LLM_API_KEY=sk-stub-local-only \
  NAVHUB_LLM_MODEL=stub-model-1 NAVHUB_LLM_ALLOW_PRIVATE=1 node src/main.ts) &
# 3) 隔离前端
(cd apps/web && NEXT_PUBLIC_API_URL=http://127.0.0.1:8920 NEXT_DIST_DIR=.next-ai6 \
  NAVHUB_ADMIN_PASSWORD=sk-ai6-admin AUTH_SECRET=ai6-local-only-secret-0123456789abcdef \
  AUTH_TRUST_HOST=true npx next dev -p 3420) &
# 4) 浏览器验证（需要本机 Chrome）
node deliverables/ai6-cost-2026-10-30/harness/browser.mjs
node deliverables/ai6-cost-2026-10-30/harness/browser-branches.mjs
```

## 10. 收尾

隔离栈三个进程已停，8920 / 8929 / 3420 已释放；`apps/web/.next-ai6`、`data/ai6` 已删除；
`apps/web/tsconfig.json`（未被 git 跟踪）里 Next 自动追加的两条 `.next-ai6` include 已移除。
本项未执行任何 commit / push。
