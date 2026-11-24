# 采集来源 Worker 运行边界

## 当前实现

- Worker 只认领已启用且到期的来源；认领由数据库租约完成，避免多实例同时处理同一来源。
- 单轮默认最多认领 5 个来源，轮询间隔 60 秒；同一进程不允许轮次重入。
- sitemap、RSS/Atom、普通页面分别解析 `loc`、`link/guid`、`a[href]`，每个来源最多产生 100 个去重候选。
- 来源请求必须通过 `@navhub/ai` 的 `guardedFetch`，超时 8 秒、响应体上限 1 MiB、最多 3 次重定向；逐跳 DNS/IP 校验由 SSRF 层负责。
- 解析阶段不对候选链接发起第二次网络请求。候选仅进入待审核队列，不能因此自动发布。
- Worker 默认关闭。只有明确设置 `NAVHUB_CRAWL_WORKER_ENABLED=1` 才会启动；通用定时任务开关 `NAVHUB_JOBS_ENABLED` 不会隐式开启它。

## 启用前检查

1. 先完成数据库迁移并确认 `crawl_sources`、`site_discovery_candidates` 表存在。
2. 先以少量、可信来源验证 sitemap/RSS/页面解析结果与候选去重。
3. 观察 SSRF 出站观测、来源错误率、候选增长量及人工审核队列。
4. 未完成抓取回归测试前，不要扩大来源数量或并发数。

## 当前限制（明确记录，不视为已完成）

- 当前失败后沿用来源的 `interval_ms` 重新调度；尚未实现按连续失败次数指数退避、死信队列和域名级速率限制。
- 页面模式目前只提取链接和页面级 title/description，不做正文抽取、站点分类或 AI 审核。
- Worker 不会自动批准或拒绝候选；AI 审核仍保持 Shadow/人工决策边界。
- 来源注册阶段的 DNS 检查不能代替请求时校验；任何新的抓取路径都不得绕过 `guardedFetch`。

## 回滚

将 `NAVHUB_CRAWL_WORKER_ENABLED` 设为 `0` 或移除该环境变量并重启 API。停止 Worker 不会删除来源或已收集候选。
