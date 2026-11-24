# 真实搜索金标集导入与验收（v2）

本流程建立至少 100 条脱敏真实生产查询的搜索质量金标集。仓库提供 v2 数据契约、双盲标注校验、第三人仲裁、隐私检查和离线评测导出；**不会生成或伪造真实查询、相关性标签或人工标注记录**。

## 数据治理边界

- 查询必须来自真实生产搜索遥测的分层抽样，不能用模型合成查询冒充真实样本。
- 进入标注前必须完成脱敏和人工隐私复核；邮箱、中国手机号、常见国际电话、IPv4 和常见 API 访问令牌会被校验器拒绝。
- 不导出用户 ID、匿名 ID、邮箱、IP、Cookie、Token、设备标识或原始会话 ID。
- queryId 必须是随机生成的非身份关联编号，不得由 userId/anonId 哈希直接派生。
- 规范化（去首尾空白、折叠连续空白、忽略大小写）后的 queryText 必须唯一，避免重复查询虚增 100 条样本规模。
- 原始 JSONL 与导出 fixture 保存在受控存储中，不提交到 Git 仓库；CLI 的聚合报告不输出 queryText。
- 两名标注员必须独立、互不可见；重大分歧或不可判断项由第三人仲裁。
- 站点无法访问或证据不足必须标记 unjudgeable；未解决的样本不会被当作 0 分进入评测。

## v2 JSONL 数据契约

每行一个 JSON case，所有行必须使用同一 datasetVersion：

- schemaVersion：固定为 search-quality-golden-v2
- datasetVersion：不可变数据集版本号
- queryId：随机脱敏查询 ID，唯一
- queryText：脱敏后的真实查询，最多 240 字符
- locale / intent：语言区域与查询意图
- sampledAt：生产遥测抽样时间戳
- privacyReviewed：必须为 true
- snapshotId：冻结的搜索候选快照 ID
- candidates：按 baselineRank 记录冻结候选；每项包含 siteId、唯一 baselineRank、evidenceUrl
- annotations：恰好两份独立标注；annotatorId 不同，annotatedAt 为时间戳；judgments 必须覆盖所有候选，label 为 0–3 或 unjudgeable，rationaleCode 使用受控枚举
- adjudication：仅重大分歧/不可判断项需要；adjudicatorId 必须不同于两名标注员，记录 adjudicatedAt、rationale，并只仲裁争议候选

evidenceUrl 必须为 HTTP(S)，不得包含凭据、查询参数或片段。reasonCode 仅允许 exact_match / task_fit / category_fit / partial_fit / unrelated / unavailable / insufficient_evidence / safety_risk / other。unjudgeable 只能使用 unavailable 或 insufficient_evidence。

两名标注员等级相同则取该等级；相差 1 级时按较低分计，避免评测过度乐观；差距大于 1、单方/双方 unjudgeable 时必须第三人仲裁。仲裁后仍 unjudgeable 的整条查询样本会被排除，并计入 excludedUnjudgeableCases。zero_result 查询允许空候选快照和空 judgments。

## 执行

将经过隐私复核的 JSONL 放在访问受控的位置，然后执行：

```bash
pnpm validate:search-goldset --input /secure/path/search-goldset.jsonl --min-cases 100 --export /secure/path/search-eval.json
pnpm eval:search /secure/path/search-eval.json --json
```

- 默认要求至少 100 条可评估样本；不足、存在错误或存在待仲裁项时命令以非零状态退出。
- 输入文件上限 5MB、每行 256KB、最多 10000 条。
- 报告包含可评估样本按 intent 与 locale 的分布，便于发现只覆盖单一语言或意图的偏差；样本分层比例仍需按标注协议人工验收。
- --export 只在验收通过时写出 SearchEvalCase fixture；输出文件包含 queryText，必须继续保存在受控位置，并采用独占创建避免覆盖历史快照。
- 终端报告不包含原始 queryText，只输出数量、仲裁/错误计数和 NDCG@10 / MRR@10 / Recall@10。

## 当前完成状态

仓库已提供 v2 数据契约、隐私与证据校验、双盲/仲裁校验、JSONL CLI、评测导出和自动化测试；**真实 100 条查询、两名标注员实际标注及第三人仲裁尚待从生产遥测采样并由人工完成**。在受控数据文件导入且验收通过前，不得宣称已完成 100 条真实金标集。
