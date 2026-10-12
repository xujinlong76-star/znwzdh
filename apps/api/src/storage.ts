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

export const NAVIGATION_PATH = "src/navsphere/content/navigation.json";
export const SITE_PATH = "src/navsphere/content/site.json";
export const RESOURCE_PATH = "src/navsphere/content/resource-metadata.json";
export const DEFAULT_NAVIGATION_PATH = "src/navsphere/content/navigation-default.json";

/** NavSphere 的站点项结构（= NavHub 的 site，但字段名要映射） */
interface NsItem {
  id: string;
  title: string;
  href: string;
  description?: string;
  icon?: string;
  useDefaultIcon?: boolean;
  enabled: boolean;
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
 * 把数据库读成 NavSphere 的 navigation.json 形状。
 * 组级顺序严格按 sort，保证前端拖拽排序结果可复现。
 */
export async function buildNavigationData(ctx: AppContext): Promise<NsNavigationData> {
  const categories = (await ctx.repo.listCategories()).filter((c) => c.enabled).sort((a, b) => a.sort - b.sort);
  const sites = await ctx.repo.listSites();

  const byCategory = new Map<string, typeof sites>();
  for (const s of sites) {
    const list = byCategory.get(s.categoryId);
    if (list) list.push(s); else byCategory.set(s.categoryId, [s]);
  }

  const toItem = (s: (typeof sites)[number], tags: string[]): NsItem => ({
    id: s.id,
    title: s.title,
    href: s.url,
    description: s.description ?? undefined,
    icon: s.iconKey ?? undefined,
    enabled: s.enabled,
  });

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
 * 把 NavSphere 提交上来的 navigation.json 整体写回数据库。
 * 采用「全量对齐」而非逐条 diff：前台提交的就是完整快照，语义更明确、也更不容易漏。
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
        description: top.description ?? null, sort: catSort,
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
          description: sub.description ?? null, parentId: top.id, sort: catSort,
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

  // 快照语义：本次未出现的站点/类目视为被删除。
  // 这是"全量对齐"必须付的代价，也是它比 diff 更可靠的原因。
  for (const s of existingSites) {
    if (!seenSiteIds.has(s.id)) await ctx.repo.deleteSite(s.id);
  }
  for (const c of existingCats) {
    if (!seenCategoryIds.has(c.id)) await ctx.repo.deleteCategory(c.id);
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
  if (found) {
    await ctx.repo.updateSite(item.id, {
      url: item.href, title, description, categoryId,
      iconKey: item.icon ?? null, enabled: item.enabled !== false, sort,
    });
    await ctx.repo.setSiteTags(item.id, found.tags);
  } else {
    // 保持 NavSphere 传下来的 id，避免前端接下来的更新请求丢失目标
    await ctx.repo.createSiteWithId({
      id: item.id, url: item.href, title, description, categoryId,
      iconKey: item.icon ?? null, enabled: item.enabled !== false, sort, source: "navsphere",
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

/* --------------------------- 键值读写（复用 jobs 表） --------------------------- */

async function readKv(ctx: AppContext, key: string): Promise<unknown> {
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

/** 分发：把 NavSphere 的 path 映射到上面的处理函数 */
export async function readStoragePath(ctx: AppContext, path: string): Promise<unknown> {
  if (path.includes("navigation-default.json")) return buildNavigationData(ctx);
  if (path.includes("navigation.json")) return buildNavigationData(ctx);
  if (path.includes("site.json")) return readSiteConfig(ctx);
  if (path.includes("resource-metadata.json")) return readResourceMetadata(ctx);
  return {};
}

export async function writeStoragePath(ctx: AppContext, path: string, content: string): Promise<{ ok: true; note: string }> {
  const parsed = content.trim() ? JSON.parse(content) : {};
  if (path.includes("navigation.json")) {
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
  return { ok: true, note: "路径未被处理（已忽略）" };
}