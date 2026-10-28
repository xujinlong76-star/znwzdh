#!/usr/bin/env node
/**
 * 首屏预算账：把 `check-bundle-budget.mjs --report` 的三类发现折成可追踪的账。
 *
 * 为什么要单独一个脚本：`--report` 是只读的，它的输出只存在于那次终端会话里。
 * CI 跑的是门禁模式（.github/workflows/ci.yml 的「前端门禁」作业），只回答
 * 「超没超」，不回答「哪几条路由该补专属预算、哪几条其实可以下调」。于是实测的
 * 15 条漏配 + 58 条可下调，除了本地 stdout 之外**没有任何地方留下记录**：
 * 下一轮想知道「比上周多了还是少了」只能重新人肉跑一遍再自己对。
 *
 * 这份账刻意**不做判定**：数字全部来自 check-bundle-budget 的 `--report --json`，
 * 本脚本只搬运 + 排版。判定的口径（headroom 1.05、比 default 松的不算漏配、
 * 只降不升的棘轮）留在那一个脚本里，避免出现第二套预算逻辑。
 *
 * 产物出处必须一起写进账里：本轮实测「产物比源码旧 + 首屏源码脏 77 个文件」，
 * 这种数拿去定基线是错的（见 check-bundle-budget 的 --raise 三条前置）。
 * 账如果只报条数不报出处，读的人会把一份过期产物上的数字当成事实。
 *
 * 用法：
 *   node scripts/bundle-budget-summary.mjs                      # 现跑现取，写 $GITHUB_STEP_SUMMARY
 *   node scripts/bundle-budget-summary.mjs --from <report.json> # 复用已有 JSON（本地/回归）
 *   node scripts/bundle-budget-summary.mjs --out-json <path>    # 顺手落一份机读 JSON（artifact 源）
 *   node scripts/bundle-budget-summary.mjs --summary-file <path> --top 5
 *
 * 退出码：0 = 账已写出；1 = 拿不到报告（预算脚本失败 / JSON 读不到内容或解析不了）；
 * 2 = 用法错（未知参数、--top 不是正整数、--from 指不到文件）。
 * 「拿不到报告」绝不折成一份空账：空账看起来像「本轮 0 条发现」，那是假绿灯。
 *
 * 参数解析只在 `main()` 里做：这个文件同时被 scripts/bundle-budget-summary.test.ts
 * 以 import 方式取 renderLedger，若在模块顶层读 process.argv，跑测试时 vitest 自己的
 * `--reporter=dot` 会被当成未知参数，测试进程直接 exit(2)。
 */
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const P = "[bundle-ledger] ";
const KNOWN_FLAGS = ["--from", "--out-json", "--summary-file", "--top"];
const DEFAULT_TOP = 12;

/** 三类发现的固定顺序与处置口径——表头、正文、退出日志都从这一处生成，避免两处漂移 */
const CLASSES = [
  { key: "raise", label: "上调候选（实测超预算）", action: "必须显式 `--raise`，且三条前置都过" },
  { key: "addMissing", label: "漏配专属预算（正落 default）", action: "补一条比 default 更紧的阈值" },
  { key: "tighten", label: "可下调（低于预算 5% 以上）", action: "人工棘轮决定，脚本不自动降" },
];

const kb = (n) => (n / 1024).toFixed(0) + " KB";
const iso = (ms) =>
  typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16) + "Z" : "不可定位";
const rowsOf = (diff, key) => (Array.isArray(diff?.[key]) ? [...diff[key]] : []);

/**
 * 纯函数：报告 JSON -> Markdown 账。
 * 拆出来是为了让下面这几条规矩可测：
 *   - 0 条的类目也要写「无」——省略会让人分不清「本轮没有」和「账没跑成」；
 *   - 出处不干净（过期产物 / 首屏源码脏）必须显式标「不可用于定基线」；
 *   - 截断时留下的要是最贵的几条，且说清剩下的去哪看。
 * 不原地排序传入的数组：同一份报告还会被写成机读 artifact，顺序要保持原样。
 */
export function renderLedger(report, opts = {}) {
  const top = Number.isInteger(opts.top) && opts.top > 0 ? opts.top : DEFAULT_TOP;
  const prov = report?.provenance ?? {};
  const diff = report?.report ?? {};
  const lines = [];
  lines.push("## 首屏预算账（只读，不改 bundle-budget.json）");
  lines.push("");
  lines.push(`- 产物：提交 \`${prov.sha ?? "不可定位"}\` · 打包器 ${report?.bundler ?? "未知"} · 构建于 ${iso(prov.builtAt)}`);
  lines.push(
    `- 覆盖面：${(Array.isArray(report?.routes) ? report.routes.length : 0)} 条路由 · 门禁违规 ${(Array.isArray(report?.violations) ? report.violations.length : 0)} 条 · 建议阈值口径 = 实测 ×${report?.headroom ?? "?"} 向上取整到 KiB`,
  );
  const why = [];
  if (prov.stale) why.push(`产物比源码旧（最新源文件 ${iso(prov.newestSourceAt)}）`);
  if (typeof prov.bundleDirty === "number" && prov.bundleDirty > 0) {
    why.push(`首屏源码有 ${prov.bundleDirty} 个未提交改动`);
  }
  if (why.length > 0) {
    lines.push(`- ⚠️ **这份数不可用于定基线**：${why.join("；")}。先重跑 build（并提交挡路改动）再读下面的条数。`);
  }
  lines.push("");
  lines.push("| 类别 | 条数 | 处置 |");
  lines.push("| --- | --- | --- |");
  for (const c of CLASSES) lines.push(`| ${c.label} | ${rowsOf(diff, c.key).length} | ${c.action} |`);
  for (const c of CLASSES) {
    const rows = rowsOf(diff, c.key).sort((a, b) => b.bytes - a.bytes);
    lines.push("");
    lines.push(`### ${c.label}（${rows.length} 条）`);
    if (rows.length === 0) {
      lines.push("");
      lines.push("无");
      continue;
    }
    lines.push("");
    lines.push("| 路由 | 实测 | 现预算 | 建议 |");
    lines.push("| --- | --- | --- | --- |");
    for (const r of rows.slice(0, top)) lines.push(`| \`${r.route}\` | ${kb(r.bytes)} | ${kb(r.limit)} | ${kb(r.proposed)} |`);
    if (rows.length > top) lines.push(`\n另有 ${rows.length - top} 条未列出，见 artifact \`bundle-budget-report.json\`。`);
  }
  return lines.join("\n") + "\n";
}

/** `--from=x` 与 `--from x` 都认；缺值返回空串，由调用方判定 */
function flagValue(argv, name) {
  const eq = argv.find((a) => a.startsWith(name + "="));
  if (eq !== undefined) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  const next = i >= 0 ? argv[i + 1] : undefined;
  return next !== undefined && !next.startsWith("--") ? next : "";
}

/** 用法问题一律 rc 2：拼错的旗标不能静默当成默认值跑 */
function parseArgs(argv) {
  for (const a of argv) {
    if (a.startsWith("--") && !KNOWN_FLAGS.some((f) => a === f || a.startsWith(f + "="))) {
      console.error(`${P}不认识的参数：${a}（可用：${KNOWN_FLAGS.join(" / ")}）`);
      process.exit(2);
    }
  }
  const topRaw = flagValue(argv, "--top");
  const top = topRaw === "" ? DEFAULT_TOP : Number(topRaw);
  if (!Number.isInteger(top) || top <= 0) {
    console.error(`${P}--top 要是一个正整数，收到的是「${topRaw}」`);
    process.exit(2);
  }
  const from = flagValue(argv, "--from");
  if (from !== "" && (!existsSync(from) || statSync(from).isDirectory())) {
    console.error(`${P}--from 指向的文件读不到：${from}`);
    process.exit(2);
  }
  return { from, outJson: flagValue(argv, "--out-json"), summaryFile: flagValue(argv, "--summary-file"), top };
}

function loadReport(args) {
  if (args.from !== "") {
    const raw = readFileSync(args.from, "utf8");
    try {
      return JSON.parse(raw);
    } catch (error) {
      // 截断 / 非 JSON 的 artifact 不能折成一份「看起来没有发现」的账
      console.error(`${P}--from 的 JSON 解析不了：${args.from} —— ${error.message}`);
      process.exit(1);
    }
  }
  const res = spawnSync(process.execPath, ["scripts/check-bundle-budget.mjs", "--report", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    console.error(`${P}拿不到报告：check-bundle-budget --report --json 退出码 ${res.status}`);
    const tail = String(res.stderr ?? "").trim().split(/\r?\n/).slice(-3).join(" / ");
    if (tail !== "") console.error(P + tail);
    process.exit(1);
  }
  try {
    return JSON.parse(res.stdout);
  } catch (error) {
    console.error(`${P}报告不是合法 JSON（${error.message}）—— 不做「解析失败 = 0 条发现」的降级`);
    process.exit(1);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = loadReport(args);
  const markdown = renderLedger(report, { top: args.top });

  if (args.outJson !== "") {
    writeFileSync(args.outJson, JSON.stringify(report, null, 2) + "\n");
    console.log(`${P}机读账已写入 ${args.outJson}`);
  }
  const summaryPath = args.summaryFile !== "" ? args.summaryFile : process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath !== undefined && summaryPath !== "") {
    appendFileSync(summaryPath, markdown);
    console.log(`${P}已追加到 Step Summary：${summaryPath}`);
  } else {
    console.log(markdown);
  }

  const diff = report.report ?? {};
  const counts = CLASSES.map((c) => `${c.key}=${rowsOf(diff, c.key).length}`).join(" ");
  const staleNote = report.provenance?.stale ? " · 产物过期，不可用于定基线" : "";
  console.log(`${P}账已写出（${counts}${staleNote}）`);
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
