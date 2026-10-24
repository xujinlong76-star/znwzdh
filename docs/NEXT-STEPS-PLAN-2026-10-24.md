# NavHub 下一步升级建议方案（第五批候选）

> 版本：v1.0 · 2026-10-24 · 基于当前 main（`2951d26`）的只读研究。
> 前置：`USER-CENTER-UPGRADE-PLAN-2026-10-24.md`（第四批 T1–T24 已全部落地，`11c8ce9`）；用户中心视觉统一四连提交（`1c37044`/`fbccddf`/`4a3fc4e`/`62b5bbc`）；并行会话执行记录见 `UPGRADE-EXECUTION-2026-10-24.md` §8 遗留登记。
> 研究口径：四条主线各带证据（文件:行号 / 实测数据），按「工程债 → 产品增量 → 体验一致性 → 质量基建」排序；每项给验收口径与风险。

---

## 0. 基线快照（2026-10-24 晚）

| 维度 | 现状 | 证据 |
| --- | --- | --- |
| 功能 | 用户中心第四批 24 项全部 ✅（含 ETag/304、Copilot 上下文、用户级 token、通知中心 v1） | 计划文档 §实施进度表 |
| 视觉 | 用户中心 9 页 + 共享状态组件 + 账号/数据页面级组件已统一「玻璃 + 彩色芯片 + 悬浮」语言，明暗双主题实拍验收 | 四个 style 提交 |
| 体积 | 71 条路由全部在棘轮内；**首页 1041/1115 KB（余量 6.6%，全站最紧）** | `check-bundle-budget.mjs --json` 实测 |
| 测试 | 全量 347 套件 / 3832 用例 / 0 失败（457s，`isolate` 提示可省 ~98s）；E2E 16 个 spec | vitest 运行输出 |
| 并行约束 | `navigation-card.tsx`（tsc 3 错）、`favorites/page.tsx`（URL 筛选 WIP）、`apps/api/routes/*`（17 个文件）、`backup.ts`（S3 恢复缺陷修复中）为并行会话领地 | `git status` + 执行文档 §8 |

**两条已登记未修红灯**（执行文档 §410-412 行）：`navigation-card` 的 card-tag-links / keyboard-activation（属并行 WIP，待其合入后自愈或接手）；备份恢复丢 `createdAt`（`insertSitesBulk` 未接该列，`backup.ts` 阻塞中）。

---

## 1. 主线 A：巨石组件治理与首页预算（P1，工程主线）

**为什么现在做**：这是两份执行文档都明确标注「属独立批次、未拆」的最大工程债；且首页预算余量全站最紧（6.6%），并行会话正在做首页卡片性能改造，拆分与预算是同一场仗的两面。

### A1 algorithm-lab 拆分（2216 行，最高优先）

- **现状**：`apps/web-overlay/src/components/algorithm-lab.tsx` 单组件 2216 行；第四批已抽出纯函数模块 + 14 例单测 + 4 例 E2E（执行文档 §E9/E13），安全网是四个巨石里最全的——**拆分条件已成熟**。
- **实施**：按「实验参数区 / 可视化画布 / 结果对照区 / 步骤导览」切 3–4 个子组件 + 1 个 `use-algorithm-lab` 状态钩子；沿用 T14 收藏页拆分模式（状态先入 hook、页面只留渲染），每拆一块跑既有 14 单测 + 4 E2E 守行为等价。
- **验收**：主文件 < 600 行；单测/E2E 全绿不改动断言；`/algorithms` 路由体积不升。
- **风险**：中。50+ 个 state 紧耦合，第一刀选「导览文案/静态展示」这类零状态块。

### A2 admin/sitelist 拆分（2128 行）

- **现状**：`apps/web-overlay/src/app/admin/sitelist/page.tsx` 2128 行；筛选索引化一期已落（`e0b5e07`），E2E 4 例 + 写路径 3 例已建立（`cfbea69`）。
- **实施**：先抽 `use-sitelist-filters`（筛选/分页状态机）与筛选工具栏组件，再拆表格行渲染；顺手落 §5 E9 留下的**小写化字段预计算**（`setSites` 分支维护派生缓存，筛选再省一半计算）。
- **验收**：主文件 < 800 行；筛选行为 E2E 不变；预计算有基准对照（大数据量下筛选耗时减半可测）。
- **风险**：中低。管理页无 SEO/SSR 面。

### A3 插件域两个次巨石（1817 + 1717 行，P2 可排后）

`marketplace/[slug]/plugin-detail-view.tsx` 1817 行、`plugins/ai-plugin-studio-modal.tsx` 1717 行。拆分模式同上，但安全网（行为测试）比 A1/A2 薄，建议先补测试再拆，放批次后半。

---

## 2. 主线 B：用户数据走出浏览器（P1，产品主线）

**为什么现在做**：T20 用户级 token 已落地且生态全通——chrome/raycast 扩展都已走 `Bearer navhub_api_token`（`extensions/chrome-extension/popup.js:253`、`extensions/raycast-extension/src/browse-plugins.tsx:79`），MCP HTTP 鉴权已查 `api_tokens` 表（`packages/mcp/src/http-server.ts:123`）。地基齐了，缺的是上面的产品功能。

### B1 Chrome 扩展「收藏当前页」（用户价值最大的一块）

- **现状**：扩展目前只有读路径（搜索 `popup.js:182`、插件列表 `:305`、健康检查）+ 一个 auto 提交建议 POST（`:255`）；**没有「把当前标签页收藏进 NavHub」的写路径**——导航站扩展的核心场景缺席。
- **实施**：
  1. 后端：`api_tokens` scope 增加 `favorites:write` 能力位（现只读族），`POST /api/favorites` 增加「持个人 token 即 owner 身份」分支（T20 已建 `AuthIdentity.ownerId` 通道，`routes/favorites.ts` 挂接即可）；
  2. 扩展：popup 加「收藏此页」主按钮 + `chrome.contextMenus` 右键菜单 + 已收藏状态探测（GET 查重）；失败走诚实申报（离线入队、恢复后重试），复用 `offline` 模式先例；
  3. 前端 `/me/plugins` 或收藏页给扩展加「连接引导」入口（扫码/复制 token 的引导文案）。
- **验收**：E2E 或集成测试——用户 A 的 token 收藏只落 A 名下（越权测试沿用 T20 先例）；扩展离线收藏恢复后可见；吊销 token 后 401。
- **风险**：中。写 scope 是权限面扩张，按 T20 纪律灰度起步（默认创建的 token 仍只读，写 scope 需显式勾选）。

### B2 MCP 用户域工具（favorites / history 查询）

- **现状**：`packages/mcp/src/tools.ts` 仅 140 行、工具集很小；http-server 已能按 token 识别身份，但**没有任何「读我自己收藏/历史」的工具**——T20 第 6 点明确留了这个口（「MCP HTTP 已查同表自动继承，后续可加 favorites 工具」）。
- **实施**：加 `list_favorites`（folder 过滤 + 分页）、`list_search_history`、`get_profile_summary` 三个只读工具，scope 校验复用 B1 的能力位；README 补 Claude/Raycast 配置示例。
- **验收**：MCP 集成测试（token → 工具调用 → 数据隔离）；无 token 时工具不注册。
- **风险**：低。纯读、鉴权链路现成。

### B3 多端一致性推进（ETag 已通，SSE 可立项）

- **现状**：T18 已落 ETag/304（BFF 透传）；计划文档 T18.3 原文「为多端一致性提供 1/5 成本的 SSE 替代（低成本前置）」——前置已完成。
- **实施**：一期做「收藏变更轻量通知」（`GET /api/me/favorites/version` 水位轮询即可，不上 SSE）；二期再评审 SSE（执行文档 T14 提到「SSE 评审」尚未立项）。
- **风险**：低（一期）/ 中（二期连接治理）。

---

## 3. 主线 C：全站设计语言与可访问性外扩（P2，体验主线）

**为什么做**：用户中心家族已统一，但站点级「目的地页面」还有断层；a11y 锁定范围极窄。

### C1 目的地页面状态组件统一（快赢）

- **现状实测**：hot/tags/sites/collections/graph/algorithms/import/submit/videos/custom/marketplace 十一个页面 **SectionState 覆盖为 0**（grep 实测），各自手写加载/空/错样式；hot 与 collections 的 Hero 已是 market-hero 玻璃语言（`hot-view.tsx:205`、`collection-detail-view.tsx:131`），说明页头断层不大、**断层在状态态与卡片细节**。
- **实施**：逐页把 loading/empty/error 接入 `SectionState`（组件已具备三态 + a11y 语义）；卡片 token（rounded-2xl/border-border/70/bg-card/60）与图标芯片模式按用户中心先例对齐。**注意**：hot-view 等文件不在并行会话领地，可安全动手；`favorites/page.tsx` 与 `navigation-card.tsx` 不动。
- **验收**：每页空态/错误态可触发截图验收；`a11y-contrast` 扩展锁定（见 C2）。

### C2 a11y-contrast 守卫扩容

- **现状**：`apps/web/test/a11y-contrast.test.ts` 只锁 `modular-canvas` 与 `footer` 两处（`:27`/`:34`）——用户中心新视觉（导航、统计芯片、时间线）全在锁定外。
- **实施**：把 `user-center-nav.tsx`（foreground/70 未激活项）、`stats-grid.tsx`（彩色芯片文字 token）纳入锁定；目的地页面随 C1 逐页纳入。
- **风险**：低，纯守卫。

### C3 暗色模式守卫（可选）

四批美化已实拍暗色，但无自动化锁定。可在 E2E 加 1 例「暗色 /me 关键元素存在性」烟囱截图对比（容差对比），防止后续改动破坏暗色。投入小、防回归价值高。

---

## 4. 主线 D：质量与开发体验（P1 快赢 + P2 基建）

### D1 react-hooks 新规则 10 条 warning 清偿（快赢，半天）

- **现状**：并行会话升级 eslint react-hooks 规则后暴露 10 条 warning（0 error，`eslint .` 门槛不挡）：`set-state-in-effect`×6（`me/data/page.tsx:184,225`、`api-tokens-panel.tsx:57`、`quarantine-zone.tsx:63`、`session-devices-panel.tsx:65`、`me-view` 一处）、`exhaustive-deps`×1（`data/page.tsx:351`）、`refs`×3（`data/page.tsx:610,629` 渲染期读 ref）。
- **实施**：`refs` 三条是真问题（渲染期读 `lastBackupRef.current` 会漏渲染），改为 state 或派生；`set-state-in-effect` 按官方模式改事件驱动或惰性初始化；`persistResume` 补依赖或 useCallback 包裹。
- **验收**：`npx eslint <十文件> --max-warnings 0` 全绿；行为测试不回退。
- **风险**：低。**注意**：`me/data/page.tsx` 是我本轮刚美化过的文件，但警告行是存量逻辑，不属于并行 WIP 文件，可动手。

### D2 vitest 提速（快赢，一行配置 + 验证）

- **现状**：全量 457s，runner 自报 `isolate: false 可省 ~98s`（347 个 worker 各自冷启动 ~854ms）；`vitest.config.ts` 用 `pool:forks + maxWorkers:3`。
- **实施**：`isolate: false` 灰度试跑全量两遍（观察有无测试间污染——本仓测试多为每文件自建 fixture，风险低）；同时把 `check-coverage` 相关的 fixture 删除护栏问题沿用现有 clean:false 规避。
- **验收**：全量时间 457s → ~350s 内；连跑两遍结果一致。
- **风险**：低-中（若有隐藏的测试间共享状态会翻红，翻红即回滚该行）。

### D3 E2E 稳定性固化（基建）

- **现状**：本轮视觉验收三次撞环境问题——dev 冷编译超时（45s 不够，放宽到 120s 才过）、webServer 120s 启动预算被打满、`data/e2e/navhub-e2e.db` 被锁（EBUSY unlink 失败）。`scripts/e2e-local.mjs`（自动挑端口）刚落地，证明方向对。
- **实施**：① `playwright.config` 的 webServer 预算按「冷编译」校准（或预热探测就绪而非固定等待）；② 启动前对 `navhub-e2e.db` 做带重试的清理；③ 把「内容就绪等待」模式（等真实内容选择器，不等固定毫秒——本轮反复踩坑总结）沉淀进 `e2e/helpers`。
- **风险**：低。

### D4 多会话提交纪律（流程，不改代码）

执行文档 §387 已记录结构性限制：hook 读工作区、会跑到别人 WIP。两个可靠解法里「独立 worktree 提交」值得落地成文档化流程（`git worktree add ../web-commit` + 在 worktree 内 cherry-pick 自己的文件提交），否则逃生口使用频率会越来越高。**建议只写进 CONTRIBUTING/执行文档，不动 hook。**

### D5 backup.ts 两项接力（等并行会话合入后立即做）

异步化恢复（入队+轮询替代同步 120s 等待）+ `insertSitesBulk` 接 `createdAt` 列（恢复后按创建时间排序失真）。执行文档已写明方案与阻塞原因，**触发条件：`git status` 里 backup.ts 消失**。

---

## 5. 排期建议

| 批次 | 内容 | 量级 | 理由 |
| --- | --- | --- | --- |
| 第五批·快赢 | D1 hooks 清偿 + D2 测试提速 + D3 E2E 固化 + C2 a11y 扩容 | 1–2 天 | 全部低风险高杠杆，且为后续大改修路 |
| 第五批·主体 | A1 algorithm-lab 拆分 → A2 sitelist 拆分（含预计算） | 1 周 | 安全网最全的巨石先行，预算与可维护性双收 |
| 第六批 | B1 扩展收藏写路径 + B2 MCP 用户工具 + B3 version 水位 | 1–2 周 | 产品增量主线；B1 需 scope 灰度评审 |
| 持续 | C1 目的地页状态统一（每次 2–3 页）+ A3 + D5（触发式） | 穿插 | C1 与任意批次兼容，D5 等并行合入 |

## 6. 非目标（本批不做）

- `favorites/page.tsx` 主内容区视觉对齐、`navigation-card.tsx`——并行会话领地，待其合入；
- `backup.ts` 一切改动——同上；
- 巨石「整体重写」——只做有安全网的渐进拆分，A3 先补测试；
- SSE 全量推送——B3 二期先评审再立项；
- 通知中心 v2（邮件渠道/已读同步）——T13 v1 刚落地，先观察真实触发量再决定。

## 7. 验收总口径

沿用第四批纪律：全量 vitest 0 失败；tsc 0 错误（归因并行 WIP 的除外）；eslint 0 error；bundle 预算全路由在棘轮内且首页不升；镜像 `check-web-overlay` 一致；视觉改动一律 Playwright 实拍（明暗双主题）验收。
