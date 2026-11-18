# U-97 定性报告 — 图标 C1 批量测试连红（b2a / b1b / b2b 共 5 处）

- 定性日期：2026-11-18 18:2x CST
- 定性基底：分支 `fix/u97-icon-c1-expectations`，head `1aa716e1`（基底 main `9dcef7f7`）
- 结论：**(a) 行为改进未同步期望——只改三测试的期望值与过期注释，不动产品代码。**

## 1. 失败断言（CI annotations，603bbec2 / 2f1dbfc1 逐字相同，5 处）

| # | 文件 | 位置 | 断言原文 |
|---|---|---|---|
| 1 | `site-favicon-iconbatch-b2a.test.ts` | CASES :45 | `GitHub` 期望 `''`，实得 `'/brand-icons/github.svg'` |
| 2 | `site-favicon-iconbatch-b2a.test.ts` | CASES :46 | `GitHub Trending` 期望 `''`，实得 `'/brand-icons/github.svg'` |
| 3 | `site-favicon-iconbatch-b1b.test.ts` | R2 未波及 it :68 | `GitHub` 期望 `''`，实得 `'/brand-icons/github.svg'`（同 it :69 Trending 亦过期，首断言失败即停） |
| 4 | `site-favicon-iconbatch-b2b.test.ts` | UNAFFECTED :49 | `GitHub` 期望 `''`，实得 `'/brand-icons/github.svg'` |
| 5 | `site-favicon-iconbatch-b2b.test.ts` | UNAFFECTED :50 | `GitHub Trending` 期望 `''`，实得 `'/brand-icons/github.svg'` |

计数与雷达一致：b2a it.each 2 + b1b 单 it 1 + b2b it.each 2 = 5。

## 2. C1 的 GitHub 规则是刻意行为改进（证据链）

1. **提交信息明写**：`b0273a8c feat(icons): C1 batch 1 — 19 brand icons local + wiring + tests`，
   正文 "G2 智谱清言/讯飞星火/n8n/GitHub（标题规则，严禁 github.com 键）"。
2. **代码注释明写**（`site-favicon.tsx` C1 段）：GitHub 走标题规则；子串 `'github'`
   全库仅命中 3 标题；Copilot 由上方 `'copilot'` 规则先行命中；Trending 暂由本条命中，
   C4 加 `'trending'` 规则时必须放在本条之前。
3. **C1 自带测试已同步期望**：`site-favicon-iconbatch-c1.test.ts:53,55` 明确期望
   GitHub / GitHub Trending → `'/brand-icons/github.svg'`，并注明 "C4 加 'trending'
   规则后改期望"；Copilot 回归钉死仍为 `copilot.svg`（:57）。
4. **规则顺序正确**（`site-favicon.tsx`，均在 map 精确查找与 GitHub 组织头像分支之前）：
   `cline` → `copilot` → `langgraph` → `qwen` → `vllm` → `github`。
   更具体的规则在前，GitHub 规则截胡不了任何一站。

## 3. 落盘图标是真实官方标（非重画、非第三方 logo 站）

- `public/brand-icons/github.svg` 已落盘，959 B，`viewBox="0 0 32 32"`，fill `#24292E`。
- md5 `6d802f68df0c09a4997cfd28eeafd9ff`，与 `copilot.svg` **逐字节相同**，
  且与 b1b 测试注释引用的官方来源 md5（GitHub Copilot 产品页声明的
  `github.githubassets.com/favicons/favicon.svg`，959 B）**完全一致**。
  C1 注释称来源为官网首页 `<link rel="icon">` 声明的同一 favicon.svg，互相印证。

## 4. 波及面核查：C1 注释的“仅 3 标题”属实

对本克隆 `navigation.json` 全量标题遍历（409 个带标题条目）：

- 标题含子串 `github`（不分大小写）恰为 3 站：`GitHub Copilot`、`GitHub`、`GitHub Trending`。
- 其中 `GitHub Copilot` 由上方 `'copilot'` 规则先行命中，不受 github 规则影响。
- `github.com` 域名共 7 站：Cline、GitHub Copilot、LangGraph、Qwen 3、vLLM、GitHub、
  GitHub Trending——与 C1 / b1b / b2b 注释的 "7 站共享域名" 一致。
- `navigation-default.json`（105 标题）中含 `github` 的仅 `GitHub Copilot` 一站；
  GitHub / GitHub Trending 不在默认模板内，但规则按标题工作，不依赖数据文件，
  不受影响。
- `LOCAL_LOGO_MAP` 中无 `'github.com'` 键：三测试的结构断言
  （b2a :106、b1b :80-81、b2b :74-76）仍成立、仍有效，不可删。

## 5. 5 处 `''` 期望的立论时点：均立论于 C1 之前，已过期

- b2a :43-44 注释自述："改动前返回值为空串（Python 复现 resolveSiteIcon，HEAD 803efd91 实测），改动后仍为空串"——
  该 "改动" 指 B2a 批（LangGraph / Qwen 3 标题规则），当时 GitHub 规则尚不存在，`''` 正确；
  C1 合入后该前提已变。
- b1b :65-69 与 b2b :40-43 注释均写 "GitHub / GitHub Trending 不受任何一批影响，仍为空串"，
  且 b1b / b2b 自身已确立先例："期望值随先合入批次更新"（b1b :70-72、b2b :41-43，
  LangGraph / Qwen 3 随 B2a 合入后由组织头像改为本地路径时即同步改过期望）。
  本次是同一先例的再次适用：GitHub / GitHub Trending 随 C1 合入后改为本地路径。

## 6. 排除 (b) 回退逻辑改错的理由

- GitHub 规则未动任何既有规则的顺序与返回值：Cline / Copilot / LangGraph / Qwen 3 / vLLM
  的期望在 C1 测试与 b2a/b1b/b2b 的其余断言中均未变红（CI annotations 仅 5 处 GitHub 断言，
  无其他图标断言失败）。
- 未加 `'github.com'` 域名键：R2 裁决的红线未被触犯，7 站共享域名问题仍由标题规则解决。
- 图标来源、尺寸、落盘均真实且与官方 md5 一致，无 "改错" 的事实基础。

## 7. 修法（最小范围，只改测试）

只改三测试文件，共 5 处期望值 `''` → `'/brand-icons/github.svg'`，并同步更新
已过期的注释（"仍为空串" / "不受任何一批影响" → "随 C1 合入后走本地路径"，
注明 C4 为 Trending 加 `'trending'` 规则时须再同步改期望）。不动
`site-favicon.tsx`、不动 `LOCAL_LOGO_MAP`、不删结构断言、不碰 E2E 规格与猫挂件文件。

- b2a：CASES :45-46 两处 + :43-44 注释。
- b1b：R2 未波及 it :68-69 两处 + :65-67 注释（同 it 内 LangGraph / Qwen 3 期望不变）。
- b2b：UNAFFECTED :49-50 两处 + :40-43 注释。

## 8. 交叉验证：9dcef7f7 CI 分片 1/3、2/3 failure 与本项吻合

- 9dcef7f7 基底含 C1（603bbec2 已合入），三测试文件在该基底上即含上述 5 处过期断言；
  分片 1/3、2/3 failure 与 U-97 失败用例位置吻合（分片划分未逐一核对，
  但失败用例集合与分片红完全一致，无其他新增失败用例指向本项之外）。
- ai-chat 超时在 2f1dbfc1 上未再现，疑为 flake，不归本项，不修。

## 9. 本地复现与验证（待补：node_modules 拷贝完成后）

- 复现：`pnpm exec vitest run apps/web-overlay/test/site-favicon-iconbatch-b2a.test.ts apps/web-overlay/test/site-favicon-iconbatch-b1b.test.ts apps/web-overlay/test/site-favicon-iconbatch-b2b.test.ts apps/web-overlay/test/site-favicon-iconbatch-c1.test.ts`
- 修复后：同命令全绿 + `node scripts/check-frontend-typecheck.mjs` 0 错。
