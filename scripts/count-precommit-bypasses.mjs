#!/usr/bin/env node
/**
 * U-266 绕过声明累计重数（U-385）。
 *
 * 为什么需要它：雷达按轮次窗口抽查计数，窗口与合入节奏错位即漏计——
 * 105–108 轮四轮写“无变化，仍 52 例”，但 7779d8db..23195b0d 的 19 笔提交
 * 全部含显式跳过声明，无一计入；更深一层：52 这个基数本身也漏了 21 例
 * （94 轮订正的 4 例从未吸入 + 17 例从未被任何一轮点名）。计数无脚本、
 * 无累计账本，错四轮无人发现——本脚本就是那本账。
 *
 * 口径（分开计数，SKIP_PRECOMMIT 是否计入 U-266 待主聊裁决，不擅自扩口径）：
 *   两类显式绕过声明，分开计数、并集另计；一笔提交同时含两类 token 时
 *   两类各计 1、并集计 1（实测窗口内 both=0，但口径上必须写明）：
 *     - no-verify：提交信息全文含 `--no-verify`（实际用了 --no-verify 提交）
 *     - skip-precommit：提交信息全文含 NAVHUB_SKIP_PRECOMMIT（=1），或
 *       “跳过 precommit / 跳过 pre-commit / 跳过全量 / 跳过预提交”，或
 *       英文 "Skip precommit / Skip pre-commit"（2026-11-21 19:12 补：
 *       6ab36d99、f582c81a 只写英文 "Skip precommit:"，旧口径漏计；
 *       全窗口 grep 复核：此前各段无英文-only 的跳过声明，漏计仅此 2 笔。
 *       裸 "skip / SKIPPED" 仍不用——CI 状态 "报 SKIPPED" 不是跳过声明）
 *   刻意排除（雷达已裁决不计，脚本必须同样排除，否则口径漂移）：
 *     - a459f176 “Validation run separately …”（疑似，未用标准 token）
 *     - a44d8212 “定向测试与 typecheck 待重跑”（顺序问题，非跳过声明）
 *     - c5a83877（提交信息无显式跳过声明，仅自认 tsc 结论 INCONCLUSIVE）
 *
 * 锚点：06429843（U-266 立项时第一笔绕过声明，2026-11-20 11:38）。
 * 累计 = 锚点（含）至 --to 的匹配提交数。注意：这不是全历史计数——
 * U-266 立项前也有绕过声明，但雷达的 52/71/92 口径一律自锚点起算，
 * 立项前的历史不在本项累计内；若主聊裁决扩大窗口，改 --from 即可。
 *
 * 实测锚点（2026-11-21 人工逐笔全文核对，与本脚本输出一致）：
 *   --to 7779d8db → no-verify 19 / skip 54 / 并集 73（窗口 81 笔）
 *   --to 23195b0d → no-verify 19 / skip 73 / 并集 92（窗口 100 笔）
 *   --to 52e919e2 → no-verify 19 / skip 75 / 并集 94（窗口 103 笔）
 *   增量 7779d8db..23195b0d：19 笔全为 skip（0 no-verify），即审计
 *   U-385 逐笔核对的 19 笔；增量 23195b0d..52e919e2：3 笔中 2 笔为 skip
 *   （39ac383d、d28b4b84，均为“跳过全量预提交检查”），0 no-verify——
 *   雷达 109 轮“均非 --no-verify”只验了 --no-verify token，漏了这 2 笔 skip。
 *   --to 66aa7009 → no-verify 19 / skip 99 / 并集 118（窗口 129 笔）
 *   --to f38deebd → no-verify 19 / skip 106 / 并集 125（窗口 136 笔）
 *   增量 66aa7009..f38deebd：7 笔中 7 笔为 skip（0 no-verify），其中
 *   6ab36d99、f582c81a 为英文 "Skip precommit:"（旧口径漏计，见上）。
 *
 * 关于 71 例：审计 U-385 的订正数 71 = 52 + 19，是 52 混合基数上的算术
 * （52 本身含 no-verify 与 skip 两类），且只算到 23195b0d；它不是本脚本
 * 的输出——本脚本输出分开计数，由协调者/主聊按裁决定夺最终写法：
 *   - 若 skip 计入：23195b0d 处并集 92（审计的 71 漏了基底的 21 例）；
 *     52e919e2 处并集 94；66aa7009 处并集 118；f38deebd 处并集 125。
 *   - 若 skip 不计：no-verify 19（23195b0d 与 52e919e2 均同值，因两轮
 *     增量皆无 no-verify）；雷达 52 里 no-verify 实为 16，另 3 笔
 *     （d52a36e、1713331、4f0c67c8）亦漏计。
 *   无论哪种裁决，回溯扣减都须同步扣旧基数，不能只扣新增（见 U-385）。
 *
 * 用法：
 *   node scripts/count-precommit-bypasses.mjs [--from <sha>] [--since <sha>] [--to <rev>] [--json]
 *   --from  含锚点的起始提交（默认 06429843；范围写成 <from>^..<to>）
 *   --since 不含的起始提交（范围写成 <since>..<to>，用于算增量；与 --from 二选一）
 *   --to    结束版本（默认 HEAD）
 *   --json  输出 JSON（供测试与雷达复核机读）
 *
 * 退出码：0 = 计数完成；2 = 参数错误或 git 失败。
 */
import { execFileSync } from "node:child_process";

const ANCHOR = "064298430f38be530c52c6ed327fc6aa9a1f7a93";
// 与雷达人工核对同一口径：显式绕过声明的 token。刻意不用更宽的词
// （如裸 "pre-commit" / "绕过" / "skip"），否则 a459f176 的
// "Validation run separately (pre-commit hook too slow …)" 会被误计。
const NO_VERIFY_RE = /--no-verify/i;
// 英文 "Skip precommit" 须紧跟 pre-commit（裸 skip/SKIPPED 不算，见上）。
const SKIP_RE = /NAVHUB_SKIP_PRECOMMIT|跳过\s*(?:pre-?\s*commit|全量|预提交)|skip\s+pre-?\s*commit/i;

function fail(message) {
  console.error(`[count-precommit-bypasses] ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { from: ANCHOR, since: null, to: "HEAD", json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from") opts.from = argv[++i] ?? fail("--from 缺值");
    else if (arg === "--since") opts.since = argv[++i] ?? fail("--since 缺值");
    else if (arg === "--to") opts.to = argv[++i] ?? fail("--to 缺值");
    else if (arg === "--json") opts.json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("用法：node scripts/count-precommit-bypasses.mjs [--from <sha>] [--since <sha>] [--to <rev>] [--json]");
      process.exit(0);
    } else fail(`未知参数：${arg}`);
  }
  if (opts.from !== ANCHOR && opts.since) fail("--from 与 --since 二选一");
  if (opts.since) opts.from = null;
  return opts;
}

function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    fail("不在 git 仓库里");
  }
}

function listCommits(root, range) {
  let out;
  try {
    // %H + NUL + %B + NUL：提交信息里不会出现 NUL，比换行分隔可靠。
    out = execFileSync("git", ["log", "--format=%H%x00%B%x00", range], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    fail(`git log ${range} 失败：${error.message.split("\n")[0]}`);
  }
  const parts = out.split("\0").filter((p) => p !== "");
  const commits = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    commits.push({ sha: parts[i].trim(), message: parts[i + 1] });
  }
  return commits;
}

function firstMatchLine(message, re) {
  for (const line of message.split(/\r?\n/)) {
    if (re.test(line)) return line.trim().slice(0, 120);
  }
  return "";
}

/** 一笔提交的绕过类别：no-verify / skip-precommit / both / null（不计）。 */
function categoryOf(message) {
  const isNoVerify = NO_VERIFY_RE.test(message);
  const isSkip = SKIP_RE.test(message);
  if (isNoVerify && isSkip) return "both";
  if (isNoVerify) return "no-verify";
  if (isSkip) return "skip-precommit";
  return null;
}

function main(argv) {
  const opts = parseArgs(argv);
  const root = repoRoot();
  const range = opts.since ? `${opts.since}..${opts.to}` : `${opts.from}^..${opts.to}`;
  const commits = listCommits(root, range);
  const hits = [];
  for (const c of commits) {
    const category = categoryOf(c.message);
    if (!category) continue;
    const subject = c.message.split(/\r?\n/)[0].trim();
    const excerpt =
      firstMatchLine(c.message, NO_VERIFY_RE) || firstMatchLine(c.message, SKIP_RE);
    hits.push({ sha: c.sha, short: c.sha.slice(0, 8), subject, category, excerpt });
  }
  const noVerify = hits.filter((h) => h.category === "no-verify" || h.category === "both").length;
  const skipPrecommit = hits.filter((h) => h.category === "skip-precommit" || h.category === "both").length;
  const both = hits.filter((h) => h.category === "both").length;
  const result = {
    from: opts.since ? { since: opts.since } : { from: opts.from },
    to: opts.to,
    range,
    windowCommits: commits.length,
    noVerify,
    skipPrecommit,
    both,
    union: hits.length,
    total: hits.length,
    commits: hits,
  };
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`[count-precommit-bypasses] 范围 ${range}：窗口 ${commits.length} 笔提交`);
  console.log(`  --no-verify ${noVerify} 例 / SKIP_PRECOMMIT ${skipPrecommit} 例 / 并集 ${hits.length} 例（both ${both} 例）`);
  for (const h of hits) {
    console.log(`  [${h.category}] ${h.short} ${h.subject}`);
    console.log(`    ↳ ${h.excerpt}`);
  }
  console.log(`[count-precommit-bypasses] 累计（自锚点 06429843 起）：--no-verify ${noVerify} 例，SKIP_PRECOMMIT ${skipPrecommit} 例，并集 ${hits.length} 例`);
}

main(process.argv.slice(2));
