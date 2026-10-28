import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 内容 JSON 的**严格**合法性守卫。
 *
 * 为什么 `JSON.parse` 不够：JSON 规范允许字符串里出现孤立代理码位
 * （`"\ud83d"` 单独一个高位代理），`JSON.parse` 会照收不误。但 Turbopack
 * 读 JSON 走的是 Rust 侧的 serde，**serde 拒绝孤立代理**，报：
 *
 *     Error: Unable to make a module from invalid JSON
 *     unexpected end of hex escape at line 69341 column 105
 *
 * 于是出现最糟的组合：所有 JS 测试全绿、`JSON.parse` 也 OK，**只有 `next build` 红**，
 * 而且报错指向一个看起来完全正常的字符串。
 *
 * 真实案例（2026-10-28）：一条视频描述末尾的 emoji 被截断，只剩 `\ud83d`，
 * 构建直接失败。这类损坏通常来自「写入被截断」（磁盘满 / 生成到一半中断），
 * 不会有人手写出来，所以必须由机器守。
 *
 * 判据（两条都要）：转义层面 `\uXXXX` 必须 4 位且代理成对；字符层面不得有孤儿代理。
 */
/**
 * 内容目录按**测试文件自身位置**解析，不依赖 cwd。
 *
 * vitest 从仓库根启动（配置在根），`process.cwd()` 是仓库根而不是 apps/web；
 * 而本文件在两个位置各有一份（overlay 源 / vendored 副本），
 * 它们到 `src/navsphere/content` 的相对路径恰好都是 `../src/navsphere/content`。
 */
const CONTENT_DIR_CANDIDATES = [
  fileURLToPath(new URL("../src/navsphere/content", import.meta.url)),
  join(process.cwd(), "apps", "web", "src", "navsphere", "content"),
  join(process.cwd(), "apps", "web-overlay", "src", "navsphere", "content"),
];

function resolveContentDir(): string {
  for (const dir of CONTENT_DIR_CANDIDATES) {
    try {
      readdirSync(dir);
      return dir;
    } catch {
      /* 换下一个候选 */
    }
  }
  throw new Error("找不到 navsphere/content 目录，候选：" + CONTENT_DIR_CANDIDATES.join(", "));
}

interface Problem {
  kind: string;
  line: number;
  sample: string;
}

/** 扫描一段文本里的非法转义与孤儿代理 */
export function findJsonUnicodeProblems(text: string): Problem[] {
  const problems: Problem[] = [];
  const lineOf = (idx: number) => text.slice(0, idx).split("\n").length;

  // 1) 转义层面
  const re = /\\u([0-9a-fA-F]{0,4})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1].length !== 4) {
      problems.push({ kind: "短转义", line: lineOf(m.index), sample: JSON.stringify(m[0]) });
      continue;
    }
    const cp = parseInt(m[1], 16);
    const after = m.index + 6;
    if (cp >= 0xd800 && cp <= 0xdbff) {
      // 高位代理必须紧跟一个 \uDC00–\uDFFF
      const nextIsEscape = text.slice(after, after + 2) === "\\" + "u";
      const low = nextIsEscape ? parseInt(text.slice(after + 2, after + 6), 16) : Number.NaN;
      if (!nextIsEscape || !(low >= 0xdc00 && low <= 0xdfff)) {
        problems.push({ kind: "孤立高位代理", line: lineOf(m.index), sample: JSON.stringify(m[0]) });
      }
    } else if (cp >= 0xdc00 && cp <= 0xdfff) {
      problems.push({ kind: "孤立低位代理", line: lineOf(m.index), sample: JSON.stringify(m[0]) });
    }
  }

  // 2) 字符层面（文件里直接存了未配对代理字符的情形）
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const isHigh = c >= 0xd800 && c <= 0xdbff;
    const isLow = c >= 0xdc00 && c <= 0xdfff;
    if (isHigh) {
      const n = text.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) {
        problems.push({ kind: "孤儿高位代理字符", line: lineOf(i), sample: "U+" + c.toString(16) });
      }
    } else if (isLow) {
      const p = text.charCodeAt(i - 1);
      if (!(p >= 0xd800 && p <= 0xdbff)) {
        problems.push({ kind: "孤儿低位代理字符", line: lineOf(i), sample: "U+" + c.toString(16) });
      }
    }
  }

  return problems;
}

describe("内容 JSON 必须能被严格解析器接受", () => {
  const dir = resolveContentDir();
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

  it("目录里确实有内容文件（防空跑）", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file}：无孤立代理转义，且 JSON.parse 通过`, () => {
      const text = readFileSync(join(dir, file), "utf8");
      const problems = findJsonUnicodeProblems(text);
      expect(
        problems,
        `${file} 存在 ${problems.length} 处会让 next build 失败的孤立代理：` +
          problems
            .slice(0, 5)
            .map((p) => `L${p.line} ${p.kind} ${p.sample}`)
            .join("; ") +
          " —— JSON.parse 能过，但 Turbopack 的 serde 会拒绝（unexpected end of hex escape）",
      ).toEqual([]);

      expect(() => JSON.parse(text), `${file} 不是合法 JSON`).not.toThrow();
    });
  }
});
