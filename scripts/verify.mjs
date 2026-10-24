#!/usr/bin/env node
/**
 * Monorepo 统一自动化验证门禁 (Monorepo Verification Gate)
 * 跨平台设置 4GB V8 堆内存上限，避免多工作线程并发执行 AI/AST 时触发 OOM。
 *
 * 输出铁律：结尾只报「跑了几项、跳了几项、没覆盖什么」，不报「100% 通过」。
 * 首屏预算这类依赖构建产物的步骤，本地经常跳过；把它算进「通过」等于
 * 用一条绿灯掩盖一个没测的事实——CI 与人都会据此认为覆盖面比实际更大。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const env = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --max-old-space-size=4096`.trim(),
};

/** 已执行的步骤与因前置条件不满足而跳过的步骤，最后如实汇总 */
const passed = [];
const skipped = [];

function run(label, cmd, args) {
  console.log(`\n[verify] ----------------------------------------------------`);
  console.log(`[verify] 执行: ${label}`);
  console.log(`[verify] ----------------------------------------------------`);
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: true, env });
  if (res.status !== 0) {
    console.error(`\n❌ [verify] 门禁在以下步骤失败 (exit ${res.status}): ${label}`);
    console.error(`[verify] 已完成 ${passed.length} 项；本次没有「全部通过」这回事。`);
    process.exit(res.status ?? 1);
  }
  passed.push(label);
}

function skip(label, reason) {
  console.log(`\n[verify] 跳过 ${label}：${reason}\n`);
  skipped.push({ label, reason });
}

// 语法解析门禁放最前：秒级，先把「少一个括号」这类错误挡在 tsc 之前。
run("语法解析", "node", ["scripts/check-syntax.mjs"]);
run("覆盖层同步", "node", ["scripts/check-web-overlay.mjs"]);
run("CI 合并门禁", "node", ["scripts/check-ci-gate.mjs"]);
run("core 镜像一致", "node", ["scripts/sync-core-mirrors.mjs", "--check"]);
run("扩展校验", "node", ["scripts/check-extensions.mjs"]);
// 后端 lint 已是硬门禁（error + --max-warnings 0），必须进这条链：
// 只在 CI 单独跑的规则等于没有规则，本地会一路绿灯直到推上去才红。
run("后端 lint", "pnpm", ["lint:backend"]);
run("类型检查", "node", ["scripts/typecheck.mjs"]);

// 口径提示：typecheck 只覆盖 @navhub/*（apps/web 是 vendored 底座），前端
// tsc / eslint / next build 在 CI 的 test-web 作业里，e2e 在 test-e2e 作业里。
// 本脚本绿灯 ≠ CI 绿灯；本地要补前端门禁用 `pnpm verify:web`。
console.log(
  "\n[verify] 提示：本门禁不含前端 tsc / eslint / next build 与 Playwright（CI 口径见 ci.yml 的 test-web / test-e2e）\n",
);

// 首屏预算：只有存在构建产物时才检查。CI 的 test-web 在 build 后显式调用，
// 本地 `pnpm verify` 若没 build 则明确提示而不是静默跳过。
const webDist = "apps/web/.next";
if (existsSync(`${webDist}/build-manifest.json`) || existsSync(`${webDist}/app-build-manifest.json`)) {
  run("首屏预算", "node", ["scripts/check-bundle-budget.mjs"]);
} else {
  skip("首屏预算", `未找到 ${webDist} 构建产物（先运行 pnpm --filter navsphere build 才会检查）`);
}

run("全量测试", "pnpm", ["exec", "vitest", "run"]);

console.log(`\n[verify] ----------------------------------------------------`);
console.log(`[verify] 通过 ${passed.length} 项：${passed.join("、")}`);
if (skipped.length > 0) {
  console.log(`[verify] 跳过 ${skipped.length} 项（这些检查本次没有发生，不代表通过）：`);
  for (const s of skipped) console.log(`  - ${s.label}：${s.reason}`);
}
console.log(
  `[verify] 未覆盖：前端 tsc / eslint / next build、Playwright e2e（本地用 pnpm verify:web 与 pnpm test:e2e 补跑）\n`,
);
console.log(`✅ [verify] 上述 ${passed.length} 项全部退出码 0${skipped.length > 0 ? `（另有 ${skipped.length} 项未执行）` : ""}。`);
