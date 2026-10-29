# 门禁集成与运维（现行）

> 状态：**现行**。
> 本文管「检查放哪一层、改了 CI 要动哪几处、红了怎么查、发版前查什么」。
> 审查流程见 [`CODE-REVIEW.md`](CODE-REVIEW.md)；测试准入准出与覆盖率见 [`TESTING-STRATEGY.md`](TESTING-STRATEGY.md)；
> 分支保护的网页端操作与验收见 [`CI-BRANCH-PROTECTION.md`](CI-BRANCH-PROTECTION.md)。

---

## 1. 分层接入表

原则：秒级检查左移到 `pre-commit`，分钟级进 `pnpm verify`，需要干净环境 / 构建产物 / 服务容器的进 CI；同一检查只在一层「硬」，其他层只提示。

| 检查 | 落点 | 理由 | 耗时 |
|---|---|---|---|
| 提交信息规范（Conventional Commits） | **`commit-msg` 钩子**（由 `scripts/install-git-hooks.mjs` 生成） | 原始 message 只有本地拿得到；CI 看到的是 PR 标题/压缩后信息，拦不住 | <1s |
| 跳钩子三行声明 | **`commit-msg` 钩子**（同一入口） | 与上一条同源，一次解析 | <1s |
| 覆盖率门禁 | **CI `test-sqlite`**（判定）；`pnpm verify` 只出数 | 覆盖率必须基于全量测试；pre-commit 是暂存区子集，算覆盖率是假数字 | 见 §4 |
| PR 模板必填校验 | 阶段 1：只落模板（零 CI 改动）；阶段 2（可选）：`pr-hygiene` 作业读 `github.event.pull_request.body` | 先看两周遵守率再上硬门禁 | 0s / <1min |
| 锁文件一致性 | 已有 `pnpm install --frozen-lockfile` | 无需新增 | — |
| overlay 双镜像 / 扩展 / 上游 ref / 语法 / typecheck / 选测 | 已有 `pre-commit` | 已在跑，保持 | 30s–6min |
| 全量测试 + 7 项门禁 | 已有 `pnpm verify` | 已在跑，保持 | 见 §4 |

---

## 2. 改 CI 的「五处联动」+ 第 6 处文档

> **适用范围（重要）**：只在**新增 / 删除 / 改名 CI 作业**时全套适用。
> 改既有作业的 `steps`（例如给 `test-sqlite` 加覆盖率）**不碰聚合闸门**，只需同步 timeout 与文档。

新增作业时按序完成：

1. `ci.yml`：作业定义本身（`timeout-minutes` / `runs-on` / `steps`）。
2. `ci.yml`：`ci-passed.needs` 数组加入作业名。
3. `ci.yml`：`ci-passed` 评估脚本加 `[ "${{ needs.<job>.result }}" != "success" ] ||` 分支 + 一行 `echo` 结果。
   （只加 `needs` 不加读取 = 该作业失败被静默忽略，`check-ci-gate.mjs` 第 2 项校验的正是这个。）
4. `scripts/gates.json`：给新作业加一条 `when: "ci"` 登记（`blocks` = 它红了该不该拦合并）。
   `check-ci-gate.mjs` 已改为动态解析 `jobs:`，不再维护硬编码清单；但清单里查不到的作业
   会被 `check-gates-registry.mjs` 判红——「新作业该不该拦合并」必须由人回答一次。
5. `apps/web/test/ci-gate.test.ts`：
   - 正向用例的作业数同步；
   - 反向用例里 `needs` 的**精确字符串**必须同步（不同步会因 `expect(broken).not.toBe(src)` 变红，这是故意的「强制提醒」，不要改用正则绕过）；
   - 为新作业补一条「删掉它必须变红」的反向用例。
6. `docs/CI-BRANCH-PROTECTION.md`：聚合树、示例输出、作业数同步。

验证命令（本地按序）：

```bash
node scripts/check-ci-gate.mjs
node scripts/check-gates-registry.mjs
node node_modules/vitest/vitest.mjs run apps/web/test/ci-gate.test.ts
pnpm verify
```

CI 侧验收：故意让新作业红一次，确认 `ci-passed` 红、PR Merge 被禁用。

**两条硬约束**：

- `ci-passed` 把 **`skipped` 也算失败**。任何「只在 PR 事件跑」的新作业必须设计成 push 事件下也 success（内部判空 `exit 0`），否则 push 到 main 永久红。
- `seo-audit-prod` **故意不在 `needs` 里**：它带 `if: github.event_name == 'workflow_dispatch' && vars.NAVHUB_SITE_URL != ''`，PR 下必然 skipped，加进去会让每个 PR 永久红。不要「顺手补全」。

### 2.1 门禁清单（`scripts/gates.json`）

从 2026-10-29 起，钩子与 CI 里「到底挂了哪些检查」有了单一清单。`scripts/check-gates-registry.mjs`
拿它和**真实接线**逐条对账，而不是拿清单自说自话。

- **字段**：`name`（唯一）/ `when`（`staged` | `prepush` | `ci`）/ `blocks`（红了是否拦合并）/ `why`（为什么存在，一句话）/
  `script` + `args`（被钩子调用的脚本）/ `runner: "prepush-gates"`（pre-push 内层，由 `planGates()` 产出）/
  `job`（CI 作业名，缺省即 `name`）/ `test`（一个路径或数组，指向这枚门禁的测试）/
  `whyNoTest`（确无专属测试时说明理由，与 `test` 二选一）。
- **门禁自己的测试**：`test` 指向的文件必须真实存在（`check-gates-registry` 逐个 `existsSync`），
  否则「清单说它有测试」只是换个说法骗人；目前只有 `extensions` / `upstream-ref` 用 `whyNoTest` 豁免。
- **钩子新鲜度**：`hooks-fresh` 门禁在 pre-commit 里比对 `.git/hooks/.navhub-hooks.json`
  与四个生成物 + 模板源 hash。改了 `scripts/install-git-hooks.mjs` 却没重装 ⇒ 提交被拦，
  提示 `node scripts/install-git-hooks.mjs`——否则钩子里的新检查一次都不会跑。
- **镜像 prepare 闭包**（同日新增，同属 `hooks-fresh`）：两个 Dockerfile 只拷 `install-git-hooks.mjs`
  进镜像、靠根 `prepare` 执行它，所以它的**相对 import 闭包**必须同时被 COPY。
  2026-10-29 实战：给它加了 `./lib/hooks-fresh.mjs` 的 import 却没改 Dockerfile，本机全绿，
  `docker-smoke` 的「构建 API 镜像」在 install 阶段 `ERR_MODULE_NOT_FOUND` 直接红。
  门禁按「Dockerfile 的 COPY 源 ⊇ 闭包」判定，漏拷会点名文件并给出要补的 COPY 行。
- **源码伴随改动**（同日新增，同属 `commit-atomicity`）：这枚门禁原先只防「提交的测试 → 脏源码」。
  2026-10-29 的另一半事故是「提交的路由 → 未提交的同包签名」：`apps/api/src/routes/videos.ts`
  经 `@navhub/store` 调用 `countVideoItems(repo, filter)`，对象参数重载还留在
  `packages/store/src/repository/videos.ts` 的工作区里 ⇒ 本机 typecheck 全绿、CI 三个分片全红在 typecheck。
  判据收紧到**符号级**：staged 源码的依赖（barrel 会展开再导出闭包，`@navhub/*` 与模块图共用一份别名表）
  在 HEAD→工作区里删改的导出符号，如果真出现在 staged 源码里 ⇒ 拦下并点名两处文件；
  改的是没用到的导出 / 只删注释 / 只新增导出 ⇒ 放行（共享工作区里别人的日常改动不该拦无关提交）。
  逃生口 `NAVHUB_ALLOW_DIRTY_SOURCE_DEPS=1`，放行时逐条列出被跳过的清单。
- **测试 → 非代码文件**（同日补齐，同属 `commit-atomicity`）：门禁测试不 import 而是**直接读**
  `.github/workflows/ci.yml`、`apps/web-overlay/src/styles/*.css`、`docker/Dockerfile.api`、
  `docs/ci-red-ledger.json`。此前只认代码后缀，于是「提交测试、把 ci.yml 留在工作区」这条
  与 89a20b42 同形的不原子看不见——本地绿、CI 检出提交树红。前缀表与选测同源
  （`source-refs.mjs` 的 `REPO_RELATIVE_PREFIXES`，一处定义四处用）。
  代价是夹具里大量把非代码路径当**例子**写，所以对非代码目标额外要求「被当作输入读取」
  （`isReadArgument`：函数实参，或 `*Path|File|Dir:` 结尾的配置键；对象键 / 数组元素 / 赋值 /
  `write(...)` 不算）。实测本仓 12 个 ci.yml 读者、4 个 css 读者、1 个 Dockerfile 读者全部保留，
  夹具举例全部排除；前提见 docs/TESTING-CONVENTIONS.md「夹具路径不得撞真实路径」。
- **测试 → 分段拼接路径**（2026-10-30 补齐，同属 `commit-atomicity`）：
  `const SCRIPT = resolve(ROOT, "scripts", "check-large-files.mjs")` 再 `readFileSync(SCRIPT)`——
  每段都不带 `/`，整串正则抽不出来。选测早在 2026-10-29 就认这一路（`source-refs.mjs` 的
  `joinedPathLiterals`，与图共用），原子性此前是盲区：分段写法读的正是接线/脚本这类契约文件，
  不原子提交照样本地绿、CI 红。
  判据与整串那一路**相反**：只否写字类调用，不要求「处在读取调用的实参位」。实测真实仓库里
  这条独有边共 110 个目标、但只有 **23 个**是「存在且入库」的文件（其余 87 个是夹具临时树里的
  假路径，永远不会脏，也就永远咬不到人）；若按 `isReadArgument` 筛，26 条真实存在的分段边会被
  砍掉 17 条、其中 16 条是真依赖——先拼后读是本仓门禁测试的主流写法。写入否决保住的是反向的一半：
  夹具往临时目录 `writeFileSync(join(tmp, "scripts", "x.mjs"), …)` 拼出的路径与仓库真文件同名，
  那不是读取依赖（`commit-atomicity.test.ts` 正反面各钉一例，去掉否决那例即红）。
- **双向对账**：
  - 登记了但接线里没有 ⇒ 「以为在拦，其实没跑」；
  - 接线里有但清单没登记 ⇒ 下次改钩子时会被人顺手删掉，且没人知道它拦过什么。
- **退出码**：`0` 全一致；`1` 有对账差异；`2` 清单本身读不出/不是合法 JSON/字段缺失（与「不一致」分开，避免把配置错误当成门禁红灯）。
- **pre-commit 触发时机**：暂存了 `.github/workflows/`、`scripts/gates.json`、`scripts/install-git-hooks.mjs`
  或 `scripts/prepush-gates.mjs` 时，钩子在 `check-ci-gate.mjs` 之后追加跑一次；平时不占提交时间。
- **它不管的事**：门禁内部的判定逻辑（那是各脚本自己的测试），以及 `journal` 式的人工豁免记录。
  清单只回答「这枚门禁**存在且被接线**」，不回答「它判得对不对」。

### 2.2 级联红守卫：一次根因只留一处红（`check-ci-gate.mjs` 第 6 项）

2026-10-29 实战（run 40835496871）：`typecheck` 一红 → 测试步骤被跳过 → junit 不存在 →
`红灯光谱` / `红灯台账` / `upload-artifact` 三步仍按 `!cancelled()` 执行，「缺 junit」各自再判一次红。
**一个根因变成四处红**：真根因被淹没，而「遥测链路断了」这条本应刺眼的告警也变成了狼来了。

同日第二形态（test-web）：`if: always()` 的本意是「预算门禁红灯时也要出账」，但它把
「build 根本没跑成」也算进来了——lint 一红 → build 被跳过 → `.next` 不存在 →
账脚本与它那步 `if-no-files-found: error` 的上传各自再红一次。

- **判据**（不限于 junit）：任何**读上游产物、且产物缺失时会把自己判红**的收尾步骤，必须以
  `if: ${{ !cancelled() && steps.<锚点 id>.outcome != 'skipped' }}` 为条件。锚点跑过（成功或失败）
  时照常执行——那是它们该干活的时候；`skipped` 说明根因在上游，这里不掺和。
- **豁免**：`if-no-files-found: warn|ignore` 的上传缺文件也不会自己判红 ⇒ 不是级联源，不逼着挂守卫。
  这是一条**会随改法失效**的豁免：把它改成 `error` 的那一刻它就变成级联源，守卫要求随即生效
  （`test-e2e` 的 `playwright-report` 正走这条路，所以它列在 products 里）。
- **已接线的作业**（`scripts/check-ci-gate.mjs` 的 `CASCADE_RULES`，每项 = 锚点 + 产物名正则）：
  `test-sqlite`（`id: vitest`）、`test-e2e`（`id: e2e`）、`test-web`（`id: web-build`）。
  新增分片/测试/产物型作业时在此登记一行，并给生产者步骤补 `id:`。
  登记表是硬编码的，与「作业清单不硬编码」不冲突：聚合关系能从 YAML 推出来，
  「这一步读的是哪个步骤的产物」推不出来。
- **登记表的覆盖面**（2026-10-30 补，`readerJobCoverageProblems`）：上面那句「新增作业时登记一行」
  此前只是文档承诺——漏登记的后果要靠事故发现（产物生产者真被跳过时才会多出一处红），
  平时给一个未登记的作业加上会自我判红的上传，门禁一路绿灯。现在这条**能推**：
  带 `if-no-files-found: error` 上传的**阻塞**作业必须在 `CASCADE_RULES` 里出现，否则红并给出登记形状。
  范围刻意收窄两处：① 只看 `error`（`warn|ignore` 缺文件不判红，没什么可收敛）；
  ② 只看在 `ci-passed` 聚合里的作业（手动/定时作业的多处红不阻塞合并，硬逼它补 `id:` 是净摩擦）。
  `run:` 步骤里的读取（`junit-summary.mjs` / `bundle-budget-summary.mjs`）仍只能靠 `products` 正则登记，
  覆盖面判据覆盖不到那一形——它管的是「新作业带着自我判红的上传出现」这一形。
- **反向也管**（判定把自己人判红的三种形态）：① 解析时先剥 YAML 注释行——注释里解释口径会写出
  `upload-artifact`、`junit-summary.mjs` 这些字样；② 锚点步骤自己不算消费者——它的 `run` 行本来就
  带着产物名（`--outputFile.junit=junit-….xml`），不排除就会要求「测试步骤以自己的 outcome 为条件」；
  ③ 豁免按 `if-no-files-found` 判定，不按「是不是上传步骤」判定。
- **测试**：`scripts/check-ci-gate.test.ts` 的第 6 组（真实 ci.yml：现状绿 + 三处守卫各自回退必红 +
  锚点 `id:` 消失必红 + 注释不误判 + **给未登记作业加 error 上传必红**）；
  `scripts/lib/ci-workflow.test.ts`（判定的三个分支用合成片段逐个钉正反两面——真实 ci.yml 上
  每个分支只走一条路，「现状绿」证明不了另两条真的存在；覆盖面那五条同理，HEAD 上三个作业全登记了）。
  覆盖面那条已做过消融自证：删掉 `problems.push(...uncoveredReaders)` → 新用例转红（1 failed / 10 passed）。

---

## 3. 当前门禁全景

`ci.yml` 共 **10 个作业定义**：

| 作业 | 是否进聚合 | 作用 |
|---|---|---|
| `test-sqlite` | ✅ | typecheck + 后端 lint（`continue-on-error`）+ vendor + 全量 vitest + build |
| `test-postgres` | ✅ | pgvector 服务容器 + `test:pg:suite` + `test:pg` |
| `test-web` | ✅ | vendor + tsc + eslint + `next build` + 首屏预算 + ISR 路由门禁 |
| `check-web-overlay` | ✅ | 语法 + vendor + overlay 字节比对 + core 镜像 + 上游 ref + 扩展 |
| `check-isr-live` | ✅ | CI 内自建预览跑 ISR 三层契约抽查（`--rotate` 按 SHA 轮换样本） |
| `test-e2e` | ✅ | Playwright 全量（失败时解析失败用例名发 annotation） |
| `docker-smoke` | ✅ | api / web 镜像构建 |
| `audit` | ✅ | `pnpm audit` 高危硬门禁（含 `--prod`） |
| `seo-audit-prod` | ❌（故意） | 仅 `workflow_dispatch` + 有 `NAVHUB_SITE_URL` 时跑 |
| `ci-passed` | — | 聚合闸门，分支保护唯一必经项 |

`ci-passed.needs` 目前 **8 个作业**（上表前 8 个）；`REQUIRED_JOBS` 硬编码数组已随动态解析下线，
现在由 `scripts/check-ci-gate.mjs` 直接读 `needs` 与作业清单比对，`scripts/gates.json` 负责登记
「每个作业该不该拦合并」。增删作业仍须走 §2 全套。

---

## 4. 时长预算

### 4.1 本机实测（2026-10-25，重要）

| 场景 | 实测 | 说明 |
|---|---|---|
| 全量 vitest（4210 tests / 396 files，无覆盖率） | **27 分 26 秒** | 3 failed / 4179 passed / 28 skipped；耗时主要来自 396 个 worker 的启动开销（约 3.8s/文件） |
| 全量 vitest + 覆盖率（`json-summary`） | 见 `TESTING-STRATEGY.md` §3 的 W0 记录 | v8 插桩会增加 15–40% |
| 单个 `scripts/check-ci-gate.test.ts`（3 tests） | 119 秒 | 该测试会 spawn 子进程，不代表普通单测 |

**结论：不要用「9 分钟」估算全量。** `TESTING-CONVENTIONS.md` §5 的 9 分钟是历史值，当前套件已增长到 4210 个测试；任何涉及全量的 timeout、成本判断都必须以实测为准。

### 4.2 CI 作业 timeout 现状

| 作业 | timeout | 估计实际（未实测） | 长尾原因 |
|---|---|---|---|
| `test-sqlite` | 20m | 10–14m（Linux，未含覆盖率） | typecheck + 全量 vitest + build 串行 |
| `test-postgres` | 20m | 8–12m | pgvector 冷启动 + 两套件 |
| `test-web` | 25m | 12–18m | `next build` 是最大单项 |
| `check-web-overlay` | 15m | 6–8m | vendor 重建 + 5 项比对 |
| `check-isr-live` | 30m | 18–25m | install + vendor + build + 双进程 + 限流四阶段 |
| `test-e2e` | 30m | 15–25m | playwright install + 全量 spec |
| `docker-smoke` | 30m | 8–15m | 两次 build，无层缓存时最坏 |
| `audit` | 10m | 2–3m | 依赖 npmjs 网络 |

### 4.3 覆盖率接入的前置条件（基于实测的修正）

原计划「直接给 `test-sqlite` 加 `--coverage`，timeout 20m→25m」。实测后修正为：

1. **先确认套件是绿的**。2026-10-25 全量运行有 3 个失败（`backend-lint-gate` / `backup-restore-job` 的 470ms<300ms 时序断言 / `metrics-format` 的指标快照），在红灯套件上设覆盖率基线没有意义。
2. **先在 CI 实测 `test-sqlite` 时长**（Linux runner 与本机差异大）。若加覆盖率后 >22m，拆独立 `coverage` 作业——但那是新增作业，必须走 §2 全套联动。
3. 阶段 A 允许 `continue-on-error: true` 观察两周，但**不要**在 PR 上长期挂一个每轮多花几分钟、又不阻断的步骤；观察期结束就转硬门禁或撤掉。

### 4.4 优化建议（按收益）

1. `docker-smoke` 加 `cache-from/cache-to: type=gha`：冷构建 8–15m 可降到 3–5m，零联动成本。
2. 不做 vitest `--shard` 拆片：`test-sqlite` 未接近 timeout，拆片只增加 runner 分钟数。
3. `check-isr-live` 短期不动：拆「限流豁免」会新增作业，须走 §2 联动，风险高于收益。
4. 若全量继续变慢，优先查 worker 启动开销（`isolate: false` 已被证明会引入跨文件污染，不能开；见 `vitest.config.ts` 注释）。

---

## 5. 红灯归因 runbook

通用第一步：**先看红在哪一步**（作业页里红色步骤名），再看 annotation（无 token 时作业日志接口 403，annotation 是跨机器唯一可读通道）。本地复现优先 `pnpm verify`（覆盖 7 项里的 5 项）。

| 作业 | 第一反应 | 假红 / 归因陷阱 |
|---|---|---|
| `test-sqlite` | 按步骤定位：typecheck → lint:backend（`continue-on-error`，不会红）→ vendor → vitest → build。`Cannot find package '@/lib/auth'` = 忘了 `node scripts/vendor-web.mjs`；build 红 = 声明导出/入口路径坏 | `lint:backend` 是 warning 级，红了也不是它 |
| `test-postgres` | 先看是 `test:pg:suite` 还是 `test:pg` 红。suite 报「未设置 `NAVHUB_TEST_DATABASE_URL` —— 拒绝执行」= **作业配置坏了**，不是代码；有 URL 仍红 = 真跨方言缺陷 | 把变量设成 `DATABASE_URL` 是死变量，套件整体 skip → 假绿，绝不能这样「修」 |
| `test-web` | 按步骤序：tsc → eslint（warning 不卡）→ `next build` → bundle budget → `check-isr-routes`。budget 红**不许上调** `scripts/bundle-budget.json`；2026-10-30 起每条超限路由单独写一条 `::error file=scripts/bundle-budget.json,line=<阈值行>::`（本地不打），所以没 token 也能从 annotation 直接看出是哪几条路由超了多少；ISR 红 = 某收录型路由从 ● 退化成 ƒ，或页面签名读了 `searchParams` | `next.config` 的 `ignoreBuildErrors` 只影响 build，不影响 tsc 步骤。**eslint 那一步红不起来**（基线 0 error / 800+ warning），annotation 里的警告文案不是判红原因 |
| `check-web-overlay` | 报错会列出不一致文件：先问「是不是直接改了 `apps/web`」。事实源是 `apps/web-overlay/`，改 overlay 后重跑 `node scripts/vendor-web.mjs`；再查 `sync-core-mirrors --check` 与 `check-upstream-ref` | `apps/web` 是 gitignore 生成物，全新检出必须 vendor 后才能比对 |
| `check-isr-live` | 读 3 条 `::error::` 做三层归因：①判据数字（rc / sitemap 条目数 / 红行数）②输出尾部 600 字符 ③收录面族计数。族整族归零但抽到的页全绿 = sitemap 生成侧问题；`120s 内没有 /site/*` = 中枢失联或 seed 空，看 `tail /tmp/hub.log /tmp/web.log` | 限流阶段 `rc=2` = 缺 `NAVHUB_INTERNAL_TOKEN`；「预检失败…是降级壳」= web 没吃到豁免，先查 3000 端口占用者，别怀疑业务代码；**不要**重启 web 来「修」（凭据是模块顶层常量，只在启动时读一次） |
| `test-e2e` | 读 annotation 的「失败用例：」清单与「报错抽样」，本地 `node scripts/e2e-local.mjs -- <spec> --grep "<标题>"` 单跑；下载 `playwright-report` 产物 | 全量共享 server，超时类红灯先看是否被前一个 spec 拖慢，不一定是断言错 |
| `docker-smoke` | 看是 API 还是 Web 镜像红。API：`--frozen-lockfile` 安装阶段（原生编译依赖 / `prepare` 钩子）；Web：上游底座拉取失败 | 不要因网络抖动删 `--frozen-lockfile` |
| `audit` | 必须 `--registry=https://registry.npmjs.org`；已知例外 `GHSA-vfj7-8cjw-p6xm`（braces，dev-only）用 `--ignore` | 改 `.npmrc` 或去掉 `--registry` 会得到假红 |
| 覆盖率（新增） | 退出码 **2 = 找不到产物**（查 `reportsDirectory` / 清理开关 / `--max-age`）；**1 = 真低于阈值**（`--zero 20` 定位文件） | 禁止在同一 PR 里下调阈值；要么补测，要么单独 PR 说明 |

### 5.1 红灯台账（跨轮对比）

`test-sqlite` 与 `test-e2e` 在 `红灯光谱` 之后各跑一次
`node scripts/ci-red-ledger.mjs --from <junit> --require-no-new`，对照跟踪路径上的
`docs/ci-red-ledger.json`：

- **新增 / 换因**（同一用例、错误指纹变了）→ 步骤红。分片视角只看得到自己那一片，所以
  check 模式**不判定「已修复」**；修复要等全量产物下 `--update` 才会从台账移除。
- **已知红**只进 Step Summary，不额外判红（它已经由测试步骤判过了）。
- **台账缺失 / 形状不合法 → rc 2**（不能把「没账」当成「没有新红」）。
- **过期账**：每条带 `expiresAt`（默认 TTL 14 天）。CI 的两个台账步骤都带 `--strict-ttl`，
  过期仍在红 ⇒ 步骤红——台账是「已知的债」，不是免死金牌；只记账不催收，长期红会变成背景噪音。
  到期前要么修掉，要么 `--update` 时重新计时并在 note 里写明原因。
  （`--strict-ttl` 只看「本次仍在红的过期条目」；已修复的账不会被 TTL 判红。）
- **台账管不到的红**（2026-10-30 取证，避免下一轮重新误判范围）：台账的身份是 junit 里的
  `file :: case`，因此只有**测试用例级**的红能入账。步骤级的常驻红——首屏预算、线上 ISR 抽查、
  限流豁免集成检查——根本没有用例名可当键，硬塞进台账只会造出一行没人能对账的记录。
  这一类红由 `explain-ci-failure.mjs --baseline <sha>` 的跨轮对比承担（新增红 / 换因 / 仍在红 / 已修复），
  要长期跟踪就得多一个「步骤名」身份，而不是往用例台账里加假条目。

维护方式：修完一批已知红后全量跑一次并
`node scripts/ci-red-ledger.mjs --from <全部分片的 junit> --update --ttl-days 7`，
把结果连同 owner 一起提交。**不要**为了变绿手工删条目——删条目等于宣称已修复。

### 5.2 归因头的级别：警告不许冒充判红原因

`explain-ci-failure.mjs` 的取头规则（`scripts/lib/ci-attribution.mjs`）：

1. **失败级注解优先**，一个失败级都没有才降级用警告级，并在行上标 `headLevel: "warning"`、
   表里写成 `（警告级·非判红原因）…`；
2. 降级时 `fixHint` 不再用「层默认入口」（那层本身是从警告文案推出来的），而是取
   **红的那一步**的原命令——Actions 把 `run:` 步骤命名成 `Run <命令>`，所以步骤名就是一行
   可执行的复现命令（`uses:` 步骤不是命令，此时仍落回层默认入口）。

为什么单独立这条：真实 run 40868398091…40919239730 里「前端门禁」连着 11 轮红在同一步，
那一步的失败级注解只有被剥掉的 `Process completed with exit code 1.`，于是归因头落到
eslint 的 `'Route' is defined but never used`（**警告**，CI 不卡）上，两轮提交在清根本不
存在的 lint 红；真红是 `node scripts/check-bundle-budget.mjs` 的预算超限。
读日志/产物要 Actions 权限（本仓库 token 实测 404），annotation 是唯一跨机器可读的通道——
所以**任何只把结论打在 stdout 的门禁都必须自带失败级注解**，否则它的红在归因表里就是隐形的。

---

## 6. 部署前 Go/No-Go

全部勾选才允许 `docker compose up -d`；任一项 No-Go 即停。

### Go（发布前）

- [ ] 部署 commit 的 `ci-passed` 为 success（不是「最近一次大概绿」）。
- [ ] 发布机 `pnpm verify` 绿 + `pnpm verify:web` 绿（前端门禁不在 verify 里）。
- [ ] 镜像用 **SHA 打 tag**：`docker build -f docker/Dockerfile.api -t navhub/api:<sha> .`（当前 compose 写死 `navhub/api:0.1.0`，建议改 `${NAVHUB_IMAGE_TAG:-0.1.0}`，否则回滚无镜像可退）。
- [ ] `node scripts/check-upstream-ref.mjs` 通过（vendor 脚本 / Dockerfile / UPSTREAM.md 三处同源）。
- [ ] 备份：`node scripts/backup.mjs`（默认保留 35 份），输出含 `integrity_check=ok`。
      **注意：`backup.mjs` 仅支持 SQLite；PG 部署需 `pg_dump`，当前无脚本（已知缺口）。**
- [ ] 数据兼容性：确认迁移无破坏性变更（drop/rename 列、改类型）；有则先备份 + 书面 sign-off + 准备回滚脚本。
- [ ] 环境变量：`NAVHUB_SESSION_SECRET` / `NAVHUB_IDENTITY_SECRET` / `NAVHUB_INTERNAL_TOKEN` 两侧同值；`NAVHUB_AUTH_REQUIRED=1` 时 `NAVHUB_IDENTITY_SECRET` 需 ≥32 字符。

### 部署顺序（不可颠倒）

1. `node apps/api/src/migrate.ts`（**CWD 必须是仓库根**——`NAVHUB_SQLITE_PATH` 默认 cwd 相对 `./data/navhub.db`）。
2. `pnpm seed`（seed 不建表；空库先 seed 只会得到空 sitemap）。
3. 起 API，等 `curl -fsS http://127.0.0.1:8787/api/ready` 通过（不是 `/api/health`，后者不 ping 数据库）。
4. 起 Web，验证 `/` 与 `/sitemap.xml` 含 `/site/*` 条目。

### 回滚

- 镜像：`NAVHUB_IMAGE_TAG=<上一 SHA> docker compose up -d`（依赖 SHA tag）。
- 数据：停容器 → 替换 `data/navhub.db`（或卷内 `/data/navhub.db`）→ 删 `-wal` / `-shm` → 起容器。**不要**在容器运行时直接覆盖 db 文件。
- 回滚后验证：`/api/ready` 200 + 抽查 3 个页面 200 + 登录可用。

---

## 7. 分支保护（差异项）

网页端操作步骤与验收方法见 [`CI-BRANCH-PROTECTION.md`](CI-BRANCH-PROTECTION.md) §2。本节只列**流程要求新增的差异项**：

| 选项 | 建议 | 理由 |
|---|---|---|
| Required approvals | 1 | 小团队可合并；核心路径靠 CODEOWNERS 抬到 2（启用后） |
| Dismiss stale approvals on new commits | 勾选 | 防止「审的是旧代码」 |
| Require review from Code Owners | **暂不勾选** | 少人仓库会锁死合并；≥2 名常驻审查者再开 |
| Require linear history | 勾选 | 禁 merge commit，统一 squash/rebase |
| Require conversation resolution | 勾选 | 审查意见必须闭环 |
| Do not allow bypassing | 勾选 | 管理员也不能绕过；事故时临时关规则并留记录 |

验收（两步，都要做）：

1. 沿用现有 PG 红验收：临时让 `test-postgres` 红 → 确认 `ci-passed` 红、Merge 禁用。
2. CODEOWNERS 验收（启用强制后）：改 `/.github/workflows/ci.yml` 的 PR，未获 owner approve 时 Merge 必须禁用。

---

## 8. 可观测性

- **Annotation 三级**：
  - `::error::` 只用于阻断性失败。固定三段：①门禁名 + rc + 关键数字 ②输出尾部（≤600 字符，`tr '\n%' '|'` 压成单行）③分层归因。**无条件发送**——不要按 `grep` 匹配行发，脚本自己抛异常时会一行不剩。
  - `::warning::` 用于不阻断的漂移（语料过期、lint 告警）。
  - `::notice::` 用于绿灯留证据（如限流豁免四阶段计数），否则「步骤 success」和「检查真的成立」无法区分。
- **安全红线**：annotation 里只许出现凭据**长度**（`${#NAVHUB_INTERNAL_TOKEN}`），永不打值。
- **Artifact**：一律 `retention-days: 14` + `if-no-files-found: ignore`；覆盖率上传 `coverage-summary.json`（`if: always()`）。
- **失败日志**：长驻进程作业末尾加 `if: ${{ failure() }}` 的 `tail -80`（`check-isr-live` 模式）。不要在失败时用 `pgrep -f "next start"` 找进程（Next 会改 `process.title`），要记 PID 文件；CI 一次性环境直接 SIGKILL（SIGTERM 的 30s drain 会超过等待窗口）。
