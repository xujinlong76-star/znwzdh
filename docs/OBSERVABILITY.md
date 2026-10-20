# 可观测性接入（Prometheus）

> 口径：端点与指标名以 `apps/api/src/metrics.ts` 为准；格式与基数守卫在 `apps/api/test/metrics-format.test.ts`（2026-10-20 加入）。
> 目标：**能直接 scrape**，不引入 prom-client / OpenTelemetry；指标只含聚合值与有界标签。

## 1. 抓取配置

- 端点：`GET /api/metrics`
- 响应：`text/plain; version=0.0.4; charset=utf-8`
- 端口：默认 `8787`（`NAVHUB_PORT` / `PORT` 可覆盖）
- 鉴权：默认开放模式可匿名抓取；`NAVHUB_AUTH_REQUIRED=1` 时需要 `read` 及以上 scope 的 Bearer token
- **自反馈排除**：`/api/metrics` 自身不会计入 HTTP 指标

```yaml
scrape_configs:
  - job_name: navhub
    scrape_interval: 15s
    scrape_timeout: 5s
    metrics_path: /api/metrics
    static_configs:
      - targets: ["navhub-api:8787"]
    # 开启鉴权后取消注释：
    # authorization:
    #   type: Bearer
    #   credentials_file: /etc/prometheus/navhub-token
```

抓取健康检查：

```bash
curl -fsS http://localhost:8787/api/metrics | head
# 期望首行形如 # HELP navhub_build_info ...
```

## 2. 指标清单

| 指标 | 类型 | 标签 | 含义 |
| :--- | :--- | :--- | :--- |
| `navhub_build_info` | gauge | `mode` / `node` | 构建与运行模式信息，值恒为 1 |
| `navhub_up` | gauge | — | 进程存活，值恒为 1 |
| `navhub_process_uptime_seconds` | gauge | — | 进程运行时长（秒） |
| `navhub_process_resident_memory_bytes` | gauge | — | RSS（字节） |
| `navhub_process_heap_used_bytes` | gauge | — | V8 堆已用（字节） |
| `navhub_process_heap_total_bytes` | gauge | — | V8 堆总量（字节） |
| `navhub_capability` | gauge | `name=semantic\|fts\|llm` | 能力开关（1=可用） |
| `navhub_embedding_ready` | gauge | — | embedding 模型是否已加载 |
| `navhub_sites` | gauge | `status=active\|broken\|pending\|trashed` | 站点数（按状态） |
| `navhub_categories_total` | gauge | — | 分类数 |
| `navhub_tags_total` | gauge | — | 标签数 |
| `navhub_http_requests_total` | counter | `method` / `route` / `status` | HTTP 请求数（路由模板维度） |
| `navhub_http_request_duration_seconds` | summary | `method` / `route` | 请求耗时；输出 `_sum`（秒）与 `_count` |
| `navhub_search_planner_total` | counter | `decision=early_exit\|full` | Query Planner 决策数 |
| `navhub_search_semantic_skipped_total` | counter | — | 语义通道未执行次数（剪枝或显式禁用） |
| `navhub_search_channel_avg_ms` | gauge | `channel=exact\|fts\|pinyin\|semantic` | 检索各通道平均耗时（毫秒） |

> `navhub_categories_total` / `navhub_tags_total` 是历史已发布的 gauge 名（规模计数），不属于 counter；守卫里单独登记，避免新增 gauge 继续占用 `_total`。

## 3. 基数保证

- `route` 标签只取 Fastify 路由模板（如 `/api/sites/:id`），**绝不使用原始 URL**；查询串不会进入标签。
- 允许的标签名是白名单：`method` / `route` / `status` / `name` / `channel` / `decision` / `mode` / `node`。新增标签会先让格式测试失败。
- 所有维度都是有限集合：新增路由会增加序列，但不会随用户输入增长。
- `/api/metrics` 内的 DB 规模统计有 5 秒缓存，避免高频抓取把 `COUNT` 打满。

## 4. 建议告警

```yaml
groups:
  - name: navhub
    rules:
      - alert: NavHubDown
        expr: navhub_up == 0
        for: 1m
      - alert: NavHubFtsDown
        expr: navhub_capability{name="fts"} == 0
        for: 5m
      - alert: NavHubSemanticDown
        expr: navhub_capability{name="semantic"} == 0
        for: 30m
      - alert: NavHubEmbeddingNotReady
        expr: navhub_embedding_ready == 0
        for: 30m
      - alert: NavHub5xxRate
        expr: |
          sum(rate(navhub_http_requests_total{status=~"5.."}[5m]))
            /
          sum(rate(navhub_http_requests_total[5m])) > 0.01
        for: 10m
```

平均耗时（summary 没有分位，只有均值）：

```promql
sum(rate(navhub_http_request_duration_seconds_sum[5m]))
  /
sum(rate(navhub_http_request_duration_seconds_count[5m]))
```

## 5. 本地验证

```bash
pnpm exec vitest run apps/api/test/metrics-format.test.ts
```

守卫覆盖：`# HELP` / `# TYPE` 配对、TYPE 合法、counter 命名、summary `_sum`/`_count` 成对、标签白名单、`route` 模板形态、标签值转义、指标家庭清单快照，以及 `server.ts` 的采集接线（路由模板 + 排除自身）。
