/**
 * 自动安装 Git 本地钩子 (Pre-commit Hook)
 *
 * 功用：在提交前自动拦截 web-overlay 未同步与扩展配置错误，避免污染 CI。
 */

import { writeFileSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

const gitHooksDir = join(process.cwd(), '.git', 'hooks')

if (!existsSync(gitHooksDir)) {
  console.log('未检测到 .git/hooks 目录，跳过 Git 钩子安装。')
  process.exit(0)
}

const preCommitPath = join(gitHooksDir, 'pre-commit')
// 提交前门禁（升级建议：把 CI 里已有的检查尽可能左移）：
//   1) 覆盖层对齐：**只校验本次提交涉及的文件**（--staged）。为什么不全仓库判：
//      多会话并行时，别人正在编辑的文件的漂移会挡住你的提交（本仓库真实事故：
//      并发会话在改 overlay，导致连续两次提交中止）。全仓库判定交给 CI 的
//      check-web-overlay 作业；本地只对「你这次要提交的东西」把关。
//   2) 扩展规范 + 上游 ref 一致性：秒级
//   3) 类型门禁：@navhub/* 的 tsc --noEmit（前端走 CI 的 test-web，避免本地几十秒）
//   4) 语法解析（--staged）+ 变更相关测试：选测依据是**暂存区**（`git diff --cached`），
//      不是工作区改动集。多会话并行时，别人未提交的改动不再被算进本次提交。
// 提交变慢时可临时跳过：NAVHUB_SKIP_PRECOMMIT=1 git commit ...（或 --no-verify，但请别滥用）
const script = `#!/bin/sh
# NavHub Pre-commit Hook
# 自动校验覆盖层对齐（仅本次提交涉及的文件）、扩展规范、上游 ref、类型与变更相关测试

if [ "$NAVHUB_SKIP_PRECOMMIT" = "1" ]; then
  echo "[pre-commit] NAVHUB_SKIP_PRECOMMIT=1，跳过全部检查"
  exit 0
fi

node scripts/check-web-overlay.mjs --staged || exit 1
node scripts/check-extensions.mjs || exit 1
node scripts/check-upstream-ref.mjs || exit 1

# 解析级快速门禁：只查 staged 的 TS/TSX，秒级；tsc 之前先把标点级错误挡住
node scripts/check-syntax.mjs --staged || exit 1

node scripts/typecheck.mjs || exit 1

# 变更相关测试：选测依据是本次提交集（git diff --cached），不是工作区改动集。
# 逻辑在同目录的 navhub-precommit-tests.mjs（本安装脚本生成，勿手改）。
node "$(git rev-parse --git-path hooks)/navhub-precommit-tests.mjs" || exit 1
`

// 选测器：从「本次提交集」挑测试，而不是从「工作区改动集」。
//
// 为什么不用 `vitest run --changed`：
//   --changed 取的是「工作区 vs HEAD」的改动集。本仓库长期有多个会话并行编辑，A 提交时
//   B 的几十个无关改动会被算进「变更」，于是 A 跑一堆无关测试，甚至被 B 的半成品拖红
//   （真实事故：提交 a5a2f09 被迫使用 NAVHUB_SKIP_PRECOMMIT=1，并在 commit message 里
//   书面声明原因与「已核对零文件交集」）。改成只读暂存区后，谁提交就只跑谁的东西。
//
// 为什么不带 --passWithNoTests：
//   它把「一个测试都没选中」变成静默绿——「什么都没跑」和「跑过了」在输出里长得一样，
//   比跑错更危险，因为它给的是虚假的安全感。这里改成无匹配时显式打印 SKIP 清单。
//
// 为什么不用 `vitest related`（这里曾有一版用它）：
//   related 依赖静态 import 图：新增文件、或还没被任何测试引用的改动会命中 0 个测试，
//   vitest 随即以 "No test files found" 退出 1，正常提交被自己的门禁拦死——结果还是
//   大家去用 NAVHUB_SKIP_PRECOMMIT。改成「改动文件 -> 所属包测试目录」的目录映射后，
//   命中率稳、可解释，代价是粒度变粗（packages/store 整包实测约 94s）。
//
// 为什么不用 pnpm exec：本机 pnpm 11 的 exec/run 被 wmic 拦截，直接调 vitest 入口。
const selectorPath = join(gitHooksDir, 'navhub-precommit-tests.mjs')
const selector = [
  '#!/usr/bin/env node',
  '/**',
  ' * pre-commit 的「本次提交相关测试」选择器（生成物）',
  ' * 生成源：scripts/install-git-hooks.mjs —— 改这个文件没用，重装钩子会被覆盖。',
  ' *',
  ' * 输入：git diff --cached --name-only（本次提交集/暂存区）',
  ' * 输出：选中要跑的测试目录，交给 vitest run；一个都没选中就打印 SKIP 清单。',
  ' */',
  'import { execFileSync, spawnSync } from "node:child_process";',
  'import { existsSync, readdirSync, statSync } from "node:fs";',
  'import { join, sep } from "node:path";',
  '',
  'const TEST_FILE_RE = /\\.(test|spec)\\.(ts|tsx|mts|cts)$/;',
  '',
  '// 改动路径前缀 -> 该跑哪棵测试根。与 vitest.config.ts 的 test.include 对齐。',
  'const ROUTES = [',
  '  // overlay 是 apps/web 的镜像：它没有能独立跑测试的 node_modules（见 vitest.config.ts 注释），',
  '  // 所以 overlay 的源码/测试改动都要落到 apps/web/test 去跑。',
  '  ["apps/web-overlay/scripts/", "apps/web-overlay/scripts"],',
  '  ["apps/web-overlay/", "apps/web/test"],',
  '  ["apps/web/", "apps/web/test"],',
  '  ["apps/api/", "apps/api/test"],',
  '  ["scripts/", "scripts"],',
  '];',
  '',
  '// 改了这些全局配置，任何包的行为都可能变，本地只能跑全量（CI 之外多一道保险）。',
  'const GLOBAL_FILES = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "vitest.config.ts", "tsconfig.base.json"];',
  'const GLOBAL_DIRS = ["types/"];',
  '',
  'function posix(p) {',
  '  return p.split(sep).join("/");',
  '}',
  '',
  'function stagedFiles() {',
  '  // --diff-filter=ACMRD：本次提交的增/改/重命名/删除；不含未暂存的他人改动。',
  '  const raw = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMRD"], { encoding: "utf8" });',
  '  return raw.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean).map(posix);',
  '}',
  '',
  '// 目标既可能是目录（改动的是源码 -> 跑整棵测试根），也可能是单个测试文件',
  '// （改动的就是测试本身）。两种都要能数出测试文件数，只用来打印，不用来过滤。',
  'function listTestFiles(root) {',
  '  if (!existsSync(root)) return [];',
  '  if (statSync(root).isFile()) return [posix(root)];',
  '  const out = [];',
  '  const walk = (dir) => {',
  '    for (const entry of readdirSync(dir, { withFileTypes: true })) {',
  '      if (entry.name === "node_modules" || entry.name === ".git") continue;',
  '      const p = join(dir, entry.name);',
  '      if (entry.isDirectory()) walk(p);',
  '      else if (TEST_FILE_RE.test(entry.name)) out.push(posix(p));',
  '    }',
  '  };',
  '  walk(root);',
  '  return out.sort();',
  '}',
  '',
  'function allTestRoots() {',
  '  const roots = [];',
  '  if (existsSync("packages")) {',
  '    for (const name of readdirSync("packages")) {',
  '      const dir = "packages/" + name + "/test";',
  '      if (existsSync(dir)) roots.push(dir);',
  '    }',
  '  }',
  '  for (const dir of ["apps/api/test", "apps/web/test", "scripts", "apps/web-overlay/scripts"]) {',
  '    if (existsSync(dir)) roots.push(dir);',
  '  }',
  '  return roots;',
  '}',
  '',
  '// 单个改动文件 -> 测试目标。返回 { target } / { global } / { reason }（没匹配到）。',
  'function mapFile(file) {',
  '  if (GLOBAL_FILES.indexOf(file) !== -1) return { global: true };',
  '  for (const dir of GLOBAL_DIRS) if (file.startsWith(dir)) return { global: true };',
  '',
  '  if (TEST_FILE_RE.test(file)) {',
  '    // overlay 的测试改了要跑 apps/web 下那份镜像',
  '    const target = file.startsWith("apps/web-overlay/test/")',
  '      ? "apps/web/test/" + file.slice("apps/web-overlay/test/".length)',
  '      : file;',
  '    return existsSync(target) ? { target } : { reason: "测试文件已删除，没有可运行的副本" };',
  '  }',
  '',
  '  for (const [prefix, root] of ROUTES) if (file.startsWith(prefix)) return { target: root };',
  '',
  '  if (file.startsWith("packages/")) {',
  '    const pkg = file.slice("packages/".length).split("/")[0];',
  '    const root = "packages/" + pkg + "/test";',
  '    return existsSync(root) ? { target: root } : { reason: "packages/" + pkg + " 没有 test 目录" };',
  '  }',
  '',
  '  return { reason: "不属于任何带测试的工作区（packages/*、apps/api、apps/web、scripts）" };',
  '}',
  '',
  'const staged = stagedFiles();',
  'const targets = new Set();',
  'const skipped = [];',
  'const globalFiles = [];',
  '',
  'for (const file of staged) {',
  '  const mapped = mapFile(file);',
  '  if (mapped.global) globalFiles.push(file);',
  '  else if (mapped.target) targets.add(mapped.target);',
  '  else skipped.push([file, mapped.reason]);',
  '}',
  '',
  'const P = "[pre-commit-tests] ";',
  '',
  'if (staged.length === 0) {',
  '  console.log(P + "暂存区为空：本次提交没有改动文件，未运行任何测试");',
  '  process.exit(0);',
  '}',
  '',
  'console.log(P + "选测依据：git diff --cached --name-only（本次提交集，不含工作区其它改动）");',
  '',
  'if (globalFiles.length > 0) {',
  '  console.log(P + "注意：本次提交改动了全局配置 " + globalFiles.join(", ") + "，改为运行全量测试");',
  '  for (const root of allTestRoots()) targets.add(root);',
  '  skipped.length = 0;',
  '}',
  '',
  'if (targets.size === 0) {',
  '  console.log(P + "SKIP：本次提交的 " + staged.length + " 个改动文件没有匹配到任何测试——本次提交没有运行任何测试");',
  '  for (const [file, reason] of skipped) console.log("    - " + file + "  ->  " + reason);',
  '  console.log(P + "如果这些改动本该有测试覆盖：补一个测试，或把该目录加进映射表（生成源 scripts/install-git-hooks.mjs）");',
  '  process.exit(0);',
  '}',
  '',
  'const testFiles = [];',
  'for (const root of targets) for (const file of listTestFiles(root)) testFiles.push(file);',
  '',
  'console.log(P + "本次提交改动 " + staged.length + " 个文件");',
  'console.log(P + "选中 " + targets.size + " 个测试目标 / " + testFiles.length + " 个测试文件：" + Array.from(targets).join("  "));',
  'if (skipped.length > 0) {',
  '  console.log(P + "以下改动没有对应测试目录，未纳入本次运行：");',
  '  for (const [file, reason] of skipped) console.log("    - " + file + "  ->  " + reason);',
  '}',
  '',
  '// 直接调 vitest 入口：本机的 pnpm exec/run 会被 wmic 拦截。找不到入口就按失败处理，',
  '// 绝不退化成「什么都没跑还显示通过」。',
  'const vitestEntry = join(process.cwd(), "node_modules", "vitest", "vitest.mjs");',
  'if (!existsSync(vitestEntry)) {',
  '  console.error(P + "找不到 vitest 入口 " + vitestEntry + "，无法运行测试；按失败处理（请先 pnpm install）");',
  '  process.exit(1);',
  '}',
  '',
  'const res = spawnSync(process.execPath, [vitestEntry, "run"].concat(Array.from(targets)), { stdio: "inherit" });',
  'if (res.error) {',
  '  console.error(P + "运行 vitest 失败：" + res.error.message);',
  '  process.exit(1);',
  '}',
  'process.exit(typeof res.status === "number" ? res.status : 1);',
  '',
].join('\n')

writeFileSync(preCommitPath, script, { encoding: 'utf-8', mode: 0o755 })
writeFileSync(selectorPath, selector, { encoding: 'utf-8' })
try {
  chmodSync(preCommitPath, 0o755)
} catch {
  // Windows 上可能不支持 chmod，忽略
}

console.log('✅ Git pre-commit hook 安装成功 (.git/hooks/pre-commit)')
