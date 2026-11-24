# 采集来源 Worker 运行边界

## 当前实现

- Worker 只认领已启用且到期的来源；认领由数据库租约完成，避免多实例同时处理同一来源。
- 单轮默认最多认领 5 个来源，轮询间隔 60 秒；同一进程不允许轮次重入。
- sitemap、RSS/Atom、普通页面分别解析 `loc`、条目级 `link/guid + title/description`、`a[href] + anchor text`，每个来源最多产生 100 个去重候选；候选元数据只绑定对应条目/链接，不把来源页的标题误当成候选站点标题。
- 来源请求必须通过 `@navhub/ai` 的 `guardedFetch`，超时 8 秒、响应体上限 1 MiB、最多 3 次重定向；逐跳 DNS/IP 校验由 SSRF 层负责。
- 解析阶段不对候选链接发起第二次网络请求。候选进入待审核队列；若管理端显式启用 AI 审核策略，Worker 可调用已配置模型生成 Shadow 评估并写入追加式决策账本，但不修改候选状态、不自动发布。
- Worker 默认关闭。只有明确设置 `NAVHUB_CRAWL_SOURCE_WORKER_ENABLED=1` 才会启动；通用定时任务开关 `NAVHUB_JOBS_ENABLED` 不会隐式开启它。

## 启用前检查

1. 先完成数据库迁移并确认 `crawl_sources`、`site_discovery_candidates` 表存在。
2. 先以少量、可信来源验证 sitemap/RSS/页面解析结果与候选去重。
3. 观察 SSRF 出站观测、来源错误率、候选增长量及人工审核队列。
4. 未完成抓取回归测试前，不要扩大来源数量或并发数。

## 当前限制（明确记录，不视为已完成）

- 失败按连续次数指数退避：首次 5 分钟、之后每次翻倍，最长 24 小时；成功后计数清零并恢复来源配置的 `interval_ms`。
- 同一 host 使用数据库表 `crawl_domain_state` 共享租约，跨进程/实例最多一个抓取者；释放后保留 15 秒最小请求间隔。域名繁忙的来源延后 15 秒，不计入失败次数。
- 简化来源轮询器没有死信队列；持久化 JobRunner 模式已有任务级 dead-letter / hold-for-review 和 Retry-After 退避。两种模式均尚无按响应状态自适应的令牌桶/熔断策略。
- AI 审核必须由管理员在 `/api/admin/crawl-moderation/policy` 显式启用；默认关闭，且策略模式被限制为 `shadow`。每轮审核数受 `maxAiReviewsPerRun` 限制，成功结果 24 小时内不重复计费；任何 AI 结论都不会自动批准或驳回候选。
- 简化来源轮询器只提取来源文档中的链接和条目元数据；持久化 JobRunner 模式会进一步抓取候选页面正文并生成内容指纹。模型未配置、额度不足或审核异常时，候选仍保持 pending。
- Worker 不会自动批准或拒绝候选；AI 审核仍保持 Shadow/人工决策边界。
- 来源注册阶段的 DNS 检查不能代替请求时校验；任何新的抓取路径都不得绕过 `guardedFetch`。


## 推荐生产模式：持久化 JobRunner 采集队列

- 设置 `NAVHUB_CRAWL_WORKER_ENABLED=true`，并保持 `NAVHUB_JOBS_ENABLED` 开启；JobRunner 每 5 分钟调度一次 `crawl_worker`，默认单轮最多 10 个任务（任务上限 25）。
- 可通过 `NAVHUB_CRAWL_SEEDS` 提供 JSON 数组种子：字符串默认按普通网页处理，也可用 `{"url":"https://example.org/feed.xml","kind":"rss"}` 指定 `sitemap` / `rss` / `page`。
- 来源注册表到期项会先进入持久化 `crawl_tasks` 队列；任务使用数据库租约、域名间隔控制、有限重试、过期租约回收和 dead-letter / hold-for-review 状态。
- 每个任务先检查 `robots.txt`；规则解析按 User-agent 专属组、最长匹配和 Allow 同长优先处理。robots 不可安全确认时 fail-closed；跨 origin 重定向后再次检查目标站 robots。
- 页面请求统一经过 `guardedFetch`：10 秒超时、512 KiB 响应上限、最多 5 次重定向。对 429/5xx 等暂时错误读取 `Retry-After`，不提前于上游建议时间重试。
- 页面正文会清理脚本/样式等非正文标记，生成 SHA-256 与 SimHash 指纹；近重复结果只作为审核证据，不自动隐藏或合并候选。
- AI Shadow 审核可使用页面标题、描述和截断正文；模型结果追加写入审核账本及候选 evidence，不改变 pending 状态、不自动发布。模型额度不足或失败时保留候选并记录状态。

## 两种 Worker 开关不要混用

- `NAVHUB_CRAWL_WORKER_ENABLED=true`：推荐的持久化任务队列模式，依赖 JobRunner。
- `NAVHUB_CRAWL_SOURCE_WORKER_ENABLED=1`：简化来源轮询器，只解析来源文档并写入候选，不抓取候选页正文；仅用于兼容/诊断。
- 生产环境优先启用持久化任务队列模式。不要同时开启两种模式，以免同一来源在不同流程间轮流被认领，增加排障复杂度。


## 回滚

将 `NAVHUB_CRAWL_SOURCE_WORKER_ENABLED` 设为 `0` 或移除该环境变量并重启 API。停止 Worker 不会删除来源或已收集候选。
