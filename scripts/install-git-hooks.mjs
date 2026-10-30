/**
 * 自动安装 Git 本地钩子 (Pre-commit Hook)
 *
 * 功用：在提交前自动拦截 web-overlay 未同步与扩展配置错误，避免污染 CI。
 */

import { writeFileSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MANIFEST_NAME, buildManifest } from './lib/hooks-fresh.mjs'

const gitHooksDir = join(process.cwd(), '.git', 'hooks')

if (!existsSync(gitHooksDir)) {
  console.log('未检测到 .git/hooks 目录，跳过 Git 钩子安装。')
  process.exit(0)
}

const preCommitPath = join(gitHooksDir, 'pre-commit')
const prePushPath = join(gitHooksDir, 'pre-push')
const nodeLibPath = join(gitHooksDir, 'navhub-hook-node.sh')

// 两个钩子共用的 node 定位。为什么要共用一份：pre-push 是后加的，把同样的
// PATH 补全逻辑抄第二遍，下次环境再变就要改两处（真实教训：Trae 宿主下 node
// 会从 PATH 消失，当时的修法只写在 pre-commit 里）。
const nodeLib = `#!/bin/sh
# 由 scripts/install-git-hooks.mjs 生成（勿手改）：pre-commit / pre-push 共用的 node 定位。
#
# Node 定位：Trae 的 Agent 工具宿主把 PATH 固定成自己的内部目录，且 PowerShell 以
# -NoProfile 启动——改注册表、重启 IDE 都不会传导过来，钩子里的 node 会莫名其妙消失。
# 这里在缺 node 时按常见安装位置补一次 PATH（只影响本次钩子），找不到就明确报错，
# 不静默放行。
navhub_find_node() {
  command -v node >/dev/null 2>&1 && return 0
  if command -v cygpath >/dev/null 2>&1 && [ -n "$LOCALAPPDATA" ]; then
    _navhub_local=$(cygpath -u "$LOCALAPPDATA")
    for _navhub_dir in "$_navhub_local/hermes/node" "$_navhub_local/Programs/nodejs"; do
      if [ -x "$_navhub_dir/node.exe" ]; then
        PATH="$_navhub_dir:$PATH"
        export PATH
        return 0
      fi
    done
  fi
  for _navhub_dir in "/c/Program Files/nodejs" "/usr/local/bin" "/opt/homebrew/bin"; do
    if [ -x "$_navhub_dir/node" ] || [ -x "$_navhub_dir/node.exe" ]; then
      PATH="$_navhub_dir:$PATH"
      export PATH
      return 0
    fi
  done
  return 1
}

navhub_require_node() {
  command -v node >/dev/null 2>&1 && return 0
  if navhub_find_node; then
    echo "[hook] node 不在 PATH，已临时使用 $(command -v node)" >&2
    return 0
  fi
  echo "[hook] 未找到 node：请安装 Node.js，或把 node 所在目录加入 PATH" >&2
  return 1
}
`

// 推送前门禁：只拦一类问题——会撞 GitHub 单文件 100 MiB 硬限制的大对象。
// 为什么与 pre-commit 并存、而不是二选一：pre-commit 可被 --no-verify 或直接
// commit-tree 绕过（本仓库多会话并行，两种都真实发生过）；而「被服务端拒绝」
// 发生在 push 这一刻，推送前的历史还能在本地处理，推送后再改就是重写。
//
// 第二段是「契约同源 + scope 显式 + 客户端模块图 + core 镜像同源 + 测试镜像配对」五枚便宜闸门
// （scripts/prepush-gates.mjs）：它们原先只有 CI 才知道——改 core 不重生成、写路由漏写 scope，
// pre-commit 的目录选测都覆盖不到；客户端图里的 node 内建更要等到 next build 之后的
// check-bundle-budget 才以「首屏超预算」的形式暴露，根因还得人反推；core 镜像漂移在
// 工作区里根本查不出来（2026-10-28：HEAD 红、工作区绿，因为修复没提交）；测试镜像漏提交
// 也只有比对 HEAD 上两份 committed blob 才看得见，CI 那侧先跑 vendor-web 重建镜像，更看不见。
// 前两枚在相关路径有未提交改动时会说明并跳过（不拿别人的半成品挡推送）；
// 后三枚读 HEAD 的提交内容，与工作区脏不脏无关，所以恒跑。
const prePush = `#!/bin/sh
# NavHub Pre-push Hook（生成源：scripts/install-git-hooks.mjs）
#
# 1) 扫描「尚未存在于任何远程跟踪 ref 的对象」，超过 50 MiB 的 blob 直接拦下。
#    已推送过的大文件不会重复报（它在远程 ref 的历史里，重写也救不回来）。
# 2) 契约生成物同源 + 写路由 scope 显式 + 客户端模块图不引 node 内建 + core 镜像同源
#    + 已提交测试镜像与 overlay 配对（scripts/prepush-gates.mjs；后三枚读 HEAD，不看工作区）。
# 临时跳过：NAVHUB_SKIP_PREPUSH=1 git push ...（不推荐 —— 被 GitHub 拒绝时
# 唯一的解法是重写历史，那比现在花十秒处理文件贵得多）

if [ "$NAVHUB_SKIP_PREPUSH" = "1" ]; then
  echo "[pre-push] NAVHUB_SKIP_PREPUSH=1，跳过大文件守卫与契约闸门"
  exit 0
fi

. "$(git rev-parse --git-path hooks)/navhub-hook-node.sh" || {
  echo "[pre-push] 缺少 .git/hooks/navhub-hook-node.sh：请重跑 node scripts/install-git-hooks.mjs" >&2
  exit 1
}
navhub_require_node || exit 1

node scripts/check-large-files.mjs --unpushed || exit 1
node scripts/prepush-gates.mjs || exit 1
`

// 提交前门禁（升级建议：把 CI 里已有的检查尽可能左移）：
//   0) 大文件：超过 50 MiB 的暂存 blob 直接拦（GitHub 硬限制 100 MiB 的一半）。
//      真实事故：2026-10-26 并行会话 add -A 带进 141.42 MiB 的 Playwright 安装包，
//      三次推送被服务端拒绝，最终只能重写三个未推送提交。
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

# Node 定位逻辑与 pre-push 共用（生成到 navhub-hook-node.sh）：
# 缺 node 时按常见安装位置补一次 PATH，找不到就明确报错，不静默放行。
. "$(git rev-parse --git-path hooks)/navhub-hook-node.sh" || {
  echo "[pre-commit] 缺少 .git/hooks/navhub-hook-node.sh：请重跑 node scripts/install-git-hooks.mjs" >&2
  exit 1
}
navhub_require_node || exit 1

# 大文件守卫放最前：最便宜，且它拦的是「一旦提交就需要重写历史」的那一类问题。
node scripts/check-large-files.mjs --staged || exit 1
node scripts/check-web-overlay.mjs --staged || exit 1
node scripts/check-extensions.mjs || exit 1
node scripts/check-upstream-ref.mjs || exit 1

# 提交完整性：已跟踪文件不得引用未入库文件（2026-10-27 事故：vitest.config.ts 引用了
# 未提交的 worker-budget.ts，本地全绿、CI 两个作业同时崩）。--staged 只查本次暂存集。
node scripts/check-committed-refs.mjs --staged || exit 1

# 提交原子性：本次提交的**测试**不得依赖「改了但没提交」的源码（2026-10-29 事故：
# 测试先提交、源码还在暂存区，本地全绿、CI 26 例红）。与上一枚互补——那枚管「从未
# 入库」，这枚管「HEAD 里还是旧版本」。只审测试文件，成本是几次 git 调用。
node scripts/check-commit-atomicity.mjs --staged || exit 1

# 钩子自检：改了本安装脚本却忘记重装时，下面所有检查跑的还是旧生成物——
# 新加的闸门看起来「已经上了」，其实一次都没执行过。hash 对照是毫秒级。
node scripts/check-hooks-fresh.mjs || exit 1

# CI 工作流 / 门禁清单变更时校验合并门禁与清单一致性（秒级，仅相关文件暂存时才跑）。
# 门禁脚本读的就是 ci.yml 的聚合关系：改坏了只有 CI 会红，而 CI 自己正是被改的
# 那一方——等于没有守门人。清单（gates.json / 本安装脚本 / prepush-gates）也一样：
# 登记与接线不一致时只有下一次提交才会发现。放在 typecheck 之前，成本只有一次 YAML 解析。
if git diff --cached --name-only --diff-filter=ACMRD | grep -qE '^(\\.github/workflows/|scripts/gates\\.json|scripts/install-git-hooks\\.mjs|scripts/prepush-gates\\.mjs)'; then
  node scripts/check-ci-gate.mjs || exit 1
  node scripts/check-gates-registry.mjs || exit 1
fi

# 解析级快速门禁：只查 staged 的 TS/TSX，秒级；tsc 之前先把标点级错误挡住
node scripts/check-syntax.mjs --staged || exit 1

# 依赖完整性：秒级。装残的包会让几百个测试套件同时报「找不到模块 / resolve entry 失败」，
# 看起来像代码全坏（2026-10-29 一天两次）。先在这里认出「是依赖残了」，省掉一整轮排查。
node scripts/check-deps-integrity.mjs || exit 1

# mock 卫生：本次动了测试文件才查。跨模块 vi.mock 必须带 vi.resetModules() 兜底
# （isolate:false 下假模块会漏给同 worker 的后续文件）。修法是机械的，直接给可执行提示。
# 只查本次提交集（--changed）：全仓扫描会把并行会话在途的文件也拦进我的提交，
# 全仓口径归全量测试里的 mock-hygiene.test.ts。
if git diff --cached --name-only --diff-filter=ACM | grep -qE '(^|/).*\\.test\\.tsx?$'; then
  node scripts/fix-mock-hygiene.mjs --changed $(git diff --cached --name-only --diff-filter=ACM | grep -E '(^|/).*\\.test\\.tsx?$') || { echo "  ↑ 跑 node scripts/fix-mock-hygiene.mjs --apply 自动补齐"; exit 1; }
fi

# 清理动作覆盖：本次动了被登记的文件才查。清理函数漏一条出口（尤其提前 return）
# 就是「删了还在」；判据是「每条 return 之前都见到清理调用」。
if git diff --cached --name-only --diff-filter=ACM | grep -qE 'offline-video-cache\\.ts$'; then
  node scripts/check-cleanup-coverage.mjs || exit 1
fi

# 事实源判据：读路径不许「按计数选源」（把影子副本当正本，返回幻影数据）。
if git diff --cached --name-only --diff-filter=ACM | grep -qE '(storage|routes/videos)\\.ts$'; then
  node scripts/check-source-truth.mjs || exit 1
fi

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
  'import { execFileSync, spawn } from "node:child_process";',
  'import { createWriteStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";',
  'import { join, sep } from "node:path";',
  'import { pathToFileURL } from "node:url";',
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
  '  // 注入式覆盖：给自检用（scripts/precommit-select.test.ts 无法真的去改暂存区）。',
  '  // 只在测试里设，正常提交不会用到。',
  '  const injected = process.env.NAVHUB_PRECOMMIT_FILES;',
  '  if (injected) {',
  '    return injected.split(",").map((f) => f.trim()).filter(Boolean).map(posix);',
  '  }',
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
  '  // e2e 是 Playwright 的用例：交给 vitest 跑只会报「找不到测试」。',
  '  // 想让它在提交前跑，用 NAVHUB_PRECOMMIT_E2E=1（见文件末尾）。',
  '  if (file.startsWith("e2e/")) return { reason: "e2e 由 Playwright 跑，不纳入 vitest（可设 NAVHUB_PRECOMMIT_E2E=1）" };',
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
  '// —— 收窄：目录根 -> 具体测试文件 ——',
  '// 依据：选择性测试执行的通行做法是「名称/约定映射 + 不确定就回退到更大范围」',
  '// （Nx affected、pytest 影响面选择都是这个形状）。覆盖率/依赖图更准，但需要维护映射库；',
  '// 本仓用「改动文件的名字出现在测试文件名里」这个便宜信号，没命中再退回整棵——',
  '// 漏跑的代价由 CI 全量兜底，多跑的代价是每人每次多等几分钟，所以宁可多跑。',
  'const GENERIC_STEMS = new Set(["page", "index", "types", "utils", "util", "server", "config",',
  '  "layout", "route", "routes", "hooks", "hook", "lib", "main", "test", "spec", "apps",',
  '  "packages", "data", "admin", "components", "repository", "helpers", "index.test"]);',
  '',
  'function stemsOf(file) {',
  '  const parts = file.split("/");',
  '  const base = (parts[parts.length - 1] || "").replace(/\.(tsx?|mts|cts)$/, "");',
  '  const parent = parts.length > 1 ? parts[parts.length - 2] : "";',
  '  const out = [];',
  '  for (const raw of [base, parent]) {',
  '    for (const token of String(raw).split(/[-_.]/)) {',
  '      const t = token.toLowerCase();',
  '      if (t.length >= 4 && !GENERIC_STEMS.has(t) && out.indexOf(t) === -1) out.push(t);',
  '    }',
  '  }',
  '  return out;',
  '}',
  '',
  'function stemHit(stem, name) {',
  '  if (name.indexOf(stem) !== -1) return true;',
  '  // 复数归一：plugins -> plugin、jobs -> job。单数形式允许 3 字符：',
  '  // 曾经要求 >=4，结果 jobs 收不到 backup-restore-job.test.ts —— 而那是改 jobs.ts',
  '  // 最该跑的一条（它直接测 runBackupRestore）。漏选不会报错，只会少跑。',
  '  const singular = stem.endsWith("s") ? stem.slice(0, -1) : "";',
  '  return singular.length >= 3 && name.indexOf(singular) !== -1;',
  '}',
  '',
  '/** 挑出「有判别力」的词根：命中面过宽的词根不提供收窄信息，只把同前缀族全拖进来 */',
  'function filterSharp(stems, countOf, total) {',
  '  // 文件名层的实测（2026-10-28）：改 scripts/check-bundle-budget.mjs 时词根 check 命中',
  '  // 11/39 个测试文件名，「按名字收窄」于是选出 12 个——离整棵只差一点，收窄等于没做。',
  '  // 内容层的实测（同日）：词根 scripts 出现在 29/39 个测试文件里（到处是 scripts/ 路径），',
  '  // 它一混进来「整族都提到它」就把真正相关的 install 淹了 → 退回整棵。同一个判据两边都用。',
  '  // 判为通用词要同时满足「绝对数 >5」和「占比 >25%」：小目录判不出通用词也不要紧，',
  '  // 最坏是退回更宽的一层（本来就便宜），不会漏跑。',
  '  const floor = Math.ceil(total * 0.25);',
  '  return stems.filter((t) => {',
  '    const hits = countOf(t);',
  '    return hits <= 5 || hits <= floor;',
  '  });',
  '}',
  '',
  '/** 返回 [] 表示「收窄不了」，调用方应退回整棵（宁可多跑，不可漏跑） */',
  'function narrowTests(root, sources) {',
  '  if (sources.length === 0 || sources.length > 3) return [];',
  '  const all = listTestFiles(root);',
  '  if (all.length === 0) return [];',
  '  const stems = [];',
  '  for (const s of sources) for (const t of stemsOf(s)) if (stems.indexOf(t) === -1) stems.push(t);',
  '  if (stems.length === 0) return [];',
  '  const names = all.map((f) => f.split("/").pop().toLowerCase());',
  '  const pickByName = (list) => all.filter((f) => {',
  '    const name = f.split("/").pop().toLowerCase();',
  '    return list.some((t) => stemHit(t, name));',
  '  });',
  '  const nameHits = (t) => names.reduce((n, name) => n + (stemHit(t, name) ? 1 : 0), 0);',
  '  // 内容层懒加载：文件名命中时一个文件都不必读（收窄的常见路径要快）。',
  '  let texts = null;',
  '  const readTexts = () => {',
  '    if (texts === null) {',
  '      texts = all.map((f) => {',
  '        try { return readFileSync(f, "utf8").toLowerCase(); } catch { return ""; }',
  '      });',
  '    }',
  '    return texts;',
  '  };',
  '  const contentHits = (t) => readTexts().reduce((n, x) => n + (x.indexOf(t) !== -1 ? 1 : 0), 0);',
  '  const pickByContent = (list) => {',
  '    const tx = readTexts();',
  '    return all.filter((f, i) => list.some((t) => tx[i].indexOf(t) !== -1));',
  '  };',
  '  const wide = (files) => files.length > Math.ceil(all.length * 0.6);',
  '  const sharpNames = filterSharp(stems, nameHits, names.length);',
  '  // 先用有判别力的词根；它们一层都命中不了时退回「全部词根」（= 加这条规则之前的行为）。',
  '  // 顺序不能反：改一个专属词根没有对应测试的文件（如 scripts/check-foo.mjs）时，',
  '  // 只跑通用词根会让它从 12 个变成整棵——本规则只允许让选测变准，不允许让它变宽。',
  '  // 每一层先按文件名、文件名没命中再按内容：内容层能兜住「名字不相关但有耦合」的测试——',
  '  // 例 scripts/check-isr-routes.test.ts:19 注释写着「与 check-bundle-budget 同一套环境变量」，',
  '  // 文件名里却只有 check，光靠 sharp 词根永远收不到它。',
  '  for (const tier of [sharpNames, stems]) {',
  '    if (tier.length === 0) continue;',
  '    const byName = pickByName(tier);',
  '    if (byName.length > 0) return byName;',
  '    const sharpTexts = filterSharp(tier, contentHits, all.length);',
  '    if (sharpTexts.length === 0) continue;',
  '    const hits = pickByContent(sharpTexts);',
  '    // 命中面仍太广：换下一层，而不是一步退回整棵',
  '    if (hits.length > 0 && !wide(hits)) return hits;',
  '  }',
  '  return [];',
  '}',
  '',
  '// 全仓扫描型门禁：任何 UI 改动都可能踩到，必须常跑（它们扫的是整个 overlay 源码）',
  'const GLOBAL_GATE_TESTS = ["apps/web/test/field-names.test.ts", "apps/web/test/keyboard-activation.test.ts"];',
  '',
  'const staged = stagedFiles();',
  '',
  '/** 强制全量：并行开发时想确认「跨模块没被我改坏」就设它 */',
  'const FORCE_ALL = process.env.NAVHUB_PRECOMMIT_SCOPE === "all";',
  '/** 只走旧词根口径（跳过图）：供 scripts/test-impact.mjs --diff 回放对比，不改变正常选测 */',
  'const NO_GRAPH = process.env.NAVHUB_PRECOMMIT_NO_GRAPH === "1";',
  'const targets = new Set();',
  'const skipped = [];',
  'const globalFiles = [];',
  '',
  '// target -> 触发它的改动文件，收窄时按它们取词干',
  'const targetSources = new Map();',
  'for (const file of staged) {',
  '  const mapped = mapFile(file);',
  '  if (mapped.global) globalFiles.push(file);',
  '  else if (mapped.target) {',
  '    targets.add(mapped.target);',
  '    if (!targetSources.has(mapped.target)) targetSources.set(mapped.target, []);',
  '    targetSources.get(mapped.target).push(file);',
  '  } else skipped.push([file, mapped.reason]);',
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
  '// 多会话提示：直接 git commit 会让「索引里所有人的暂存」一起进提交，',
  '// 而 safe-commit.mjs 用独立索引提交、并在提交后校验文件集。',
  '// 只在没走脚本时提示（脚本提交时 GIT_INDEX_FILE 一定已设）。',
  '//',
  '// 注意位置：必须在 `const P` 之后。上一版把它放在 stagedFiles() 紧后面，',
  '// 结果 P 尚未初始化 —— 走脚本时因短路（GIT_INDEX_FILE 已设）恰好没暴露，',
  '// 而直接 git commit 会抛 ReferenceError 把提交拦下。',
  'if (!process.env.GIT_INDEX_FILE && !process.env.NAVHUB_PRECOMMIT_FILES) {',
  '  console.log(P + "提示：本次未用 scripts/safe-commit.mjs。直接 git commit 会带上索引里别人的暂存内容，");',
  '  console.log(P + "      多会话并行时建议：node scripts/safe-commit.mjs --msg-file <file> -- <paths>");',
  '}',
  '',
  '/**',
  ' * 暂存集按顶层目录分组打印。',
  ' *',
  ' * 存在的理由：多会话并行同一个仓库时，另一方一次 `git add -A` 会把我已经',
  ' * add 好的文件一起带走——commit message 只描述他自己的改动，`git log` 上',
  ' * 就出现「视觉改动的 commit 里躺着别人的 e2e 脚本」。实测已发生过一次。',
  ' * 这里不做自动拦截（无法可靠判断「谁的文件」），只把分布摆出来：',
  ' * 若本次只想改 docs 却看到 apps/api:12，提交前就能发现。',
  ' */',
  'const byTop = new Map();',
  'for (const file of staged) {',
  '  const parts = file.split("/");',
  '  const top = parts.length > 1 ? (parts[0] === "apps" || parts[0] === "packages" ? parts.slice(0, 2).join("/") : parts[0]) : "(仓库根)";',
  '  byTop.set(top, (byTop.get(top) || 0) + 1);',
  '}',
  'console.log(P + "暂存集分布：" + Array.from(byTop).map(([k, v]) => k + ":" + v).join("  "));',
  'if (byTop.size > 3) {',
  '  console.log(P + "提示：本次提交跨 " + byTop.size + " 个顶层目录。若其中有不属于你这次改动的文件，");',
  '  console.log(P + "      用 git restore --staged <path> 摘掉后重新提交（多会话并行时尤其要核对）。");',
  '}',
  '',
  'if (globalFiles.length > 0 || FORCE_ALL) {',
  '  console.log(P + (FORCE_ALL ? "NAVHUB_PRECOMMIT_SCOPE=all：强制运行全量测试" : "注意：本次提交改动了全局配置 " + globalFiles.join(", ") + "，改为运行全量测试"));',
  '  for (const root of allTestRoots()) targets.add(root);',
  '  skipped.length = 0;',
  '}',
  '',
  '// —— 模块图影响面（图优先，词根回退）——',
  '// 词根匹配只看「名字像不像」：改 packages/core/src/x.ts 时，名字里没有 x 的测试',
  '// 其实全都依赖它（经 @navhub/core 或 overlay 再导出）；反过来改 scripts/check-*.mjs',
  '// 时，词根又会把同前缀族整族拖进来。模块图直接回答「谁引用了它」——',
  '// import 边 + 测试里的路径字面量（守卫型测试 readFileSync/spawn 源码）+',
  '// core↔overlay 镜像边，见 scripts/lib/test-impact.mjs。',
  '//',
  '// 动态加载：本文件是生成到 .git/hooks 下的脚本，拿不到仓库相对路径；旧检出里也',
  '// 可能还没有这个库。加载/建图失败一律退回词根匹配——选测器升级不能拒绝提交。',
  'let impactLib = null;',
  'const looksLikeSource = staged.some((f) => /\\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f));',
  'if (!FORCE_ALL && !NO_GRAPH && looksLikeSource) {',
  '  try {',
  '    impactLib = await import(pathToFileURL(join(process.cwd(), "scripts", "lib", "test-impact.mjs")).href);',
  '  } catch {',
  '    impactLib = null;',
  '    console.log(P + "模块图库加载失败，本次按文件名回退选测");',
  '  }',
  '}',
  'const impactedByRoot = new Map();',
  'if (impactLib) {',
  '  try {',
  '    const impacted = impactLib.impactedTests(impactLib.graphFor(process.cwd()), staged);',
  '    const roots = allTestRoots();',
  '    for (const file of impacted) {',
  '      const root = roots.filter((r) => file.startsWith(r + "/")).sort((a, b) => b.length - a.length)[0];',
  '      if (!root) continue;',
  '      if (!impactedByRoot.has(root)) impactedByRoot.set(root, new Set());',
  '      impactedByRoot.get(root).add(file);',
  '    }',
  '  } catch {',
  '    impactedByRoot.clear();',
  '    console.log(P + "模块图建图失败，本次按文件名回退选测");',
  '  }',
  '}',
  '// 图命中的根即使不直接对应改动文件也要跑：改 packages/core 会连累 apps/web 的测试，',
  '// 只按「改动在哪个包」选根是看不见的。',
  'for (const root of impactedByRoot.keys()) {',
  '  targets.add(root);',
  '  if (!targetSources.has(root)) targetSources.set(root, []);',
  '}',
  '',
  'if (targets.size === 0) {',
  '  console.log(P + "SKIP：本次提交的 " + staged.length + " 个改动文件没有匹配到任何测试——本次提交没有运行任何测试");',
  '  for (const [file, reason] of skipped) console.log("    - " + file + "  ->  " + reason);',
  '  console.log(P + "如果这些改动本该有测试覆盖：补一个测试，或把该目录加进映射表（生成源 scripts/install-git-hooks.mjs）");',
  '  process.exit(0);',
  '}',
  '',
  '/**',
  ' * 目标 -> 具体测试文件。',
  ' *',
  ' * 能收窄就收窄（只跑名字相关的），收不了就整棵跑。',
  ' * 为什么值得：改动一个 backup.ts 会牵动整棵 apps/api/test（93 文件），',
  ' * 其中绝大多数与本改动无关；并行开发时还会撞上别人正在改、暂时红着的测试，',
  ' * 于是「我的提交被别人的半成品挡住」。',
  ' */',
  'const picked = new Set();',
  'const narrowedRoots = [];',
  'for (const target of targets) {',
  '  const isSingleFile = existsSync(target) && statSync(target).isFile();',
  '  if (isSingleFile) { picked.add(target); continue; }',
  '  const graphHit = FORCE_ALL || NO_GRAPH ? [] : Array.from(impactedByRoot.get(target) || []).sort();',
  '  if (graphHit.length > 0) {',
  '    narrowedRoots.push(target + "(" + graphHit.length + "，图)");',
  '    for (const f of graphHit) picked.add(f);',
  '    continue;',
  '  }',
  '  const narrowed = FORCE_ALL ? [] : narrowTests(target, targetSources.get(target) || []);',
  '  if (narrowed.length > 0) {',
  '    narrowedRoots.push(target + "(" + narrowed.length + "，文件名)");',
  '    for (const f of narrowed) picked.add(f);',
  '  } else {',
  '    for (const f of listTestFiles(target)) picked.add(f);',
  '  }',
  '}',
  '// 全仓扫描门禁：改了 UI 就必须跑，否则 a11y 回归会从钩子里溜过去',
  'const uiTouched = staged.some((f) => f.startsWith("apps/web-overlay/src/") || f.startsWith("apps/web/src/"));',
  'if (uiTouched) for (const gate of GLOBAL_GATE_TESTS) if (existsSync(gate)) picked.add(gate);',
  'const testFiles = Array.from(picked).sort();',
  '',
  '// —— a11y 门禁的范围 ——',
  '//',
  '// `field-names` 是「按文件独立」的规则（控件有没有名字只取决于它所在文件），',
  '// 所以可以只检查本次改动的 .tsx。不收窄的话，并行会话里任何人的半成品 UI',
  '// 都会挡住我的提交——本轮就被对方的 `plugin-review-section.tsx:411` 挡了两次。',
  '//',
  '// 只传 overlay 源码树下的文件：`field-names` 自己会过滤镜像路径，',
  '// 若一个都没落进去它会回退全量（见测试里的 SCOPED_FILES）。',
  '// `keyboard-activation` **不参与**收窄：它有跨文件白名单一致性约束，只看子集会假失败。',
  'const a11yScope = staged.filter((f) => f.startsWith("apps/web-overlay/src/") && f.endsWith(".tsx"));',
  '',
  'console.log(P + "本次提交改动 " + staged.length + " 个文件");',
  'console.log(P + "选中 " + targets.size + " 个测试目标 / " + testFiles.length + " 个测试文件：" + Array.from(targets).join("  "));',
  'if (a11yScope.length > 0) {',
  '  console.log(P + "a11y 门禁只检查本次改动的 " + a11yScope.length + " 个 .tsx（全量由 CI 兜底）");',
  '}',
  'if (narrowedRoots.length > 0) {',
  '  console.log(P + "已收窄：" + narrowedRoots.join("  ") + "（括号内为命中的测试数与依据）");',
  '  console.log(P + "图 = 模块图可达（import / 路径字面量 / 镜像边）；文件名 = 图没命中时的词根回退。");',
  '  console.log(P + "漏跑由 CI 全量兜底；想强制全量：NAVHUB_PRECOMMIT_SCOPE=all");',
  '}',
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
  '// 输出同时落盘到 .git/navhub-precommit.log。',
  '// 起因：一次 271 文件 / 2869 例的组合运行报「1 failed」，但失败用例名被终端截断，',
  '// 事后完全无法定位是哪一例、也无法判断是真回归还是 worker 崩溃。',
  '// 用 spawn + 转手写而不是 spawnSync + pipe：后者会把 10 分钟的测试输出',
  '// 全部缓冲到进程结束才显示，等于让人对着空屏等。',
  '// 自检用：只打印将运行哪些文件，不真的跑。',
  'if (process.env.NAVHUB_PRECOMMIT_DRYRUN === "1") {',
  '  console.log("DRYRUN_FILES=" + JSON.stringify(testFiles));',
  '  process.exit(0);',
  '}',
  '',
  'const LOG_PATH = join(process.cwd(), ".git", "navhub-precommit.log");',
  'const logStream = createWriteStream(LOG_PATH, { encoding: "utf-8" });',
  'logStream.write("# " + new Date().toISOString() + "  targets=" + Array.from(targets).join(",") + "\\n");',
  '// 传**具体测试文件**而不是目录：收窄的结果必须真的决定跑什么，',
  '// 否则「只跑了 8 个」只是一句日志，vitest 照样把整棵目录跑一遍。',
  '// 夹具测试会 spawn git 建临时仓库（check-committed-refs / commit-atomicity / commit-closure…）。',
  '// safe-commit 用独立索引提交，钩子里继承着 GIT_INDEX_FILE——fixture 的 git add 会写进',
  '// **本次提交的那个临时索引**，把提交集冲掉。实测（2026-10-29）：钩子跑自己的门禁测试，',
  '// 报「本次提交不含测试文件」，safe-commit 随后校验文件集失败。子进程一律拿干净的 git 环境。',
  'const childEnv = Object.assign({}, process.env, a11yScope.length > 0 ? { NAVHUB_A11Y_SCOPE: a11yScope.join(",") } : {});',
  'delete childEnv.GIT_INDEX_FILE;',
  'delete childEnv.GIT_DIR;',
  'delete childEnv.GIT_WORK_TREE;',
  'const child = spawn(process.execPath, [vitestEntry, "run"].concat(testFiles), {',
  '  stdio: ["inherit", "pipe", "pipe"],',
  '  env: childEnv,',
  '});',
  'child.stdout.on("data", (chunk) => { process.stdout.write(chunk); logStream.write(chunk); });',
  'child.stderr.on("data", (chunk) => { process.stderr.write(chunk); logStream.write(chunk); });',
  'child.on("error", (err) => {',
  '  console.error(P + "运行 vitest 失败：" + err.message);',
  '  logStream.end();',
  '  process.exit(1);',
  '});',
  'child.on("close", (code) => {',
  '  const ok = code === 0;',
  '  console.log(P + (ok ? "测试通过" : "测试未通过（退出码 " + code + "）") + "；完整输出：" + LOG_PATH);',
  '  logStream.end();',
  '  if (!ok) process.exit(typeof code === "number" ? code : 1);',
  '',
  '  /**',
  '   * 可选：提交前跑 Playwright。',
  '   *',
  '   * 默认不跑——e2e 一套要 5 分钟起，还得起 dev 栈，塞进每次提交不现实。',
  '   * 需要时设 NAVHUB_PRECOMMIT_E2E=1：只跑**本次暂存**的 spec 文件，',
  '   * 不猜「改了页面该跑哪些用例」（那个映射关系不存在，猜错比不跑更糟）。',
  '   */',
  '  if (process.env.NAVHUB_PRECOMMIT_E2E !== "1") process.exit(0);',
  '  const specs = staged.filter((f) => f.startsWith("e2e/") && TEST_FILE_RE.test(f));',
  '  if (specs.length === 0) {',
  '    console.log(P + "NAVHUB_PRECOMMIT_E2E=1，但本次没有暂存 e2e 用例，跳过 Playwright");',
  '    process.exit(0);',
  '  }',
  '  console.log(P + "NAVHUB_PRECOMMIT_E2E=1：运行 " + specs.length + " 个 Playwright 用例：" + specs.join("  "));',
  '  const pw = spawn(process.execPath, ["scripts/e2e-local.mjs"].concat(specs, ["--reporter=line"]), { stdio: "inherit" });',
  '  pw.on("error", (err) => { console.error(P + "启动 Playwright 失败：" + err.message); process.exit(1); });',
  '  pw.on("close", (pwCode) => process.exit(typeof pwCode === "number" ? pwCode : 1));',
  '});',
  '',
].join('\n')
writeFileSync(preCommitPath, script, { encoding: 'utf-8', mode: 0o755 })
writeFileSync(selectorPath, selector, { encoding: 'utf-8' })
writeFileSync(prePushPath, prePush, { encoding: 'utf-8', mode: 0o755 })
writeFileSync(nodeLibPath, nodeLib, { encoding: 'utf-8' })
// 安装清单必须最后写：它记录的是上面四个文件**落盘后**的 hash。
// pre-commit 里的 check-hooks-fresh 拿它判断「模板改了没重装」。
writeFileSync(
  join(gitHooksDir, MANIFEST_NAME),
  JSON.stringify(buildManifest({ hooksDir: gitHooksDir, sourcePath: fileURLToPath(import.meta.url) }), null, 2) + '\n',
  { encoding: 'utf-8' },
)
for (const path of [preCommitPath, prePushPath]) {
  try {
    chmodSync(path, 0o755)
  } catch {
    // Windows 上可能不支持 chmod，忽略
  }
}

console.log('✅ Git pre-commit hook 安装成功 (.git/hooks/pre-commit)')
console.log('✅ Git pre-push hook 安装成功 (.git/hooks/pre-push)')
