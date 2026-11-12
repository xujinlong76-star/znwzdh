# 山羊胡 4.0 — AI 原生开发者网址导航与知识工作台

<p align="center">
  <b>五路混合检索</b> · <b>Bento-Flow 自由排版工作台</b> · <b>0-RTT 原地微工具</b> · <b>MCP Server</b>
</p>

**山羊胡**是一款专为开发者与技术团队打造的 AI 原生网址导航与知识工作台（Developer Knowledge OS），原名 NavHub。底座派生自开源项目 NavSphere（MIT），山羊胡在它的存储接缝上做替换与扩展，而非重写。

本地种子库实测（`pnpm seed` 后，`data/navhub.db`，2026-11-12 核查）：**323 个站点、245 个分类行（20 个一级、225 个二级，站点实际使用其中 47 个）、6,007 条视频、12 个视频分类、6 个合集**。数字随种子数据更新而变，以实际库为准。

> 数字口径（2026-11-12 对事实源文件复核）：站点数以 `apps/web-overlay/src/navsphere/content/navigation.json` 为准——323 站（14 个一级 / 47 个二级分类，去重后 323 个 URL）；245 分类行是分类注册表 244 行（19 个一级 + 225 个二级）加入库时 1 行运行时「未分类」；视频以 `videos.json` 为准——6,007 条 / 12 类；合集 6 个见 `apps/api/src/seed-data.json`。代码注释里残留的 314（`seed.ts` / `baseline.ts`）与 332（`baseline.ts` 卷首）是过期数字、未随文件更新，不以它们为准；已部署库的站数可能因后台手工增删略高于文件数。

> 状态：本地开发版（`v0.1.0`），未正式上线。README 里的功能以代码实测为准，提案中、未落地的功能不会写成已上线。

## 预览与官网

- 官网：http://www.shanyanghu.com/（网站尚未上线，先行填写）
- 截图（待补充）：首页、DIY 工作台、每日简报页。

---

## 核心功能

### 1. 网址导航与分类

- 首页按分类分区展示站点卡片，站点页、分类页（`/category/[slug]`）、标签页、站点详情页（`/site/[id]`）齐全；支持收藏、置顶、搜索历史、自定义站点。
- 站点有健康巡检：定时任务轮询站点可用性，连续多次失败才标记 broken；有断链自愈、分类清洗与去重脚本。
- 视频导航（`/videos`）：6,007 条视频条目，含分类、播放器、章节与字幕；场景包（`/scenes`）按「做短剧、做简历、考公考研」等目标组织站点。

### 2. 五路混合检索与自适应调权

搜索框（`⌘K`）与 `/search` 页背后是五路异构召回，再用 RRF 融合：

| 通道 | 做法 |
|---|---|
| `exact` | 精确中文/英文子串 |
| `fts` | BM25 全文检索，CJK 写入期展开为单字 + 相邻二元组后喂 FTS5 |
| `pinyin` | 全拼与拼音首字母，如 `qdjb` → `启动脚本` |
| `semantic` | 本地量化 Embedding 向量检索（`Xenova/bge-small-zh-v1.5`，512 维 q8） |
| `personal` | 个人访问频次与置顶收藏权重 |

融合默认 RRF（`w/(60+rank)`），多路共识有加权奖励；再由 Discounted-LinUCB（γ=0.98，5 维上下文：长度 / CJK 比 / 字母比 / 拼音似然 / 数字比）按停留时长动态调整各通道权重，模型持久化在 `system_states`。

> 注意：语义检索依赖本地 ONNX 模型首次下载（默认镜像 `hf-mirror.com`，缓存 `./data/models`）。模型未就绪时搜索自动降级为其余通道，不会报错。种子库自带 323 条 512 维向量，但运行时若模型未加载，`/api/health` 会显示 `semantic:false`。

### 3. Bento-Flow 工作台：DIY 排版与分享

- 排版模式下站点卡片可重归类到任意分类，映射存在 `HomeDIYConfig.siteCategoryOverrides`；分类与站点可置顶，支持撤销/重做。
- 一键整理按分类分布的信息熵自动隐藏空分类、折叠超载分类。
- 免登分享：整套排版、强调色、画布背景与重归类关系经 Base64 编码进 `#diy=...` 链接（上限 4KB），好友打开即可预览并一键应用；配置本机保存在 `navhub_home_diy_config_v3`。
- 画布背景（mesh / dots / grid / aurora / clean）、强调色、毛玻璃卡片与自定义壁纸可调；另有流体玻璃画布与深色模式。
- 皮肤：工具栏皮肤选择器一键换 14 套成套主题（种子库 `themes`，20 项色板变量全覆盖），未安装的点选即安装并启用；设置页另有已安装主题下拉与已安装管家页。主题只在浅色模式下生效，深色下暂停、回到浅色自动恢复。

### 4. 0-RTT 原地微工具

在搜索框输入特定文本时，端侧直接解析并原地渲染微组件，无需跳转（仅在偏好里开启 `speculativeZeroRttEnabled` 时生效；另有独立快捷工具抽屉）：Cron 表达式解析、JWT 离线解码与过期倒计时、Curl 转 Fetch、Base64 编解码、时间戳互转、颜色速览、JSON 格式化校验、哈希识别/计算、IP / CIDR、UUID、字节大小、正则、semver、HTTP 状态码、日期转时间戳等 19 类。

### 5. Live Widgets（低代码动态微组件）

模块化画布上的小组件：番茄钟、天气（经服务端取 Open-Meteo）、RSS 技术早报、GitHub 贡献热力图、LiveApiWidget（填任意接口 URL + JSONPath + 轮询周期，展示实时健康状态与数值）、本地备忘、快捷工具、双曲平替雷达等。注册表与默认布局在 `lib/modular/registry.ts`。

### 6. 每日简报、热榜与追剧清单（已落地）

- **每日简报**（`/brief`）：一页看完小猫猫开场白、全网热榜精选、站内新收录与在追短剧提醒；开场白锚定真实条目生成，失败走模板。
- **全网热榜**（`/hot`、`/api/hotlist`）：注册了 7 个源，已覆盖 6 个——微博热搜、百度热搜、今日头条热榜、抖音热榜、B站热搜、知乎热榜；未覆盖 1 个——快手热榜（登记了未覆盖原因：无官方公开接口，只有付费第三方聚合，未接入）。只存标题 + 链接 + 热度，不搬运正文；源站改版导致解析失败时保留旧缓存并标记，不写坏数据。本地种子库的热榜缓存初始为空，需等 `hotlist_refresh` 任务跑过才有数据。
- **追剧清单**（`/me/watchlist`，需登录）：记「剧」而不是「站点」——看到第几集、按自己标注的节奏到更新日提醒。站内没有平台排播数据，提醒只断言「按你标注的节奏，今天是更新日」，不写「已更新」，也不做站外推送。
- **账号级个性化（部分落地）**：登录后收藏、追剧清单、设置等通过同一套同步协议（含 CRDT）跨设备同步；用户中心（`/me`）有收藏、历史、自定义站点、主题与模块显隐偏好、注销删净。

### 7. 小猫猫挂件

右下角悬浮小猫（`apps/web-overlay/public/xiaomaomao/xiaomaomao.js`，3.4MB，`layout.tsx` 以 `afterInteractive` 引入，功能开关 `settings.features.xiaomaomao`）。当前为 v7，含 v6 的全部能力：

- 头像真图多姿势（浅色 + 深色整套 6 图，深色自动切换）、聊天找站（`POST /api/ai/chat`，站内检索锚定）、摸猫、喂小鱼干（每日 5 条）、接星星游戏、语音输入、成长联动
- 可拖动并持久化位置（补齐移动端触摸与真尺寸钳制），无人互动时自动缩到窗口边缘半藏，点/悬停弹回
- 用户自改形象：图库 13 项 + 上传自图，本机保存，可恢复默认
- 庆祝视频钩子：媒体文件就位即生效，探活失败自动回退图片庆祝
- v7 新增：平时零遮挡，控件收进猫上方悬浮坞，悬停/轻点才唤出，闲置 3 秒自动收起；全套 UI 图标换手工 SVG

### 8. 技术图谱与平替推理

- 技术图谱页（`/graph`）：站点关系（平替 / 生态 / 互补 / 从属 / 上游 / 镜像 / 相关）与多跳技术栈链路配方（为「协同文档」「本地大模型」等目标自动合成端到端选型方案）。
- 双曲几何（庞加莱球 + 洛伦兹超曲面）用于平替与上下游推理。实话实说：向量投影到固定半径球面后，排序与余弦基本同序，双曲更多是几何解释层，不是独立排序信号。

### 9. 账号体系与管理后台

- 自助注册 + 邮箱验证（令牌只存 SHA-256、24 小时有效、一次性原子消费）、邮箱 + 密码登录（scrypt 加盐哈希、常量时间比较、用户不存在与密码错误返回同一结果以防账号枚举）、忘记/重置密码（重置链接 1 小时有效）。
- 邮件投递适配器：可配 SMTP（`NAVHUB_SMTP_*`，`NAVHUB_SMTP_HOST` 与 `NAVHUB_SMTP_FROM` 缺一不可，否则仍退化为日志投递）；未配置时退化为服务端日志投递。注意：日志投递已脱敏（`packages/ai/src/mail.ts` 的 `LogMailTransport` 经 `redactMailLogText` 处理，验证/重置链接与长令牌替换为 `[REDACTED]`，读日志拿不到可用链接；独立出现的 6 位数字验证码仍可见），但用户收不到真实邮件；生产未配 SMTP 现在拒绝启动（除非显式设置 NAVHUB_MAIL_LOG_TRANSPORT_OK=1 选择加入日志投递），上线前检查见 `.env.example` 邮件一节。
- 管理后台（`/admin`）：分类、站点、插件、统计、审计、API Token 签发与生命周期管理；用户中心有等级成长玩法（用不同功能涨经验）。

### 已落地（2026-11-12）：此前写在这里的三项已完成

- **长辈模式（完整版）**：工具栏一键开关（`lib/elder-mode.ts`，本机存储）：特大字 20px + 宽松间距 + 44px 最小触控目标 + 隐藏连胜条，关闭后字号还原为开启前的档位；水合前脚本先落值，首屏不闪烁。
- **多套皮肤自选**：14 套成套主题可一键换（见 §3），不再只有 DIY 强调色 / 画布背景 / 深色模式。
- **知乎热榜**：7 个热榜源已覆盖 6 个，见 §6。

### 刻意没写的功能（提案中或未落地）

- **热榜「全量聚合」是已拍板的方向，不是已完成的状态**：7 个源里 1 个仍未覆盖（快手），见上。

---

## 架构与目录

```
├── apps/
│   ├── api/             # Fastify 后端中枢：REST API + 种子数据 + 任务队列 + 鉴权
│   ├── web-overlay/     # 前端唯一事实源：Next.js 16，Bento 画布 / DIY / 0-RTT / 挂件
│   ├── web/             # 前端运行镜像：由 overlay 生成的 GENERATED 产物，不是双胞胎
│   └── mcp/             # MCP App：stdio 入口
├── packages/
│   ├── core/            # 纯算法零 IO：检索融合、LinUCB、拼音、CJK、双曲、0-RTT、CRDT、金库
│   ├── store/           # 存储层：Drizzle 类型/校验 + 手写幂等 DDL，SQLite/PG 双驱动，约 50 张业务表
│   ├── ai/              # AI 能力：ONNX embedding、SSRF 防护、LLM、富化抓取、邮件
│   └── mcp/             # MCP Server：41 个工具
├── extensions/
│   ├── chrome-extension/# Chrome 扩展（MV3）：omnibox 搜索、一键收录
│   └── raycast-extension/# Raycast 扩展：全局模糊检索、Markdown 链接复制
├── docker/              # 生产级 Dockerfile 与多模式 Compose 编排（以此为准）
├── scripts/             # 约 269 个脚本：校验、验证、上游同步、备份、SEO 等
└── docs/                # 68 篇文档 + wiki 13 篇 + ADR / 契约 / SEO
```

依赖方向：`core`（底层）← `store` / `ai` ← `api` ← `mcp`；前端不 import `@navhub/*`，走 `STORAGE_ADAPTER=http` + `/api/hub/*` BFF 代理。`apps/web` 本地只有 13 个文件快照，**不能直接构建运行**，必须先 `pnpm vendor:web` 拉上游底座，再 `pnpm mirror:web` 覆盖 overlay。

后端（`apps/api`，Fastify 5）：49 个路由插件按域拆分，REST 路由约 300 条（不同口径统计会漂移，以 `docs/CODEBASE_OVERVIEW.md` 为准）；鉴权 scope 分级 `public / read / favorites / write / admin`；API token 为 `nh_` + 24 字节随机，库内只存 SHA-256；14 种定时任务（健康巡检、权重重算、热榜刷新、每日简报、站点自愈、备份等），单实例锁（lite 用幂等表，standard 用 PG advisory lock）。

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 / 包管理 | Node.js ≥ 24、pnpm ≥ 11.7（`packageManager: pnpm@11.7.0`） |
| 语言 / 类型 | TypeScript 严格模式（Node 24 strip-types 直跑源码） |
| 后端 | Fastify 5、Drizzle ORM、better-sqlite3 / pg |
| 检索 | sqlite-vec（vec0）/ pgvector、FTS5 / tsvector + pg_trgm、ONNX（`bge-small-zh-v1.5`） |
| 前端 | Next.js 16.4.2（App Router）、React 19、Tailwind CSS 4、Radix UI、next-auth 5 beta、SWR |
| 测试 | Vitest、Playwright（E2E，Desktop Chrome） |
| 部署 | Docker（`node:24-bookworm-slim`） |

## 两种运行模式

| 特性 | `lite`（默认） | `standard` |
|---|---|---|
| 数据库 | 嵌入式 SQLite，默认 `./data/navhub.db` | PostgreSQL 16/17（`NAVHUB_DATABASE_URL`，缺失则启动报错） |
| 向量 | sqlite-vec（`vec0`，支持内存回退） | pgvector（HNSW 索引） |
| 全文 | FTS5 + CJK 二元分词 | tsvector + pg_trgm |
| 单实例锁 | 幂等表持久锁（TTL 120s） | PG advisory lock |
| 适用 | 个人、本地开发、家庭 NAS 单容器 | 团队协作、企业内部公开站、多用户 |

## 快速开始

### 环境要求

- Node.js ≥ 24、pnpm ≥ 11.7；仓库根目录操作。

### 1. 拉底座、生成镜像、安装依赖

```bash
git clone https://github.com/xujinlong76-star/znwzdh.git
cd znwzdh

# apps/web 本地不完整：先拉上游 NavSphere 底座，再用 overlay 覆盖生成镜像
pnpm vendor:web
pnpm mirror:web

pnpm install
cp .env.example .env
```

### 2. 播种初始化数据（必须在仓库根目录执行）

```bash
# config.ts 的库路径默认是 cwd 相对的 ./data/navhub.db；
# 用 pnpm --filter @navhub/api seed 会把种子播进 apps/api/data/navhub.db，开发服务器永远看不到
pnpm seed
```

### 3. 启动开发服务

```bash
# 前后端同启：API http://localhost:8787，Web http://localhost:3000
pnpm dev:all

# 或分开启动
pnpm dev        # 仅 API
pnpm dev:web    # 仅 Web
```

启动后核查：`http://localhost:8787/api/health`、`/api/ready` 应返回 200；Web 首页应返回 200；搜 `github` 应有命中。

### 4. 验证

```bash
pnpm check:overlay   # 前端覆盖层镜像一致性
pnpm verify          # 类型检查、覆盖层、契约、边界等聚合验证
pnpm test            # Vitest 单元测试
pnpm test:e2e        # Playwright 端到端（需先停掉 pnpm dev:all，端口会冲突）
```

## Docker 部署

**以 `docker/docker-compose.yml` 为准**（lite：`api`:8787、`web`:3000、`mcp`:8790，另有 `backup`；standard 另有 `docker/docker-compose.standard.yml`，提供 `postgres`（仅绑 127.0.0.1:5432）与 `api-standard`:8788）。根 `Dockerfile` 与根 `docker-compose.yml` 已废弃，勿用。

```bash
cd docker

# lite 模式一键启动（单机零外部依赖）
docker compose up -d

# standard 模式（联动真实 PostgreSQL 与 pgvector，需先设 POSTGRES_PASSWORD，见下）
docker compose -f docker-compose.yml -f docker-compose.standard.yml --profile standard up -d
```

启动完成后：Web `http://localhost:3000`；API 文档 `http://localhost:8787/api/docs`（OpenAPI）；健康检查 `http://localhost:8787/api/health`、`/api/ready`。

## 环境变量要点

详细配置见 [`.env.example`](.env.example)（约 310 行）。关键项：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NAVHUB_MODE` | `lite` | `lite`（SQLite）或 `standard`（PostgreSQL） |
| `PORT` | `8787` | API 监听端口 |
| `STORAGE_ADAPTER` | `http` | Web 端存储适配器：`http`（指向中枢）、`github`、`sqlite` |
| `NAVHUB_AUTH_REQUIRED` | 生产默认开启，开发默认关闭 | 公网部署请设为 `1`；开发模式启动时会打印开放模式警告 |
| `NAVHUB_IDENTITY_SECRET` | （无默认值） | 终端身份 HMAC 签名密钥，需 ≥ 32 字符；生产缺失则拒绝启动；未配时任意请求可自称任意身份，请勿暴露 8787 到公网 |
| `NAVHUB_CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | `*` 只有显式配置时才生效，生产请显式列为前端域名 |
| `POSTGRES_PASSWORD` | （无默认值） | standard 模式必填强口令，缺失时 compose 直接报错拒绝启动，不再提供默认口令 |
| `NAVHUB_EMBEDDING_ENDPOINT` | `https://hf-mirror.com` | 本地 Embedding 模型下载镜像源 |
| `NAVHUB_LLM_BASE_URL` | `https://api.agnes-ai.cn/v1` | LLM 兼容接口（OpenAI 兼容），可换 DeepSeek / Ollama |
| `NAVHUB_LLM_API_KEY` | （可选） | 未配置时 LLM 富化自动降级为纯规则启发式，并标注来源 `provenance: llm\|heuristic` |

## MCP 与扩展

- **MCP Server**：工具清单单一来源 `packages/core/src/mcp-schemas.ts`，共 **41 个**（28 read / 12 write / 1 admin，如 `search_sites`、`get_site`、`list_categories`、`create_site`、`batch_import`、`install_plugin`、`run_job`）。权限 `read | write | admin`，写操作入 `audit_logs`、支持幂等键、批量导入默认 `dryRun`。
  - stdio：`apps/mcp/src/stdio.ts`（默认仅 `read`）
  - Streamable HTTP：`apps/mcp/src/http-server.ts`（默认 `127.0.0.1:8790`，端点 `/mcp`、健康检查 `/health`），每请求重校验 Bearer token、会话绑定 token 指纹 / scope / owner、Origin 白名单
  - 供 Claude Desktop、Cursor 等 Agent 直接调度。
- **Chrome 扩展**（MV3）：`nh` omnibox 搜索、弹窗一键收录，token 存 `chrome.storage.local`，Bearer 仅发往回环地址。
- **Raycast 扩展**：`search-navhub`、`browse-plugins` 两个命令，`apiUrl` 默认 `http://127.0.0.1:8787`。

## 测试

- Vitest：覆盖 `packages/**`、`apps/api`、`apps/web/test`、`scripts/**`；覆盖率门禁在 `coverage-thresholds.json`（2026-11-06 基线：641 文件 / 7,235 用例，总行覆盖 85.68%、分支 71.68%；`packages/mcp` 分支 60.96%（W1 阈值 58.96%））。
- Playwright：`e2e/` 24 个 spec、单 worker、独立 E2E 库，覆盖搜索、工作台、管理后台 token / 恢复 / 插件等。
- 安全测试：`apps/api/test/security-readiness.test.ts` 30/30（生产拒绝不安全启动、CORS 默认值等）。

## 安全要点

- **E2EE 金库**：WebCrypto PBKDF2 10 万次 + AES-256-GCM、12 字节 IV，端侧零知识加密，密文同步至云端。注意 `core` 与 `web-overlay` 各有一份 vault 实现，存在漂移风险。
- **SSRF 三层防护**：仅 http/https；DNS 解析后按真实 IP 拦环回 / 私网 / 链路本地 / 云元数据 169.254（含 IPv6 展开防绕过）；重定向逐跳重检；超时 10s、2MB、最多 3 跳。LLM baseUrl 同样过此关。
- **鉴权与口令**：scrypt（N=16384、r=8、p=1、keylen 64）加盐哈希；验证令牌 24h、重置令牌 1h，只存 SHA-256，原子消费防重放；各账号端点按小时限流 5–20 次，防枚举。
- **生产红线**：不要把 8787 暴露到公网而不开鉴权；不要把 LLM / SMTP 密钥写进公开仓库；未配 SMTP 时验证链接只以脱敏形式进日志（token/链接为 `[REDACTED]`），但用户收不到真实邮件；生产未配 SMTP 时拒绝启动（除非 NAVHUB_MAIL_LOG_TRANSPORT_OK=1）。

## 许可证

- 山羊胡核心自研模块与算法库遵循 [MIT License](LICENSE)。
- 前端基底派生自开源项目 NavSphere（MIT），严格保留其原始版权声明。
