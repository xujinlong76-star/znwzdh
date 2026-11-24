# 真实搜索金标集导入与验收

本流程用于建立至少 100 条脱敏真实生产查询的搜索质量金标集。它只提供数据契约、校验和评测导出工具；**不会生成或伪造真实查询、相关性标签或双人标注记录**。

## 数据治理边界

- 查询必须来自真实生产搜索遥测的分层抽样，不能用模型合成查询冒充真实样本。
- 进入标注前必须完成脱敏和人工隐私复核；邮箱、手机号、IPv4 等明显个人信息会被校验器拒绝。
- 不导出用户 ID、匿名 ID、邮箱、IP、Cookie、Token、设备标识或原始会话 ID。
- sampleId 必须是随机生成的非身份关联编号，不得由 userId/anonId 哈希直接派生。
- 规范化（去首尾空白、折叠连续空白、忽略大小写）后的 query 必须唯一，防止重复查询虚增 100 条样本规模。
- 原始查询与标注文件保存在受控存储中，不提交到 Git 仓库；评测报告只输出数量、指标和行号，不输出查询文本。
- 两名标注员必须独立、互不可见；重大分歧或不可判断项由第三人仲裁。
- 站点无法访问或证据不足必须标记 unjudgeable；未解决的样本不会被当作 0 分进入评测。

## 输入 JSON 契约

顶层字段：

- schema：固定为 navhub-search-gold-v1
- deidentified：必须为 true
- source：固定为 production_search_telemetry
- cases：查询样本数组

每条 case 必须包含：

- id、sampleId：随机、不含身份信息的唯一编号
- sampledAt：ISO 时间
- query：已脱敏查询，最多 240 字符
- locale：如 zh-CN、en-US、mixed
- intent：exact_site / task / category / pinyin / mixed_language / zero_result / ambiguous / long_tail / other
- privacyReviewed：必须为 true
- hits：冻结候选快照的 siteId 列表，按实际搜索名次排序
- annotations：恰好两份独立标注；annotatorId 不同，independent=true；judgments 必须覆盖 hits 中全部 siteId
- adjudication：仅当重大分歧/不可判断项出现时需要；reviewerId 必须不同于两名标注员，judgments 只覆盖待仲裁的 siteId

相关性等级为 0–3；unjudgeable 不是 0 分。两名标注员分差为 1 时，导出采用较低等级，避免评测过度乐观；分差大于 1、任何一方标记 unjudgeable 或双方均无法判断时，必须由第三人仲裁。仲裁后仍 unjudgeable 的整条查询样本会被排除，并计入 excludedUnjudgeableCases。

## 执行

将经过隐私复核的 JSON 放在访问受控的位置，然后执行：

```bash
pnpm validate:search-goldset /secure/path/search-goldset.json --min-cases 100 --export /secure/path/search-eval.json
pnpm eval:search /secure/path/search-eval.json --json
```

- 默认要求至少 100 条可评估样本；不足时命令以非零状态退出。
- --export 只在达到最小样本数时写出 SearchEvalCase fixture；输出文件包含查询文本，必须继续保存在受控位置。
- 导出文件使用独占创建（已存在时拒绝覆盖），避免误覆盖历史评测快照。
- 终端报告不包含原始 query，只包含样本数量、不可判断排除数和 NDCG@10 / MRR@10 / Recall@10。
- 每次评测应冻结同一候选快照和排序版本；变更搜索排序时，用同一金标文件进行基线/候选版本对比。

## 当前完成状态

仓库已提供双盲金标数据校验函数、测试和 CLI；**真实 100 条查询、两名标注员实际标注、第三人仲裁尚待从生产遥测采样并由人工完成**。在受控数据文件导入且验收通过前，不得宣称已完成 100 条真实金标集。
