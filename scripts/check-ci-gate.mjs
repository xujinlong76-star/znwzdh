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
 *   - **级联红收敛**（2026-10-29）：读 junit 产物的收尾步骤（红灯光谱 / 红灯台账 /
 *     upload-artifact）必须以「测试步骤真的跑过」为条件（`steps.<id>.outcome != 'skipped'`）。
 *     只写 `!cancelled()` 时，typecheck 一红就会连带四处红，真根因被淹没。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkflow, telemetryCascadeProblems } from "./lib/ci-workflow.mjs";

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
const CASCADE_JOBS = [
  { job: "test-sqlite", testStepId: "vitest" },
  { job: "test-e2e", testStepId: "e2e" },
];
for (const { job, testStepId } of CASCADE_JOBS) {
  const found = jobs.find((j) => j.name === job);
  if (!found) {
    problems.push(`找不到 ${job} 作业：级联红校验失去对象`);
    continue;
  }
  for (const p of telemetryCascadeProblems(found.block, testStepId)) {
    problems.push(`${job}：${p}`);
  }
}

if (problems.length > 0) {
  console.error("❌ CI 合并门禁校验失败：");
  for (const p of problems) console.error("   - " + p);
  process.exit(1);
}

console.log(
  `✅ CI 合并门禁：解析 ${jobs.length - 1} 个作业，ci-passed 聚合 ${aggregated.length} 个作业，逐个读取结果，` +
    "PG 走 test:pg:suite，" +
    "级联红已按测试步骤 outcome 收敛，" +
    (lintStepSuppressed ? "后端 lint 由阻塞作业里的同口径断言把关。" : "后端 lint 步骤本身即为阻塞。"),
);
if (manualOnly.length > 0) {
  console.log(`   手动/定时作业（不参与合并门禁，已显式声明）：${manualOnly.join("、")}`);
}
console.log("   提醒：分支保护需在 GitHub 上把 ci-passed 设为唯一必经项（见 docs/CI-BRANCH-PROTECTION.md）。");
