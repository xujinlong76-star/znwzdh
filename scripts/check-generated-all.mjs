#!/usr/bin/env node
/**
 * 生成/镜像链**聚合校验入口**（一条命令覆盖 4 条链）。
 *
 * 为什么需要：本仓有 4 条「生成物必须与源同源」的链，各自有 --check，但没有统一入口——
 * 漏跑任意一条都会出现「本地绿、镜像红」或反向静默分叉：
 *   1. core 镜像      core 纯算法 → 前端运行时副本（sync-core-mirrors --check）
 *   2. 路由策略       路由声明 → hub-route-policy（gen-hub-route-policy --check）
 *   3. REST 契约      后端路由 → rest-contracts.generated（generate-rest-contract-types --check）
 *   4. overlay→web    前端事实源 → 构建目录镜像（check-web-overlay）
 *
 * 任一条退出非 0 即整体判红，并逐条打印状态，避免"红在哪一条"要靠再跑一遍才知道。
 *
 * 用法：
 *   node scripts/check-generated-all.mjs        # 全部校验（CI / 提交前）
 *   node scripts/check-generated-all.mjs --json # 机器可读结果（给门禁聚合用）
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AS_JSON = process.argv.includes("--json");

const CHAINS = [
  {
    id: "core-mirrors",
    name: "core 镜像（core → 前端运行时副本）",
    fix: "node scripts/sync-core-mirrors.mjs",
    args: ["scripts/sync-core-mirrors.mjs", "--check"],
  },
  {
    id: "hub-route-policy",
    name: "路由策略（hub-route-policy）",
    fix: "node scripts/gen-hub-route-policy.mjs",
    args: ["scripts/gen-hub-route-policy.mjs", "--check"],
  },
  {
    id: "rest-contracts",
    name: "REST 契约（rest-contracts.generated）",
    fix: "node scripts/generate-rest-contract-types.mjs",
    args: ["scripts/generate-rest-contract-types.mjs", "--check"],
  },
  {
    id: "web-overlay-mirror",
    name: "overlay → apps/web 镜像",
    fix: "node scripts/check-web-overlay.mjs --fix",
    args: ["scripts/check-web-overlay.mjs"],
  },
];

const results = [];
for (const chain of CHAINS) {
  const r = spawnSync(process.execPath, chain.args, {
    cwd: ROOT,
    stdio: AS_JSON ? "pipe" : "inherit",
    encoding: "utf8",
  });
  const ok = r.status === 0;
  results.push({ id: chain.id, name: chain.name, ok, fix: chain.fix });
  if (!AS_JSON) {
    console.log(`${ok ? "✓" : "✗"} ${chain.name}`);
    if (!ok) console.log(`    修复：${chain.fix}`);
  }
}

const failed = results.filter((r) => !r.ok);
if (AS_JSON) {
  console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
} else {
  console.log(
    failed.length === 0
      ? `\n全部生成链一致（${results.length}/${results.length}）。`
      : `\n生成链校验失败 ${failed.length}/${results.length}：${failed.map((f) => f.id).join(", ")}`,
  );
}
process.exit(failed.length === 0 ? 0 : 1);