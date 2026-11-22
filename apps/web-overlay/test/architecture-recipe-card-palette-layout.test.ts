/**
 * U-392：搜索浮层内 Graph-RAG 配方卡桌面端不可读（分层行逐字竖排）。
 *
 * 根因：分层行 `flex flex-col sm:flex-row`，`sm:flex-row` 按视口宽度
 * （>=640px）触发，而该卡唯一挂载点是约 340px 宽的搜索浮层
 * （search-palette.tsx）。桌面视口下行内变横向，平替块（flex-shrink-0）
 * 抢占宽度，左块被压到约 60px，层名逐字竖排、描述只剩「- 行业…」、
 * 平替溢出面板右缘被截断。
 *
 * 修复：浮层内强制纵向（去掉 `sm:flex-row`）；左块加 `min-w-0 flex-1`；
 * 平替块去掉 `flex-shrink-0`、加 `flex-wrap` / `min-w-0`。
 * 本文件用结构断言守住这三点：任何让分层行按视口宽度翻横向的断点类
 * 回归，测试即变红。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
const CARD_REL = "src/components/architecture-recipe-card.tsx";
const CARD_SRC = readFileSync(join(ROOT, CARD_REL), "utf8");

function classTokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}

/** 分层行：`recipe.layers.map` 内带 `key={idx}` 的那层 div 的 className。 */
function layerRowClass(): string {
  const m = CARD_SRC.match(/key=\{idx\}\s+className="([^"]+)"/);
  if (!m) throw new Error("未找到分层行（key={idx} 的 div）");
  return m[1];
}

/** 左块：分层行内第一个含 `space-y-0.5` 的 div 的 className。 */
function leftBlockClass(): string {
  const m = CARD_SRC.match(/<div className="([^"]*space-y-0\.5[^"]*)"/);
  if (!m) throw new Error("未找到分层行左块（含 space-y-0.5 的 div）");
  return m[1];
}

/** 平替块：含 `<span>平替:</span>` 的 div 的 className。 */
function alternativesClass(): string {
  const m = CARD_SRC.match(/<div className="([^"]+)"[^>]*>\s*<span>平替:<\/span>/);
  if (!m) throw new Error("未找到平替块（含「平替:」的 div）");
  return m[1];
}

describe("U-392 配方卡分层行在搜索浮层内强制纵向", () => {
  it("分层行不含按视口宽度翻横向的断点类（sm:flex-row 等）", () => {
    const row = layerRowClass();
    const tokens = classTokens(row);
    expect(tokens).toContain("flex");
    expect(tokens).toContain("flex-col");
    const rowFlip = tokens.filter((t) => /^(sm|md|lg|xl|2xl):flex-row(-reverse)?$/.test(t));
    expect(rowFlip).toEqual([]);
    // 兜底：行 class 里不得出现任何带断点的 flex-row 写法
    expect(row).not.toMatch(/:flex-row/);
  });

  it("左块有 min-w-0 flex-1，不会被平替块压到约 60px 窄条", () => {
    const tokens = classTokens(leftBlockClass());
    expect(tokens).toContain("min-w-0");
    expect(tokens).toContain("flex-1");
  });

  it("平替块可换行、可收缩，不抢占左块宽度、不溢出面板右缘", () => {
    const tokens = classTokens(alternativesClass());
    expect(tokens).toContain("flex-wrap");
    expect(tokens).toContain("min-w-0");
    expect(tokens).not.toContain("flex-shrink-0");
  });

  it("挂载点唯一：全仓只有搜索浮层渲染该卡，纵向布局即覆盖全部渲染上下文", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          walk(p);
        } else if (/\.tsx?$/.test(entry.name) && p !== join(ROOT, CARD_REL)) {
          const src = readFileSync(p, "utf8");
          if (src.includes("<ArchitectureRecipeCard")) hits.push(p);
        }
      }
    };
    walk(join(ROOT, "src"));
    expect(hits).toHaveLength(1);
    expect(hits[0].replace(/\\/g, "/")).toContain("src/components/search-palette.tsx");
  });

  it("回归锚点：触发用例的配方数据仍在（react 关键词 / 全栈前端层名）", () => {
    const recipeSrc = readFileSync(join(ROOT, "src/lib/architecture-recipe.ts"), "utf8");
    expect(recipeSrc).toContain("1. 全栈前端与 SSR 框架");
    expect(recipeSrc).toContain("'react'");
  });
});
