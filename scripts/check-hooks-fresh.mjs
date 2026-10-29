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
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkFresh, PREPARE_DOCKERFILES, PREPARE_ENTRY, prepareClosureProblems } from "./lib/hooks-fresh.mjs";

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

const root = process.cwd();
const problems = [];
const checked = [];

// ① 镜像 prepare 阶段：install-git-hooks.mjs 的相对 import 闭包必须被 Dockerfile COPY 覆盖
for (const name of PREPARE_DOCKERFILES) {
  const res = prepareClosureProblems({
    dockerfilePath: name,
    entry: PREPARE_ENTRY,
    readFile: (path) => readFileSync(resolve(root, path), "utf8"),
    exists: (path) => existsSync(resolve(root, path)),
  });
  if (!res.skipped) {
    checked.push(name);
    problems.push(...res.problems);
  }
}

// ② 本机钩子：生成物必须仍是当前模板的产物
const fresh = checkFresh({ hooksDir: opts.hooksDir, sourcePath: opts.source });
problems.push(...fresh.problems);

if (problems.length > 0) {
  console.error(`${P}❌ 钩子链有 ${problems.length} 处问题（安装清单 ${fresh.manifestPath}）：`);
  for (const p of problems) console.error(`   - ${p}`);
  console.error(`${P}常见原因：改了 install-git-hooks.mjs 却没重装（钩子里的新检查一次都不会跑）；`);
  console.error(`${P}或给它加了相对 import 却没同步 Dockerfile 的 COPY（镜像 install 阶段直接起不来）。`);
  process.exit(1);
}

console.log(
  `${P}✅ 钩子与模板同源：pre-commit / pre-push / 选测器 / node 定位 4 个生成物均与安装清单一致；` +
    `镜像 prepare 闭包已覆盖（${checked.join(" / ")}）。`,
);
