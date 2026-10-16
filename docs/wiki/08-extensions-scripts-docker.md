# 08 · 扩展、脚本与 Docker

## 1. 浏览器 / Raycast 扩展

### 1.1 Chrome 扩展（`extensions/chrome-extension/`）

[manifest.json](file:///c:/Users/许进龙/Desktop/web/extensions/chrome-extension/manifest.json) —— **Manifest V3**，名称「NavHub 智能导航随身助手」

| 项 | 值 |
| --- | --- |
| 权限 | `activeTab`、`storage`（**最小权限集**） |
| omnibox keyword | **`nh`** —— 地址栏输入 `nh` + 空格触发极速语义搜索 |
| background | `background.js`（service worker） |
| action popup | `popup.html` + `popup.js` |
| 图标 | `icons/icon{16,48,128}.png` |

| 文件 | 行为 |
| --- | --- |
| `background.js` | `DEFAULT_API_URL = "http://127.0.0.1:8787"`；omnibox 输入 → `GET /api/search?q=...&limit=6` → 回车跳 `http://localhost:3000?q=<query>` |
| `popup.js` | `API_BASE = "http://127.0.0.1:8787"`；**健康探测** `GET /api/health`（2s `AbortSignal.timeout`）显示中枢状态；搜索 `GET /api/search?limit=5`；**收录当前网页** `POST /api/sites` |
| `popup.html` | UI + 「打开完整网站 →」链接到 `localhost:3000` |

**能力**：地址栏 `nh` 极速语义搜索、一键收录当前网页、平替雷达直达。

### 1.2 Raycast 扩展（`extensions/raycast-extension/`）

[package.json](file:///c:/Users/许进龙/Desktop/web/extensions/raycast-extension/package.json) + [src/search-navhub.tsx](file:///c:/Users/许进龙/Desktop/web/extensions/raycast-extension/src/search-navhub.tsx)

| 项 | 值 |
| --- | --- |
| preference `apiUrl` | 默认 `http://127.0.0.1:8787`（可配置） |
| 检索 | `GET {apiBase}/api/search?q=...&limit=12` |
| 结果动作 | 打开站点 / 打开 `http://localhost:3000` |
| 前置条件 | NavHub 后端 API 处于运行状态 |

两个扩展都**直连中枢 REST API**（不经过 Web 前端代理），因此需要 CORS 放行（`NAVHUB_CORS_ORIGINS` 默认 `*`）。

## 2. scripts/ 工具集

| 脚本 | 类型 | 用途 |
| --- | --- | --- |
| [run.mjs](file:///c:/Users/许进龙/Desktop/web/scripts/run.mjs) | Node | **pnpm 定位器**：优先找 DSH 内置 runtime（`~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs`），找不到则回退 PATH 里的 `pnpm`。用法 `node scripts/run.mjs <pnpm args>` |
| [run.ps1](file:///c:/Users/许进龙/Desktop/web/scripts/run.ps1) | PS 5.1 | 同上的 PowerShell 版。**用点源执行** `. ./scripts/run.ps1 install`（保留退出码）。**文件内刻意只用 ASCII**——Windows PowerShell 5.1 按 ANSI 读 `.ps1`，中文会导致解析失败 |
| [vendor-web.mjs](file:///c:/Users/许进龙/Desktop/web/scripts/vendor-web.mjs) / `.ps1` | Node / PS | **拉取 NavSphere 底座到 `apps/web`** 并注入 NavHub 存储适配器。用脚本而非 checked-in 副本——保持仓库聚焦 NavHub 自有代码，更新上游只需一条命令 |
| [sync-web-overlay.mjs](file:///c:/Users/许进龙/Desktop/web/scripts/sync-web-overlay.mjs) | Node | **反向同步**：下载上游 tarball 逐文件 diff，把「与上游不同或上游没有」的文件精确同步进 `apps/web-overlay`（唯一事实源）。规则：本地有/上游没有→新增；内容不同→更新；**内容一致→从 overlay 删除** |
| [check-web-overlay.mjs](file:///c:/Users/许进龙/Desktop/web/scripts/check-web-overlay.mjs) | Node | 检查 `apps/web` 与 `apps/web-overlay` 的**一致性漂移**——改了 `apps/web` 忘了同步，重新 vendor 或构建镜像时改动会丢。把漂移变成显式失败（CI 可加） |
| [gen-pwa-icons.mjs](file:///c:/Users/许进龙/Desktop/web/scripts/gen-pwa-icons.mjs) | Node | 从 SVG **栅格化**生成 PWA 图标（品牌色 + 首字母「N」，与站内 LetterAvatar 视觉一致）。输出 `icon-{192,512}.png`、`icon-maskable-512.png`、`apple-touch-icon.png`。**为什么不用现有 `logo.webp`**：只有 80x80，放大到 512 会模糊 |
| [pg-check.mts](file:///c:/Users/许进龙/Desktop/web/scripts/pg-check.mts) | TS | **PostgreSQL 分档验收**：`loadConfig({mode:"standard", databaseUrl:...})` + `createContext()` 跑 17 项检查（README 报告 17/17 通过）。用法 `node --experimental-strip-types scripts/pg-check.mts`（`pnpm test:pg`） |
| [d1-regression.mjs](file:///c:/Users/许进龙/Desktop/web/scripts/d1-regression.mjs) | Node | **D1 缺陷回归**：起临时中枢（`127.0.0.1:8791`），提交**不含 API 创建站点**的快照，验证该站点**幸存**（不被 navigation.json 全量对齐误删） |

## 3. Docker

### 3.1 两套 compose

| 文件 | 服务 | 适用 |
| --- | --- | --- |
| [docker-compose.yml](file:///c:/Users/许进龙/Desktop/web/docker-compose.yml)（根） | `navhub-api`(8787) + `navhub-web`(3000)，用根 `Dockerfile` | **简版**，两服务，共享 `navhub-data` 卷 |
| [docker/docker-compose.yml](file:///c:/Users/许进龙/Desktop/web/docker/docker-compose.yml) | 5 个服务 + **4 个 profile** | **完整版**（README 快速开始用的就是它） |

> **为什么 compose 放在 `docker/` 而不是仓库根**：compose 的相对路径相对**文件所在目录**解析，放根目录会因路径拼接产生 `C:\Users\<user>\docker` 这类解析错误。用法：`cd docker && docker compose up -d`。

### 3.2 完整版的 4 个 profile

| profile | 服务 | 说明 |
| --- | --- | --- |
| **（默认）** | `api` | lite 模式中枢：SQLite + sqlite-vec + FTS5，单容器零外部依赖 |
| `web` | `web` | Web 前端（从 NavSphere 底座 + overlay 构建），依赖 `api` healthy |
| `standard` | `postgres` + `api-standard` | PostgreSQL + pgvector（pg17），多用户/公开站 |
| `mcp` | `mcp` | MCP HTTP 传输，供远程 AI 客户端 |

```bash
docker compose up -d                                     # lite：仅中枢
docker compose --profile web up -d                       # 追加 Web 前端
docker compose --profile standard up -d                  # PostgreSQL + pgvector
NAVHUB_MCP_TOKEN=xxx docker compose --profile mcp up -d  # 追加 MCP HTTP
```

### 3.3 服务详情

| 服务 | 关键配置 |
| --- | --- |
| `api` | 镜像 `navhub/api:0.1.0`；端口 `${NAVHUB_PORT:-8787}:8787`；卷 `navhub-data:/data`；`NAVHUB_MODE=lite`、`NAVHUB_SQLITE_PATH=/data/navhub.db`、`NAVHUB_EMBEDDING_CACHE=/data/models`、`NAVHUB_SEED_ON_START=1`；**healthcheck** `curl -fsS http://127.0.0.1:8787/api/health`（30s，start_period 40s） |
| `web` | 镜像 `navhub/web:0.1.0`；端口 `${NAVHUB_WEB_PORT:-3000}:3000`；`STORAGE_ADAPTER=http`、`NEXT_PUBLIC_API_URL=http://api:8787`、`NAVHUB_STORAGE_BASE_URL=http://api:8787`；`depends_on: api: service_healthy` |
| `postgres` | `pgvector/pgvector:pg17`；端口 `${POSTGRES_PORT:-5432}:5432`；`POSTGRES_USER/PASSWORD/DB=navhub`；healthcheck `pg_isready` |
| `api-standard` | 同 `api` 镜像，`NAVHUB_MODE=standard` + `NAVHUB_DATABASE_URL=postgres://navhub:...@postgres:5432/navhub` |
| `mcp` | `command: node --experimental-strip-types packages/mcp/src/http.ts`；端口 `8790`；`NAVHUB_MCP_HTTP_HOST=0.0.0.0` |

**构建参数**（应对 Docker Hub / deb.debian.org 不可达的网络）：

| 参数 | 默认 | 覆盖示例 |
| --- | --- | --- |
| `NODE_IMAGE` | `node:22-bookworm-slim` | `dockerproxy.net/library/node:22-bookworm-slim` |
| `DEBIAN_MIRROR` | `deb.debian.org` | `mirrors.tuna.tsinghua.edu.cn` |
| `NAVSPHERE_REF` | `main` | 上游 NavSphere 分支 |

或配置 `~/.docker/daemon.json`：

```json
{ "registry-mirrors": ["https://docker.m.daocloud.io", "https://docker.1ms.run"] }
```

### 3.4 `entrypoint.sh`

```sh
set -e
if [ "${NAVHUB_SEED_ON_START:-1}" = "1" ]; then
  node --experimental-strip-types apps/api/src/seed-main.ts || \
    echo "[navhub] 种子导入失败，继续启动（搜索仍可用）"
fi
exec node --experimental-strip-types apps/api/src/main.ts
```

**为什么用 entrypoint 而不是在应用代码里判断**：首次启动的「是否为空库」判断属于**部署编排问题**，放这里更清晰，也让 `docker run` 与 compose 行为一致。
- `runSeed()` 按 URL **幂等去重**，重复执行不产生副本
- embedding 失败**不会让启动失败**（降级为关键词 + 拼音检索）

### 3.5 三个 Dockerfile

| 文件 | 用途 | 要点 |
| --- | --- | --- |
| [docker/Dockerfile.api](file:///c:/Users/许进龙/Desktop/web/docker/Dockerfile.api) | 中枢镜像 | 先装 `python3 make g++`（better-sqlite3 原生编译）+ `curl`（HEALTHCHECK）；**不依赖 corepack**（会联网拉版本，构建环境常不可用）→ `npm install -g pnpm@11.7.0 --registry=https://registry.npmmirror.com`；**先只拷贝清单**最大化层缓存 |
| [docker/Dockerfile.web](file:///c:/Users/许进龙/Desktop/web/docker/Dockerfile.web) | 前端镜像 | 依赖层先只拷清单（根 `package.json` + `pnpm-lock.yaml` + `pnpm-workspace.yaml` + 覆盖层 `package.json`）→ **`pnpm install --frozen-lockfile --filter "./apps/web"`**（镜像里前端就是 workspace 成员，装的就是仓库锁定的那一套版本，可复现；改自研源码不会让这层失效）→ 再拉 NavSphere 底座到 `/app/apps/web` 并 `COPY apps/web-overlay/ /app/apps/web/` 注入覆盖层 → **开箱可用，无需宿主机跑 vendor**；`ENV STORAGE_ADAPTER=http NEXT_PUBLIC_API_URL=http://api:8787`；`pnpm build`（**不用 standalone**——避免受限环境创建符号链接失败） |
| [Dockerfile](file:///c:/Users/许进龙/Desktop/web/Dockerfile)（根） | 简版多阶段 | `base → dependencies → builder → runner`；`EXPOSE 3000 8787`；`CMD node scripts/run.mjs dev` |

**overlay 注入的关键文件**（Dockerfile.web 注释）：
- `src/lib/storage-adapter.ts` —— 三种后端实现
- `src/lib/github.ts` —— 保持原函数签名的门面（因此 16 个 route / 约 69 处调用点一行都不用改）
- `src/lib/navhub-api.ts` 等 —— 混合检索面板 / 收藏夹 / 标签 / 榜单 / 详情 / 任务面板 / 运营看板
- `next.config.js` —— 构建输出目录可覆盖
- `src/app/api/hub/[...path]/route.ts` —— **运行时读 `NAVHUB_STORAGE_BASE_URL`**，无需 Dockerfile 额外配置

### 3.6 离线部署

- **embedding 模型**：首次启动下载到 `/data/models`（约 **24MB**，来自 hf-mirror）。完全离线部署把模型目录**预先挂载**到 `/data/models`
- **种子数据**：`NAVHUB_SEED_ON_START=1`（默认开）导入 50 个真实中文站点；设为 `0` 关闭

## 4. 目录速查

```
extensions/
├── chrome-extension/      manifest.json / background.js / popup.{html,js} / icons/
└── raycast-extension/     package.json / src/search-navhub.tsx / icon.png

scripts/
├── run.mjs  run.ps1                  pnpm 定位器（node / powershell）
├── vendor-web.mjs  vendor-web.ps1    拉取上游底座
├── sync-web-overlay.mjs              反向同步 overlay（唯一事实源）
├── check-web-overlay.mjs             一致性漂移检查（CI 可加）
├── gen-pwa-icons.mjs                 PWA 图标栅格化
├── pg-check.mts                      PostgreSQL 分档验收（17 项）
└── d1-regression.mjs                 D1 快照误删回归

docker/
├── Dockerfile.api     中枢镜像（lite 默认）
├── Dockerfile.web     前端镜像（构建期拉上游 + 注入 overlay）
├── docker-compose.yml 5 服务 / 4 profile
└── entrypoint.sh      可选种子导入 → 启动中枢

Dockerfile             根简版多阶段镜像
docker-compose.yml     根简版（api + web）
```
