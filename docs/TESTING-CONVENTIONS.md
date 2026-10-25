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

## 4.5 pre-commit 钩子的选测口径（2026-10-25 起）

钩子不再「改一个文件就跑整棵目录」，而是**先收窄**：

1. 改动文件 → 测试根（`apps/api` → `apps/api/test`，`packages/store` → `packages/store/test`…）；
2. 在根内按**词干匹配**收窄：改动文件的文件名/父目录名（≥4 字符、非通用词）出现在测试文件名里就选中
   （`plugins` → `plugin`，复数已归一）；文件名没命中再看**测试内容**是否提到该词;
3. 都没命中就**回退整棵**——宁可多跑，不可漏跑（跨模块影响由 CI 全量兜底）；
4. 任何 `apps/web*/src` 改动都会**额外**跑全仓扫描门禁（`field-names`、`keyboard-activation`）。

实测：改 `apps/api/src/routes/backup.ts` 从 93 个测试文件降到 8 个（约 40 秒）。

| 环境变量 | 作用 |
|---|---|
| `NAVHUB_SKIP_PRECOMMIT=1` | 跳过全部检查（要在 commit message 里写明原因） |
| `NAVHUB_PRECOMMIT_SCOPE=all` | 强制全量（收窄失效），确认「跨模块没被改坏」时用 |
| `NAVHUB_PRECOMMIT_E2E=1` | 跑完 vitest 再跑**本次暂存的** Playwright 用例；没暂存 spec 就跳过 |
| `NAVHUB_PRECOMMIT_DRYRUN=1` | 只打印将运行哪些文件（`DRYRUN_FILES=[...]`），不真跑 |
| `NAVHUB_PRECOMMIT_FILES=a,b` | 覆盖「暂存集」，供自检注入（正常提交别设） |

选测器本身有测试：`scripts/precommit-select.test.ts` 固定了「改动 → 选中哪些文件」，
其中一条专门锁 `jobs.ts → 必须包含 backup-restore-job.test.ts`（复数归一回归）。
改选测逻辑后先跑它，别靠人肉核对。

**a11y 门禁的范围**：暂存了 `apps/web-overlay/src/**/*.tsx` 时，钩子会设
`NAVHUB_A11Y_SCOPE=<这些文件>`，`field-names` 只检查它们。

- 能这样收窄的理由：`field-names` 是**按文件独立**判定的（aria-label / `<label>` 关联 /
  FormField 上下文都在同文件内），只看子集不会漏判本次引入的问题；
- `keyboard-activation` **不收窄**：它有跨文件白名单一致性约束（「白名单每条必须还对应
  一处真实命中」），只看子集会把别人的白名单判成过期，制造假失败；
- 代价：**别人文件里既有的违规不会被我的提交发现**。那不是我引入的，CI 跑全量兜底。
  这条换的是「并行开发时不再互相阻塞」——本轮被对方的 `plugin-review-section.tsx:411`
  连挡两次，就是收窄前的常态。

钩子完整输出落盘在 `.git/navhub-precommit.log`。**失败要引用日志里的文件名与行号**，
不要只写「有 1 例失败」——上一轮就是这么丢掉线索的。

> 已知取舍：收窄只保证「名字相关」的测试会跑。改 `backup.ts` 却破坏了某个名字里没有
> `backup` 的用例时，钩子会放过它，由 CI 全量兜住。这是刻意换来的速度。

---

## 4.6 提交纪律：用 `scripts/safe-commit.mjs`（并行会话必读）

这个仓库长期有多个会话共用同一个工作区与 `.git`。已发生的两类事故都不报错、不留痕迹：

| 事故 | 后果 | 次数 |
|---|---|---|
| 对方 `git add -A && git commit` | 我的改动被卷入对方的提交，历史里找不到归属 | 3 |
| 我 `git add` 后、`commit` 前对方提交过 | 索引被动过 → 我的 commit 报「无暂存内容」，改动静默留在工作区 | 2 |

**约定：提交一律走脚本，不再手写 `git add + git commit`。**

```bash
node scripts/safe-commit.mjs --msg-file .commit-msg.txt -- <path...>
node scripts/safe-commit.mjs --msg-file .m.txt --dry-run -- <path...>   # 只看会提交什么
```

它做的事：

1. `git add -- <paths>`（只碰这些路径）；
2. **`git commit -F msg -- <paths>`** —— pathspec 形式，**索引里其他人的已暂存内容不会被带上**；
3. 提交后校验 `HEAD` 的文件集**恰好等于**本次有变更的路径；多出/缺少都以非 0 退出并打印文件名；
4. 顺手处理陈旧的 `.git/index.lock`（超过 2 分钟视为崩溃残留并移除——活锁会让 git 卡死，
   而原生报错完全不提锁是几小时前谁留下的）。

自检：`scripts/safe-commit.test.ts`（8 例），其中一条在临时仓库里真跑一次，
验证「索引里有别人暂存内容时只提交我的」。

**它解决不了的情况**：同一个文件里混着两个人的改动。那时要改设计绕开（例如把逻辑放到
调用方一侧），**不要**用切 hunk 的方式提交半个文件——半成品进历史更难收拾。

---

## 5. 提交前的成本预算

| 改动范围 | hook 选中的测试 | 耗时（收窄后实测） |
|---|---|---|
| 只改 docs | 无（SKIP） | ~30 秒（typecheck） |
| 改 `apps/api/src/routes/backup.ts` | 8 个 `backup-*.test.ts` | **~40 秒**（收窄前是整棵 93 文件 / 3 分钟） |
| 改 `packages/store/**` | `packages/store/test` | ~124 秒（未收窄时） |
| 改 `apps/web-overlay/src/app/admin/data/restore/page.tsx` | `restore-page-guard` + 两个全仓门禁 | ~5 秒 |
| 命中不了词干（如 `page.tsx` 在通用目录） | 回退整棵 | 同收窄前 |

> 上表是「收窄生效」时的样子。词干没命中就回退整棵，所以最坏情况仍等于收窄前。
> 想强制全量：`NAVHUB_PRECOMMIT_SCOPE=all`。

`package.json` / `tsconfig.base.json` / `vitest.config.ts` 在 `GLOBAL_FILES` 里，
改动它们会跑**全量**（~9 分钟）。为一行 npm 别名改 `package.json` 不划算。

> 注意：hook 跑测试时**读工作区文件**，因此会跑到其他并行会话未提交的改动。
> 红灯先归因再决定是否跳过；跳过一次要在 commit message 里写明红灯属于哪个文件、
> 以及本次自测通过了什么。
