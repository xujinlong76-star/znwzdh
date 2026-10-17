/**
 * 吞掉失败的 `catch` 必须**写明理由**。
 *
 * 这个仓库过去一路是「失败就静默」：解析挂了、存储满了、接口挂了，全都 catch 一下就
 * 当没发生。系列里前面的 PR 已经按主题逐个修掉了「会误导用户」的那批
 * （#61 撤销失败却说成功、#59 复制失败却说已复制、#64/#66/#67 表单与无障碍……），
 * 这一条守的是**剩下的那批为什么可以吞** —— 可以吞，但必须在代码里说清理由。
 *
 * 规则（钉死在 0 处）：
 *   `catch {}` / `catch (e) {}` / `.catch(() => {})` 这类**块里一句话都没有**的 catch，
 *   块内必须有一条注释说明为什么这么吞是安全的。
 *   块里有语句（哪怕只是 `console.warn`）就算「有处理」，不在此列。
 *
 * 说明两点范围（刻意留有边界）：
 *   - 注释与字符串内容会先被「挖空」再匹配，所以文档示例里的 `catch {}`
 *     （见 `lib/telemetry-status.ts` 顶部那段真实缺陷摘录）不会被误报；
 *     同理，`app/layout.tsx` 里内联脚本那段模板字符串（SW/Cache 清理）
 *     属于另一段程序，本守卫看不到，也就不在管辖内。
 *   - 有回退值、且该回退值会被调用方消费的写法（如 `await res.json().catch(() => ({}))`）
 *     不算「吞掉失败」：失败被转换成一个调用方要处理的值。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/");
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay");
  };
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = overlayRoot();

/** 把注释与字符串/模板串的内容挖成空格：长度与换行保持，便于用下标回读原文 */
function maskSource(src: string): string {
  const out = src.split("");
  const n = src.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };
  let i = 0;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === quote) break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** 从 `{` 找配对的 `}` */
function matchBrace(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export interface SilentCatch {
  /** 原始源码里的下标（catch 关键字） */
  index: number;
  body: string;
  hasStatement: boolean;
  hasComment: boolean;
  /** 表达式形态的空操作（`.catch(() => undefined)`）：结构上根本没地方写理由 */
  exprNoop: boolean;
}

/** 表达式形态的空操作：没有块，理由无处可写，必须改成带理由的块 */
const EXPR_NOOP = /\.catch\s*\(\s*\(\s*\)\s*=>\s*(?:undefined|null|void\s+0|false|0)\s*\)/g;

export function findSilentCatches(src: string): SilentCatch[] {
  const masked = maskSource(src);
  const found: SilentCatch[] = [];
  const seen = new Set<number>();
  const patterns = [
    /catch\s*(?:\([^)]*\))?\s*\{/g,
    /\.catch\s*\(\s*(?:\(\s*[^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g,
    /\.catch\s*\(\s*function\s*[^(]*\([^)]*\)\s*\{/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked))) {
      const braceIdx = masked.indexOf("{", m.index + m[0].length - 1);
      if (braceIdx === -1) continue;
      if (seen.has(braceIdx)) continue;
      const end = matchBrace(masked, braceIdx);
      if (end === -1) continue;
      seen.add(braceIdx);
      const maskedBody = masked.slice(braceIdx + 1, end);
      const body = src.slice(braceIdx + 1, end);
      found.push({
        index: m.index,
        body,
        hasStatement: maskedBody.replace(/[{}\s;]/g, "").length > 0,
        hasComment: /\/\/|\/\*/.test(body),
        exprNoop: false,
      });
    }
  }
  EXPR_NOOP.lastIndex = 0;
  let em: RegExpExecArray | null;
  while ((em = EXPR_NOOP.exec(masked))) {
    found.push({
      index: em.index,
      body: em[0],
      hasStatement: false,
      hasComment: false,
      exprNoop: true,
    });
  }
  return found;
}

const lineOf = (src: string, index: number) => src.slice(0, index).split(/\r?\n/).length;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

describe("扫描器本身是对的（否则守卫只是空跑）", () => {
  it("抓得住：块里一句话都没有的 catch", () => {
    const bad = ["try {", "  risky()", "} catch {", "}"].join("\n");
    const hits = findSilentCatches(bad);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hasStatement).toBe(false);
    expect(hits[0]!.hasComment).toBe(false);
  });

  it("抓得住：.catch(() => {}) 与 .catch(function () {})", () => {
    expect(findSilentCatches("fetch('/a').catch(() => {})")).toHaveLength(1);
    expect(findSilentCatches("fetch('/a').catch(function () {})")).toHaveLength(1);
    expect(findSilentCatches("fetch('/a').catch(function (err) {})")).toHaveLength(1);
  });

  it("不误报：块里写了理由", () => {
    const good = ["try {", "  risky()", "} catch {", "  // 只是尽力清理，失败无影响", "}"].join("\n");
    const hits = findSilentCatches(good);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hasComment).toBe(true);
  });

  it("不误报：块里有语句（哪怕只打一条日志）", () => {
    const handled = ["try {", "  risky()", "} catch (err) {", "  console.warn('failed', err)", "}"].join("\n");
    const hits = findSilentCatches(handled);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hasStatement).toBe(true);
  });

  it("不误报：注释里的 catch 例子（文档/说明）", () => {
    const doc = [
      "/**",
      " * 真实缺陷长这样：",
      " *   try { parse() } catch {}",
      " */",
      "export const a = 1",
    ].join("\n");
    expect(findSilentCatches(doc)).toHaveLength(0);
  });

  it("不误报：字符串里的 catch（内联脚本那类）", () => {
    const script = "const html = `try { x() } catch {}`";
    expect(findSilentCatches(script)).toHaveLength(0);
  });

  it("不误报：把失败转成回退值交给调用方消费", () => {
    expect(findSilentCatches("const body = await res.json().catch(() => ({}))")).toHaveLength(0);
  });

  it("抓得住：表达式形态的空操作（没地方写理由）", () => {
    const hits = findSilentCatches("void send('/api/events').catch(() => undefined)");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.exprNoop).toBe(true);
  });
});

describe("吞掉失败的 catch 都要写明理由", () => {
  const files = sourceFiles(join(ROOT, "src"));

  it("确实扫到了源码（不是扫了空目录）", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("这条规则确实被用上了（写理由的地方至少两位数）", () => {
    let withReason = 0;
    for (const f of files) {
      for (const c of findSilentCatches(readFileSync(f, "utf8"))) {
        if (!c.hasStatement && c.hasComment) withReason++;
      }
    }
    expect(withReason).toBeGreaterThanOrEqual(18);
  });

  it("0 处「吞掉失败却没写理由」", () => {
    const problems: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const c of findSilentCatches(src)) {
        if (c.exprNoop) {
          problems.push(
            `${relative(ROOT, f).replace(/\\/g, "/")}:${lineOf(src, c.index)}  ${c.body}  ← 表达式空操作写不下理由，请改成 .catch(() => { /* 为什么可以吞 */ })`
          );
          continue;
        }
        if (c.hasStatement || c.hasComment) continue;
        problems.push(
          `${relative(ROOT, f).replace(/\\/g, "/")}:${lineOf(src, c.index)}  ${c.body.replace(/\s+/g, " ").trim() || "{ }"}`
        );
      }
    }
    expect(
      problems,
      "这些 catch 把失败吞掉了，却没写为什么可以吞：\n" + problems.join("\n")
    ).toHaveLength(0);
  });
});
