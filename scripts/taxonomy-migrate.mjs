#!/usr/bin/env node
/**
 * 类目树 P3 数据迁移（方案 `elegant-haven-moorhen`，2026-10-22）。
 *
 * 解决的是「表结构已经换成新树、数据还挂在旧形态上」这一层：
 *   - 2026-10-21 那批 962 条回收站站点的 category_id / sub_category_id 全悬空
 *     （旧插件类目被清扫，站点行还在）；按备份里的旧标题反查回唯一叶子。
 *   - 5 个平铺种子根上的存活站点下移到叶子，随后删除空根。
 *   - 回填 registry 投影、锚点前缀；数据干净后才登记「每父标题唯一」索引。
 *   - 标签只做两步：删仍处回收站站点的 site_tags 行；剩余零引用标签出提案，
 *     **人工采纳后才删**（本脚本绝不 DELETE FROM tags）。
 *
 * 用法：
 *   node scripts/taxonomy-migrate.mjs --db data/navhub.db                    # dry-run（只读，报表）
 *   node scripts/taxonomy-migrate.mjs --db data/navhub.db --apply --restore-matched
 *   node scripts/taxonomy-migrate.mjs --help
 *
 * 破坏性脚本三条硬约定（范本 scripts/purge-test-plugins.mjs）：
 *   1. 默认 dry-run，只打印统计，不写库；
 *   2. 必须显式 --apply 才写；
 *   3. --db <path> 必填，路径不存在即 exit(1)。
 *
 * 运行前提：P2 的 registry 已合并；`:8787` 已停（WAL 仍可能被并行会话写入）；
 * 迁移前后各跑一次 `node scripts/backup.mjs`。脚本自己打开库时也传
 * skipOrphanCleanup=true，避免清扫在迁移窗口吃掉刚建的叶子。
 *
 * 回滚：category_remaps 按 batch_id 反向 UPDATE sites；整库还原走 data/backups/
 * （docs/BACKUP-RUNBOOK.md）。脚本在报表末尾打印回滚模板。
 */
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import {
  CATEGORY_REGISTRY,
  REGISTRY_BY_SLUG,
  UNCATEGORIZED_SLUG,
  isRegistryLeaf,
  registryId,
  resolveRegistryEntry,
  resolveRegistryLeaf,
} from "../packages/core/src/category-registry.ts";
import {
  UNCATEGORIZED_CATEGORY_ID,
  UNCATEGORIZED_CATEGORY_TITLE,
  categoryGapProposalId,
  levenshteinDistance,
  normalizeCategoryKey,
} from "../packages/core/src/taxonomy-governance.ts";
import { openDb } from "../packages/store/src/driver.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function loadDep(name) {
  for (const candidate of [name, path.join(ROOT, "packages", "store", "node_modules", name)]) {
    try {
      return require(candidate);
    } catch {
      /* 继续试下一个位置 */
    }
  }
  return null;
}

const Database = loadDep("better-sqlite3");

/** 只清这批历史种子根；用户自建的平铺类目哪怕空了也不在这里删 */
const LEGACY_SEED_ROOT_IDS = new Set(["cat-ai", "cat-dev", "cat-design", "cat-learn", "cat-life"]);

/** 方案第 4 步的「治理线」：缺口占比超过它就不许 apply，先人工看解析规则 */
export const MAX_GAP_RATIO = 0.05;

const EXIT_USAGE = 1;
const EXIT_PREFLIGHT = 2;

function usage() {
  console.log(`用法: node scripts/taxonomy-migrate.mjs --db <path> [options]

  --db <path>            SQLite 数据库（必填；不存在即退出）
  --backup-db <path>     旧库备份，用来反查悬空类目 id 的标题（默认自动挑覆盖率最高的）
  --apply                真正写库（默认 dry-run，只读）
  --restore-matched      只恢复 remap 命中的回收站站点（缺口站点继续留在回收站）
  --batch-id <id>        指定本批次 id（默认时间戳），回滚按它反向 UPDATE
  --help, -h             显示本帮助

退出码：0 成功；1 用法/文件错误；2 预检未通过（缺口 >=5% 或类目冲突）。`);
}

export function parseArgs(argv) {
  const args = {
    db: null,
    backupDb: null,
    apply: false,
    restoreMatched: false,
    batchId: null,
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--db") args.db = argv[++i];
    else if (a === "--backup-db") args.backupDb = argv[++i];
    else if (a === "--apply") args.apply = true;
    else if (a === "--restore-matched") args.restoreMatched = true;
    else if (a === "--batch-id") args.batchId = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else {
      console.error(`未知参数: ${a}（--help 查看用法）`);
      process.exit(EXIT_USAGE);
    }
  }
  return args;
}

function openReadonly(file) {
  if (!Database) {
    throw new Error("无法加载 better-sqlite3（请先在仓库根执行 pnpm install）");
  }
  return new Database(file, { readonly: true, fileMustExist: true });
}

function tableColumns(raw, table) {
  try {
    return new Set(raw.prepare(`PRAGMA table_info(${table})`).all().map((r) => String(r.name)));
  } catch {
    return new Set();
  }
}

function normalizeUrl(url) {
  return String(url ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * 旧标题 → 叶子。三段式（方案 P3 第 3 步）：
 *   1. legacyTitles 精确（旧包标题的唯一归宿）
 *   2. 叶子标题 / altLabels 精确
 *   3. 规范化后的编辑距离模糊（同分即视为歧义，不猜）
 * 只解析叶子：一级根不是站点归属，命中根等于没命中。
 */
export function buildTitleResolver() {
  const legacy = new Map();
  const exact = new Map();
  const alt = new Map();
  const fuzzy = [];

  const put = (map, name, entry) => {
    const key = String(name ?? "").trim().toLowerCase();
    if (!key || map.has(key)) return;
    map.set(key, entry);
  };

  for (const entry of CATEGORY_REGISTRY) {
    if (!entry.parentSlug) continue;
    for (const t of entry.legacyTitles) put(legacy, t, entry);
    put(exact, entry.title, entry);
    for (const t of entry.altLabels) put(alt, t, entry);
    for (const t of [entry.title, ...entry.altLabels, ...entry.legacyTitles]) {
      const key = normalizeCategoryKey(t);
      if (key) fuzzy.push({ key, entry });
    }
  }

  return function resolve(title) {
    const rawTitle = String(title ?? "").trim();
    if (!rawTitle) return null;
    const lower = rawTitle.toLowerCase();
    if (legacy.has(lower)) return { leaf: legacy.get(lower), strategy: "legacy" };
    if (exact.has(lower)) return { leaf: exact.get(lower), strategy: "title" };
    if (alt.has(lower)) return { leaf: alt.get(lower), strategy: "alt" };

    const norm = normalizeCategoryKey(rawTitle);
    if (!norm) return null;
    let bestDist = Number.POSITIVE_INFINITY;
    let best = new Map();
    for (const candidate of fuzzy) {
      const dist = levenshteinDistance(norm, candidate.key);
      const maxDist = Math.max(1, Math.min(3, Math.floor(Math.min(norm.length, candidate.key.length) / 4)));
      if (dist > maxDist) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = new Map([[candidate.entry.slug, candidate.entry]]);
      } else if (dist === bestDist) {
        best.set(candidate.entry.slug, candidate.entry);
      }
    }
    if (best.size === 1) return { leaf: [...best.values()][0], strategy: "fuzzy" };
    return null;
  };
}

function loadSeedSites() {
  try {
    const raw = JSON.parse(readFileSync(path.join(ROOT, "apps", "api", "src", "seed-data.json"), "utf8"));
    return Array.isArray(raw.sites) ? raw.sites : [];
  } catch {
    return [];
  }
}

/**
 * 只认「已经是 registry 投影」的行。
 *
 * 不能退化成「标题能解析到叶子」：旧插件类目的标题本来就能解析到叶子
 * （这正是 remap 的依据），拿它当已映射会让所有待迁移站点被跳过。
 */
function isRegistryLeafCategory(row) {
  if (!row) return false;
  const slug = row.slug == null ? null : String(row.slug);
  if (!slug || !isRegistryLeaf(slug)) return false;
  return row.id === registryId(slug) || row.source === "registry";
}

function categoryRef(row, map) {
  if (!row) return null;
  const parentId = row.parent_id == null ? null : String(row.parent_id);
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    parentId,
    parentTitle: parentId ? (map.get(parentId)?.title ?? null) : null,
    slug: row.slug == null ? null : String(row.slug),
    source: row.source == null ? null : String(row.source),
  };
}

function pickOldCategory(id, sourceMap, backupMap) {
  if (!id) return null;
  const sourceRow = sourceMap.get(String(id));
  if (sourceRow) return categoryRef(sourceRow, sourceMap);
  const backupRow = backupMap.get(String(id));
  return backupRow ? categoryRef(backupRow, backupMap) : null;
}

/**
 * 从备份里挑「能解析最多悬空类目 id」的那份。
 *
 * 不能简单取最新：迁移前刚跑的安全备份里，这些类目已经被清掉了（覆盖率为 0），
 * 真正带旧标题的是事故前那份。
 */
export function findBestBackup(dbPath, orphanIds) {
  const dir = path.join(ROOT, "data", "backups");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => {
      const p = path.join(dir, f);
      return { path: p, mtime: statSync(p).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length === 0) return null;

  let best = null;
  for (const file of files) {
    let coverage = 0;
    try {
      const db = openReadonly(file.path);
      try {
        for (const id of orphanIds) {
          if (db.prepare("SELECT 1 FROM categories WHERE id = ? LIMIT 1").get(id)) coverage += 1;
        }
      } finally {
        db.close();
      }
    } catch {
      continue;
    }
    if (!best || coverage > best.coverage || (coverage === best.coverage && file.mtime > best.mtime)) {
      best = { path: file.path, coverage, mtime: file.mtime };
    }
  }
  return best;
}

/**
 * 只读分析：不依赖 slug 列、不依赖 registry 已落地，直接用 core 的权威树解析。
 * dry-run 走这里，apply 也先走这里做预检（缺口超线时一行都不写）。
 */
export function analyzeTaxonomy({ dbPath, backupDbPath = null, restoreMatched = false }) {
  if (!existsSync(dbPath)) throw new Error(`数据库不存在: ${dbPath}`);
  const source = openReadonly(dbPath);
  const sourceCats = source.prepare("SELECT * FROM categories").all();
  const sourceMap = new Map(sourceCats.map((r) => [String(r.id), r]));
  const sourceCols = tableColumns(source, "categories");
  const sites = source.prepare("SELECT * FROM sites").all();
  const siteTags = source.prepare("SELECT site_id, tag_id FROM site_tags").all();
  const tagRows = source.prepare("SELECT id, name FROM tags").all();
  const tagNameById = new Map(tagRows.map((t) => [String(t.id), String(t.name)]));
  const tagsBySite = new Map();
  for (const r of siteTags) {
    const list = tagsBySite.get(String(r.site_id)) ?? [];
    list.push(tagNameById.get(String(r.tag_id)) ?? "");
    tagsBySite.set(String(r.site_id), list);
  }

  const trashed = sites.filter((s) => s.deleted_at != null);
  const active = sites.filter((s) => s.deleted_at == null);

  const orphanIds = new Set();
  for (const s of trashed) {
    if (s.category_id && !sourceMap.has(String(s.category_id))) orphanIds.add(String(s.category_id));
    if (s.sub_category_id && !sourceMap.has(String(s.sub_category_id))) orphanIds.add(String(s.sub_category_id));
  }

  const chosenBackup = backupDbPath
    ? { path: path.resolve(ROOT, backupDbPath), coverage: null, mtime: null }
    : findBestBackup(dbPath, [...orphanIds]);
  let backup = null;
  let backupCats = [];
  if (chosenBackup && existsSync(chosenBackup.path)) {
    backup = openReadonly(chosenBackup.path);
    backupCats = backup.prepare("SELECT * FROM categories").all();
  }
  const backupMap = new Map(backupCats.map((r) => [String(r.id), r]));
  if (chosenBackup && chosenBackup.coverage == null) {
    chosenBackup.coverage = [...orphanIds].filter((id) => backupMap.has(id)).length;
  }

  const resolveTitle = buildTitleResolver();
  const seedByUrl = new Map(loadSeedSites().map((s) => [normalizeUrl(s.url), s]));

  const planSite = (categoryRow, subRow) => {
    const primary = categoryRow ? resolveTitle(categoryRow.title) : null;
    const sub = subRow ? resolveTitle(subRow.title) : null;
    if (primary && sub && primary.leaf.parentSlug === sub.leaf.parentSlug && primary.leaf.slug !== sub.leaf.slug) {
      return { categoryLeaf: primary.leaf, subLeaf: sub.leaf, strategy: `sub:${sub.strategy}` };
    }
    if (primary) return { categoryLeaf: primary.leaf, subLeaf: null, strategy: primary.strategy };
    if (sub) return { categoryLeaf: sub.leaf, subLeaf: null, strategy: `subonly:${sub.strategy}` };
    return null;
  };

  const trashedByStrategy = {};
  const gapTitles = new Map();
  const trashedPlans = [];
  let alreadyMapped = 0;
  for (const s of trashed) {
    const categoryRow = pickOldCategory(s.category_id, sourceMap, backupMap);
    const subRow = pickOldCategory(s.sub_category_id, sourceMap, backupMap);
    if (isRegistryLeafCategory(categoryRow)) {
      alreadyMapped += 1;
      continue;
    }
    const plan = planSite(categoryRow, subRow);
    if (plan) {
      trashedByStrategy[plan.strategy] = (trashedByStrategy[plan.strategy] ?? 0) + 1;
      trashedPlans.push({ site: s, categoryRow, subRow, ...plan, gap: false });
    } else {
      const gapTitle = categoryRow?.title || `（缺失类目 ${String(s.category_id).slice(0, 8)}）`;
      const bucket = gapTitles.get(gapTitle) ?? { title: gapTitle, count: 0, siteIds: [] };
      bucket.count += 1;
      bucket.siteIds.push(String(s.id));
      gapTitles.set(gapTitle, bucket);
      trashedPlans.push({
        site: s,
        categoryRow,
        subRow,
        categoryLeaf: null,
        subLeaf: null,
        strategy: "gap",
        gap: true,
      });
    }
  }

  const activeOnLegacy = active.filter((s) => {
    const row = sourceMap.get(String(s.category_id));
    // 悬空 category_id（row 为 undefined）同样要重新解析，不能因为「查不到」就漏掉
    return !isRegistryLeafCategory(row);
  });
  const activePlans = [];
  const activeUnmatched = [];
  const activeByStrategy = {};
  for (const s of activeOnLegacy) {
    const categoryRow = pickOldCategory(s.category_id, sourceMap, backupMap);
    const subRow = pickOldCategory(s.sub_category_id, sourceMap, backupMap);
    const seedSite = seedByUrl.get(normalizeUrl(s.url));
    let plan = null;
    let strategy = null;
    if (seedSite?.categorySlug) {
      const leaf = resolveRegistryLeaf(seedSite.categorySlug);
      if (leaf) {
        plan = { categoryLeaf: leaf, subLeaf: null };
        strategy = "seed_url";
      }
    }
    if (!plan) {
      const tagLeaves = new Map();
      for (const name of tagsBySite.get(String(s.id)) ?? []) {
        const leaf = resolveRegistryLeaf(name);
        if (leaf) tagLeaves.set(leaf.slug, leaf);
      }
      if (tagLeaves.size === 1) {
        plan = { categoryLeaf: [...tagLeaves.values()][0], subLeaf: null };
        strategy = "tag";
      }
    }
    if (!plan) {
      const titlePlan = planSite(categoryRow, subRow);
      if (titlePlan) {
        plan = { categoryLeaf: titlePlan.categoryLeaf, subLeaf: titlePlan.subLeaf };
        strategy = titlePlan.strategy;
      }
    }
    if (plan) {
      activeByStrategy[strategy] = (activeByStrategy[strategy] ?? 0) + 1;
      activePlans.push({ site: s, categoryRow, subRow, ...plan, gap: false, strategy });
    } else {
      const gapTitle = categoryRow?.title || `（缺失类目 ${String(s.category_id).slice(0, 8)}）`;
      const bucket = gapTitles.get(gapTitle) ?? { title: gapTitle, count: 0, siteIds: [] };
      bucket.count += 1;
      bucket.siteIds.push(String(s.id));
      gapTitles.set(gapTitle, bucket);
      activeUnmatched.push({ id: String(s.id), title: String(s.title ?? ""), url: String(s.url ?? ""), gapTitle });
      activePlans.push({
        site: s,
        categoryRow,
        subRow,
        categoryLeaf: null,
        subLeaf: null,
        strategy: "gap",
        gap: true,
      });
    }
  }

  const activeUrls = new Set(active.map((s) => normalizeUrl(s.url)));
  const restoredUrls = new Set();
  let restoreCandidates = 0;
  let restoreCollisions = 0;
  let restoreDuplicates = 0;
  for (const plan of trashedPlans) {
    if (!restoreMatched || plan.gap) continue;
    const url = normalizeUrl(plan.site.url);
    if (activeUrls.has(url)) {
      restoreCollisions += 1;
      plan.restore = false;
      continue;
    }
    // 回收站内部也可能有同 URL 重复行，恢复前先去重，否则唯一约束/后续去重作业会炸
    if (restoredUrls.has(url)) {
      restoreDuplicates += 1;
      plan.restore = false;
      continue;
    }
    restoredUrls.add(url);
    plan.restore = true;
    restoreCandidates += 1;
  }

  // registry 投影后的类目集合：用来预检「每父标题唯一」索引能不能登记
  const postById = new Map(),
    postBySlug = new Map();
  for (const c of sourceCats) {
    if (LEGACY_SEED_ROOT_IDS.has(String(c.id))) continue;
    const row = { id: String(c.id), parentId: c.parent_id == null ? null : String(c.parent_id), title: String(c.title), slug: c.slug == null ? null : String(c.slug) };
    postById.set(row.id, row);
    if (row.slug) postBySlug.set(row.slug, row);
  }
  for (const entry of CATEGORY_REGISTRY) {
    const id = registryId(entry.slug);
    const parentId = entry.parentSlug ? registryId(entry.parentSlug) : null;
    const existingBySlug = postBySlug.get(entry.slug);
    if (existingBySlug) {
      existingBySlug.title = entry.title;
      existingBySlug.parentId = parentId;
      continue;
    }
    const row = { id, parentId, title: entry.title, slug: entry.slug };
    postById.set(id, row);
    postBySlug.set(entry.slug, row);
  }
  if (!postById.has(UNCATEGORIZED_CATEGORY_ID)) {
    postById.set(UNCATEGORIZED_CATEGORY_ID, {
      id: UNCATEGORIZED_CATEGORY_ID,
      parentId: null,
      title: UNCATEGORIZED_CATEGORY_TITLE,
      slug: UNCATEGORIZED_SLUG,
    });
  }
  const dupGroups = new Map();
  for (const c of postById.values()) {
    const key = `${c.parentId ?? "__root__"}\u0000${c.title}`;
    const list = dupGroups.get(key) ?? [];
    list.push(c);
    dupGroups.set(key, list);
  }
  const duplicates = [...dupGroups.values()]
    .filter((list) => list.length > 1)
    .map((list) => ({ title: list[0].title, parentId: list[0].parentId, ids: list.map((c) => c.id) }));

  // slug 冲突：已有非 registry 行占了 registry slug，投影会把它当成 registry 条目，
  // 这条路太隐晦，apply 前直接停。
  const registryConflicts = [];
  for (const entry of CATEGORY_REGISTRY) {
    const existing = sourceMap.get(registryId(entry.slug)) ?? sourceCats.find((c) => c.slug === entry.slug);
    if (existing && existing.id !== registryId(entry.slug) && existing.source !== "registry") {
      registryConflicts.push({ slug: entry.slug, id: String(existing.id), source: existing.source ?? null });
    }
  }

  const finalTrashed = trashedPlans.filter((p) => !p.restore);
  const aliveIds = new Set(active.map((s) => String(s.id)));
  for (const p of trashedPlans) if (p.restore) aliveIds.add(String(p.site.id));
  const aliveTagRefs = new Set();
  for (const r of siteTags) if (aliveIds.has(String(r.site_id))) aliveTagRefs.add(String(r.tag_id));
  const zeroRefTags = tagRows
    .filter((t) => !aliveTagRefs.has(String(t.id)))
    .map((t) => ({ id: String(t.id), name: String(t.name) }));
  const orphanTagRows = finalTrashed.reduce(
    (n, p) => n + siteTags.filter((r) => String(r.site_id) === String(p.site.id)).length,
    0,
  );

  const legacyRoots = sourceCats
    .filter((c) => LEGACY_SEED_ROOT_IDS.has(String(c.id)))
    .map((c) => ({
      id: String(c.id),
      title: String(c.title),
      children: sourceCats.filter((x) => String(x.parent_id ?? "") === String(c.id)).length,
      refs:
        sites.filter((s) => String(s.category_id) === String(c.id) || String(s.sub_category_id) === String(c.id)).length,
    }));

  const matched = trashedPlans.filter((p) => !p.gap).length;
  const gapCount = trashedPlans.filter((p) => p.gap).length;
  const totalTrashed = trashedPlans.length + alreadyMapped;
  const report = {
    dbPath: path.resolve(ROOT, dbPath),
    backupPath: chosenBackup ? path.resolve(ROOT, chosenBackup.path) : null,
    backupCoverage: chosenBackup ? { resolved: chosenBackup.coverage, needed: orphanIds.size } : null,
    schema: { hasSlug: sourceCols.has("slug"), hasCategoryRemaps: tableColumns(source, "category_remaps").size > 0 },
    source: {
      categories: sourceCats.length,
      activeSites: active.length,
      trashedSites: trashed.length,
      danglingCategoryIds: orphanIds.size,
    },
    trashed: {
      total: totalTrashed,
      matched,
      gap: gapCount,
      alreadyMapped,
      gapRatio: totalTrashed === 0 ? 0 : gapCount / totalTrashed,
      byStrategy: trashedByStrategy,
      gapTitles: [...gapTitles.values()].sort((a, b) => b.count - a.count),
      restoreMatched,
      restoreCandidates,
      restoreCollisions,
      restoreDuplicates,
    },
    active: {
      total: active.length,
      onLegacyCategories: activeOnLegacy.length,
      movable: activePlans.filter((p) => !p.gap).length,
      unmatched: activeUnmatched,
      byStrategy: activeByStrategy,
    },
    legacyRoots,
    duplicates,
    registryConflicts,
    tags: {
      orphanTagRows,
      zeroRefTags,
      deleteOrphanRows: restoreMatched,
    },
    plans: { trashed: trashedPlans, active: activePlans },
  };

  source.close();
  backup?.close();
  return report;
}

function ensureRemapTable(raw) {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS category_remaps (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      field TEXT NOT NULL,
      old_id TEXT,
      old_title TEXT,
      old_parent_title TEXT,
      new_leaf_id TEXT,
      strategy TEXT NOT NULL,
      old_deleted_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS category_remaps_batch_idx ON category_remaps(batch_id);
    CREATE INDEX IF NOT EXISTS category_remaps_site_idx ON category_remaps(site_id);
  `);
}

function ensureUncategorized(raw) {
  const existing = raw.prepare("SELECT id FROM categories WHERE id = ? LIMIT 1").get(UNCATEGORIZED_CATEGORY_ID);
  if (existing) return String(existing.id);
  const bySlug = raw.prepare("SELECT id FROM categories WHERE slug = ? LIMIT 1").get(UNCATEGORIZED_SLUG);
  if (bySlug && bySlug.id !== UNCATEGORIZED_CATEGORY_ID) {
    throw new Error(`slug「${UNCATEGORIZED_SLUG}」已被类目 ${bySlug.id} 占用，未分类无法落固定 id`);
  }
  const now = Date.now();
  raw
    .prepare(
      `INSERT INTO categories
        (id, anchor, parent_id, title, title_en, slug, description, icon, enabled, sort, source,
         alt_labels, related_categories, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      UNCATEGORIZED_CATEGORY_ID,
      UNCATEGORIZED_CATEGORY_ID,
      null,
      UNCATEGORIZED_CATEGORY_TITLE,
      "Uncategorized",
      UNCATEGORIZED_SLUG,
      "待归类的站点兜底位置，不出现在导航与站点地图",
      "folder",
      1,
      999,
      "system",
      "[]",
      "[]",
      now,
      now,
    );
  return UNCATEGORIZED_CATEGORY_ID;
}

/**
 * registry 是封闭集合，库里的行只是投影。这里直接按 registryId 落行，不复用
 * seedCategoryRegistry 的「同父同名就复用」路径——那条路径会把 cat-ai 当成
 * 「AI 工具」根（旧种子根与 registry 根同名），于是稳定 id 约定悄悄失效。
 * 旧根在这一步之后由 deleteLegacyRoots 删除。
 */
function ensureRegistryProjection(raw, report) {
  const now = Date.now();
  const byId = raw.prepare("SELECT * FROM categories WHERE id = ? LIMIT 1");
  const bySlug = raw.prepare("SELECT * FROM categories WHERE slug = ? LIMIT 1");
  let created = 0;
  let patched = 0;

  for (const entry of CATEGORY_REGISTRY) {
    const id = registryId(entry.slug);
    const parentId = entry.parentSlug ? registryId(entry.parentSlug) : null;
    let row = byId.get(id);
    if (!row) {
      const slugRow = bySlug.get(entry.slug);
      if (slugRow) {
        if (slugRow.source !== "registry" && slugRow.id !== id) {
          throw new Error(`registry slug「${entry.slug}」被非 registry 类目 ${slugRow.id} 占用，拒绝迁移`);
        }
        row = slugRow;
      }
    }
    if (row) {
      const patch = {};
      if (!row.slug) patch.slug = entry.slug;
      if (!row.title_en && entry.titleEn) patch.title_en = entry.titleEn;
      if (!row.description && entry.description) patch.description = entry.description;
      if (!row.icon && entry.icon) patch.icon = entry.icon;
      if (!row.sort && entry.sort) patch.sort = entry.sort;
      if (!row.parent_id && parentId) patch.parent_id = parentId;
      if ((row.source ?? null) !== "registry" && row.id === id) patch.source = "registry";
      const keys = Object.keys(patch);
      if (keys.length > 0) {
        const sets = keys.map((k) => `${k} = ?`).join(", ");
        raw.prepare(`UPDATE categories SET ${sets}, updated_at = ? WHERE id = ?`).run(
          ...keys.map((k) => patch[k]),
          now,
          String(row.id),
        );
        patched += 1;
      }
      continue;
    }
    const anchor = parentId
      ? String(byId.get(parentId)?.anchor ?? parentId) + "/" + id
      : id;
    raw
      .prepare(
        `INSERT INTO categories
          (id, anchor, parent_id, title, title_en, slug, description, icon, enabled, sort, source,
           alt_labels, related_categories, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        anchor,
        parentId,
        entry.title,
        entry.titleEn,
        entry.slug,
        entry.description,
        entry.icon ?? null,
        1,
        entry.sort,
        "registry",
        JSON.stringify(entry.altLabels),
        "[]",
        now,
        now,
      );
    created += 1;
  }

  // 锚点按 registry 形状重写：只动 registry 行，旧根/用户类目保持原样
  for (const entry of CATEGORY_REGISTRY) {
    const id = registryId(entry.slug);
    const anchor = entry.parentSlug
      ? String(byId.get(registryId(entry.parentSlug))?.anchor ?? registryId(entry.parentSlug)) + "/" + id
      : id;
    raw.prepare("UPDATE categories SET anchor = ?, updated_at = ? WHERE id = ?").run(anchor, now, id);
  }
  report.registry = { total: CATEGORY_REGISTRY.length, created, patched };
  return report.registry;
}

function insertRemap(raw, batchId, siteId, field, oldId, oldTitle, oldParentTitle, newLeafId, strategy, oldDeletedAt) {
  raw
    .prepare(
      `INSERT INTO category_remaps
        (id, batch_id, site_id, field, old_id, old_title, old_parent_title, new_leaf_id, strategy, old_deleted_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      randomUUID(),
      batchId,
      String(siteId),
      field,
      oldId == null ? null : String(oldId),
      oldTitle == null ? null : String(oldTitle),
      oldParentTitle == null ? null : String(oldParentTitle),
      newLeafId == null ? null : String(newLeafId),
      strategy,
      oldDeletedAt == null ? null : Number(oldDeletedAt),
      Date.now(),
    );
}

function applyPlans(raw, report, batchId, uncategorizedId) {
  const update = raw.prepare("UPDATE sites SET category_id = ?, sub_category_id = ?, deleted_at = ? WHERE id = ?");
  let restored = 0;
  let movedActive = 0;
  let remapRows = 0;

  for (const plan of report.plans.trashed) {
    const categoryLeafId = plan.gap ? uncategorizedId : registryId(plan.categoryLeaf.slug);
    const subLeafId = plan.subLeaf ? registryId(plan.subLeaf.slug) : null;
    const deletedAt = plan.restore ? null : plan.site.deleted_at;
    update.run(categoryLeafId, subLeafId, deletedAt, String(plan.site.id));
    insertRemap(
      raw,
      batchId,
      plan.site.id,
      "category",
      plan.site.category_id,
      plan.categoryRow?.title ?? null,
      plan.categoryRow?.parentTitle ?? null,
      categoryLeafId,
      plan.strategy,
      plan.site.deleted_at,
    );
    remapRows += 1;
    if (String(plan.site.sub_category_id ?? "") !== String(subLeafId ?? "")) {
      insertRemap(
        raw,
        batchId,
        plan.site.id,
        "sub_category",
        plan.site.sub_category_id,
        plan.subRow?.title ?? null,
        plan.subRow?.parentTitle ?? plan.categoryRow?.title ?? null,
        subLeafId,
        plan.strategy,
        plan.site.deleted_at,
      );
      remapRows += 1;
    }
    if (plan.restore) restored += 1;
  }

  for (const plan of report.plans.active) {
    const categoryLeafId = plan.gap ? uncategorizedId : registryId(plan.categoryLeaf.slug);
    const subLeafId = plan.subLeaf ? registryId(plan.subLeaf.slug) : null;
    update.run(categoryLeafId, subLeafId, null, String(plan.site.id));
    insertRemap(
      raw,
      batchId,
      plan.site.id,
      "category",
      plan.site.category_id,
      plan.categoryRow?.title ?? null,
      plan.categoryRow?.parentTitle ?? null,
      categoryLeafId,
      plan.strategy,
      null,
    );
    remapRows += 1;
    if (plan.site.sub_category_id != null && String(plan.site.sub_category_id) !== String(subLeafId ?? "")) {
      insertRemap(
        raw,
        batchId,
        plan.site.id,
        "sub_category",
        plan.site.sub_category_id,
        plan.subRow?.title ?? null,
        plan.subRow?.parentTitle ?? plan.categoryRow?.title ?? null,
        subLeafId,
        plan.strategy,
        null,
      );
      remapRows += 1;
    }
    movedActive += 1;
  }

  report.applied = {
    ...(report.applied ?? {}),
    restored,
    movedActive,
    remapRows,
  };
}

function deleteLegacyRoots(raw, report) {
  const deleted = [];
  const skipped = [];
  const refsStmt = raw.prepare(
    "SELECT COUNT(*) AS n FROM sites WHERE category_id = ? OR sub_category_id = ?",
  );
  const childStmt = raw.prepare("SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?");
  for (const root of report.legacyRoots) {
    const refs = Number(refsStmt.get(root.id, root.id)?.n ?? 0);
    const children = Number(childStmt.get(root.id)?.n ?? 0);
    if (refs > 0 || children > 0) {
      skipped.push({ ...root, refs, children });
      continue;
    }
    raw.prepare("DELETE FROM categories WHERE id = ?").run(root.id);
    deleted.push(root.id);
  }
  report.applied = { ...(report.applied ?? {}), legacyRootsDeleted: deleted, legacyRootsSkipped: skipped };
}

function findDuplicateTitles(raw) {
  return raw
    .prepare(
      `SELECT COALESCE(parent_id, '') AS p, title, COUNT(*) AS n
         FROM categories GROUP BY p, title HAVING COUNT(*) > 1 ORDER BY n DESC`,
    )
    .all()
    .map((r) => ({ parentId: r.p || null, title: String(r.title), count: Number(r.n) }));
}

function createTitleIndexes(raw) {
  raw.exec("CREATE UNIQUE INDEX IF NOT EXISTS categories_child_title_uniq ON categories(parent_id, title) WHERE parent_id IS NOT NULL");
  raw.exec("CREATE UNIQUE INDEX IF NOT EXISTS categories_root_title_uniq ON categories(title) WHERE parent_id IS NULL");
}

function cleanupTags(raw, report) {
  let orphanDeleted = 0;
  if (report.tags.deleteOrphanRows) {
    const res = raw
      .prepare("DELETE FROM site_tags WHERE site_id IN (SELECT id FROM sites WHERE deleted_at IS NOT NULL)")
      .run();
    orphanDeleted = Number(res.changes ?? 0);
  }

  const now = Date.now();
  const zeroRef = raw
    .prepare(
      `SELECT t.id, t.name FROM tags t
        WHERE NOT EXISTS (SELECT 1 FROM site_tags st WHERE st.tag_id = t.id)
        ORDER BY t.name`,
    )
    .all();
  const insert = raw.prepare(
    `INSERT OR IGNORE INTO taxonomy_proposals
      (id, kind, target_id, target_title, current_value, suggested_value, confidence, reason, status, meta, created_at, applied_at)
     VALUES (?,?,?,?,?,?,?,?, 'pending', ?, ?, NULL)`,
  );
  let proposals = 0;
  for (const tag of zeroRef) {
    insert.run(
      `tag_zero_ref_${encodeURIComponent(String(tag.name))}`,
      "tag_consolidation",
      String(tag.name),
      String(tag.name),
      String(tag.name),
      String(tag.name),
      0.6,
      `标签「${tag.name}」在存活站点中零引用（迁移后复核），建议删除`,
      JSON.stringify({ action: "delete", source: "taxonomy-migrate", refCount: 0 }),
      now,
    );
    proposals += 1;
  }
  report.applied = {
    ...(report.applied ?? {}),
    tagOrphanRowsDeleted: orphanDeleted,
    zeroRefTagProposals: proposals,
    zeroRefTags: zeroRef.length,
  };
}

function writeGapProposals(raw, report, batchId) {
  const now = Date.now();
  const insert = raw.prepare(
    `INSERT OR IGNORE INTO taxonomy_proposals
      (id, kind, target_id, target_title, current_value, suggested_value, confidence, reason, status, meta, created_at, applied_at)
     VALUES (?,?,?,?,?,?,?,?, 'pending', ?, ?, NULL)`,
  );
  let count = 0;
  for (const gap of report.trashed.gapTitles) {
    insert.run(
      categoryGapProposalId(gap.title),
      "category_gap",
      gap.title,
      gap.title,
      "",
      gap.title,
      0.75,
      `迁移时旧类目「${gap.title}」在权威树里没有归宿（${gap.count} 个站点），已落未分类`,
      JSON.stringify({ siteIds: gap.siteIds, source: "taxonomy-migrate", batchId, parentId: null }),
      now,
    );
    count += 1;
  }
  report.applied = { ...(report.applied ?? {}), gapProposals: count };
}

function enqueueReindex(raw) {
  const pending = raw
    .prepare("SELECT id FROM jobs WHERE kind = 'reindex' AND status IN ('pending', 'running') LIMIT 1")
    .get();
  if (pending) return { id: String(pending.id), reused: true };
  const cols = tableColumns(raw, "jobs");
  const id = randomUUID();
  const now = Date.now();
  if (cols.has("next_run_at")) {
    raw
      .prepare(
        "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at, next_run_at) VALUES (?,?,?, 'pending', 0, ?, ?, NULL)",
      )
      .run(id, "reindex", JSON.stringify({ targets: ["sites"] }), now, now);
  } else {
    raw
      .prepare(
        "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at) VALUES (?,?,?, 'pending', 0, ?, ?)",
      )
      .run(id, "reindex", JSON.stringify({ targets: ["sites"] }), now, now);
  }
  return { id, reused: false };
}

/**
 * apply：先分析（零写入），预检通过后再打开可写连接。
 * openDb 会补列、补索引并跑启动回填；skipOrphanCleanup=true 是迁移窗口的硬要求。
 */
export async function runTaxonomyMigrate(options) {
  const report = analyzeTaxonomy(options);
  if (!options.apply) return report;

  if (report.trashed.total > 0 && report.trashed.gapRatio >= MAX_GAP_RATIO) {
    const err = new Error(
      `缺口占比 ${(report.trashed.gapRatio * 100).toFixed(2)}% 已达到 ${(MAX_GAP_RATIO * 100).toFixed(0)}% 红线，拒绝 apply`,
    );
    err.code = "TAXONOMY_GAP_TOO_HIGH";
    err.report = report;
    throw err;
  }
  if (report.registryConflicts.length > 0) {
    const err = new Error(`registry slug 被非 registry 类目占用：${report.registryConflicts.map((c) => c.slug).join(", ")}`);
    err.code = "TAXONOMY_SLUG_CONFLICT";
    err.report = report;
    throw err;
  }

  const batchId = options.batchId ?? `taxonomy-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const db = await openDb({ dialect: "sqlite", sqlitePath: options.dbPath, skipOrphanCleanup: true });
  const raw = db.sqlite;
  try {
    // 索引先在启动迁移里建过一次；投影前要临时摘掉，否则「旧根 AI 工具」会与
    // 新 registry 根同名冲突。数据收敛后在本函数末尾重建。
    raw.exec("DROP INDEX IF EXISTS categories_child_title_uniq");
    raw.exec("DROP INDEX IF EXISTS categories_root_title_uniq");

    ensureRemapTable(raw);
    const uncategorizedId = ensureUncategorized(raw);
    ensureRegistryProjection(raw, report);
    report.applied = { batchId };
    applyPlans(raw, report, batchId, uncategorizedId);
    deleteLegacyRoots(raw, report);

    const duplicates = findDuplicateTitles(raw);
    report.postDuplicates = duplicates;
    if (duplicates.length === 0) {
      createTitleIndexes(raw);
      report.indexCreated = true;
    } else {
      report.indexCreated = false;
    }

    cleanupTags(raw, report);
    writeGapProposals(raw, report, batchId);
    report.reindex = enqueueReindex(raw);
    report.applied.batchId = batchId;
  } finally {
    await db.close();
  }
  return report;
}

function printReport(report, applied) {
  const pct = (n) => (n * 100).toFixed(2) + "%";
  console.log("");
  console.log("=".repeat(68));
  console.log(`类目树 P3 迁移 ${applied ? "（已写入）" : "（dry-run，只读）"}`);
  console.log("=".repeat(68));
  console.log(`源库:       ${report.dbPath}`);
  console.log(`旧库备份:   ${report.backupPath ?? "(无)"}  覆盖 ${report.backupCoverage?.resolved ?? 0}/${report.backupCoverage?.needed ?? 0} 个悬空 id`);
  console.log(`schema:     slug=${report.schema.hasSlug ? "有" : "无（apply 会补）"}  category_remaps=${report.schema.hasCategoryRemaps ? "有" : "无"}`);
  console.log(`站点:       存活 ${report.source.activeSites} / 回收站 ${report.source.trashedSites} / 悬空类目 id ${report.source.danglingCategoryIds}`);
  console.log("");
  console.log(`回收站 remap: 命中 ${report.trashed.matched}/${report.trashed.total}，缺口 ${report.trashed.gap}（${pct(report.trashed.gapRatio)}），已映射 ${report.trashed.alreadyMapped}`);
  console.log(`  解析策略:  ${JSON.stringify(report.trashed.byStrategy)}`);
  for (const gap of report.trashed.gapTitles) console.log(`  缺口: 「${gap.title}」×${gap.count}`);
  if (report.trashed.restoreMatched) {
    console.log(`  恢复:      命中待恢复 ${report.trashed.restoreCandidates}，URL 冲突跳过 ${report.trashed.restoreCollisions}，同 URL 去重 ${report.trashed.restoreDuplicates}`);
  }
  console.log("");
  console.log(`存活站点下移: 旧类目上 ${report.active.onLegacyCategories}，可下移 ${report.active.movable}，未命中 ${report.active.unmatched.length}`);
  console.log(`  解析策略:  ${JSON.stringify(report.active.byStrategy)}`);
  for (const miss of report.active.unmatched) console.log(`  未命中: ${miss.title} <${miss.url}>（${miss.gapTitle}）`);
  console.log("");
  console.log(`旧种子根:   ${report.legacyRoots.map((r) => `${r.id}(${r.title}, refs=${r.refs})`).join("、") || "(无)"}`);
  console.log(`标题重复:   ${report.duplicates.length === 0 ? "0（可建唯一索引）" : report.duplicates.map((d) => `${d.title}×${d.count}`).join("、")}`);
  console.log(`标签:       回收站 site_tags 行 ${report.tags.orphanTagRows}，零引用标签 ${report.tags.zeroRefTags.length}`);
  console.log(`registry:   ${CATEGORY_REGISTRY.length} 条（18 根 / ${CATEGORY_REGISTRY.length - 18} 叶）`);
  if (applied) {
    const a = report.applied ?? {};
    console.log("");
    console.log(`写入结果:   恢复 ${a.restored ?? 0}，下移 ${a.movedActive ?? 0}，remap 日志 ${a.remapRows ?? 0} 行`);
    console.log(`  旧根删除 ${a.legacyRootsDeleted?.length ?? 0}，跳过 ${a.legacyRootsSkipped?.length ?? 0}`);
    console.log(`  唯一索引: ${report.indexCreated ? "已登记" : "已跳过（仍有重名）"}`);
    console.log(`  标签: 删 orphan ${a.tagOrphanRowsDeleted ?? 0} 行，零引用提案 ${a.zeroRefTagProposals ?? 0}，缺口提案 ${a.gapProposals ?? 0}`);
    console.log(`  reindex 任务: ${report.reindex?.id ?? "-"}${report.reindex?.reused ? "（复用已有 pending/running）" : ""}`);
    console.log("");
    console.log("回滚模板（按 batch_id 反向 UPDATE，执行前先备份）：");
    console.log(`  UPDATE sites SET category_id = (SELECT old_id FROM category_remaps r WHERE r.site_id = sites.id AND r.field = 'category' AND r.batch_id = '${a.batchId}' LIMIT 1) WHERE id IN (SELECT site_id FROM category_remaps WHERE batch_id = '${a.batchId}' AND field = 'category');`);
    console.log(`  UPDATE sites SET sub_category_id = (SELECT old_id FROM category_remaps r WHERE r.site_id = sites.id AND r.field = 'sub_category' AND r.batch_id = '${a.batchId}' LIMIT 1) WHERE id IN (SELECT site_id FROM category_remaps WHERE batch_id = '${a.batchId}' AND field = 'sub_category');`);
    console.log(`  UPDATE sites SET deleted_at = (SELECT old_deleted_at FROM category_remaps r WHERE r.site_id = sites.id AND r.field = 'category' AND r.batch_id = '${a.batchId}' LIMIT 1) WHERE id IN (SELECT site_id FROM category_remaps WHERE batch_id = '${a.batchId}' AND field = 'category');`);
  } else {
    console.log("");
    console.log("dry-run 未写库。确认报表后加 --apply --restore-matched 执行。");
  }
  console.log("");
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }
  if (!args.db) {
    console.error("缺少 --db <path>（迁移脚本不允许对默认库隐式执行）");
    usage();
    process.exit(EXIT_USAGE);
  }
  if (!existsSync(path.resolve(ROOT, args.db))) {
    console.error(`数据库不存在: ${path.resolve(ROOT, args.db)}`);
    process.exit(EXIT_USAGE);
  }
  try {
    const report = await runTaxonomyMigrate({
      dbPath: path.resolve(ROOT, args.db),
      backupDbPath: args.backupDb,
      apply: args.apply,
      restoreMatched: args.restoreMatched,
      batchId: args.batchId,
    });
    printReport(report, args.apply);
  } catch (err) {
    if (err?.code === "TAXONOMY_GAP_TOO_HIGH" || err?.code === "TAXONOMY_SLUG_CONFLICT") {
      console.error(`预检未通过：${err.message}`);
      if (err.report) printReport(err.report, false);
      process.exit(EXIT_PREFLIGHT);
    }
    console.error("迁移失败：", err instanceof Error ? err.message : err);
    process.exit(EXIT_USAGE);
  }
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (invokedDirectly) {
  main();
}
