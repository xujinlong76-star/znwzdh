#!/usr/bin/env node
/**
 * lychee 每周全量周报：lychee/out.json → 按注册域名分组开 GitHub issue。
 *
 * 方案来源：03-livelink-mapping §6.2。接线写死：
 *   1. 只取失败条目；lychee 退出码 1/3 时不开 issue，报维护者（退出码 0 正常结束）。
 *   2. 按注册域名分组，每域名一个 issue（标题 `<域名>（<n> 条）· <周次>`），
 *      正文只列死链（URL、状态码、首次发现周次、Wayback 建议链接）；
 *      同一域名已开 issue 未关闭时不重复开，只追加评论。
 *   3. 失败条目先过 sentinel 二次校验：lychee 报 200 的不进 issue；
 *      复核为疑似反爬（401/403/429）的进“疑似反爬”分组，不进死链 issue。
 *
 * sentinel 二次校验的输入（--sentinel <json>）：
 *   JSON 对象（url → { httpStatus, auditStatus }）或数组
 *   （[{ url, httpStatus, auditStatus }]）。auditStatus 取值与
 *   health-sentinel.ts 一致（HEALTHY / SUSPICIOUS_PARKED / SOFT_404 /
 *   THIN_CONTENT）。没有 --sentinel 时，失败条目全部记为“待 sentinel 复核”，
 *   不进死链 issue（只在日志里汇总报给维护者），因为未复核的失败不能当死链发。
 *   sentinel 巡检本身不在本脚本里跑——它由巡检任务另行产出该 JSON 后传进来。
 *
 * 用法：
 *   node scripts/lychee-weekly-report.mjs --input lychee/out.json
 *       --lychee-exit-code 2 [--week 2026-W47] [--sentinel sentinel.json]
 *       [--dry-run] [--repo owner/repo]
 *   环境变量：GITHUB_TOKEN、GITHUB_REPOSITORY（--repo 优先）。
 *   --dry-run 只打印计划的动作，不调 GitHub API。
 */

import { readFileSync } from "node:fs";

const BOT_BLOCK_STATUSES = new Set([401, 403, 429]);
const DEAD_STATUSES = new Set([404, 410, 451]);
const WAYBACK_PREFIX = "https://web.archive.org/web/*/";

/** 常见二级公共后缀（注册域名判定用；未命中时取最后两段）。 */
const TWO_LEVEL_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "edu.cn",
  "ac.cn",
  "com.hk",
  "com.tw",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "ne.jp",
  "or.jp",
  "com.br",
  "com.mx",
  "co.kr",
  "com.sg",
]);

export function registrableDomain(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname === "localhost") return hostname;
  const labels = hostname.split(".");
  if (labels.length <= 2) return hostname;
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_LEVEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

export function waybackUrl(url, suggestion) {
  if (typeof suggestion === "string" && suggestion.includes("web.archive.org")) return suggestion;
  return `${WAYBACK_PREFIX}${url}`;
}

/** ISO 周次（UTC 口径），如 2026-W47；--week 可显式覆盖（测试用）。 */
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function statusCodeOf(status) {
  if (typeof status === "number") return status;
  if (status && typeof status === "object" && typeof status.code === "number") return status.code;
  return null;
}

function isOkStatus(status) {
  if (status === "ok") return true;
  const code = statusCodeOf(status);
  if (code !== null) return code >= 200 && code <= 299;
  return false;
}

/**
 * 解析 lychee --format json 的 out.json。兼容三种形态：
 *   - 数组 [{ url, status, suggestion? }]
 *   - 对象映射 { "<url>": { status, suggestion? } }
 *   - 包裹对象 { results: [...] } / { failures: [...] }
 * 返回规范化条目 [{ url, statusCode, statusText, suggestion }]。
 * status 形态：数字 | { code } | "ok"/"error"/"timeout" 等字符串。
 */
export function parseLycheeOutput(parsed) {
  let rawEntries = [];
  if (Array.isArray(parsed)) {
    rawEntries = parsed;
  } else if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.results)) rawEntries = parsed.results;
    else if (Array.isArray(parsed.failures)) rawEntries = parsed.failures;
    else {
      rawEntries = Object.entries(parsed).map(([url, value]) => ({
        url,
        ...(value && typeof value === "object" ? value : { status: value }),
      }));
    }
  } else {
    throw new Error("out.json 顶层不是数组/对象，无法解析");
  }
  const entries = [];
  for (const raw of rawEntries) {
    const url = raw.url ?? raw.link ?? raw.uri;
    if (typeof url !== "string" || url === "") continue;
    const status = raw.status ?? raw.result ?? null;
    const code = statusCodeOf(status);
    const statusText =
      (status && typeof status === "object" && typeof status.text === "string" && status.text) ||
      (typeof status === "string" ? status : "") ||
      (code !== null ? `HTTP ${code}` : "unknown");
    entries.push({
      url,
      statusCode: code,
      statusText,
      suggestion: typeof raw.suggestion === "string" ? raw.suggestion : null,
    });
  }
  return entries;
}

/** 只取失败条目：lychee 报 200（或 2xx）的绝不进 issue（lychee 测不出软 404）。 */
export function failedEntries(entries) {
  return entries.filter((e) => {
    if (e.statusCode !== null) return e.statusCode < 200 || e.statusCode >= 300;
    return !isOkStatus(e.statusText === "unknown" ? null : e.statusText) && e.statusText !== "ok";
  });
}

function normalizeSentinel(raw) {
  const map = new Map();
  const put = (url, verdict) => {
    if (typeof url === "string" && url) map.set(url, verdict);
  };
  const classify = (v) => {
    const httpStatus = typeof v.httpStatus === "number" ? v.httpStatus : null;
    const auditStatus = typeof v.auditStatus === "string" ? v.auditStatus : null;
    if (typeof v.verdict === "string") return { verdict: v.verdict, httpStatus, auditStatus };
    if (httpStatus !== null && BOT_BLOCK_STATUSES.has(httpStatus)) {
      return { verdict: "bot-block", httpStatus, auditStatus };
    }
    if (httpStatus === 200 || auditStatus === "HEALTHY") {
      return { verdict: "ok", httpStatus, auditStatus };
    }
    if (
      (httpStatus !== null && (DEAD_STATUSES.has(httpStatus) || httpStatus >= 500)) ||
      auditStatus === "SOFT_404" ||
      auditStatus === "SUSPICIOUS_PARKED"
    ) {
      return { verdict: "dead", httpStatus, auditStatus };
    }
    return { verdict: "unknown", httpStatus, auditStatus };
  };
  if (Array.isArray(raw)) {
    for (const item of raw) put(item.url, classify(item));
  } else if (raw && typeof raw === "object") {
    for (const [url, value] of Object.entries(raw)) put(url, classify(value));
  }
  return map;
}

/**
 * sentinel 二次校验：返回 { dead, botBlock, pending } 三组。
 *   dead：复核后仍失败（404/410/451/5xx 或 SOFT_404/SUSPICIOUS_PARKED）。
 *   botBlock：复核为疑似反爬（401/403/429）。
 *   pending：无 sentinel 复核结论，或结论为 unknown/ok 之外的未定态——
 *     不进 issue，只汇总报维护者。复核为 ok 的直接丢弃。
 */
export function classifyEntries(failures, sentinelMap) {
  const dead = [];
  const botBlock = [];
  const pending = [];
  for (const entry of failures) {
    const verdict = sentinelMap ? sentinelMap.get(entry.url) : undefined;
    if (!verdict) {
      pending.push({ ...entry, reason: "无 sentinel 复核结论" });
      continue;
    }
    if (verdict.verdict === "dead") dead.push(entry);
    else if (verdict.verdict === "bot-block") botBlock.push(entry);
    else if (verdict.verdict === "ok") continue;
    else pending.push({ ...entry, reason: `sentinel 复核未定（${verdict.verdict}）` });
  }
  return { dead, botBlock, pending };
}

export function groupByDomain(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const domain = registrableDomain(entry.url);
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain).push(entry);
  }
  return [...groups.entries()]
    .map(([domain, items]) => ({ domain, items }))
    .sort((a, b) => b.items.length - a.items.length || a.domain.localeCompare(b.domain));
}

export function buildIssueTitle(domain, kind, count, week) {
  if (kind === "bot-block") return `${domain}（疑似反爬 ${count} 条）· ${week}`;
  return `${domain}（${count} 条）· ${week}`;
}

/** 从已开 issue 正文里读回“URL → 首次发现周次”，去重时沿用旧周次。 */
export function parseExistingIssueBody(body) {
  const firstSeen = new Map();
  if (typeof body !== "string") return firstSeen;
  for (const line of body.split("\n")) {
    const match = line.match(/^\|\s*(https?:\/\/\S+?)\s*\|\s*([^|]*?)\s*\|\s*(\d{4}-W\d{2})\s*\|/);
    if (match) firstSeen.set(match[1], match[3]);
  }
  return firstSeen;
}

function tableRows(entries, firstSeen, week) {
  return entries.map((e) => {
    const seen = firstSeen.get(e.url) ?? week;
    const code = e.statusCode !== null ? String(e.statusCode) : e.statusText;
    return `| ${e.url} | ${code} | ${seen} | [Wayback 快照](${waybackUrl(e.url, e.suggestion)}) |`;
  });
}

export function buildIssueBody(domain, kind, entries, week, firstSeen = new Map()) {
  const heading = kind === "bot-block" ? "疑似反爬" : "死链";
  const lines = [
    `## ${heading}（${entries.length} 条）· ${week}`,
    ``,
    `域名：${domain}`,
    kind === "bot-block"
      ? `说明：对方站点拒绝的是自动访问（401/403/429），真实用户浏览器往往照常可用；按方案 §6.2 不进死链 issue，只作疑似反爬分组。`
      : `说明：经 sentinel 内容层复核后仍失败的站。lychee 报 200 的站不在此列。`,
    ``,
    `| URL | 状态码 | 首次发现 | 存档建议 |`,
    `|---|---|---|---|`,
    ...tableRows(entries, firstSeen, week),
  ];
  return lines.join("\n");
}

export function buildCommentBody(domain, kind, newEntries, week, firstSeen = new Map()) {
  const heading = kind === "bot-block" ? "疑似反爬" : "死链";
  const lines = [
    `## 新增${heading}（${newEntries.length} 条）· ${week}`,
    ``,
    `| URL | 状态码 | 首次发现 | 存档建议 |`,
    `|---|---|---|---|`,
    ...tableRows(newEntries, firstSeen, week),
  ];
  return lines.join("\n");
}

/**
 * 按 kind 精确匹配已开 issue 标题（与 buildIssueTitle 的格式一一对应，互不串扰）：
 *   dead：`<域名>（<n> 条）· <周次>`——“（”后紧跟数字，不含“疑似反爬”；
 *   bot-block：`<域名>（疑似反爬 <n> 条）· <周次>`。
 * 域名中的正则元字符（`.` 等）需转义，否则 `example.org` 会误匹配 `exampleXorg`。
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesExistingIssueTitle(title, domain, kind) {
  const escapedDomain = escapeRegExp(domain);
  const pattern =
    kind === "bot-block"
      ? `^${escapedDomain}（疑似反爬 \\d+ 条）· `
      : `^${escapedDomain}（\\d+ 条）· `;
  return new RegExp(pattern).test(title);
}

/**
 * 纯函数：由失败条目 + 已开 issue 列表算出动作计划（可单测，不调网络）。
 * existingIssues: [{ number, title, body }]（仅 state=open 的）。
 * 返回 { actions, pending }；action: { domain, kind, action: 'create'|'comment', title, body, newEntries, existingIssueNumber }。
 */
export function planActions({ dead, botBlock, week, existingIssues }) {
  const actions = [];
  for (const kind of ["dead", "bot-block"]) {
    const entries = kind === "dead" ? dead : botBlock;
    for (const { domain, items } of groupByDomain(entries)) {
      const existing = existingIssues.find((issue) =>
        matchesExistingIssueTitle(issue.title, domain, kind),
      );
      if (!existing) {
        actions.push({
          domain,
          kind,
          action: "create",
          title: buildIssueTitle(domain, kind, items.length, week),
          body: buildIssueBody(domain, kind, items, week),
          newEntries: items,
          existingIssueNumber: null,
        });
        continue;
      }
      const firstSeen = parseExistingIssueBody(existing.body);
      const newEntries = items.filter((e) => !firstSeen.has(e.url));
      if (newEntries.length === 0) continue;
      actions.push({
        domain,
        kind,
        action: "comment",
        title: existing.title,
        body: buildCommentBody(domain, kind, newEntries, week, firstSeen),
        newEntries,
        existingIssueNumber: existing.number,
      });
    }
  }
  return actions;
}

async function gh(path, { token, method = "GET", body = null }) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ShanYangHu-LinkCheck/1.0",
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API ${method} ${path} 失败：${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function listOpenIssues(repo, token) {
  const issues = [];
  let path = `/repos/${repo}/issues?state=open&per_page=100`;
  for (let page = 0; page < 5 && path; page += 1) {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ShanYangHu-LinkCheck/1.0",
      },
    });
    if (!res.ok) throw new Error(`GitHub API 列 issue 失败：${res.status}`);
    const batch = await res.json();
    issues.push(...batch.filter((i) => !i.pull_request));
    const link = res.headers.get("link") ?? "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    path = next ? next[1].replace("https://api.github.com", "") : null;
  }
  return issues.map((i) => ({ number: i.number, title: i.title, body: i.body ?? "" }));
}

export function parseArgs(argv) {
  const args = { input: "lychee/out.json", lycheeExitCode: 2, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--input") args.input = argv[++i];
    else if (a === "--lychee-exit-code") args.lycheeExitCode = Number(argv[++i]);
    else if (a === "--week") args.week = argv[++i];
    else if (a === "--sentinel") args.sentinel = argv[++i];
    else if (a === "--repo") args.repo = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`不认识的参数：${a}`);
  }
  if (args.lycheeExitCode !== 0 && args.lycheeExitCode !== 1 && args.lycheeExitCode !== 2 && args.lycheeExitCode !== 3) {
    throw new Error(`--lychee-exit-code 只能是 0/1/2/3，收到 ${args.lycheeExitCode}`);
  }
  return args;
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`参数错误：${err.message}`);
    return 2;
  }
  if (args.help) {
    console.log("用法：node scripts/lychee-weekly-report.mjs --input lychee/out.json --lychee-exit-code 2 [--week YYYY-Www] [--sentinel sentinel.json] [--dry-run] [--repo owner/repo]");
    return 0;
  }
  // 退出码 1/3 = 配置/运行错误：不开 issue，报维护者（正常结束，退出码 0）。
  if (args.lycheeExitCode === 1 || args.lycheeExitCode === 3) {
    console.error(
      `lychee-weekly-report：lychee 退出码 ${args.lycheeExitCode}（配置/运行错误），不开 issue。请维护者检查 lychee 配置与工作流。`,
    );
    return 0;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(args.input, "utf8"));
  } catch (err) {
    if (args.lycheeExitCode === 0) {
      console.log("lychee-weekly-report：无 out.json 且 lychee 退出码为 0，无失败，零 issue。");
      return 0;
    }
    console.error(`读 out.json 失败：${err.message}`);
    return 2;
  }
  let entries;
  try {
    entries = parseLycheeOutput(parsed);
  } catch (err) {
    console.error(`解析 out.json 失败：${err.message}`);
    return 2;
  }
  const failures = failedEntries(entries);
  let sentinelMap = null;
  if (args.sentinel) {
    try {
      sentinelMap = normalizeSentinel(JSON.parse(readFileSync(args.sentinel, "utf8")));
    } catch (err) {
      console.error(`读 sentinel 复核文件失败：${err.message}`);
      return 2;
    }
  }
  const { dead, botBlock, pending } = classifyEntries(failures, sentinelMap);
  const week = args.week ?? isoWeek();
  if (dead.length === 0 && botBlock.length === 0) {
    console.log(`lychee-weekly-report：${week} 无可发 issue 的失败（lychee 失败 ${failures.length} 条，待复核 ${pending.length} 条）。`);
    if (pending.length > 0) {
      console.log("待 sentinel 复核（未进 issue）：");
      for (const p of pending) console.log(`  - ${p.url}（${p.statusCode ?? p.statusText}）：${p.reason}`);
    }
    return 0;
  }
  const repo = args.repo ?? process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!args.dryRun && (!repo || !token)) {
    console.error("lychee-weekly-report：需要 GITHUB_REPOSITORY 与 GITHUB_TOKEN 才能开 issue（或用 --dry-run 只看计划）。");
    return 2;
  }
  let existingIssues = [];
  if (!args.dryRun) {
    try {
      existingIssues = await listOpenIssues(repo, token);
    } catch (err) {
      console.error(`列 GitHub issue 失败：${err.message}`);
      return 2;
    }
  }
  const actions = planActions({ dead, botBlock, week, existingIssues });
  if (args.dryRun) {
    console.log(JSON.stringify({ week, actions, pending: pending.map((p) => p.url) }, null, 2));
    return 0;
  }
  let created = 0;
  let commented = 0;
  for (const action of actions) {
    try {
      if (action.action === "create") {
        const issue = await gh(`/repos/${repo}/issues`, {
          token,
          method: "POST",
          body: { title: action.title, body: action.body },
        });
        console.log(`新建 issue #${issue.number}：${action.title}`);
        created += 1;
      } else {
        await gh(`/repos/${repo}/issues/${action.existingIssueNumber}/comments`, {
          token,
          method: "POST",
          body: { body: action.body },
        });
        console.log(`追加评论到 issue #${action.existingIssueNumber}：${action.title}（新增 ${action.newEntries.length} 条）`);
        commented += 1;
      }
    } catch (err) {
      console.error(`执行动作失败（${action.domain}/${action.kind}）：${err.message}`);
      return 2;
    }
  }
  console.log(
    `lychee-weekly-report：${week} 完成，新建 issue ${created} 个、追加评论 ${commented} 个；待复核 ${pending.length} 条未进 issue。`,
  );
  if (pending.length > 0) {
    for (const p of pending) console.log(`  待复核：${p.url}（${p.statusCode ?? p.statusText}）`);
  }
  return 0;
}

const invokedAsScript =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedAsScript) {
  process.exitCode = await main(process.argv.slice(2));
}
