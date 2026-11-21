# Dependabot 12 个漏洞安全升级执行清单

> 适用仓库：xujinlong76-star/znwzdh（pnpm 11.7.0，Node >= 24）
> 状态：2026-11-21 盘点时本机 PAT 缺「Dependabot alerts: Read」权限，
> API 取不到 12 条明细（403）。先按 §1 取到清单再填 §2 的表，**不要凭记忆编漏洞名**。

## 0. 前置：确认包管理器与升级机制

- 包管理器：**pnpm 11.7.0**（根 `package.json` 的 `packageManager` 字段锁定）。
- 直接依赖：各 `package.json` 的 `dependencies` / `devDependencies`。
- 传递依赖：**只能走 `pnpm-workspace.yaml` 的 `overrides:`**（pnpm 11 起不再读
  `package.json` 的 `pnpm` 字段，那里写了也失效；见该文件 §87 起的注释）。
- 升级后锁文件必须同步：`pnpm install --frozen-lockfile` 能过才算锁文件一致。
- Dependabot 已配好（`.github/dependabot.yml`）：每周一 08:00（Asia/Shanghai）开 PR，
  安全更新单独成组、优先级最高，`open-pull-requests-limit: 5`。

## 1. 取到 12 条漏洞明细（先做这步，再填表）

任选一种（按可操作性排序）：

```bash
# A. 有权限的令牌（细粒度 PAT 需 Dependabot alerts: Read；经典 PAT 需 security_events: read）
export GH_TOKEN='<有权限的 token>'   # 绝不写进文件、绝不打印
node scripts/codeql-triage.mjs --dependabot --out docs/security/codeql-triage-report-YYYY-MM-DD.md

# B. gh CLI（已登录且有权限时）
gh api repos/xujinlong76-star/znwzdh/dependabot/alerts --paginate \
  -q '.[] | [.number, .dependency.package.name, .security_advisory.severity, .security_advisory.ghsa_id, .dependency_manifest_path] | @tsv'

# C. 网页（无令牌时）：仓库 → Security → Dependabot alerts → 筛 state=open，逐条抄进 §2 的表
#    https://github.com/xujinlong76-star/znwzdh/security/dependabot
```

## 2. 漏洞登记表（12 条，取到明细后逐条填）

| # | 包名 | 严重程度 | GHSA | 影响版本 | 修复版本 | 直接/传递 | 所在清单 |
|---|------|----------|------|----------|----------|-----------|----------|
| 1 | （待填） | | | | | 直接 / 传递 | package.json 路径或 overrides 键 |
| … | | | | | | | |
| 12 | | | | | | | |

填表规则：
- 「直接/传递」判定：`pnpm why <包名>`（看是谁依赖它）；只在某个 `package.json`
  里出现才是直接依赖，否则是传递依赖。
- 同一个包多条警报（如不同 GHSA）合并成一行处理，取最严的严重程度。

## 3. 升级执行（按严重程度降序，一批一验证）

### 3.1 直接依赖

```bash
# 单个升级（先 critical/high，再 medium/low；一次只升一个包，便于定位回归）
pnpm --filter <包所在 workspace 名> update <包名>@<修复版本>
# 例：pnpm --filter @navhub/api update fastify@<修复版本>

# 升级后立刻核对锁文件与安装
pnpm install --frozen-lockfile
pnpm audit --prod --audit-level high   # 生产依赖高危必须 0 条
```

### 3.2 传递依赖（走 overrides，不改各包 package.json）

```bash
# 1) 在 pnpm-workspace.yaml 的 overrides: 区加/改一行（仿照现有格式，带 GHSA 注释与复核到期日）
#    例：
#      # <包名> GHSA-xxxx-yyyy-zzzz，修复版 >=x.y.z（复核到期 2027-03-31）
#      <包名>: '>=<修复版本>'
# 2) 同步锁文件与 Docker 部分清单（否则报 ERR_PNPM_LOCKFILE_CONFIG_MISMATCH）
pnpm install
# 3) 核对解析结果确实落到修复版
pnpm why <包名>
pnpm audit --prod --audit-level high
```

注意：
- 现有 overrides 台账（`pnpm-workspace.yaml` §64–86）已有 brace-expansion、
  nanoid、sharp、undici、body-parser、next 16.4.5、tinypool、postcss、ws、
  nodemailer、fast-uri、qs、ip-address、zod 等钉版；新加的 override 要同步
  写进台账（复核到期日统一取季度末）。
- 若某条旧 override 的上游已发修复版且本轮升级覆盖了它，**顺手解除**（删 override
  行 + 台账行），不要留着过期钉版。

## 4. 升级后验证（每批必跑，缺一不可）

```bash
# 4.1 锁文件一致 + 生产审计
pnpm install --frozen-lockfile
pnpm audit --prod --audit-level high

# 4.2 全量单测（SQLite 默认方言）
pnpm test

# 4.3 跨方言单测（PostgreSQL；未设 NAVHUB_TEST_DATABASE_URL 会直接失败，见 scripts/pg-check.mts）
pnpm test:pg

# 4.4 类型检查（5 包）
pnpm typecheck
node scripts/check-frontend-typecheck.mjs

# 4.5 生产构建（防 OOM：NODE_OPTIONS=--max-old-space-size=4096；量测类构建放最后）
NODE_OPTIONS=--max-old-space-size=4096 pnpm build

# 4.6 全套 Playwright E2E
pnpm test:e2e
```

通过标准：`pnpm audit --prod --audit-level high` 0 条；vitest 全绿；
`typecheck` 5 包 0 错；`build` exit 0；Playwright E2E 全绿。
**任何一项红了就回滚该批升级（`git checkout -- pnpm-lock.yaml pnpm-workspace.yaml` +
对应 package.json），不要带着红往下升。**

## 5. 破坏性大版本回归防护

- **major 版本升级（如 next / react / express 大版本）不走本清单**：单独开分支、
  按 `.github/dependabot.yml` 的 `framework-risky` 分组逐个验证（next、react、
  react-dom、next-auth 已单独成组）。
- minor/patch 升级也可能带破坏性改动：升级前读该包的 CHANGELOG / GitHub Release
  的 Breaking changes 一节，有 Breaking changes 就按 major 处理。
- 若某漏洞只有 major 版才修复、且当下升不上去：先用 `overrides` 钉到已修复的
  最高 minor/patch 版顶着，并在 §2 的表里标注「待 major 升级」，不要硬升 major。

## 6. 提交与合入

- 一批漏洞一个提交，提交信息写清：包名、从哪版到哪版、GHSA、直接/传递、
  验证结果（audit / vitest / typecheck / build / E2E 各自通过）。
- 走正常 PR + CI 全绿再合入；不要 `--no-verify` 跳过门禁（pre-commit 全量
  typecheck 约 77 秒，守护进程重启频发时用定向验证先行、再补全量）。
- 合入后在 §2 的表里把该行标为已关闭，并记下合入 commit SHA。
