# NavHub 插件市场增强研究（2026-10-19）

> 前置：插件市场阶段 A/B/C 已全量落地并推送（`daac3ed`）。本文研究**下一批增强**
> （阶段 D/E/F），在「声明式-only、零任意代码执行」硬约束不变的前提下展开，
> 每项增强都标注可复用现状地基与工作量评估（S ≈ 半天内 / M ≈ 1-2 天 / L ≈ 3 天+）。

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
- 方案：新 kind `bundle`（payload: `{items: [{slug, kind}]}`，仅引用已上架项）——一次安装 = 顺序执行三个安装（复用 install 管道）。**谨慎**：引入引用解析链，需防自引用/环/下架引用；建议排在最后、独立评审。工作量：M-L。

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
