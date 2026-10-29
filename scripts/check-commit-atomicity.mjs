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
  collectDependencies,
  findAtomicityViolations,
  findHeadConsumerOrphans,
  findSourceCompanionViolations,
  memberNamesOf,
  reexportTargets,
  SOURCE_FILE_RE,
  TEST_FILE_RE,
} from "./lib/commit-atomicity.mjs";
import { normalizePath, stripComments } from "./lib/source-refs.mjs";

const ROOT = process.cwd();
const AS_JSON = process.argv.includes("--json");
const ALLOW = process.env.NAVHUB_ALLOW_DIRTY_TEST_DEPS === "1";
const ALLOW_SOURCE = process.env.NAVHUB_ALLOW_DIRTY_SOURCE_DEPS === "1";
const STRICT_HEAD = process.argv.includes("--strict-head-consumers");
/**
 * 「可归因」门槛：字段名的引用点散落在超过这么多文件时不再逐个算依赖边。
 * 泛名字（`.items` `.mode` `.stats`）落不进这一档 → 不报，只记账；
 * 真出事的字段名（`.semanticMinSimilarity`）都是窄的。实测整仓 12 档以内 ~0.3s，放开到不限量是 8s。
 */
const MAX_HIT_FILES = 12;
/**
 * 只有 CI 真会 typecheck / 跑测的文件才配当消费者。
 *
 * 刻意不收：`tmp/`（别的会话留在索引里的样例面板，同名符号成批出现）、
 * `deliverables/`（审查快照正文，不是代码路径）、`apps/web/`（vendor 镜像，
 * overlay 那份已在报）。收进来不会更准——同一个字段被镜像与原件各报一遍，
 * 引用点数翻倍后撞上 MAX_HIT_FILES，真问题反而整条被放弃。
 */
const CONSUMER_FILE_RE =
  /^(?:apps\/(?:api|web-overlay)\/(?:src|test)\/|packages\/[A-Za-z0-9._-]+\/(?:src|test|scripts)\/|scripts\/)/;
/** 上面那条正则的 pathspec 版本（给 git grep 少扫一半语料）；node_modules 里有打包进来的源码镜像 */
const CONSUMER_PATHSPEC = [
  "apps/api/",
  "apps/web-overlay/src/",
  "apps/web-overlay/test/",
  "packages/*/src/",
  "packages/*/test/",
  "packages/*/scripts/",
  "scripts/",
  ":(exclude)**/node_modules/**",
];

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

/** 索引内容在一次运行里不会变：memo 掉，闭包与依赖边都反复问同一个桶文件 */
const committedCache = new Map();
function readCommitted(file) {
  if (committedCache.has(file)) return committedCache.get(file);
  let text;
  try {
    text = git(["show", `:${file}`]);
  } catch {
    text = null;
  }
  committedCache.set(file, text);
  return text;
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

/**
 * 「工作区相对索引」的未暂存 diff，一次进程取全部文件的量再按文件切开。
 *
 * 判据比对的两侧必须是「CI 会看到的」和「本机工具会看到的」：前者是索引 blob（本次提交内容），
 * 后者是工作区。用 `git diff HEAD` 会把「已暂存的字段」也算成只在本地存在，于是对自己正在
 * 提交的改动误报。
 *
 * 为什么必须批量：共享工作区常年有 20+ 个未暂存源码文件，逐文件起 `git diff` + `git show`
 * 实测把这条检查从 0.1s 顶到 8.3s——pre-commit 里没人能接受，噪音门禁最后的去处是被绕过。
 * stderr 丢掉：LF/CRLF 提示会逐文件刷屏。
 */
function unstagedDiffsByFile(files) {
  const byFile = new Map();
  if (files.length === 0) return byFile;
  let out;
  try {
    out = execFileSync("git", ["diff", "--", ...files], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return byFile;
  }
  let current = null;
  for (const line of out.split(/\r?\n/)) {
    const header = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (header) {
      current = normalizePath(header[1].replace(/"$/g, ""));
      if (!byFile.has(current)) byFile.set(current, "");
      continue;
    }
    if (current !== null) byFile.set(current, byFile.get(current) + line + "\n");
  }
  return byFile;
}

/** 工作区 ≠ 索引 的文件（未暂存的那一半；未入库的新文件不在这里，也轮不到它当生产者） */
function unstagedChanges() {
  return zlist(["diff", "--name-only", "-z"]);
}

/**
 * 一次 `git grep --cached` 搜完所有 token。
 *
 * 两个必须合在一起的口径（都是量出来的，见 docs/GATES-OPERATIONS.md）：
 *   - **一条 `-E` 交替**而不是 N 个 `-F`：多 `-F` 模式在 git 里是逐个扫的，实测 95 个 token
 *     要 7.7s；换成一条 `\.a\b|\.b\b|…` 是 1.5s。
 *   - **pathspec 收窄到 CI 真检查的那几棵树**：同一条正则在「全仓 `*.ts`」是 1508ms、
 *     收窄后 752ms——`deliverables/` 与 vendor 镜像里的同名符号只会把引用点数抬高，
 *     撞满 MAX_HIT_FILES 后反而整条不报。
 * `\b` 保证 `.search` 不会命中 `.searchable`；无命中时 git grep 退出码 1，那不是失败，是空集。
 */
function grepCommittedTree(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];
  const capped = tokens.slice(0, 400);
  const pattern = capped
    .map((t) => t.replace(/[$.*+?()[\]{}|\\]/g, (ch) => "\\" + ch) + "\\b")
    .join("|");
  const args = ["grep", "--cached", "-n", "-E", "--no-color", "-e", pattern, "--", ...CONSUMER_PATHSPEC];
  let out;
  try {
    out = execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^(.+?):(\d+):(.*)$/.exec(line);
    if (!m) continue;
    rows.push({ file: normalizePath(m[1]), line: Number(m[2]), text: m[3] });
  }
  return rows;
}

/**
 * 「谁再导出了它」的反向图，用**一次** `git grep --cached` 建起来。
 *
 * 为什么不用 lib 里的 `reexportClosure`（它是正向、逐跳 `git show`）：这条判据要对
 * 十几个消费者各问一次「你的桶里有没有这个生产者」，正向闭包会把同一批桶文件反复
 * 一个进程一个进程地读——实测把整条检查顶到 ~10s（本门禁原本只有 0.28s）。
 * 反着一遍建图只要一次 grep（160 行再导出）+ 进程内解析，判定退化成集合查表。
 */
let reverseReexport = null;
function buildReverseReexportGraph() {
  if (reverseReexport !== null) return reverseReexport;
  const reverse = new Map();
  let out;
  try {
    out = execFileSync(
      "git",
      ["grep", "--cached", "-n", "-E", "--no-color", "-e", "^[[:space:]]*export[[:space:]]+[*{]", "--", "*.ts", "*.tsx", "*.mts", "*.cts", "*.mjs", "*.cjs", "*.js", "*.jsx"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    out = "";
  }
  for (const line of out.split(/\r?\n/)) {
    const m = /^(.+?):(\d+):(.*)$/.exec(line);
    if (!m) continue;
    const file = normalizePath(m[1]);
    for (const target of reexportTargets(m[3], file, { exists: existsAsFile })) {
      if (!reverse.has(target)) reverse.set(target, new Set());
      reverse.get(target).add(file);
    }
  }
  reverseReexport = reverse;
  return reverse;
}

const exportersCache = new Map();
/** 传递地再导出 `producer` 的那些文件（桶、桶的桶…）——即「正向闭包里有 producer 的所有起点」 */
function exportersOf(producer) {
  if (exportersCache.has(producer)) return exportersCache.get(producer);
  const reverse = buildReverseReexportGraph();
  const out = new Set();
  const queue = [producer];
  while (queue.length > 0 && out.size < 500) {
    const file = queue.shift();
    for (const parent of reverse.get(file) ?? []) {
      if (parent === producer || out.has(parent)) continue;
      out.add(parent);
      queue.push(parent);
    }
  }
  exportersCache.set(producer, out);
  return out;
}

/**
 * 消费者 → 生产者的依赖边。
 *
 * 先查**直接 import**（`context.ts` 就是 `import type { AppConfig } from "./config.ts"`，
 * 命中就不用碰桶），没命中再问「消费者直接依赖的那个桶，是否（传递地）再导出了生产者」。
 */
const directDepsCache = new Map();
function directDepsOf(file) {
  if (directDepsCache.has(file)) return directDepsCache.get(file);
  const deps = new Set();
  const source = readCommitted(file);
  if (typeof source === "string") {
    // pathLiterals 一律关：这一路问的是**类型级**消费者。测试用 readFileSync 读生产者正文
    // 并不构成「读了一个不存在的字段」——那种边归 findAtomicityViolations 管，这里的口径要窄。
    for (const [dep] of collectDependencies(source, file, { exists: existsAsFile, pathLiterals: false })) {
      deps.add(dep);
    }
  }
  directDepsCache.set(file, deps);
  return deps;
}

function dependsOn(consumer, producer) {
  const direct = directDepsOf(consumer);
  if (direct.has(producer)) return true;
  const reach = exportersOf(producer);
  for (const dep of direct) if (reach.has(dep)) return true;
  return false;
}

function reportHeadConsumers(orphans, skipped) {
  if (orphans.length === 0 && skipped.length === 0) return false;
  console.log(`\n⚠️ HEAD 自洽性（只报不拦）：${orphans.length} 个字段只在工作区，提交树里已有消费者在读它`);
  for (const o of orphans) {
    console.log(`   ${o.producer}  →  .${o.member}（${o.consumerCount} 处引用${o.consumerCount > o.consumers.length ? "，列前 " + o.consumers.length + " 处" : ""}）`);
    for (const c of o.consumers) {
      console.log(`     ${c.file}:${c.line}  ${c.text.trim().slice(0, 110)}`);
    }
  }
  if (skipped.length > 0) {
    console.log(
      `   （另有 ${skipped.length} 个新增字段名的引用点散落在 >${MAX_HIT_FILES} 个文件，逐文件算依赖边的成本不划算，未归因：` +
        skipped
          .slice(0, 8)
          .map((s) => `.${s.member}`)
          .join(" ") +
        (skipped.length > 8 ? " …" : "") +
        `）`,
    );
  }
  console.log("   处理：把生产者那半一起提交（git add <producer>），或等它落地后本条自动消失。");
  return true;
}

function headConsumerCheck() {
  if (process.env.NAVHUB_SKIP_HEAD_CONSUMERS === "1") return { orphans: [], skipped: [] };
  // apps/web 是 vendor 生成物（gitignore），事实源在 overlay：对它算 diff 只会读到镜像噪声
  const files = unstagedChanges().filter(
    (f) => SOURCE_FILE_RE.test(f) && !TEST_FILE_RE.test(f) && !f.startsWith("apps/web/"),
  );
  if (files.length === 0) return { orphans: [], skipped: [] };
  const diffs = unstagedDiffsByFile(files);
  const producers = files
    .filter((f) => typeof diffs.get(f) === "string" && diffs.get(f).trim() !== "")
    .map((f) => ({ file: f, unstagedDiff: diffs.get(f) }));
  if (producers.length === 0) return { orphans: [], skipped: [] };
  const skipped = [];
  const memberMemo = new Map();
  const orphans = findHeadConsumerOrphans({
    producers,
    // 惰性：只有 grep 到引用的生产者才读它的提交版本。预读全部 41 个实测 1.4s，
    // 而真出事的通常只有一两个文件。
    committedMembersOf: (file) => {
      if (!memberMemo.has(file)) {
        const source = readCommitted(file);
        memberMemo.set(file, typeof source === "string" ? memberNamesOf(stripComments(source)) : new Set());
      }
      return memberMemo.get(file);
    },
    grepCommitted: (tokens) => grepCommittedTree(tokens).filter((h) => CONSUMER_FILE_RE.test(h.file)),
    dependsOn,
    maxHitFiles: MAX_HIT_FILES,
    onSkip: (member, hitFiles) => skipped.push({ member, files: hitFiles }),
  });
  // 本次提交集里带着生产者也要报：unstaged diff 量的是「工作区 − 索引」，
  // 索引才是 CI 看到的版本——已暂存但字段没暂存，同样是不自洽的提交树。
  return { orphans, skipped };
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

  const head = headConsumerCheck();

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        {
          mode: "staged",
          tests: tests.length,
          violations: [],
          sourceViolations: [],
          headConsumers: head.orphans,
          headConsumersUnattributed: head.skipped.length,
          strictHeadConsumers: STRICT_HEAD,
        },
        null,
        2,
      ),
    );
    if (STRICT_HEAD && head.orphans.length > 0) process.exit(1);
    return;
  }

  if (sourceViolations.length > 0) {
    console.log("⚠️ 提交原子性：源码伴随改动已按 NAVHUB_ALLOW_DIRTY_SOURCE_DEPS=1 放行（清单见上）。");
  } else if (tests.length === 0) {
    console.log("✅ 提交原子性：本次提交不含测试文件，源码伴随即动检查通过。");
  } else {
    console.log(`✅ 提交原子性：${tests.length} 个测试的依赖均随本次提交（或与 HEAD 一致）；源码伴随改动一致。`);
  }

  // 只报不拦：共享工作区常年有在途脏源码，硬拦会把无关提交永久锁死（判据见 lib 的注释）。
  // 要它拦：--strict-head-consumers（本地排查用，没接进 pre-commit）。
  reportHeadConsumers(head.orphans, head.skipped);
  if (STRICT_HEAD && head.orphans.length > 0) process.exit(1);
}

main();
