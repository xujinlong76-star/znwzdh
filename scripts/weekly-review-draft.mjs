#!/usr/bin/env node
/**
 * 每周复盘自动化——半自动复核草稿生成器（PoC）。
 *
 * 方案来源：strategy-2026-11-22.md「过门禁方案：每周复盘自动化」（第 6 路）。
 * 每周日 20:00 复盘轮开始时生成一份《本周复盘草稿》（Markdown），只出草稿：
 * 不改路线图、不写 MEMORY.md、不提交、不推送、不碰生产；协调员人工核实后才采用。
 *
 * 输入（只读三类）：
 *   1. `git log <ref> --since/--until`：提交聚类（图标 / 考试节点 / 修复 /
 *      战略实现 / 功能 / 测试 / 文档 / 工程 / 其他），输出本周合入清单与计数。
 *   2. 数据文件前后对照（`git show <rev>:<path>`）：
 *      apps/web-overlay/src/navsphere/content/navigation.json（站数）、
 *      packages/core/src/pricing-overrides.json（键数）、
 *      apps/web-overlay/src/lib/exam-calendar.ts（节点数）。
 *   3. 状态表 hidden_files/strategy-state.json（人工维护、脚本只读）：
 *      过门禁 / 待 PoC / 未通过三类方案清单及其前置条件。
 *
 * 输出（一份 Markdown 草稿，五节，与周日议程一一对应）：
 *   ① 本周合入清单 ② 方案复核表 ③ 过期项检测 ④ 30/90/180 天路线图 diff 草稿
 *   ⑤ 待人工拍板的裁决清单。草稿头强制标注“草稿，未经人工核实，不得引用”。
 *
 * 只读保证（R5 护栏）：
 *   - 只用 git 的本地只读子命令：log / show / rev-list / merge-base / rev-parse
 *     （rev-parse 仅 --verify --quiet 查引用是否存在）。
 *     绝不跑 fetch / pull / push / commit / checkout / merge / rebase，
 *     绝不写仓库文件（唯一的写操作是 --out 指定的那一份草稿 md）。
 *   - 零网络请求：不读 CI（不接 `gh api`），不调任何外部服务。
 *   - 每条断言带来源（commit hash / 文件路径 / 报告名）；无来源的数字一律标
 *     “未核实”，不推测补数；过期判定只用确定性日期比较，不做语义推断。
 *
 * 日期口径（实测教训，2026-11-24）：
 *   git 把不带时刻的日期（如 "2026-11-16"）按“当天当前时刻”解析，同一命令在
 *   不同时刻跑会得出不同提交数（实测 906→896 漂移）。因此本脚本要求窗口日期
 *   必须带显式时刻与显式时区偏移（北京时间 +0800），如
 *   --since "2026-11-16 00:00:00 +0800" --until "2026-11-22 23:59:59 +0800"。
 *   相对窗口（默认 --since "7 days"）不受此影响。as-of 一律按北京时间自然日。
 *
 * 用法：
 *   node scripts/weekly-review-draft.mjs [--since <git 日期>] [--until <git 日期>]
 *       [--as-of YYYY-MM-DD] [--ref <rev, 默认 origin/main>]
 *       [--reports-dir <dir, 默认 <repo>/hidden_files>]
 *       [--state <path>] [--out <path>] [--no-write]
 *       [--fixture-log <path>] [--base-rev <rev>] [--head-rev <rev>]
 *   默认 --out 为 <reports-dir>/weekly-review-draft-<as-of>.md；
 *   --no-write 只打印到 stdout，不写文件。退出码 0=成功，2=用法/输入错误。
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const NAVIGATION_JSON = "apps/web-overlay/src/navsphere/content/navigation.json";
export const PRICING_JSON = "packages/core/src/pricing-overrides.json";
export const EXAM_CALENDAR_TS = "apps/web-overlay/src/lib/exam-calendar.ts";
export const BATCH0_REF = "origin/batch0/fix-integrated";
export const DEFAULT_REF = "origin/main";
export const STATE_STALE_DAYS = 14;
export const POC_OBSERVATION_DAYS = 14;

/** 聚类顺序即判定优先级：图标/考试节点先于 fix/feat 等类型前缀。 */
export const CLUSTER_ORDER = [
  "图标",
  "考试节点",
  "修复",
  "战略实现",
  "功能",
  "测试",
  "文档",
  "工程",
  "其他",
];

/** 30/90/180 天路线图候选文件（仓库内若无，§4 只出建议清单并注明未核实）。 */
export const ROADMAP_CANDIDATES = [
  "docs/roadmap.md",
  "ROADMAP.md",
  "docs/30-90-180-roadmap.md",
  "docs/roadmap-30-90-180.md",
];

const ALLOWED_GIT_SUBCOMMANDS = new Set(["log", "show", "rev-list", "merge-base", "rev-parse"]);

/**
 * 只读 git 执行器：只放行 log / show / rev-list / merge-base / rev-parse
 * 五个本地只读子命令，其余一律拒绝（防误用 fetch/push/commit）。
 */
export function runGit(args, cwd = REPO_ROOT) {
  if (!ALLOWED_GIT_SUBCOMMANDS.has(args[0])) {
    throw new Error(`拒绝执行非只读 git 子命令：git ${args[0]}（只允许 log/show/rev-list/merge-base/rev-parse）`);
  }
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** 北京时间今天（YYYY-MM-DD）。 */
export function todayShanghai(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** YYYY-MM-DD 词典序比较即日期比较；返回 (a - b) 的天数（可负）。 */
export function daysBetween(a, b) {
  const ms = Date.parse(`${b}T00:00:00+08:00`) - Date.parse(`${a}T00:00:00+08:00`);
  return Math.round(ms / 86400000);
}

// ---------------------------------------------------------------------------
// 聚类
// ---------------------------------------------------------------------------

/**
 * 单条提交的聚类判定（规则与回归夹具的人工分类同一份口径，见
 * scripts/fixtures/weekly-review-2026-11-16-22.expected.md）：
 *   1. 主题含 图标/icon/favicon，或改动触及 brand-icons/ → 图标
 *   2. 主题含 考试/国考/准考证/成考/四六级/省考/guokao/cet/exam，
 *      或改动触及 exam-calendar.ts → 考试节点
 *   3. 主题以 fix: / fix( → 修复
 *   4. 主题含 strategy/战略/复盘/weekly-review，或改动触及
 *      weekly-review-draft → 战略实现
 *   5. 否则按 conventional-commit 类型前缀：feat→功能，test→测试，
 *      docs→文档，chore/refactor/ci/build/style/perf/revert→工程，其余→其他
 */
export function classifyCommit(subject, files) {
  if (/图标|icon|favicon/i.test(subject) || files.some((f) => f.includes("brand-icons"))) return "图标";
  if (
    /考试|国考|准考证|成考|四六级|省考|guokao|cet|exam/i.test(subject) ||
    files.some((f) => f.includes("exam-calendar"))
  )
    return "考试节点";
  if (/^fix(\(|:)/.test(subject)) return "修复";
  if (/strategy|战略|复盘|weekly-review/i.test(subject) || files.some((f) => f.includes("weekly-review-draft")))
    return "战略实现";
  if (/^feat(\(|:)/.test(subject)) return "功能";
  if (/^test(\(|:)/.test(subject)) return "测试";
  if (/^docs(\(|:)/.test(subject)) return "文档";
  if (/^(chore|refactor|ci|build|style|perf|revert)(\(|:)/.test(subject)) return "工程";
  return "其他";
}

/**
 * 解析 `git log --format="COMMIT %H %cd %s" --date=short --name-only` 的输出。
 * 每块：首行 "COMMIT <40 位 hash> <YYYY-MM-DD> <主题>"，其余行是改动文件路径。
 * 主题为空的提交（极少）仍计入“其他”，不丢数。
 */
export function parseLog(text) {
  const commits = [];
  for (const block of text.split(/^COMMIT /m).slice(1)) {
    const lines = block.split("\n");
    const m = lines[0].match(/^([0-9a-f]{40}) (\d{4}-\d{2}-\d{2}) ?(.*)$/);
    if (!m) continue;
    commits.push({
      hash: m[1],
      date: m[2],
      subject: m[3] ?? "",
      files: lines.slice(1).map((l) => l.trim()).filter(Boolean),
    });
  }
  return commits;
}

export function clusterCommits(commits) {
  const clusters = new Map(CLUSTER_ORDER.map((name) => [name, { name, count: 0, reps: [] }]));
  for (const c of commits) {
    const name = classifyCommit(c.subject, c.files);
    const cluster = clusters.get(name);
    cluster.count += 1;
    if (cluster.reps.length < 3) cluster.reps.push(c);
  }
  return { total: commits.length, clusters: CLUSTER_ORDER.map((n) => clusters.get(n)) };
}

// ---------------------------------------------------------------------------
// 数据文件计数（前后对照）
// ---------------------------------------------------------------------------

/** navigation.json 站数：递归统计所有名为 items 的数组的元素个数。 */
export function countNavigationSites(jsonText) {
  const data = JSON.parse(jsonText);
  let n = 0;
  const walk = (o) => {
    if (Array.isArray(o)) {
      for (const x of o) walk(x);
    } else if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        if (k === "items" && Array.isArray(v)) n += v.length;
        walk(v);
      }
    }
  };
  walk(data);
  return n;
}

/** pricing-overrides.json 键数。 */
export function countPricingKeys(jsonText) {
  return Object.keys(JSON.parse(jsonText)).length;
}

/**
 * exam-calendar.ts 节点解析：节点是 EXAMS 数组里的扁平对象字面量
 * `{ label: '…', …, endISO: 'YYYY-MM-DD', …, estimated?: true }`。
 * 同时取最近一个 shortName/id 作考试归属（节点本身无考试字段）。
 * estimated 节点按文件注释不自动翻为“已结束”，过期规则须排除。
 */
const NODE_RE = /\{\s*label:\s*'([^']+)'[^}]*?endISO:\s*'([^']+)'[^}]*\}/gs;

export function parseExamNodes(tsSource) {
  const nodes = [];
  for (const m of tsSource.matchAll(NODE_RE)) {
    const before = tsSource.slice(0, m.index);
    const shortName = [...before.matchAll(/shortName:\s*'([^']+)'/g)].pop()?.[1] ?? "未核实";
    const examId = [...before.matchAll(/^\s*id:\s*'([^']+)'/gm)].pop()?.[1] ?? "未核实";
    nodes.push({
      label: m[1],
      endISO: m[2],
      estimated: /estimated:\s*true/.test(m[0]),
      examShortName: shortName,
      examId,
      source: EXAM_CALENDAR_TS,
    });
  }
  return nodes;
}

export function countExamNodes(tsSource) {
  return parseExamNodes(tsSource).length;
}

// ---------------------------------------------------------------------------
// 过期检测（三条确定性规则，只做日期比较，不做语义推断）
// ---------------------------------------------------------------------------

/**
 * 规则①：考试节点 endISO < asOf 且非 estimated。
 * 注意：exam-calendar.ts 无显式状态字段，“仍待办”按“仍列在 EXAMS 中且未
 * 标记 estimated/已结束”近似；检出项是“疑似过期，待人工确认”，不是定论。
 */
export function detectExpiredRule1(nodes, asOf) {
  return nodes
    .filter((n) => n.endISO < asOf && !n.estimated)
    .map((n) => ({
      rule: "①",
      kind: "考试节点过期",
      text: `${n.examShortName}（${n.examId}）/${n.label}（end=${n.endISO} 已过 ${asOf}）`,
      source: `${EXAM_CALENDAR_TS}（endISO=${n.endISO}，estimated=false）`,
    }));
}

/**
 * 规则②：待 PoC 项提出已超 14 天、状态仍为“未启动”（无裁决记录）。
 * 状态表是人工维护的事实源；脚本只做日期减法。
 */
export function detectStalePoc(items, asOf) {
  return items
    .filter((it) => it.category === "待PoC" && it.status === "未启动" && daysBetween(it.proposedDate, asOf) > POC_OBSERVATION_DAYS)
    .map((it) => ({
      rule: "②",
      kind: "待 PoC 观察期满",
      text: `${it.name}（提出 ${it.proposedDate}，已 ${daysBetween(it.proposedDate, asOf)} 天无裁决记录）`,
      source: `hidden_files/strategy-state.json（${it.id}，来源报告 ${it.source}）`,
    }));
}

/**
 * 规则③：前置条件状态变化。脚本不自动判定前置是否满足，只对比“上次记录
 * 状态 vs 本次 git 可见变化”，变化才列出，由人工确认。
 *   - kind=batch0：本地 `git merge-base --is-ancestor <batch0> <ref>` 实测；
 *     引用缺失时记“未核实”，不报错、不猜测。
 *   - kind=u01/user：无 git 可见信号，只列“需人工确认”，不作变化判定。
 */
export function checkPreconditions(items, { isBatch0Ancestor, batch0RefExists }) {
  const out = [];
  for (const it of items) {
    const pre = it.precondition;
    if (!pre) continue;
    if (pre.kind === "batch0") {
      const current = !batch0RefExists ? "未核实（本地无该分支引用）" : isBatch0Ancestor ? "已合入" : "未合入";
      const changed = batch0RefExists && (isBatch0Ancestor ? "已合入" : "未合入") !== pre.recordedState;
      out.push({
        item: it,
        current,
        changed,
        text: `${it.name}：前置 ${pre.label}——上次记录“${pre.recordedState}”，本次 git 可见“${current}”${changed ? "（状态变化，待人工确认）" : "（无变化）"}`,
        source: `hidden_files/strategy-state.json（${it.id}）+ git merge-base --is-ancestor ${BATCH0_REF} <ref>`,
      });
    } else {
      out.push({
        item: it,
        current: "无 git 可见信号",
        changed: false,
        text: `${it.name}：前置 ${pre.label}——上次记录“${pre.recordedState}”，本次无 git 可见信号，需人工确认`,
        source: `hidden_files/strategy-state.json（${it.id}，来源报告 ${it.source}）`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 草稿渲染
// ---------------------------------------------------------------------------

function sectionList(items, emptyText) {
  if (items.length === 0) return `- ${emptyText}\n`;
  return items.map((t) => `- ${t}\n`).join("");
}

export function renderDraft(d) {
  const lines = [];
  lines.push("# 本周复盘草稿");
  lines.push("");
  lines.push("> 草稿，未经人工核实，不得引用。");
  lines.push(">");
  lines.push(`> 生成时间：${d.generatedAt}（北京时间 ${d.asOf}）；窗口：${d.since} ～ ${d.until}；基线 ref：${d.ref}。`);
  lines.push(`> 本周合入提交数：${d.total}（来源：git log ${d.ref}，按提交者日期过滤）；基线对照：${d.baseRevShort}（窗口前最后一笔）→ ${d.headRevShort}（窗口内最新一笔）。`);
  if (d.stateStale) {
    lines.push(`> ⚠ 状态表已过期：hidden_files/strategy-state.json 最后更新于 ${d.stateLastUpdated}，距今 ${d.stateAgeDays} 天（> ${STATE_STALE_DAYS} 天），第 2 节“方案复核表”不可信，先更新状态表再用。`);
  } else {
    lines.push(`> 状态表：hidden_files/strategy-state.json 最后更新于 ${d.stateLastUpdated}（${d.stateAgeDays} 天前），未过期。`);
  }
  lines.push("");
  lines.push("## ① 本周合入清单（聚类 + 计数 + 代表 commit）");
  lines.push("");
  for (const c of d.clusters) {
    if (c.count === 0) {
      lines.push(`- ${c.name}：0 笔（来源：git log ${d.ref}）`);
      continue;
    }
    lines.push(`- ${c.name}：${c.count} 笔（${((c.count / d.total) * 100).toFixed(1)}%）（来源：git log ${d.ref}）`);
    for (const r of c.reps) {
      lines.push(`  - \`${r.hash.slice(0, 8)}\` ${r.date} ${r.subject}（来源：git log ${d.ref}）`);
    }
  }
  lines.push(`- 合计：${d.total} 笔；聚类覆盖 ${d.covered} / ${d.total} 笔（${((d.covered / d.total) * 100).toFixed(1)}%，未聚类计入“其他”，不丢数）（来源：git log ${d.ref}）。`);
  lines.push("");
  lines.push("## ② 方案复核表（过门禁 / 待 PoC / 未通过）");
  lines.push("");
  if (!d.stateLoaded) {
    lines.push("- 未核实：未找到状态表 hidden_files/strategy-state.json，本节无数据。");
  } else {
    for (const category of ["过门禁", "待PoC", "未通过"]) {
      const items = d.stateItems.filter((it) => it.category === category);
      lines.push(`### ${category}（${items.length} 项）`);
      lines.push("");
      for (const it of items) {
        const pre = it.precondition ? `；前置：${it.precondition.label}（上次记录：${it.precondition.recordedState}）` : "";
        lines.push(`- ${it.name}——状态：${it.status}${pre}（来源报告：${it.source}）`);
      }
      lines.push("");
    }
  }
  lines.push("## ③ 过期项检测（确定性规则，只做日期比较）");
  lines.push("");
  lines.push(`- 数据文件前后对照（来源：git show <rev>:<path>，前后 rev 见草稿头）：`);
  lines.push(`  - 站数（${NAVIGATION_JSON}）：${d.countsBefore.sites ?? "未核实"} → ${d.countsAfter.sites ?? "未核实"}（${d.countsAfter.sites != null && d.countsBefore.sites != null ? `变化 ${d.countsAfter.sites - d.countsBefore.sites >= 0 ? "+" : ""}${d.countsAfter.sites - d.countsBefore.sites}` : "未核实"}）`);
  lines.push(`  - 定价键数（${PRICING_JSON}）：${d.countsBefore.pricing ?? "未核实"} → ${d.countsAfter.pricing ?? "未核实"}（${d.countsAfter.pricing != null && d.countsBefore.pricing != null ? `变化 ${d.countsAfter.pricing - d.countsBefore.pricing >= 0 ? "+" : ""}${d.countsAfter.pricing - d.countsBefore.pricing}` : "未核实"}）`);
  lines.push(`  - 考试节点数（${EXAM_CALENDAR_TS}）：${d.countsBefore.examNodes ?? "未核实"} → ${d.countsAfter.examNodes ?? "未核实"}（${d.countsAfter.examNodes != null && d.countsBefore.examNodes != null ? `变化 ${d.countsAfter.examNodes - d.countsBefore.examNodes >= 0 ? "+" : ""}${d.countsAfter.examNodes - d.countsBefore.examNodes}` : "未核实"}）`);
  lines.push(`- 规则① 考试节点 deadline 已过仍待办（endISO < 今天且非 estimated；文件无显式状态字段，“仍待办”按“仍列在 EXAMS 中”近似，须人工逐项确认）（来源：${EXAM_CALENDAR_TS}）：`);
  lines.push(sectionList(d.expired1.map((e) => `${e.text}（来源：${e.source}）`), "无检出。"));
  lines.push("- 规则② 待 PoC 项 14 天观察期已满且无裁决记录（来源：hidden_files/strategy-state.json）：");
  lines.push(sectionList(d.expired2.map((e) => `${e.text}（来源：${e.source}）`), "无检出。"));
  lines.push("- 规则③ 前置条件状态变化（只列“上次记录 vs 本次 git 可见”，不自动判定是否满足）（来源：hidden_files/strategy-state.json + git merge-base）：");
  lines.push(sectionList(d.preconditions.map((p) => `${p.text}（来源：${p.source}）`), "状态表中无带前置条件的方案。"));
  lines.push("");
  lines.push("## ④ 30/90/180 天路线图 diff 草稿（只列建议，不直接改路线图文件）");
  lines.push("");
  if (!d.roadmapFile) {
    lines.push("- 未核实：仓库内未找到 30/90/180 天路线图文件（已查：docs/roadmap.md、ROADMAP.md、docs/30-90-180-roadmap.md、docs/roadmap-30-90-180.md），下列为建议清单，需人工落盘到路线图文件。");
  } else {
    lines.push(`- 路线图文件：${d.roadmapFile}（下列为建议清单，不直接改该文件）。`);
  }
  lines.push(sectionList(d.roadmapSuggestions, "无建议增/删/改：本周无过期检出、无前置变化。"));
  lines.push("");
  lines.push("## ⑤ 待人工拍板的裁决清单（每项附证据）");
  lines.push("");
  const decisions = [];
  for (const e of d.expired1) decisions.push(`确认 ${e.text} 是否从展示口径下线或改期——证据：${e.source}`);
  for (const e of d.expired2) decisions.push(`裁决 ${e.text}：保留 / 关闭 / 改期——证据：${e.source}`);
  for (const p of d.preconditions.filter((x) => x.changed)) decisions.push(`确认前置变化并更新路线图：${p.text}——证据：${p.source}`);
  if (d.stateStale) decisions.push(`先更新状态表 hidden_files/strategy-state.json（已 ${d.stateAgeDays} 天未更新），再定第 2 节与第 4 节——证据：状态表 lastUpdated=${d.stateLastUpdated}`);
  lines.push(sectionList(decisions, "本周无待裁决项。"));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("本草稿由 `scripts/weekly-review-draft.mjs` 生成（只读脚本，零网络请求）。采用前须由协调员逐条人工核实；任何数字不得直接引用。");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 编排
// ---------------------------------------------------------------------------

function readCountAtRev(rev, relPath, counter) {
  try {
    const text = runGit(["show", `${rev}:${relPath}`]);
    return counter(text);
  } catch {
    return null;
  }
}

export function buildDraft(opts) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const ref = opts.ref ?? DEFAULT_REF;
  const asOf = opts.asOf ?? todayShanghai();
  const since = opts.since ?? "7 days";
  const until = opts.until ?? null;
  const reportsDir = opts.reportsDir ?? join(repoRoot, "hidden_files");
  const statePath = opts.statePath ?? join(reportsDir, "strategy-state.json");

  // 1. git log（或夹具文件）
  let logText;
  if (opts.fixtureLog) {
    logText = readFileSync(opts.fixtureLog, "utf8");
  } else {
    const args = ["log", ref, "--since", since, "--format=COMMIT %H %cd %s", "--date=short", "--name-only"];
    if (until) args.push("--until", until);
    logText = runGit(args, repoRoot);
  }
  const commits = parseLog(logText);
  const { total, clusters } = clusterCommits(commits);
  const covered = clusters.reduce((n, c) => n + c.count, 0);

  // 2. 前后对照的基线 rev
  let baseRev = opts.baseRev ?? null;
  let headRev = opts.headRev ?? null;
  if (!baseRev && !opts.fixtureLog) {
    try {
      baseRev = runGit(["rev-list", "-1", "--before", since, ref], repoRoot).trim() || null;
    } catch {
      baseRev = null;
    }
  }
  if (!headRev && commits.length > 0) headRev = commits[0].hash;
  const baseRevShort = baseRev ? baseRev.slice(0, 8) : "未核实";
  const headRevShort = headRev ? headRev.slice(0, 8) : "未核实";

  // 3. 数据文件计数（前后）
  const countsBefore = { sites: null, pricing: null, examNodes: null };
  const countsAfter = { sites: null, pricing: null, examNodes: null };
  if (baseRev) {
    countsBefore.sites = readCountAtRev(baseRev, NAVIGATION_JSON, countNavigationSites);
    countsBefore.pricing = readCountAtRev(baseRev, PRICING_JSON, countPricingKeys);
    countsBefore.examNodes = readCountAtRev(baseRev, EXAM_CALENDAR_TS, countExamNodes);
  }
  let examNodesAfter = [];
  if (headRev) {
    countsAfter.sites = readCountAtRev(headRev, NAVIGATION_JSON, countNavigationSites);
    countsAfter.pricing = readCountAtRev(headRev, PRICING_JSON, countPricingKeys);
    try {
      const ts = runGit(["show", `${headRev}:${EXAM_CALENDAR_TS}`], repoRoot);
      examNodesAfter = parseExamNodes(ts);
      countsAfter.examNodes = examNodesAfter.length;
    } catch {
      countsAfter.examNodes = null;
    }
  }

  // 4. 状态表（只读；缺失或损坏时本节记未核实，不中断）
  let state = null;
  let stateLoaded = false;
  let stateItems = [];
  let stateLastUpdated = "未核实";
  let stateAgeDays = null;
  let stateStale = false;
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
    if (state && Array.isArray(state.items)) {
      stateLoaded = true;
      stateItems = state.items;
      stateLastUpdated = state.lastUpdated ?? "未核实";
      if (/^\d{4}-\d{2}-\d{2}$/.test(stateLastUpdated)) {
        stateAgeDays = daysBetween(stateLastUpdated, asOf);
        stateStale = stateAgeDays > STATE_STALE_DAYS;
      } else {
        stateStale = true;
      }
    }
  } catch {
    stateLoaded = false;
  }

  // 5. 过期检测三规则
  const expired1 = detectExpiredRule1(examNodesAfter, asOf);
  const expired2 = stateLoaded ? detectStalePoc(stateItems, asOf) : [];
  let isBatch0Ancestor = false;
  let batch0RefExists = false;
  try {
    runGit(["rev-parse", "--verify", "--quiet", BATCH0_REF], repoRoot);
    batch0RefExists = true;
  } catch {
    batch0RefExists = false;
  }
  if (batch0RefExists) {
    try {
      runGit(["merge-base", "--is-ancestor", BATCH0_REF, ref], repoRoot);
      isBatch0Ancestor = true;
    } catch {
      isBatch0Ancestor = false;
    }
  }
  const preconditions = stateLoaded
    ? checkPreconditions(stateItems, { isBatch0Ancestor, batch0RefExists })
    : [];

  // 6. 路线图 diff 建议（只列建议，不改文件）
  const roadmapFile = ROADMAP_CANDIDATES.find((p) => existsSync(join(repoRoot, p))) ?? null;
  const roadmapSuggestions = [];
  for (const e of expired1) roadmapSuggestions.push(`建议改：复核 ${e.text} 的展示口径（下线或改期）（来源：${e.source}）`);
  for (const e of expired2) roadmapSuggestions.push(`建议改/删：${e.text}，复盘裁决保留或关闭（来源：${e.source}）`);
  for (const p of preconditions.filter((x) => x.changed)) roadmapSuggestions.push(`建议改：${p.text}，更新路线图前置状态（来源：${p.source}）`);
  if (stateStale) roadmapSuggestions.push(`建议改：状态表已过期，先更新状态表再定路线图（来源：hidden_files/strategy-state.json，lastUpdated=${stateLastUpdated}）`);

  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 19) + "Z";
  return {
    data: {
      generatedAt,
      asOf,
      since,
      until: until ?? "(未指定)",
      ref,
      total,
      covered,
      clusters,
      countsBefore,
      countsAfter,
      stateLoaded,
      stateItems,
      stateLastUpdated,
      stateAgeDays: stateAgeDays ?? "未核实",
      stateStale,
      expired1,
      expired2,
      preconditions,
      roadmapFile,
      roadmapSuggestions,
      baseRevShort,
      headRevShort,
    },
    markdown: null,
  };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`缺少参数值：${a}`);
      return v;
    };
    if (a === "--since") opts.since = next();
    else if (a === "--until") opts.until = next();
    else if (a === "--as-of") opts.asOf = next();
    else if (a === "--ref") opts.ref = next();
    else if (a === "--reports-dir") opts.reportsDir = next();
    else if (a === "--state") opts.statePath = next();
    else if (a === "--out") opts.out = next();
    else if (a === "--no-write") opts.noWrite = true;
    else if (a === "--fixture-log") opts.fixtureLog = next();
    else if (a === "--base-rev") opts.baseRev = next();
    else if (a === "--head-rev") opts.headRev = next();
    else if (a === "--repo-root") opts.repoRoot = next();
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  return opts;
}

export function main(argv = process.argv.slice(2)) {
  const started = Date.now();
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log("用法：node scripts/weekly-review-draft.mjs [--since <git 日期>] [--until <git 日期>] [--as-of YYYY-MM-DD] [--ref <rev>] [--reports-dir <dir>] [--state <path>] [--out <path>] [--no-write] [--fixture-log <path>] [--base-rev <rev>] [--head-rev <rev>]");
    console.log("窗口日期须带显式时刻与时区偏移（如 \"2026-11-16 00:00:00 +0800\"），裸日期会随当前时刻漂移。");
    return 0;
  }
  if (opts.asOf && !/^\d{4}-\d{2}-\d{2}$/.test(opts.asOf)) {
    throw new Error(`--as-of 须为 YYYY-MM-DD：${opts.asOf}`);
  }
  const { data } = buildDraft(opts);
  const markdown = renderDraft(data);
  const outPath =
    opts.out ?? join(opts.reportsDir ?? join(opts.repoRoot ?? REPO_ROOT, "hidden_files"), `weekly-review-draft-${data.asOf}.md`);
  if (opts.noWrite) {
    process.stdout.write(markdown + "\n");
  } else {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, markdown + "\n", "utf8");
    console.error(`草稿已写：${outPath}`);
  }
  const elapsedMs = Date.now() - started;
  console.error(`耗时：${(elapsedMs / 1000).toFixed(2)} 秒（R1 阈值 ≤10 分钟）`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(`失败：${err.message}`);
    process.exit(2);
  }
}
