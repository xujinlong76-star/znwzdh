# [AI-3] 端到端流式对话 · 实测交付记录（2026-10-28）

被测链路：抽屉 `ai-copilot-drawer.tsx` → Next 代理 `/api/hub/[...path]` → 中枢 `apps/api/src/routes/copilot.ts`
→ 网关 `callLlmStream` → 模型上游。本目录只回答一件事：**逐段输出、中途停止、引用降级这三件事在真实浏览器里到底成立没有。**

## 1. 结论（一句话）

成立。30 条巡检全部通过（0 缺陷 / 0 前置不成立），并且其中两类判据做过**消融**——把实现改坏，断言确实变红，说明绿灯不是「断言写了但没咬」。

## 2. 实测环境（隔离栈，不碰并行会话）

| 角色 | 端口 | 说明 |
| --- | --- | --- |
| 模型上游（假） | 127.0.0.1:8899 | `fake-llm.mjs`，OpenAI 兼容 SSE，`CHUNK_MS=220`，每个半帧切片发送 |
| 中枢 | 8912 | `apps/api/src/main.ts`，独占副本库 `data/e2e/navhub-ai3-stream.db` |
| 前台 | 3412 | `next dev`，独占 `NEXT_DIST_DIR=.next-ai3-dev` |
| 浏览器 | Chromium（Playwright，headless） | 页内 120ms 采样器，不用 Node 往返取样（往返比流还慢，测不到逐段） |

并行会话的 :8787 中枢 / :3411 dev / 共享 dev 库全程未被读写；收尾时只杀了自己起的 3 个进程。

## 3. 30 条巡检与实测数字

- **P0 前置闸门**：先 PUT 打开 `stream.enabled`，再直连中枢 POST 读 ≥900 字符，必须是
  `text/event-stream` 且出现 `"type":"reasoning"` 或 `"type":"delta"`。不满足就 `exit(3)`，不跑 UI 断言——
  否则「中枢这轮根本没走流」会被报成「前端没渲染」。本次 head 帧：
  `: connected` + 3 条 `reasoning` 分片。
- **B1–B6（逐段输出）**：草稿气泡出现；**增量前缀链**（每一帧都以上一帧全文开头，实测 `prefixViolations=0`）；
  草稿期 `draftAnchorsMax=0`（没有任何可点链接）；停止按钮可见；读屏区播报切到「逐段输出」；
  首字出现在约 **1.26s**（`samples` 里 `len:0 → len:7` 那一跳），此前转圈只有一颗停止按钮。
- **C1–C6（中途停止）**：第 N 字点击停止 → 网络层 `net::ERR_ABORTED`；草稿作废（半截内容不留屏）；
  停止后不再吐字；播报「已停止本次回答」；重试出口带回原问题。上游日志证明掐到了源头：
  `done tag=#巡检C mode=stream aborted=1`（要用 `res.on('close') + !writableEnded` 判，只看 `req.close` 会把
  「真被掐断」测成「跑完了」）。
- **D1–D7（终稿与引用）**：终稿渲染真候选链接；模型编造的 `https://fabricated.example/...` **没有变成 href**，
  以纯文本留在正文（`groundCopilotReply` 把 markdown 链接替换成标题）；草稿不与终稿同屏；模型名如实上报。
- **E0–E6（降级）**：撤掉模型配置后**全程没有草稿气泡**、回一次性 `application/json`、琥珀横幅
  「管理端尚未配置可用的模型密钥…」、不冒充模型来源、仍给可点击的站内候选、这一轮**一次上游都没打**
  （`perPhase.E=0`）。
- **Z1**：console error 0 条。**Z2（混流自检）**：`untaggedUpstreamCalls=0`，`perPhase={B:1,C:1,D:1,E:0}`
  ——每条提问都带 `#巡检X` 归属标签，环境被别人共用时不可能冒充这一轮的证据。

## 4. 消融（证明判据会咬人）

1. **harness 自身**：`AI3_ABLATE=tail-label`（把草稿节点定位改回「尾标签」）→ `FAIL B2 prefixViolations:7 maxDraftLen:15`。
   这条消融同时纠正了一处**弱判据**：原来 B2 只看「已输出 N 字」计数文案变化，改坏定位仍能误报绿，
   现在锁的是前缀链 + `maxDraftLen>=40`。
2. **产品取消链**：临时摘掉 `copilot.ts` 里 `bindReplyAbort` 的接法 → `copilot-cancel.test.ts` 2 条转红；
   还原后 8 条转绿，还原前后 md5 `f97c6bef5356bf767d1beb7fdf4aac38` 逐字节一致。
3. **引用客户端报错形状**：把 `copilot-stream.ts` 非 2xx 分支从 `throw` 改成静默 `return` →
   2 条守卫红，报「预期这次调用会抛错，但它成功 resolve 了」；还原后 49 条全绿，md5 `018900de…` 一致。

## 5. 回归闸门（本次改动归属）

| 闸门 | 结果 | 我的责任范围 |
| --- | --- | --- |
| `node scripts/typecheck.mjs` | 通过 5 包 | apps/api 侧改动 0 回归 |
| 前端 tsc（`apps/web`，非增量） | 修复前 27 错 → 修复后 18 错 | 我引入并已修的 5 条（`test/copilot-stream-guard.test.ts` 联合类型未收窄）；剩余 18 条全部在并行会话的 `test/video-*.test.ts` |
| `vitest run copilot`（apps/api） | 40/40 | 取消链 8 条含在内 |
| `vitest run copilot-stream-guard + copilot-cancel-guard` | 49/49 | — |
| `node scripts/check-web-overlay.mjs` | OK：903 个覆盖层文件一致 | overlay 与镜像同步 |

一次 `vitest run copilot` 首跑出现过 4 条红（跨 3 个文件，含我没碰的用例），日志未落盘；随后两次（第二次故意并发压测）
连续 40/40，期间并行会话正在改 `apps/web/src`。判为负载/并发写导致的瞬时抖动，**不是**已定位缺陷，
但记在这里：取证脚本要把首跑输出重定向到文件，否则这类红只有计数没有原因。

## 6. 已如实保留的边界（没改，也不该顺手改）

- 抽屉停止文案写「中枢侧最多还会跑到代理期限（120 秒）」，实测中枢是**立刻**掐上游（`aborted=1`）。
  这句是保守上界而非错误，留着；真要收紧得连带代理语义一起定，不属于这一轮。
- `sendCopilotChat` 已不再被抽屉使用，但仍有守卫引用，本轮不删（删除要另一轮收编）。
- 行为测试与根 vitest 跑的是**镜像** `apps/web/src`，消融必须打在镜像上；`overlay` 才是事实源，改完要同步。

## 7. 报告项状态

- **videos.json 孤立代理让 `next build` 失败**：并行会话已修并提交（`8ca197ff fix(data): 修复 videos.json 里被截断的 emoji…`）。
  我这边为隔离构建打过的临时补丁早已按字节还原（备份 `6369615` 字节 vs 现在 tracked `6369609` 字节，差异就是那 6 个字符的
  `\ud83d` 截断残骸），两棵树当前 sha1 一致且工作树干净。缺口本身提醒仍然成立：**Node 接受、Turbopack 拒绝**，
  所以 `check-syntax` 类闸门看不见它。
- **管理端「深度思考关不掉」**：属 `apps/api/src/llm-config.ts`，不在本轮范围。
- **13:57:18 外部写回把抽屉覆盖**：取证脚本与恢复出的源码留在此目录（`drawer-recovered-from-transcript.txt`）。
- `scripts/typecheck.test.ts` ×2 归属并行会话 STAGED 的 `scripts/verify.mjs`。
- 并行会话 WIP 文件（`video-card.tsx`、admin 各 client、`hub-proxy.ts`、`navhub-api.ts` 等）一律未改、未提交。

## 8. 收尾

- 进程：:8899 / :8912 / :3412 已停（只停自己起的 3 个 PID），:8787 / :3411 仍在跑，未被触碰。
- 数据与产物：`data/e2e/navhub-ai3-stream.db*`、`.next-ai3-dev`、`.next-ai3-prod` 已删；
  另外清掉早几轮我自己的陈旧构建目录 `.next-audit-gw-dev`、`.next-uibuild9`、`.next-userflow`
  （它们会通过 tsconfig 的 `.next*/types/**` 通配往 tsc 里注入 3 条假错——这条坑值得记住）。
- 取证脚本与临时备份（`.cache/*`、根目录 `scan-*.cjs` / `inspect-*.cjs` / `replay-drawer.cjs` / `install-drawer.cjs`）已清理；
  证据只留本目录。

## 9. 复现

```bash
node deliverables/ai3-stream-2026-10-28/fake-llm.mjs            # 上游
# 中枢与前台用独占端口 + 独占 NEXT_DIST_DIR + 副本库起（见 §2）
node deliverables/ai3-stream-2026-10-28/01-browser.mjs          # 30 条巡检 + 归属自检
```

原始证据：`results/browser-evidence.json`（逐条判定 + 采样轨迹 + `gate` + `bags`）、
`results/logs/`（tsc 修复前后、api 40/40）、`results/*.png`（B/C/D 三态与最终态截图）、
`fake-llm.log` 与 `hub.log`（按 `#巡检X` 对得上的两侧时间线）。
