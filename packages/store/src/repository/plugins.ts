import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import { canonicalizeUrl, type PluginKind, type PluginManifest, type PluginStatus, type SitePackPayload } from "@navhub/core";
import { slugify } from "./dialect.ts";
import type { PluginActor, PluginInstallRecord, PluginRecord } from "./records.ts";

// 门面（repository.ts）通过 `pluginsRepo.` 命名空间引用插件域类型，保持域自包含
export type { PluginActor, PluginInstallRecord, PluginRecord } from "./records.ts";
export type { PluginManifest } from "@navhub/core";

/**
 * 插件市场（Plugin Marketplace）存储层。
 *
 * 设计约束（见 docs/PLUGIN-MARKET-DESIGN-2026-10-19.md）：
 * 1. 插件一律声明式：本模块只消费「已校验的 PluginManifest」（core 契约），永不执行插件内容；
 * 2. 安装是**增量**的：只新增缺失的站点/分类（URL 等价形态去重），绝不删改既有数据；
 * 3. 卸载默认只解绑记录；removeSites=true 时仅软删 source=plugin:<slug> 的站点（进回收站可恢复）；
 * 4. 计数列（install/star/report）在写路径维护，install_count 与「活跃安装」严格挂钩，
 *    重复安装不会重复计数（幂等）。
 */

const SLUG_MAX = 80;

export interface PluginCreateInput {
  manifest: PluginManifest;
  author?: string | null;
  authorKind?: string | null;
  /** user（社区发布，默认待审）| import（本机导入，可直接上架）| seed */
  source?: string;
  status?: PluginStatus;
  /** 显式指定 slug（导入迁移用）；缺省由名称生成并对冲突去重 */
  slug?: string;
}

export interface PluginListFilter {
  status?: string;
  kind?: string;
  q?: string;
  /** new（默认）| popular | stars | updated */
  sort?: string;
  limit?: number;
  offset?: number;
}

export type PluginReviewAction = "approve" | "reject" | "delist";

export interface PluginInstallApplied {
  sitesAdded: number;
  sitesSkipped: number;
  categoriesCreated: number;
  createdSiteIds: string[];
}

export interface PluginInstallResult {
  plugin: PluginRecord;
  install: PluginInstallRecord;
  /** 此前已处于活跃安装状态（重复安装）：计数未变 */
  alreadyInstalled: boolean;
  applied: PluginInstallApplied;
}

export interface PluginUninstallResult {
  /** false = 没有活跃安装（幂等语义，不报错） */
  removed: boolean;
  removedSites: number;
  plugin: PluginRecord;
}

/* ------------------------------------------------------------------ *
 * 行映射与 slug
 * ------------------------------------------------------------------ */

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // 落库前已经过 core 校验；解析失败只可能是外部脏数据，降级展示而不是抛错
    return fallback;
  }
}

function rowToPlugin(row: Record<string, any>): PluginRecord {
  const kind = String(row.kind ?? "site-pack") as PluginKind;
  const manifest = parseJson<PluginManifest | null>(row.manifest, null);
  const fallbackManifest: PluginManifest = {
    manifestVersion: 1,
    kind,
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    version: String(row.version ?? "0.0.0"),
    payload: { sites: [] },
  };
  const tagsRaw = parseJson<unknown>(row.tags, []);
  return {
    id: String(row.id),
    slug: String(row.slug),
    kind,
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    icon: row.icon == null ? null : String(row.icon),
    tags: Array.isArray(tagsRaw) ? tagsRaw.map(String) : [],
    author: row.author == null ? null : String(row.author),
    authorKind: row.author_kind == null ? null : String(row.author_kind),
    license: row.license == null ? null : String(row.license),
    homepage: row.homepage == null ? null : String(row.homepage),
    version: String(row.version ?? "0.0.0"),
    manifest: manifest ?? fallbackManifest,
    status: String(row.status ?? "pending") as PluginStatus,
    reviewNote: row.review_note == null ? null : String(row.review_note),
    reviewedAt: row.reviewed_at == null ? null : Number(row.reviewed_at),
    source: String(row.source ?? "user"),
    installCount: Number(row.install_count ?? 0),
    starCount: Number(row.star_count ?? 0),
    reportCount: Number(row.report_count ?? 0),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    publishedAt: row.published_at == null ? null : Number(row.published_at),
  };
}

/** 名称 → slug 基座；无有效字符时回落 "plugin"（slugify 的空兜底 "tag" 对插件语义不对） */
function baseSlug(seed: string): string {
  if (!/[a-z0-9\u4e00-\u9fff]/i.test(seed)) return "plugin";
  return slugify(seed).slice(0, SLUG_MAX) || "plugin";
}

/** 生成唯一 slug：已占用则追加 -2、-3…… */
async function uniqueSlug(repo: Repository, seed: string): Promise<string> {
  const base = baseSlug(seed);
  const rows = await repo.raw("SELECT slug FROM plugins WHERE slug = ? OR slug LIKE ?", [base, base + "-%"]);
  const taken = new Set(rows.map((r) => String(r.slug)));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    if (!taken.has(base + "-" + i)) return base + "-" + i;
  }
  return base + "-" + randomUUID().slice(0, 8);
}

/* ------------------------------------------------------------------ *
 * 注册表：发布 / 读取 / 列表 / 更新 / 审核
 * ------------------------------------------------------------------ */

export async function createPlugin(
  repo: Repository,
  input: PluginCreateInput,
  actor?: PluginActor,
): Promise<PluginRecord> {
  const manifest = input.manifest;
  const now = Date.now();
  const source = input.source ?? "user";
  const status = input.status ?? "pending";
  if (input.slug) {
    const existing = await getPluginBySlug(repo, input.slug);
    if (existing) throw new Error(`插件 slug 已存在：${input.slug}`);
  }
  const slug = input.slug ?? (await uniqueSlug(repo, manifest.name));
  await repo.run(
    `INSERT INTO plugins (
       id, slug, kind, name, description, icon, tags, author, author_kind, license, homepage,
       version, manifest, status, review_note, reviewed_at, source,
       install_count, star_count, report_count, created_at, updated_at, published_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?,?,?)`,
    [
      randomUUID(),
      slug,
      manifest.kind,
      manifest.name,
      manifest.description,
      manifest.icon ?? null,
      JSON.stringify(manifest.tags ?? []),
      input.author ?? manifest.author ?? null,
      input.authorKind ?? null,
      manifest.license ?? null,
      manifest.homepage ?? null,
      manifest.version,
      JSON.stringify(manifest),
      status,
      null,
      null,
      source,
      now,
      now,
      status === "published" ? now : null,
    ],
  );
  const created = await getPluginBySlug(repo, slug);
  if (!created) throw new Error("创建插件后无法读回");
  await repo.audit({
    actor: actor?.actor ?? input.author ?? "anonymous",
    actorKind: actor?.actorKind ?? input.authorKind ?? "anonymous",
    action: source === "import" ? "plugin.import" : "plugin.publish",
    target: slug,
    diff: { kind: manifest.kind, version: manifest.version, source },
    ip: actor?.ip,
  });
  return created;
}

export async function getPluginBySlug(repo: Repository, slug: string): Promise<PluginRecord | null> {
  const rows = await repo.raw("SELECT * FROM plugins WHERE slug = ? LIMIT 1", [slug]);
  return rows[0] ? rowToPlugin(rows[0]) : null;
}

export async function listPlugins(
  repo: Repository,
  filter: PluginListFilter = {},
): Promise<{ items: PluginRecord[]; total: number }> {
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    wheres.push("status = ?");
    params.push(filter.status);
  }
  if (filter.kind) {
    wheres.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter.q) {
    wheres.push("(name LIKE ? OR description LIKE ?)");
    const like = "%" + filter.q + "%";
    params.push(like, like);
  }
  const whereClause = wheres.length > 0 ? " WHERE " + wheres.join(" AND ") : "";
  const countRow = (await repo.raw(`SELECT COUNT(*) AS cnt FROM plugins${whereClause}`, params))[0];
  const total = Number(countRow?.cnt ?? 0);
  const limit = Math.min(100, Math.max(1, filter.limit ?? 24));
  const offset = Math.max(0, filter.offset ?? 0);
  const order =
    filter.sort === "popular"
      ? "install_count DESC, star_count DESC, created_at DESC"
      : filter.sort === "stars"
        ? "star_count DESC, created_at DESC"
        : filter.sort === "updated"
          ? "updated_at DESC"
          : "COALESCE(published_at, created_at) DESC, created_at DESC";
  const rows = await repo.raw(
    `SELECT * FROM plugins${whereClause} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { items: rows.map(rowToPlugin), total };
}

/**
 * 更新插件内容（新 manifest 须已通过 core 校验）。
 * 已发布/已驳回/已下架的插件一律回到 pending 重审——更新不允许绕过人工审核。
 */
export async function updatePlugin(
  repo: Repository,
  slug: string,
  manifest: PluginManifest,
  actor?: PluginActor,
): Promise<PluginRecord> {
  const existing = await getPluginBySlug(repo, slug);
  if (!existing) throw new Error(`插件不存在：${slug}`);
  await repo.run(
    `UPDATE plugins SET name = ?, description = ?, icon = ?, tags = ?, license = ?, homepage = ?,
       version = ?, manifest = ?, status = 'pending', review_note = NULL, reviewed_at = NULL,
       published_at = NULL, updated_at = ?
     WHERE slug = ?`,
    [
      manifest.name,
      manifest.description,
      manifest.icon ?? null,
      JSON.stringify(manifest.tags ?? []),
      manifest.license ?? null,
      manifest.homepage ?? null,
      manifest.version,
      JSON.stringify(manifest),
      Date.now(),
      slug,
    ],
  );
  const updated = await getPluginBySlug(repo, slug);
  if (!updated) throw new Error("更新插件后无法读回");
  await repo.audit({
    actor: actor?.actor ?? existing.author ?? "anonymous",
    actorKind: actor?.actorKind,
    action: "plugin.update",
    target: slug,
    diff: { from: existing.version, to: manifest.version, statusReset: existing.status !== "pending" },
    ip: actor?.ip,
  });
  return updated;
}

/** 审核动作：approve（pending|delisted → published）/ reject / delist */
export async function reviewPlugin(
  repo: Repository,
  slug: string,
  action: PluginReviewAction,
  note: string | null,
  actor?: PluginActor,
): Promise<PluginRecord> {
  const existing = await getPluginBySlug(repo, slug);
  if (!existing) throw new Error(`插件不存在：${slug}`);
  let status: PluginStatus;
  if (action === "approve") {
    if (existing.status !== "pending" && existing.status !== "delisted") {
      throw new Error(`插件当前状态为 ${existing.status}，只有 pending/delisted 可以通过`);
    }
    status = "published";
  } else if (action === "reject") {
    status = "rejected";
  } else {
    status = "delisted";
  }
  const now = Date.now();
  await repo.run(
    "UPDATE plugins SET status = ?, review_note = ?, reviewed_at = ?, published_at = ?, updated_at = ? WHERE slug = ?",
    [status, note, now, action === "approve" ? now : existing.publishedAt, now, slug],
  );
  const updated = await getPluginBySlug(repo, slug);
  if (!updated) throw new Error("审核后无法读回");
  await repo.audit({
    actor: actor?.actor ?? "admin",
    actorKind: actor?.actorKind,
    action: action === "delist" ? "plugin.delist" : `plugin.review.${action}`,
    target: slug,
    diff: { from: existing.status, to: status, note },
    ip: actor?.ip,
  });
  return updated;
}

/* ------------------------------------------------------------------ *
 * 安装 / 卸载
 * ------------------------------------------------------------------ */

/** 子分类：按「父类 + 标题」精确匹配，缺则创建（挂到父类下） */
async function ensureSubCategory(repo: Repository, parentId: string, title: string, source: string): Promise<string> {
  const rows = await repo.raw("SELECT id FROM categories WHERE parent_id = ? AND title = ? LIMIT 1", [parentId, title]);
  if (rows[0]) return String(rows[0].id);
  const created = await repo.createCategory({ title, parentId, source });
  return created.id;
}

/**
 * 导入去重：URL 的常见等价形态（原文 / 规范化 / 尾斜杠增删）任一命中即视为已存在。
 * 为什么不能只用 findSiteByUrl：落库存的是**原文**，lookup 侧带不带尾斜杠都可能，
 * 两侧都展开比对才能在「https://a.com/」与「https://a.com」之间正确去重。
 */
async function siteUrlExists(repo: Repository, url: string): Promise<boolean> {
  const forms = new Set<string>();
  for (const form of [url.trim(), canonicalizeUrl(url)]) {
    if (!form) continue;
    forms.add(form);
    forms.add(form.endsWith("/") ? form.slice(0, -1) : form + "/");
  }
  const list = [...forms];
  const rows = await repo.raw(
    `SELECT 1 AS ok FROM sites WHERE url IN (${list.map(() => "?").join(",")}) AND deleted_at IS NULL LIMIT 1`,
    list,
  );
  return rows.length > 0;
}

function parseInstallRow(row: Record<string, any>): PluginInstallRecord {
  return {
    pluginId: String(row.plugin_id),
    identity: String(row.identity),
    version: String(row.version),
    meta: parseJson<unknown>(row.meta, null),
    installedAt: Number(row.installed_at ?? 0),
    removedAt: row.removed_at == null ? null : Number(row.removed_at),
  };
}

export async function getPluginInstall(
  repo: Repository,
  pluginId: string,
  identity: string,
): Promise<PluginInstallRecord | null> {
  const rows = await repo.raw("SELECT * FROM plugin_installs WHERE plugin_id = ? AND identity = ? LIMIT 1", [
    pluginId,
    identity,
  ]);
  const row = rows[0];
  return row ? parseInstallRow(row) : null;
}

/** 详情页/卡片交互态：某身份对该插件的安装与星标状态 */
export async function pluginInteraction(
  repo: Repository,
  pluginId: string,
  identity: string,
): Promise<{ installed: boolean; starred: boolean }> {
  const who = identity.trim().slice(0, 120);
  if (!who) return { installed: false, starred: false };
  const install = await getPluginInstall(repo, pluginId, who);
  const stars = await repo.raw("SELECT 1 AS ok FROM plugin_stars WHERE plugin_id = ? AND identity = ? LIMIT 1", [
    pluginId,
    who,
  ]);
  return { installed: !!install && install.removedAt === null, starred: stars.length > 0 };
}

export interface PluginInstalledItem {
  install: PluginInstallRecord;
  plugin: PluginRecord;
}

/** 「我的插件」：某身份的活跃安装列表（含插件本体，按安装时间倒序） */
export async function listPluginInstallsByIdentity(
  repo: Repository,
  identity: string,
): Promise<PluginInstalledItem[]> {
  const who = identity.trim().slice(0, 120);
  if (!who) return [];
  const rows = await repo.raw(
    "SELECT * FROM plugin_installs WHERE identity = ? AND removed_at IS NULL ORDER BY installed_at DESC",
    [who],
  );
  const items: PluginInstalledItem[] = [];
  for (const row of rows) {
    const pluginRows = await repo.raw("SELECT * FROM plugins WHERE id = ? LIMIT 1", [row.plugin_id]);
    const pluginRow = pluginRows[0];
    if (!pluginRow) continue;
    items.push({ install: parseInstallRow(row), plugin: rowToPlugin(pluginRow) });
  }
  return items;
}

export async function installPlugin(
  repo: Repository,
  slug: string,
  identity: string,
  actor?: PluginActor,
): Promise<PluginInstallResult> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  if (plugin.status !== "published") {
    throw new Error(`插件状态为 ${plugin.status}，只有已上架（published）插件可以安装`);
  }
  const who = identity.trim().slice(0, 120) || "anonymous";
  const applied: PluginInstallApplied = { sitesAdded: 0, sitesSkipped: 0, categoriesCreated: 0, createdSiteIds: [] };

  if (plugin.kind === "site-pack") {
    const payload = plugin.manifest.payload as SitePackPayload;
    await repo.withTransaction(async () => {
      // 分类解析：实例已有分类（大小写不敏感）优先复用，缺则创建并标记来源
      const titleIndex = new Map<string, string>();
      for (const category of await repo.listCategories()) {
        titleIndex.set(category.title.toLowerCase(), category.id);
      }
      for (const category of payload.categories ?? []) {
        const key = category.title.trim().toLowerCase();
        if (!key || titleIndex.has(key)) continue;
        const id = await repo.ensureCategory(category.title.trim(), `plugin:${slug}`);
        titleIndex.set(key, id);
        applied.categoriesCreated++;
      }
      for (const site of payload.sites) {
        if (await siteUrlExists(repo, site.url)) {
          applied.sitesSkipped++;
          continue;
        }
        const categoryTitle = (site.category ?? "").trim() || "插件导入";
        const categoryKey = categoryTitle.toLowerCase();
        let categoryId = titleIndex.get(categoryKey);
        if (!categoryId) {
          categoryId = await repo.ensureCategory(categoryTitle, `plugin:${slug}`);
          titleIndex.set(categoryKey, categoryId);
          applied.categoriesCreated++;
        }
        let subCategoryId: string | null = null;
        const subTitle = site.subCategory?.trim();
        if (subTitle) {
          subCategoryId = await ensureSubCategory(repo, categoryId, subTitle, `plugin:${slug}`);
        }
        const created = await repo.createSiteWithId({
          id: randomUUID(),
          url: site.url,
          title: site.title,
          description: site.description ?? null,
          categoryId,
          subCategoryId,
          tags: site.tags,
          status: "active",
          enabled: true,
          source: `plugin:${slug}`,
        });
        applied.sitesAdded++;
        applied.createdSiteIds.push(created.id);
      }
    });
  }

  const now = Date.now();
  const existingInstall = await getPluginInstall(repo, plugin.id, who);
  const wasActive = !!existingInstall && existingInstall.removedAt === null;
  const meta = JSON.stringify({ ...applied, manifest: plugin.manifest });
  if (existingInstall) {
    await repo.run(
      "UPDATE plugin_installs SET version = ?, meta = ?, installed_at = ?, removed_at = NULL WHERE plugin_id = ? AND identity = ?",
      [plugin.version, meta, now, plugin.id, who],
    );
  } else {
    await repo.run(
      "INSERT INTO plugin_installs (plugin_id, identity, version, meta, installed_at, removed_at) VALUES (?,?,?,?,?,NULL)",
      [plugin.id, who, plugin.version, meta, now],
    );
  }
  if (!wasActive) {
    await repo.run("UPDATE plugins SET install_count = ? WHERE id = ?", [plugin.installCount + 1, plugin.id]);
  }
  await repo.audit({
    actor: actor?.actor ?? who,
    actorKind: actor?.actorKind ?? "identity",
    action: "plugin.install",
    target: slug,
    diff: {
      version: plugin.version,
      sitesAdded: applied.sitesAdded,
      sitesSkipped: applied.sitesSkipped,
      categoriesCreated: applied.categoriesCreated,
    },
    ip: actor?.ip,
  });
  const refreshed = await getPluginBySlug(repo, slug);
  const install = await getPluginInstall(repo, plugin.id, who);
  if (!refreshed || !install) throw new Error("安装后无法读回插件状态");
  return { plugin: refreshed, install, alreadyInstalled: wasActive, applied };
}

export async function uninstallPlugin(
  repo: Repository,
  slug: string,
  identity: string,
  options: { removeSites?: boolean } = {},
  actor?: PluginActor,
): Promise<PluginUninstallResult> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  const who = identity.trim().slice(0, 120) || "anonymous";
  const install = await getPluginInstall(repo, plugin.id, who);
  if (!install || install.removedAt !== null) {
    return { removed: false, removedSites: 0, plugin };
  }
  let removedSites = 0;
  if (options.removeSites && plugin.kind === "site-pack") {
    // 只软删「来源仍是该插件」的站点（用户改过的来源已变，不会被误伤）；进回收站可恢复
    const rows = await repo.raw("SELECT id FROM sites WHERE source = ? AND deleted_at IS NULL", [`plugin:${slug}`]);
    for (const row of rows) {
      await repo.deleteSite(String(row.id));
      removedSites++;
    }
  }
  await repo.run("UPDATE plugin_installs SET removed_at = ? WHERE plugin_id = ? AND identity = ?", [
    Date.now(),
    plugin.id,
    who,
  ]);
  await repo.run("UPDATE plugins SET install_count = ? WHERE id = ?", [
    Math.max(0, plugin.installCount - 1),
    plugin.id,
  ]);
  await repo.audit({
    actor: actor?.actor ?? who,
    actorKind: actor?.actorKind ?? "identity",
    action: "plugin.uninstall",
    target: slug,
    diff: { version: install.version, removedSites },
    ip: actor?.ip,
  });
  const refreshed = await getPluginBySlug(repo, slug);
  if (!refreshed) throw new Error("卸载后无法读回插件状态");
  return { removed: true, removedSites, plugin: refreshed };
}

/* ------------------------------------------------------------------ *
 * 星标 / 举报
 * ------------------------------------------------------------------ */

export async function starPlugin(
  repo: Repository,
  slug: string,
  identity: string,
): Promise<{ starred: boolean; starCount: number }> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  const who = identity.trim().slice(0, 120) || "anonymous";
  const existing = await repo.raw("SELECT 1 AS ok FROM plugin_stars WHERE plugin_id = ? AND identity = ? LIMIT 1", [
    plugin.id,
    who,
  ]);
  if (existing[0]) return { starred: true, starCount: plugin.starCount };
  await repo.run("INSERT INTO plugin_stars (plugin_id, identity, created_at) VALUES (?,?,?)", [
    plugin.id,
    who,
    Date.now(),
  ]);
  const starCount = plugin.starCount + 1;
  await repo.run("UPDATE plugins SET star_count = ? WHERE id = ?", [starCount, plugin.id]);
  return { starred: true, starCount };
}

export async function unstarPlugin(
  repo: Repository,
  slug: string,
  identity: string,
): Promise<{ starred: boolean; starCount: number }> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  const who = identity.trim().slice(0, 120) || "anonymous";
  const existing = await repo.raw("SELECT 1 AS ok FROM plugin_stars WHERE plugin_id = ? AND identity = ? LIMIT 1", [
    plugin.id,
    who,
  ]);
  if (!existing[0]) return { starred: false, starCount: plugin.starCount };
  await repo.run("DELETE FROM plugin_stars WHERE plugin_id = ? AND identity = ?", [plugin.id, who]);
  const starCount = Math.max(0, plugin.starCount - 1);
  await repo.run("UPDATE plugins SET star_count = ? WHERE id = ?", [starCount, plugin.id]);
  return { starred: false, starCount };
}

export async function reportPlugin(
  repo: Repository,
  slug: string,
  input: { reason: string; identity?: string },
  actor?: PluginActor,
): Promise<{ reportCount: number }> {
  const plugin = await getPluginBySlug(repo, slug);
  if (!plugin) throw new Error(`插件不存在：${slug}`);
  const reason = input.reason.trim().slice(0, 500) || "（未填写理由）";
  const reportCount = plugin.reportCount + 1;
  await repo.run("UPDATE plugins SET report_count = ? WHERE id = ?", [reportCount, plugin.id]);
  await repo.recordEvent("plugin_report", {
    identity: input.identity,
    meta: { slug, reason },
  });
  await repo.audit({
    actor: actor?.actor ?? input.identity ?? "anonymous",
    actorKind: actor?.actorKind,
    action: "plugin.report",
    target: slug,
    diff: { reason },
    ip: actor?.ip,
  });
  return { reportCount };
}

export async function hasUserStarredPlugin(
  repo: Repository,
  pluginId: string,
  identity: string,
): Promise<boolean> {
  const who = identity.trim().slice(0, 120);
  if (!who) return false;
  const rows = await repo.raw("SELECT 1 AS ok FROM plugin_stars WHERE plugin_id = ? AND identity = ? LIMIT 1", [
    pluginId,
    who,
  ]);
  return Boolean(rows[0]);
}

/** 获取某用户安装时保留的清单快照 */
export async function getPluginInstalledManifest(
  repo: Repository,
  pluginId: string,
  identity: string,
): Promise<PluginManifest | null> {
  const install = await getPluginInstall(repo, pluginId, identity);
  if (!install || !install.meta || typeof install.meta !== "object") return null;
  const metaObj = install.meta as Record<string, unknown>;
  if (metaObj.manifest && typeof metaObj.manifest === "object") {
    return metaObj.manifest as PluginManifest;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 插件生态遥测与大盘指标 (Plugin Ecosystem Telemetry)
 * ------------------------------------------------------------------ */

export interface PluginTelemetryMetrics {
  totalPlugins: number;
  publishedCount: number;
  pendingCount: number;
  rejectedCount: number;
  delistedCount: number;
  totalInstalls: number;
  activeInstalls: number;
  totalStars: number;
  totalReports: number;
  kindDistribution: {
    sitePack: number;
    workspacePreset: number;
    theme: number;
  };
  topInstalled: Array<{
    id: string;
    slug: string;
    name: string;
    kind: string;
    version: string;
    installCount: number;
    starCount: number;
  }>;
}

export async function getPluginTelemetry(repo: Repository): Promise<PluginTelemetryMetrics> {
  const statRows = await repo.raw(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status = 'delisted' THEN 1 ELSE 0 END) AS delisted,
      COALESCE(SUM(install_count), 0) AS total_installs,
      COALESCE(SUM(report_count), 0) AS total_reports,
      SUM(CASE WHEN kind = 'site-pack' AND status = 'published' THEN 1 ELSE 0 END) AS site_packs,
      SUM(CASE WHEN kind = 'workspace-preset' AND status = 'published' THEN 1 ELSE 0 END) AS workspace_presets,
      SUM(CASE WHEN kind = 'theme' AND status = 'published' THEN 1 ELSE 0 END) AS themes
    FROM plugins
  `);

  const stat = statRows[0] ?? {};

  const activeRow = (await repo.raw("SELECT COUNT(*) AS cnt FROM plugin_installs WHERE removed_at IS NULL"))[0];
  const starRow = (await repo.raw("SELECT COUNT(*) AS cnt FROM plugin_stars"))[0];

  const topRows = await repo.raw(`
    SELECT id, slug, name, kind, version, install_count, star_count
    FROM plugins
    WHERE status = 'published'
    ORDER BY install_count DESC, star_count DESC
    LIMIT 5
  `);

  return {
    totalPlugins: Number(stat.total ?? 0),
    publishedCount: Number(stat.published ?? 0),
    pendingCount: Number(stat.pending ?? 0),
    rejectedCount: Number(stat.rejected ?? 0),
    delistedCount: Number(stat.delisted ?? 0),
    totalInstalls: Number(stat.total_installs ?? 0),
    activeInstalls: Number(activeRow?.cnt ?? 0),
    totalStars: Number(starRow?.cnt ?? 0),
    totalReports: Number(stat.total_reports ?? 0),
    kindDistribution: {
      sitePack: Number(stat.site_packs ?? 0),
      workspacePreset: Number(stat.workspace_presets ?? 0),
      theme: Number(stat.themes ?? 0),
    },
    topInstalled: topRows.map((r) => ({
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      kind: String(r.kind),
      version: String(r.version),
      installCount: Number(r.install_count ?? 0),
      starCount: Number(r.star_count ?? 0),
    })),
  };
}

