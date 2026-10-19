/**
 * 守卫：LLM 调用必须走统一网关（packages/ai/src/llm.ts）。
 *
 * 背景：网关收口了超时、鉴权头、JSON 模式兼容、错误归一化与 SSRF 校验。
 * 一旦有人在别处直接 fetch `/chat/completions`，这些保障会被绕过，
 * 且未来换模型供应商时要改 N 处。这里把「唯一出口」变成可执行的约束。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCAN_DIRS = ["packages", "apps/api/src", "apps/web-overlay/src"];
const ALLOWED = new Set(["packages/ai/src/llm.ts"]);
const TEXT_FILE = /\.(ts|tsx|mjs|cjs|js)$/;
/** 只匹配「字符串字面量形态」的终点路径，避免注释/文档里的路径误报 */
const NEEDLE = /["'`]\/chat\/completions["'`]/;
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".next", "public", "test", "__tests__"]);

function walk(relDir: string, out: string[] = []): string[] {
  const abs = join(ROOT, relDir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = relDir + "/" + entry;
    const stat = statSync(join(ROOT, rel));
    if (stat.isDirectory()) walk(rel, out);
    else if (TEXT_FILE.test(entry)) out.push(rel);
  }
  return out;
}

describe("LLM 网关唯一出口", () => {
  it("源码中除 packages/ai/src/llm.ts 外不得出现 /chat/completions 字面量", () => {
    const hits: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const rel of walk(dir)) {
        let text: string;
        try {
          text = readFileSync(join(ROOT, rel), "utf8");
        } catch {
          continue;
        }
        if (NEEDLE.test(text)) hits.push(rel);
      }
    }

    const offenders = hits.filter((rel) => !ALLOWED.has(rel));
    expect(offenders, "以下文件绕过了统一网关：\n" + offenders.join("\n")).toEqual([]);
    // 反向自检：扫描确实能命中网关本身（防止路径/扩展名过滤把规则变成空转）
    expect(hits).toContain("packages/ai/src/llm.ts");
  });

  it("调用方通过 chatCompletion/chatStream 进入网关", () => {
    const enrich = readFileSync(join(ROOT, "packages/ai/src/enrich.ts"), "utf8");
    expect(enrich).toContain("chatCompletion(");
    expect(enrich).not.toContain("fetch(llm.baseUrl");
  });
});
