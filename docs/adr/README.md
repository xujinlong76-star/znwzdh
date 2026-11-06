# 架构决策记录（ADR）

> 本目录记录 NavHub 的架构决策与取舍。状态机：proposed / accepted / superseded。新增 ADR 用递增编号，历史 ADR 不回写。

| 编号 | 主题 | 状态 | 日期 |
|---|---|---|---|
| [0001](0001-lite-single-instance-constraint.md) | lite 模式明确单进程约束（多实例语义决策） | proposed | 2026-11-06 |
| [0002](0002-strip-types-production-runtime.md) | 生产以 Node 24 strip-types 直跑源码 | accepted | 2026-11-06 |
| [0003](0003-coverage-threshold-single-source.md) | 覆盖率阈值单一事实源与 W1→W9 ratchet | accepted | 2026-11-06 |

**对应方案条目**：0001 → P-5 / B-13（多实例语义无 ADR）；0002 → A-4；0003 → T-1。
