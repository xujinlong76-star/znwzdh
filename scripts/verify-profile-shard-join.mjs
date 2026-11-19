#!/usr/bin/env node
/**
 * 带值渲染核对（Batch0-02 R9，不跑浏览器，由验证员跑浏览器核对）。
 *
 * 作用：在临时库里插 1 站 verified 档案行后重跑写路径，断言卡片三字段
 * （pricing / requires_account / best_for）进分片；draft 行不进。
 * 本脚本只跑已落地的测试（不新编数据、不写生产库、不碰 navigation.json）：
 *   1. apps/api/test/navigation-shards.test.ts -t "R9"
 *      （writeNavigationData 分片挂钩：n-1 verified 带值、n-2 draft 缺省）
 *   2. packages/store/test/site-profiles-batch.test.ts
 *      （listVerifiedProfilesBySiteIds 只返回 verified 行）
 *
 * 用法（仓库根目录）：
 *   node scripts/verify-profile-shard-join.mjs
 * 退出码：两组全绿为 0，否则为 1。临时目录默认用 TMPDIR，缺省为
 * ~/workspace/.tmp-batch0fix/f4（不写仓库内临时文件）。
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMPDIR = process.env.TMPDIR ?? path.join(process.env.HOME ?? "", "workspace", ".tmp-batch0fix", "f4");

const SUITES = [
  {
    name: "写路径 join（1 站 verified 带值、1 站 draft 缺省）",
    args: ["vitest", "run", "apps/api/test/navigation-shards.test.ts", "-t", "R9"],
  },
  {
    name: "批量加载只返回 verified 行",
    args: ["vitest", "run", "packages/store/test/site-profiles-batch.test.ts"],
  },
];

let failed = false;
for (const suite of SUITES) {
  console.log(`\n=== ${suite.name} ===`);
  console.log(`$ npx ${suite.args.join(" ")}`);
  const res = spawnSync("npx", suite.args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, TMPDIR },
  });
  if (res.status !== 0) {
    failed = true;
    console.error(`FAIL: ${suite.name}（退出码 ${res.status}）`);
  } else {
    console.log(`PASS: ${suite.name}`);
  }
}

if (failed) {
  console.error("\n带值核对未通过：见上方失败用例。");
  process.exit(1);
}
console.log("\n带值核对通过：verified 行三字段进分片，draft 行不进。");
console.log("下一步（验证员，浏览器）：往库里插 1 站 verified 行后起 dev 服务器，");
console.log("在首页卡片上核对 pricing / requires_account / best_for 三处与库值逐字一致。");
