# E2E quarantine 可执行说明

> 本文把 [docs/TESTING-STRATEGY.md §4「E2E 与 flake 政策」](TESTING-STRATEGY.md) 落成可执行步骤与护栏。
> **政策唯一来源是 §4，本文不发明新规则**：四判定、登记字段、门禁接线、SLA、复活机制、七条红线均逐条对应 §4.2–§4.5。
> 台账：[e2e/QUARANTINE.md](../e2e/QUARANTINE.md)（当前 0 条）。校验器：[scripts/check-quarantine.mjs](../scripts/check-quarantine.mjs)。

---

## 1. 现状（不粉饰）

| 项 | 现状 | 来源 |
|---|---|---|
| `retries` | CI 2 / 本地 0 | `playwright.config.ts:34`（`retries: process.env.CI ? 2 : 0`） |
| `workers` | 1（单 Worker，避免本地 SQLite 并发写锁） | `playwright.config.ts:35` |
| `timeout` | 90s（`expect.timeout` 15s） | `playwright.config.ts:28-31` |
| `fullyParallel` / `forbidOnly` | false / `!!process.env.CI` | `playwright.config.ts:32-33` |
| `reuseExistingServer` | **false**（E2E 库固定 `data/e2e/navhub-e2e.db`） | `playwright.config.ts:60`、§4.5 红线 4 |
| E2E 用例数 | 25 个 `*.spec.ts` | `e2e/` |
| 隔离台账 | **当前 0 条** | `e2e/QUARANTINE.md` |
| `quarantine.json` | 既有占位清单，`entries: []` | 仓库根；本轮**不修改** |
| 主 E2E 门禁接线 | ✅ **已接线（2026-11-06 round 16）**：`test-e2e` 作业执行 `pnpm test:e2e --grep-invert @quarantine --shard=…`，带 tag 的用例不进主门禁 | `ci.yml` test-e2e 作业 |
| 隔离用例取证 | ✅ **已接线**：同在 `test-e2e` 作业内、仅分片 1，跑 `--grep @quarantine` 产出 `junit-quarantine.xml`，末尾 `exit 0` 不阻塞合并；随后 `test-telemetry.mjs --quarantine-only` 校验过期 | `ci.yml` `quarantine-e2e` / `quarantine-check` 步骤 |
| 为什么不设独立作业 | 本仓 `check-ci-gate` 要求每个作业要么进 `ci-passed.needs`、要么声明为手动/定时；而隔离用例须在 PR 跑且不阻塞。独立 job 会撞守卫（实测两者互斥），故并入 `test-e2e` 内部 | `scripts/check-ci-gate.mjs`、`scripts/check-gates-registry.mjs` |

§4.1 明确 **保留 `retries=2`**：单 Worker + 真实浏览器 + Next 编译，抖动客观存在；取消会让 CI 噪声化进而被绕过。代价是必须配 flake 台账——这正是本轮三份文件要补的缺口。

> 诚实口径（2026-11-06 更新）：本文初版只交付台账 + 校验器，CI 接线当时**尚未落地**，故写明「隔离标记不会自动排除」。
> **round 16 已完成接线**：主 E2E 加 `--grep-invert @quarantine`，隔离用例在同作业分片 1 内取证并 `exit 0` 不阻塞。
> 与规格的唯一偏差：没有独立的 `test-e2e-quarantine` 作业，原因见上方表格「为什么不设独立作业」。

---

## 2. flake 四条判定（§4.2 逐字，任一即 flake）

1. 同一次运行内「失败 → 重试通过」（Playwright 标注 flaky）；
2. 同一测试 7 天内在 ≥2 个无关 PR 上失败；
3. 本地 `--repeat-each=3` 复现失败 ≥1 次；
4. 失败信息指向超时/竞态（`Target closed`、`Timeout 30000ms exceeded`）而非断言值不符。

命中任一条才进入 §3 的隔离流程；**不是**「红了就隔离」。失败指向断言值不符的是真回归，按 `CODE-REVIEW.md` / 红灯台账处理。

---

## 3. quarantine 流程（§4.3 逐字 + 可执行落点）

### 3.1 标记

- 用 `{ tag: '@quarantine' }` 或标题前缀 `[quarantine]`；
- **不用 `test.fixme`**（等于删除）——隔离用例必须仍在跑、仍留证据。

示例（不写入任何用例，仅示意形状）：

```ts
test('[quarantine] 首页检索 › 微部件召回', { tag: '@quarantine' }, async ({ page }) => { /* … */ });
```

### 3.2 登记

在 `e2e/QUARANTINE.md` 的 `<!-- QUARANTINE_TABLE_START -->` / `<!-- QUARANTINE_TABLE_END -->` 之间追加**一行 5 列**：

| 测试名 | 首次 flake 日期 | 失败签名 | 归属人 | 到期日（≤14 天） |
|---|---|---|---|---|
| 与 tag/前缀一致的用例标题 | `YYYY-MM-DD` | 可判定特征，如 `Target closed` | 负责人 | `YYYY-MM-DD` |

字段即 §4.3 原文「测试名 / 首次 flake 日期 / 失败签名 / 归属人 / 到期日（≤14 天）」，列名与顺序由校验器精确匹配，不可增删改。

### 3.3 门禁（§4.3 原文规格）

- **主 E2E 作业加 `--grep-invert @quarantine`**：带 tag 的用例不进主门禁，主 `test-e2e` 的红只指向真回归。✅ 已接线
- **隔离用例仍需跑一次并留证据**：保证「隔离 ≠ 删除」，14 天 SLA 与复活判定才有依据；该取证**不阻塞合并**，但结果必须可见。✅ 已接线
- 两者**必须成对**：只 invert 不留证据 = 用例悄悄消失（等价 `test.fixme`）；只留证据不 invert = 主门禁继续被 flake 污染。

> **落地形态（2026-11-06 round 16）**：取证放在 `test-e2e` 作业内、仅分片 1，用 `exit 0` 保证不阻塞。
> 规格原文写的是「独立作业 `test-e2e-quarantine` + `continue-on-error: true`」——**没有照做**，因为本仓两道守卫互斥：
> `check-ci-gate` 要求不在 `ci-passed.needs` 的作业必须声明为手动/定时；
> `check-gates-registry` 又要求登记为 `blocks:false` 的作业不得被 `needs` 聚合。
> 两者都对，但使「PR 上运行 + 不阻塞 + 独立自治作业」在当前架构里不可同时满足。
> 合并进主作业是满足全部约束的最小改动；若将来要给 `ci-passed` 增加「聚合但允许失败」的表达力，可再拆回独立作业。

### 3.4 SLA

**14 天未修复 → 要么修好、要么删除，并在测试计划里记录「能力缺口」。不允许无限期隔离。**

---

## 4. 复活机制（§4.4 逐字）

1. 隔离作业**连续 5 次运行全绿**（同一测试）→ 任何人可提 PR 去掉 tag，**附 5 次运行链接**；
2. 复活后 **7 天内再 flake → 直接删除该用例，降级为 L3 集成覆盖，不允许二次隔离**；
3. 每次复活必须写明「**当初为什么 flake**」。

复活 PR 同时删掉 `e2e/QUARANTINE.md` 里对应行，使台账回到真实状态（当前目标态：0 条）。

---

## 5. 七条 E2E 红线（§4.5 逐条，写/审 E2E 时逐项核对）

1. **mock 路径必须带 `/api/hub` 前缀**（`hubUrl()` 的 BASE 是 `/api/hub`）。写错 = 请求真打后端污染数据，且真实响应文案与 mock 一致 → 「看起来正常」的假绿。
2. **断言「发了什么」，不断言「显示了什么」**：写路径的事实在请求体里。
3. **toast 双 DOM**（可见 + `aria-live`）：`getByText` 会 strict 冲突，用 `.first()`。
4. **不得 `reuseExistingServer`、不得复用开发库**：E2E 库固定 `data/e2e/navhub-e2e.db`；本地跑前先停 `pnpm dev:all`，或用 `NAVHUB_WEB_PORT` / `NAVHUB_API_PORT` 换端口。
5. **新 spec 必须 `--repeat-each=3` 全绿**才提 PR。
6. **自查 mock 是否生效**：handler 里 `console.log`，或断言「本用例应产生 N 次调用」。
7. **禁止固定 `sleep`**：用 `expect.poll` / `waitForResponse`。

> 补充（来自 `TESTING-CONVENTIONS.md` §9，非新规则）：并发会话的 E2E 必须隔离端口、Next 输出目录、数据库文件三项；`playwright.config.ts` 的 `NEXT_DIST_DIR` / `NAVHUB_SQLITE_PATH` 已按此接线。

---

## 6. 校验器 `scripts/check-quarantine.mjs`

### 6.1 判据（只有两条阻断）

| 判定 | 退出码 |
|---|---|
| 形状非法：解析标记缺失/顺序错、表头列名或列数不符、缺分隔行、数据行 ≠ 5 列、任一字段空白、日期非合法 `YYYY-MM-DD` 真实日历日（挡 `2026-02-30`）、到期日早于首次 flake 日期、测试名重复 | **1** |
| 隔离窗口 > 14 天：`到期日 − 首次 flake 日期 > 14 天`（§4.3「到期日 ≤14 天」+「14 天 SLA」） | **1** |
| 台账读不了 / `--today` 非法 | **2** |
| 空台账 0 条、或全部条目合法 | **0** |

窗口用台账内两个日期互判，结论**不随运行当天漂移**，离线可复现、可写正例/反例自测。

### 6.2 只提醒不判红

到期日已过 / 今天到期 / 3 天内到期 → 进 `--json` 的 `notices` 与 stderr 提醒。**不判红**：§4.3 的「到期后修好或删除」是流程 SLA，由人在 PR 里执行；脚本若越权判红，等于新增一条政策里没有的规则。

### 6.3 用法

```bash
node scripts/check-quarantine.mjs                       # 校验（默认）
node scripts/check-quarantine.mjs --json               # 机器可读：count（表格登记行数）/ ok / entries（成功解析条）/ problems / notices
node scripts/check-quarantine.mjs --today=2026-11-06    # 注入「今天」（只影响提醒，不影响窗口判定）
node scripts/check-quarantine.mjs --ledger=<path>       # 注入替代台账（自测正例/反例用，不新建文件）
```

`--json` 输出示例（当前空台账）：

```json
{
  "ledger": "e2e/QUARANTINE.md",
  "maxWindowDays": 14,
  "count": 0,
  "ok": true,
  "entries": [],
  "problems": [],
  "notices": []
}
```

### 6.4 与既有护栏的关系

- `scripts/check-governance.mjs` 已聚合 3 个子门禁（计划项落地证据 / 配置面登记棘轮 / 审计例外到期），`verify.mjs` 默认档以「治理一致性」一步调用它。本校验器**不自行改这两个文件**（由集成方接线），避免护栏膨胀（见 `check-governance.mjs` 头注释 T-1/T-2）。
- `quarantine.json` 是既有占位清单（`entries: []`、`note: "到期即红…禁止无到期日的永久豁免"`），本轮**不修改、不读取**：台账单一事实源是 `e2e/QUARANTINE.md`（§4.3 明确指定）。

---

## 7. 一轮隔离的完整动作清单（把 §4 串起来）

1. 观察到红灯 → 按 §4.2 四条判定确认是 **flake**（不是断言值不符的真回归）；
2. 用例按 §3.1 打 `@quarantine` / `[quarantine]` 标记（**不用 `test.fixme`**）；
3. 按 §3.2 在 `e2e/QUARANTINE.md` 追加一行，5 列齐全，到期日 ≤ 首次 flake 日期 + 14 天；
4. 跑 `node scripts/check-quarantine.mjs`，必须 `exit 0`；
5. CI 接线（§3.3）：主 E2E `--grep-invert @quarantine` + 独立 `test-e2e-quarantine` 作业 `continue-on-error: true`；
6. 写/审用例时逐条核对 §4.5 七条红线；
7. 14 天内：修好 → 走 §4 复活（连续 5 次全绿 + 5 次运行链接 + 写明当初为什么 flake + 去 tag + 删台账行）；或删除用例并在测试计划记录「能力缺口」；
8. 复活后 7 天内再 flake → 直接删除，降级 L3，**不二次隔离**。
