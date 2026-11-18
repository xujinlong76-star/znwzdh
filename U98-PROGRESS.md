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
- [ ] 定性：读测试原文 + 考试数据源，根因写清。
- [ ] 修复：期望改为数据派生。
- [ ] 验证：定向测试 + 前端 typecheck 全绿。
- [ ] 推送：origin 分支推送 + 回读确认 head SHA。
