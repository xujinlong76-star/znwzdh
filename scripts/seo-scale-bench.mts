/**
 * 临时脚本：在独立 SQLite 库上跑「生产规模」种子，用于 SEO 规模实测。
 *
 * 用法（仓库根目录）：
 *   NAVHUB_SQLITE_PATH=./data/scale-test.db node scripts/tmp-scale-seed.mts
 *
 * 做三件事：
 *   1. runSeed() 落权威树 + seed-data.json 的 57 个基线站点；
 *   2. 安装全部 29 个 site-pack（生产内容真正来源），得到约 4752 个站点；
 *   3. 按 sitemap 的真实口径统计各分片条数，供规模实测对照。
 *
 * 不动 data/navhub.db：路径由 NAVHUB_SQLITE_PATH 决定。
 */
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const dbPath = process.env.NAVHUB_SQLITE_PATH ?? "./data/scale-test.db";
if (existsSync(dbPath)) rmSync(dbPath);
process.env.NAVHUB_SQLITE_PATH = dbPath;

const { runSeed } = await import("../apps/api/src/seed.ts");
const { loadConfig } = await import("../apps/api/src/config.ts");
const { createContext } = await import("../apps/api/src/context.ts");
const { seedPluginDefs } = await import("../apps/api/src/seed-plugins.ts");
const { installPlugin } = await import("../packages/store/src/repository/plugins.ts");
const { MIN_SITES_FOR_CATEGORY_INDEX, MIN_SITES_FOR_TAG_INDEX } = await import(
  "../apps/web-overlay/src/lib/seo/thresholds.ts"
);

const t0 = Date.now();
const seeded = await runSeed({ withEmbeddings: false });
console.log(`[scale] 种子完成 ${Date.now() - t0}ms`, JSON.stringify(seeded));

const config = loadConfig();
const ctx = await createContext(config);

// 只装 site-pack（search-pack / theme / preset 不产生站点）
const packs = seedPluginDefs().filter((d) => d.manifest.kind === "site-pack");
console.log(`[scale] 待安装 site-pack：${packs.length} 个`);

let added = 0;
let skipped = 0;
const t1 = Date.now();
for (const pack of packs) {
  try {
    const r = await installPlugin(ctx.repo, pack.slug, "scale-test");
    added += r.sitesAdded;
    skipped += r.sitesSkipped;
  } catch (err) {
    console.warn(`[scale] 安装失败 ${pack.slug}:`, (err as Error).message);
  }
}
console.log(`[scale] 安装完成 ${Date.now() - t1}ms：新增 ${added} / 跳过 ${skipped}`);

const one = async (sql: string, params: unknown[] = []): Promise<number> => {
  const rows = await ctx.repo.raw(sql, params);
  return Number((rows[0] as Record<string, unknown>)?.n ?? 0);
};

const activeSites = await one(
  "SELECT COUNT(*) AS n FROM sites WHERE deleted_at IS NULL AND enabled = 1 AND status = 'active'",
);
const totalSites = await one("SELECT COUNT(*) AS n FROM sites WHERE deleted_at IS NULL");
const categories = await one("SELECT COUNT(*) AS n FROM categories WHERE enabled = 1");
const collections = await one("SELECT COUNT(*) AS n FROM collections WHERE enabled = 1");
const plugins = await one("SELECT COUNT(*) AS n FROM plugins WHERE status = 'published'");

// 分类达标：叶子按自身计数，根按子树聚合（与 descendantSiteCounts 同口径的简化版）
const leafCounts = await ctx.repo.raw(
  `SELECT c.id AS id, c.parent_id AS parentId, COUNT(s.id) AS n
     FROM categories c
     LEFT JOIN sites s ON s.category_id = c.id
        AND s.deleted_at IS NULL AND s.enabled = 1 AND s.status = 'active'
    WHERE c.enabled = 1
    GROUP BY c.id`,
);
const countById = new Map<string, number>();
for (const row of leafCounts as Array<Record<string, unknown>>) {
  countById.set(String(row.id), Number(row.n ?? 0));
}
let qualifiedCategories = 0;
for (const row of leafCounts as Array<Record<string, unknown>>) {
  const id = String(row.id);
  const parentId = row.parentId ? String(row.parentId) : null;
  if (!parentId) {
    // 根：子树聚合
    let sum = 0;
    for (const child of leafCounts as Array<Record<string, unknown>>) {
      if (child.parentId && String(child.parentId) === id) sum += Number(child.n ?? 0);
    }
    if (sum >= MIN_SITES_FOR_CATEGORY_INDEX) qualifiedCategories++;
  } else if ((countById.get(id) ?? 0) >= MIN_SITES_FOR_CATEGORY_INDEX) {
    qualifiedCategories++;
  }
}

const tags = await ctx.repo.raw(
  `SELECT t.id AS id, COUNT(s.id) AS n
     FROM tags t
     LEFT JOIN site_tags st ON st.tag_id = t.id
     LEFT JOIN sites s ON s.id = st.site_id
        AND s.deleted_at IS NULL AND s.enabled = 1 AND s.status = 'active'
    GROUP BY t.id`,
);
const qualifiedTags = (tags as Array<Record<string, unknown>>).filter(
  (r) => Number(r.n ?? 0) >= MIN_SITES_FOR_TAG_INDEX,
).length;

const STATIC_URLS = 10; // / + /sites + /category + /hot + /tags + /collections + /graph + /algorithms + /videos + /submit
const estimate =
  STATIC_URLS + activeSites + qualifiedCategories + qualifiedTags + collections + plugins;

console.log(
  JSON.stringify(
    {
      db: resolve(dbPath),
      activeSites,
      totalSites,
      categories,
      qualifiedCategories,
      qualifiedTags,
      collections,
      plugins,
      sitemapUrlsEstimate: estimate,
      sitemapBytesEstimate: estimate * 190,
      elapsedMs: Date.now() - t0,
    },
    null,
    2,
  ),
);

await ctx.close();
