# NavHub

一款 **AI 原生的网址导航系统**：本地中文语义检索 + 拼音/关键词混合召回 + AI 自动富化入库 +
让 AI Agent 直接读写导航数据的 MCP Server。

底座来自 [NavSphere](https://github.com/tianyaxiang/NavSphere)（MIT）—— 一个成熟、界面完整的导航站，
NavHub 在它的**存储接缝**上做了替换与扩展。

---

## 一、为什么这样做：把改造点压缩到 2 个函数

NavSphere 全站的持久化**只经过两个函数**：

```
src/lib/github.ts
  getFileContent(path)              -> 读 JSON
  commitFile(path, content, ...)    -> 写 JSON
```

数据落在 3 个文件（`navigation.json` / `site.json` / `resource-metadata.json`），共 **69 处调用点**。

这意味着**不需要修改那 69 处**：只要把这两个函数的实现换成「按 `STORAGE_ADAPTER` 选择后端」，
整个后台（增删改查、拖拽排序、投稿审核）就整体切换到了真实数据库上，前端业务代码零改动。

| 适配器 | 数据存哪 | 适用 |
| --- | --- | --- |
| `github` | 你自己的 GitHub 仓库（原版行为） | 零成本、无需服务器 |
| `http` | NavHub 中枢（**默认**） | 自建，获得 AI 检索能力 |
| `sqlite` | 同进程直连数据库 | 单机部署，省一次网络往返 |

---

## 二、架构

```
apps/api        Fastify 中枢：REST + NavSphere 兼容存储 API + 种子数据
apps/web        Next.js 前端（源自 NavSphere）+ StorageAdapter 接缝
packages/core   领域模型 / CJK 分词 / 拼音 / RRF 融合
packages/store  Drizzle schema + 双驱动(sqlite|pg) + sqlite-vec/pgvector + FTS5
packages/ai     本地 ONNX embedding（bge-small-zh）+ SSRF 安全抓取 + LLM 富化
packages/mcp    MCP Server（stdio + HTTP，scope/幂等/审计）
docker/         Dockerfile + lite / standard 双 profile
```

### 两种运行模式

| 模式 | 数据库 | 向量 | 全文 | 场景 |
| --- | --- | --- | --- | --- |
| `lite`（默认） | SQLite | sqlite-vec | FTS5 + CJK 二元分词 | 个人 / NAS，单容器零外部依赖 |
| `standard` | PostgreSQL | pgvector (HNSW) | tsvector + pg_trgm | 公开站 / 企业内部，多用户 |

---

## 三、快速开始

### 本地开发

```bash
pnpm install
cp .env.example .env

# 1) 播种 50 个精选中文站点（同时生成向量，首次会下载 24MB 模型）
pnpm --filter @navhub/api seed

# 2) 启动中枢
pnpm --filter @navhub/api start      # http://localhost:8787
```

> 本机没有 PowerShell Core（`pwsh`），脚本请用点源方式执行：`. ./scripts/run.ps1 install`

### Docker

```bash
docker compose up -d                              # lite
docker compose --profile standard up -d            # PostgreSQL + pgvector
NAVHUB_MCP_TOKEN=xxx docker compose --profile mcp up -d   # 额外开 MCP HTTP
```

---

## 四、能力与降级（重要）

**所有 AI 能力都是可选的，缺任何一项系统都照常启动**，并会在 `/api/health` 里如实上报：

```bash
curl http://localhost:8787/api/health
```

| 能力 | 缺失时的行为 |
| --- | --- |
| 本地 embedding 模型 | 语义通道关闭，关键词 / 拼音 / 全文三路照常工作 |
| sqlite-vec | 同上，并在 `capabilities.notes` 说明原因 |
| LLM API Key | AI 富化降级为**启发式规则**，结果标记 `provenance: "heuristic"` |

这套降级路径有测试覆盖（关闭 embedding 后搜索仍必须可用）。

---

## 五、检索能力

四路召回 + RRF 融合（k=60），并按「命中通道数」加权：

| 通道 | 解决什么 | 实测例子 |
| --- | --- | --- |
| `exact` | 中文子串 | 「天气」→ 中国天气网 |
| `fts` | BM25 相关性排序 | 「设计」→ Dribbble > Figma |
| `pinyin` | 全拼 / 首字母 | `zgtqw`、`tianqi` → 中国天气网 |
| `semantic` | 自然语言意图 | 「写代码的AI」→ Cursor > GitHub Copilot |
| `personal` | 个性化（独立通道，权重最低） | 见下方说明 |

### 为什么个性化必须是「一路通道」而不是「事后加成」

RRF 的 k=60 会把靠前名次压得非常接近：

```
rrf(1)  = 1/61 = 0.01639
rrf(8)  = 1/68 = 0.01471   -> 仅差 11%
```

因此任何 ≥11% 的事后加成都能把排 8 顶到排 1 —— 「越用越懂你」会退化成「搜什么都搜不到」。
把个性化做成一路权重 0.3 的通道（相关性通道为 0.9~1.4），翻转能力就被权重天然限界，
而且能通过 `contributions` 解释「它为什么排这儿」。

---

## 六、MCP 接入（让 AI Agent 管理导航站）

### stdio（本地客户端，如 Claude Desktop / Cursor）

```json
{
  "mcpServers": {
    "navhub": {
      "command": "node",
      "args": ["--experimental-strip-types", "packages/mcp/src/stdio.ts"],
      "env": { "NAVHUB_MODE": "lite", "NAVHUB_SQLITE_PATH": "./data/navhub.db" }
    }
  }
}
```

### 工具清单

| 工具 | 权限 | 说明 |
| --- | --- | --- |
| `search_sites` | read | 混合检索，返回**每路召回的名次**作为可解释依据 |
| `get_site` / `list_categories` / `get_stats` | read | 读取 |
| `create_site` | write | 可自动抓取 + AI 富化；网址已存在时返回已存在站点而非报错 |
| `update_site` / `set_status` | write | 修改 |
| `batch_import` | write | **默认 `dryRun=true`**，先预览影响面 |
| `health_check` | write | 可用性巡检 |

### 安全边界（不是文档建议，是代码里的硬约束，有测试覆盖）

1. **读写分级**：只读 token 调用写工具会被拒绝。
2. **危险操作默认 dryRun**：批量导入先返回计划，不落库。
3. **幂等键**：Agent 重试是常态，重复调用不会产生重复站点。
4. **审计**：所有写操作落 `audit_logs`，actor 标记为 `mcp:<身份>`。
5. **输入上限**：批量导入单次最多 100 条。
6. **HTTP 模式默认只监听 127.0.0.1 且强制 Bearer token**，并校验 `Origin`。

---

## 七、安全

### SSRF 防护（`packages/ai/src/ssrf.ts`）

AI 富化需要抓取用户提交的 URL，这是本系统唯一的「用户可控输入 → 服务端出网」路径：

1. **协议白名单**：只允许 http/https。
2. **解析后校验**：先 DNS 解析，再检查**每个**结果 IP 是否落在环回/私网/链路本地/ULA/保留网段。
   仅校验 URL 字符串是不够的 —— `127.0.0.1.nip.io` 这类域名会解析到内网。
3. **重定向逐跳校验**：手动跟随重定向，每跳重新做 DNS + IP 校验，
   否则 `https://evil.com -> 302 -> http://169.254.169.254/` 就绕过去了。
4. 限制超时、响应体大小、重定向跳数；`169.254.169.254`（云元数据）被明确拦截。

内网导航站（如 NAS 需要收录内网服务）可显式设置 `NAVHUB_ALLOW_PRIVATE_NETWORKS=true`。

---

## 八、环境变量

见 [`.env.example`](.env.example)。三个最容易踩的：

- **`NAVHUB_EMBEDDING_ENDPOINT`**：默认 `https://hf-mirror.com`。
  `transformers.js` v4 **不读取 `HF_ENDPOINT`**，必须走 `env.remoteHost`；
  在 `huggingface.co` 不可达的网络里，这是「能跑」与「永远卡住」的分界。
- **`NAVHUB_LLM_API_KEY`**：缺省时 AI 富化降级为启发式，系统照常可用。
- **`STORAGE_ADAPTER`**：`http`（默认）/ `github` / `sqlite`。

---

## 九、开发须知（环境坑）

1. **脚本请用点源执行**：本机没有 `pwsh`，用 `. ./scripts/run.ps1 <args>`。
2. **`.ps1` 里不要写中文**：Windows PowerShell 5.1 按 ANSI 读取脚本文件，中文会导致解析失败。
3. **不要用 TS 构造函数参数属性**（`constructor(private x: T)`）：
   Node 的 `--experimental-strip-types` 只做类型擦除，遇到这类语法会报
   `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。
4. **不要用 `import.meta.url === process.argv[1]` 判断主模块**：
   Windows 上路径形式不一致会导致脚本**静默退出且无输出**。入口统一放 `main.ts` / `seed-main.ts`。
5. **pnpm 11 的构建脚本白名单**在 `pnpm-workspace.yaml` 的 `allowBuilds`，不在 `package.json`。
6. **原生依赖要做直接依赖**：`sqlite-vec` 必须在 `apps/api` 的 dependencies 里，
   pnpm 的严格布局不会因为 `@packages/store` 依赖它就把它暴露给 API。

---

## 十、测试

```bash
pnpm test          # 117 个测试
```

| 套件 | 覆盖 |
| --- | --- |
| `packages/core` | CJK 分词、FTS5 MATCH 表达式、拼音、RRF 融合、个性化通道 |
| `packages/store` | 向量存储（内存/真实 sqlite-vec 双实现一致性）、真实 SQLite 集成 15 项 |
| `packages/ai` | SSRF 网段判定（含 IPv4 映射绕过）、元数据抽取、启发式降级 |
| `apps/api` | **真实 HTTP 端到端**：检索、CRUD、去重、索引同步、降级、审计 |
| `packages/mcp` | 权限硬边界、dryRun 默认行为、幂等、审计 |

---

## 十一、许可

- 本项目自研部分：MIT
- `apps/web` 派生自 NavSphere（MIT），保留其原始 LICENSE 与署名
