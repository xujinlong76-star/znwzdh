/**
 * 站点包内容必须能被权威树接住（P2a 覆盖率契约）。
 * 2026-11-15：34 个 site-packs 已卸载——下面按包内人口算的断言只断言人口为 0，安装用例改为全装剩余种子。
 *
 * 为什么单独锁这一条：29 个包声明了 536 个类目标题，安装时若解析不出，
 * 站点会静默落进「未分类」——**安装仍然返回成功**，但归类全丢。
 * 今天 962 条回收站站点的 category_id 全悬空，起点就是这种「表面成功」。
 *
 * 所以这里断言的是 100%：每个包声明的分类、每条站点引用的分类，
 * 都要能解析到一个**叶子**（一级根不能挂站点）。缺口只允许是
 * registry 里明确记了去向的退役名（RETIRED_TAXONOMY_NAMES）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RETIRED_TAXONOMY_NAMES,
  resolveRegistryEntry,
  resolveRegistryLeaf,
  validateAndCleanPluginManifest,
} from "@navhub/core";
import { loadConfig } from "../src/config.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { seedPluginDefs } from "../src/seed-plugins.ts";
interface PackShape {
  slug: string;
  manifest: {
    kind: string;
    payload?: {
      categories?: Array<{ title: string }>;
      sites?: Array<{ url: string; title: string; category?: string; subCategory?: string }>;
    };
  };
}

const packs = seedPluginDefs()
  .map((d) => d as unknown as PackShape)
  .filter((d) => d.manifest.kind === "site-pack");

describe("站点包已卸载 → registry 解析守卫（2026-11-15 uninstall-4839）", () => {
  // 2026-11-15：34 个 site-packs 已卸载，注册表里不应再有 site-pack；
  // 下面三条按包内人口算的检查（分类落叶子、去重标题归宿）人口已清零，只断言人口为 0。
  it("站点包数量为 0：34 个网址包已删干净", () => {
    expect(packs).toHaveLength(0);
  });

  it("包内站点人口为 0：引用分类的落叶子检查随包退役", () => {
    const bad: string[] = [];
    let refs = 0;
    for (const pack of packs) {
      const declared = new Set((pack.manifest.payload?.categories ?? []).map((c) => c.title));
      for (const site of pack.manifest.payload?.sites ?? []) {
        const title = (site.category ?? "").trim();
        if (!title) {
          bad.push(`${pack.slug} · ${site.title}：没有 category`);
          continue;
        }
        refs++;
        const leaf = resolveRegistryLeaf(title);
        if (!leaf) {
          const hit = resolveRegistryEntry(title);
          const reason = (RETIRED_TAXONOMY_NAMES as Record<string, string>)[title];
          bad.push(
            reason
              ? `${pack.slug} · ${title}：已退役名（${reason}）`
              : `${pack.slug} · ${title}：${hit ? `解析到一级根 ${hit.slug}，站点必须挂叶子` : "解析不到任何条目"}（声明于${declared.has(title) ? "包内" : "包外"}）`,
          );
        }
      }
    }
  expect(refs).toBe(0);
    expect(bad, `未解析 ${bad.length}/${refs}：\n${bad.slice(0, 30).join("\n")}`).toEqual([]);
  });

  it("包内声明分类人口为 0：落叶子与父级一致检查随包退役", () => {
    const bad: string[] = [];
    for (const pack of packs) {
      for (const category of pack.manifest.payload?.categories ?? []) {
        const leaf = resolveRegistryLeaf(category.title);
        if (!leaf) {
          bad.push(`${pack.slug} · ${category.title}：解析不到叶子`);
          continue;
        }
        const parentTitle = (category as { parentCategory?: string }).parentCategory;
        if (parentTitle) {
          const parent = resolveRegistryEntry(parentTitle);
          if (!parent || parent.slug !== leaf.parentSlug) {
            bad.push(`${pack.slug} · ${category.title}：声明父级 ${parentTitle}，registry 父级是 ${leaf.parentSlug}`);
          }
        }
      }
    }
  expect(packs.flatMap((p) => p.manifest.payload?.categories ?? [])).toHaveLength(0);
    expect(bad, bad.slice(0, 30).join("\n")).toEqual([]);
  });

  it("去重标题人口为 0：包内标题的归宿检查随包退役", () => {
    const titles = new Set<string>();
    for (const pack of packs) {
      for (const c of pack.manifest.payload?.categories ?? []) titles.add(c.title.trim());
      for (const s of pack.manifest.payload?.sites ?? []) {
        const t = (s.category ?? "").trim();
        if (t) titles.add(t);
      }
    }
    const unresolved = [...titles].filter((t) => !resolveRegistryLeaf(t) && !(RETIRED_TAXONOMY_NAMES as Record<string, string>)[t]);
    expect(unresolved, `未映射：${unresolved.join("、")}`).toEqual([]);
    // 2026-11-15：包内标题人口已清零（原实测口径：包内声明 538 条 / 去重 536 个标题）。
    expect(titles.size).toBe(0);
  });
});

/**
 * 真装一遍：静态解析通过 ≠ 落库正确。
 *
 * 安装路径是「标题 → registry 叶子 → 库里那一行」，中间任何一环（播种缺行、
 * 同父重名、slug 被占）都可能把站点扔进未分类，而接口照样返回成功。
 * 这里把剩余种子全装一遍，把「装完还在树外」变成红灯；原来按包内站点人口算的棘轮（站点总数 ≥3900、registry 根 18 个）随包退役。
 */
describe("种子余量真装一遍（落地口径）", () => {
  let dir: string;
  let ctx: AppContext;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-pack-install-"));
    const config = loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "api.db"),
      embedding: { model: "none", endpoint: "", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
      llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
      fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
      corsOrigins: ["*"],
    });
    ctx = await createContext(config);
    for (const def of seedPluginDefs()) {
      const validated = validateAndCleanPluginManifest(def.manifest);
      if (!validated.ok) throw new Error(`${def.slug} 夹具不合法：${validated.errors.join("; ")}`);
      await ctx.repo.createPlugin({ manifest: validated.manifest, status: def.status, slug: def.slug, source: "seed" });
    }
  }, 180_000);

  afterAll(async () => {
    try {
      await ctx?.close();
    } catch {
      // 关闭异常不阻塞清理
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows 偶发占用：临时目录留给系统清理
    }
  });

  it("种子余量全装完：零缺口、零 plugin:* 类目、零孤儿站点", async () => {
    const gaps: string[] = [];
    const mismatches: string[] = [];
  for (const def of seedPluginDefs()) {
      const result = await ctx.repo.installPlugin(def.slug, "user-pack-install");
      if (result.applied.categoryGaps?.length) gaps.push(...result.applied.categoryGaps.map((t) => `${def.slug} · ${t}`));
      if (result.applied.categoryParentMismatches?.length) {
        mismatches.push(...result.applied.categoryParentMismatches.map((t) => `${def.slug} · ${t}`));
      }
    }
    expect(mismatches, mismatches.slice(0, 20).join("\n")).toEqual([]);
    expect(gaps, `缺口 ${gaps.length} 个：\n${gaps.slice(0, 20).join("\n")}`).toEqual([]);

    const minted = await ctx.repo.raw("SELECT id, title FROM categories WHERE source LIKE 'plugin:%'");
    expect(minted, `安装仍造了 plugin:* 类目：${minted.map((r) => r.title).join("、")}`).toEqual([]);

    // 站点必须挂在「有父级」的类目下（一级根不挂站点，G2 硬规则）
    const onRoot = await ctx.repo.raw(
      "SELECT COUNT(*) AS cnt FROM sites s JOIN categories c ON c.id = s.category_id WHERE s.source LIKE 'plugin:%' AND c.parent_id IS NULL",
    );
    expect(Number(onRoot[0].cnt)).toBe(0);
  // 2026-11-15：包内站点人口已清零——剩余种子（search-pack / theme / preset / bundle）不装站点，plugin:* 站点总数为 0。
  const total = await ctx.repo.raw("SELECT COUNT(*) AS cnt FROM sites WHERE source LIKE 'plugin:%'");
  expect(Number(total[0].cnt)).toBe(0);
    const orphan = await ctx.repo.raw(
      "SELECT COUNT(*) AS cnt FROM sites s WHERE s.source LIKE 'plugin:%' AND (s.category_id IS NULL OR NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = s.category_id))",
    );
    expect(Number(orphan[0].cnt)).toBe(0);
  // 2026-11-15：registry 根 18 个的棘轮随包退役——根是在装包时按需播种的，无包可装便不再播种。
  }, 300_000);
});
