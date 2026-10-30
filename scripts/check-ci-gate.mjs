#!/usr/bin/env node
/**
 * CI 合并门禁的离线校验。
 *
 * 为什么需要：`ci-passed` 是分支保护唯一必经项，它靠 `needs` 聚合各作业。
 * 只要有人（或某次合并冲突）把一个本该阻塞的作业从 `needs` 里删掉，它红了也
 * 不会阻塞合并——而 GitHub 的分支保护配置在仓库外，本地无法读取。
 * 2026-10-24 实测：PG 套件确实红过（`catId is not defined`），说明「聚合了」
 * 不等于「聚合对了」。这个脚本把聚合关系变成可执行断言，进 pre-merge 的
 * `pnpm verify`。
 *
 * 2026-10-27 改进：不再维护硬编码作业清单。清单会漏——仓库新增
 * `seo-audit-prod` 时旧脚本仍然绿。现在解析 `jobs:` 下全部作业：
 *   - 在 `needs` 里 → 必须逐个读取 `needs.<job>.result`；
 *   - 不在 `needs` 里 → 必须显式声明为手动/定时作业（`if:` 含 workflow_dispatch
 *     或 schedule），否则判红：新增的 PR 作业不许悄悄绕过聚合。
 *
 * 其余校验：
 *   - `ci-passed` 必须有 `if: always()`（否则上游失败时聚合作业被跳过）；
 *   - PG 作业使用带环境守卫的入口 `pnpm test:pg:suite`（防整体 skip 假绿）；
 *   - 后端 lint 必须有一条**阻塞通道** —— 本地 verify 视其为硬门禁，而 CI 的
 *     该步骤带 `continue-on-error`（退出码被吞，作业仍绿）。两者可以并存，前提是
 *     同一个断言也在被 ci-passed 聚合的阻塞作业里跑一遍（见 LINT_GATE_TEST）。
 *   - **级联红收敛**（2026-10-29）：读上游产物的收尾步骤（红灯光谱 / 红灯台账 /
 *     upload-artifact / 首屏预算账）必须以「生产者真的跑过」为条件
 *     （`steps.<锚点 id>.outcome != 'skipped'`）。只写 `!cancelled()` 或 `always()` 时，
 *     上游一红就会连带多处红，真根因被淹没。与上面「不再维护硬编码作业清单」不矛盾：
 *     聚合关系能从 YAML 推出来，而「这一步读的是哪个步骤的产物」推不出来，
 *     所以级联规则按作业登记。
 *     登记表的**覆盖面**是可推出来的（2026-10-30 补）：带 `if-no-files-found: error`
 *     上传的作业就是自己声明了「产物缺失我会判红」，这类作业没登记 ⇒ 直接红。
 *     此前这句只写在注释里（「漏登记会在那一步的红里显出来」），实际要靠事故才发现。
 *   - **撤防账的接线**（2026-10-30 第 7 项）：默认条件是「上一步红 ⇒ 后面每一步 skipped」，
 *     而 skipped 不判红 ⇒ 作业结论只说明「没新增红」，不说明「门禁判过没有」。
 *     每个接入的作业必须有那步 `if: always()` 的读数步骤，登记表里的 id 必须都真实存在
 *     且排在读数步骤之前；门禁形状的步骤必须有 id 并登进表（否则它被跳过时报不出名字）。
 *     这一项只钉**接线**，不判运行结果：把「有门禁没跑成」变成第二处红，
 *     等于把刚压下去的级联红请回来。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkflow, cascadeProblems, readerJobCoverageProblems, stripYamlCommentLines } from "./lib/ci-workflow.mjs";
import {
  DEFUSED_GATES,
  defusedCoverageProblems,
  defusedEntryFor,
  defusedWiringProblems,
} from "./lib/ci-defused.mjs";

/** 允许测试注入替代文件，验证「删掉关键作业确实会红」 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CI_PATH = process.env.NAVHUB_CI_PATH || resolve(REPO_ROOT, ".github/workflows/ci.yml");
/** 后端 lint 在阻塞作业里的那份同口径断言；可用测试替换 */
const LINT_GATE_REL = "apps/api/test/backend-lint-gate.test.ts";
const LINT_GATE_TEST = process.env.NAVHUB_LINT_GATE_TEST || resolve(REPO_ROOT, LINT_GATE_REL);
/** 解析下限：低于它说明 YAML 结构变了，脚本不该假装通过 */
const MIN_JOBS = 6;

const source = readFileSync(CI_PATH, "utf8");
const problems = [];

const workflow = parseWorkflow(source);
const { jobs, needs, needsFound, ciPassedBlock, aggregated, manualOnly } = workflow;

if (!ciPassedBlock) {
  console.error("❌ 找不到 ci-passed 作业：分支保护将失去唯一必经项");
  process.exit(1);
}
if (!workflow.hasJobs) {
  console.error("❌ 找不到 jobs: 段");
  process.exit(1);
}
if (!needsFound) problems.push("ci-passed 没有 needs 列表");

if (jobs.length < MIN_JOBS) {
  problems.push(`只解析到 ${jobs.length} 个作业（下限 ${MIN_JOBS}）：YAML 结构可能已变，门禁校验失效`);
}

for (const job of jobs) {
  if (job.name === "ci-passed") continue;
  if (needs.includes(job.name)) {
    if (!ciPassedBlock.includes(`needs.${job.name}.result`)) {
      problems.push(`评估脚本没有读取 needs.${job.name}.result（失败被静默忽略）`);
    }
    continue;
  }
  if (job.manualOnly) continue;
  problems.push(
    `作业 ${job.name} 既不在 ci-passed.needs 里，也不是手动/定时作业——` +
      `它红了不会阻塞合并。请加入 needs，或在 if: 里声明 workflow_dispatch/schedule。`,
  );
}

if (!/if:\s*always\(\)/.test(ciPassedBlock)) {
  problems.push("ci-passed 缺少 if: always()：上游失败时聚合作业会被跳过");
}

// PG 作业必须走带环境守卫的入口
const pgJob = jobs.find((j) => j.name === "test-postgres");
if (!pgJob) {
  problems.push("找不到 test-postgres 作业");
} else if (!pgJob.block.includes("pnpm test:pg:suite")) {
  problems.push("test-postgres 没有使用 pnpm test:pg:suite（缺少「拒绝静默跳过」守卫）");
}

// 后端 lint 的阻塞通道：CI 那一步允许失败，就必须在被聚合的阻塞作业里有同一份断言，
// 否则「本地 verify 红 / CI 绿」会长期并存，每一轮都要重新猜哪边才算数。
const lintStepSuppressed =
  /- run: pnpm run lint:backend\s*\n\s*continue-on-error:\s*true/.test(source);
if (lintStepSuppressed && !existsSync(LINT_GATE_TEST)) {
  problems.push(
    "ci.yml 的 `pnpm run lint:backend` 带 continue-on-error（退出码被吞），" +
      `但阻塞作业里没有同口径断言（缺 ${LINT_GATE_REL}）` +
      "——要么去掉 continue-on-error，要么把 lint 断言放进被 ci-passed 聚合的测试作业",
  );
}

// 级联红收敛：一次根因只留一处红。2026-10-29 实战——typecheck 一红，
// 测试步骤被跳过、junit 不存在，而「红灯光谱/红灯台账/上传 junit」三步仍按
// !cancelled() 执行，各自再判一次红，真根因被四处红淹没。
//
// 登记表 = 每个作业「产物生产者是谁 + 产物叫什么」。加新作业时只改这张表，
// 判定本身（含注释剥离、ignore 豁免）在 lib/ci-workflow.mjs 里只有一份。
// playwright-report 那步今天是 `if-no-files-found: ignore`、被豁免判据放过，仍列进
// products 是为了盯住它的**改法**：谁把它换成 error（junit 那几步就是这么改的），
// 它当场变成级联源、必须挂守卫。
const CASCADE_RULES = [
  { job: "test-sqlite", anchor: "vitest", products: [/junit-summary\.mjs/, /ci-red-ledger\.mjs/, /junit-sqlite-/] },
  { job: "test-e2e", anchor: "e2e", products: [/junit-summary\.mjs/, /ci-red-ledger\.mjs/, /junit-e2e-/, /playwright-report/] },
  // 预算账读的是 next build 的产物：锚点是 build 而不是 lint/门禁步骤，
  // 因为「预算门禁红灯时账仍要出」是有意为之，只有 build 没跑成才算级联。
  // check-isr-routes 也挂在 web-build 上（2026-10-30）：它读的同样是 `.next`，
  // 而它此前没有 `if:` —— 预算常驻红灯时按默认条件被整步跳过，等于 ISR 门禁天天撤防。
  {
    job: "test-web",
    anchor: "web-build",
    products: [/bundle-budget-summary\.mjs/, /bundle-budget-report/, /check-isr-routes\.mjs/],
  },
];
for (const rule of CASCADE_RULES) {
  const found = jobs.find((j) => j.name === rule.job);
  if (!found) {
    problems.push(`找不到 ${rule.job} 作业：级联红校验失去对象`);
    continue;
  }
  for (const p of cascadeProblems(found.block, rule)) {
    problems.push(`${rule.job}：${p}`);
  }
}

// 登记表本身的覆盖面：有「自我判红的读取步骤」的作业必须在表里（判据来自 YAML，不靠事故发现）
const uncoveredReaders = readerJobCoverageProblems(
  jobs,
  CASCADE_RULES.map((r) => r.job),
);
problems.push(...uncoveredReaders);

// 撤防账（第 7 项）：门禁步骤没跑成（skipped / 取消 / id 被改名删除）必须在作业里点名。
// 这里只钉接线：读数步骤在不在、条件是不是 always()、登记表里的 id 真不真存在、
// 门禁形状的步骤有没有 id。运行结果不判红——那是级联红刚被压下去的那件事。
let defusedGateCount = 0;
for (const entry of DEFUSED_GATES) {
  const found = jobs.find((j) => j.name === entry.job);
  if (!found) {
    problems.push(`找不到 ${entry.job} 作业：撤防登记表失去对象`);
    continue;
  }
  defusedGateCount += (entry.gates ?? []).length;
  for (const p of defusedWiringProblems(found.block, entry)) problems.push(p);
  problems.push(...defusedCoverageProblems(found.block, entry));
}

// 反方向：ci.yml 里调用了读数脚本、登记表里却没有这个作业 = 接线跑在账前面，
// 那一步每次都在报「未登记」，而没人会去读它（与 gates.json 的双向对照同一个口径）。
for (const job of jobs) {
  if (job.name === "ci-passed") continue;
  if (!/ci-defused-gates\.mjs/.test(stripYamlCommentLines(job.block))) continue;
  if (defusedEntryFor(job.name)) continue;
  problems.push(
    `作业 ${job.name} 跑了 scripts/ci-defused-gates.mjs，但 scripts/lib/ci-defused.mjs 的 DEFUSED_GATES 里没有它——` +
      "读数每次都会报「未登记」，等于白跑一步；要么补登记，要么撤掉这一步",
  );
}

if (problems.length > 0) {
  console.error("❌ CI 合并门禁校验失败：");
  for (const p of problems) console.error("   - " + p);
  process.exit(1);
}

console.log(
  `✅ CI 合并门禁：解析 ${jobs.length - 1} 个作业，ci-passed 聚合 ${aggregated.length} 个作业，逐个读取结果，` +
    "PG 走 test:pg:suite，" +
    `级联红已按产物生产者 outcome 收敛（${CASCADE_RULES.length} 个作业登记，覆盖面按 error 上传核对），` +
    `撤防账已接线（${DEFUSED_GATES.length} 个作业 / ${defusedGateCount} 道门禁有读数步骤），` +
    (lintStepSuppressed ? "后端 lint 由阻塞作业里的同口径断言把关。" : "后端 lint 步骤本身即为阻塞。"),
);
if (manualOnly.length > 0) {
  console.log(`   手动/定时作业（不参与合并门禁，已显式声明）：${manualOnly.join("、")}`);
}
console.log("   提醒：分支保护需在 GitHub 上把 ci-passed 设为唯一必经项（见 docs/CI-BRANCH-PROTECTION.md）。");
