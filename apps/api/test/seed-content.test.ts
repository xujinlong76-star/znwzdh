/**
 * 轴外移的落地物（方案 P5）：受众 / 授权 / 时效不再各立一根类目柱，
 * 而是分别落到「工作台预设」「facets.pricing」「合集」上。
 *
 * 这里锁的是**内容层**：合集引用的 URL 必须真的存在于种子站点，
 * 否则 upsertCollection 会静默跳过（不报错、页面少几项），
 * 而运营只会看到「合集是空的」却不知道原因。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allSeedPluginDefs } from "../src/seed-data/index.ts";

interface SeedShape {
  sites: Array<{ url: string; facets?: Record<string, string[]> }>;
  collections: Array<{ slug: string; title: string; description: string; sites: string[] }>;
}

const raw = JSON.parse(
  readFileSync(new URL("../src/seed-data.json", import.meta.url), "utf8"),
) as SeedShape;

describe("P5 轴外移：落到合集与分面，而不是新建类目", () => {
  it("每个合集的站点引用都能在种子站点里找到（否则导入时被静默跳过）", () => {
    const urls = new Set(raw.sites.map((s) => s.url));
    for (const collection of raw.collections) {
      const missing = collection.sites.filter((url) => !urls.has(url));
      expect(missing, `合集「${collection.title}」引用了不存在的站点：${missing.join(", ")}`).toEqual([]);
      expect(collection.sites.length, `合集「${collection.title}」站点过少`).toBeGreaterThanOrEqual(3);
    }
  });

  it("「开源」轴的落地物存在：合集 + pricing=open_source 分面", () => {
    expect(raw.collections.some((c) => c.slug === "open-source-alternatives")).toBe(true);
    expect(raw.collections.some((c) => c.slug === "editors-picks")).toBe(true);
    const openSourceSites = raw.sites.filter((s) => s.facets?.pricing?.includes("open_source"));
    expect(openSourceSites.length, "pricing=open_source 的种子站点过少，开源轴等于没有落地").toBeGreaterThanOrEqual(8);
  });

  it("三类受众都有工作台预设承接（受众名不进类目树）", () => {
    const presetNames = allSeedPluginDefs
      .map((def) => def.manifest as { kind?: string; name?: string })
      .filter((m) => m.kind === "workspace-preset")
      .map((m) => m.name ?? "");
    expect(presetNames.some((n) => n.includes("AI 智能体"))).toBe(true);
    expect(presetNames.some((n) => n.includes("内容创作者"))).toBe(true);
    expect(presetNames.some((n) => n.includes("投资"))).toBe(true);
  });
});
