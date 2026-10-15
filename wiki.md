# NavHub 全景架构与核心代码工程 Wiki 全集

> 本文档由系统自动化梳理并汇总，涵盖系统整体架构、各子包模块职责、核心算法数学推导、Bento-Flow DIY 排版、存储设计、安全合规与部署运维指南。

---

## 目录索引 (Table of Contents)

1. [项目定位与系统架构全景](#1-项目定位与系统架构全景)
2. [API 服务中枢架构 (`apps/api`)](#2-api-服务中枢架构-appsapi)
3. [前端与 Bento-Flow 工作台 (`apps/web-overlay` & `apps/web`)](#3-前端与-bento-flow-工作台-appsweb-overlay--appsweb)
4. [核心算法原理与数学建模 (`packages/core`)](#4-核心算法原理与数学建模-packagescore)
5. [存储层设计与双引擎驱动 (`packages/store`)](#5-存储层设计与双引擎驱动-packagesstore)
6. [AI 抓取富化与安全防御 (`packages/ai`)](#6-ai-抓取富化与安全防御-packagesai)
7. [MCP Server 智能体协议 (`packages/mcp`)](#7-mcp-server-智能体协议-packagesmcp)
8. [多端扩展与工程工具集 (`extensions` & `scripts`)](#8-多端扩展与工程工具集-extensions--scripts)
9. [生产环境部署与故障排查](#9-生产环境部署与故障排查)

---

## 1. 项目定位与系统架构全景

### 1.1 核心愿景
NavHub 是一款专为开发者和技术团队打造的 **AI 原生网址导航系统与知识工作台 (Developer Knowledge OS)**。
不同于传统的静态目录或泛用的空白仪表盘，NavHub 将**海量技术导航沉淀**、**五路异构智能检索**、**端侧 0-RTT 语法推测解析**与**模块化 Bento-Flow 工作台**深度融为一体。

### 1.2 拓扑分层图
```
┌─────────────────────────── 客户端与终端层 ───────────────────────────┐
│  Web 前端 (Bento 画布 / Next.js 15)  │  Chrome 浏览器插件 (一键富化收录)   │
│  Raycast 极速桌面扩展 (全局检索)     │  AI Agent 客户端 (Claude / Cursor) │
└──────────────┬──────────────────────┴────────────────────┬────────────┘
               │ STORAGE_ADAPTER=http                      │ MCP stdio / HTTP
               │ + /api/hub/* 运行时代理                   │ + Bearer Token
┌──────────────▼───────────────────────────────────────────▼────────────┐
│                         Fastify 5 API 服务中枢                        │
│  ┌──────────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ 62 条 REST 业务路由   │  │ 兼容存储接缝 API  │  │ JobRunner 队列  │  │
│  │ /api/sites, search.. │  │ /api/storage/*   │  │ 可用性/权重重算 │  │
│  └──────────┬───────────┘  └────────┬─────────┘  └────────┬────────┘  │
│             └─────────── AppContext (全局注入) ───────────┘           │
└───────────────────────────────┬───────────────────────────────────────┘
         ┌──────────────────────┼──────────────────────┐
┌────────▼────────┐    ┌────────▼─────────┐    ┌───────▼───────────┐
│ @navhub/ai      │    │ @navhub/store    │    │ @navhub/mcp       │
│ 本地 Embedding   │    │ Drizzle 双驱动   │    │ 15 个 MCP 标准工具 │
│ SSRF 物理防击穿  │    │ 向量检索 (HNSW)  │    │ 读写隔离 / 审计落库│
│ 多模型 LLM 轮换 │    │ FTS5 / BM25 引擎 │    └───────────────────┘
└─────────────────┘    └────────┬─────────┘
                                │ 底层共用
                       ┌────────▼─────────┐
                       │ @navhub/core     │
                       │ 核心领域模型     │
                       │ Discounted-LinUCB│
                       │ 洛伦兹双曲平替   │
                       │ 0-RTT AST 解析器 │
                       │ 卡尔曼轨迹预取   │
                       └──────────────────┘
```

---

## 2. API 服务中枢架构 (`apps/api`)

### 2.1 存储接缝架构
NavHub 前端持久化通过替换 NavSphere 历史的 2 个 JSON 文件读写函数（`getFileContent` 与 `commitFile`），实现全站 69 处业务调用点零改动即可整体无缝切换至底层真实数据库。
* `STORAGE_ADAPTER=http`：前端走同源 BFF 代理 `/api/hub/*` 转发中枢，由服务端自动注入 `NAVHUB_STORAGE_TOKEN`，保障生产公开访问安全。
* `STORAGE_ADAPTER=github`：兼容原版行为，数据直接提交到用户自己的私有 GitHub 仓库。

### 2.2 核心路由分布
中枢共挂载 62 条路由，涵盖：
* **公开只读**：`GET /api/sites`（支持按 source 过滤）、`GET /api/categories`、`GET /api/tags`、`GET /api/collections`、`GET /api/search`。
* **管理写操作**：`POST /api/sites`、`POST /api/sites/batch`（批量导入）、`POST /api/sites/auto`（URL 自动抓取富化）、`DELETE /api/sites/:id`。
* **Token 治理**：`GET /api/tokens`、`POST /api/tokens`、`DELETE /api/tokens/:id`。
* **任务队列**：`GET /api/jobs`、`POST /api/jobs/run`。
* **系统探针**：`GET /api/health`。

---

## 3. 前端与 Bento-Flow 工作台 (`apps/web-overlay` & `apps/web`)

### 3.1 覆盖层镜像机制
NavHub 采用自研 `apps/web-overlay` 作为前端事实源，通过 `node scripts/check-web-overlay.mjs` 实现 120 个覆盖层文件与 `apps/web` 保持 100% 镜像一致。

### 3.2 Bento-Flow 核心能力
1. **跨分类卡片自由拖拽重组**：在排版模式下，站点卡片携带 `siteId` 与源分类 ID，可直接拖入任意目标分类标题，底层通过 `siteCategoryOverrides` 字典完成响应式分类迁移。
2. **零服务端开销的免登 URL-Hash 分享**：通过 Base64 URL Hash 算法将当前桌面整套排版、强调色与组件序列化为 `#diy=...`，支持一键分享与即时加载。
3. **香农信息熵一键自愈排版 (Smart Auto-Tidy)**：基于人机工效学评估公式，一键自动隐藏空分类、折叠超载分类并开启自适应半衰期热度推荐。
4. **低代码动态微组件**：
   * `LiveApiWidget`：任意 REST 接口动态轮询与 JSONPath 数据呈现。
   * `RssFeedWidget`：技术头条与社区动态早报滚动卡片。
   * 12+ 经典内置小组件：番茄钟、天气、GitHub 热力图、双曲平替雷达、备忘便签等。

---

## 4. 核心算法原理与数学建模 (`packages/core`)

### 4.1 时序衰减折扣多臂老虎机 (Discounted-LinUCB)
* **目的**：动态自适应计算 5 大通道（exact, fts, pinyin, semantic, personal）的融合权重，克服历史数据钝化。
* **公式**：
  $$A_a = \gamma A_a + (1 - \gamma) I + x x^T, \quad b_a = \gamma b_a + r x$$
  其中 $\gamma = 0.98$ 为时间衰减因子。
* **驻留时长双重隐式奖励模型**：
  * 跳出时长 $t < 1.5\text{s}$：$r = -0.5$（负向惩罚）。
  * 发生复制或收藏：$r = +2.0$（强有效正向强化）。

### 4.2 洛伦兹双曲超曲面平替模型 (Lorentz Hyperboloid)
* **目的**：度量技术工具之间的层次拓扑关系与同阶平替可能性，根除庞加莱圆盘在边缘处的除零奇点。
* **内积与测地线距离**：
  $$\langle u, v \rangle_L = -u_0 v_0 + \sum_{i=1}^{d-1} u_i v_i$$
  $$d_L(u, v) = \text{arcosh}(\max(1.0, -\langle u, v \rangle_L))$$

### 4.3 端侧 0-RTT 推测执行 Micro-AST 解析器
在全局搜索框输入技术文本时原地秒级解析：
* **Cron**：解析 5/6 段表达式，输出人类可读中文执行频率与分词详情。
* **JWT**：离线反序列化 Header/Payload，计算有效剩余时间倒计时。
* **Curl**：解析请求动词、URL 与参数，自动逆向生成 Fetch 语法代码块。

### 4.4 二维卡尔曼滤波轨迹预取平滑 (Kalman Trajectory Filter)
* 状态向量 $x = [pos_x, pos_y, vel_x, vel_y]^T$，消除手部高频微抖动，精准预测未来 100~300ms 的落点坐标。
* 结合客户端网络状态（2G/3G/4G/saveData）自适应调节预取深度（DNS 预解析 vs 全连接预热）。

---

## 5. 存储层设计与双引擎驱动 (`packages/store`)

### 5.1 双运行模式架构
* **Lite 模式**：基于 SQLite + sqlite-vec + FTS5，单文件轻量运行，支持内存向量自动降级回退。
* **Standard 模式**：基于 PostgreSQL 16+ + pgvector + tsvector + pg_trgm，支持 HNSW 索引加速与多实例高并发。

### 5.2 核心数据表结构
涵盖 `sites`、`categories`、`tags`、`site_tags`、`collections`、`collection_items`、`api_tokens`、`audit_logs`、`jobs`、`health_checks` 等 19 张核心表，均具备事务一致性保障与 Drizzle 幂等迁移。

---

## 6. AI 抓取富化与安全防御 (`packages/ai`)

### 6.1 三层 SSRF 物理防击穿安全沙箱
1. **协议白名单**：只允许 `http:` 与 `https:`。
2. **解析后真实 IP 网段校验**：过滤环回地址（`127.0.0.0/8`）、内网私有地址（`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`）及链路本地地址，彻底阻断 DNS Rebinding 攻击。
3. **重定向逐跳校验**：每次重定向均强制重新解析并校验目标 IP。

### 6.2 多模型备选轮换池 (Multi-Model Fallbacks)
支持配置主模型与备选模型列表（DeepSeek / 通义千问 / 本地 Ollama），当主模型限流或超时时自动顺延轮换，最后平滑降级至规则提取，确保系统高可用。

---

## 7. MCP Server 智能体协议 (`packages/mcp`)

标准 Model Context Protocol 实现，支持 stdio 与 HTTP 两种传输协议：
* **15 个标准工具**：`search_sites`、`get_site`、`list_categories`、`create_site`、`update_site`、`delete_site`、`batch_import`、`get_trending`、`run_job`、`health_check` 等。
* **安全护栏**：严格执行 Scope 读写分离（`read` / `write` / `admin`）、写操作幂等去重与 `audit_logs` 全流程审计。

---

## 8. 多端扩展与工程工具集 (`extensions` & `scripts`)

### 8.1 浏览器与桌面扩展
* **Chrome 扩展**：支持配置 API Token，一键调用 AI 抓取收录当前网页，杜绝 401 报错。
* **Raycast 扩展**：支持配置 `apiToken` 与自定义 `webUrl`，支持全局模糊检索并一键复制 Markdown 超链接。

### 8.2 自动化推仓与维护脚本
* `scripts/push-to-github.sh`（macOS / Linux）与 `scripts/push-to-github.bat`（Windows）：内置预埋仓库地址，自动建分支、提交并推送到 GitHub。
* `scripts/check-web-overlay.mjs`：前端覆盖层一致性实时校验工具。

---

## 9. 生产环境部署与故障排查

### 9.1 Docker Compose 容器化部署
* **Lite 模式**：`docker compose up -d`（单机零外部依赖）。
* **Standard 模式**：`docker compose --profile standard up -d`（高并发 PG 模式）。

### 9.2 服务探针与健康检查
* 探针接口：`GET http://localhost:8787/api/health`
* 接口文档：`GET http://localhost:8787/docs`（OpenAPI Swagger）
* 前端页面：`http://localhost:3000`
