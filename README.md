# NavHub

> AI 原生网址导航系统 —— MIT 底座 + 自研智能中枢

## 它是什么

NavHub 在 [NavSphere](https://github.com/tianyaxiang/NavSphere)（MIT）这一成熟导航底座的**存储接缝**之上，替换掉「GitHub 仓库当数据库」的实现，接入自研的 AI 智能中枢：真正的本地中文语义检索、拼音/错别字/大字表混合召回、AI 自动富化入库、智能体检、个性化排序，以及让 AI Agent 直接读写导航数据的 MCP Server。

## 架构

```
apps/web        Next.js 前端（源自 NavSphere，MIT）
apps/api        Fastify 中枢：REST + SSE + MCP(HTTP/stdio) + 定时任务
packages/core   领域模型 / zod schema / 混合检索与 RRF 融合排序
packages/store  Drizzle schema + 双驱动 (sqlite | pg) + 向量/全文适配
packages/ai     本地 ONNX embedding / LLM 路由 / 富化流水线
packages/mcp    MCP Server（tools + scope 校验 + 审计）
docker/         lite | standard 双 profile
```

## 两种运行模式

| 模式 | 数据库 | 向量 | 全文 | 适用
| --- | --- | --- | --- | --- |
| `lite` | SQLite | sqlite-vec | FTS5 + CJK 二元分词 | 个人 / NAS，单容器零外部依赖 |
| `standard` | PostgreSQL | pgvector | tsvector + pg_trgm | 公开站 / 企业，多用户与队列 |

## 快速开始

```bash
pnpm install
cp .env.example .env
pnpm --filter @navhub/api seed   # 播种内置站点
pnpm dev                          # 启动中枢 (http://localhost:8787)
pnpm dev:web                      # 启动前端 (http://localhost:3000)
```

## 环境变量要点

- `NAVHUB_EMBEDDING_ENDPOINT` / `HF_MIRROR`：本地 embedding 模型下载源，默认 `https://hf-mirror.com`
  （transformers.js v4 **不会**读取 `HF_ENDPOINT`，必须设置 `env.remoteHost`）。
- `NAVHUB_LLM_BASE_URL` / `NAVHUB_LLM_API_KEY` / `NAVHUB_LLM_MODEL`：OpenAI 兼容 LLM，默认 DeepSeek。
  未配置时系统**仍可正常启动并搜索**，AI 富化降级为启发式规则。

## 许可

- 本项目自研部分：MIT
- `apps/web` 派生自 NavSphere（MIT），保留其原始 LICENSE 与署名，见 `apps/web/UPSTREAM.md`
