/**
 * 批次 Q/R 回归（2026-11-06 深扫 P2-2）：SSRF 禁用端口表三方一致性。
 *
 * round 13 建立单一事实源（packages/core/src/ssrf-ports.ts）与漂移棘轮；
 * round 14 完成接线：ai 侧 import core 并集，web 侧数值副本对齐并集，漂移归零。
 *
 * 三方一致：
 *   packages/ai/src/ssrf.ts               → 引用 BLOCKED_PORTS_UNION（不再自维护字面量）
 *   apps/web-overlay/src/lib/ssrf-guard.ts → 数值副本必须与并集逐项相等
 *   packages/core/src/ssrf-ports.ts       → KNOWN_PORT_DRIFT 必须为空（差异已归零）
 *
 * ⚠️ 本文件**不 import @navhub/core**：apps/web 的 tsconfig paths 只映射 `@/*`，
 * 没有 `@navhub/core`（vitest 有别名、tsc 没有）。import 它会让前端 tsc 报 TS2307。
 * 因此这里改为**读源码 + 运行时解析常量**，与本目录其它校验型测试同构。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE_SSRF_PORTS = resolve(ROOT, "../../packages/core/src/ssrf-ports.ts");
const AI_SRC = readFileSync(resolve(ROOT, "../../packages/ai/src/ssrf.ts"), "utf8");
const WEB_SRC = readFileSync(resolve(ROOT, "src/lib/ssrf-guard.ts"), "utf8");
const CORE_SRC = readFileSync(CORE_SSRF_PORTS, "utf8");

/** 从 core 源码里解析出 BLOCKED_PORTS_UNION 的数值数组（不 import，避免 tsc 解析问题） */
function coreUnion(): number[] {
  // 两层锚定，缺一不可：
  //  ① 文档注释里也提到 BLOCKED_PORTS_UNION → 必须锚 "export const"；
  //  ② 声明是 `readonly number[] = Object.freeze([...])`，裸找 "[" 会命中类型里的
  //    `number[]`（实测 start=907/end=908，取到空串）→ 必须锚 "Object.freeze(["。
  const decl = CORE_SRC.indexOf("export const BLOCKED_PORTS_UNION");
  const frozen = CORE_SRC.indexOf("Object.freeze([", decl);
  const start = CORE_SRC.indexOf("[", frozen);
  const end = CORE_SRC.indexOf("]", start);
  const body = CORE_SRC
    .slice(start + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
  return [...body.matchAll(/\d{1,5}/g)]
    .map((m) => Number(m[0]))
    .filter((n) => n >= 1 && n <= 65535);
}

/** 从源码抽出 BLOCKED_PORTS 里的数字端口（先剥注释，避免把注释里的数字当端口） */
function extractPorts(src: string, anchor: string): number[] {
  const i = src.indexOf(anchor);
  if (i < 0) return [];
  const start = src.indexOf("[", i);
  const end = src.indexOf("]", start);
  if (start < 0 || end < 0) return [];
  const stripped = src
    .slice(start + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
  return [...stripped.matchAll(/\"?(\d{1,5})\"?/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 1 && n <= 65535);
}

describe("SSRF 端口单一事实源", () => {
  it("core 的 BLOCKED_PORTS_UNION 非空且含关键高危端口", () => {
    const union = coreUnion();
    expect(union.length).toBeGreaterThanOrEqual(40);
    for (const must of [22, 3306, 5432, 6379, 445]) {
      expect(union, must + " 应在并集内").toContain(must);
    }
  });

  it("core 导出了工具函数与漂移基线", () => {
    expect(CORE_SRC).toContain("normalizePort");
    expect(CORE_SRC).toContain("isBlockedPortUnion");
    expect(CORE_SRC).toContain("diffPortSets");
    expect(CORE_SRC).toContain("KNOWN_PORT_DRIFT");
  });
});

describe("端口表三方一致（round 14 已统一）", () => {
  it("ai 侧改为引用 core 并集，不再自维护字面量端口表", () => {
    expect(AI_SRC).toContain("BLOCKED_PORTS_UNION");
  });

  it("web 侧数值副本与 core 并集逐项相等", () => {
    const webPorts = extractPorts(WEB_SRC, "BLOCKED_PORTS");
    expect(webPorts.length).toBeGreaterThanOrEqual(40);
    expect([...new Set(webPorts)].sort((a, b) => a - b)).toEqual([...coreUnion()].sort((a, b) => a - b));
  });

  it("漂移基线已归零（KNOWN_PORT_DRIFT 两项均为空数组）", () => {
    const decl = CORE_SRC.indexOf("export const KNOWN_PORT_DRIFT");
    const block = CORE_SRC.slice(decl, decl + 400);
    expect(block).toContain("aiOnly");
    expect(block).toContain("webOnly");
    // 判据要剥注释：该片段范围内有「2026-11-06 round 14 已归零」这类日期文本，
    // 直接对原文匹配 \d{2,5} 会把年份当端口（实测误报）。
    const codeOnly = block
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    const seg = codeOnly.slice(codeOnly.indexOf("aiOnly"), codeOnly.indexOf("webOnly"));
    expect(seg).toContain("Object.freeze");
    // 空数组 = 不再有任何端口字面量
    expect(seg).not.toMatch(/\b\d{2,5}\b/);
  });

  it("高危端口必须被 web 侧副本禁用", () => {
    const webPorts = new Set(extractPorts(WEB_SRC, "BLOCKED_PORTS"));
    for (const must of [22, 3306, 5432, 6379, 445, 2181, 15672, 27019]) {
      expect(webPorts.has(must), must + " 应被 web 侧禁用").toBe(true);
    }
  });
});
