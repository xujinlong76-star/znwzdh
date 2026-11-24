# 实施记录 — 2026-11-23 战略研究周一轮方案 A（/llms.txt + .md 试点 + robots 分级）

落盘：2026-11-24，工作克隆 `~/workspace/znwzdh-strategy-1120-w1123`，分支 `strategy/1123-llms-txt`。
实施包：`~/workspace/goals/efficiency-goal-2/hidden_files/strategy-2026-11-23-impl-pack/`（见该包 `MANIFEST.md`）。
用户授权：2026-11-24 10:08 用户 plain 话“继续”，放行该克隆上的落盘 + git/构建/测试 + 提交。
执行风险检查：本轮**未拦住**（上一轮 08:34 曾拦住 git 操作；本轮 git/测试均正常执行，未换克隆、未绕过）。

## 落盘文件（5 个进工作克隆）

| 文件 | 说明 |
| --- | --- |
| `apps/web-overlay/public/llms.txt` | 手写策展，23 条链接，2,653 字节（≤ 8 KB），零核验断言 |
| `apps/web-overlay/public/exam/guokao-checklist.md` | U-285 清单 .md 版，失效日期 2026-11-29 15:00 |
| `apps/web-overlay/src/app/robots.ts` | 覆盖：新增搜索爬虫放行组 + 训练爬虫禁抓组，`*` 组原样保留（落盘前核对过基线与 W8 核查版一致） |
| `apps/web-overlay/test/llms-txt.test.ts` | llms.txt + 清单 .md 守卫（9 个测试） |
| `apps/web-overlay/test/robots-ai-crawlers.test.ts` | robots 分级守卫（4 个测试） |

未动：`sitemap.ts` / `sitemap-entries.ts`、`apps/web/src/app/robots.ts`、主页、Batch 0、Batch 1、brand-icons/。

## 验证结果（2026-11-24 落盘时实测）

- **新测试 13/13 全绿**：仓库正规路径运行（`apps/web/test/` 是 gitignore 的 vendor 镜像，
  已按 vendor 规则把 2 个新测试镜像过去再跑；镜像文件不进提交）：
  `vitest run apps/web/test/llms-txt.test.ts apps/web/test/robots-ai-crawlers.test.ts`
  → 2 文件通过，13 测试通过。
- **关联守卫 56/56 通过**：`sitemap.test.ts`、`sitemap-entries.test.ts`、`seo-invariants.test.ts`、
  `indexation-policy.test.ts`、`category-hub.test.ts` 5 文件全绿。
  `exam-guokao-checklist-u285.test.ts` 无法加载（见下），不是断言失败。
- **tsc**：`tsc -p apps/web-overlay/tsconfig.json` 全仓红（33,522 行、761 文件），是**既有环境问题**，
  不是本次改动造成：overlay 目录按 pnpm workspace 设计没有自己的 node_modules，
  `react`/`next`/`lucide-react` 全仓无法解析（TS2307 占大头）。
  隔离对照：HEAD 版 robots.ts 与新版 robots.ts 在同一 harness 下报错**逐字相同**
  （仅 `Cannot find module 'next'` / `next/headers` + 缺 `@types/node` 的 `process` 报错，
  robots.ts 自身代码零错误）；2 个新测试文件在全仓 tsc 输出里零报错。
  仓库正规 typecheck 路径是 vendor 重建后的 `apps/web`（CI 跑 `node scripts/vendor-web.mjs` 后再检），
  本克隆未跑 vendor（需联网拉上游 tarball，不在本任务范围）。
- **robots.txt 功能渲染**：把新 robots.ts 用 esbuild 打包（`siteOrigin` 桩返回 `http://localhost:3199`）
  后实际执行，输出与预期一致：OAI-SearchBot / Claude-SearchBot / PerplexityBot 放行
  （disallow `/admin`、`/api/`、`/s/`，与 `*` 组一致）；GPTBot / ClaudeBot / Google-Extended /
  CCBot / Bytespider 禁抓整站（`disallow: ['/']`）；`*` 组原样；两条 sitemap 在位。
- **静态文件 HTTP**：工作克隆 `public/` 在 3199 端口静态服务实测：
  `/llms.txt` 200、2,653 B；`/exam/guokao-checklist.md` 200、2,594 B。
- **:3100（2026-11-24 10:09 起两次探活，均一次成功、无需复测）**：`/` 200、`/sitemap.xml` 200、
  `/exam/guokao-checklist` 200（页面未动，仍正常）。但 **:3100 不服务本工作克隆**：
  其进程 cwd 是 `~/workspace/znwzdh-u285-verify/apps/web`，`/llms.txt` 404、`/robots.txt` 仍是旧版
  （无 AI 爬虫分组）——均为“旧克隆无此文件”的预期结果，不是落盘失败。
  要在 :3100 上看到新文件，需从本分支重拉/重启 :3100（共享验证环境，由主聊决定，不在本任务内擅自重启）。

## 阻塞项：2 个分类 .md 试点（未落盘，非编造口径）

MANIFEST §2 第 4 步要求从实时 sitemap 取 `/category/*`、按站点数取前二、每份取 status=active 前 20 条、
名称/链接/一句话说明逐字取自分类页。实测三处来源均无法提供：

1. **:3100 `/sitemap.xml` 无任何 `/category/<slug>` 条目**：只有 `/category` 总览页；
   `/category/sitemap.xml` 返回的是 Next dev 加载壳 HTML（200 但非 XML），不是 sitemap。
   原因是没有分类达标：`MIN_SITES_FOR_CATEGORY_INDEX = 5`（`src/lib/seo/thresholds.ts`），
   不达标的分类不进 sitemap、不生成可索引页。
2. **实时 Hub（:3100 的上游，`localhost:8787`）只有 3 个分类、0 个站点**：
   `GET /api/categories` → 3 条（`prompt-engineering`、`ai-hardware-and-embodied`、
   `inference-and-deployment`，均 `source: registry`）；`GET /api/categories/counts` →
   `{"counts":[]}`；`GET /api/sites` → `[]`；按分类的 search → 0 hits。
   三个 slug 全部 0 站，无法“按站点数取前二”（并列 0），更无法填“前 20 条 active 站点”表。
3. **:3100 分类页本身是空壳**：`/category` 与 `/category/prompt-engineering` 均 200，
   但返回的 HTML 是 loading 壳，不含任何分类链接/站点数据（Hub 无数据可渲染）。

结论：按“不得编造”铁律，2 个分类 `.md` 不生成；`llms.txt` 不追加分类 `.md` 行（保持定稿 23 条），
`llms-txt.test.ts` 的 `KNOWN_ROUTES` 不追加。待 Hub 有 ≥5 站的达标分类、且 sitemap 出现
`/category/<slug>` 条目后，按模板重新生成。3 个真实 slug 已记录在本节第 2 条，届时直接复用，
但站点表必须重新从 live 分类页逐字取，不得用本次记录补数。

## 未核实 / 遗留

- `exam-guokao-checklist-u285.test.ts` 在本克隆无法加载：`Cannot find package 'react'`
  （后为 `react/jsx-dev-runtime`），因 overlay 无 node_modules；该文件与清单页均未被本次改动触碰
  （文件与 HEAD 逐字节一致），失败与本次改动无关，CI vendor 重建后按正规路径可跑。
- 推送前预检（全量）与 `check-web-overlay` 未跑：后者会报新文件在 `apps/web` 镜像缺失，
  属于 vendor 未重建的预期漂移，合入前由主聊进化轮按正规流程（`mirror:web` / vendor）处理。
- 生产价值待 U-01 上线后重估（见 11-23 报告）；PoC 成功标准是 Agent 任务效率，不是引用率/收录率。
