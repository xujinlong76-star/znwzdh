# 下一步建议方案（2026-11-25 深度研究）

## 研究方法
5 路只读子代理并行审计（架构债 / 数据性能 / 测试缺口 / 可观测性 / 产品体验）+ 自主全局扫描（1893 个源文件 / 41.8 万行、129 个 NAVHUB_* 开关、生成链门禁实跑、冷启动 ⌘K 代码路径复核）。
所有发现均经**当前源码 + 实跑证据**确认，明确排除假阳性；未修改任何源码。

---

## 批次 A — CI 止血 + 真 bug（合计约 2 小时，ROI 最高）

### A1. 生成链漂移：CI 当前是红的，且已造成真实行为分歧
- **证据**：`node scripts/check-generated-all.mjs` exit=1；`crdt-sync` 与 `linucb` 两份镜像与事实源不一致（`sync-core-mirrors.mjs --check` 实跑确认）。
- **后果**：`crdt-sync` 的 core 版新增了 `LatestWrite` 水位表（压制 tombstone 复活），前端镜像还是旧算法 → 浏览器端压缩 op-log 与未压缩 peer 合并时**已取消的 pin / 删除项可能被复活**；`linucb` 缺 `isValidDwellSeconds` 护栏 → 非法驻留时长被算成合法正奖励。
- **修法**：跑 `node scripts/sync-core-mirrors.mjs` + `node scripts/generate-web-mirror.mjs`（官方生成器，不手改镜像）。
- **注意**：这两个镜像文件当前有并发写入者在途改动（git status 显示 M）——**需先与其协调或等其落地**，避免覆盖。
- **工作量**：10 分钟 + 30 分钟回归。

### A2. 冷启动第一次 ⌘K 静默失灵（已用代码逐行复核）
- **证据**：`global-spotlight-gateway.tsx:37-45` 只查 `[data-search-input]`，查不到就 `return`（不 preventDefault、不兜底）；但该 input 属于 `SearchPalette`，而它是 `ssr:false` 且 `navigation-toolbar.tsx:124` 仅在 `mounted` 后渲染——冷启动时 DOM 只有占位 `<button>`（:136-155）。`/p` 键走另一条常驻监听所以正常，两条快捷键不对称。
- **后果**：引导卡明教"随时按 ⌘K 搜索"，首访第一次按却无反应；e2e 无覆盖所以一直没发现。
- **修法**：`!input` 时 `window.dispatchEvent(new CustomEvent('navhub:focus-search'))`（复用已有监听使面板挂载并 autoFocus），补一条冷启动 e2e。
- **工作量**：1–2 小时。

---

## 批次 B — 产品诚实性 + 首访（合计约 2 人日）

### B1. 首访引导实际不可达，且设置页承诺与实现矛盾 ⚠️含产品决策
- **证据**：`OnboardingCard` 唯一挂载在 `appearance-guide-dialog.tsx:356`，需顶栏 DIY → 外观 → 向导共 3 次点击；`settings-panel.tsx:318-321` 却承诺"回首页就能看到引导"；`layout.tsx:289-293` 的引导条注释指向一个已不存在的挂载点（死注释）。
- **决策点**：是否接受"首访一次性引导条"（dismiss 后永久不再占高）。若接受，复用现有受控弹窗 + 一个首次挂载 effect 即可，零新 UI。
- **工作量**：0.5–1 人日。

### B2. 首页空库 / 中枢不可达时措辞误导
- **证据**：`navigation-content.tsx:1866-1882` 把"数据没来"说成"你隐藏了所有分类"，且只给"查看全部站点"按钮（此时也是空的）；其余数据主体页都有 `HubDegradedNotice` + 重试，首页是唯一漏网。
- **修法**：透出 `degraded` 信号，三分支渲染（中枢失败 / 真空库 / 全隐藏），复用现成组件。
- **工作量**：0.5 人日。

### B3. 500 错误包络 requestId 三方不一致
- **证据**：实跑注入 `x-request-id=CLIENT-XXX` → 500 body 是内部 `req-1`、响应头是 CLIENT-XXX、日志只有 req-1；404 却返回别名 ID。`:351` 用 `req.id`、`:328` 用 `app.log.error`。客户端拿 500 的 requestId 查不到日志。
- **修法**：body 用对外别名、日志用 `req.log.error`，补一致性断言测试。
- **工作量**：0.5 人时。

---

## 批次 C — 后端性能与数据正确性（合计约 4 人日）

| 项 | 证据 | 修法 | 工作量 |
|---|---|---|---|
| C1 `sites_patrol_idx` 存量库缺失 | migrate.ts:671 的建索引语句在已记账的 20261015 版本里，驱动 DDL 也没有；实测 5096 站库缺该索引，巡检排序走临时 B-TREE | 新增版本化迁移 + DDL 登记（与之前 site_reports 缺表的修法同构） | 0.5 天 |
| C2 `/api/scenes` 全串行混合检索 | scene-resolve.ts:153-173 对 24 场景包逐个 await，每组内约 140 个 query 再逐个 await（含 search + listCategories）；首访/失效后可阻塞十几秒 | step 内 Promise.all + 场景间有限并发池(4–6)，按原顺序归并保去重语义 | 1–2 天 |
| C3 三处 N+1 + 健康报告截断 | categories.ts:448-480 相关类目 2N 查询；plugins.ts:272-318 组合包成员 2N；taxonomy-governance.ts:321-330 逐条 get/update；health-audit.ts:34-41 只报前 500 站（库有 5096） | 批量 IN/GROUP BY 改写；健康报告分页遍历或标注 truncated | 1.5 天 |
| C4 TTL 口径不一致 | `/api/categories/counts` 同一计数在 OG 卡/首页是 3600s、正文是 60s：可能出现 OG 显示达标而页面 404；`/api/scenes` 列表 300s vs 详情 60s | 收敛为 60s（构建期例外注明） | 0.5 天 |

---

## 批次 D — 工程基建（持续，约 3–5 人日）

- **D1 测试缺口**：首访、收藏同步冲突两条核心用户流**完全没有 e2e**；`vision.ts`（SSRF/截图上限）、`fs-file-store.ts:writeAtomic`（并发写坏缓存）、`embedding-worker.ts` 三个安全/写路径模块**零行为单测**。补测约 3 人日。
- **D2 假绿守卫**：5 个安全守卫只做源码字面量断言（SSRF 敏感头剥离、admin 写路由鉴权、租约锁、LLM 网关、MCP 金库归属），可从实现侧面绕过。行为化改造约 2 人日。
- **D3 可观测性**：`OBSERVABILITY.md` 47 个指标里 27 个未记录（含全部缓存命中率、队列深度）；`verify:all` 不含生成链门禁（本地绿、CI 可能红）；无索引新鲜度指标。补生成器守卫 + 文档约 1 人日。
- **D4 架构债**：4 个巨型文件待拆（`navhub-api.ts` 4556 行 / 151 个导出、`search-palette.tsx` 3625 行 / ~50 个 useState 且重置路径已漏 `semanticAvailable`、`favorites/page.tsx` 3108 行、`api/jobs.ts` 2675 行）。按域拆分 4–6 人日。
- **D5 配置漂移**：源码用 129 个 `NAVHUB_*` 开关，`.env.example` 只记录 72 个（含 `NAVHUB_AUTH_REQUIRED` 等安全项和首页 perf 旋钮未记录）。补文档约 0.5 人日。

---

## 明确不建议动（已核实为假阳性 / 有意为之）
- error.tsx 覆盖：94 个 page 全部被祖先 error.tsx 覆盖，无缺口；静默 catch 守卫 12/12 通过；console.log 误用 0。
- 回滚位（`NAVHUB_NAVIGATION_READ_MODE` / `VIDEOS_READ_MODE`）是分片读事故的秒级止血开关，有测试钉住，保留。
- `plugin-manifest` / `layout-sync` 的"重复"是有 parity 守卫 / 有意分叉，不是债。
- 游标分页 `@deprecated` 不能裸删（外部消费者不可见），应先埋点观察一个发布周期。

## 建议执行顺序
**A → B → C → D**。A 是唯一"CI 已经红了 + 有真实行为分歧"的止血项，最优先；A2 是几行代码但直接伤首访信任。B 批次含一个产品决策点（B1）需拍板。C/D 可按迭代排期。
