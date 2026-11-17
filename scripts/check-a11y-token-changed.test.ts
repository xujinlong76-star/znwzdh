import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BADGE_ADJACENT_RE,
  BADGE_INNER_RE,
  BADGE_QUOTE_RE,
  PATTERNS,
  assessFiles,
  badgeRecipeHits,
  changedSourceFiles,
  countMatches,
  parseExempt,
} from "./check-a11y-token-changed.mjs";

/**
 * a11y-token-changed 的元测试：闸门本身不能比守卫更宽松，也不能悄悄漂移。
 *
 * 防漂移分两层（R7 的另一半）：
 *   1. 5 条禁令的正则与守卫 a11y-token-contrast.test.ts 里的原文逐字一致——
 *      守卫改了禁令、脚本没同步时这层先红；
 *   2. 豁免清单不硬编码：脚本每次从守卫文件解析 WIP_HOT_EXEMPT，这里钉住
 *      解析结果与守卫清单一致（已知条目在、非清单文件不在）。
 * 守卫断言本身一行不改；这里只钉「脚本 = 守卫的增量等价物」。
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = join(ROOT, "apps/web-overlay/test/a11y-token-contrast.test.ts");
const guardSource = readFileSync(GUARD, "utf8");

describe("元测试：5 条禁令的正则与守卫原文逐字一致", () => {
  it("脚本恰好有 5 条禁令（多一条少一条都是口径漂移）", () => {
    expect(PATTERNS.map((p) => p.id)).toEqual([
      "border-input",
      "text-muted-foreground/N",
      "badge-recipe",
      "text-destructive",
      "bg-destructive/10",
    ]);
  });

  it("4 条正则禁令的原文逐字出现在守卫文件里", () => {
    for (const p of PATTERNS) {
      if (p.re === null) continue;
      expect(guardSource, `${p.id} 的正则 ${p.re} 应逐字出现在守卫文件里`).toContain(p.re.source);
    }
  });

  it("徽章旧配方移植的三条正则原文逐字出现在守卫 badgeRecipeHits() 里", () => {
    for (const re of [BADGE_ADJACENT_RE, BADGE_QUOTE_RE, BADGE_INNER_RE]) {
      expect(guardSource, `徽章正则 ${re} 应逐字出现在守卫文件里`).toContain(re.source);
    }
  });

  it("徽章配方动态断言带词边界：text-red-6000 不命中（锁定 \\b）", () => {
    expect(badgeRecipeHits('className="bg-red-500/10 text-red-6000"')).toHaveLength(0);
  });
});

describe("元测试：豁免清单与守卫同一份来源", () => {
  it("解析出非空清单，且已知热区条目在列", () => {
    const exempt = parseExempt(guardSource);
    expect(exempt.size).toBeGreaterThan(0);
    expect(exempt.has("app/search/page.tsx")).toBe(true);
    expect(exempt.has("components/video-card.tsx")).toBe(true);
  });

  it("非清单文件不在豁免里（批 C 的文件必须被扫到）", () => {
    const exempt = parseExempt(guardSource);
    expect(exempt.has("components/plugins/plugin-taps-modal.tsx")).toBe(false);
    expect(exempt.has("components/plugins/plugin-url-health-panel.tsx")).toBe(false);
  });

  it("守卫里没有清单定义时抛错，不静默当成「无豁免」", () => {
    expect(() => parseExempt("const X = 1;\n")).toThrow("WIP_HOT_EXEMPT");
  });
});

describe("每条禁令：命中违例样本，不命中修复后样本", () => {
  it("border-input：命中旧类名，不命中 border-border-strong", () => {
    expect(countMatches('className="border border-input"', /\bborder-input\b/g)).toHaveLength(1);
    expect(countMatches('className="border border-border-strong"', /\bborder-input\b/g)).toHaveLength(0);
  });

  it("text-muted-foreground/N：命中透明度变体，不命中无变体写法", () => {
    expect(countMatches('className="text-muted-foreground/60"', /text-muted-foreground\/\d+/g)).toHaveLength(1);
    expect(countMatches('className="text-muted-foreground"', /text-muted-foreground\/\d+/g)).toHaveLength(0);
  });

  it("text-destructive：命中旧类名，不命中 -text / -foreground 合法写法", () => {
    const re = /text-destructive(?!-foreground|-text)/g;
    expect(countMatches('<X className="h-3 w-3 text-destructive" />', re)).toHaveLength(1);
    expect(countMatches('className="text-destructive-text"', re)).toHaveLength(0);
    expect(countMatches('className="text-destructive-foreground"', re)).toHaveLength(0);
  });

  it("bg-destructive/10：命中旧底色，不命中提档后的 /15", () => {
    expect(countMatches('className="bg-destructive/10"', /bg-destructive\/10\b/g)).toHaveLength(1);
    expect(countMatches('className="bg-destructive/15"', /bg-destructive\/10\b/g)).toHaveLength(0);
  });

  it("徽章旧配方：相邻与非相邻共现都命中，text-*-700 不命中", () => {
    // 相邻共现会被两条分支各计一次（与守卫 badgeRecipeHits 同款双计，计数只用于
    // 有无判定与基线求差，两侧同一函数所以差值不受影响）：
    expect(badgeRecipeHits('className="bg-red-500/10 text-red-600"')).toHaveLength(2);
    expect(badgeRecipeHits('className="bg-red-500/10 border text-red-600"')).toHaveLength(1);
    expect(badgeRecipeHits('className="bg-red-500/10 text-red-700"')).toHaveLength(0);
    expect(badgeRecipeHits('className="bg-red-500/10"')).toHaveLength(0);
  });
});

describe("changedSourceFiles：只扫本次改动的 overlay 源码", () => {
  const exempt = new Set(["app/search/page.tsx"]);
  it("只留 apps/web-overlay/src 下的 .ts/.tsx", () => {
    expect(
      changedSourceFiles(
        [
          "apps/web-overlay/src/components/a.tsx",
          "apps/web-overlay/src/lib/b.ts",
          "apps/web-overlay/src/styles/globals.css",
          "apps/web/src/components/c.tsx",
          "apps/api/src/d.ts",
          "package.json",
        ],
        exempt,
      ),
    ).toEqual(["components/a.tsx", "lib/b.ts"]);
  });

  it("豁免清单内的文件跳过（与守卫同一口径）", () => {
    expect(changedSourceFiles(["apps/web-overlay/src/app/search/page.tsx"], exempt)).toEqual([]);
  });
});

describe("assessFiles：只拦新引入，基线已有的放行", () => {
  it("新文件带违例 → 新引入 1 处", () => {
    const { fresh, inherited } = assessFiles([
      { rel: "components/new.tsx", head: 'className="bg-destructive/10"', base: null },
    ]);
    expect(fresh).toEqual([
      { rel: "components/new.tsx", id: "bg-destructive/10", count: 1, fix: expect.any(String) },
    ]);
    expect(inherited).toEqual([]);
  });

  it("基线已有 1 处、HEAD 仍 1 处 → 继承，不算新引入（批 C 反例的对照）", () => {
    const src = 'className="bg-destructive/10"';
    const { fresh, inherited } = assessFiles([{ rel: "components/old.tsx", head: src, base: src }]);
    expect(fresh).toEqual([]);
    expect(inherited).toEqual([{ rel: "components/old.tsx", id: "bg-destructive/10", count: 1 }]);
  });

  it("HEAD 2 处、基线 1 处 → 只拦多出的 1 处", () => {
    const { fresh, inherited } = assessFiles([
      {
        rel: "components/grew.tsx",
        head: 'className="bg-destructive/10 bg-destructive/10"',
        base: 'className="bg-destructive/10"',
      },
    ]);
    expect(fresh).toEqual([
      { rel: "components/grew.tsx", id: "bg-destructive/10", count: 1, fix: expect.any(String) },
    ]);
    expect(inherited).toEqual([{ rel: "components/grew.tsx", id: "bg-destructive/10", count: 1 }]);
  });

  it("本次删掉的文件（head 为 null）不扫", () => {
    const { fresh, inherited } = assessFiles([
      { rel: "components/deleted.tsx", head: null, base: 'className="bg-destructive/10"' },
    ]);
    expect(fresh).toEqual([]);
    expect(inherited).toEqual([]);
  });

  it("干净文件不产生任何记录", () => {
    const { fresh, inherited } = assessFiles([
      { rel: "components/clean.tsx", head: 'className="bg-destructive/15 text-destructive-text"', base: null },
    ]);
    expect(fresh).toEqual([]);
    expect(inherited).toEqual([]);
  });
});
