# 测试分层约定

> 目的：同一个事实只用**一层**测试钉住，避免「守卫 + E2E 各写一遍」的重复投入，
> 也避免「用守卫测行为」这种永远绿、抓不到 bug 的假保护。
> 下面的成本都是本机实测，不是估计。

## 1. 四层与成本

| 层 | 形态 | 一次耗时 | 能抓什么 |
|---|---|---|---|
| L1 源码守卫 | vitest 读文件、正则/包含断言 | **1–5 秒** | 「某段代码还在不在」：端点参数、关键分支、顺序 |
| L2 纯函数单测 | 直接 import 纯逻辑 | **1–10 秒** | 解析、筛选、归一、状态机；边界与缺省值 |
| L3 集成 | `buildServer` + `app.inject` + 临时库 | **10–30 秒** | 状态码、事务回滚、审计落库、跨模块接线 |
| L4 E2E | Playwright + 整套 dev 栈 | **2–4 分钟** | 真实渲染、表单交互、路由跳转、按需加载 |

L4 还有额外固定成本：需要独占端口（`scripts/e2e-local.mjs` 自动挑）、独占 E2E 库
（`data/e2e/navhub-e2e.db`，句柄释放可能滞后 6 秒）、首次编译可能超 120 秒。

## 2. 选择规则

按「这个事实是什么形态」选，不按「重不重要」选：

- **字符串级事实**（某处传了 `dryRun=false`、某分支存在）→ **L1**
- **纯逻辑**（URL 归一、分类归属、筛选条件）→ **L2**
- **端点契约**（409 的 `reason`、整体回滚、审计写入）→ **L3**
- **必须跑起来才知道**（React 渲染、Radix 弹层、表单校验时序）→ **L4**

反例（本仓都出现过）：

| 反面模式 | 后果 |
|---|---|
| 用 L4 验「代码里有这个参数」 | 3 分钟跑一次，改个注释就可能红/绿漂移 |
| 用 L1 验「点按钮会发请求」 | 断言的是源码文本，行为坏了照样绿 |
| 只写 L4 不写 L1 | CI 慢，失败时定位到「整个页面」而非「哪行契约」 |

## 3. 什么时候值得双层

同一缺陷两层都写，只在**一层抓不住另一层的失效**时才成立。实例（2026-10-24）：

`/admin/sitelist` 的「自动抓取覆盖用户输入」：

- **L4（1 例 E2E）**：抓出缺陷本身——只有真跑一遍表单才会发现输入框被清空；
- **L1（5 例守卫）**：钉住修复后的三条不变量（自动抓取传 `forceUpdate=false`、
  空值不覆盖、空结果不宣称成功），因为 E2E 太慢、不适合每次提交都跑。

判断标准：**若 L1 的断言能在 L4 失败时也失败，就不需要 L1**。
上例中 L4 无法在 CI 每次提交跑，所以 L1 是「高频期的替身」。

## 4. 本仓的具体约定

1. **overlay 测试的事实源在 `apps/web-overlay/test/`**，需 `cp` 镜像到 `apps/web/test/`
   （两份都提交，`check-web-overlay` 会校验一致性）。
2. **新增 overlay 目录必须登记 `@source`**：`apps/web-overlay/src/styles/globals.css`。
   vendored 的 `src/**` 被 `.gitignore` 忽略，Tailwind 自动检测会跳过；漏登记时
   `tw-source-coverage.test.ts` 会红（本轮被拦过一次）。
3. **全仓门禁对新增页面直接生效**：`field-names`（表单控件可访问名）、
   `nested-interactive`、`keyboard-activation`、`a11y-contrast`、`design-system`。
   新页面写完先跑这几个，比等 CI 快得多：
   ```bash
   node node_modules/vitest/vitest.mjs run apps/web/test/field-names.test.ts apps/web/test/nested-interactive.test.ts
   ```
4. **源码守卫要排除注释**。写 `not.toContain("updates.name = metadata.title")` 会被
   「注释里引用了旧代码」顶掉，用行首锚定的正则：
   ```ts
   expect(SRC).not.toMatch(/^\s*updates\.name = metadata\.title/m)
   ```
5. **E2E 断言「发了什么」，不断言「显示了什么」**。写路径的事实在请求体里；
   toast 文案有两份 DOM（可见 + `aria-live`），`getByText` 会 strict 冲突，用 `.first()`。
6. **mock 路径必须带 `/api/hub` 前缀**。

   前端不是直接打 `/api/xxx`：`hubUrl()` 会把 `/api/backup/restore` 归一成
   `/api/hub/backup/restore`（`BASE = '/api/hub'`）。所以

   ```ts
   // ❌ 不匹配：请求打到真实后端，测试变成「在真实环境里跑操作」
   await page.route('**/api/backup/restore**', handler)
   // ✅
   await page.route('**/api/hub/backup/restore**', handler)
   ```

   写错的后果比「测试挂掉」严重得多：请求真的执行了，而**真实响应往往和 mock
   文案一模一样**（因为 mock 就是照着后端文案写的）。表现是页面「看起来正常」，
   只有某个数字不对（本轮实测：耗时显示 `0.0s` 而 mock 返回 1234 才暴露）。
   这类假绿会让人以为 mock 生效，实际在污染数据。

   自查手段：在 handler 里 `console.log`，或断言「本用例应产生 N 次调用」。
7. **PG 用例本地 skip 是正常的**（无 `NAVHUB_TEST_DATABASE_URL`），由 CI 的
   test-postgres 作业执行。新增 PG 用例时在 PR 描述里注明「仅 CI 验证」。
8. **`setInputFiles` 必须重试**：它只是给 input 赋值并派发 change，**React 还没 hydrate
   时没有监听器接收**——文件"选上了"、页面毫无反应，而且**不报错**，等到断言文件名
   时才超时，报错完全指不到 hydration。写成"设值 → 等结果 → 失败再设一次（≤5 次）"。
   登录流程越快（复用 `loginViaAdmin` 后），这个窗口越容易撞上。
9. **并发会话的 E2E 必须隔离三样**：端口、Next 输出目录、数据库文件。
   只隔离端口不够——两个进程会重置同一个 `data/e2e/navhub-e2e.db`，
   后启动的删掉先启动的库，表现为「API 异常退出、用例成片红」，报错看不到真正的冲突方。
   `node scripts/e2e-local.mjs` 默认已隔离全部三项（可用 `NAVHUB_E2E_DIST_DIR` /
   `NAVHUB_E2E_DB_PATH` / `NAVHUB_E2E_SERVER_TIMEOUT` 覆盖）；直接跑 `playwright test`
   仍是共用配置，多会话时不要用它。
10. **内存不够会让 Next dev 直接崩**（退出码 `3221226505` / `2147483651`），
    报错是 `Timed out waiting ... webServer`，看起来像启动慢。本机同时跑两套 E2E
    基本必崩：先确认没有别人的 Playwright 在跑（`Win32_Process` 里看命令行），再启动。

## 5. 提交前的成本预算

| 改动范围 | hook 选中的测试 | 耗时 |
|---|---|---|
| 只改 docs | 无（SKIP） | ~30 秒（typecheck） |
| 改 `packages/store/**` | `packages/store/test` | ~124 秒 |
| 改 `apps/api/**` | `apps/api/test` | ~3 分钟 |
| 改 `apps/web-overlay/**` | `apps/web/test` | ~2.5 分钟 |
| 同时改 api + overlay | 两棵 | **~5–6 分钟** |

`package.json` / `tsconfig.base.json` / `vitest.config.ts` 在 `GLOBAL_FILES` 里，
改动它们会跑**全量**（~9 分钟）。为一行 npm 别名改 `package.json` 不划算。

> 注意：hook 跑测试时**读工作区文件**，因此会跑到其他并行会话未提交的改动。
> 红灯先归因再决定是否跳过；跳过一次要在 commit message 里写明红灯属于哪个文件、
> 以及本次自测通过了什么。
