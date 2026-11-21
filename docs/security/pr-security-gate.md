# PR 安全防线：Code Scanning 警报阻断配置

> 目标：**新引入的 Critical / High 警报直接阻断 PR 合并**，防止一边修旧账一边欠新债。
> 存量 133 条 open 警报先豁免（ grandfathered ），清零后再收紧。

## 1. 前置条件

- 仓库已开 Code Scanning（现状：133 条 open 警报在跑，说明已开）。
- 公开仓库的 CodeQL 免费；若仓库将来转私有，需 GitHub Advanced Security
  许可才能继续用 Code Scanning 阻断。
- 操作人需仓库 Admin 权限（Rulesets 只能由 Admin 建）。

## 2. 推荐方案：Branch Ruleset（分支规则集）+ Code Scanning 规则

GitHub 在 Branch protection rulesets 里提供原生的 **Code scanning** 规则，
可按严重程度 +「仅新引入」设阈值。这是唯一不用写自定义 Action 就能做到
「只拦新债、不拦存量」的做法。

### 配置路径

```
仓库 → Settings → Rules → Rulesets → New ruleset → New branch ruleset
```

### 规则集配置（逐项填）

| 字段 | 填法 |
|------|------|
| Ruleset name | `main-code-scanning-gate` |
| Enforcement status | 先选 **Evaluate**（只记录、不阻断，跑 1–2 周确认无误报），再切 **Active** |
| Target branches | `Include default branch`（即 main），或写分支名模式 `main` |
| Branch protections → Require a pull request before merging | 勾选（已有的话保持） |
| Branch protections → Require status checks to pass | 勾选，并把 CodeQL 分析检查（`CodeQL`）加进 required checks（见 §3） |
| Rules → **Code scanning** | 点 Add rule → 选 **Code scanning**，配置见下表 |

### Code scanning 规则阈值（核心）

| 字段 | 填法 | 说明 |
|------|------|------|
| Severity threshold | **High**（即 High 及以上，含 Critical） | Critical / High 新警报直接阻断 |
| Alerts | **Only new alerts**（仅新引入的警报） | 关键：存量 133 条不触发阻断，只有 PR 新引入的才拦 |
| Tool | CodeQL（默认） | 若以后接第三方 SARIF 工具再另加 |

> 「Only new alerts」的判定：GitHub 对比 PR 分支与 base 分支的警报集合，
> 只在 PR 里新增的警报才计数；存量警报即使还在 open 也不阻断。

### 存量豁免 → 收紧的路线图

| 阶段 | Code scanning 规则 | 说明 |
|------|-------------------|------|
| 现在（存量 133 条） | Severity = High，Alerts = **Only new alerts** | 只拦新债，存量继续按 `docs/security/codeql-clearance-checklist.md` 分批清 |
| 存量清到 0 后 | Severity = High，Alerts = **All alerts** | 改为全部警报都拦（此时存量为 0，无痛切换） |
| 可选收紧 | Severity = Medium | 把 Medium 也纳入阻断（等 High 清零且团队适应后再议） |

## 3. 配套：把 CodeQL 分析设为必需检查

只配 §2 的 Code scanning 规则还不够：还得保证 PR 一定跑了 CodeQL 分析，
否则没分析就没警报、规则形同虚设。

```
仓库 → Settings → Rules → Rulesets → 上面的 main-code-scanning-gate
  → Branch protections → Require status checks to pass → 勾选
  → 在搜索框里加 CodeQL 的检查名（默认配置下叫 `CodeQL`；
     若以后改高级配置、检查名变了，以 Actions 页面实际显示的名字为准）
```

注意：默认配置（Default setup）的 CodeQL 检查名是 `CodeQL`；不要把
`ci.yml` 里的其他检查（如 `CI`）和它混淆。

## 4. 不推荐的替代做法（写明为什么不用）

| 做法 | 为什么不用 |
|------|-----------|
| 旧式 Branch protection（Settings → Branches → Add rule） | 旧式规则没有 Code scanning 阈值选项，只能配 status checks；新仓库一律用 Rulesets |
| Alerts = All alerts（现在就全量阻断） | 存量 133 条 open，配了等于所有 PR 都合不进去，只能先清零再切（见 §2 路线图） |
| 自定义 Action 扫 diff 再 fail | 能实现，但要自己维护 SARIF 比对逻辑；GitHub 原生规则已覆盖，优先用原生 |
| 只靠 Dependabot 自动 PR | Dependabot 只管依赖漏洞，不管 CodeQL 代码警报；两条线都要配 |

## 5. 验证（配好后必做）

1. Ruleset 先放 **Evaluate** 模式，开一个故意引入 High 警报的测试 PR
   （如在测试文件里写一段 `eval(userInput)`），确认 Ruleset 的评估记录里
   出现该警报被标记为「would block」。
2. 确认无误报后把 Enforcement status 切到 **Active**。
3. 再开一个干净 PR，确认能正常合入（存量警报不阻断）。
4. 把测试 PR 关掉（不要合入），并在 `docs/security/codeql-clearance-checklist.md`
   里记下验证日期与 Ruleset 名。

## 6. 相关入口速查

- Rulesets：https://github.com/xujinlong76-star/znwzdh/settings/rules
- Code Scanning 警报列表：https://github.com/xujinlong76-star/znwzdh/security/code-scanning
- Dependabot 警报列表：https://github.com/xujinlong76-star/znwzdh/security/dependabot
- CodeQL 默认配置说明：仓库 `.github/codeql/codeql-config.yml`
