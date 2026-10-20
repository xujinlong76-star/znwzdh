#!/usr/bin/env node
/**
 * Monorepo 统一自动化验证门禁 (Monorepo Verification Gate)
 * 跨平台设置 4GB V8 堆内存上限，避免多工作线程并发执行 AI/AST 时触发 OOM。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const env = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --max-old-space-size=4096`.trim(),
};

function run(cmd, args) {
  console.log(`\n[verify] ----------------------------------------------------`);
  console.log(`[verify] 执行: ${cmd} ${args.join(" ")}`);
  console.log(`[verify] ----------------------------------------------------`);
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: true, env });
  if (res.status !== 0) {
    console.error(`\n❌ [verify] 门禁在以下步骤失败 (exit ${res.status}): ${cmd} ${args.join(" ")}`);
    process.exit(res.status ?? 1);
  }
}

// 语法解析门禁放最前：秒级，先把「少一个括号」这类错误挡在 tsc 之前。
run("node", ["scripts/check-syntax.mjs"]);
run("node", ["scripts/check-web-overlay.mjs"]);
run("node", ["scripts/sync-core-mirrors.mjs", "--check"]);
run("node", ["scripts/check-extensions.mjs"]);
run("node", ["scripts/typecheck.mjs"]);

// 首屏预算：只有存在构建产物时才检查。CI 的 test-web 在 build 后显式调用，
// 本地 `pnpm verify` 若没 build 则明确提示而不是静默跳过。
const webDist = "apps/web/.next";
if (existsSync(`${webDist}/build-manifest.json`) || existsSync(`${webDist}/app-build-manifest.json`)) {
  run("node", ["scripts/check-bundle-budget.mjs"]);
} else {
  console.log(`\n[verify] 跳过首屏预算：未找到 ${webDist} 构建产物（先运行 pnpm --filter navsphere build）\n`);
}

run("pnpm", ["exec", "vitest", "run"]);

console.log(`\n✨ [verify] 全部验证项 100% 通过！\n`);
