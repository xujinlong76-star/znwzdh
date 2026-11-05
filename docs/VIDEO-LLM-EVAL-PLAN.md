# 视频自主采集的真 LLM 评估 · 设计方案（决策就绪，待拍板）

> 状态：**设计定稿，未实施**。实施前需要两个产品决策：① 用哪个模型/预算档位；② 是否接受采集周期从 ~25s 增至 ~40-60s（LLM 往返）。
> 本文回答"接在哪、怎么接、花多少钱、怎么防跑飞"，拍板后预计 1-2 个工作日落地。

## 一、背景与现状

`apps/web/src/lib/video-autonomous-ai-harvester.ts` 名为"AI 自主采集"，实际是**启发式**：

| 环节 | 现状 | 位置 |
|------|------|------|
| 候选评估 | 标题党正则 + ~90 词关键词表 `includes` 匹配 + 时长/互动比率加权 | `evaluateVideoWithAIModel`（:93-211） |
| 元数据合成 | 固定模板（4 章节/4 字幕/3 测验），默认关闭 | `generateAISanitizedMetadata`（:217-326） |
| 选题来源 | 静态池 `video-topics.json` | `CURATED_TRENDING_TOPICS` |

词表里出现 'OpenAI'/'Claude' 只是关键词匹配，**全文件没有任何 LLM 调用**。

## 二、为什么现在直接接 LLM 是错的

1. **评估发生在 `mutateVideoLibrary` 回调里**（`runAutonomousCycle` → controller.runCycle）。
   mutate 持有版本号做冲突重放，回调里塞 15 次 × 2-4s 的 LLM 往返 = 版本持有时间从秒级涨到分钟级，
   与管理端编辑的冲突概率大增，重放（重跑整轮采集）的代价翻倍。
2. **apps/web 不能直接 import packages/ai**（vendored 底座约束，见 `video-write-guard.ts` 头注释），
   web 侧自己写 fetch LLM 会绕过中枢的配额与用量台账（`llm-quota.ts` / `llm-usage.ts`）。
3. 内部令牌 `NAVHUB_INTERNAL_TOKEN` 是**限流豁免**标记（`internal-traffic.ts`），不是鉴权——
   新 hub 路由必须走正式 route-policy（scope 声明 + rest-contract 生成 + unbound-write 门禁）。

## 三、目标架构（拍板后按此实施）

```
[web] video-autonomous-ai-harvester.runCycle
        │  阶段 1.5（新增，mutate 之前）：候选预筛
        ▼
[web] video-llm-eval.ts  ──POST /api/videos/llm-eval──▶  [hub] routes/videos-llm.ts
      （NAVHUB_VIDEO_LLM_EVAL=1 才启用）                    │ resolveLlm(ctx)（复用 refetch_metadata 的模型解析）
                                                           │ reserveLlmQuota / settleLlmQuota（复用 jobs.ts 模式）
                                                           │ chatCompletion（packages/ai，一次调用批量打分）
                                                           ▼
                                                      JSON 分数数组（fail-soft）
```

关键决策点（已定）：
- **批量单调用**：一轮最多 15 个候选，拼成一个 prompt 一次打分（tokens ≈ 15×120 输入 + 15×60 输出），
  而不是 15 次往返。超时 20s，超时/解析失败 → **整体回落启发式**（启发式保留为永远在线的 fallback）。
- **mutate 之前**：预筛发生在 `runCycle` 读快照之后、进入 `mutateVideoLibrary` 之前。
  LLM 拒绝的候选直接不进 mutate；进 mutate 的逻辑保持现状（版本持有时间不变）。
- **成本闸门**：`NAVHUB_VIDEO_LLM_EVAL_DAILY_BUDGET`（默认 200 次调用/天）接 `llm-quota` 的 reservation；
  超预算当日自动回落启发式并记 degraded（报告可见，不静默）。

## 四、实施清单（拍板后执行）

1. **hub 路由** `apps/api/src/routes/videos-llm.ts`：`POST /api/videos/llm-eval`，scope `admin`
   （cron 侧带 `CRON_SECRET` 时按 internal 归属，见 route-policy 既有先例）。
   请求：`{ candidates: Array<{id,title,description,author,durationSec}> } ≤ 20`；
   响应：`{ scores: Array<{id, qualityScore(0-100), teachingValue, rejectReason?}> }`。
   *登记面*：hub-route-policy 生成（`pnpm gen:hub-policy`）、rest-contract 生成（`pnpm gen:rest-contracts`）、
   `unbound-write-routes` fixture 补条目、`response-contracts.test` 补响应契约。
2. **web 客户端** `apps/web/src/lib/video-llm-eval.ts`：env 门控（默认关）、
   20s 超时、fail-soft 返回 null（= 用启发式）、响应 schema 校验（zod，与中枢同一套）。
3. **harvester 接线**：`runCycle` 阶段 1.5 调用预筛；`AutonomousHarvestCycleReport` 增
   `llmEvaluated: number` / `llmFallbackReason?: string` 字段，管理端"AI 思考过程"面板如实展示
   用没用上真模型（诚实性要求，同 `dataSource: fresh/cached` 的口径）。
4. **测试**：hub 路由契约测试 + web fail-soft 行为测试 + 预算耗尽回落测试 + 双路径守卫
   （LLM 关闭时行为与现状逐字节一致的回归锚）。

## 五、预算测算（按 GLM-4-Flash 档单价，供拍板参考）

一轮 hybrid cron：策略采集（无 LLM）+ 自主周期 1 次 LLM 批量调用 ≈ 3-5K tokens。
按每天 24 次定时 + 20 次手动 = **~45 次调用/天 ≈ 0.2M tokens/天**，日常成本可忽略；
真正要防的是"手动狂点"，故预算闸门默认 200 次/天足够宽裕。

## 六、明确不做的事

- ❌ web 侧直连 LLM 供应商（绕开中枢配额/台账，架构红线）。
- ❌ 用 `/api/copilot/chat` 当评估后端（那是带系统提示词的对话入口，语义不符且无配额粒度）。
- ❌ LLM 参与删除决策（淘汰仍由保鲜分+探活三态驱动；LLM 只评"要不要收进来"）。
