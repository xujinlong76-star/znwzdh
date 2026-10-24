# CI 合并门禁与分支保护清单

> 适用：`main` / `master`。目标只有一个——**任何关键作业红了，合并必须被挡住**。

---

## 1. 当前聚合关系（仓库内可验证）

`.github/workflows/ci.yml` 的 `ci-passed` 是唯一聚合闸门：

```
ci-passed (if: always())
├── test-sqlite        后端单测（SQLite）
├── test-postgres      跨方言（真实 PostgreSQL + pgvector）
├── test-web           前端 tsc / eslint / build
├── check-web-overlay  overlay 与 apps/web 字节级一致
├── check-isr-live     ISR 运行级检查
├── test-e2e           Playwright 全量
├── docker-smoke       镜像构建与启动
└── audit              依赖审计（高危）
```

评估脚本逐个读取 `needs.<job>.result`，**只有全部 `success` 才通过**（`skipped` / `cancelled` / `failure` 都算失败）。

离线自检：

```bash
pnpm check:ci-gate
# ✅ CI 合并门禁：ci-passed 聚合 8 个作业，逐个读取结果，PG 走 test:pg:suite。
```

该检查已接入 `pnpm verify`，也由 `apps/web/test/ci-gate.test.ts` 覆盖（含「删掉 test-postgres 必须变红」的反向用例）。

---

## 2. GitHub 分支保护设置（需在网页端操作）

本机没有 `gh` CLI，且分支保护配置不在仓库内，因此这一步必须手动完成并在团队内留痕。

1. 打开仓库 **Settings → Branches → Branch protection rules**。
2. 对 `main`（如使用 `master` 则同样处理）新增或编辑规则。
3. 勾选 **Require a pull request before merging**（建议至少 1 个 approve）。
4. 勾选 **Require status checks to pass before merging**。
5. 在搜索框里只添加这一项：

   ```
   CI 整体通过 (All Checks Passed)
   ```

   > 不要逐个勾选 `test-postgres` 等子作业：它们是 `ci-passed` 的依赖，
   > 逐个勾选会让「新增作业」时必须回来改配置，容易漏。

6. 建议勾选 **Require branches to be up to date before merging**（避免用旧基线的绿灯合并）。
7. 保存。

### 验收（必须做一次）

1. 从 `main` 切一个临时分支，故意让 PG 套件失败，例如在
   `packages/store/test/pg-dialect.e2e.test.ts` 里加一条 `expect(1).toBe(2)`。
2. 推送并开 PR，等待 CI。
3. 确认：
   - `test-postgres` 红；
   - `ci-passed` 红；
   - PR 的 Merge 按钮被禁用（提示 required status check 未通过）。
4. 删除该提交/分支，确认恢复绿。

没有做过第 3 步，「已配置分支保护」只是一句无法验证的声明。

---

## 3. 为什么这轮要专门校验

2026-10-24 用真实 PostgreSQL 18.4 跑跨方言套件时发现：

- `catId is not defined`（作用域错误）——CI 的 PG 作业**本来就会红**；
- 套件清理不删用户域表，本地第二次运行必红，只有 CI 的一次性库是绿的；
- 金库 CAS 用例把对象当 `userId` 传入，PG 直接报 `payload` 非空。

也就是说：**「聚合了 PG 作业」并不等于「PG 真的在保护合并」**。本轮同时修了套件本身
（见 `UPGRADE-EXECUTION-2026-10-24-PASS3.md`），并新增 `pnpm test:pg:suite`：
缺少 `NAVHUB_TEST_DATABASE_URL` 时直接退出 1，不再「整体 skip 后仍然绿灯」。
