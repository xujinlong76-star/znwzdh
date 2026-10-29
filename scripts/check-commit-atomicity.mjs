#!/usr/bin/env node
/**
 * 提交原子性门禁：**本次提交的测试，不得依赖「脏了但没提交」的文件**。
 *
 * 事故形状（2026-10-29，89a20b42）：并行会话先提交测试、源码还在暂存区。
 * 本地 vitest 读工作区（新源码）全绿，CI 检出提交树（旧源码）立刻 26 例红，
 * 而报错指向测试断言，根因却是一次不原子的提交。
 *
 * 判定（详见 scripts/lib/commit-atomicity.mjs）：
 *   1. 取本次提交集（`git diff --cached`，尊重 GIT_INDEX_FILE）；
 *   2. 只审其中的测试文件，解析两类依赖：模块说明符 + 路径字面量。字面量的目标既可以是
 *      源码，也可以是**被断言的非代码文件**（`.github/workflows/ci.yml`、`*.css`、
 *      `docker/Dockerfile.*`、`docs/*.json`）——门禁测试就是靠读这些内容做钉子断言的，
 *      「只提交测试、把 ci.yml 留在工作区」与「只提交测试、把 page.tsx 留在工作区」是同一种不原子。
 *   3. 依赖不在提交集，且工作区版本与 HEAD 不同（或压根未入库）→ 拦下。
 *
 * 为什么目标必须「脏」才报：目标干净 = 提交树里的版本就是工作区版本，测试在 CI
 * 里看到的与本地一致，不构成风险；只有两边不一致才是事故。
 *
 * 临时跳过（确认脏依赖与本次测试无关，例如对方只改了注释）：
 *   NAVHUB_ALLOW_DIRTY_TEST_DEPS=1 git commit ...
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  changedExportNames,
  findAtomicityViolations,
  findSourceCompanionViolations,
  TEST_FILE_RE,
} from "./lib/commit-atomicity.mjs";
import { normalizePath } from "./lib/source-refs.mjs";

const ROOT = process.cwd();
const AS_JSON = process.argv.includes("--json");
const ALLOW = process.env.NAVHUB_ALLOW_DIRTY_TEST_DEPS === "1";
const ALLOW_SOURCE = process.env.NAVHUB_ALLOW_DIRTY_SOURCE_DEPS === "1";

function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function zlist(args) {
  return git(args)
    .split("\0")
    .filter(Boolean)
    .map(normalizePath);
}

/** 目标必须真的是文件：同名目录不算（同 check-committed-refs 的口径） */
function existsAsFile(relPath) {
  const abs = resolve(ROOT, relPath);
  if (!existsSync(abs)) return false;
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

function commitSet() {
  return zlist(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]);
}

/**
 * 脏集 = 「工作区版本 ≠ HEAD 版本」∪「未入库且未被忽略」。
 *
 * 用 `git diff HEAD` 而不是 `git diff --cached`：判据是测试在 CI 里会看到什么
 * （提交树 = 索引里的 blob），所以只要工作区与 HEAD 有差异、又没随本次提交带进去，
 * 就存在「本地测新、CI 测旧」的错位;索引里暂存但没进本次提交的也算（事故正是这种）。
 */
function dirtySet() {
  return new Set([
    ...zlist(["diff", "--name-only", "-z", "HEAD"]),
    ...zlist(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
}

function readCommitted(file) {
  try {
    return git(["show", `:${file}`]);
  } catch {
    return null;
  }
}

/** 目标文件 HEAD → 工作区被改写/删除的导出符号（干净文件返回空集） */
function changedExportsOf(file) {
  let diff;
  try {
    diff = git(["diff", "HEAD", "--", file]);
  } catch {
    return new Set();
  }
  return changedExportNames(diff);
}

function reportSourceCompanions(violations) {
  if (ALLOW_SOURCE) {
    console.log(
      `⚠️ 提交原子性：NAVHUB_ALLOW_DIRTY_SOURCE_DEPS=1，跳过 ${violations.length} 处源码伴随改动：`,
    );
    for (const v of violations) console.log(`   ${v.file}  →  ${v.target}（${v.symbols.join(", ")}）`);
    return false;
  }
  console.error(
    `❌ 提交原子性：${violations.length} 处源码依赖了「导出签名改过、但没随本次提交」的源文件\n`,
  );
  console.error("   本机 typecheck 读工作区（新签名）会绿，CI 检出提交树（旧签名）会红在 typecheck。\n");
  for (const v of violations) {
    console.error(`   ${v.file}`);
    console.error(`     依赖 ${v.spec}  →  ${v.target}`);
    console.error(`     被改写的导出：${v.symbols.join(", ")}（该文件不在本次提交里）`);
  }
  console.error("\n   处理：");
  console.error("     1) 把伴随改动一起加进本次提交（git add <path>，再重跑 safe-commit）");
  console.error("     2) 先不提交这处源码，等依赖方就绪后一起提");
  console.error("     3) 确认改的不是你用的那个符号的语义（例如只动了实现）→ NAVHUB_ALLOW_DIRTY_SOURCE_DEPS=1 重新提交");
  return true;
}

function main() {
  const commit = commitSet();
  const tests = commit.filter((f) => TEST_FILE_RE.test(f));

  const dirty = dirtySet();
  const violations = findAtomicityViolations({
    commitSet: commit,
    readCommitted,
    exists: existsAsFile,
    isDirty: (rel) => dirty.has(rel),
  });

  if (violations.length > 0 && ALLOW) {
    console.log(
      `⚠️ 提交原子性：NAVHUB_ALLOW_DIRTY_TEST_DEPS=1，跳过 ${violations.length} 处脏依赖：`,
    );
    for (const v of violations) console.log(`   ${v.test}  →  ${v.target}`);
  } else if (violations.length > 0) {
    if (AS_JSON) {
      console.log(JSON.stringify({ mode: "staged", tests: tests.length, violations }, null, 2));
    } else {
      console.error(`❌ 提交原子性：${violations.length} 处测试依赖了「已改动但不在本次提交集」的文件\n`);
      console.error("   本地测试读工作区（新版本），CI 检出提交树（旧版本）——这种提交本地全绿、CI 必红。\n");
      for (const v of violations) {
        console.error(`   ${v.test}`);
        console.error(`     依赖 ${v.spec}  →  ${v.target}`);
        console.error(`     该文件在工作区已改动（或未入库），但不在本次提交里。`);
      }
      console.error("\n   处理：");
      console.error("     1) 依赖方与测试属于同一改动 → 把它一起加进本次提交（git add <path>，再重跑 safe-commit）");
      console.error("     2) 测试改动先不提交 → git restore --staged <test>，等源码就绪后一起提");
      console.error("     3) 确认脏依赖与本次测试无关（例如对方只改了注释）→ NAVHUB_ALLOW_DIRTY_TEST_DEPS=1 重新提交");
    }
    process.exit(1);
  }

  const sourceViolations = findSourceCompanionViolations({
    commitSet: commit,
    readCommitted,
    exists: existsAsFile,
    isDirty: (rel) => dirty.has(rel),
    changedExportsOf,
  });
  if (sourceViolations.length > 0) {
    if (AS_JSON) {
      console.log(
        JSON.stringify(
          { mode: "staged", tests: tests.length, violations: [], sourceViolations, allowed: ALLOW_SOURCE },
          null,
          2,
        ),
      );
      if (!ALLOW_SOURCE) process.exit(1);
    } else if (reportSourceCompanions(sourceViolations)) {
      process.exit(1);
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ mode: "staged", tests: tests.length, violations: [], sourceViolations: [] }, null, 2));
  } else if (sourceViolations.length > 0) {
    console.log("⚠️ 提交原子性：源码伴随改动已按 NAVHUB_ALLOW_DIRTY_SOURCE_DEPS=1 放行（清单见上）。");
  } else if (tests.length === 0) {
    console.log("✅ 提交原子性：本次提交不含测试文件，源码伴随即动检查通过。");
  } else {
    console.log(`✅ 提交原子性：${tests.length} 个测试的依赖均随本次提交（或与 HEAD 一致）；源码伴随改动一致。`);
  }
}

main();
