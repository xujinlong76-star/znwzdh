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
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 登记表：哪些文件是「读路径的事实源选择处」。新增读路径时在这里登记一行。 */
export const SOURCE_TRUTH_FILES = [
  {
    file: "apps/api/src/storage.ts",
    why: "视频库读路径；事实源只能由 resolveVideoStoreMode() 决定",
  },
  {
    file: "apps/api/src/routes/videos.ts",
    why: "视频只读 API；表里有数据也不能改成用表",
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

/** 剥注释（填空格保偏移），避免注释里的示例被判成违规 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (s) => s.replace(/[^\n]/g, " "));
}

/**
 * 纯函数：对一份源码找违规的计数比较。
 * 返回命中清单（行号 + 命中文本），便于测试断言。
 */
export function findCountComparisons(src) {
  const stripped = stripComments(src);
  const hits = [];
  const re = new RegExp(COUNT_COMPARISON.source, "g");
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const line = stripped.slice(0, m.index).split("\n").length;
    hits.push({ line, text: m[0].trim() });
  }
  return hits;
}

function main() {
  const asJson = process.argv.includes("--json");
  const all = [];
  for (const rule of SOURCE_TRUTH_FILES) {
    const p = join(ROOT, rule.file);
    if (!existsSync(p)) {
      all.push({ file: rule.file, error: "登记的文件不存在" });
      continue;
    }
    for (const h of findCountComparisons(readFileSync(p, "utf8"))) {
      all.push({ file: rule.file, ...h });
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ ok: all.length === 0, hits: all }, null, 2));
    process.exit(all.length === 0 ? 0 : 1);
  }

  if (all.length === 0) {
    console.log(`✅ 事实源判据：${SOURCE_TRUTH_FILES.length} 个读路径都没有「按计数选源」的启发式`);
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
