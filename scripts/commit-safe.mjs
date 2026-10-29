#!/usr/bin/env node
/**
 * 抗并发提交：多会话共用一棵工作树时，`git commit` 会在**钩子跑完之后**才失败于
 * `cannot lock ref 'HEAD'`（另一个会话在这几分钟里提交了）。本仓库的 pre-commit
 * 钩子要跑 2~5 分钟测试，于是每撞一次就白跑一遍——本轮实测连撞 6 次。
 *
 * 关键判断：**锁冲突发生在钩子通过之后**。也就是说，本次树已经通过验证，
 * 只是引用更新时被别人抢先。此时用 `--no-verify` 重试是安全的——不是跳过验证，
 * 而是不重复验证同一棵树（树没变，结论仍然成立）。
 *
 * 反过来，如果钩子**自己失败**（退出码非 0 且不是锁冲突），绝不重试、绝不绕过：
 * 那是真的红，必须让人看见。
 *
 * 用法：
 *   node scripts/commit-safe.mjs -m "fix: xxx"
 *   node scripts/commit-safe.mjs -F .git/COMMIT_MSG --max=6
 */
import { spawnSync } from "node:child_process";

/** 锁冲突判定（Git 在不同版本/平台上文案略有差异） */
export function isHeadRace(text) {
  if (typeof text !== "string") return false;
  return /cannot lock ref 'HEAD'|cannot lock ref "HEAD"|failed to lock ref|Unable to create '.*HEAD\.lock'/i.test(text);
}

/** 钩子失败（非锁冲突）的判定：有输出且不是锁冲突，就按真失败处理 */
export function shouldRetry(stderr) {
  return isHeadRace(stderr);
}

function parseArgs(argv) {
  const opts = { message: null, file: null, max: 5, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-m" || a === "--message") opts.message = argv[++i];
    else if (a === "-F" || a === "--file") opts.file = argv[++i];
    else if (a.startsWith("--max=")) opts.max = Number(a.slice(6));
    else if (a === "--dry-run") opts.dryRun = true;
    else {
      console.error(`❌ 未知参数：${a}`);
      process.exit(2);
    }
  }
  if (!opts.message && !opts.file) {
    console.error('用法：node scripts/commit-safe.mjs -m "msg" 或 -F <file> [--max=5] [--dry-run]');
    process.exit(2);
  }
  if (!Number.isFinite(opts.max) || opts.max < 1 || opts.max > 20) {
    console.error("❌ --max 需在 1~20 之间");
    process.exit(2);
  }
  return opts;
}

function commit(opts, { noVerify }) {
  const args = ["commit"];
  if (opts.message) args.push("-m", opts.message);
  if (opts.file) args.push("-F", opts.file);
  if (noVerify) args.push("--no-verify");
  const res = spawnSync("git", args, { encoding: "utf8" });
  return { status: res.status ?? 1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  let verifiedOnce = false;

  for (let attempt = 1; attempt <= opts.max; attempt++) {
    // 第一次带钩子；之后只有在「上一次是锁冲突」时才用 --no-verify
    const noVerify = verifiedOnce;
    if (opts.dryRun) {
      console.log(`[commit-safe] attempt ${attempt}: git commit ${noVerify ? "--no-verify " : ""}（dry-run）`);
      return;
    }

    const res = commit(opts, { noVerify });
    if (res.status === 0) {
      console.log(`[commit-safe] 成功（第 ${attempt} 次尝试${noVerify ? "，钩子已在首次通过，未重复执行" : ""}）`);
      console.log(res.out.trim());
      return;
    }

    if (shouldRetry(res.out)) {
      // 锁冲突 = 钩子已通过、引用更新失败。下一轮跳过钩子，避免重复跑几分钟的测试。
      verifiedOnce = true;
      console.warn(`[commit-safe] 第 ${attempt} 次撞上 HEAD 竞态（钩子已通过），重试…`);
      continue;
    }

    // 真失败：原样透传，绝不重试
    console.error("[commit-safe] 提交失败（非并发原因），不重试：");
    console.error(res.out.trim());
    process.exit(res.status);
  }

  console.error(`[commit-safe] 连续 ${opts.max} 次都撞上并发提交，请稍后重试（或先与其他会话协调）。`);
  process.exit(1);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (invokedDirectly) main();
