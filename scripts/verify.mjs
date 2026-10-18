#!/usr/bin/env node
/**
 * Monorepo 统一自动化验证门禁 (Monorepo Verification Gate)
 * 跨平台设置 4GB V8 堆内存上限，避免多工作线程并发执行 AI/AST 时触发 OOM。
 */
import { spawnSync } from "node:child_process";

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

run("node", ["scripts/check-web-overlay.mjs"]);
run("node", ["scripts/sync-core-mirrors.mjs", "--check"]);
run("node", ["scripts/check-extensions.mjs"]);
run("pnpm", ["-r", "--filter", "@navhub/*", "exec", "tsc", "--noEmit"]);
run("pnpm", ["exec", "vitest", "run"]);

console.log(`\n✨ [verify] 全部验证项 100% 通过！\n`);
