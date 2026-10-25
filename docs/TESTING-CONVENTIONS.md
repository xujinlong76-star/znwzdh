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

钩子在检测到「没走脚本」（`GIT_INDEX_FILE` 未设）时会打一行提示，提醒本次提交可能带上
别人的暂存内容。它不是拦截——直接 `git commit` 在单人场景下完全正常。

---

## 4.7 行尾：`.mjs` 必须 LF（会被 vite 惩罚）

本机 `core.autocrlf=true`，默认会把 checkout 出来的文本文件转成 CRLF。对 `.ts` 无害
（走 esbuild），但**对 `.mjs` 致命**：

```
vite 加载 CRLF 的 .mjs →
  SyntaxError: Invalid or unexpected token     ← 不带行号
  指向 importer 而不是真凶
而 node --check 通过、esbuild transform 通过   ← 两种常规自检都发现不了
```

2026-10-25 实测踩到，为此花了近 20 分钟（报错完全不提行尾）。

三道防线：

| 层 | 机制 |
|---|---|
| checkout | `.gitattributes` 声明 `*.mjs text eol=lf`——clone 出来就是 LF |
| 本地门禁 | `check-syntax.mjs` 拒绝 CRLF 的 `.mjs`（默认扫 scripts、`--staged` 扫暂存、显式传参也查） |
| 修复工具 | `node scripts/fix-line-endings.mjs [files...]` 一键转 LF（无参数时修 scripts 下所有） |

`*` 只对 `.mjs`/`.mts` 声明 LF。**不要**顺手把 `*.ts` 也纳入——`.ts` 走 esbuild，
CRLF 无害，而全仓重写行尾会制造一场没人想 review 的 diff。

---

## 4.8 诊断与卫生工具（`scripts/` 下）

四个工具都是从「本轮踩了坑、下次不想再踩」里长出来的。用法尽量保持一条命令。

### `verify-guard.mjs` —— 守卫反向验证

**测试通过有两种可能**：规则真的成立，或断言根本没在检查东西。后者在本仓已发生多次
（选测器只改日志、`field-names` 主干一直红、钩子提示被条件短路）。判断方法只有一个：
**故意改坏源码，确认对应测试真的变红**。

```bash
node scripts/verify-guard.mjs \
  --file packages/store/src/search.ts \
  --from "        ftsMs," --to "        ftsMs: semanticMs," \
  --test packages/store/test/store.test.ts --grep "通道耗时" \
  --expect-output "不应包含 semantic 的等待"
```

| 结果 | 退出码 | 含义 |
|---|---|---|
| 测试失败 + 输出命中 `--expect-output` | 0 | 守卫有效 |
| 测试通过 | 2 | **空守卫**：改坏了都不红 |
| 测试失败但诊断串对不上 | 2 | 无法归因（可能是编译错误/别的用例挂了） |

`--expect-output` 不是可选项而是纪律：**没有它，「红了」可能与你改的那段无关**。
安全：`--file` 工作区有改动时拒绝执行（避免覆盖并行会话的改动），崩溃/Ctrl-C 都会还原。

破坏方式有两种，按守卫的形态选：

| 模式 | 用法 | 适合 |
|---|---|---|
| **替换**（默认） | `--from` / `--to` | 改坏一段已有的逻辑（如把 `ftsMs` 记成 `semanticMs`） |
| **追加** | `--append '<一行代码>'` | **新增**一个违规——给「扫全仓源码」型守卫用 |

`--append` 存在的理由很具体：`field-names`、`keyboard-activation` 这类守卫检查的是
「整个 src 里有没有违规」，破坏方式是**多出一个违规**而不是改掉某段逻辑，
`from`/`to` 表达不了。实测（往恢复页追加一个只有 placeholder 的 `<input>`）：

```bash
node scripts/verify-guard.mjs \
  --file apps/web-overlay/src/app/admin/data/restore/page.tsx \
  --append 'export const __a11yProbe = () => <input placeholder="仅用于反向验证" />;' \
  --test apps/web/test/field-names.test.ts \
  --expect-output "admin/data/restore/page.tsx"
```

两条约束：

1. 追加内容必须**自包含**（不新增 import）。否则测试会因编译错误而红，
   与你想验证的断言无关，`--expect-output` 会判成「无法归因」——这是设计如此。
2. `expectOutput` 要选**只在失败时出现**的串。上面用 `admin/data/restore/page.tsx`
   而不是断言消息里的「没有可访问名」——因为测试名就叫「0 处没有可访问名的控件」，
   那个词在通过时也会出现，失去区分力。

**一次跑完全部登记过的配方**：`npm run verify:guards`（读 `scripts/guard-recipes.json`）。

当前登记 5 条（每条都是「曾经失效过」或「失效后果严重且不易察觉」的）：

| 配方 | 破坏方式 | 守的是什么 |
|---|---|---|
| 通道耗时按各通道自身墙钟计量 | 替换 | 旧实现把整批 await 同值记给三通道 |
| 选测器复数归一（jobs → backup-restore-job） | 替换 | 阈值写错导致关键测试被漏跑 |
| field-names：新增的无名控件必须被抓住 | 追加 | 这条守卫曾长期失效（主干就有违规），修好后必须锁住 |
| keyboard-activation：只有鼠标能点的元素必须逐条登记 | 追加 | 键盘/读屏用户无法操作，且不报错 |
| duration_ms 必须只记执行耗时，不含排队等待 | 多段替换 | 把「排队等了多久」当成「跑了多久」，会去优化错的任务 |

三种破坏方式对应守卫的三种形态：

| 方式 | 用法 | 适合 |
|---|---|---|
| **替换** | `--from` / `--to` | 改坏一段已有的逻辑 |
| **追加** | `--append '<一行代码>'` | **新增**一个违规——「扫全仓源码」型守卫 |
| **多段替换** | `--patch <file.json>` | 需要同时改多处才能模拟出目标行为 |

多段的必要性：有些回归要同时改「SQL」与「调用参数」才等于目标行为。
例如模拟「`duration_ms` 含排队」：
`duration_ms = ?` 要改成 `duration_ms = ? - created_at`，**同时**参数要从 `durationMs`
换成 `now`——只改一处得到的是「参数传错」，不是「含排队」。patch 文件长这样：

```json
{ "replaces": [ { "from": "...", "to": "..." } ] }
```

> ⚠️ **片段书写与行尾无关**：本仓有 89 个 `.ts` 以 CRLF 存储。verify-guard 匹配前会
> 归一化行尾、替换后再转回原样，所以片段用 LF 写就行；还原也是字节级一致。
> 少了这一步，CRLF 文件上的片段永远匹配不上，而报错是「找不到片段」——
> 看起来像「源码被改了」，实际只是行尾不同。

配方只收「曾经失效过」或「失效后果严重且不易察觉」的守卫，每条都要跑一次测试，
所以清单要短。`scripts/guard-recipes.test.ts` 做**静态校验**（文件存在、`from` 恰好出现一次、
`expectOutput` 不过长），能在秒级发现「配方腐烂」——那和「守卫失效」是两件事，
只有 `verify:guards` 才能发现后者。

配方里的 `expectOutput` 有个坑：**vitest 会截断长断言消息**
（实测 `...to include 'apps/api/test/backup-restore-job.test…'`），
所以要给截断点之前的片段；给完整路径会永远匹配不上，表现为「无法归因」的假警报。
另外别选「测试名里也有的词」——那种词在通过时也出现，失去区分力。

### `clean-temp-probes.mjs` —— 清理探针残留

`mkdtempSync(join(tmpdir(), "navhub-xxx-"))` 的产物在测试被 kill / 探针忘删 / 进程崩溃时会残留。
2026-10-25 实测积到 **1116 个 / 1.4GB**（最早 6 天前）。

```bash
node scripts/clean-temp-probes.mjs                          # 只报告（默认）
node scripts/clean-temp-probes.mjs --apply                  # 真删
node scripts/clean-temp-probes.mjs --min-age-min 1440 --apply --force   # 只删 24h 前的
```

三条保护：

1. **默认 dry-run**，要删必须显式 `--apply`；
2. 只认 `navhub-` / `probe-` 前缀，**不碰 `tmp.*`**（无法证明归属）；
3. **存在 `--min-age-min` 内的「新鲜」目录时拒绝 `--apply`**——那是「有测试正在跑」的
   直接证据（实测：4 个 vitest 进程跑着时，同时存在 8~9 个 30 分钟内的目录）。
   确认无关要加 `--force`；
4. 目录里**含符号链接就整目录跳过**——本机有过 junction 递归删除清空源码的事故
   （2026-10-19，344 文件），宁可少清一个，不做赌博。

`--json` 给 `verify.mjs` 用（只输出一行摘要）：`pnpm verify` 开头会打一行
「临时目录残留 N 个 / X MB」。不设阈值的原因是「设了要么天天响、要么永远不响」，
而一行数字本身不吵。也**不放 CI**：容器用完即弃，不存在跨 job 累积，检查只会永远绿。

**前缀约定（新增代码必须遵守）**：任何 `mkdtempSync` 的前缀都要以 `navhub-` 开头。

```ts
// ✅ 清理工具认得
mkdtempSync(join(tmpdir(), "navhub-canon-"))
// ❌ 会变成永久垃圾
mkdtempSync(join(tmpdir(), "canon-"))
```

2026-10-25 全仓扫过一遍：125 处 `mkdtempSync` 里有 2 处是 `overlay-drift-` 与
`walk-copy-`（已统一）。这两个的残留永远不会被认领——**这是唯一需要人工守的规则**，
因为工具无法从名字猜出「一个 `tmp.abc123` 是谁建的」。

### 其余两个

| 工具 | 用途 |
|---|---|
| `explain.mjs` | 一条 SQL 的查询计划 + 耗时 + `--try-index` 前后对照。排查「加了索引就快了但不知道为什么」时用 |
| `fix-line-endings.mjs` | 把文件转 LF（见 §4.7） |

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

### `pnpm verify` 的两档

| 命令 | 内容 | 实测耗时 |
|---|---|---|
| `pnpm verify` | 语法/覆盖层/CI 门禁/core 镜像/扩展/lint/typecheck/首屏预算 | 405s |
| `pnpm verify:full` | 上述 + **全量测试**（397 个文件） | **745s（12.4 分钟）** |

全量基线（2026-10-25，机器有并行负载时）：
**396 个文件通过 / 1 个跳过，4192 例通过 / 28 例跳过 / 0 失败**。
这个数字是「之后任何新假红」的对照组——全量第一次跑完就是全绿。

**为什么要拆**：最初实测全量测试跑到 22 分 38 秒仍未结束，
结果就是「没人跑 `pnpm verify`」——那等于全量门禁不存在，比跑得慢更糟。
拆开后默认档给出可信结论，全量档留给专门安排时间的场合。
（后来的实测是 745s = 12.4 分钟跑完，差别来自机器负载——**这也是「不能并行跑」的原因**。）

两条纪律：

1. **全量档不能与其它任务并行**。机器满载会让墙钟型断言假红
   （已实测：`backup-restore-job` 的耗时用例在并发下误报）。
2. **默认档也会打印每一步耗时**。不打印的话「哪一步慢」只能靠猜——
   拆两档时我预估默认档 1–2 分钟，实测 405 秒，差 3 倍，
   而真正的大头根本不是 typecheck（只占 20 秒）。

`pnpm verify:all` = `verify --full` + lint + playwright，语义不变（仍然含全量）。

`package.json` / `tsconfig.base.json` / `vitest.config.ts` 在 `GLOBAL_FILES` 里，
改动它们会跑**全量**（~9 分钟）。为一行 npm 别名改 `package.json` 不划算。

> 注意：hook 跑测试时**读工作区文件**，因此会跑到其他并行会话未提交的改动。
> 红灯先归因再决定是否跳过；跳过一次要在 commit message 里写明红灯属于哪个文件、
> 以及本次自测通过了什么。
