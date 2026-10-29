#!/usr/bin/env node
/**
 * 检查「清理动作覆盖了每条出口」——尤其是提前 return。
 *
 * ## 为什么需要它
 *
 * 2026-10-30 修过一个真 bug：`offline-video-cache.ts` 的 `removeOfflineVideo`
 * 在 `finally` 里调 `invalidateOfflineIdSet()` 清缓存，但**前面还有一个
 * `if (!idb) { lsRemove(id); return }` 的提前分支**——那条路根本走不到 finally，
 * 于是「删了还在」。补完 finally 仍红，就是因为测试环境正好走提前 return。
 *
 * 通用的控制流分析太重、误报多。这里用**登记制**：谁是「清理函数」由人写进
 * `CLEANUP_RULES`，检查器只判一件事——
 *
 *   **同一个函数里，只要出现过清理调用，那么该函数的每条 `return` 之前都必须有清理调用。**
 *
 * 这个判据正好卡住「只接了 try/finally、漏了提前 return」这类错，且不猜测语义。
 *
 * ## 用法
 *
 *   node scripts/check-cleanup-coverage.mjs           # 报告并按缺口数退出
 *   node scripts/check-cleanup-coverage.mjs --json    # 机器可读
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 登记表：哪个文件里的哪个函数是「清理动作」。
 * 新增清理函数时在这里登记一行——不登记的函数检查器不看（避免全仓误报）。
 */
export const CLEANUP_RULES = [
  {
    file: "apps/web-overlay/src/lib/offline-video-cache.ts",
    cleanupFn: "invalidateOfflineIdSet",
    why: "离线缓存 id 集合缓存的失效；漏一条出口就是「删了还在」",
  },
];

/**
 * 把源码按**顶层/嵌套函数**切成若干片段，每个片段带起止偏移。
 * 用大括号配对切分，不做完整 AST——够用且不依赖解析器。
 */
export function splitFunctionBodies(src) {
  const out = [];
  const re = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    // 找到函数声明的开大括号（跳过参数表）
    let i = src.indexOf("{", m.index + m[0].length - 1);
    if (i === -1) continue;
    let depth = 0;
    let end = -1;
    for (let j = i; j < src.length; j++) {
      const ch = src[j];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) continue;
    out.push({ name, start: i, end, body: src.slice(i, end + 1) });
  }
  return out;
}

/**
 * 找出一段函数体里**没有被清理覆盖**的 `return`。
 *
 * 「被覆盖」有两种：
 *   1. return 之前紧邻着清理调用（提前 return 的正确写法）；
 *   2. return 落在某个 `try { … } finally { 清理 }` 的 try/catch 体内
 *      （finally 会兜住它）。
 * 只有两者都不满足才算缺口。第二条不判就会把 `return await new Promise(…)`
 * 这种合法写法误报成缺口（2026-10-30 实测）。
 */
export function returnsWithoutCleanup(body, cleanupFn) {
  // 先剥掉注释，避免注释里的 return / 清理调用污染判定
  // 两类注释都**填空格**而不是删掉：这样字节偏移不变，
  // 且 `cleanup-noop:` 这类写在注释里的标记仍能被后面读到（2026-10-30 实测）。
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (s) => s.replace(/[^\n]/g, " "));

  // 标出「被 finally 覆盖」的字节区间：try 与 catch 的正文（不含 finally 正文）
  const covered = new Array(stripped.length).fill(false);
  const callRe = new RegExp(`\\b${cleanupFn}\\s*\\(`);
  const tryRe = /\btry\s*\{/g;
  let t;
  while ((t = tryRe.exec(stripped)) !== null) {
    const tryOpen = stripped.indexOf("{", t.index);
    let depth = 0;
    let tryClose = -1;
    for (let j = tryOpen; j < stripped.length; j++) {
      if (stripped[j] === "{") depth++;
      else if (stripped[j] === "}") {
        depth--;
        if (depth === 0) {
          tryClose = j;
          break;
        }
      }
    }
    if (tryClose === -1) continue;
    // try 正文
    for (let j = tryOpen; j <= tryClose; j++) covered[j] = true;
    // 紧随其后的 catch(…) { … } 正文同样被 finally 兜
    const after = stripped.slice(tryClose + 1, tryClose + 40);
    const cm = /^\s*catch\s*(?:\([^)]*\))?\s*\{/.exec(after);
    if (cm) {
      const cOpen = tryClose + 1 + cm[0].length - 1;
      let d2 = 0;
      for (let j = cOpen; j < stripped.length; j++) {
        if (stripped[j] === "{") d2++;
        else if (stripped[j] === "}") {
          d2--;
          if (d2 === 0) {
            for (let k = cOpen; k <= j; k++) covered[k] = true;
            break;
          }
        }
      }
    }
  }

  const problems = [];
  const returnRe = /\breturn\b/g;
  let m;
  while ((m = returnRe.exec(stripped)) !== null) {
    if (covered[m.index]) continue; // finally 会兜住
    // 判据：**清理调用之后到 return 之间不能有别的语句**——那段只允许是
    // `cleanupFn(...)` 自己 + 可选分号 + 空白。
    //
    // 为什么不用「上一条语句」：`invalidate();` 的分号本身就是语句边界，
    // 按边界切会把调用切到上一段里；而按固定宽度回看又会把几行前的调用算成紧邻。
    // 这条判据对两种写法（带分号 / 不带）都成立，也不被远处的调用骗过。
    const before = stripped.slice(Math.max(0, m.index - 300), m.index);
    const tail = before.slice(Math.max(0, before.search(new RegExp(`\\b${cleanupFn}\\s*\\(`))));
    if (tail.length < before.length && new RegExp(`^\\s*${cleanupFn}\\s*\\([^)]*\\)\\s*;?\\s*$`).test(tail)) continue;
    // 显式豁免：`cleanup-noop: <理由>` 写在 return 之前，表示「这条出口什么都没改」。
    // 必须写理由——静默豁免等于把守卫变成摆设。
    // 注意：标记常写在注释里，而 stripped 已把注释填成空格，所以要从**原文 body** 取
    // （两者偏移一致，见上面的填空格处理）。
    if (/cleanup-noop\s*:/.test(body.slice(Math.max(0, m.index - 200), m.index))) continue;
    const line = stripped.slice(0, m.index).split("\n").length;
    problems.push({ offset: m.index, line });
  }
  return problems;
}

/** 纯函数：对一份源码应用一条规则，返回缺口清单 */
export function checkSource(src, rule) {
  const fns = splitFunctionBodies(src).filter((f) => f.body.includes(rule.cleanupFn + "("));
  const gaps = [];
  for (const fn of fns) {
    const bad = returnsWithoutCleanup(fn.body, rule.cleanupFn);
    for (const b of bad) gaps.push({ fn: fn.name, ...b });
  }
  return gaps;
}

function main() {
  const asJson = process.argv.includes("--json");
  const all = [];
  for (const rule of CLEANUP_RULES) {
    const p = join(ROOT, rule.file);
    if (!existsSync(p)) {
      all.push({ file: rule.file, error: "登记的文件不存在" });
      continue;
    }
    const gaps = checkSource(readFileSync(p, "utf8"), rule);
    for (const g of gaps) all.push({ file: rule.file, cleanupFn: rule.cleanupFn, ...g });
  }

  if (asJson) {
    console.log(JSON.stringify({ ok: all.length === 0, gaps: all }, null, 2));
    process.exit(all.length === 0 ? 0 : 1);
  }

  if (all.length === 0) {
    console.log(`✅ 清理动作覆盖：${CLEANUP_RULES.length} 条规则，每条出口都有清理调用`);
    return;
  }
  console.log(`❌ 清理动作覆盖：${all.length} 处出口没有清理调用：`);
  for (const g of all) {
    if (g.error) {
      console.log(`   · ${g.file} → ${g.error}`);
      continue;
    }
    console.log(`   · ${g.file} → ${g.cleanupFn} 在 ${g.fn}() 的第 ${g.line} 行 return 前没有调用`);
  }
  console.log(`\n   修法：提前 return 的分支也要调用清理函数；` + `finally 只覆盖 try 块那条路。`);
  process.exit(1);
}

const invokedDirectly = process.argv[1] && /check-cleanup-coverage\.mjs$/.test(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
