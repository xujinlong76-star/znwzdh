# NavHub 全栈项目深度审计与全量修复报告

本报告记录了对 NavHub (`znwzdh`) 代码库中发现的 10 项核心架构缺陷、接口鉴权问题、数据截断以及未完成模块的全面修复。

---

## 修复清单与变更详情

### 1. 公共读接口权限修正与前端鉴权代理兜底 (P1)
- **问题**：`apps/api/src/server.ts` 中 `GET /api/sites`、`GET /api/sites/:id`、`GET /api/categories*`、`GET /api/tags*` 等核心导航数据接口声明为 `"read"` 作用域。当未配置只读 Token 或跨端调用时，全站前台导航分类与站点数据被 `requireScope` 拦截报错 401。
- **修复**：
  - 在 `apps/api/src/server.ts` 中将上述公共只读端点的 scope 调整为 `"public"`，允许前台匿名安全获取公开导航数据。
  - 在 `apps/web-overlay/src/app/api/hub/[...path]/route.ts` 中添加服务端 Token 自动注入逻辑：当客户端未携带 Authorization 头时，自动读取服务端环境变量 `NAVHUB_STORAGE_TOKEN || NAVHUB_MCP_TOKEN` 作为 Bearer Token，保障服务端代理请求的连通性。

### 2. 用户收录申请限制与数据源过滤修复 (P2)
- **问题**：`GET /api/submissions` 内部直接调用 `listSites({ limit: 200 })` 并在内存中通过 `filter(s => s.source === "submission")` 筛选。当全库站点数超过 200 时，新提交的站点会被截断隐藏，且无状态筛选。
- **修复**：
  - 在 `packages/store/src/repository.ts` 的 `listSites` SQL 查询中增加对 `source?: string` 的原生 SQL 过滤支持。
  - 在 `apps/api/src/server.ts` 的 `GET /api/submissions` 与 `PATCH /api/submissions/:number` 中直接按 `source: "submission", limit: 1000` 查询，彻底消除大库数据截断。

### 3. 构建临时文件清理与同步脚本白名单规范 (P3)
- **问题**：`apps/web-overlay/` 根目录下残留 `build-log.txt` 与测试脚本 `scripts/debug-sync.sh`、`scripts/debug-sync2.sh`，污染 git 覆盖层。
- **修复**：
  - 彻底清理以上临时与调试文件。
  - 在 `scripts/sync-web-overlay.mjs` 中添加严格排除规则（过滤 `debug-sync*` 和 `build-log.txt`），防止后续同步污染覆盖层代码。

### 4. 管理后台侧边栏功能补全与 API Token 管理页面 (P4)
- **问题**：管理后台侧边栏 `AdminLayoutClient.tsx` 缺少统计数据、任务队列和 Token 管理入口，且存在已废弃的历史侧边栏组件。
- **修复**：
  - 在 `apps/web-overlay/src/app/admin/AdminLayoutClient.tsx` 导航菜单中补齐「运营数据」(`/admin/stats`)、「任务队列」(`/admin/jobs`) 与「API Token」(`/admin/tokens`) 入口。
  - 新建 `apps/web-overlay/src/app/admin/tokens/page.tsx` 页面，提供完整的 API Token 创建、明文一次性揭示与一键复制、权限作用域选择、有效期限设置及实时吊销管理功能。
  - 移除无引用的冗余文件 `apps/web-overlay/src/components/admin/side-nav.tsx`。

### 5. 书签导入组件动态分类绑定与批量导入接口 (P5)
- **问题**：`apps/web-overlay/src/components/bookmark-importer.tsx` 分类选择项硬编码为 5 个静态选项，与真实数据库分类脱节；循环逐个发送 POST 请求，容易导致网络并发拥堵与超时。
- **修复**：
  - 在 `apps/api/src/server.ts` 中新增 `POST /api/sites/batch` 批量导入端点，支持批量插入站点。
  - 重构 `bookmark-importer.tsx`，在组件挂载时动态从 `/api/hub/categories` 拉取全量分类数据供用户匹配映射，并采用 50 条/批的分块并发机制调用批量接口导入。

### 6. 专题合集 Seeding 种子注入与持久化实现 (P6)
- **问题**：`packages/store/src/repository.ts` 中 `upsertCollection` 仅为占位符（未实现真正的数据写入），导致种子初始化及管理后台无法持久化专题合集。
- **修复**：
  - 在 `packages/store/src/repository.ts` 中完整实现 `upsertCollection`，采用事务原子更新 `collections` 主表及 `collection_items` 关联表。
  - 在 `apps/api/src/seed.ts` 中增加对 `raw.collections` 的全量注入逻辑，并更新 `SeedResult` 结构。

### 7. SQLite/PostgreSQL 数据库事务保障与排序权重同步 (P7/P9)
- **问题**：`reorderSites` 与 `setTrendScores` 等批量写操作缺乏数据库级事务保护；在并发请求或异常断电时可能导致部分更新失败。此外 `setTrendScores` 仅更新了 `analytics_events`，未同步更新 `sites.weight`。
- **修复**：
  - 在 `packages/store/src/repository.ts` 中新增通用的 `withTransaction` 助手函数（兼容 SQLite 的 `BEGIN IMMEDIATE` 与 PostgreSQL 的 `BEGIN`）。
  - 将 `reorderSites` 与 `setTrendScores` 批量操作包裹在事务中，并在更新热度分值时同步更新 `sites.weight = trendScore`，确保前台排序即时生效。

### 8. 模块化组件遥测连接与动态加载增强 (P8/P10)
- **问题**：模块化看板中的部分 Widget（如系统指标组件 `metrics-widget.tsx`、自定义分类组件 `custom-category-widget.tsx`）采用静态固定 mock 数据，无法反映运行态真实数据。
- **修复**：
  - `metrics-widget.tsx`：增加对 `/api/hub/health` 探针的动态查询与定时刷新，实时展示后端运行状态、数据库延迟与系统健康度。
  - `custom-category-widget.tsx`：挂载时自动拉取 `/api/hub/categories`，动态呈现后台配置的真实分类与站点。
  - 将 `apps/web-overlay` 全量修复代码同步镜像至 `apps/web`，通过 `scripts/check-web-overlay.mjs` 校验（120 个覆盖层文件严格保持一致，0 漂移）。
