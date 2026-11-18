# U-97 修复线 — 检查点日志

- 分支：`fix/u97-icon-c1-expectations`
- 克隆：`~/workspace/znwzdh-u97-2026-11-18`（基底 main head `9dcef7f7`）
- 证据目录：`~/workspace/u97-2026-11-18/`
- 派单：第 3 次（前两批同任务子代理均被守护进程重启杀死）；本轮首要纪律：每步落盘提交。

## 任务
定性并修复图标 C1 批量测试在 603bbec2/2f1dbfc1 上连红的问题
（b2a/b1b/b2b 共 5 处断言 `expected '/brand-icons/github.svg' to be ''`）。

## 定性计划
1. 读 C1 提交 `b0273a8c` 与 `site-favicon.tsx` 回退逻辑，确认 GitHub 标题规则是刻意行为改进还是改错。
2. 读 b2a/b1b/b2b 三测试原文，确认 5 处 `''` 期望的立论时点与依据（B2a 时 HEAD 803efd91 实测为空串）。
3. 核查 `public/brand-icons/github.svg` 是否真实落盘、内容是否为 GitHub 官方标；核查 C1 注释声称的“全库仅 3 标题含 github”是否属实（navigation.json / navigation-default.json）。
4. 本地复现三测试文件的失败，数清失败数是否与 CI annotations 的 5 处吻合（b2a it.each 2 + b1b 单 it 1 + b2b it.each 2 = 5）。
5. 按定性修最小范围：若为 (a) 行为改进未同步期望 → 只改三测试的期望值与过期注释，不动产品代码；若为 (b) 回退逻辑改错 → 停手报 ISSUES，不盲改。
6. 定向测试（b2a/b1b/b2b/c1 及全部 site-favicon-iconbatch*）+ 前端 typecheck 全绿后提交并推送，推送后回读确认 head SHA。

## 状态
- [x] 2026-11-18 17:59 检查点 0：克隆状态核实（分支 fix/u97-icon-c1-expectations，head 9dcef7f7，工作区干净，0 提交）；PROGRESS.md 落盘并提交（本 commit）。
- [x] 2026-11-18 18:2x 定性完成：定性 (a) 行为改进未同步期望，定性报告见 QUALITATIVE-REPORT.md（证据：C1 提交信息与注释明写标题规则；github.svg md5 6d802f68… 与官方 favicon.svg 及 copilot.svg 一致；全库标题含 github 恰 3 站、Copilot 先行命中；5 处 '' 期望均立论于 C1 之前；无其他图标断言红）。本地复现待 node_modules 拷贝完成（源 znwzdh-iconbatch-2122，cp -r --no-preserve=ownership，不带 xattr）。
- [x] 2026-11-18 18:28 本地复现：修前 4 文件 5 failed / 70 passed（b2a 2 + b1b 1 + b2b 2，断言与 CI annotations 逐字一致），c1 全绿；复现日志 /tmp/u97-repro.log。
- [x] 2026-11-18 18:29 修复：只改三测试文件 5 处期望 '' → '/brand-icons/github.svg' + 过期注释同步（b2a :43-46、b1b :65-69 与文件头、b2b :40-50）；不动产品代码、不删结构断言。修后 4 文件 75/75 全绿，全部 24 个 iconbatch 文件 247/247 全绿；前端 typecheck 0 错（首跑 2 错为包级 node_modules 缺失的环境假报，补拷 packages/*/node_modules 后 0 错）。
- [ ] 修复提交
- [ ] 推送并回读确认

## 初步发现（待复现验证）
- `site-favicon.tsx:569`：`if (lowerTitle.includes('github')) return '/brand-icons/github.svg'`，C1 提交信息明写“GitHub（标题规则，严禁 github.com 键）”；规则顺序 cline → copilot → langgraph → qwen → vllm → github，更具体的规则在前，未截胡。
- C1 测试文件已明确期望 GitHub / GitHub Trending → `/brand-icons/github.svg`，并注明“C4 加 'trending' 规则后改期望”。
- `public/brand-icons/github.svg` 已落盘；b2a/b1b/b2b 的 `''` 期望立论于 C1 之前（B2a 注释：HEAD 803efd91 实测为空串）。
- 倾向定性 (a) 行为改进未同步期望，待复现与全库标题核查后定稿。
