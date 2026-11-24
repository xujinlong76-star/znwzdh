# Durable crawl governance foundation

本次把 VNext 采集策略推进到数据库持久化层，SQLite / PostgreSQL 共用一套 Repository API。

## 数据模型

- `crawl_tasks`：规范 URL 唯一键、来源、优先级、有限重试次数、计划运行时间、租约 owner/expiry、最终状态。
- `crawl_domain_state`：每个 host 的下次允许启动时间与当前租约任务，跨实例共享域名频控状态。
- `crawl_page_fingerprints`：页面内容 hash、SimHash64、语言、站点关联和抓取时间。

## 并发与恢复语义

1. `enqueueCrawlTask` 对规范化 URL 幂等；已经完成、死信或人工挂起的任务不会被重复发现自动复活。
2. `claimCrawlTask` 在事务中认领；PostgreSQL 使用 `FOR UPDATE SKIP LOCKED` 和域名状态行锁，SQLite 使用 Repository 的串行写事务。
3. 每个 host 同时只有一个未过期租约，并受 `minDomainIntervalMs` 控制；一个域名被限速不会阻塞其他域名。
4. `renewCrawlLease`、`settleCrawlTask` 使用 task id + worker owner + 状态 CAS，旧 Worker 不能覆盖新 Worker 的结果。
5. `reapExpiredCrawlLeases` 回收崩溃 Worker 的租约；重试额度耗尽后进入 `dead_letter`，不无限重试。
6. 指纹通过规范 URL upsert，后续可用于近重复扫描与站点内容变更检测。

## 安全边界

队列只负责调度与状态持久化，不直接发起网络请求。真正执行抓取的 Worker **必须**在每次请求及每次重定向时调用项目已有的 SSRF guarded-fetch 能力，重新做 DNS/IP/端口校验，并遵守 robots.txt、站点速率限制、认证和付费墙边界。不得把“已进入队列”理解为 URL 已通过网络安全校验。

## 尚未在本阶段完成

- 采集来源（sitemap / RSS / curated seed）的定时发现与解析 Worker。
- Worker 对 guarded-fetch、正文抽取、SimHash 计算和指纹写入的端到端接线。
- 死信/人工复核后台页面、申诉和回滚流程。
- PostgreSQL 并发集成测试及真实部署数据库迁移演练。

本阶段不伪造已抓取数据，也不自动把采集候选发布到正式导航目录。
