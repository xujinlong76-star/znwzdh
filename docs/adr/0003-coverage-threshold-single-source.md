# ADR-0003 · 覆盖率阈值单一事实源与 W1→W9 ratchet

- **状态**：accepted（2026-11-06；本会话落地 W1）
- **背景**：docs/TESTING-STRATEGY.md 标「现行」并写 W1（11/03–11/14）「CI 硬门禁上线」、coverage-thresholds.json 是单一事实源、§3.5 宣称 --thresholds/--patch/--require-covered-new/--max-age/::error:: 五个能力「已实现」。但 2026-11-06 扫描实测：ci.yml 全文 0 处 --coverage/check-coverage；coverage-thresholds.json 不存在；check-coverage.mjs 只支持 --max-lines/--max-functions/--json/--zero；根 pnpm coverage 无参只打印 exit 0。**比「没有门禁」更危险的是「以为有」**。
- **本会话落地**：① W0 全量实测基线（641 文件 / 7,235 用例；lines 85.68% / functions 86.35% / branches 71.68%；apps/api 82.72% / store 90.33% / core 87.38% / ai 80.51% / mcp 85.38%）；② coverage-thresholds.json（stage=W1，全局与 5 个分区域 floor = 基线 − 2pp；patch.enabled / requireCoveredNew.enabled 为 false，与路线图 W3/W5 对齐）；③ check-coverage.mjs 补 --thresholds（全局 + 分区域 floor，逐条 ::error::）、--max-age（防 clean:false 陈旧产物假绿）；④ pnpm coverage 与 CI coverage job 都切到该单一事实源（CI job 由并行会话建立，本会话把硬编码 --max-lines 84 改为 --thresholds coverage-thresholds.json --max-age 60）；⑤ 文档 §3.3/§3.5/§3.6 同步为实测状态。
- **决策**：阈值**不写**在 YAML / package.json / 文档里，只写 coverage-thresholds.json。收紧必须走**独立 PR**（只改那一份文件），禁止在功能 PR 里顺手调低；--patch / --require-covered-new 按 W3/W5 分批上线，不一次全开（一刀切会让门禁第一天就红，第一反应是加 continue-on-error，门禁从此失效）。
- **为什么不用 vitest 原生 coverage.thresholds**：它只支持全局 + glob，覆盖不了 patch 改动行覆盖与新增零覆盖文件拦截，且两套阈值会打架。
- **验收**：W1 达标 exit=0；抬高阈值消融 exit=1 且逐条 error 注解；陈旧产物 exit=2；check-ci-gate / check-gates-registry 全绿。
- **后果**：接受「每两周一次独立 ratchet PR」的流程成本，换取阈值不可悄悄漂移；W3/W5/W7/W9 的收紧节奏由文档路线图固定。
