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
import { UNCATEGORIZED_SLUG, isRegistryLeaf, isRegistryRoot } from "@navhub/core";
import { allSeedPluginDefs } from "../src/seed-data/index.ts";

interface SeedShape {
  sites: Array<{ url: string; title?: string; categorySlug?: string; facets?: Record<string, string[]> }>;
  collections: Array<{
    slug: string;
    title: string;
    description: string;
    sites: Array<string | { site: string }>;
  }>;
}

const raw = JSON.parse(
  readFileSync(new URL("../src/seed-data.json", import.meta.url), "utf8"),
) as SeedShape;

describe("P5 轴外移：落到合集与分面，而不是新建类目", () => {
  it("每个合集的站点引用都能在种子站点里找到（否则导入时被静默跳过）", () => {
    const urls = new Set(raw.sites.map((s) => s.url));
    for (const collection of raw.collections) {
      const missing = collection.sites
        .map((entry) => (typeof entry === "string" ? entry : entry.site))
        .filter((url) => !urls.has(url));
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

/**
 * G2「站点只挂叶子」在种子这一层的账。
 *
 * 为什么要在内容层补一条：`checkSiteCategoryAttachment` 是**故意**只接在 HTTP 写入口的
 * （packages/store/src/repository/categories.ts:234 的注释写明「仓储写路径保持宽松」，
 * 迁移脚本与 SKOS 导出要能直挂根），所以 seed.ts 里 createSite 不会拒绝一级根。
 * 结果是一条挂错的种子站点照样落库、照样计数，但一级根在导航里只做展开——
 * 这个站在分类页上永远看不到，运营看到的是「库里有这条」，用户看到的是「搜不到」。
 *
 * 2026-10-31 补收录 19 条时真的踩到了：4 条写成 office-productivity / developer-resources
 * （两个一级根），POST /api/sites 当场 400 拒绝，而 seed 这条路会一声不吭地收下。
 */
describe("种子站点的分类必须挂在权威树的叶子上（G2）", () => {
  it("先确认真的读到了分类字段（否则空集合会假装通过）", () => {
    const withSlug = raw.sites.filter((s) => String(s.categorySlug ?? "").trim());
    expect(withSlug.length, "种子站点几乎都没有 categorySlug——这条测试等于没有断言").toBeGreaterThan(50);
  });

  it("没有任何种子站点挂在一级根上", () => {
    const roots = raw.sites
      .filter((s) => isRegistryRoot(String(s.categorySlug ?? "")))
      .map((s) => `${s.categorySlug} ← ${s.url}`);
    expect(roots, `这些站点挂在一级根上，分类页看不到：${roots.join("、")}`).toEqual([]);
  });

  it("分类 slug 能在权威树里解析（拼错的会静默落进「未分类」）", () => {
    const unknown = raw.sites
      .map((s) => String(s.categorySlug ?? "").trim())
      .filter((slug) => slug && slug !== UNCATEGORIZED_SLUG && !isRegistryLeaf(slug))
      .filter((slug, i, arr) => arr.indexOf(slug) === i);
    expect(unknown, `这些 categorySlug 不是权威树的叶子：${unknown.join("、")}`).toEqual([]);
  });
});
