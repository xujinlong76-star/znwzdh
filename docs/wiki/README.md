# NavHub Code Wiki

> 结构化代码维基，覆盖项目整体架构、模块职责、关键类与函数、依赖关系与运行方式。
> 包含 11 个系统性核心章节，全面记录系统架构、核心算法、Bento-Flow DIY、工程落地与运维手册。

## 阅读顺序

| # | 文档 | 内容 | 适合谁 |
| --- | --- | --- | --- |
| 1 | [01-architecture.md](./01-architecture.md) | 项目定位、整体架构、目录结构、运行模式、核心设计决策、模块依赖与数据流 | 所有人，先读这篇 |
| 2 | [02-api.md](./02-api.md) | `apps/api` Fastify 中枢：启动流程、62 条 REST 路由、鉴权、存储适配层、任务队列 | 后端开发 |
| 3 | [03-web.md](./03-web.md) | `apps/web` Next.js 前端：路由地图、存储接缝、搜索面板、PWA、上游覆盖机制 | 前端开发 |
| 4 | [04-core.md](./04-core.md) | `packages/core` 领域层：数据模型、CJK 分词、拼音、RRF 融合、排序与画像、扩展算法 | 检索/算法 |
| 5 | [05-store.md](./05-store.md) | `packages/store` 存储层：19 张表 schema、双驱动、Repository、四通道检索引擎、向量与全文实现 | 后端开发 |
| 6 | [06-ai.md](./06-ai.md) | `packages/ai` 能力层：本地 embedding、SSRF 防护、LLM 富化与多模型轮换池 | 后端/安全 |
| 7 | [07-mcp.md](./07-mcp.md) | `packages/mcp` MCP Server：15 个工具、读写权限、幂等/审计/HTTP 鉴权 | Agent 集成 |
| 8 | [08-extensions-scripts-docker.md](./08-extensions-scripts-docker.md) | 浏览器/Raycast 扩展、scripts 工具集、Docker 多 profile 部署、一键推仓脚本 | 运维/集成 |
| 9 | [09-run-and-test.md](./09-run-and-test.md) | 运行方式：本地开发、Docker、环境变量全表、测试套件、环境坑与排障 | 所有人 |
| 10 | [10-bento-diy-and-advanced-algorithms.md](./10-bento-diy-and-advanced-algorithms.md) | **Bento-Flow 智能工作台与前沿算法升级**：跨分类拖拽重排、免登 URL-Hash 分享、Discounted-LinUCB、洛伦兹超曲面、0-RTT AST、卡尔曼滤波与元素审查 | 架构/全栈/算法 |
| 11 | [11-operations.md](./11-operations.md) | 运维手册：发布与回滚流程、on-call runbook、SLO/SLI、SQLite 与 PostgreSQL 备份恢复、数据治理 | 运维/on-call |

## 一页速览

```
NavHub = AI 原生网址导航系统与知识工作台
  ├── 前端画布 apps/web-overlay  （Bento 画布 / DIY 自由排版 / 0-RTT 意图微组件）
  ├── 运行镜像 apps/web          （Next.js 15，派生自 NavSphere，MIT）
  ├── 中枢服务 apps/api          （Fastify 5：REST + 存储兼容 API + 任务队列 + 鉴权中心）
  ├── 算法领域 packages/core     （Discounted-LinUCB / 洛伦兹双曲 / 卡尔曼滤波 / 0-RTT AST）
  ├── 存储持久 packages/store    （Drizzle schema + sqlite|pg 双驱动 + 向量扩展 + FTS5）
  ├── AI 能力  packages/ai       （ONNX embedding + SSRF 防护 + 多模型 LLM 轮换池）
  ├── Agent    packages/mcp      （MCP Server：stdio + HTTP 标准工具协议）
  └── 终端生态 extensions/       （Chrome 扩展 + Raycast 桌面快捷扩展）
```

两种运行模式（贯穿全仓的核心分叉）：

| 模式 | 数据库 | 向量 | 全文 | 场景 |
| --- | --- | --- | --- | --- |
| `lite`（默认） | SQLite | sqlite-vec | FTS5 + CJK 二元分词 | 个人 / NAS，单容器零外部依赖 |
| `standard` | PostgreSQL | pgvector (HNSW) | tsvector + pg_trgm | 公开站 / 企业内部，多用户 |

**核心架构约定**：

1. **存储接缝只有 2 个函数**——前端 `getFileContent` / `commitFile` 是全站持久化的唯一通道，改后端不动前端 69 处调用点。
2. **能力可选、失败不致命**——缺 embedding、缺 sqlite-vec、缺 LLM Key，系统都必须照常启动，并在 `/api/health` 如实上报。
3. **个性化是「一路通道」而非「事后加成」**——以 `personal` 通道（权重 0.3）进入 RRF，翻转能力被权重天然限界。
4. **Bento-Flow 状态本地优先**——排版与个性化配置优先存入客户端内存与 LocalStorage，支持零服务端开销的 URL-Hash 无损分享与 E2EE 金库漫游。

## 相关文档

- 仓库根 [README.md](../../README.md)：项目概览与快速开始
- [docs/acceptance-report.md](../acceptance-report.md)：PostgreSQL 分档验收报告
- [docs/navigation-enhancement-plan.md](../navigation-enhancement-plan.md)：导航增强能力规划
- [docs/research-notes.md](../research-notes.md)：核心算法推导与调研笔记
- [apps/web-overlay/UPSTREAM.md](../../apps/web-overlay/UPSTREAM.md)：上游 vendoring 追踪
