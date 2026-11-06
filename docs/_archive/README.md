# docs/_archive/ 归档说明（README）

> 本文件是给人读的中文说明。目录 `docs/_archive/` 由 2026-11-06 文档治理新建，
> 用于承接「从 docs/ 根目录挪出去的历史文档」。**本轮治理不移动、不修改任何已存在的 .md**
> （工作区有 64 个并行会话的未提交改动，历史文档一律保持原位）。

---

## 这个目录是干什么的

`docs/` 下现有 87 份 git 已跟踪的 .md（2026-11-06 实测，见 `docs/docs-index.json` 的
`counts.docsMdGitTracked`），按「日期 + 轮次」平铺，例如
`UPGRADE-EXECUTION-2026-10-24.md` 与它的 `-PASS2` / `-PASS3` / `-PASS4` / `-PASS5` 五份，
或 `AUDIT-2026-10-20.md` 与 `-PASS2` / `-PASS3`。
光看文件名分不清「哪份描述当前行为、哪份只是某一轮的记录」。

本目录是**将来**做历史归档时的落点。按 `docs/INDEX.md` 的约定：

| 标记 | 含义 | 代码改动时要不要同步 |
|---|---|---|
| **现行** | 描述当前行为 / 当前约定 | **要**，否则文档会骗人 |
| **历史** | 某一轮的执行记录、当时的判断 | 不要，保留原样 |
| **提案** | 方案与取舍，可能只落地了一部分 | 落地时把结论挪进「现行」 |

**历史文档不回写、不改写**——它们记录的是当时的事实，改了就失去证据价值。

---

## 当前状态（诚实说明）

- 本目录**目前为空**（只有本 README）。本轮没有搬移任何文件。
- 归档不是自动发生的：挪动 .md 会改变路径，牵连 `docs/INDEX.md`、`docs/docs-index.json`、
  `docs/CODEBASE_OVERVIEW.md` 等处的链接与计数，属于需要单独评审的改动。
- 因此本目录现在只立「规矩」，不做「动作」。

---

## 将来真要归档时，按这个流程

1. **确认是历史**：该 .md 已不被 `docs/INDEX.md` 标为「现行」，且被 `docs/docs-index.json`
   标为 `status: "historical"` 或 `"proposal"`（状态由 `scripts/gen-docs-index.mjs` 的
   `inferStatus()` 按文件名前缀推断，可在 `DOC_STATUS` 里显式覆盖）。
2. **同一次提交里改三处**：把文件 `git mv` 进 `docs/_archive/<原文件名>`；
   更新 `docs/INDEX.md` 的链接；跑 `node scripts/gen-docs-index.mjs` 重新生成
   `docs/docs-index.json`（索引以磁盘全量为口径，移动后会自动反映新路径）。
3. **跑棘轮**：`node scripts/gen-docs-index.mjs --check` 应为 exit 0。
4. **不要顺手改内容**：归档只挪位置，不修订历史结论。

> 反向约束：`docs/_archive/` 下若再新增 .md，同样会被 `--check` 纳入登记棘轮
> （未登记即 exit 1），所以「挪进来却忘了重新生成索引」是会红的，不会静默漏掉。

---

## 相关文件

| 文件 | 作用 |
|---|---|
| [docs/INDEX.md](../INDEX.md) | 按「我要做什么」组织的人读索引，定义 现行 / 历史 / 提案 三态 |
| [docs/docs-index.json](../docs-index.json) | machine-readable 全量 .md 登记，由生成器产出 |
| [scripts/gen-docs-index.mjs](../../scripts/gen-docs-index.mjs) | 默认生成 / `--check` 校验（新增 .md 未登记即 exit 1） |
| [docs/seo/CURRENT.md](../seo/CURRENT.md) | seo/ 子目录的「现行口径」入口 |
