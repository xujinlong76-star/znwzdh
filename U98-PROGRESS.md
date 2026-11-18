# U-98 修复线 — 检查点日志（第三次派单，续跑）

- 分支：`fix/u98-home-small-windows-count`
- 克隆：`~/workspace/znwzdh-u98-2026-11-18`（基底 main head `9dcef7f7`，工作区干净，0 提交）
- 证据目录：`~/workspace/u98-2026-11-18/`
- 目标：修复 `home-small-windows.test.ts` 在 `2f1dbfc1` 上新红（`expected 7 to be 5`）

## 定性计划（先读原文验证，不许猜）
1. 读测试原文 `apps/web-overlay/test/home-small-windows.test.ts`：确认计数对象（数什么、期望 5 写在哪一行、断言上下文）。
2. 读考试数据源 `exam-calendar.ts` 与今日区 `home-today-zone.tsx` / `my-exam-tracker.tsx`：核对峰值日包目标时刻数五项→七项→八项的演变，确认渲染数 7 的来源。
3. 交叉验证：603bbec2..2f1dbfc1 区间测试文件未改动（雷达已核实 diff）；9dcef7f7 的 CI 分片 1/3 与 2/3 failure 是否含同一失败用例。
4. 若定性为考试数据增长致期望滞后：把计数期望改为从同一数据源动态派生，绝不只把 5 改成 7 写死。
5. 若定性不符：停手报 ISSUES，不盲改。
6. 验证：定向测试全绿 + 前端 typecheck（`node scripts/check-frontend-typecheck.mjs`）通过；推送分支到 origin 并回读确认 head SHA。

## 约束
- 只推分支，不推 main；只改 U-98 定性指向的最小范围文件，不碰 E2E 规格与猫挂件文件。
- 每步落盘：更新本文件并单独提交（`NAVHUB_SKIP_PRECOMMIT=1`，提交信息写明跳过原因）。
- 旧克隆 `~/workspace/znwzdh-evolve` 只读参考，绝不在其上跑写操作。
- 遇 VM 间歇写故障（EPERM 成串）：停手等窗口过去再重试，不反复换方案。

## 进度
- [x] 2026-11-18 17:59 检查点 0：接单核实——分支 `fix/u98-home-small-windows-count`，head `9dcef7f7`，工作区干净，0 提交；证据目录新建；本文件首版落盘并提交（checkpoint）。
- [x] 2026-11-18 18:20 定性完成（证据 `~/workspace/u98-2026-11-18/DIAGNOSIS.md`）：根因 = U-144 考试数据增长致测试期望滞后，非产品回归。证据链：测试文件 `603bbec2..2f1dbfc1` 区间 0 改动（最近改动 `44394500`）；`034b43e9` 提交信息「今日行 11-18 5 项 -> 6 项」（江苏自考）、`c06c567d`「6 项 -> 7 项」（广东自考）；`todayNodes(2026-11-18)` 逐项枚举 7 项（京考报名 endsToday、文职缴费 endsToday、成考江西/广东/新疆成绩查询 today、江苏自考成绩查询 today、广东自考成绩查询 today），`urgentCount` 同为 7；失败本地复现 `expected 7 to be 5`（`apps/web/test/home-small-windows.test.ts:40`，1 failed / 5 passed，mirror 后跑）。CI 交叉：`2f1dbfc1` 分片 1/3、2/3 failure 与本用例位置吻合（雷达第 38 轮）。
- [ ] 修复：期望改为数据派生。
- [ ] 验证：定向测试 + 前端 typecheck 全绿。
- [ ] 推送：origin 分支推送 + 回读确认 head SHA。
