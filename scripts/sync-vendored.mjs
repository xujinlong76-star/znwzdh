#!/usr/bin/env node
/**
 * 同构副本（vendored copy）一致性门禁。
 *
 * 背景：`apps/web` 是 vendored 底座，生产镜像只拷贝 `apps/web-overlay/`，
 * 所以有些纯逻辑必须在前端再存一份。仓库已有三处：体检状态机、短链校验、
 * 「未分类」常量。复制本身可接受，**悄悄分叉**不可接受——面板说「待复检」、
 * 接口说「健康」，这类缺陷没有任何报错，只有用户投诉。
 *
 * 三种模式（因为三处副本的形态本来就不同，一刀切比对会造出假红）：
 *   verbatim  副本正文与源文件逐字一致（允许副本多一段说明头）
 *   constant  指定导出常量的值必须相等
 *   behavior  两侧都导出同名函数；一致性由清单登记的 parity 用例保证，
 *             本脚本只校验「符号存在 + 用例存在」，不做静态求值
 *
 * 额外一条：`apps/web-overlay/src/**` 里凡是自述「同构复制 / 同步副本 / 重复一份」
 * 的文件，必须在清单里登记——否则新副本可以完全不被人发现。
 *
 * 用法：
 *   node scripts/sync-vendored.mjs --check   # 校验（CI / verify）
 *   node scripts/sync-vendored.mjs --write   # 从源重新生成 verbatim 副本
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 测试可注入临时根目录与清单：门禁逻辑本身不该只在真实仓库上可测
const ROOT = process.env.NAVHUB_VENDORED_ROOT
  ? resolve(process.env.NAVHUB_VENDORED_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = process.env.NAVHUB_VENDORED_MANIFEST || join(ROOT, "vendored.manifest.json");
const WRITE = process.argv.includes("--write");
const AS_JSON = process.argv.includes("--json");

const MARKER_RE = /同构复制|同步副本|重复一份|再导出 core 实现/;

function read(rel) {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, "utf8");
}

const normalize = (text) => text.replace(/\r\n/g, "\n");

/** 去掉文件开头的说明块（`/** … *​/`），保留正文 */
function bodyOf(text) {
  const norm = normalize(text);
  const end = norm.indexOf("*/");
  if (!norm.trimStart().startsWith("/**") || end < 0) return norm.trimStart();
  return norm.slice(end + 2).trimStart();
}

function constantValue(text, symbol) {
  const re = new RegExp(`export\\s+const\\s+${symbol}\\s*(?::[^=]+)?=\\s*(['"])([\\s\\S]*?)\\1`);
  const m = text.match(re);
  return m ? m[2] : null;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const problems = [];
const checked = [];
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const registered = new Set((manifest.entries ?? []).map((e) => e.copy));

for (const entry of manifest.entries ?? []) {
  const source = read(entry.source);
  const copy = read(entry.copy);
  if (source === null) {
    problems.push(`${entry.id}: 源文件不存在 ${entry.source}`);
    continue;
  }
  if (copy === null) {
    problems.push(`${entry.id}: 副本不存在 ${entry.copy}`);
    continue;
  }
  if (entry.parityTest && !existsSync(resolve(ROOT, entry.parityTest))) {
    problems.push(`${entry.id}: 清单登记的 parity 用例不存在 ${entry.parityTest}`);
  }

  if (entry.mode === "verbatim") {
    // 副本 = 自己的说明头 + 源文件**全文**（源文件的文档头一并保留：
    // 那些注释解释了业务口径，删掉等于把知识留在 core、前端读不到）
    const a = normalize(source).trimStart();
    const b = bodyOf(copy);
    if (a !== b) {
      if (WRITE) {
        const normCopy = normalize(copy);
        const end = normCopy.indexOf("*/");
        const header = normCopy.trimStart().startsWith("/**") && end >= 0 ? normCopy.slice(0, end + 2) : "";
        writeFileSync(resolve(ROOT, entry.copy), `${header}\n${a}`, "utf8");
        checked.push(`${entry.id}: 已从源重新生成`);
      } else {
        problems.push(`${entry.id}: 正文与源不一致（${entry.source} → ${entry.copy}）。修：--write 或手工同步`);
      }
    } else {
      checked.push(`${entry.id}: 正文一致`);
    }
    continue;
  }

  if (entry.mode === "constant") {
    if (!entry.symbol) {
      problems.push(`${entry.id}: constant 模式缺少 symbol`);
      continue;
    }
    const a = constantValue(source, entry.symbol);
    const b = constantValue(copy, entry.symbol);
    if (a === null) problems.push(`${entry.id}: 源文件里找不到 export const ${entry.symbol}`);
    else if (b === null) problems.push(`${entry.id}: 副本里找不到 export const ${entry.symbol}`);
    else if (a !== b) problems.push(`${entry.id}: ${entry.symbol} 不一致（源 ${a} ≠ 副本 ${b}）`);
    else checked.push(`${entry.id}: ${entry.symbol} 一致`);
    continue;
  }

  if (entry.mode === "behavior") {
    if (!entry.symbol) {
      problems.push(`${entry.id}: behavior 模式缺少 symbol`);
      continue;
    }
    if (!source.includes(entry.symbol)) problems.push(`${entry.id}: 源文件里没有 ${entry.symbol}`);
    else if (!copy.includes(entry.symbol)) problems.push(`${entry.id}: 副本里没有 ${entry.symbol}`);
    else checked.push(`${entry.id}: ${entry.symbol} 两侧存在（一致性由 parity 用例保证）`);
    continue;
  }

  problems.push(`${entry.id}: 未知 mode ${entry.mode}`);
}

// 未登记的同构副本：自述标记出现在 overlay/src 却不在清单里
const overlaySrc = resolve(ROOT, "apps/web-overlay/src");
if (existsSync(overlaySrc)) {
  for (const abs of walk(overlaySrc)) {
    const rel = abs.slice(ROOT.length + 1).replace(/\\/g, "/");
    if (registered.has(rel)) continue;
    const head = normalize(readFileSync(abs, "utf8")).split("\n").slice(0, 30).join("\n");
    if (MARKER_RE.test(head)) {
      problems.push(`未登记的同构副本：${rel}（文件头自述与 core 重复，但 vendored.manifest.json 里没有它）`);
    }
  }
}

if (problems.length > 0) {
  if (AS_JSON) console.log(JSON.stringify({ problems, checked }, null, 2));
  else {
    console.error(`❌ 同构副本一致性：${problems.length} 个问题`);
    for (const p of problems) console.error("   - " + p);
    console.error("\n   登记表：vendored.manifest.json（三种模式见脚本头部注释）。");
  }
  process.exit(1);
}

if (AS_JSON) console.log(JSON.stringify({ problems: [], checked }, null, 2));
else {
  console.log(`✅ 同构副本一致性：${checked.length} 项通过`);
  for (const c of checked) console.log("   · " + c);
}
