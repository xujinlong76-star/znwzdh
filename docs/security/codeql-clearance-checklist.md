# CodeQL 133 条警报分批清零执行 Checklist

> 总目标：把 `state=open` 的 CodeQL 警报从 133 条清到 0，同时不让新债进来。
> 配套文件：盘点脚本 `scripts/codeql-triage.mjs`、扫描配置
> `.github/codeql/codeql-config.yml`、Dependabot 清单
> `docs/security/dependabot-upgrade-checklist.md`、PR 防线
> `docs/security/pr-security-gate.md`。

## 0. 先把盘点跑起来（前置，未做 = 后面全是盲打）

- [ ] 补令牌权限：细粒度 PAT 加 **Code scanning alerts: Read-only**
  （Dependabot 另需 **Dependabot alerts: Read-only**）；或经典 PAT 加
  `security_events: read`。本机 PAT（muse-vm-push）目前缺这两项，
  2026-11-21 盘点跑出 HTTP 403，见
  `docs/security/codeql-triage-report-2026-11-21.md`。
- [ ] 重跑盘点并落盘新报告：
  `node scripts/codeql-triage.mjs --out docs/security/codeql-triage-report-YYYY-MM-DD.md --dependabot`
- [ ] 按报告的「规则 ID Top 重复项」确认 Top 5 规则（预期占总数一半以上），
  把 Top 5 写进下表，替换掉「待填」。

## 1. 分批计划（按 80/20：先清 Top 重复规则）

| 批次 | 内容 | 预计占比 | 验收 |
|------|------|----------|------|
| 第 1 批 | Top 1–2 规则（按报告 Top 表取前两名，通常是 `js/incomplete-url-substring-sanitization`、`js/polynomial-redos` 这类） | 约 40–50% | 该规则 open 数归 0，CI 全绿 |
| 第 2 批 | Top 3–5 规则 | 约 30% | 同上 |
| 第 3 批 | 生产代码剩余 Critical / High（`apps/`、`packages/`、`extensions/`） | 约 15% | 生产代码 Critical / High 归 0 |
| 第 4 批 | 脚本工具 `scripts/` + Medium / Low | 约 5% | 全量 open 归 0（测试文件除外见 §2） |
| 第 5 批 | 测试文件收尾（见 §2） | 剩余 | 全量 open 归 0 |

每批一个分支 + 一个 PR，合入前跑全套验证（vitest、typecheck、build、E2E；
见 Dependabot 清单 §4 的同一套命令）。**不要把多批塞进一个 PR**，出了回归
定位不到是哪批。

## 2. 测试文件处理规范（newtab.test.mjs、algo-numbers-verify.test 等）

测试文件里的警报分两类，处理方式不同：

### 2.1 优先顺手修复：测试断言写法问题

- 典型：测试里用字符串包含判断 URL（如 `expect(url.includes('github.com')).toBe(true)`），
  触发 `js/incomplete-url-substring-sanitization`。
- 修法：改用 `new URL()` 解析后比对 hostname，与生产代码同一标准：
  ```js
  // 改前（触发警报）
  expect(link.includes('github.com')).toBe(true);
  // 改后（与生产代码同一校验口径）
  const { hostname } = new URL(link);
  expect(hostname === 'github.com' || hostname.endsWith('.github.com')).toBe(true);
  ```
- 涉及文件（已知）：`extensions/chrome-extension/test/newtab.test.mjs`、
  `apps/web-overlay/test/algo-numbers-verify.test.ts`（以及盘点报告里同规则的其他测试文件）。

### 2.2 仅对故意构造恶意载荷的测试样本用 dismiss

- 适用：测试本身就是在构造恶意输入（如 XSS payload、畸形 URL）去验证防御逻辑，
  警报标的是**测试样本**而非生产代码。
- 做法：GitHub 警报页面 → Dismiss alert → 理由选 **`used in tests`**，
  并在评论里写清该样本在测什么（例：「该字符串是 XSS 防御测试的恶意样本，
  预期被转义，见 save-annotations.test.ts:xx」）。
- **不许用 dismiss 清生产代码警报**，也不许用 `// codeql[rule]: ignore` 之类
  的注释屏蔽（与高危修复任务的「禁止简单注释屏蔽」同一口径）。

## 3. 高危修复任务的衔接

- 四类高危修复（LLM ReDoS、HTML 过滤/转义、URL 子串误判、插件审计资源耗尽）
  另有专线在做（分支 `evo/codeql-high-fix-1121`），覆盖警报 #128–#146 等；
  本清单的第 1–2 批不要重复派那几处，先等专线合入再重跑盘点对数。
- 专线合入后重跑盘点：`node scripts/codeql-triage.mjs --out docs/security/codeql-triage-report-YYYY-MM-DD.md`，
  确认对应规则数下降。

## 4. PR 防线启用时序（防一边修旧账一边欠新债）

- [ ] 立即配 Ruleset（见 `docs/security/pr-security-gate.md` §2）：
  Severity = High，Alerts = **Only new alerts**，Enforcement = **Evaluate**。
- [ ] 跑 1–2 周确认无误报后切 **Active**。
- [ ] 存量清到 0 后把 Alerts 改为 **All alerts**（全量阻断）。
- [ ] 可选：Severity 收紧到 Medium。

## 5. 每周复盘（直到清零）

- 每周一（Dependabot 开 PR 的同一天）重跑一次盘点脚本，更新本文件 §1 的
  批次进度（已清 / 剩余 / 新入）。
- 新入警报（上周 0 → 本周新增）单独列出：若是存量规则复发，查是不是某次
  合入把旧代码带回来了；若是新规则，先看是不是 PR 防线漏了。
- 清零当天：把 Ruleset 切到 All alerts，并在本文件顶部记下清零日期与
  最后一条警报的关闭 commit SHA。
