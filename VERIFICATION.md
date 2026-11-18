# U-36 导航分片实施 — VERIFICATION.md

> 分支 `u36-navigation-sharding`，基底 main `61e597a`，head **`6ea7e16`**（本文件提交时）。
> 结论：**ISSUES** —— 1–6 项全部通过，第 7 项（:3001 灰度）为 INCONCLUSIVE（代码未部署到电脑，见第 7 节；不是实现问题，须合入并同步实况树后由主聊补验）。
> 工作区：`~/workspace/znwzdh-u36-sharding-2026-11-18`（--depth 1 克隆 main，唯一 owner；未推送）。

## 1. 量测（已做，直接用）— 通过

| 量测 | 数值 | 来源 |
|---|---|---|
| public 快照字符数（Next 口径 JSON.stringify.length） | **2,087,826** | 2026-11-18 电脑实库 :8787 `/api/storage` 实测 |
| public 快照字节数 | 2,465,915 | 同上 |
| 站数 | **4,850**（active 4,833 + broken 17） | 同上 |
| 离 2MB 上限（2,097,152）余量 | **9,326 字符**（再增 14–15 站即冻结） | 同上 |
| fetch-cache 旧 navigation 条目 | 无（全仓搜 "navigation.json" 0 命中，无冻结） | 同上 |
| /metrics gauge | :8787 上 404，读不到 | 同上 |
| 每顶级分类站数（实库分布） | 20 个一级分类，最大 340 站（AI 工具、消费生活），合计 4,850 | 2026-11-18 SSH 读电脑 `nav-public.json` |

## 2. 中枢派生 — 通过

- 新增 `apps/api/src/navigation-shards.ts`：纯函数 `deriveNavigationShards(doc, sourceVersion)`。
- 产物：`navigation-index.json`（提交标记，writes 数组最后落库）+ `navigation-cat-<id>.json`；单分类超 750KB 时切子片 `navigation-cat-<id>-p<页>.json`（二分切分，页号从 1 起连续）。
- 单分片 ≤750KB（字符数与字节双口径）；index 带 `sourceVersion`，各分片一致；派生失败抛错（写路径 catch）。
- 派生性能：4,850 站 197ms；2,000 站单分类 243ms（初版逐条试加是 O(n²)：7.7 秒 / 14.8 秒，已改二分切分，输出逐字一致，见 commit d09c338）。

证据：`apps/api/test/navigation-shards.test.ts` **12/12 通过**（命令见 §5）：
- 4,850 站合成文档（复刻实库分布）：21 笔写（20 分片 + index，index 最后）、totalItems 4,850、最大分片 126,848 字符 / 158,240 字节、index 15,698 字符；
- 拼装树在渲染字段上与整包逐字等值；分片里不含重字段（`weight/trendScore/actions/relations/liveMetrics/workspaces` 均无）；
- 全部产物同一 sourceVersion；源文档形状不对时抛错；
- 2,000 站超大分类切 2 子片（593,387 + 105,433 字符），拼装后条数与顺序不变；实库最大分类 340 站时单片走基础路径（不带 -p 后缀）。

## 3. 写路径接线 — 通过

- `apps/api/src/storage.ts`：`writeNavigationData` 提交后（事务 + 标签同步/向量回填/分面回填之后、`return result` 之前）同步派生。
- 纪律照抄 `writeVideosData`：派生失败只记 error 日志、不连带写失败；`data_version` 取不到时跳过并 warn；index 最后落库作提交标记。
- 派生源是提交后重建的 **public 快照**（不是本次提交的输入文档——输入可能含停用站，public 投影才是首页真实读到的内容）；写回本体（raw 全量快照 + 全量对齐）一行不改。
- 4,850 站本地集成验证（走真实写路径，脚本 `/tmp/u36-integration-4850.mjs`，`node --experimental-strip-types`）：
  - `writeNavigationData(4850)` 12,027ms（含事务 + 分面回填 4,850 站；派生本身约 200ms）；
  - `version 24502 === index.sourceVersion`；`index.totalItems 4850`，20 分类；
  - 最大分片 135,349 字符 / 166,741 字节，**全部在 750KB 红线内**；分片字符合计 1,936,066 vs 整包 3,201,941；
  - 第二次写（改一站标题）：版本 24502 → 24749，index 跟随，分片标题跟随。

## 4. web 读路径（旗标后）— 通过

- 新增 `apps/web-overlay/src/lib/navigation-catalog-paths.ts`（常量，与中枢逐字一致）与 `navigation-catalog-read.ts`：
  - `loadNavigationCatalog()`：读 index + 并行读分片（经 `getFileContent`，复用其 Data Cache 条目与 `storageTag(path)` 标签；`cache()` 与 2.5 秒微缓存是 `getFileContent` 自带机制，读路径不另造）；版本/条数/分类 id 任一校验不过 → 回落整包读并标 `degraded`；
  - `loadNavigationCategoryById()`：单分类按需读，只读该分类的片；
  - 开关 `NAVHUB_NAVIGATION_READ_MODE`：未设置/shard → 分片（默认），doc → 整包（秒级回滚位），脏值 → 回 doc 并 warn。
- 瘦身投影 C：分片站点只带渲染字段（id/title/href/description/icon/enabled/status/tags/health + videoConfig/useDefaultIcon 透传）；重字段不在分片里。
  - **安全性核实（设计笔记审计结论有误，已纠正）**：设计笔记称重字段只被速览弹窗消费，但实测 `navigation-card.tsx`、`diy-presets.ts`、`workspace-matching.ts`、`trending-widget.tsx`、`admin/stats`、`admin/audit` 也有读数。逐项核实后结论仍是安全，原因是 **`processNavigationSubItem` 早已把重字段裁掉**——卡片/弹窗拿到的是处理后条目，这些读数今天就是死的（恒为 undefined）；`data-loader-tags.test.ts` 文件头也明文钉住「relations/actions/liveMetrics 仍然裁掉」。瘦身只让分片与处理后条目一致，不改变任何渲染输出。
  - 速览弹窗按站懒取：`site-peek-dialog.tsx` 打开时 GET `/api/hub/sites/:id`（中枢单站接口，返回整站行含重字段），补齐 actions/relations/liveMetrics/workspaces；取不到回落 item 自带值（与改造前一致，不报错）。
- 首页 `page.tsx`（ISR `revalidate=60` 不动）与考试页 `loadExamPrepSites` 改读分片；`github.ts` 写 navigation.json 后一并失效 index 与各分类分片标签（基础路径 + p1–p4；保存后刷新即见新值）。
- 未动的读路径（有意）：`drama`/`import`/`submit` 页与 `/api/home/navigation` 仍读整包（它们要 raw 文档或属低频管理面，行为与改造前逐字一致）；`exam` 页已改分片。

证据：`apps/web-overlay/test/navigation-catalog-read.test.ts` **15/15 通过**（镜像到 `apps/web/test/` 后跑）：
- 分片齐备时拼装且不碰整包；`getProcessedData(拼装树) ≡ getProcessedData(整包树)`（逐字等值，核心断言）；
- 版本撕裂/分片缺失/索引缺失/条数不一致 → 回落整包 + degraded；
- doc 模式与脏值；超大分类多页合并（条目拼接、子分类按 id 归并）；单分类按需读（只读索引 + 目标分片）；路径常量钉子。

## 5. 守卫与测试 — 通过

- R7 证红（先红后绿）：`/tmp/u36-r7-red.cjs`（不依赖待实现模块的纯量测）——4,850 站合成整包 **3,201,941 字符，超 750KB 红线 4.27 倍**；真实 public 快照 2,087,826 字符同样超红线 2.78 倍。测试里同断言（整包 >750KB 且 >2,000,000 字符）钉住。
- `storage-adapter.test.ts` 原有断言全过（见 §6 回归，8 文件 133/133 的一部分）。
- 未删任何守卫断言；新增断言均为新行为（分片体积、等值、回落），无放宽。

## 6. 回归 — 通过

| 检查 | 命令（仓库根跑，`--configLoader native`） | 结果 |
|---|---|---|
| API 新测试 | `vitest run apps/api/test/navigation-shards.test.ts` | **12/12** |
| API 定向回归 | `vitest run apps/api/test/video-shards.test.ts apps/api/test/navigation-snapshot.test.ts apps/api/test/snapshot-version.test.ts apps/api/test/snapshot-cache.test.ts apps/api/test/snapshot-singleflight.test.ts apps/api/test/navigation-shards.test.ts` | **6 文件 42/42** |
| web 新测试 | `vitest run apps/web/test/navigation-catalog-read.test.ts`（镜像后） | **15/15** |
| web 定向回归 | `vitest run apps/web/test/storage-adapter.test.ts apps/web/test/navigation-catalog-read.test.ts apps/web/test/video-catalog-read.test.ts apps/web/test/data-loader-tags.test.ts apps/web/test/exam-page.test.ts apps/web/test/github-hub.test.ts apps/web/test/navigation-save-log.test.ts apps/web/test/category-section-link.test.ts` | **8 文件 133/133** |
| 前端 tsc | `node scripts/check-frontend-typecheck.mjs` | **0 错**（221s） |
| 根 typecheck | `node scripts/typecheck.mjs` | **5/5 通过**（48.7s；中途修 1 个 TS2532：`pages[0]` 判空，commit 6ea7e16） |

注：回归中曾出现 1 个文件级失败（`navigation-save-log.test.ts` 报 `Cannot find package 'next/server'`）——原因是本 worktree 缺 `apps/web/node_modules`（合入库拷贝源就没有它；`apps/web` 的依赖本应由 pnpm 装）。已从同批 worktree（`znwzdh-u34-fix-1822`）`cp -a` 补齐（40 项、68 符号链接、0 断链），重跑 9/9 通过。**不是代码回归**：该文件与 `route.ts` 本任务一行未改；失败在 import 时（模块解析），与改动无关。

环境说明：`node_modules` 从合入库 `~/workspace/znwzdh-merge-clean-2026-11-18` 拷全（根 861 `.pnpm` 项、overlay 40 项、api 9 项、mcp 3 项、packages 4 个；根核对：符号链接 2861=2861、文件 70216=70216、0 字节 183=183）。拷贝教训：`apps/web/node_modules` 在合入库里不存在（镜像目录本无包级 node_modules），须拷 `apps/web-overlay/node_modules`；另 `apps/web/node_modules` 的符号链接指回根 `.pnpm`，须确认 0 断链。

## 7. 灰度验证（:3001）— INCONCLUSIVE（未验证，不写成通过）

- :3001 可达：`curl http://localhost:3001/` → **HTTP 200，0.06s**。
- **缺的东西**：U-36 代码未合入 main、未同步到电脑实况树。实测电脑实况树（`C:\Users\88\Desktop\web\源码镜像`，含 镜 U+955C 的文件夹）：
  - `apps/web-overlay/src/lib/navigation-catalog-read.ts` → **不存在**；
  - `apps/api/src/navigation-shards.ts` → **不存在**。
  - 即 :3001 跑的是旧代码，`NAVHUB_NAVIGATION_READ_MODE` 开关根本不存在，无法开旗标验证；任务亦明文禁止改实况树代码。
- 补验步骤（合入 main 并同步实况树、重启 :3001 后）：在电脑上设 `NAVHUB_NAVIGATION_READ_MODE=shard`（默认即 shard，可不设；回滚用 `=doc`），重启 :3001，确认 Next 日志无 `items over 2MB`、首页 200、分类页/搜索/弹窗逐个点过、管理后台改一站保存后刷新即见新值。
- 本地替代验证已做（§3 的 4,850 站真实写路径集成验证 + §4 的等值测试），但**不等同于 :3001 真机灰度**。

## 改动清单（10 文件，+1397/−18）

| 提交 | 内容 |
|---|---|
| `bbda522` | 中枢派生 + 写路径接线 + 测试先行 |
| `489020b` | web 读路径 + 瘦身 C + 弹窗懒取 + 两页接线 + 标签失效 |
| `d09c338` | 分片打包改二分切分（7.7s→197ms） |
| `009661c` | 修测试夹具（replacementHistory 同源） |
| `6ea7e16` | 修 TS2532（`pages[0]` 判空） |

新增：`apps/api/src/navigation-shards.ts`、`apps/api/test/navigation-shards.test.ts`、`apps/web-overlay/src/lib/navigation-catalog-paths.ts`、`apps/web-overlay/src/lib/navigation-catalog-read.ts`、`apps/web-overlay/test/navigation-catalog-read.test.ts`。
修改：`apps/api/src/storage.ts`（仅写路径尾部加派生钩子，本体一行不改）、`apps/web-overlay/src/app/page.tsx`、`apps/web-overlay/src/app/exam/page.tsx`、`apps/web-overlay/src/lib/github.ts`（仅 `revalidateStorageTag` 加导航分支）、`apps/web-overlay/src/components/site-peek-dialog.tsx`（仅懒取重字段）。
未推送（主聊负责合入与推送）。

## 遗留与提醒

1. **灰度待补**（§7）：合入 + 同步实况树 + 重启 :3001 后按 §7 步骤补验，验收以 Next 日志无 `items over 2MB` 为准。
2. **设计笔记审计结论订正**：重字段的消费方比设计笔记写的更多，但瘦身仍安全（§4 已述原因）；`storage.ts:312` 的旧注释（称前台渲染消费重字段）描述的是 public 快照本体（未改动），不是分片，无需改。
3. **写回成本**：4,850 站整包保存约 12 秒，主因是既有事务 + 分面回填，分片派生本身约 200ms；属一次性管理操作成本，未劣化。
4. `apps/web/test/` 是 `mirror:web` 生成的镜像（gitignored），测试源在 `apps/web-overlay/test/`；合入前须确认镜像已同步（本分支已同步，`mirror:web` 跑过两次，最后一次仅 1 文件变更）。
