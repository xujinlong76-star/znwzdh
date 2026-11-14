# api 侧静默 catch 排查说明（2026-11-15，升级第 13 条）

## 背景

2026-11-15 之前，`apps/api/src` 有 86 处 `.catch(() => undefined/null/false/0)`
与空 `catch {}`，失败静默丢失，无任何日志与理由。本次逐处处理后全部有
交代，并立了守卫 `apps/api/test/silent-catch-guard.test.ts`（规则与 web 侧
`silent-catch.test.ts` 相同）：以后再出现没写理由的空 catch 即红灯。

## 会出日志的失败（真失败，不许只写注释）

走 `console.warn` + `[navhub-...]` 标签，日志在部署后的 stdout 里查
（`grep "navhub-job" / "navhub-brief"`）：

| 日志 | 触发条件 | 后续行为 |
|---|---|---|
| `[navhub-job] 每日简报：热榜刷新失败，用现有缓存组版` | 每日简报任务的热榜刷新抛错 | 用现有缓存如实组版；源状态标在简报页面上 |
| `[navhub-brief] 开场白生成失败，走模板开场白` | 简报开场白 AI 调用抛错 | 走模板开场白；`openingMode` 记为 `template`，可在简报记录里查 |
| `[navhub-job] 排期检查失败，下一周期重试:` | 调度 tick 里的排期检查抛错 | 下一周期重试；不拖垮 worker |
| `[navhub-job] 过期任务回收失败，下一周期重试:` | 调度 tick 里的过期任务回收抛错 | 下一周期重试 |
| `[navhub-job] 任务心跳失败，锁可能已过期` | 任务执行中心跳写库抛错 | 继续跑，下个心跳再试；若锁真被夺走，心跳状态会触发中止 |

## 只写理由、不记日志的失败（登记在守卫 ALLOW_LIST）

四类，理由原文写在 catch 块里，守卫逐项核对登记是否还在：

- **审计/遥测写库**（`recordEvent` / `audit` / `bumpVisit` / `touchApiToken`）：
  不阻断主操作，写失败即丢弃。主操作已经成功，丢的只是一条审计/遥测记录。
- **尽力而为的附带操作**（清理临时文件、向量清理、标签同步、向量回填、
  预热、过期清理）：失败不影响主流程，下次运行会再试或由整包导入补齐。
- **可选读取**（`stat` / `getSite` / `getUserSettings` / `getSystemState` /
  `countVideoItems`）：读不到按缺省值（`null` / `false` / `0`）处理，
  调用方已处理空值。
- **失败已在主链路处理**（任务执行体 `execution.finally(settleRun)`、
  热榜 inflight 清理）：这里只防第二个未处理 rejection，不再记第二遍日志。

## 排查路径

- 简报没出 / 开场白变模板：先看 `[navhub-brief]` 与 `[navhub-job] 每日简报`
  两条日志，再查 `daily_brief` 事件的 `openingMode`。
- 热榜停更：看 `[navhub-job] 每日简报` 与各源的 `markHotlistSourceFailed`
  记录（热榜刷新任务内）；源状态在热榜页面上可见。
- 任务长时间跑不完 / 并发执行：看 `[navhub-job] 任务心跳失败` 是否连续出现；
  心跳失败只告警不停手，锁被夺走时心跳状态会让 handler 在下一边界停。
- 新增一处“可以吞”时：先在代码块里写清理由，再把（文件，理由原文）
  登记进守卫的 `ALLOW_LIST`；只写注释不登记，或只登记不写注释，都算没过。
