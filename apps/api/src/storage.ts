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
  const categories = (await ctx.repo.listCategories()).filter((c) => c.enabled).sort((a, b) => a.sort - b.sort);
  const sites = await ctx.repo.listSites();

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
      icon: s.iconKey || resolveSiteIcon(s.url, s.title),
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
  const input = Array.isArray(data?.navigationItems) ? data.navigationItems : [];
  let categoryCount = 0;
  let siteCount = 0;

  const existingCats = await ctx.repo.listCategories();
  const existingSites = await ctx.repo.listSites();
  const seenCategoryIds = new Set<string>();
  const seenSiteIds = new Set<string>();

  let catSort = 0;
  for (const top of input) {
    seenCategoryIds.add(top.id);
    const existing = existingCats.find((c) => c.id === top.id);
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
      await upsertSite(ctx, item, top.id, itemSort++, existingSites);
      siteCount++;
    }

    for (const sub of top.subCategories ?? []) {
      seenCategoryIds.add(sub.id);
      const subExisting = existingCats.find((c) => c.id === sub.id);
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
        await upsertSite(ctx, item, sub.id, itemSort++, existingSites);
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
    .map((s) => s.id);
  for (const id of removedSiteIds) {
    await ctx.repo.deleteSite(id);
  }
  if (removedSiteIds.length > 0) {
    await ctx.vectors.remove(removedSiteIds).catch(() => undefined);
  }
  for (const c of existingCats) {
    if (isSnapshotManaged(c.source) && !seenCategoryIds.has(c.id)) await ctx.repo.deleteCategory(c.id);
  }

  return { categories: categoryCount, sites: siteCount };
}

async function upsertSite(
  ctx: AppContext,
  item: NsItem,
  categoryId: string,
  sort: number,
  existing: Awaited<ReturnType<AppContext["repo"]["listSites"]>>,
): Promise<void> {
  const found = existing.find((s) => s.id === item.id);
  const title = item.title ?? item.href;
  const description = item.description ?? null;
  const resolvedIcon = item.icon || resolveSiteIcon(item.href, item.title);
  if (found) {
    await ctx.repo.updateSite(item.id, {
      url: item.href, title, description, categoryId,
      iconKey: resolvedIcon || null, enabled: item.enabled !== false, sort,
    });
    await ctx.repo.setSiteTags(item.id, found.tags);
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
    title: "NavHub 导航",
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
  return readKv(ctx, "videos");
}

export async function writeVideosData(ctx: AppContext, data: unknown): Promise<void> {
  await writeKv(ctx, "videos", data);
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
  if (db.dialect === "sqlite") {
    const row = db.sqlite!.prepare("SELECT payload FROM jobs WHERE id = ?").get("kv:" + key) as { payload: string } | undefined;
    return row?.payload ? JSON.parse(row.payload) : null;
  }
  const res = await db.pg!.query("SELECT payload FROM jobs WHERE id = $1", ["kv:" + key]);
  const row = res.rows[0] as { payload: string } | undefined;
  return row?.payload ? JSON.parse(row.payload) : null;
}

async function writeKv(ctx: AppContext, key: string, value: unknown): Promise<void> {
  const db = ctx.db;
  const payload = JSON.stringify(value);
  const now = Date.now();
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
  if (name === "navigation-default.json" || name === "navigation.json") return buildNavigationData(ctx);
  if (name === "site.json") return readSiteConfig(ctx);
  if (name === "resource-metadata.json") return readResourceMetadata(ctx);
  if (name === "videos.json") return readVideosData(ctx);
  // 其余内容文件走通用 JSON 文档。从未写入过时返回 null（与"保存了空对象"区分开），
  // 由调用方决定是静默回退还是告警。
  return readKv(ctx, pathToKey(path));
}

export async function writeStoragePath(ctx: AppContext, path: string, content: string): Promise<{ ok: true; note: string }> {
  const parsed = content.trim() ? JSON.parse(content) : {};
  if (basename(path) === "navigation.json") {
    const r = await writeNavigationData(ctx, parsed as NsNavigationData);
    return { ok: true, note: "已写入 " + r.categories + " 个类目 / " + r.sites + " 个站点" };
  }
  if (path.includes("site.json")) {
    await writeSiteConfig(ctx, parsed as Record<string, unknown>);
    return { ok: true, note: "站点配置已更新" };
  }
  if (path.includes("resource-metadata.json")) {
    await writeResourceMetadata(ctx, parsed);
    return { ok: true, note: "资源元数据已更新" };
  }
  if (basename(path) === "videos.json") {
    await writeVideosData(ctx, parsed);
    return { ok: true, note: "视频导航数据已更新" };
  }
  await writeKv(ctx, pathToKey(path), parsed);
  return { ok: true, note: "内容文件已更新: " + basename(path) };
}