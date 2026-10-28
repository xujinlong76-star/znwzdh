/**
 * 章节起始秒必须走 `chapterStartSec()`，不许裸读 `xxx.startTime`。
 *
 * 背景（见 `apps/web-overlay/src/types/navigation.ts` 里 VideoChapter 的注释）：
 * 章节的起始秒历史上是两套字段并存 —— 上游旧结构写 `timeSec`，AI 摘要与采集器写
 * `startTime`。两套同义但只有一套有值，所以任何「直接读 startTime」的调用点在
 * 遇到只有 `timeSec` 的章节时会拿到 undefined：
 *   - 脑图节点的 timeSec 变 undefined → 点节点跳不回对应位置；
 *   - 代码演进里程碑的兜底 id 变成 `ms-1-undefined` → 两次生成的 key 互撞。
 * 这两处在 2026-10-28 已改为归一读取，本守卫钉住的是「别再加第三处」。
 *
 * 范围刻意留边界（不宣称覆盖所有 `.startTime`）：
 *   只有一条与 VideoChapter 无关的同名属性确实合法（PerformanceEntry.startTime、
 *   动画计时器的 state.startTime、以及自建章节骨架里必填的 startTime），
 *   它们进例外清单并写清理由；新增豁免必须带理由，否则宁可归一。
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
const SRC = join(ROOT, "src");

/** 把注释与字符串内容挖成空格（保留长度与换行），避免文档里的例子被当成读点 */
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
      let k = i + 1;
      while (k < n) {
        if (src[k] === "\\") {
          k += 2;
          continue;
        }
        if (src[k] === ch) break;
        if (ch !== "`" && src[k] === "\n") break;
        k++;
      }
      blank(i, Math.min(k + 1, n));
      i = k + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** 裸读点：`.startTime` 前面是点（属性读取），对象字面量里的 `startTime:` 不算 */
const RAW_READ = /\.(startTime)\b/g;

function rawReads(src: string): number[] {
  const masked = maskSource(src);
  const hits: number[] = [];
  RAW_READ.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RAW_READ.exec(masked)) !== null) hits.push(m.index);
  return hits;
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

/**
 * 例外清单（相对 overlay 根，条数与命中数都钉死；条目失效就会被第 3 条断言拦下）。
 */
const ALLOWLIST: Record<string, string> = {
  "src/types/navigation.ts": "归一化事实源本身：字段声明与 chapterStartSec 的实现",
  "src/lib/video-ai-summary.ts":
    "chapters 由本函数自己构造（startTime 必填后才回填 endTime），不是外部 VideoChapter 的读点",
  "src/lib/video-filmstrip-generator.ts":
    "入参是自有结构 { startTime: number }（必填），调用方在边界归一：video-player-page 传 chapterStartSec(ch)",
  "src/components/web-vitals-reporter.tsx":
    "PerformanceEntry.startTime（LCP/FCP 指标），与 VideoChapter 无关",
  "src/components/modular/modular-canvas.tsx":
    "动画计时器的 state.startTime（毫秒时间戳），与 VideoChapter 无关",
};

/** 归一调用点的下限：守卫不能只是空跑，归一化必须真的在被用 */
const MIN_NORMALIZER_CALLS = 15;

describe("裸读扫描器本身是对的（否则守卫只是空跑）", () => {
  it("抓得住：属性读取形态的 ch.startTime", () => {
    expect(rawReads("const t = ch.startTime + 1;")).toHaveLength(1);
  });

  it("不误报：走归一化的写法", () => {
    expect(rawReads("const t = chapterStartSec(ch);")).toHaveLength(0);
  });

  it("不误报：对象字面量里的字段写入", () => {
    expect(rawReads("push({ startTime: m.offset, title })")).toHaveLength(0);
  });

  it("不误报：注释与字符串里的例子", () => {
    expect(rawReads("// 读取 ch.startTime 会拿到 undefined\n/* ch.startTime */\n")).toHaveLength(0);
    expect(rawReads('const s = "ch.startTime";')).toHaveLength(0);
  });

  it("确实扫到了源码（不是扫了空目录）", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(200);
  });
});

describe("章节起始秒一律归一", () => {
  const files = sourceFiles(SRC);

  it("例外清单之外的裸读为 0 处", () => {
    const offenders: string[] = [];
    for (const abs of files) {
      const rel = relative(ROOT, abs).replace(/\\/g, "/");
      if (ALLOWLIST[rel]) continue;
      const src = readFileSync(abs, "utf8");
      for (const idx of rawReads(src)) {
        const line = lineOf(src, idx);
        offenders.push(`${rel}:${line} ${src.split(/\r?\n/)[line - 1].trim().slice(0, 70)}`);
      }
    }
    expect(offenders, "这些读点绕过了 chapterStartSec()：\n" + offenders.join("\n")).toHaveLength(0);
  });

  it("例外清单不陈旧：每条此刻都还有命中", () => {
    const stale: string[] = [];
    for (const [rel, why] of Object.entries(ALLOWLIST)) {
      const abs = join(ROOT, rel);
      expect(why, `${rel} 的豁免必须写理由`).toBeTruthy();
      if (!existsSync(abs)) {
        stale.push(`${rel}（文件已不存在）`);
        continue;
      }
      if (rawReads(readFileSync(abs, "utf8")).length === 0) stale.push(`${rel}（已无裸读，该删掉豁免）`);
    }
    expect(stale, "这些豁免已经不成立，请一并清理：\n" + stale.join("\n")).toHaveLength(0);
  });

  it("归一化真的在被使用（调用点不少于下限）", () => {
    let calls = 0;
    for (const abs of files) {
      const rel = relative(ROOT, abs).replace(/\\/g, "/");
      if (rel === "src/types/navigation.ts") continue;
      calls += (readFileSync(abs, "utf8").match(/chapterStartSec\(/g) || []).length;
    }
    expect(calls).toBeGreaterThanOrEqual(MIN_NORMALIZER_CALLS);
  });
});

describe("归一语义（timeSec 优先、回落 startTime、皆无为 0）", () => {
  const mod = () => import(join(ROOT, "src", "types", "navigation.ts"));

  it("两套都有值时取 timeSec", async () => {
    const { chapterStartSec } = await mod();
    expect(chapterStartSec({ title: "t", timeSec: 12, startTime: 3 })).toBe(12);
  });

  it("只有 startTime 时取 startTime（AI 摘要与采集器写的那一套）", async () => {
    const { chapterStartSec } = await mod();
    expect(chapterStartSec({ title: "t", startTime: 45 })).toBe(45);
  });

  it("只有 timeSec 时不再是 undefined —— 这正是裸读丢掉的值", async () => {
    const { chapterStartSec } = await mod();
    expect(chapterStartSec({ title: "t", timeSec: 90 })).toBe(90);
  });

  it("两者皆无为 0", async () => {
    const { chapterStartSec } = await mod();
    expect(chapterStartSec({ title: "t" })).toBe(0);
  });
});
