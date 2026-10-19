# NavHub 插件市场增强研究（2026-10-19）

> 前置：插件市场阶段 A/B/C 已全量落地并推送（`daac3ed`）。本文研究**下一批增强**
> （阶段 D/E/F），在「声明式-only、零任意代码执行」硬约束不变的前提下展开，
> 每项增强都标注可复用现状地基与工作量评估（S ≈ 半天内 / M ≈ 1-2 天 / L ≈ 3 天+）。

---

## 〇、实施状态（2026-10-19 落地批次）

本批按「A 全做」落地了全部非暂缓项（D1-D4 已先期推送）；F4 在完成独立评审后，以受限单层范围落地：

| 项 | 状态 | 实现口径 / 与原文的差异 |
| :--- | :--- | :--- |
| F0 作者归属 | 已落地 | `plugins.owner_identity` 仅内部使用；公开 `owner_key = sha256("navhub:plugin-owner:" + identity).slice(0,24)`。发布必须带 identity，作者中心 `/marketplace/mine`，公开作者页 `/marketplace/author/[key]`。MCP/管理员仍走导入与审核通道。 |
| E1 精选位 + 榜单 | 已落地 | `featured` + `featured_rank`；市场首页编辑精选横排 + 新上架/安装最多/星标最多/评分最高榜单。 |
| E2 作者主页 | 已落地 | 原文按 `author` 文本聚合；实际改为按 `owner_key` 聚合，避免同名作者串号，同时不暴露内部 identity。 |
| E5 评分聚合 | 已落地 | 列表/卡片带 `ratingAvg`（保留 1 位小数）与 `reviewCount`；评分排序使用贝叶斯平滑（先验 3 条 × 3.5 星），避免 1 条 5 星压过大量 4.8 星。 |
| E4 市场漏斗 | 已落地 | 新增客户端事件 `plugin_view / plugin_install_click / plugin_share`（服务端补记 `plugin_install_success / plugin_uninstall`），管理端按日聚合浏览→点击→安装→卸载/举报。 |
| E3 治理自动化 | 已落地 | 新 job kind `plugin_governance`（每 4 小时）：待审超 48h、插件举报、评价举报三类告警，只写审计/日志，**不自动改状态**。 |
| E6 评价治理 | 已落地 | `plugin_reviews.status / report_count / moderation_note / moderated_at / moderated_by`；公开列表与评分统计只算 `visible`；举报只累计计数，管理员人工隐藏/恢复。 |
| F3 MCP 工具 | 已落地 | 新增 `star_plugin`、`update_plugin`；`list_plugins` / `search_plugins` 返回 `featured/ratingAvg/reviewCount` 并支持 `featured`、`rating` 排序。工具数 35 → 37。 |
| F2 分享短链 | 已落地 | `short_links` 表 + `POST /api/shortlinks` + `GET /api/shortlinks/:code` + Web `/s/[code]` 302；目标强制 `/marketplace/` 内部路径，保留 `?install=1` 深链。 |
| 统一搜索 | 已落地 | ⌘K 搜索面板在站点混合召回之外并行召回插件（`/api/plugins/search`，最多 5 条），带类型/安装量/评分与「查看全部插件结果」出口。 |
| 细节增强（第二批） | 已落地 | 筛选/排序/搜索与地址栏双向同步（补上统一搜索 `/marketplace?q=` 落点）；卡片新增安装深链分享；详情页选项卡支持 `?tab=reviews` 深链与键盘/读屏语义；评价支持分页加载与骨架态，移除评价列表中的内部 identity 展示；已安装管家按语义版本判定更新、更新置顶、生效主题升级后立即重放 token，并在卸载网址包时明确提示站点会同步软删除。 |
| F4 组合插件 | 已落地（受限单层） | 新 kind `bundle`，payload `{items:[{slug,kind}]}`，成员仅允许 `site-pack` / `search-pack` / `theme`（禁嵌套、禁工作台预设）；引用必须已上架、类型一致、非自身；安装前全量预检后按清单顺序复用同一条 install 管道；任一成员失效即 fail closed；卸载只解绑、不级联。核心/镜像契约、store、API 详情与安装、市场列表/详情/安装弹窗/已安装页、MCP 类型枚举与 seed 样例同步更新；发布向导内置「成员选择器」（搜索 / 类型筛选 / 勾选即回写 payload JSON，上限与去重即时提示）。 |

**测试与门禁**：store 插件套件 30 例（含 F4 组合包 3 例）、API 插件套件 21 例（含 F4 API 全链路 1 例）、代理身份签名/转发 32 例通过；core 契约 40 例（含组合包校验/摘要/diff 7 例）。`pnpm typecheck`、Web ESLint（0 error）、`check:overlay`、`check:extensions` 纳入本批门禁。所有新增 DDL 均为幂等迁移，SQLite / libSQL / PostgreSQL 三方言按现有 `driver.ts` + `migrate.ts` 机制补齐；组合包复用 `plugins.kind` 文本列，无新 DDL。

---

## 一、现状盘点（可复用地基清单）

| 地基 | 位置 | 已具备能力 | 可被哪些增强复用 |
| :--- | :--- | :--- | :--- |
| 契约与纯函数 | `packages/core/src/plugin-manifest.ts` | validate / summarize / `comparePluginVersions` / PLUGIN_LIMITS | D1 版本更新判定、E1 榜单排序 |
| 仓储与状态机 | `packages/store/src/repository/plugins.ts` | create/get/list/update/review/install/uninstall/star/report；`plugin_installs.version` 已记录安装版本；复合主键 identity | D1 升级判定、F1 评分聚合、B 语义索引源数据 |
| REST | `apps/api/src/routes/plugins.ts` | 11 端点 + 限流 + 审计 + 软删卸载 | 全部增强（新端点在既有风格上扩展） |
| MCP | `packages/mcp`（34 工具） | `list_plugins` / `install_plugin` 已通（幂等、scope 边界有测试） | F3 工具三件套 |
| 前端 | `apps/web-overlay/src/app/marketplace/**` + `components/plugins/**` | 列表/详情/导入/发布/审核 5 页；card + install modal；theme-runtime；preset-staging | 全部前端增强 |
| 检索基建 | `ctx.embedding` + `ctx.vectors` + `reindex` job | 站点已用（语义检索）；**插件尚未用** | D2 插件语义检索与相似推荐 |
| 可观测 | `POST /api/events` + audit_logs + `admin/stats` | 通用事件管道已通 | E4 市场漏斗、E3 治理指标 |
| 分享 | `/marketplace/[slug]` 服务端 `generateMetadata` | OG 文案（title/description）已就绪；**无图片**、无短链 | D3 OG 卡片、F2 短链落点 |
| 扩展 | `extensions/chrome-extension` / `raycast-extension` | 市场入口已通 | D4 深链、F3 动作 |
| OG 渲染 | Next 15.5 + React 19 | `next/og` ImageResponse 可用 | D3 |

---

## 二、阶段 D（下批建议，小步高收益）

### D1 版本更新链路（更新徽标 / 差异预览 / 一键更新）

- **用户价值**：已装插件能感知新版本并一键升级——市场从「一次性导入」变成「持续供给」。
- **现状地基**：`comparePluginVersions` 纯函数已备；`plugin_installs.version` 已记录；install 本身是**增量去重**语义（重装=升级，天然安全）。
- **方案要点**：
  1. 服务端：`GET /api/plugins/installed` 已返回 `installedVersion`——列表/详情接口把 `installedVersion` 与 `plugin.version` 一起返回（已有字段，仅补齐详情接口）；
  2. 判定在**客户端/MCP 侧**用 `comparePluginVersions(installedVersion, version) > 0` → 显示「可更新」；无需新状态机；
  3. 更新动作 = 重调 install 通道：前端走既有 install modal（`mode: update` 文案），MCP `install_plugin` 重装即升级（幂等键换新）；审计记 `update`；
  4. 差异预览（简化版）：弹窗展示「新版本将新增的站点数 / 新增模块数」= 新 summary 与安装时快照 diff——首版只展示新版本 summary + 提示"增量导入，不删既有数据"。
- **反目标护栏**：更新**只增不删**（与 install 同口径）；卸载仍只软删 `source=plugin:<slug>` 行。
- **工作量**：S-M（无需新表、无需新状态机）。

### D2 插件语义检索与相似推荐

> **状态（2026-10-19）**：已落地。实现较本方案有一处升级——**独立 `plugin_embeddings` 表 + 独立 `plugins_vec` 向量表**（业务 id `plugin:<slug>`），而非共享 `ctx.vectors` 加 key 前缀：`VectorStore.search` 没有元数据过滤能力，混表会让插件向量挤占站点语义检索的 top-N（反之亦然）。其余按方案执行（索引单一路径、关键词回退 + `degraded`、reindex `targets`、MCP `search_plugins`）。

- **用户价值**：从「知道名字才能搜到」升级为「描述需求就能找到」；详情页出现「相似插件」形成发现回路。
- **现状地基**：embedding + vectors + reindex job 已为站点跑通；插件文本短（name+description+tags+summary），索引成本极低。
- **方案要点**：
  1. 索引写入钩子在**一条路径**上：review approve / import / seed 创建已上架插件时，计算 manifest embedding 入 `ctx.vectors`（key 前缀 `plugin:` 区别于站点）；
  2. `GET /api/plugins?q=` 保持关键词行为不变（兼容契约）；新增 `GET /api/plugins/search?q=&kind=&limit=` 走语义（无模型时回退关键词并在响应里标注 `degraded`）；
  3. `GET /api/plugins/:slug/similar?limit=6`：详情页模块数据源；
  4. `reindex` job 扩展一个 `targets: ['sites','plugins']` 参数（默认 sites，保兼容）；
  5. MCP 新增 `search_plugins`（read）。
- **风险**：模型不可用降级口径照旧（capabilities.notes，不静默）；插件数量 <1k 前全量余弦足够，不需要 ANN。
- **工作量**：M。

### D3 动态 OG 分享卡片（opengraph-image）

> **状态（2026-10-19）**：已落地。OG 卡片采用 ASCII 安全构图（零字体依赖）；`sitemap.ts` / `robots.ts` 同步补齐——按请求头推导 origin（自托管换域名无需改配置），插件详情分页全量收录（上限 5000），中枢不可用时只回退静态条目而不返回 500。

- **用户价值**：分享链接在微信/X/Slack 有品牌化预览图——与 P1-5 短链服务配套的头号消费方。
- **现状地基**：Next 15 `next/og` ImageResponse 可用；详情页 metadata 已就绪。
- **方案要点**：
  1. 新增 `apps/web-overlay/src/app/marketplace/[slug]/opengraph-image.tsx`（1200×630；读取插件 kind/name/accent/摘要，数据走 `/api/hub/plugins/:slug`，与 layout.tsx 同模式；失败回退静态默认图）；
  2. **字体决策点**：Satori 需显式字体；中文需字体子集（仓库 `public/fonts` 有素材可评估），首版方案二选一：A) 只渲染英文/数字+品牌渐变（零字体依赖）；B) 引入中文字体子集（首屏 100-300KB 构建期成本）。建议首版 A，B 列入评估；
  3. 同时补 `sitemap.ts`（已上架插件全量 + `revalidate 1h`）与 `robots.ts` 白名单——SEO 与抓取基础。
- **工作量**：S（A 方案）。

### D4 分享深链（?install=1）

- **用户价值**：把「打开详情页」变成「落地即安装确认」——短链、二维码、IM 分享的黄金路径。
- **方案要点**：
  1. 详情页读 `useSearchParams`：`?install=1` 打开即弹安装确认（已安装则弹管理）；`?preview=1` 打开即主题试用；
  2. 列表卡片「复制分享链接」按钮生成 `…/marketplace/[slug]?install=1`；
  3. 二维码列为可选（需新依赖，暂不做）。
- **工作量**：S。

---

## 三、阶段 E（运营批次）

### E1 编辑精选位 + 榜单
- 现状：`PluginRecord` 无 featured 列；站点已有 featured 先例。
- 方案：插件表加 `featured`（迁移兜底同风格）+ 市场首页「编辑精选」横排（复用卡片）+ 三个实时榜单（新上架 / 安装最多 / 星标最多，复用 list sort——`new/popular/stars` 已有）。工作量：M。

### E2 作者主页 `/marketplace/author/[id]`
- 方案：按 `author`（identityOf 口径）聚合列表 + 该作者插件的总安装/星标；种子作者（NavHub 官方）展示徽章。工作量：S-M。

### E3 治理自动化（jobs 扩展）
- 方案：`plugin_governance` job kind：① 待审 SLA 告警（>48h 未审）；② 举报阈值预警（reportCount ≥ 阈值进审核视野/通知）；③ 下架复查提醒。全部只读+告警，不做自动下架（保留人工）。工作量：M。

### E4 市场漏斗指标
- 方案：events 增加 `plugin_view / plugin_install_click / plugin_install_success / plugin_uninstall` 四类 kind（复用 POST /api/events 白名单）；admin/stats 加市场面板（浏览→安装转化、七日留存）。工作量：M。

---

## 四、阶段 F（社区与生态批次）

### F1 评论与评分
- 方案：`plugin_reviews` 表（slug+identity 复合唯一；1-5 星 + 短评 ≤500 字）+ 复用举报/限流/审计；评分聚合进 PluginRecord（`ratingAvg/ratingCount`）；恶意内容走既有审核队列（review 状态独立于插件状态）。
- **前置**：防刷设计定稿（同 identity 去重、限流 5/hour、新号权重降级）——先有护栏再开放。工作量：L。

### F2 分享短链服务（对接 P1-5）
- 方案：`/s/[code]` 路由（web 侧 302）→ 目标表（code→target slug, clicks, createdAt）；写入端仅在发布/安装成功页生成；点击计数走 events。与 P1-5 短链服务蓝图对齐（本市场是其头号消费方）。工作量：M。

### F3 MCP 三件套
- `search_plugins`（语义，D2 顺带）、`star_plugin`（public+identity）、`update_plugin`（write；= 重装升级语义 + 返回 upgrade 标记）。工作量：S（随 D2/D1）。

### F4 「起步包」组合插件（bundle）

> **状态（2026-10-19）**：独立评审完成，按受限单层范围落地（详见本章末「F4 独立评审结论」）。

- 方案：新 kind `bundle`（payload: `{items: [{slug, kind}]}`，仅引用已上架项）——一次安装 = 顺序执行三个安装（复用 install 管道）。**谨慎**：引入引用解析链，需防自引用/环/下架引用；建议排在最后、独立评审。工作量：M-L。

#### F4 独立评审结论（受限范围）

**允许的引用图**：仅单层。成员只允许 `site-pack` / `search-pack` / `theme` 三种 kind；`bundle` 自身与 `workspace-preset` 一律拒绝（前者天然排除嵌套与环，后者必须由用户显式选择追加/覆盖模式，不能让组合包替用户决定工作台布局）。核心校验在 `packages/core/src/plugin-manifest.ts` 的 `BundlePayload` 校验中拒绝非法 kind，store 的 `getPluginBundleMembers` 再做一次「声明类型 vs 真实类型」一致性校验，双保险防类型漂移。

**引用生命周期**：
1. 创建 / 更新 / 提交新版本 / 审核通过四个写入点都调用 `assertBundleManifestReferences`，要求被引用插件**当时已上架**；任一成员缺失、未上架、类型不符、自引用或嵌套组合，写入直接失败并返回具体 slug + 原因；
2. 成员事后被下架/隔离不触发任何自动动作（反目标 #4：不做自动下架），组合包详情返回 `bundleReady:false` 与逐成员 `available/reason`；安装前全量预检，任一成员失效即 fail closed（400 + 明确原因），不产生半安装；
3. 成员恢复上架后，组合包无需重新审核即可再次安装（引用有效性在安装时实时重算）。

**安装与卸载语义**：
- 安装顺序复用同一条 `installPlugin` 管道：预检全部成员 → 逐个安装 → 聚合 `applied.bundleItems`；组合包自身只记录一次安装，成员各自独立计数；
- 不做跨成员事务（成员 site-pack 内部已有事务）：预检通过后若极端情况下中途失败，错误信息会列出已完成成员，重试幂等补全，绝不回滚或删除既有数据；
- 卸载组合包只解绑自身，**不级联**卸载成员、不删除成员引入的站点（`removeSites` 对 bundle 不生效）；成员可单独卸载；
- 主题类成员仅登记安装，需用户在「已安装」页显式启用（避免组合包在一次点击中悄悄替换用户外观）。

**测试覆盖**：core 契约 7 例（成员类型/去重/数量/摘要/diff）；store 3 例（引用校验、安装聚合与幂等、失效 fail closed 与恢复、卸载不级联）；API 1 例全链路（导入成员 → 导入组合包 → 详情解析 → 一次安装 → 成员下架 → ready=false 且安装被拒）；发布向导拼装辅助纯函数 8 例（`apps/web-overlay/scripts/bundle-builder.test.ts`）与 E2E 1 例（选择器拼装 → 实时回写 JSON → 移除）。

**作者拼装 UI（已落地）**：发布向导第 3 步内置「成员选择器」——从已上架插件（三种成员类型各取前 100 条）中搜索 / 按类型筛选 / 勾选拼装，实时回写 payload JSON（选择器与 JSON 共用同一事实源，手改 JSON 自动跟进），支持移除、自引用防护（编辑模式）与上限/去重即时提示；手写 JSON 出现非法/重复/超限条目时给出计数提示，服务端预检仍是最终门禁。

**未做（明确边界）**：嵌套组合包、依赖图解析/环检测、自动级联下架传播。

---

## 五、明确不做（反目标延续）

1. 任意代码执行插件（无沙箱设施前永久禁止）——全部增强保持声明式 JSON；
2. 服务端代抓取插件引用资源（SSRF 面）——OG 卡片与推荐均在白名单内取数；
3. 付费交易 / 结算 / 抽成；
4. 自动下架、自动封禁（治理只告警，动作保留人工审计）；
5. 「插件依赖插件」图解析（F4 仅单向 bundle，且独立评审）；
6. 刷量友好型入口（评论/评分开放前必须有防刷护栏）。

---

## 六、验收口径（若按阶段 D 实施）

- `pnpm verify` 全绿；新增测试 ≥40 例（更新判定矩阵 / 语义降级 / similar 排序 / OG 路由 / 深链）；
- e2e：装旧版 → 徽标「可更新」→ 一键更新 → 版本刷新且既有站点零丢失；
- `GET /marketplace/[slug]/opengraph-image` 200 + `image/png`（含 API 不可用回退断言）；
- MCP 工具 34 → 35（`search_plugins`）；`install_plugin` 重装升级路径有断言；
- 反目标断言：更新与重装**不删除**任何既有站点/主题/预设数据。
