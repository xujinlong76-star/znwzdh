/**
 * 种子数据导入。
 *
 * 目标：docker compose up 之后立刻是一个"能用、看得出水平"的导航站，
 * 而不是一个空壳。数据全部为真实常用站点（中文优先）。
 *
 * 幂等：按 url 去重，重复执行不会产生副本。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { hashSiteId } from "@navhub/store";
import { siteEmbeddingText } from "@navhub/ai";
import { loadConfig } from "./config.ts";
import { createContext } from "./context.ts";

interface SeedShape {
  categories: Array<{ id: string; title: string; icon?: string; description?: string }>;
  sites: Array<{ url: string; title: string; description: string; categoryId: string; tags?: string[] }>;
  collections?: Array<{ slug: string; title: string; kind: string; description: string; sites: string[] }>;
}

export async function runSeed(opts: { withEmbeddings?: boolean } = {}): Promise<{ categories: number; sites: number; skipped: number; embedded: number }> {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(join(here, "seed-data.json"), "utf8")) as SeedShape;

  const config = loadConfig();
  const ctx = await createContext(config);

  let categories = 0;
  for (const c of raw.categories) {
    const existing = await ctx.repo.getCategory(c.id);
    if (existing) continue;
    await ctx.repo.createCategory({ id: c.id, title: c.title, icon: c.icon ?? null, description: c.description ?? null, sort: categories });
    categories++;
  }

  let sites = 0;
  let skipped = 0;
  let embedded = 0;
  const wantsEmbeddings = opts.withEmbeddings ?? true;

  for (const s of raw.sites) {
    const dup = await ctx.repo.findSiteByUrl(s.url);
    if (dup) { skipped++; continue; }
    const site = await ctx.repo.createSite({
      url: s.url, title: s.title, description: s.description,
      categoryId: s.categoryId, tags: s.tags ?? [], source: "seed",
    });
    sites++;

    if (wantsEmbeddings && ctx.embedding) {
      try {
        const vec = await ctx.embedding.encode(siteEmbeddingText({ title: site.title, description: site.description, url: site.url }));
        await ctx.vectors.upsert([{ key: hashSiteId(site.id), siteId: site.id, vector: vec }]);
        await ctx.repo.saveEmbedding(site.id, config.embedding.model, vec);
        embedded++;
      } catch {
        // 模型不可用不算失败：关键词/拼音/全文通道仍然可用
      }
    }
  }

  await ctx.close();
  return { categories, sites, skipped, embedded };
}

/**
 * 注意：这里**不做** "是否作为主模块运行" 的判断。
 * Windows 上 process.argv[1] 与 import.meta.url 的形式（盘符大小写、斜杠方向）不一定一致，
 * 这种判断曾经让脚本静默退出且无任何输出。
 * CLI 入口统一放在 seed-main.ts。
 */
