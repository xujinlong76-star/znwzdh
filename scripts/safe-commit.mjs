#!/usr/bin/env node
/**
 * 多会话安全提交：只提交**我指定的路径**，并在提交后校验「确实只提交了这些」。
 *
 * ## 为什么需要它
 *
 * 这个仓库长期有多个会话并行开发（同一个工作区、同一个 .git）。已发生过 5 次事故：
 *
 *   1. 对方 `git add -A && git commit` 把我的工作区改动一并提交（对方 message 只描述
 *      自己的部分，我的改动在历史里找不到归属）——**发生 3 次**；
 *   2. 我 `git add` 之后、`git commit` 之前对方提交了一次，索引被动过，
 *      我的 `commit` 报「无暂存内容」——**发生 2 次**；
 *   3. 我的改动与对方的改动混在同一个文件里，整文件暂存会带上对方半成品，
 *      临时改 overlay 又会被 pre-commit 的镜像一致性检查判漂移。
 *
 * ## 为什么用独立索引，而不是 `git commit -- <paths>`
 *
 * 第一版用的是 `git add -- <paths>` + `git commit -- <paths>`（pathspec 形式）。
 * 它能保证「只提交我的路径」，但**仍依赖共享的 `.git/index` 构建完整 tree**——
 * 而并行会话正在 `git add -A` 大批量暂存时，索引里会有几千个别人的条目，
 * 其中任何一个 blob 在并发窗口里失效，`git commit` 都会失败：
 *
 *     error: invalid object 100644 <sha> for 'mine.ts'
 *     error: Error building trees
 *
 * 这个错误完全不提「是别人的索引条目坏了」，而且 `--dry-run` 可能成功（不写 tree），
 * 只有真提交才炸。本轮连撞两次。
 *
 * 现方案：**给这次提交一个独立索引**（`GIT_INDEX_FILE`）：
 *
 *     git read-tree HEAD          # 从 HEAD 起一份干净索引（不含任何人的暂存）
 *     git add -- <paths>          # 只加我的
 *     git commit -F msg           # 索引里只有我的，不需要 pathspec
 *
 * 好处不止是避开损坏：pre-commit 钩子里的 `git diff --cached` 也用同一个
 * `GIT_INDEX_FILE`，所以**钩子看到的改动集恰好是我的**，选测不会被别人的暂存污染。
 * 共享 `.git/index` 全程不动，别人的暂存内容原样保留。
 *
 * 它解决不了的一种情况：同一个文件里混着两个人的改动。那只能改设计绕开，
 * 别试图切 hunk（半成品进历史更难收拾）。
 *
 * ## 用法
 *
 *   node scripts/safe-commit.mjs --msg-file .commit-msg.txt -- a.ts b.ts c/
 *   node scripts/safe-commit.mjs --msg-file .commit-msg.txt --dry-run -- a.ts
 *
 * 提交前会被校验拦住的情况（都是真实踩过的）：
 *   · 路径写错 / 没改动          → 提交会是空提交，直接失败而不是静默成功；
 *   · 索引里有别人的已暂存内容    → 提示但不阻止（pathspec 提交不会带上它们）；
 *   · `.git/index.lock` 陈旧      → 超过 2 分钟视为陈旧并移除（活锁会让 git 卡住）。
 *
 * 提交后校验：`HEAD` 的文件集必须**恰好等于**本次指定且有变更的路径。
 * 多出任何文件都说明「有人的改动被卷进来了」，脚本以非 0 退出并打印该文件。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** 陈旧索引锁的判定阈值：活锁一般几秒内释放，超过这个时长基本是崩溃残留 */
const STALE_LOCK_MS = 2 * 60 * 1000;

/**
 * 解析 `git status --porcelain` 的输出。
 *
 * 格式：`XY <path>`（XY 是两个状态字母，可能有重命名箭头 `old -> new`）。
 * 导出是为了让 `scripts/safe-commit.test.ts` 能直接测它——
 * 这段解析错了会让「本次有哪些变更」判断失真，进而提交错东西。
 */
export function parseStatus(porcelain) {
  const out = [];
  for (const raw of String(porcelain).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line) continue;
    // 前两个字符是 XY，第三个是空格
    const xy = line.slice(0, 2);
    let path = line.slice(3);
    // 重命名/复制：`R  old -> new` —— 提交路径要用新路径
    const arrow = path.indexOf(" -> ");
    if (arrow !== -1) path = path.slice(arrow + 4);
    // 含空格/非 ASCII 的路径会被加引号（core.quotepath）
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
    out.push({ status: xy, path });
  }
  return out;
}

/** 集合比较，导出供测试：返回只在一个集合里出现的元素 */
export function diffSets(expected, actual) {
  const e = new Set(expected);
  const a = new Set(actual);
  return {
    missing: [...e].filter((x) => !a.has(x)),
    extra: [...a].filter((x) => !e.has(x)),
  };
}

/**
 * 独立索引文件。所有 git 操作都带着它，共享 `.git/index` 全程不碰。
 *
 * 放在 `.git/` 下：不会出现在 `git status`，也不会被误提交；
 * 名字固定（不是随机）是为了崩溃后的残留能被下次运行清掉。
 */
const SAFE_INDEX = ".git/index.safe-commit";

function git(args, opts = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    env: { ...process.env, GIT_INDEX_FILE: SAFE_INDEX },
    ...opts,
  }).replace(/\s+$/, "");
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/**
 * 清理上次崩溃留下的独立索引（`.git/index.safe-commit`）。
 *
 * 现在不碰共享 `.git/index`，所以**不再需要处理 `.git/index.lock`**——
 * 那个锁只会在别人并发写共享索引时出现，与本脚本无关。
 * 但独立索引自己也会留残留（进程被杀时），下次运行先清掉，
 * 避免带着半截索引提交（那会产出「少文件」的提交，比失败更糟）。
 */
function clearOwnLeftovers(cwd) {
  const removed = [];
  for (const name of ["index.safe-commit", "index.safe-commit.lock"]) {
    const p = join(cwd, ".git", name);
    if (!existsSync(p)) continue;
    const ageMs = Date.now() - statSync(p).mtimeMs;
    if (ageMs < STALE_LOCK_MS) {
      fail(
        `另一次 safe-commit 正在运行（.git/${name} 存在 ${Math.round(ageMs / 1000)}s）。` +
          `\n  等它跑完；确认没有进程在用后，删除该文件重试。`,
      );
    }
    unlinkSync(p);
    removed.push(name);
  }
  return removed.length > 0 ? `已清理上次残留的独立索引（${removed.join(", ")}）` : null;
}

function main() {
  const argv = process.argv.slice(2);
  const separator = argv.indexOf("--");
  if (separator === -1) {
    fail("缺少 `--` 分隔符。用法：node scripts/safe-commit.mjs --msg-file <file> -- <path...>");
  }
  const flags = argv.slice(0, separator);
  const paths = argv.slice(separator + 1).filter(Boolean);
  if (paths.length === 0) fail("`--` 之后至少要给一个路径（这是防手滑的设计）");

  const dryRun = flags.includes("--dry-run");
  const msgIdx = flags.indexOf("--msg-file");
  const inlineIdx = flags.indexOf("--message");
  let message = null;
  if (msgIdx !== -1) {
    const file = flags[msgIdx + 1];
    if (!file || !existsSync(file)) fail(`找不到 commit message 文件：${file}`);
    message = readFileSync(file, "utf8");
  } else if (inlineIdx !== -1) {
    message = flags[inlineIdx + 1] ?? "";
  }
  if (!message || !message.trim()) fail("缺少提交信息（--msg-file <file> 或 --message <text>）");

  const cwd = process.cwd();
  const lockNote = clearOwnLeftovers(cwd);

  /**
   * 1) 从 HEAD 起一份**独立索引**，再只加我的路径。
   *
   * 这一步是隔离的关键：共享 `.git/index` 里可能有别人几千条暂存，
   * 而 `git commit` 无论带不带 pathspec 都要用索引构建完整 tree——
   * 别人的条目里有一个 blob 失效，我的提交就会以
   * `invalid object ... / Error building trees` 失败（本轮连撞两次，
   * 而 `--dry-run` 却是好的，因为 dry-run 不写 tree）。
   * 独立索引里只有「HEAD + 我的改动」，别人的东西完全不参与。
   */
  git(["read-tree", "HEAD"]);
  git(["add", "--", ...paths]);

  /** 2) 暂存集 = 独立索引相对 HEAD 的差异。这正是本次要提交的文件集。 */
  const changedPaths = git(["diff", "--cached", "--name-only"])
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((p) => resolve(cwd, p).replace(/\\/g, "/"));
  if (changedPaths.length === 0) {
    fail("这些路径相对 HEAD 没有任何变更，提交会是空提交。检查路径是否写错、或改动是否已保存。");
  }

  /** 3) 共享索引里别人的暂存内容：只提示，不碰（独立索引保证它们不会进这次提交）。 */
  const sharedEnv = { ...process.env };
  delete sharedEnv.GIT_INDEX_FILE;
  const stagedOthers = execFileSync("git", ["diff", "--cached", "--name-only"], {
    encoding: "utf8",
    env: sharedEnv,
  })
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((p) => resolve(cwd, p).replace(/\\/g, "/"));

  console.log(`\n本次提交 ${changedPaths.length} 个文件：`);
  for (const p of changedPaths) console.log(`  · ${p.replace(cwd + "/", "")}`);
  if (stagedOthers.length > 0) {
    console.log(`\n共享索引里有 ${stagedOthers.length} 个他人已暂存的文件，本次不涉及（用独立索引提交）：`);
    for (const p of stagedOthers.slice(0, 5)) console.log(`  · ${p.replace(cwd + "/", "")}`);
  }
  if (lockNote) console.log(`\n${lockNote}`);
  if (dryRun) {
    console.log("\n--dry-run：未提交。\n");
    return;
  }

  /** 4) 提交。不带 pathspec：独立索引里本来就只有「HEAD + 我的改动」。 */
  const before = git(["rev-parse", "HEAD"]);
  /**
   * message 走临时文件而不是 stdin。
   *
   * `execFileSync` 同时给 `input` 与 `stdio: inherit` 时，stdin 不是 pipe，
   * input 会被忽略——那会让 git 打开编辑器并卡住（非交互环境下表现为挂死）。
   * 写到 `.git/` 下还有个好处：不会出现在 `git status` 里。
   */
  const msgPath = join(cwd, ".git", "SAFE_COMMIT_MSG");
  writeFileSync(msgPath, message, "utf8");
  try {
    /**
     * `env` 必须带 GIT_INDEX_FILE，否则 commit 用的是**共享索引**——
     * 那正是要避开的那个（里面有几万条别人的暂存）。
     * 钩子在子进程里跑，也会继承这个变量，因此它 `git diff --cached`
     * 看到的恰好是我的改动集，选测不会被别人的暂存污染。
     */
    execFileSync("git", ["commit", "-F", msgPath], {
      stdio: "inherit",
      env: { ...process.env, GIT_INDEX_FILE: SAFE_INDEX },
    });
  } catch (err) {
    fail(`提交失败（钩子拦下或 git 报错）：${err?.message ?? err}`);
  } finally {
    for (const p of [msgPath, join(cwd, SAFE_INDEX)]) {
      try {
        unlinkSync(p);
      } catch {
        // 删不掉也不影响提交，下次运行会先清
      }
    }
  }

  /**
   * 5) 把**共享索引**里这些路径同步到新 HEAD。
   *
   * 不做这一步会留下一个很阴的坑：独立索引提交成功后，共享索引里这些路径仍指向
   * 提交前的 blob，于是 `git status` 显示它们是「已暂存的旧内容」。
   * 任何人（包括我）随后一次不带 paths 的 `git commit` 就会把旧内容提交回去，
   * **等于把我这次提交回退掉**——而且看起来像一次正常的提交。
   *
   * `git reset HEAD -- <paths>` 只动索引、保留工作区；对新增文件同样正确
   * （索引指向新 HEAD 的那一版，工作区本就一致）。
   *
   * ⚠️ 如果共享索引里这些路径正被别人暂存着，这一步会覆盖对方的暂存。
   * 但那种情况本来就不该由我提交（同一文件两个人的改动），
   * 脚本也无法分辨「对方的暂存」与「我提交前的旧 blob」，只能按「以 HEAD 为准」处理。
   */
  try {
    execFileSync("git", ["reset", "-q", "HEAD", "--", ...paths], { env: sharedEnv, encoding: "utf8" });
  } catch {
    // 同步失败不影响提交本身；只是共享索引会保留旧 blob，需要人工 `git reset`
    console.error("⚠ 共享索引同步失败：请手动执行 git reset HEAD -- <paths>，否则下次提交会回退本次改动");
  }

  // 6) 校验：HEAD 变了，且文件集恰好等于预期
  const after = git(["rev-parse", "HEAD"]);
  if (after === before) fail("HEAD 没有变化——提交没有真正发生。");

  const committed = git(["show", "--name-only", "--format=", "HEAD"])
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((p) => resolve(cwd, p).replace(/\\/g, "/"));
  /**
   * 与 `changedPaths` 比对，而不是与命令行参数比对：
   * 参数可能是目录（`docs`）或含无变更路径，直接比集合会误报。
   * `changedPaths` 是提交前 `git status` 给出的真实变更文件集——那才是「我该提交的东西」。
   */
  const { missing, extra } = diffSets(changedPaths, committed);

  const subject = git(["log", "-1", "--format=%h %s"]);
  console.log(`\n✓ ${subject}`);

  if (missing.length > 0) {
    console.error(`\n⚠ 这些路径有变更但**没进**本次提交：`);
    for (const p of missing) console.error(`  · ${p.replace(cwd + "/", "")}`);
  }
  if (extra.length > 0) {
    console.error(`\n⚠ 本次提交**多出**了未指定的文件（有人的改动被卷进来了）：`);
    for (const p of extra) console.error(`  · ${p.replace(cwd + "/", "")}`);
  }
  if (missing.length > 0 || extra.length > 0) {
    console.error("\n提交内容与预期不一致。用 `git show --stat HEAD` 核对，必要时 `git reset --soft HEAD~1` 重来。\n");
    process.exit(2);
  }
  console.log(`✓ 提交内容与预期完全一致（${committed.length} 个文件）\n`);
}

// 只在直接执行时跑 main，便于测试 import 上面的纯函数
const invokedDirectly = process.argv[1] && /safe-commit\.mjs$/.test(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
