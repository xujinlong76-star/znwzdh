/**
 * P1-4 闸门守卫：机器写入路径不得自建类目。
 *
 * 背景（类目树升级方案 §一 P8）：AI 富化 / MCP create_site 的建议名一旦在树里
 * 找不到就 `createCategory` 建一个**根**。模型每自由发挥一次，树顶就多一根柱子，
 * 装包时代因此长到 106 个平铺根。现在它们只能落「未分类」+ 产 category_gap 提案。
 *
 * 这里用源码扫描而不是行为断言：那两条链路要联网抓取（enrichUrl），
 * 行为测试在 CI 里不可靠；而「不许调用建类方法」本身就是可静态检查的承诺。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** 机器（AI/MCP/投稿）写入点：都不允许自建类目 */
const GATED_FILES = [
  "apps/api/src/routes/enrich.ts",
  "apps/api/src/routes/sites.ts",
  "packages/mcp/src/handlers/sites.ts",
];

/** 建类目的三个入口：直接建、按标题 ensure、快照 upsert */
const FORBIDDEN = [/\bcreateCategory\s*\(/, /\bensureCategory\s*\(/];

describe("AI / MCP 写入路径不自动建类目", () => {
  for (const rel of GATED_FILES) {
    it(`${rel} 不调用 createCategory / ensureCategory`, () => {
      const text = readFileSync(join(ROOT, rel), "utf8");
      for (const pattern of FORBIDDEN) {
        const line = text.split(/\r?\n/).findIndex((l) => pattern.test(l) && !l.trim().startsWith("*"));
        expect(line, `${rel} 仍含 ${pattern}（第 ${line + 1} 行）`).toBe(-1);
      }
    });
  }

  it("落点统一是固定 id 的「未分类」，并记账成提案", () => {
    for (const rel of GATED_FILES) {
      const text = readFileSync(join(ROOT, rel), "utf8");
      expect(text, `${rel} 应回退到 ensureUncategorized()`).toContain("ensureUncategorized()");
      expect(text, `${rel} 应产出 category_gap 提案`).toContain("recordCategoryGap");
    }
  });

  it("人工入口（类目管理路由）仍然可以建类目", () => {
    // 闸门只针对机器写入：admin 的显式创建是有意为之，别被这条测试误伤
    const text = readFileSync(join(ROOT, "apps/api/src/routes/categories.ts"), "utf8");
    expect(text).toContain("ctx.repo.createCategory");
  });
});
