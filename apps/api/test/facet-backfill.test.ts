/**
 * A3 分面回填（facet-backfill.ts + seed/storage 挂钩）：
 *  1. 服务直调：缺失 pricing 按「覆盖表 > 规则 > unknown」补齐，platform 补 web；
 *  2. 已有 pricing（管理员手标）永不覆盖；
 *  3. 快照整包写回（writeNavigationData）后新站自动获得 pricing——这是导入
 *     通道的正规接入点，钉住它防止将来重构把挂钩弄丢。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { backfillDerivedFacets } from "../src/facet-backfill.ts";
import { writeNavigationData } from "../src/storage.ts";

const dir = mkdtempSync(join(tmpdir(), "navhub-facet-backfill-"));
let ctx: AppContext;

beforeAll(async () => {
  ctx = await createContext(
    loadConfig({
      mode: "lite" as const,
      embedding: { model: "m", endpoint: "https://hf-mirror.com", dtype: "q8" as const, cacheDir: join(dir, "models"), dim: 512, enabled: false },
      sqlitePath: join(dir, "facets.db"),
      corsOrigins: ["*"],
    }),
  );
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function pricingOf(id: string): Promise<string[] | undefined> {
  const site = await ctx.repo.getSite(id);
  return site?.facets?.pricing;
}

describe("backfillDerivedFacets 服务", () => {
  it("覆盖表/规则/unknown 三路补齐 + platform=web，已有值不覆盖", async () => {
    const cat = await ctx.repo.createCategory({ title: "回填测试类目" });
    const byOverride = await ctx.repo.createSite({
      url: "https://www.dramaboxdb.com",
      title: "DramaBox",
      description: "海外短剧平台",
      categoryId: cat.id,
    });
    const byRule = await ctx.repo.createSite({
      url: "https://rule-tool.example.com",
      title: "规则命中工具",
      description: "一个开源的本地小工具",
      categoryId: cat.id,
    });
    const unknownSite = await ctx.repo.createSite({
      url: "https://mystery-tool.example.com",
      title: "神秘工具",
      description: "一款工具",
      categoryId: cat.id,
    });
    const manual = await ctx.repo.createSite({
      url: "https://manual-tool.example.com",
      title: "人工标注工具",
      description: "一款工具",
      categoryId: cat.id,
      facets: { pricing: ["paid"] },
    });

    const sites = await ctx.repo.listAllSites(undefined, {});
    const report = await backfillDerivedFacets(ctx, sites);

    expect(await pricingOf(byOverride.id)).toEqual(["freemium"]);
    expect(await pricingOf(byRule.id)).toEqual(["open_source"]);
    expect(await pricingOf(unknownSite.id)).toEqual(["unknown"]);
    expect(await pricingOf(manual.id)).toEqual(["paid"]);
    expect(report.bySource.override).toBeGreaterThanOrEqual(1);
    expect(report.bySource.rule).toBeGreaterThanOrEqual(1);
    expect(report.bySource.unknown).toBeGreaterThanOrEqual(1);
    expect(report.alreadyLabeled).toBeGreaterThanOrEqual(1);

    const platformOf = async (id: string) => (await ctx.repo.getSite(id))?.facets?.platform;
    expect(await platformOf(unknownSite.id)).toContain("web");

    // 幂等：再跑一遍不应新增任何 pricing（全部已标注，含 unknown）
    const again = await backfillDerivedFacets(ctx, await ctx.repo.listAllSites(undefined, {}));
    expect(again.filledPricing).toBe(0);
  });
});

describe("writeNavigationData 快照写回挂钩", () => {
  it("整包导入后新站自动获得 pricing（覆盖表命中 + 未标注）", async () => {
    const snapshot = {
      navigationItems: [
        {
          id: "cat-a3-import",
          title: "A3 导入类目",
          items: [
            { id: "site-reelshort", title: "ReelShort", href: "https://www.reelshort.com", description: "海外短剧平台", enabled: true, tags: ["短剧"] },
            { id: "site-novel-new", title: "新小说站", href: "https://brand-new-novel.example.com", description: "网络小说阅读", enabled: true, tags: ["小说"] },
          ],
        },
      ],
    } as never;
    await writeNavigationData(ctx, snapshot);
    expect(await pricingOf("site-reelshort")).toEqual(["freemium"]);
    expect(await pricingOf("site-novel-new")).toEqual(["unknown"]);
  });
});
