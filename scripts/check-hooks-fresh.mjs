#!/usr/bin/env node
/**
 * 钩子新鲜度门禁：本机 `.git/hooks/` 里的生成物必须仍是 `scripts/install-git-hooks.mjs`
 * 的产物。判定细节见 scripts/lib/hooks-fresh.mjs。
 *
 * 用法：node scripts/check-hooks-fresh.mjs [--hooks-dir .git/hooks] [--source scripts/install-git-hooks.mjs]
 * 退出码：0 = 与安装清单一致；1 = 模板改了没重装 / 钩子被手改 / 清单缺失。
 *
 * 它只在 pre-commit 里跑（没有钩子目录时无提交可言，直接放行）。
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFresh } from "./lib/hooks-fresh.mjs";

const P = "[hooks-fresh] ";

const opts = {
  hooksDir: join(process.cwd(), ".git", "hooks"),
  source: join(process.cwd(), "scripts", "install-git-hooks.mjs"),
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--hooks-dir") { opts.hooksDir = resolve(argv[i + 1] ?? ""); i += 1; continue; }
  if (arg === "--source") { opts.source = resolve(argv[i + 1] ?? ""); i += 1; continue; }
  if (arg.startsWith("--hooks-dir=")) { opts.hooksDir = resolve(arg.slice("--hooks-dir=".length)); continue; }
  if (arg.startsWith("--source=")) { opts.source = resolve(arg.slice("--source=".length)); }
}

if (!existsSync(opts.hooksDir)) {
  console.log(`${P}没有 ${opts.hooksDir}（不是仓库目录？）——跳过`);
  process.exit(0);
}

const { problems, manifestPath } = checkFresh({ hooksDir: opts.hooksDir, sourcePath: opts.source });
if (problems.length > 0) {
  console.error(`${P}❌ 本机钩子与模板不同源（清单 ${manifestPath}）：`);
  for (const p of problems) console.error(`   - ${p}`);
  console.error(`${P}原因通常是改了 install-git-hooks.mjs 却没重装——钩子里的新检查一次都不会跑。`);
  process.exit(1);
}

console.log(`${P}✅ 钩子与模板同源：pre-commit / pre-push / 选测器 / node 定位 4 个生成物均与安装清单一致。`);
