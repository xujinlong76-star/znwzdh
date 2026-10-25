#!/usr/bin/env node
/**
 * 清理探针残留目录（默认**只报告不删除**）。
 *
 * ## 为什么会有残留
 *
 * 本仓的调试习惯是用 `mkdtempSync(join(tmpdir(), "navhub-xxx-"))` 建一次性目录
 * （基准脚本、探针、集成测试都这么干）。正常路径下 `afterAll` / `finally` 会删掉，
 * 但这些情况会留下：
 *   · 测试被 kill（超时、Ctrl-C、本机的批量删除护栏）；
 *   · 探针脚本是 `cat > .probe.ts` 那种一次性的，作者删了脚本忘了目录；
 *   · 进程崩溃（OOM、Next dev 退出码 3221226505）。
 *
 * 一天下来能攒十几个，每个几十到几百 MB（SQLite 库 + 模型缓存）。
 *
 * ## 安全设计（这是它默认不删的原因）
 *
 * 删文件是不可逆的，而「哪些目录是我留下的」只能靠**前缀猜**。所以：
 *
 *   1. **默认 dry-run**：只打印清单、大小、年龄，一个字都不删；
 *   2. 要真删必须显式 `--apply`；
 *   3. 只处理白名单前缀（`navhub-` / `probe-`）——**不碰 `tmp.*`**，
 *      那是 `mktemp -d` 的产物，无法证明归属；
 *   4. 修改时间小于 `--min-age-min`（默认 30 分钟）的跳过：可能正被某个在跑的测试用着；
 *      而且**只要存在这种「新鲜」目录，`--apply` 就默认拒绝**——它是「有测试正在跑」的
 *      直接证据（2026-10-25 实测：本机有 4 个 vitest 进程时，确实同时存在 8 个
 *      30 分钟内的目录）。此时删老目录虽不致命，但会把正在跑的测试的兄弟目录带走。
 *      确认无误要加 `--force`；
 *   5. **目录里只要有一个符号链接就整个跳过**。本机有过 junction 递归删除把源码清空的
 *      事故（2026-10-19，344 文件），而 `fs.rmSync(recursive)` 对链接的处理在不同
 *      Node 版本上并不一致——宁可少清一个目录，不做赌博。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/clean-temp-probes.mjs                  # 只报告
 * node scripts/clean-temp-probes.mjs --apply          # 真删
 * node scripts/clean-temp-probes.mjs --root /tmp/x    # 换个根（自检用）
 * node scripts/clean-temp-probes.mjs --min-age-min 0  # 连刚建的也算（自检用）
 * node scripts/clean-temp-probes.mjs --json           # 机器可读摘要（verify.mjs 用）
 * ```
 */
import { lstatSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 只清这些前缀。加新前缀前先确认它足够独特，不会误伤别人的目录。 */
const PREFIXES = ["navhub-", "probe-"];
/** 默认跳过 30 分钟内改动过的目录：可能正在被跑着的测试使用 */
const DEFAULT_MIN_AGE_MIN = 30;

function parseArgs(argv) {
  const out = { apply: false, root: null, minAgeMin: DEFAULT_MIN_AGE_MIN };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const next = () => {
      i += 1;
      if (argv[i] === undefined) {
        console.error(`✗ 参数 ${k} 缺少值`);
        process.exit(1);
      }
      return argv[i];
    };
    if (k === "--apply") out.apply = true;
    else if (k === "--force") out.force = true;
    else if (k === "--json") out.json = true;
    else if (k === "--root") out.root = next();
    else if (k === "--min-age-min") out.minAgeMin = Number(next());
    else {
      console.error(`✗ 未知参数：${k}`);
      process.exit(1);
    }
  }
  return out;
}

/** 递归找符号链接（限深度，避免在巨大目录里磨）。返回第一个命中的相对路径。 */
function findSymlink(dir, depth = 0) {
  if (depth > 4) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    try {
      if (lstatSync(full).isSymbolicLink()) return full;
    } catch {
      continue;
    }
    if (e.isDirectory()) {
      const hit = findSymlink(full, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** 统计大小（限深度，够判断量级即可） */
function sizeOf(dir, depth = 0) {
  if (depth > 3) return 0;
  let total = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    try {
      const st = lstatSync(full);
      if (st.isSymbolicLink()) continue;
      total += st.isDirectory() ? sizeOf(full, depth + 1) : st.size;
    } catch {
      continue;
    }
  }
  return total;
}

const fmtSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`);
const fmtAge = (ms) => (ms >= 3600_000 ? `${(ms / 3600_000).toFixed(1)}h` : `${Math.round(ms / 60_000)}min`);

const args = parseArgs(process.argv.slice(2));
const root = args.root ?? tmpdir();
const minAgeMs = Math.max(0, args.minAgeMin) * 60_000;
const now = Date.now();

let entries;
try {
  entries = readdirSync(root, { withFileTypes: true });
} catch (err) {
  console.error(`✗ 无法读取 ${root}：${err?.message ?? err}`);
  process.exit(1);
}

const matched = [];
const skippedNew = [];
const skippedLink = [];
const others = [];

for (const e of entries) {
  const full = join(root, e.name);
  let st;
  try {
    st = lstatSync(full);
  } catch {
    continue;
  }
  // 顶层就是符号链接：不碰（删链接虽安全，但说明有人在用这个目录名做跳转）
  if (st.isSymbolicLink()) {
    if (PREFIXES.some((p) => e.name.startsWith(p))) skippedLink.push([full, "顶层是符号链接"]);
    continue;
  }
  if (!st.isDirectory()) continue;

  const prefix = PREFIXES.find((p) => e.name.startsWith(p));
  if (!prefix) {
    if (e.name.startsWith("tmp.")) others.push(e.name);
    continue;
  }

  const ageMs = now - st.mtimeMs;
  const link = findSymlink(full);
  const item = { path: full, name: e.name, ageMs, bytes: sizeOf(full) };

  if (link) skippedLink.push([full, `内含符号链接 ${link.replace(full, ".")}`]);
  else if (ageMs < minAgeMs) skippedNew.push(item);
  else matched.push(item);
}

const totalBytes = matched.reduce((a, m) => a + m.bytes, 0);

if (args.json) {
  console.log(
    JSON.stringify({
      root,
      matched: matched.length,
      bytes: totalBytes,
      skippedNew: skippedNew.length,
      skippedLink: skippedLink.length,
      unrecognizedTmp: others.length,
    }),
  );
  process.exit(0);
}

console.log(`\n扫描根：${root}`);
console.log(`可选清理 ${matched.length} 个：`);
for (const m of matched) console.log(`  · ${m.name}  ${fmtSize(m.bytes)}  ${fmtAge(m.ageMs)} 未动`);
if (skippedNew.length > 0) {
  console.log(`\n跳过 ${skippedNew.length} 个（${args.minAgeMin} 分钟内改动过，可能正在被测试使用）：`);
  for (const m of skippedNew) console.log(`  · ${m.name}  ${fmtSize(m.bytes)}  ${fmtAge(m.ageMs)}`);
}
if (skippedLink.length > 0) {
  console.log(`\n跳过 ${skippedLink.length} 个（含符号链接，不递归删除）：`);
  for (const [p, why] of skippedLink) console.log(`  · ${p}  —— ${why}`);
}
if (others.length > 0) {
  console.log(`\n未识别 ${others.length} 个 \`tmp.*\`（\`mktemp -d\` 的产物，无法证明归属，不予处理）`);
}

/**
 * 「有测试正在跑」的判定：存在 `--min-age-min` 内被改动过的目录。
 *
 * 不查进程列表（跨平台麻烦、wmic 在本机被拦、起子进程要一秒），
 * 而是用**我自己这个工具的产物**做证据：如果最近 30 分钟有新的 navhub- 或 probe-
 * 目录出现，几乎可以肯定有人在跑测试。这个信号比进程名更贴近「我要删的东西会不会被用」。
 */
if (args.apply && skippedNew.length > 0 && !args.force) {
  console.error(
    `\n✗ 检测到 ${skippedNew.length} 个 ${args.minAgeMin} 分钟内被改动过的目录 —— 很可能有测试正在运行。\n` +
      `  此时删除会把它们的兄弟目录一起带走。等测试跑完再执行；\n` +
      `  确认这些目录与任何在跑的任务无关时，加 --force。\n`,
  );
  process.exit(1);
}

if (!args.apply) {
  console.log(`\n[dry-run] 共可释放 ${fmtSize(totalBytes)}。确认无误后加 --apply 执行删除。\n`);
  process.exit(0);
}

let removed = 0;
let failed = 0;
for (const m of matched) {
  try {
    rmSync(m.path, { recursive: true, force: false });
    console.log(`  已删 ${m.name}`);
    removed += 1;
  } catch (err) {
    console.error(`  删除失败 ${m.name}：${err?.message ?? err}`);
    failed += 1;
  }
}
console.log(`\n[apply] 删除 ${removed} 个（${fmtSize(totalBytes)}），失败 ${failed} 个。\n`);
process.exit(failed > 0 ? 1 : 0);
