#!/usr/bin/env node
/**
 * 检查「读路径的事实源判据是显式开关，不是『哪边数据多』」。
 *
 * ## 为什么需要它
 *
 * 2026-10-30 修过一个真 bug：`storage.ts` 的 `readVideosData` 里有
 *
 *     if (dbItemCount > kvCount) { 用关系表供数 }
 *
 * 而 `routes/videos.ts` 的注释**明令禁止**这种口径——`json` / `dual` 模式下关系表
 * 只是影子副本，实测 KV 74 条、表 5,578 条，按条数多的那侧供数会返回站点上
 * 根本不存在的幻影视频。判据只能是 `resolveVideoStoreMode() === "db"` 这类显式开关。
 *
 * 这类错很隐蔽：它看起来像「智能回落」，实际是把影子副本当成了正本。
 *
 * ## 判据（登记制，避免全仓误报）
 *
 * 在 `SOURCE_TRUTH_FILES` 登记的读路径文件里，禁止出现**两个计数/长度表达式
 * 的大小比较**（`aCount > bCount`、`a.length < b.length` 等）。
 * 真正的开关判断写的是 `=== "db"` / `env` / `mode`，不会长成计数比较。
 *
 * ## 用法
 *
 *   node scripts/check-source-truth.mjs          # 报告并按缺口数退出
 *   node scripts/check-source-truth.mjs --json   # 机器可读
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 登记表：哪些文件是「读路径的事实源选择处」。
 *
 * 两种写法：
 *   - `{ file: "a/b.ts" }`   —— 精确文件；
 *   - `{ dir: "a/b", include: /\.ts$/ }` —— 整个目录（递归），按 include 过滤。
 *
 * 用目录而不是逐文件登记，是因为**新写的读路径不会自动想起来登记**——
 * 2026-10-30 就是 storage.ts 里一段新启发式溜进来的。
 */
export const SOURCE_TRUTH_FILES = [
  {
    dir: "apps/api/src",
    include: /\.ts$/,
    why: "API 读路径的事实源选择都在这里；新增读路径默认纳入检查",
  },
  {
    dir: "apps/web-overlay/src/lib",
    include: /\.ts$/,
    why: "覆盖层的数据读取层；同样不许「按计数选源」",
  },
];

/**
 * 计数/长度表达式：`xxxCount` / `xxx.length` / `countXxx(...)`。
 * 只用于**检测比较**，不用于推断语义。
 */
const COUNTISH = /(?:[A-Za-z_$][\w$]*(?:Count|count)|[A-Za-z_$][\w$]*\.length|count[A-Z][\w$]*\()/;

/** 两个计数表达式之间的大小比较 */
export const COUNT_COMPARISON = new RegExp(
  `${COUNTISH.source}\\s*[<>]=?\\s*${COUNTISH.source}`,
);

/**
 * 选源上下文信号：比较只有出现在这些词附近才算「选源」。
 *
 * **这是目录级登记必须配的东西**：「计数比较」本身太常见（压缩体积、校验上限、
 * 插件数量……都是合法的），只有落在「哪个是事实源 / 回落 / prefer / fromDb」
 * 这类上下文里才是 2026-10-30 那个 bug。2026-10-30 目录级首版实测 12 处里
 * 11 处是误报，就是没配这个。
 */
export const SOURCE_CONTEXT = /source|prefer|fallback|fromDb|fromKv|useDb|readFrom|供数|事实源|回落|影子|切读/i;

/** 判定窗口：比较前后各多少行内出现选源信号即算命中 */
const CONTEXT_LINES = 6;

/** 剥注释（填空格保偏移），避免注释里的示例被判成违规 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (s) => s.replace(/[^\n]/g, " "));
}

/**
 * 纯函数：对一份源码找**落在选源上下文里**的计数比较。
 * 返回命中清单（行号 + 命中文本），便于测试断言。
 *
 * 两步：先找计数比较，再看它前后 `CONTEXT_LINES` 行内有没有 `SOURCE_CONTEXT` 信号。
 * 只做比较、不做控制流分析——够用，且不会把合法的长度校验误报进来。
 */
export function findCountComparisons(src) {
  const stripped = stripComments(src);
  const lines = stripped.split("\n");
  const hits = [];
  const re = new RegExp(COUNT_COMPARISON.source, "g");
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const line = stripped.slice(0, m.index).split("\n").length;
    const lo = Math.max(0, line - 1 - CONTEXT_LINES);
    const hi = Math.min(lines.length, line + CONTEXT_LINES);
    const window = lines.slice(lo, hi).join("\n");
    if (!SOURCE_CONTEXT.test(window)) continue;
    // 显式豁免：`source-truth-ok: <理由>` 写在比较之前，表示这不是「选源」。
    // 典型场景：同源完整性检查（读到的条数 vs 期望条数）——那是防截断，不是选源。
    // 必须写理由，静默豁免等于把守卫变成摆设（与 cleanup-noop 同一套纪律）。
    // 豁免标记常写在注释里，所以要从**原文 src** 取。
    if (/source-truth-ok\s*:/.test(src.slice(Math.max(0, m.index - 200), m.index))) continue;
    hits.push({ line, text: m[0].trim() });
  }
  return hits;
}

/** 把一条登记解析成文件清单（支持 `file` 精确与 `dir` 递归两种写法） */
export function resolveRuleFiles(rule, root = ROOT) {
  if (rule.file) {
    const p = join(root, rule.file);
    return existsSync(p) ? [p] : [];
  }
  const base = join(root, rule.dir);
  if (!existsSync(base)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && (!rule.include || rule.include.test(e.name))) out.push(p);
    }
  };
  walk(base);
  return out.sort();
}

function main() {
  const asJson = process.argv.includes("--json");
  /**
   * `--changed`：只扫位置参数里给的文件，不扫登记目录全集。
   * pre-commit 用这个档——与 mock-hygiene 同一套纪律：
   * **pre-commit 的检查范围应当等于本次提交集**，全仓口径归全量测试。
   */
  const changedIdx = process.argv.indexOf("--changed");
  const useChanged = changedIdx !== -1;
  const norm = (p) => String(p).split("\\").join("/");
  const explicit = useChanged
    ? new Set(process.argv.slice(changedIdx + 1).filter((a) => !a.startsWith("--")).map(norm))
    : null;

  const all = [];
  let scanned = 0;
  for (const rule of SOURCE_TRUTH_FILES) {
    const files = resolveRuleFiles(rule).filter((p) => {
      if (!explicit) return true;
      const n = norm(p);
      return [...explicit].some((e) => n === e || n.endsWith("/" + e));
    });
    if (files.length === 0) {
      // `--changed` 过滤后这条规则与本次提交无关：静默跳过，不算「登记失效」。
      // 只有全量模式下空目录才是登记有问题。
      if (explicit) continue;
      all.push({ file: rule.file || rule.dir, error: "登记的文件/目录不存在或为空" });
      continue;
    }
    scanned += files.length;
    for (const p of files) {
      for (const h of findCountComparisons(readFileSync(p, "utf8"))) {
        all.push({ file: relative(ROOT, p), ...h });
      }
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ ok: all.length === 0, scanned, hits: all }, null, 2));
    process.exit(all.length === 0 ? 0 : 1);
  }

  if (all.length === 0) {
    console.log(`✅ 事实源判据：覆盖 ${scanned} 个文件，没有「按计数选源」的启发式` + (useChanged ? `（--changed：登记全集 ${SOURCE_TRUTH_FILES.length} 条规则里，与本次无关的已跳过）` : ``));
    return;
  }
  console.log(`❌ 事实源判据：${all.length} 处出现了「按计数/长度比较」来选源：`);
  for (const h of all) {
    if (h.error) {
      console.log(`   · ${h.file} → ${h.error}`);
      continue;
    }
    console.log(`   · ${h.file}:${h.line}  ${h.text}`);
  }
  console.log(
    `\n   为什么拦：影子副本的条数可能远多于正本（实测 KV 74 条 vs 表 5,578 条），` +
      `按条数多的那侧供数会返回站点上根本不存在的幻影数据。\n` +
      `   修法：把判据换成显式开关（如 resolveVideoStoreMode() === "db"` +
      ` 或 NAVHUB_* 环境变量），不要比大小。`,
  );
  process.exit(1);
}

const invokedDirectly = process.argv[1] && /check-source-truth\.mjs$/.test(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
