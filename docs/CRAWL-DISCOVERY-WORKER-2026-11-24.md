# Crawl discovery worker

本阶段将持久化采集队列接入现有 `JobRunner` / `TaskRegistry`，复用项目的 `guardedFetch`，不另建网络请求通道。

## 配置种子

在 API 容器环境变量 `NAVHUB_CRAWL_SEEDS` 中配置 JSON 数组，最多读取 100 个：

```json
[
  { "url": "https://example.com/sitemap.xml", "kind": "sitemap" },
  { "url": "https://example.com/feed.xml", "kind": "rss" },
  { "url": "https://example.org/about", "kind": "page" }
]
```

也可以直接提供 URL 字符串数组；字符串默认按普通网页处理。仅接受公开 HTTP(S) URL，凭据 URL 与其它协议会被拒绝。最终 DNS/IP/端口安全判断仍由 `guardedFetch` 在每一跳执行，入队本身不代表网络访问已获准。

Docker lite 与 standard 的 API 服务均透传该变量。未配置时默认为空数组，不会擅自爬取未知站点。

## 调度与处理

- 新增 `crawl_worker` JobKind，每 30 分钟由现有 Cron 入队；也可通过既有 `POST /api/jobs` 手动触发。
- 每轮先回收过期 Worker 租约，再最多处理 25 条（手动默认 10 条）；每次抓取最多 10 秒、512 KiB、5 次重定向。
- Sitemap 解析 `<loc>`；RSS 解析 `<item><link>`；Atom 解析 `<entry><link href>`。每个 feed 最多分发 50 个 URL。
- 页面抽取 title / meta description / 可读文本，计算 SHA-256 与 SimHash64，写入页面指纹表。
- 精确内容哈希重复会写入候选证据 `exactDuplicateOf`，但不会自动合并或删除候选。
- 候选写入 `site_discovery_candidates`，状态始终为 `pending`；不会直接创建 active 站点或上架。
- 对 401 / 403 / 451 的任务挂起人工复核；429 与 5xx 遵循指数退避，并尊重最多 6 小时的 Retry-After；SSRF 拦截进入人工复核；不可重试 HTTP 错误进入死信。
- 仅周期性可信种子与 feed 子项允许把 `done` 任务重新排队；`dead_letter` 与 `hold_for_review` 不会因重复发现自动复活。

## 运行方式

手动触发任务：
```http
POST /api/jobs
Content-Type: application/json

{ "kind": "crawl_worker", "payload": { "maxTasks": 10 } }
```

环境变量种子会在每轮 Worker 执行时同步入队。手动 payload 可临时补充种子，最大 100 条。

## 当前边界

- 本 Worker 不绕过登录、验证码、robots 规则、付费墙或访问控制；受限站点挂起人工复核。
- 当前解析器以公开 Sitemap / RSS / Atom 与静态 HTML 元数据为目标，不执行 JavaScript，不模拟浏览器，不解析任意附件。
- 页面指纹已落库；当前跨 URL 重复提示采用精确 SHA-256。SimHash64 已存储，近重复候选检索与域名族聚合还需要后续索引/治理阶段。
- Worker 的任务与纯解析测试已添加，但尚未在本分支实际运行 CI；不得将其描述为测试通过。
