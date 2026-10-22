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
import { comparePluginVersions, resolveSiteIcon, validateAndCleanPluginManifest } from "@navhub/core";
import { loadConfig } from "./config.ts";
import { createContext } from "./context.ts";
import { indexPluginsBatch, indexItemFromManifest } from "./index-plugin.ts";
import { seedPluginDefs } from "./seed-plugins.ts";
import { DEFAULT_SITE_CONFIG, writeSiteConfig } from "./storage.ts";

interface SeedShape {
  categories: Array<{ id: string; title: string; slug?: string; icon?: string; description?: string; sort?: number; source?: string }>;
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
  plugins: number;
  /** 本次把已存在插件升级到新清单的条数（版本号更高或内容有变化） */
  pluginsUpgraded: number;
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
    const declared = (c.slug ?? "").trim().toLowerCase();
    const existing = await ctx.repo.getCategory(c.id);
    if (existing) {
      // 种子声明的 slug 优先于启动回填生成的兜底 slug（回填只会产出拼音全拼）。
      // 路由已上线，为什么还敢覆盖：这条口子里的 slug 只可能是机器生成的——
      // HTTP 层改标题不重写 slug（见 routes/categories.ts 的 PATCH），
      // 人工整理走 registry/迁移脚本并显式传 slug，那些行不在 raw.categories 里。
      // 已发布的 URL 形态因此不会每次重启漂移。
      if (declared && existing.slug !== declared && !(await ctx.repo.getCategoryBySlug(declared))) {
        await ctx.repo.updateCategory(c.id, { slug: declared });
      }
      continue;
    }
    await ctx.repo.createCategory({
      id: c.id,
      title: c.title,
      slug: declared || undefined,
      icon: c.icon ?? null,
      description: c.description ?? null,
      sort: c.sort ?? categories,
      source: c.source ?? null,
    });
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
      iconKey: resolveSiteIcon(s.url, s.title, s.icon),
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

  let plugins = 0;
  let pluginsUpgraded = 0;
  // 组合包依赖「成员已存在」：先插入非组合包，再插入组合包。
  // 否则种子清单里 bundle 排在成员前面时，会因成员不存在而整包被拒（真实发生过的顺序陷阱）。
  const defs = seedPluginDefs();
  const orderedDefs = [
    ...defs.filter((d) => (d.manifest as { kind?: string } | null)?.kind !== "bundle"),
    ...defs.filter((d) => (d.manifest as { kind?: string } | null)?.kind === "bundle"),
  ];
  for (const def of orderedDefs) {
    try {
      const existing = await ctx.repo.getPluginBySlug(def.slug);
      if (!existing) {
        const validated = validateAndCleanPluginManifest(def.manifest);
        if (!validated.ok) {
          console.warn("[seed] 插件清单不合法，跳过: " + def.slug + " -> " + validated.errors.join("; "));
          continue;
        }
        const created = await ctx.repo.createPlugin(
          {
            manifest: validated.manifest,
            author: validated.manifest.author ?? "NavHub 官方",
            authorKind: "seed",
            source: "seed",
            status: def.status,
            slug: def.slug,
          },
          { actor: "seed", actorKind: "system" },
        );
        if (def.status === "published") {
          // 与审核 / 导入同一条索引路径：种子数据上语义检索开箱即用
          await indexPluginsBatch(ctx, [indexItemFromManifest(created.slug, created.manifest)]);
        }
        plugins++;
        continue;
      }

      // 已存在：只在「种子清单更新了」时才升级，否则保持库内现状（幂等）。
      // 以前这里是直接 continue，导致升级后的商用级内容永远进不了已播种的库。
      const validated = validateAndCleanPluginManifest(def.manifest);
      if (!validated.ok) {
        console.warn("[seed] 插件清单不合法，跳过升级: " + def.slug + " -> " + validated.errors.join("; "));
        continue;
      }
      const versionBumped = comparePluginVersions(validated.manifest.version, existing.version) > 0;
      const contentChanged = JSON.stringify(existing.manifest) !== JSON.stringify(validated.manifest);
      if (!versionBumped && !contentChanged) continue;
      await ctx.repo.updatePlugin(def.slug, validated.manifest, { actor: "seed", actorKind: "system" });
      if (def.status === "published") {
        // updatePlugin 会让插件回到待审（作者提交新版本的同一条规则）；
        // 种子数据属于可信系统来源，直接审核上架，让升级内容立刻可用。
        await ctx.repo.reviewPlugin(def.slug, "approve", "种子数据升级自动上架", {
          actor: "seed",
          actorKind: "system",
        });
        await indexPluginsBatch(ctx, [indexItemFromManifest(def.slug, validated.manifest)]);
      }
      pluginsUpgraded++;
      console.log(`[seed] 插件升级: ${def.slug} ${existing.version} -> ${validated.manifest.version}`);
      continue;
    } catch (err) {
      console.warn("[seed] 插件导入跳过: " + def.slug, err);
    }
  }

  await ctx.close();
  return { categories, sites, collections, plugins, pluginsUpgraded, skipped, embedded, siteConfigSeeded };
}

/**
 * 注意：这里**不做** "是否作为主模块运行" 的判断。
 * Windows 上 process.argv[1] 与 import.meta.url 的形式（盘符大小写、斜杠方向）不一定一致，
 * 这种判断曾经让脚本静默退出且无任何输出。
 * CLI 入口统一放在 seed-main.ts。
 */