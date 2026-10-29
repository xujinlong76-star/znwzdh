#!/usr/bin/env node
/**
 * junit XML → Step Summary：把「哪几条用例红了」变成一眼可见的账。
 *
 * 为什么需要：CI 红灯时，人第一眼要的不是几千行日志，而是失败用例名。此前 E2E
 * 作业靠 awk 从 list reporter 里抽，单元测试分片则只有 junit artifact——而无 token
 * 环境下 `/actions/jobs/{id}/logs` 恒 403、本机也拉不到 artifact 内容（blob.core
 * .windows.net 超时），「哪一例红了」实际不可读。
 *
 * 口径：
 *   - 只读解析，不判定测试对错——红绿由测试步骤自己负责；唯一会红的情况是
 *     **产物缺失**（遥测链路断了，必须看得见，同 upload-artifact 的 error 口径）；
 *   - 计数优先取 `<testsuite>` 属性之和，取不到时回退数 `<testcase>`；
 *   - 失败详情按用例展开，默认最多 50 条（完整内容仍在 junit artifact 里）。
 *
 * 用法：node scripts/junit-summary.mjs [--max 50] <junit.xml ...>
 *   GITHUB_STEP_SUMMARY 存在时追加进去，否则打印到 stdout（本地复跑同款输出）。
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const P = "[junit-summary] ";

/** XML 实体解码（`&amp;` 必须最后解，避免二次解码） */
export function decodeEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function safeCodePoint(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function parseAttrs(text) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out[m[1]] = decodeEntities(m[2] ?? m[3] ?? "");
  }
  return out;
}

function toInt(value) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : 0;
}

function detailText(body) {
  const cdata = body.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  const raw = cdata ? cdata[1] : body;
  return raw
    .replace(/<[^>]*>/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "") ?? "";
}

/**
 * 解析一份 junit XML。
 * @returns {{totals:{tests:number,failures:number,errors:number,skipped:number},
 *            failures:{classname:string,name:string,kind:string,message:string}[],
 *            suites:number,cases:number}}
 */
export function parseJunit(xml) {
  const text = String(xml).replace(/\r\n?/g, "\n");
  const totals = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  const failures = [];

  let suites = 0;
  for (const m of text.matchAll(/<testsuite\b([^>]*)>/g)) {
    suites += 1;
    const a = parseAttrs(m[1]);
    totals.tests += toInt(a.tests);
    totals.failures += toInt(a.failures);
    totals.errors += toInt(a.errors);
    totals.skipped += toInt(a.skipped);
  }

  let cases = 0;
  for (const m of text.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    cases += 1;
    const body = m[2] ?? "";
    const hit = body.match(/<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/);
    if (!hit) continue;
    const a = parseAttrs(m[1]);
    const f = parseAttrs(hit[2] ?? "");
    const message = (f.message ?? "").trim() || detailText(hit[3] ?? "");
    failures.push({
      classname: a.classname ?? "",
      name: a.name ?? "(未命名用例)",
      kind: hit[1],
      message: message.trim(),
    });
  }

  if (suites === 0) {
    // 只有根节点属性的产物：退到根属性，再退到数 testcase
    const root = text.match(/<testsuites\b([^>]*)>/);
    if (root) {
      const a = parseAttrs(root[1]);
      totals.tests = toInt(a.tests);
      totals.failures = toInt(a.failures);
      totals.errors = toInt(a.errors);
      totals.skipped += toInt(a.skipped);
    }
  }
  if (totals.tests === 0 && cases > 0) totals.tests = cases;

  return { totals, failures, suites, cases };
}

function cell(value, limit = 200) {
  let text = String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/`/g, "'")
    .replace(/\|/g, "\\|")
    .trim();
  if (text.length > limit) text = text.slice(0, limit) + "…";
  return "`" + text + "`";
}

/** 一份产物的 markdown 小节 */
export function renderSummary(report, { label, max = 50 } = {}) {
  const t = report.totals;
  const failed = t.failures + t.errors;
  const mark = failed > 0 ? "❌" : "✅";
  const skip = t.skipped > 0 ? `，${t.skipped} 跳过` : "";
  const lines = [`### ${mark} ${label} — ${t.tests} 例，${t.failures} 失败，${t.errors} 错误${skip}`, ""];

  if (failed === 0) return lines.join("\n");
  if (report.failures.length === 0) {
    lines.push(`> 计数显示 ${failed} 例未通过，但未解析到失败详情——junit 结构与解析器不一致，请检查产物。`);
    lines.push("");
    return lines.join("\n");
  }

  lines.push("| 用例 | 失败信息 |");
  lines.push("| --- | --- |");
  for (const f of report.failures.slice(0, max)) {
    const where = f.classname ? `${f.classname} :: ${f.name}` : f.name;
    lines.push(`| ${cell(where)} | ${cell(f.message || f.kind)} |`);
  }
  const rest = failed - Math.min(report.failures.length, max);
  if (rest > 0) {
    lines.push(`| … | 另有 ${rest} 例未列出（完整内容见 junit artifact） |`);
  }
  lines.push("");
  return lines.join("\n");
}

function parseArgs(argv) {
  const files = [];
  let max = 50;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--max") {
      max = Number.parseInt(argv[i + 1] ?? "", 10);
      i += 1;
      continue;
    }
    if (arg.startsWith("--max=")) {
      max = Number.parseInt(arg.slice("--max=".length), 10);
      continue;
    }
    files.push(arg);
  }
  return { files, max: Number.isFinite(max) && max > 0 ? max : 50 };
}

function main(argv) {
  const { files, max } = parseArgs(argv);
  if (files.length === 0) {
    console.error("用法: node scripts/junit-summary.mjs [--max <n>] <junit.xml ...>");
    return 2;
  }

  const chunks = [];
  let missing = 0;
  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`${P}找不到 junit 产物：${file}`);
      missing += 1;
      continue;
    }
    const report = parseJunit(readFileSync(file, "utf8"));
    chunks.push(renderSummary(report, { label: file, max }));
  }

  const markdown = chunks.join("\n");
  if (markdown !== "") {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath !== undefined && summaryPath !== "") {
      appendFileSync(summaryPath, markdown);
      console.log(`${P}已追加到 Step Summary：${summaryPath}`);
    } else {
      console.log(markdown);
    }
  }

  if (missing > 0) {
    console.error(`${P}${missing} 个 junit 产物缺失——遥测链路断了，按失败处理`);
    return 1;
  }
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
