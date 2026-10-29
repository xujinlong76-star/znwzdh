# [AI-4a] 画布逐类型 schema 校验 · 实施与实测记录（2026-10-28）

## 1. 结论

`/api/user/ai/canvas/generate` 不再「夹一下跨度、丢一下类型」就返回：模型输出的每个模块
都按 **本站目录里这张卡自己的** 声明逐字段校验，每一处改动都进台账，一张合法卡都没拿到时
返回**系统保底布局并明说**。前端把台账和保底状态如实显示出来。

改动前后对照（同一份脏输出：`hyperbolic-radar colSpan=2` / `not-a-real-widget` /
`rss-feed feedUrl=javascript:alert(1)` / `limit="很多"`）：

| 场景 | 改前 | 改后 |
| --- | --- | --- |
| 跨度越界 | 统一夹到 1~12，卡片挤破栅格 | 夹到该卡 `4~8` 的下限 4，并记 `宽度 2 超出该卡支持的 4~8，已改为 4` |
| 非法类型 | 静默少一张卡 | 进 `droppedTypes`，横幅点名「其中 1 类模块本站没有对应卡片」 |
| 伪协议取数地址 | 原样进用户画布 | 清空 + `config:dropped`，浏览器里 `javascript:` 在整页 DOM 中都找不到 |
| 全是幻觉 | 也返回一张空画布，看着像模型规划的结果 | `fallbackUsed=true`，红色 `role=alert` 横幅「保底布局：未按原规划生成」，头部徽标改口为「系统保底 3 张卡」 |

## 2. 代码位置

- `packages/core/src/modular.ts` — `MAX_CANVAS_WIDGETS` / `CanvasWidgetIssue` /
  `validateCanvasWidgets`（跨度按 `BUILTIN_WIDGET_CATALOG[type].min/max` 收敛；config 由
  目录 `configSchema` 派生 zod；`URL_LIKE_CONFIG_KEYS` 只放 http(s) 与同源相对路径；
  非法结构回 `fallbackCanvasWidgets`）。
- `apps/api/src/routes/ai-config.ts:543` — 手写的 `VALID_WIDGET_TYPES` 与本地夹紧逻辑删除，
  统一走 `validateCanvasWidgets`；响应新增 `fallbackUsed` / `canvasIssues`（最多 20 条）/
  `canvasIssueTotal`。
- `apps/web-overlay/src/lib/navhub-api.ts` — `HubAiCanvasGenerateResult` 补三个字段。
- `apps/web-overlay/src/components/modular/ai-canvas-generator-modal.tsx` — 保底横幅、
  台账 `<details>`、以及 `fallbackUsed` 时的徽标改口。
- 测试：`packages/core/test/canvas-widget-validation.test.ts`（19 条）、
  `apps/api/test/ai-config-api.test.ts` 新增 2 条（脏数据逐条记账 / 保底必须标注）。

## 3. 门禁

| 门禁 | 结果 |
| --- | --- |
| `packages/core` tsc | 0 错 |
| `apps/api` tsc | 0 错 |
| `packages/core/test/canvas-widget-validation.test.ts` | 19/19 |
| `apps/api/test/ai-config-api.test.ts` | 21/21 |
| `node scripts/check-web-overlay.mjs` | OK：904 个覆盖层文件与 apps/web 一致 |
| `apps/web` tsc | 18 错，全部在并行会话的 `test/video-*.test.ts`（`NavigationSubItem.enabled`、`FlashcardItem`、`VideoStudyNote` 字段），我贡献 0 条 |

全量 `packages/core` 在子包目录里跑会出现 `probe-contract.test.ts` 4 条 ENOENT 假红灯：
它按 `process.cwd()/docs/contracts/probe.json` 读契约，仓库根有该文件、`packages/core` 没有。
从仓库根跑 4/4 通过。既有问题，不属于本项改动。
全量 `apps/api` 的 2 条红灯在 `test/jobs.test.ts`（cron tick 超时、jobEventBus 未派发 running），
`apps/api/src/jobs.ts` 与测试文件都是并行会话的未提交改动，与本项无关。

## 4. 消融（改坏实现，断言必须变红）

| 消融 | 期望 | 实测 |
| --- | --- | --- |
| 跨度改回统一 `1~12 / 1~4` | 越界收敛两条红 | `Tests 2 failed`（`expected 4 to be 2` 等） |
| 关掉伪协议守卫（`urlKey = false`） | `javascript:` / `//host` 两条红 | `Tests 2 failed`，报错正是 `expected 'javascript:alert(1)' to be ''` |
| 删掉 `coerceFieldValue` 的布尔分支 | `"false"` 判成 false 那条红 | `Tests 1 failed`（`expected true to be false`） |
| 路由写死 `fallbackUsed: false` | 保底那条 API 断言红 | `Tests 1 failed` |
| 路由不返回台账（`canvasIssues: []`） | 记账断言红 | `Tests 1 failed`（`expected [] to include 'span:adjusted'`） |

第三条消融原本是「删掉 `normalizeCanvasConfig` 里字符串转布尔的一行」，结果 **19 条全绿**：
说明 `coerceFieldValue` 已经先转好了，那一行和 schema 里的 `z.enum(['true','false'])` 都是死代码。
于是先把实现改成单一职责（coercion 只做一次、schema 用 `z.boolean()`），再用真消融证明它要紧。
这条记进经验：**跑不红的消融不是「测试太松」，而是「实现有冗余」的信号。**

## 5. 浏览器实测

隔离栈（并行会话的 8787/3200/3411 全程未碰，空库、独立端口、独立 dist）：

- 中枢 `127.0.0.1:8910`，`NAVHUB_MODE=lite` + 新建空库 + 关掉 embedding；
- 前端 `127.0.0.1:3413`（`NEXT_DIST_DIR=.next-ai4a`，`NEXT_PUBLIC_API_URL` 指向上面）；
- 上游是 `harness/stub-llm.mjs`（`127.0.0.1:8919`，`NAVHUB_LLM_ALLOW_PRIVATE=1`）。
  触发词写在提示词里：含「保底」→ 全非法；否则 → 脏数据。

在 `/custom` 开启自定义排版 → 「AI 智能规划」→ 生成，两条链路都验证到渲染结果
（`results/browser-evidence.json`）：脏数据出「校验改动了 4 处」台账并把雷达卡宽度改成 4；
全非法出红色 `role=alert` 横幅、徽标改口「系统保底 3 张卡」。
点「添加为新看板标签」后新看板只有 2 张卡（丢弃的那张没进画布），RSS 卡显示「尚未配置订阅地址」，
整页 `body.innerHTML` 不含 `javascript:`，`iframe` 数 0。console error/warn 均为 0。

**未取得截图**：in-app 浏览器此刻不可见（`take_screenshot` 报
`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE, visible=false`），判据来自 a11y 快照与 `evaluate_script`
真读 DOM，而不是源码断言。这一点如实记着，不当作「界面已肉眼确认」。

## 6. 已保留的边界

- 台账最多随响应给 20 条，总条数另给 `canvasIssueTotal`，避免一次规划塞回上百条记录。
- 保底三件套（快捷搜索 / 星标坞 / 便签）全部用目录默认跨度，不引入需要用户先配置的外部依赖。
- `custom-category` 等需要外部输入的字段：缺字段仍是「静默回默认值」，因为提示词明确允许留空，
  给它记一条 `defaulted` 只会把台账变成噪声。只有**给了但不合法**才记账。
- 插件全量 manifest 校验（`validatePluginManifestWithCatalog`）保持原样，本项只覆盖内置画布。

## 7. 收尾

隔离栈三个进程已停，端口 3413/8910/8919 已释放；`apps/web/.next-ai4a`、`data/ai4a` 已删除。
`apps/web/tsconfig.json`（未被 git 跟踪）被 Next 自动加了 `.next-ai4a/types` 两条 include，
对应目录已不存在，glob 匹配为空，不再污染 tsc。

## 8. 复现

```bash
# 1) 假上游
STUB_PORT=8919 node deliverables/ai4a-canvas-2026-10-28/harness/stub-llm.mjs &
# 2) 隔离中枢
(cd apps/api && NAVHUB_PORT=8910 NAVHUB_MODE=lite \
  NAVHUB_SQLITE_PATH="$PWD/../../data/ai4a/navhub.db" NAVHUB_EMBEDDING_ENABLED=0 \
  NAVHUB_LLM_BASE_URL=http://127.0.0.1:8919/v1 NAVHUB_LLM_API_KEY=sk-stub-local-only \
  NAVHUB_LLM_MODEL=stub-canvas-1 NAVHUB_LLM_ALLOW_PRIVATE=1 node src/main.ts) &
# 3) 隔离前端
(cd apps/web && NEXT_PUBLIC_API_URL=http://127.0.0.1:8910 NEXT_DIST_DIR=.next-ai4a \
  npx next dev -p 3413) &
# 4) 纯 HTTP 复现两条响应
curl -X POST http://127.0.0.1:8910/api/user/ai/canvas/generate \
  -H 'content-type: application/json' -H 'x-navhub-anon-id: curl-anon-3' \
  --data-binary @deliverables/ai4a-canvas-2026-10-28/harness/body-dirty.json
```
