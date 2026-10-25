<!--
标题格式：<type>(<scope>): <subject>（Conventional Commits，见 docs/CODE-REVIEW.md §4）
必答项没有适用内容时写「不适用」，不要留空——空白无法区分「没想过」和「不需要」。
模板字段与审查清单是同一份，改这里要同步 docs/CODE-REVIEW.md 附录 B。
-->

## 变更摘要

<!-- 三句话以内：改了什么、为什么现在改、不改会怎样。写「为什么」，不要复述 diff。 -->

## 变更类型

- [ ] `feat` 新功能
- [ ] `fix` 缺陷修复
- [ ] `refactor` 重构（行为不变）
- [ ] `perf` 性能
- [ ] `test` 只改测试
- [ ] `docs` 只改文档
- [ ] `build` / `ci` 构建与流水线
- [ ] `chore` 杂项

## 影响域

- [ ] `apps/api`
- [ ] `packages/store`（含 SQL / 迁移）
- [ ] `packages/core` / `packages/ai` / `packages/mcp`
- [ ] `apps/web-overlay`（前端事实源）
- [ ] `scripts/`（门禁与工具脚本）
- [ ] `e2e/`
- [ ] `GLOBAL_FILES`（`package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `vitest.config.ts` / `tsconfig.base.json` / `types/`）
- [ ] 仅 `docs/` 或注释

## 测试证据

- [ ] 本地已跑 `pnpm verify`；若未跑，在下方写明跳过的原因
- [ ] 新增/修改的**守卫类**测试做过反向验证（`node scripts/verify-guard.mjs`：故意改坏源码，确认测试变红）
- [ ] 受影响的 E2E 用 `node scripts/e2e-local.mjs` 跑过（不是裸 `playwright test`，后者共用端口/库）
- [ ] PG 相关用例已标注「仅 CI 验证」

```
（贴 3–10 行关键输出，不要贴整段日志）
```

## 本仓特别字段（6 项必答）

1. **是否改动 `GLOBAL_FILES`？** 否 / 是：列出文件，并说明为什么不能拆成独立 PR
2. **是否含仅 CI 验证的 PG 用例？** 否 / 是：列出文件名（本地无 `NAVHUB_TEST_DATABASE_URL` 时 skip 是正常的）
3. **overlay 是否双镜像同步？** 不涉及 / 是：`pnpm check:overlay` 通过（贴一行输出）
4. **是否跳过 pre-commit？** 否 / 是：在 commit message 里补三行 footer（`Skip-Precommit` / `Skip-Precommit-Red` / `Skip-Precommit-Selftest`）
5. **暂存区是否已核对无他人文件？** 是：`node scripts/safe-commit.mjs --dry-run -- <path...>` 只列出本次路径
6. **新增 overlay 目录是否已登记 `@source`？** 不涉及 / 是：已加到 `apps/web-overlay/src/styles/globals.css`（漏登记 `tw-source-coverage.test.ts` 会红）

<details>
<summary>追加两项（改了 SQL 或新增测试时填）</summary>

7. **是否含双方言 SQL？** 否 / 是：差异点（占位符 `?` vs `$1`、`ON CONFLICT` 写法、`COUNT(DISTINCT)`、事务并发行为）
8. **新增测试的层级与实测成本？** 例：L1 ×5（~5 秒）+ L3 ×1（~12 秒）；依据见 `docs/TESTING-CONVENTIONS.md` §1

</details>

## 风险与回滚

- **风险等级**：低 / 中 / 高（高 = 合并前走 `docs/GATES-OPERATIONS.md` §6 的 Go/No-Go 清单）
- **回滚方式**：revert 本 PR 是否足够；若涉及迁移或数据写入，写清数据回滚步骤
- **迁移**：无 / 有 —— 是否可逆、执行顺序（migrate 必须先于 seed）、CWD 必须是仓库根

## 审查者核对

- [ ] 读过 diff 全文，不只看摘要与截图
- [ ] 在本地或 CI 上真的跑过受影响的测试，不是只看「绿灯」
- [ ] 断言检查的是行为或请求，不是源码文本、不是 toast 文案
- [ ] mock 路径带 `/api/hub` 前缀（写错会打到真实后端且看起来正常）
- [ ] 门禁脚本改动有自测，且**没有下调阈值**
- [ ] 迁移有回滚方案，且 migrate 在 seed 之前
- [ ] 生成物（`apps/web/src`、`apps/web/test`）没有被手改
- [ ] 严重度已标注（🔴 / 🟠 / 🟡 / ⚡），无未回复的 🔴

<!--
严重度判定：1 个 🔴 → request changes；🟠 累计 ≥3 → request changes；🟡/⚡ 不阻塞但要在合并前回复。
安全缺陷与「假绿门禁」永远是 🔴。细则见 docs/CODE-REVIEW.md §3.3。
-->
