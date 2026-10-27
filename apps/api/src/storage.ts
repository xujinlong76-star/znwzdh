/**
 * 存储适配层：把 NavSphere 的「JSON 文件」语义翻译到 NavHub 的数据库语义。
 *
 * 背景（这是整个改造方案的关键）：
 *   NavSphere 全站的持久化只经过两个函数 ——
 *       getFileContent(path)             读文件
 *       commitFile(path, content, ...)   写文件
 *   数据落在 3 个 JSON：navigation.json / site.json / resource-metadata.json，
 *   共约 69 处调用点。
 *
 * 因此**不需要修改那 69 处**：只要在前端把这两个函数的实现换成"调用 NavHub API"，
 * 整个后台（增删改查、拖拽排序、投稿审核）就自动落到了真实数据库上。
 *
 * 本模块实现服务端一侧：以 path 为键，读写等价的 JSON 结构。
 */
import type { AppContext } from "./context.ts";
import { getEnhancedSiteData, resolveSiteIcon, type SiteAction, type SiteRelation, type SiteLiveMetrics, type SiteHealth } from "@navhub/core";
import { loadVideoCatalogFromDb, resolveVideoStoreMode, syncVideoCatalogSafely } from "./video-catalog.ts";

export const NAVIGATION_PATH = "src/navsphere/content/navigation.json";
export const SITE_PATH = "src/navsphere/content/site.json";
export const RESOURCE_PATH = "src/navsphere/content/resource-metadata.json";
export const DEFAULT_NAVIGATION_PATH = "src/navsphere/content/navigation-default.json";
export const VIDEOS_PATH = "src/navsphere/content/videos.json";

/** NavSphere 的站点项结构（= NavHub 的 site，扩展 4.0 动态特性） */
interface NsItem {
  id: string;
  title: string;
  href: string;
  description?: string;
  icon?: string;
  useDefaultIcon?: boolean;
  enabled: boolean;
  tags?: string[];
  actions?: SiteAction[];
  relations?: SiteRelation[];
  liveMetrics?: SiteLiveMetrics;
  workspaces?: string[];
  health?: SiteHealth;
}

interface NsSubCategory {
  id: string;
  title: string;
  icon?: string;
  description?: string;
  parentId?: string;
  enabled?: boolean;
  items?: NsItem[];
}

interface NsCategory {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  enabled?: boolean;
  items?: NsItem[];
  subCategories?: NsSubCategory[];
}

interface NsNavigationData { navigationItems: NsCategory[] }

/**
 * 单次导出 navigation.json 允许的最大站点数（防大库全表拉取 OOM，可通过 NAVHUB_NAVIGATION_MAX_SITES 调整）。
 */
const NAVIGATION_MAX_SITES = Math.max(100, Number(process.env.NAVHUB_NAVIGATION_MAX_SITES || 8000));

/* ------------------------------------------------------------------ *
 * 快照读缓存
 *
 * 背景：`/api/storage?path=navigation.json` 每次都会把「全部类目 + 全部站点
 * + 每站增强数据」重新组装一遍。站点规模小时（50 站 ≈ 15ms）无所谓，
 * 但这是全站唯一没有缓存的全量操作，成本随站点数线性增长，而首页
 * `force-dynamic` 会让每次访问都触发它。
 *
 * 失效策略（三层，任何一层命中都足够正确）：
 *   1. 任何成功的写请求（POST/PUT/PATCH/DELETE）由 server.ts 的 onResponse
 *      统一调用 invalidateSnapshotCache() —— 覆盖 /api/sites、/api/categories、
 *      /api/storage 等所有写入口，不依赖各路由自觉；
 *   2. writeStoragePath 内部再显式失效一次（防止将来有绕过 server hook 的调用）；
 *   3. TTL 兜底（默认 30s，NAVHUB_SNAPSHOT_TTL_MS 可调，0 表示关闭缓存），
 *      用于覆盖「另一个进程/实例直接改库」这类绕过 API 的场景。
 *
 * 多实例：缓存是进程内的，A 实例写入不会让 B 实例立即失效，最长滞后 TTL。
 * lite 模式（单实例）无此问题；standard 模式如需强一致，把 TTL 调小或关闭。
 * ------------------------------------------------------------------ */
const SNAPSHOT_TTL_MS = (() => {
  const raw = process.env.NAVHUB_SNAPSHOT_TTL_MS;
  if (raw === undefined || raw.trim() === "") return 30_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30_000;
})();

let snapshotCache: { data: NsNavigationData; expiresAt: number; fp: string } | null = null;

/**
 * 数据指纹：用一条聚合查询判断「库有没有变」。
 *
 * 为什么需要它：缓存失效不能只依赖 HTTP 写请求 —— 后台任务
 * （health_check 写健康列、recompute_rank 写热度分）以及测试/运维脚本
 * 都是直接调 Repository 的，不经过路由层。只靠 server 的 onResponse
 * 失效会让这些变更最长滞后一个 TTL。
 *
 * 代价：每次读取多一条聚合查询。SQLite 上是微秒级；PostgreSQL 在
 * 十万级行上 COUNT(*) 会退化为顺序扫描（几十毫秒），仍远低于全量重建，
 * 但如成为瓶颈，可把 NAVHUB_SNAPSHOT_TTL_MS 调小或改为版本号方案。
 *
 * 查询失败（老库缺列等）时返回空串：此时退化为「只靠 TTL + HTTP 失效」，
 * 不会因为指纹不可用而让整个快照接口报错。
 */
async function snapshotFingerprint(ctx: AppContext): Promise<string> {
  try {
    const rows = await ctx.repo.raw(
      `SELECT
         (SELECT COUNT(*) FROM sites) AS sn,
         (SELECT COALESCE(MAX(updated_at), 0) FROM sites) AS sm,
         (SELECT COUNT(*) FROM categories) AS cn,
         (SELECT COALESCE(MAX(updated_at), 0) FROM categories) AS cm,
         (SELECT COUNT(*) FROM site_tags) AS tn`,
    );
    const r = rows[0] ?? {};
    return [r.sn, r.sm, r.cn, r.cm, r.tn].join(":");
  } catch {
    return "";
  }
}

/** 让下一次读取重建快照。写路径与 server 的 onResponse 都会调用。 */
export function invalidateSnapshotCache(): void {
  snapshotCache = null;
}

/** 供 /api/health 与测试观察缓存状态（不参与业务）。 */
export function snapshotCacheInfo(): { cached: boolean; ttlMs: number } {
  return { cached: snapshotCache !== null, ttlMs: SNAPSHOT_TTL_MS };
}

async function readNavigationSnapshot(ctx: AppContext): Promise<NsNavigationData> {
  if (SNAPSHOT_TTL_MS <= 0) return buildNavigationData(ctx);
  const now = Date.now();
  if (snapshotCache && snapshotCache.expiresAt > now) {
    const fp = await snapshotFingerprint(ctx);
    // 指纹一致 = 库没变；指纹取不到（空串）时信任 TTL，避免每次都重建
    if (fp === "" || fp === snapshotCache.fp) return snapshotCache.data;
  }
  const data = await buildNavigationData(ctx);
  snapshotCache = {
    data,
    expiresAt: now + SNAPSHOT_TTL_MS,
    fp: await snapshotFingerprint(ctx),
  };
  return data;
}

/**
 * 把数据库读成 NavSphere 的 navigation.json 形状。
 * 组级顺序严格按 sort，保证前端拖拽排序结果可复现。
 */
export async function buildNavigationData(ctx: AppContext): Promise<NsNavigationData> {
  const stats = await ctx.repo.stats();
  if (stats.sites > NAVIGATION_MAX_SITES) {
    const err = new Error(
      `站点总数 (${stats.sites}) 超过单文件快照上限 (${NAVIGATION_MAX_SITES})，请改用分页接口 /api/sites 或调大 NAVHUB_NAVIGATION_MAX_SITES`,
    ) as Error & { statusCode?: number };
    err.statusCode = 413;
    throw err;
  }
  // 类目与站点**都不做可见性预过滤**：快照必须是数据的全量投影。
  // 隐藏语义（enabled=false）由渲染层负责 —— web 端 data-loader 的
  // filterNavigationData 已经过滤了类目/子类目/站点三级。
  //
  // 为什么不能在这里预过滤：快照写回把「快照里没有」当成「用户删了」。
  // 被停用的类目如果在读侧就被滤掉，NavSphere 原版后台（按快照读改写）
  // 既看不到它、也无法再启用它，下一次任意保存还会把它硬删、站点进回收站。
  const categories = (await ctx.repo.listCategories()).sort((a, b) => a.sort - b.sort);
  // listSites 默认 limit 100：快照会静默截断到 100 个站点，所以走全量版本
  // （上限与上面的快照容量守卫一致）。
  const sites = await ctx.repo.listAllSites(NAVIGATION_MAX_SITES);

  const byCategory = new Map<string, typeof sites>();
  for (const s of sites) {
    const list = byCategory.get(s.categoryId);
    if (list) list.push(s); else byCategory.set(s.categoryId, [s]);
  }

  const toItem = (s: (typeof sites)[number], tags: string[]): NsItem => {
    const enhanced = getEnhancedSiteData(s.url, s.title);
    return {
      id: s.id,
      title: s.title,
      href: s.url,
      description: s.description ?? undefined,
      // 自定义图标走 resolveSiteIcon 的第 3 参（而非 `iconKey || ...` 短路）：
      // 指向第三方图标服务的脏值会在这里被视同没有自定义图标，避免进快照 / RSC payload。
      icon: resolveSiteIcon(s.url, s.title, s.iconKey),
      enabled: s.enabled,
      tags: s.tags ?? tags,
      actions: s.actions ?? enhanced.actions,
      relations: s.relations ?? enhanced.relations,
      liveMetrics: s.liveMetrics ?? enhanced.liveMetrics,
      workspaces: s.workspaces ?? enhanced.workspaces,
      health: s.health,
    };
  };

  const tops = categories.filter((c) => c.parentId === null);
  const navigationItems: NsCategory[] = tops.map((c) => {
    const own = (byCategory.get(c.id) ?? []).sort((a, b) => a.sort - b.sort);
    const children = categories.filter((x) => x.parentId === c.id).sort((a, b) => a.sort - b.sort);

    const node: NsCategory = {
      id: c.id,
      title: c.title,
      icon: c.icon ?? undefined,
      description: c.description ?? undefined,
      enabled: c.enabled,
    };
    if (own.length > 0) node.items = own.map((s) => toItem(s, s.tags));
    if (children.length > 0) {
      node.subCategories = children.map((sub) => {
        const subSites = (byCategory.get(sub.id) ?? []).sort((a, b) => a.sort - b.sort);
        return {
          id: sub.id,
          title: sub.title,
          icon: sub.icon ?? undefined,
          description: sub.description ?? undefined,
          parentId: c.id,
          enabled: sub.enabled,
          items: subSites.map((s) => toItem(s, s.tags)),
        };
      });
    }
    return node;
  });

  return { navigationItems };
}

/**
 * 「前端快照托管」的 source 集合——只有这些来源的记录会被全量对齐删除。
 *   null / navsphere：NavSphere 前端自己创建/编辑的（默认托管）
 *   seed：一次性导入的初始内容（管理员在后台里照常管理，可删）
 * 其余来源（manual / api / mcp / mcp-batch / ai / submission / import）
 * 是经其它通道创建的，即使不在快照里也必须保留——否则用 MCP 加一个站点、
 * 前端后台再保存一次导航，那个站点就被静默删除了（D1：真实的数据丢失）。
 */
const SNAPSHOT_MANAGED_SOURCES = new Set<string | null>([null, "navsphere", "seed"]);

function isSnapshotManaged(source: string | null | undefined): boolean {
  return SNAPSHOT_MANAGED_SOURCES.has(source ?? null);
}

/**
 * 把 NavSphere 提交上来的 navigation.json 整体写回数据库。
 * 采用「全量对齐」而非逐条 diff：前台提交的就是完整快照，语义更明确、也更不容易漏。
 *
 * 全量对齐的删除语义有**来源过滤**（D1 缺陷的修复），见 isSnapshotManaged。
 */
export async function writeNavigationData(ctx: AppContext, data: NsNavigationData): Promise<{ categories: number; sites: number }> {
  return await ctx.repo.withTransaction(async () => {
    const input = Array.isArray(data?.navigationItems) ? data.navigationItems : [];
    let categoryCount = 0;
    let siteCount = 0;

    const existingCats = await ctx.repo.listCategories();
    // 必须全量：只看到前 100 个存量站点时，超出部分会在下面被当作「不在快照里」
    // 或匹配不到存量行走 createSiteWithId 撞主键（见 listAllSites 注释）。
    const existingSites = await ctx.repo.listAllSites(NAVIGATION_MAX_SITES);
    // O(1) 索引代替线性 find：原来是"每个快照条目扫一遍全表"= O(n²)，
    // 数千站点的大库保存一次要做上百万次比较（实测是最主要的保存耗时来源）。
    const catIndex = new Map(existingCats.map((c) => [c.id, c]));
    const siteIndex = new Map(existingSites.map((s) => [s.id, s]));
    // 快照「可见集」：与 buildNavigationData 的投影规则严格一致（顶级类目 + 其直接子类目）。
    // 只有本该出现在快照里的记录，缺席才等于被删除；快照模型看不见的记录
    // （三级及更深类目、父类目不存在的孤儿类目）不能被写回顺手清掉。
    const emittedCatIds = new Set<string>();
    for (const c of existingCats) {
      if (c.parentId === null) emittedCatIds.add(c.id);
      else if (catIndex.get(c.parentId)?.parentId === null) emittedCatIds.add(c.id);
    }
    const seenCategoryIds = new Set<string>();
    const seenSiteIds = new Set<string>();

    let catSort = 0;
    for (const top of input) {
      seenCategoryIds.add(top.id);
      const existing = catIndex.get(top.id);
      if (existing) {
        await ctx.repo.updateCategory(top.id, {
          title: top.title,
          icon: top.icon ?? null,
          description: top.description ?? null,
          enabled: top.enabled !== false,
          sort: catSort,
        });
      } else {
        await ctx.repo.createCategory({
          id: top.id, title: top.title, icon: top.icon ?? null,
          description: top.description ?? null, sort: catSort, source: "navsphere",
        });
      }
      categoryCount++;
      catSort++;

      let itemSort = 0;
      for (const item of top.items ?? []) {
        seenSiteIds.add(item.id);
        await upsertSite(ctx, item, top.id, itemSort++, siteIndex);
        siteCount++;
      }

      for (const sub of top.subCategories ?? []) {
        seenCategoryIds.add(sub.id);
        const subExisting = catIndex.get(sub.id);
        if (subExisting) {
          await ctx.repo.updateCategory(sub.id, {
            title: sub.title, icon: sub.icon ?? null,
            description: sub.description ?? null, enabled: sub.enabled !== false, sort: catSort,
          });
        } else {
          await ctx.repo.createCategory({
            id: sub.id, title: sub.title, icon: sub.icon ?? null,
            description: sub.description ?? null, parentId: top.id, sort: catSort, source: "navsphere",
          });
        }
        categoryCount++;
        catSort++;

        itemSort = 0;
        for (const item of sub.items ?? []) {
          seenSiteIds.add(item.id);
          await upsertSite(ctx, item, sub.id, itemSort++, siteIndex);
          siteCount++;
        }
      }
    }

    // 快照语义：本次未出现的「前端托管」站点/类目视为被删除。
    // 这是"全量对齐"必须付的代价，也是它比 diff 更可靠的原因。
    // 但删除范围被 source 严格限界（D1 缺陷修复）：经 API/MCP/AI/投稿创建的
    // 记录即使不在快照里也保留——否则用 MCP 加一个站点、前端后台再保存一次
    // 导航，那个站点就被静默删除了（真实的数据丢失）。
    const removedSiteIds = existingSites
      .filter((s) => isSnapshotManaged(s.source) && !seenSiteIds.has(s.id))
      // 只有「可见集里的站点」缺席才算删除；所属类目不在快照可见集里
      // （孤儿 categoryId 等，接口未强校验）的站点本就不进快照，不能据此删除。
      .filter((s) => emittedCatIds.has(s.categoryId))
      .map((s) => s.id);
    for (const id of removedSiteIds) {
      await ctx.repo.deleteSite(id);
    }
    if (removedSiteIds.length > 0) {
      await ctx.vectors.remove(removedSiteIds).catch(() => undefined);
    }
    for (const c of existingCats) {
      // 同上：不可见的类目缺席 ≠ 删除
      if (isSnapshotManaged(c.source) && emittedCatIds.has(c.id) && !seenCategoryIds.has(c.id)) await ctx.repo.deleteCategory(c.id);
    }

    return { categories: categoryCount, sites: siteCount };
  });
}

type SiteRow = Awaited<ReturnType<AppContext["repo"]["listSites"]>>[number];

async function upsertSite(
  ctx: AppContext,
  item: NsItem,
  categoryId: string,
  sort: number,
  existing: Map<string, SiteRow>,
): Promise<void> {
  const found = existing.get(item.id);
  const title = item.title ?? item.href;
  const description = item.description ?? null;
  // 自定义图标作为第 3 参传给 resolveSiteIcon：指向第三方图标服务的脏值不会写回库里
  // （前端后台把快照读出来再保存一遍是常见的回流路径，这里必须同样净化）
  const resolvedIcon = resolveSiteIcon(item.href, item.title, item.icon);
  if (found) {
    await ctx.repo.updateSite(item.id, {
      url: item.href, title, description, categoryId,
      iconKey: resolvedIcon || null, enabled: item.enabled !== false, sort,
    });
    // 这里原本还会 setSiteTags(item.id, found.tags)：把刚刚读出来的标签原样写回，
    // 即 DELETE 全部再逐条 INSERT 同一个集合——语义上是 no-op，却是每站点 1+2n 次 SQL
    // 的纯浪费（setSiteTags 内部还逐标签往返 upsertTag）。快照语义只托管
    // 站点主字段，标签由其它通道（后台/MCP）维护，故直接跳过；行为等价且快一个量级。
  } else {
    // 保持 NavSphere 传下来的 id，避免前端接下来的更新请求丢失目标
    await ctx.repo.createSiteWithId({
      id: item.id, url: item.href, title, description, categoryId,
      iconKey: resolvedIcon || null, enabled: item.enabled !== false, sort, source: "navsphere",
    });
  }
}

/**
 * site.json 的基线默认值。
 *
 * 为什么必须有基线：前端的 generateMetadata() 直接读 siteData.basic.title 等字段，
 * 若中枢在"用户从未保存过站点配置"时返回 {}，首页会在渲染期抛错。
 * 因此这里给出可用的默认品牌信息，用户后台保存后会覆盖它。
 */
export const DEFAULT_SITE_CONFIG = {
  basic: {
    // 留「导航」作类目描述词：seo-audit 的 <title> ≥4 字符底线与 e2e 标题断言都依赖它
    title: "山羊胡导航",
    description: "AI 原生的网址导航 —— 支持中文语义检索、拼音与关键词混合召回",
    keywords: "网址导航,导航站,AI 导航,语义检索,书签",
  },
  appearance: {
    logo: "/assets/images/alogo.webp",
    favicon: "/assets/images/favicon.webp",
    theme: "system",
  },
  navigation: { linkTarget: "_blank" },
} as const;

/**
 * site.json：站点全局配置。用 jobs 表里的键值存储，避免为此另加一张表。
 * 未保存过时返回 DEFAULT_SITE_CONFIG（而不是空对象），保证前端渲染不炸。
 */
export async function readSiteConfig(ctx: AppContext): Promise<Record<string, unknown>> {
  const row = await readKv(ctx, "site-config");
  if (!row || typeof row !== "object" || Object.keys(row as object).length === 0) {
    return structuredClone(DEFAULT_SITE_CONFIG) as unknown as Record<string, unknown>;
  }
  return row as Record<string, unknown>;
}

export async function writeSiteConfig(ctx: AppContext, config: Record<string, unknown>): Promise<void> {
  await writeKv(ctx, "site-config", config);
}

/** resource-metadata.json：资源（工具/文档）元数据 */
export async function readResourceMetadata(ctx: AppContext): Promise<unknown> {
  return (await readKv(ctx, "resource-metadata")) ?? {};
}

export async function writeResourceMetadata(ctx: AppContext, data: unknown): Promise<void> {
  await writeKv(ctx, "resource-metadata", data);
}

/**
 * videos.json：视频导航数据。
 *
 * 从未写入过时返回 **null**（而不是 { navigationItems: [] }）。
 * 这是刻意的：null 让前端能区分「本来就没数据」（静默回退到构建期基线）
 * 与「中枢里确实存了空列表」—— 否则像 /videos 这种从没存过的页面
 * 会在**每个请求**上刷一条回退警告，把真正的问题淹没。
 */
export async function readVideosData(ctx: AppContext): Promise<unknown> {
  // `db` 模式：优先读关系表，表为空（首次切换 / 迁移未跑 / 被误清空）时回落 KV。
  // 回落而不是返回空库 —— 读路径绝不能因为影子表没准备好就让视频库消失。
  if (resolveVideoStoreMode() === "db") {
    const fromDb = await loadVideoCatalogFromDb(ctx);
    if (fromDb) return fromDb;
  }
  return readKv(ctx, "videos");
}

export async function writeVideosData(
  ctx: AppContext,
  data: unknown,
  ifVersion?: number,
): Promise<void> {
  await writeKv(ctx, "videos", data, ifVersion);
  // `dual` / `db` 模式下把文档同步进关系表。失败只记状态，不影响本次写入 ——
  // 影子表是副本，副本故障不该让正本写入报错（详见 video-catalog.ts 文件头）。
  await syncVideoCatalogSafely(ctx, data);
}

/* --------------------------- 键值读写（复用 jobs 表） --------------------------- */

/**
 * 读取键值。
 *
 * 注意：返回 null 表示「从未写入过」，与「写入过空对象」是不同语义 ——
 * 调用方需要据此决定是否返回默认值。
 */
export async function readKv(ctx: AppContext, key: string): Promise<unknown> {
  const db = ctx.db;
  let payloadStr: string | undefined;
  if (db.dialect === "sqlite") {
    const row = db.sqlite!.prepare("SELECT payload FROM jobs WHERE id = ?").get("kv:" + key) as { payload: string } | undefined;
    payloadStr = row?.payload;
  } else {
    const res = await db.pg!.query("SELECT payload FROM jobs WHERE id = $1", ["kv:" + key]);
    const row = res.rows[0] as { payload: string } | undefined;
    payloadStr = row?.payload;
  }
  if (!payloadStr) return null;
  try {
    return JSON.parse(payloadStr);
  } catch {
    return null;
  }
}

/**
 * 读取 KV 文档的版本号（= 最近一次写入的 `updated_at`）。
 *
 * 为什么需要它：`PUT /api/storage` 是「整包覆盖」语义，`writeKv` 用
 * `ON CONFLICT DO UPDATE` 直接替换 payload。A、B 两个写入方各自「读整包 → 改 → 写」
 * 时，后写的会把先写的整批内容抹掉，且**没有任何报错**（last-write-wins）。
 * 视频库有三个写入口（harvest / ai-autonomous-harvest / webhook-harvest）恰好是这种模式。
 *
 * 返回 `null` 表示从未写入过。
 */
export async function readKvVersion(ctx: AppContext, key: string): Promise<number | null> {
  const db = ctx.db;
  if (db.dialect === "sqlite") {
    const row = db.sqlite!
      .prepare("SELECT updated_at FROM jobs WHERE id = ?")
      .get("kv:" + key) as { updated_at?: number } | undefined;
    return typeof row?.updated_at === "number" ? row.updated_at : null;
  }
  const res = await db.pg!.query("SELECT updated_at FROM jobs WHERE id = $1", ["kv:" + key]);
  const row = res.rows[0] as { updated_at?: number } | undefined;
  return typeof row?.updated_at === "number" ? row.updated_at : null;
}

/** 版本冲突（HTTP 409）。调用方需重新读取后重放变更。 */
export class StorageVersionConflictError extends Error {
  readonly currentVersion: number | null;
  constructor(currentVersion: number | null) {
    super("写入冲突：数据已被其它写入方修改（currentVersion=" + String(currentVersion) + "）");
    this.name = "StorageVersionConflictError";
    this.currentVersion = currentVersion;
  }
  get statusCode(): number {
    return 409;
  }
}

/**
 * 写入 KV 文档；`ifVersion` 给出时做乐观并发控制。
 *
 * 判定与写入**必须在同一个同步块内**（sqlite 下）或同一事务语义下（pg），
 * 否则「检查完到写入前」仍有竞态窗口。这里采用「先读版本 → 比对 → 立刻写」，
 * 在单进程 sqlite（同步 API）下是原子的；pg 下依赖 `updated_at` 的单调性，
 * 最坏情况退化为原有的 last-write-wins，但不会比现状更差。
 */
async function writeKv(
  ctx: AppContext,
  key: string,
  value: unknown,
  ifVersion?: number,
): Promise<void> {
  const db = ctx.db;
  const payload = JSON.stringify(value);
  const now = Date.now();

  if (ifVersion !== undefined) {
    const current = await readKvVersion(ctx, key);
    if (current !== ifVersion) {
      throw new StorageVersionConflictError(current);
    }
  }

  if (db.dialect === "sqlite") {
    db.sqlite!.prepare(
      "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at) VALUES (?,?,?,?,0,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
    ).run("kv:" + key, "kv", payload, "done", now, now);
    return;
  }
  await db.pg!.query(
    "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at) VALUES ($1,$2,$3,$4,0,$5,$6) " +
    "ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at",
    ["kv:" + key, "kv", payload, "done", now, now],
  );
}

/** 内容文件的 basename（用于类型分发） */
function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/* ------------------------------------------------------------------ *
 * 品牌资产文档（上传的 logo / favicon / ogImage）
 *
 * 上传走 HTTP 表单 → web 侧 base64 编码 → `PUT /api/storage` 落成 KV 文档。
 * 这里只提供管理端清理所需的两个原语：列举与删除。
 *
 * 允许范围被收死在这一条目录 + 上传路由的命名形状里：
 *  - 不提供通用 KV 删除——`kv:site-config`、`doc:` 下的任意内容文件
 *    都可能是运营数据，误删一次就是整站导航消失；
 *  - `[name]` GET 路由用同一份命名正则，所以不会出现「列表里有、访问不到」的分叉。
 * ------------------------------------------------------------------ */
export const ASSET_DOC_DIR = "src/navsphere/content/assets";

/** 上传路由生成的资产文档名：`<kind>-<10 位内容哈希>.<位图扩展名>.json` */
const ASSET_DOC_NAME_RE = /^(?:logo|favicon|ogImage)-[0-9a-f]{10}\.(?:png|jpe?g|webp|ico)\.json$/;

/** 该路径是否是「允许管理的品牌资产文档」（删除/列举的唯一准入判定） */
export function isAssetDocPath(path: string): boolean {
  const norm = path.trim().replace(/^\/+/, "");
  const prefix = ASSET_DOC_DIR + "/";
  if (!norm.startsWith(prefix)) return false;
  return ASSET_DOC_NAME_RE.test(norm.slice(prefix.length));
}

export interface AssetDocInfo {
  /** 资产文档路径（含 .json），与上传返回值 / 存储键一一对应 */
  path: string;
  /** 对外访问名（`/api/site/asset/<name>`） */
  name: string;
  /** 文档字节数（base64 后的 JSON，用于展示占用） */
  bytes: number;
  updatedAt: number;
}

/**
 * 列举已上传的资产文档（按最近更新倒序）。
 *
 * 直接查 jobs 表的 KV 行，不额外维护一份索引：索引与真实存储之间一旦分叉，
 * 「删了列表项但文档还在」「列表为空却占着空间」这类问题就只能靠人工核对。
 */
export async function listAssetDocs(ctx: AppContext, limit = 500): Promise<AssetDocInfo[]> {
  const cap = Math.min(Math.max(1, Math.floor(limit)), 1000);
  const prefix = "kv:" + pathToKey(ASSET_DOC_DIR + "/");
  type Row = { id: string; bytes: number | string | null; updated_at: number | string | null };
  let rows: Row[];
  if (ctx.db.dialect === "sqlite") {
    rows = ctx.db.sqlite!
      .prepare("SELECT id, length(payload) AS bytes, updated_at FROM jobs WHERE id LIKE ? ORDER BY updated_at DESC LIMIT ?")
      .all(prefix + "%", cap) as Row[];
  } else {
    const res = await ctx.db.pg!.query(
      "SELECT id, LENGTH(payload) AS bytes, updated_at FROM jobs WHERE id LIKE $1 ORDER BY updated_at DESC LIMIT $2",
      [prefix + "%", cap],
    );
    rows = res.rows as Row[];
  }
  const out: AssetDocInfo[] = [];
  for (const row of rows) {
    const path = String(row.id).replace(/^kv:doc:/, "");
    if (!isAssetDocPath(path)) continue;
    out.push({
      path,
      name: path.slice(ASSET_DOC_DIR.length + 1).replace(/\.json$/, ""),
      bytes: Number(row.bytes ?? 0),
      updatedAt: Number(row.updated_at ?? 0),
    });
  }
  return out;
}

/**
 * 删除一份品牌资产文档。
 *
 * 只删 `doc:` 键；`kv:site-config` 这类结构化配置即使路径拼错也进不来。
 * 返回 deleted=false 表示文档本来就不存在（路由据此回 404，而不是伪报成功）。
 */
export async function deleteAssetDoc(ctx: AppContext, path: string): Promise<{ deleted: boolean }> {
  const norm = path.trim().replace(/^\/+/, "");
  if (!isAssetDocPath(norm)) {
    const err = new Error("只允许删除上传的品牌资产（src/navsphere/content/assets/<kind>-<hash>.<ext>.json）") as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  const id = "kv:" + pathToKey(norm);
  let count = 0;
  if (ctx.db.dialect === "sqlite") {
    const info = ctx.db.sqlite!.prepare("DELETE FROM jobs WHERE id = ?").run(id) as { changes?: number };
    count = Number(info?.changes ?? 0);
  } else {
    const res = await ctx.db.pg!.query("DELETE FROM jobs WHERE id = $1", [id]);
    count = Number(res.rowCount ?? 0);
  }
  return { deleted: count > 0 };
}

/**
 * 把任意内容路径归一化成键值存储的 key。
 *
 * 存在的意义：NavSphere 的内容文件不止导航/站点/资源/视频这几个，
 * 而"哪些文件值得结构化建模"会随业务演进变化。与其每次新增文件都改一遍后端，
 * 不如给未知文件一个**通用 JSON 文档**通路 —— 后端因此不会被上游的文件清单卡住。
 */
export function pathToKey(path: string): string {
  return "doc:" + path.replace(/^\/+/, "");
}

/** 分发：把 NavSphere 的 path 映射到上面的处理函数 */
export async function readStoragePath(ctx: AppContext, path: string): Promise<unknown> {
  const name = basename(path);
  // navigation-default.json 是"默认模板"，当前实现下与导航数据同源
  if (name === "navigation-default.json" || name === "navigation.json") return readNavigationSnapshot(ctx);
  if (name === "site.json") return readSiteConfig(ctx);
  if (name === "resource-metadata.json") return readResourceMetadata(ctx);
  if (name === "videos.json") return readVideosData(ctx);
  // 其余内容文件走通用 JSON 文档。从未写入过时返回 null（与"保存了空对象"区分开），
  // 由调用方决定是静默回退还是告警。
  return readKv(ctx, pathToKey(path));
}

/**
 * 读取某个内容路径的当前版本（仅 KV 类路径有版本概念）。
 *
 * 供 `GET /api/storage/version` 与写入前的乐观并发校验使用。
 * 结构化路径（navigation.json / site.json / resource-metadata.json）走各自的
 * 关系表，不在此列 —— 返回 null。
 */
export async function readStorageVersion(ctx: AppContext, path: string): Promise<number | null> {
  const name = basename(path);
  if (name === "navigation.json" || name === "site.json" || name === "resource-metadata.json") {
    return null;
  }
  const key = name === "videos.json" ? "videos" : pathToKey(path);
  return readKvVersion(ctx, key);
}

export async function writeStoragePath(
  ctx: AppContext,
  path: string,
  content: string,
  opts?: { ifVersion?: number },
): Promise<{ ok: true; note: string; version?: number }> {
  const parsed = content.trim() ? JSON.parse(content) : {};
  if (basename(path) === "navigation.json") {
    const r = await writeNavigationData(ctx, parsed as NsNavigationData);
    // 与 server.ts 的 onResponse 失效互为兜底：即便将来有调用方绕过 HTTP 层，
    // 也不会把旧快照继续喂给前端。
    invalidateSnapshotCache();
    return { ok: true, note: "已写入 " + r.categories + " 个类目 / " + r.sites + " 个站点" };
  }
  if (basename(path) === "site.json") {
    await writeSiteConfig(ctx, parsed as Record<string, unknown>);
    return { ok: true, note: "站点配置已更新" };
  }
  if (basename(path) === "resource-metadata.json") {
    await writeResourceMetadata(ctx, parsed);
    return { ok: true, note: "资源元数据已更新" };
  }
  if (basename(path) === "videos.json") {
    await writeVideosData(ctx, parsed, opts?.ifVersion);
    const version = await readKvVersion(ctx, "videos");
    return { ok: true, note: "视频导航数据已更新", version: version ?? undefined };
  }
  await writeKv(ctx, pathToKey(path), parsed, opts?.ifVersion);
  const version = await readKvVersion(ctx, pathToKey(path));
  return { ok: true, note: "内容文件已更新: " + basename(path), version: version ?? undefined };
}