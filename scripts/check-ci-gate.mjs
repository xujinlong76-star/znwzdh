#!/usr/bin/env node
/**
 * CI 合并门禁的离线校验。
 *
 * 为什么需要：`ci-passed` 是分支保护唯一必经项，它靠 `needs` 聚合 8 个作业。
 * 只要有人（或某次合并冲突）把 `test-postgres` 从 `needs` 里删掉，PG 红了也
 * 不会阻塞合并——而 GitHub 的分支保护配置在仓库外，本地无法读取。
 * 2026-10-24 实测：PG 套件确实红过（`catId is not defined`），说明「聚合了」
 * 不等于「聚合对了」。这个脚本把聚合关系变成可执行断言，进 pre-merge 的
 * `pnpm verify`。
 *
 * 校验项：
 *   1. `ci-passed.needs` 覆盖全部关键作业；
 *   2. 评估脚本逐个读取 `needs.<job>.result`（漏读 = 该作业失败不阻塞）；
 *   3. PG 作业使用带环境守卫的入口 `pnpm test:pg:suite`（防止整体 skip 假绿）；
 *   4. `if: always()` 存在（否则上游失败时聚合作业被跳过，分支保护会把它当
 *      未完成或成功，两种语义都不是我们要的）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 允许测试注入替代文件，验证「删掉关键作业确实会红」 */
const CI_PATH = process.env.NAVHUB_CI_PATH || resolve(process.cwd(), ".github/workflows/ci.yml");
const REQUIRED_JOBS = [
  "test-sqlite",
  "test-postgres",
  "test-web",
  "check-web-overlay",
  "check-isr-live",
  "test-e2e",
  "docker-smoke",
  "audit",
];

const source = readFileSync(CI_PATH, "utf8");
const problems = [];

/** 截取 ci-passed 作业块：从 `  ci-passed:` 到下一个同级作业或文件尾 */
const start = source.indexOf("\n  ci-passed:");
if (start < 0) {
  console.error("❌ 找不到 ci-passed 作业：分支保护将失去唯一必经项");
  process.exit(1);
}
const rest = source.slice(start + 1);
const nextJob = rest.slice(1).search(/\n {2}[a-zA-Z0-9_-]+:\n/);
const block = nextJob >= 0 ? rest.slice(0, nextJob + 1) : rest;

const needsMatch = block.match(/needs:\s*\[([^\]]*)\]/);
if (!needsMatch) {
  problems.push("ci-passed 没有 needs 列表");
} else {
  const needs = needsMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
  for (const job of REQUIRED_JOBS) {
    if (!needs.includes(job)) problems.push(`needs 缺少 ${job}（该作业失败不会阻塞合并）`);
    if (!block.includes(`needs.${job}.result`)) {
      problems.push(`评估脚本没有读取 needs.${job}.result（失败被静默忽略）`);
    }
  }
}

if (!/if:\s*always\(\)/.test(block)) {
  problems.push("ci-passed 缺少 if: always()：上游失败时聚合作业会被跳过");
}

// PG 作业必须走带环境守卫的入口
const pgJobStart = source.indexOf("\n  test-postgres:");
const pgJob = pgJobStart >= 0 ? source.slice(pgJobStart, source.indexOf("\n  test-web:", pgJobStart)) : "";
if (!pgJob.includes("pnpm test:pg:suite")) {
  problems.push("test-postgres 没有使用 pnpm test:pg:suite（缺少「拒绝静默跳过」守卫）");
}

if (problems.length > 0) {
  console.error("❌ CI 合并门禁校验失败：");
  for (const p of problems) console.error("   - " + p);
  process.exit(1);
}

console.log(
  `✅ CI 合并门禁：ci-passed 聚合 ${REQUIRED_JOBS.length} 个作业，逐个读取结果，PG 走 test:pg:suite。`,
);
console.log("   提醒：分支保护需在 GitHub 上把 ci-passed 设为唯一必经项（见 docs/CI-BRANCH-PROTECTION.md）。");
