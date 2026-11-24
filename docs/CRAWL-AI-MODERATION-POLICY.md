# AI 采集审核规则配置

规则通过管理员接口持久化到 system_states，模型本身仍复用全局 AI 模型配置。

- GET `/api/admin/crawl-moderation/policy`：读取当前规则。
- PUT `/api/admin/crawl-moderation/policy`：保存规则并写入审计日志。
- 默认 `enabled=false`，默认不会产生模型调用费用。
- 当前 `mode` 仅允许 `shadow`，接口拒绝 `auto`，避免未完成金标评估和发布安全链路就自动上线。
- 支持自动通过置信度阈值、高风险拒绝置信度阈值、最低质量分、正文截断长度、每轮最大审核数和 HTTPS 要求。
- 系统每日 Token/调用额度继续复用现有 LLM quota；每轮审核数上限用于限制单次 Worker 批量费用。

自动通过阈值在 Shadow 中只生成建议，不会改变候选状态。