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
import { comparePluginVersions, resolveSiteIcon, validateAndCleanPluginManifest, canonicalJsonStringify, ECOSYSTEM_MAP, ecosystemUrlKey, type SiteRelation } from "@navhub/core";
import { loadConfig } from "./config.ts";
import { createContext, type AppContext } from "./context.ts";
import { indexPluginsBatch, indexItemFromManifest } from "./index-plugin.ts";
import { seedPluginDefs } from "./seed-plugins.ts";
import { DEFAULT_SITE_CONFIG, writeSiteConfig } from "./storage.ts";

/**
 * 重复 URL 的「描述择优」门槛：新描述至少比库里那条长这么多字才覆盖。
 *
 * 10 字是经验值——小于这个差值的改动多是标点/措辞微调，覆盖收益接近零，
 * 却会白白产生一次写库与一次 updated_at 变更（进而影响 sitemap 的 lastmod）。
 */
const DESCRIPTION_IMPROVE_MARGIN = 10;

/**
 * 重复 URL 是否该用新描述覆盖旧描述（纯函数，便于单测）。
 *
 * 只比长度，不比内容：种子描述都是人工写的一句话，没有可靠的语义信号可用；
 * 长度是这里唯一可验证的「信息量」代理指标。空描述永远被覆盖（除非新描述也空）。
 */
export function shouldImproveDescription(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): boolean {
  const before = (existing ?? "").trim();
  const after = (incoming ?? "").trim();
  if (!after) return false;
  // 从「没有描述」到「有描述」是量级差异，不该被长度门槛挡住
  if (!before) return true;
  // source-truth-ok: 描述长度对比是「描述是否变好」的判定，与数据源选择无关
  return after.length > before.length + DESCRIPTION_IMPROVE_MARGIN;
}

interface SeedShape {
  /** 只剩兜底类目：整棵树由 CATEGORY_REGISTRY 播种，种子清单不再声明层级 */
  categories: Array<{ id: string; title: string; slug?: string; icon?: string; description?: string; sort?: number; source?: string }>;
  sites: Array<{ url: string; title: string; description: string; categorySlug: string; tags?: string[]; icon?: string; facets?: Record<string, string[]> }>;
  collections?: Array<{
    slug: string;
    title: string;
    kind: string;
    description: string;
    sites: Array<string | { site: string; note?: string; sort?: number }>;
  }>;
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

/**
 * 把 packages/core/src/ecosystem.ts 里手工策划的「平替雷达」落进 site_relations。
 *
 * 为什么要有这一步：策划的边**从来没有进过库**（2026-10-31 实测 site_relations 0 行），
 * 面板之所以还显示得出来，靠的是读路径上的内存兜底——rowToSite（packages/store/src/repository/dialect.ts:78）
 * 拿 getEnhancedSiteData 现算一份塞进 site.relations，getDetailedSiteRelations 再兜回去。
 * 线上直证 `GET /api/sites/<GitHub>/relations`：2 条 alternative 全是 `id: undefined`、
 * `targetSiteId: undefined`。后果有三个：
 *   1. 前端 alternatives 区块（apps/web-overlay/src/components/site-detail-view.tsx）只在有
 *      targetSiteId 时才渲染 `<Link>`，
 *      于是 GitLab / Obsidian 这些**库里明明有**的平替只能当纯文本，点不进站内详情页；
 *   2. 反向关系（incoming）的推导要 target_site_id 有值，所以平替页永远看不到「谁把我当平替」；
 *   3. 兜底只在表为空时生效，运营在 PUT /api/sites/:id/relations 里编辑一次，
 *      那条站点的策划平替就整批消失。
 * 而 events 的零结果计量里 `chatgpt 平替`×5、`figma 平替`×1、`notion 平替`×1 要的恰恰是这份数据
 * （2026-10-31 本机库；同一词的计数会随探针自增，别拿它当可复现的断言）。
 *
 * 两条克制：
 * 1. **表里已有出边的源站让路**（判据查 site_relations 的真实行数，不能用 getDetailedSiteRelations
 *    ——它的兜底会把 ECOSYSTEM_MAP 自己算出来，于是每个策划源站都被当成「运营编辑过」，一条都写不进）。
 *    PUT 是手工编辑通道，种子不能把人工编辑的边覆盖回去（与合集那段 listCollectionSites().length === 0 同形）。
 * 2. **目标站不在库里也照样落边**。target_site_id 为空只是「点不进站内详情页」，
 *    面板仍然看得到这条平替与其 URL；与其悄悄丢掉，不如数出来（danglingTargets）——缺的是收录，不是数据。
 */
export interface EcosystemSeedResult {
  /** 落进 site_relations 的边数 */
  written: number;
  /** 源站本身不在库里、整条策划边没落地的 ECOSYSTEM_MAP 键 */
  missingSources: string[];
  /** 目标站不在库里的边（形如 `cursor.com → https://continue.dev`） */
  danglingTargets: string[];
  /** site_relations 里已有出边、按「不覆盖运营编辑」让路的源站数 */
  preserved: number;
}

/** 只需要这两个方法；用临时库单测时不必造完整仓储 */
type RelationRepo = Pick<AppContext["repo"], "raw" | "setSiteRelations">;

export async function seedEcosystemRelations(
  repo: RelationRepo,
  sites: Array<{ id: string; url: string }>,
): Promise<EcosystemSeedResult> {
  const result: EcosystemSeedResult = { written: 0, missingSources: [], danglingTargets: [], preserved: 0 };

  /**
   * 按「host + path」定位串建索引，而不是拿 findSiteByUrl 逐条查：
   * 库里同一产品常有 `https://www.continue.dev/` 这种带 www / 带尾斜杠的形态，
   * 而 ECOSYSTEM_MAP 写的是 `continue.dev`——逐条精确查会把它们误报成「站外目标」。
   * 同一定位串有多条 URL 形态时取最短的那条当产品本身（少一层路径 = 更像首页）。
   */
  const byKey = new Map<string, { id: string; url: string }>();
  for (const site of sites) {
    const key = ecosystemUrlKey(site.url);
    if (!key) continue;
    const current = byKey.get(key);
    if (!current || site.url.length < current.url.length) byKey.set(key, site);
  }

  for (const [key, data] of Object.entries(ECOSYSTEM_MAP)) {
    const curated = data.relations ?? [];
    if (curated.length === 0) continue;
    const source = byKey.get(ecosystemUrlKey(`https://${key}`) ?? "");
    if (!source) {
      result.missingSources.push(key);
      continue;
    }
    const existing = (await repo.raw("SELECT COUNT(*) AS n FROM site_relations WHERE source_site_id = ?", [
      source.id,
    ])) as unknown as Array<{ n: number }>;
    if (Number(existing[0]?.n ?? 0) > 0) {
      result.preserved++;
      continue;
    }
    const relations: SiteRelation[] = [];
    for (const rel of curated) {
      const target = byKey.get(ecosystemUrlKey(rel.targetUrl) ?? "");
      if (!target) result.danglingTargets.push(`${key} → ${rel.targetUrl}`);
      relations.push({ ...rel, targetSiteId: target?.id ?? null });
    }
    await repo.setSiteRelations(source.id, relations);
    result.written += relations.length;
  }
  return result;
}

export interface SeedResult {
  categories: number;
  /** 权威树播种结果（18 根 + 全部叶子）；total 是树规模，不是本次写入数 */
  registry: { total: number; created: number; patched: number; failed: string[] };
  sites: number;
  collections: number;
  plugins: number;
  /** 本次把已存在插件升级到新清单的条数（版本号更高或内容有变化） */
  pluginsUpgraded: number;
  skipped: number;
  /**
   * 重复 URL 中「后到包描述更完整、已用新描述覆盖」的条数。
   *
   * 与 skipped 互斥：同一条要么被跳过，要么被择优覆盖。生产集 5845 条里有
   * 1093 条是重复条目，此前一律丢弃后到的那份——如果后到包的描述更好，
   * 这条信息就永久丢了。
   */
  improved: number;
  embedded: number;
  siteConfigSeeded: boolean;
  /** 平替雷达（ECOSYSTEM_MAP）的落地账 */
  ecosystem: EcosystemSeedResult;
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

  // 权威树先落地：站点直接挂叶子（一级根只作导航，不挂站点），
  // 所以「库里有 6 个平铺根」那种老种子形态必须被整棵树取代。
  const registry = await ctx.repo.seedCategoryRegistry();
  if (registry.failed.length > 0) {
    console.warn(`[seed] 权威树有 ${registry.failed.length} 条没落进库：${registry.failed.join("、")}`);
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
  let improved = 0;
  let embedded = 0;
  const leafIdBySlug = new Map<string, string>();
  const wantsEmbeddings = opts.withEmbeddings ?? true;

  for (const s of raw.sites) {
    const dup = await ctx.repo.findSiteByUrl(s.url);
    if (dup) {
      /**
       * 同一 URL 已在库：**择优保留**，不再无条件丢弃后到的那份。
       *
       * 背景：29 个 site-pack 共 5845 条，其中 1093 条是重复 URL（同一站点被
       * 多个垂类包同时收录）。原实现命中即 `skipped++; continue`，等于
       * 「先到先得」——后到包里那句更完整的描述被永久丢弃，而站点的描述质量
       * 直接决定它详情页的正文厚度（生产集中位数只有 23 字）。
       *
       * 只覆盖 description，**不覆盖分类/标签**：分类归属在包之间来回变会让
       * 分类页的站点集合抖动（revalidate 窗口内站点从 A 类消失），比描述差
       * 一点更伤；标签同理，跨包合并会污染标签计数。
       *
       * 门槛 `+10` 字：避免「改两个标点」这种无意义写入把 improved 刷虚。
       */
      const incoming = (s.description ?? "").trim();
      const existing = (dup.description ?? "").trim();
      if (shouldImproveDescription(existing, incoming)) {
        await ctx.repo.updateSite(dup.id, { description: s.description });
        improved++;
      } else {
        skipped++;
      }
      continue;
    }
    let categoryId = leafIdBySlug.get(s.categorySlug);
    if (!categoryId) {
      const leaf = await ctx.repo.getCategoryBySlug(s.categorySlug);
      if (leaf) {
        categoryId = leaf.id;
      } else {
        categoryId = await ctx.repo.ensureUncategorized();
        console.warn(`[seed] 种子站点「${s.title}」的分类「${s.categorySlug}」不在权威树里，落未分类`);
      }
      leafIdBySlug.set(s.categorySlug, categoryId);
    }
    const site = await ctx.repo.createSite({
      url: s.url, title: s.title, description: s.description,
      categoryId, tags: s.tags ?? [], source: "seed",
      iconKey: resolveSiteIcon(s.url, s.title, s.icon),
      // 轴外移的落地面：授权/场景等不再建类目，改由分面承接（方案 P5）
      facets: s.facets,
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
      const existing = await ctx.repo.getCollectionBySlug(col.slug);
      if (existing) {
        const currentSites = await ctx.repo.listCollectionSites(col.slug);
        if (currentSites.length === 0 && col.sites && col.sites.length > 0) {
          for (const s of col.sites) {
            const siteRef = typeof s === "string" ? s : s.site;
            const note = typeof s === "object" && s.note ? s.note : undefined;
            const sort = typeof s === "object" && typeof s.sort === "number" ? s.sort : undefined;
            const site = await ctx.repo.getSite(siteRef);
            if (site) {
              await ctx.repo.addCollectionItem(existing.id, site.id, note, sort);
            }
          }
        }
        continue;
      }
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
            author: validated.manifest.author ?? "山羊胡官方",
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
      // 与后台「在线同步种子插件」同一口径：键序不同不等于内容变了。
      const contentChanged =
        canonicalJsonStringify(existing.manifest) !== canonicalJsonStringify(validated.manifest);
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
      console.info(`[seed] 插件升级: ${def.slug} ${existing.version} -> ${validated.manifest.version}`);
      continue;
    } catch (err) {
      console.warn("[seed] 插件导入跳过: " + def.slug, err);
    }
  }

  // 平替雷达放在最后：站点包（5845 条）此时已全部落地，目标站的可解析率最高
  const siteRows = (await ctx.repo.raw("SELECT id, url FROM sites WHERE deleted_at IS NULL")) as unknown as Array<{
    id: string;
    url: string;
  }>;
  const ecosystem = await seedEcosystemRelations(ctx.repo, siteRows);
  if (ecosystem.missingSources.length > 0) {
    console.warn(`[seed] 平替雷达有 ${ecosystem.missingSources.length} 个源站不在库里，策划边整条没落地：${ecosystem.missingSources.join("、")}`);
  }
  if (ecosystem.danglingTargets.length > 0) {
    console.warn(`[seed] 平替雷达有 ${ecosystem.danglingTargets.length} 条目标站不在库里（面板显示但点不进站内）：${ecosystem.danglingTargets.join("、")}`);
  }

  await ctx.close();
  return { categories, registry, sites, collections, plugins, pluginsUpgraded, skipped, improved, embedded, siteConfigSeeded, ecosystem };
}

/**
 * 注意：这里**不做** "是否作为主模块运行" 的判断。
 * Windows 上 process.argv[1] 与 import.meta.url 的形式（盘符大小写、斜杠方向）不一定一致，
 * 这种判断曾经让脚本静默退出且无任何输出。
 * CLI 入口统一放在 seed-main.ts。
 */