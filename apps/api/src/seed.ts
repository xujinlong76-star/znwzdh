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
import { resolveSiteIcon } from "@navhub/core";
import { loadConfig } from "./config.ts";
import { createContext } from "./context.ts";
import { DEFAULT_SITE_CONFIG, writeSiteConfig } from "./storage.ts";

interface SeedShape {
  categories: Array<{ id: string; title: string; icon?: string; description?: string }>;
  sites: Array<{ url: string; title: string; description: string; categoryId: string; tags?: string[]; icon?: string }>;
  collections?: Array<{ slug: string; title: string; kind: string; description: string; sites: string[] }>;
}

/** 只读"库里是否真的存过站点配置"，不触发默认值回退 */
async function readStoredSiteConfig(ctx: { db: { dialect: string; sqlite?: unknown; pg?: unknown } }): Promise<unknown | null> {
  const db = ctx.db as {
    dialect: string;
    sqlite?: { prepare(sql: string): { get(...p: unknown[]): unknown } };
    pg?: { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> };
  };
  const KEY = "kv:site-config";
  if (db.dialect === "sqlite") {
    const row = db.sqlite!.prepare("SELECT payload FROM jobs WHERE id = ?").get(KEY) as { payload: string } | undefined;
    return row?.payload ? JSON.parse(row.payload) : null;
  }
  const res = await db.pg!.query("SELECT payload FROM jobs WHERE id = $1", [KEY]);
  const row = res.rows[0] as { payload: string } | undefined;
  return row?.payload ? JSON.parse(row.payload) : null;
}

export interface SeedResult {
  categories: number;
  sites: number;
  collections: number;
  skipped: number;
  embedded: number;
  siteConfigSeeded: boolean;
}

export async function runSeed(opts: { withEmbeddings?: boolean } = {}): Promise<SeedResult> {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(join(here, "seed-data.json"), "utf8")) as SeedShape;

  const config = loadConfig();
  const ctx = await createContext(config);

  /**
   * 站点全局配置：只在从未保存过时落库 NavHub 的品牌基线。
   *
   * 注意：中枢的 readSiteConfig() 在"未保存过"时会返回 DEFAULT_SITE_CONFIG，
   * 因此这里不能拿返回值判断"是否已保存"（永远会是基线值），
   * 而是直接检查库里的键值是否真的存在。
   */
  const storedConfig = await readStoredSiteConfig(ctx);
  let siteConfigSeeded = false;
  if (storedConfig === null) {
    await writeSiteConfig(ctx, structuredClone(DEFAULT_SITE_CONFIG) as unknown as Record<string, unknown>);
    siteConfigSeeded = true;
  }

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
      iconKey: s.icon ?? resolveSiteIcon(s.url, s.title),
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

  let collections = 0;
  for (const col of raw.collections ?? []) {
    try {
      await ctx.repo.upsertCollection({
        slug: col.slug,
        title: col.title,
        description: col.description,
        kind: (col.kind as any) ?? "topic",
        sites: col.sites,
        sort: collections,
      });
      collections++;
    } catch (err) {
      console.warn("专题导入跳过: " + col.slug, err);
    }
  }

  await ctx.close();
  return { categories, sites, collections, skipped, embedded, siteConfigSeeded };
}

/**
 * 注意：这里**不做** "是否作为主模块运行" 的判断。
 * Windows 上 process.argv[1] 与 import.meta.url 的形式（盘符大小写、斜杠方向）不一定一致，
 * 这种判断曾经让脚本静默退出且无任何输出。
 * CLI 入口统一放在 seed-main.ts。
 */