import Database from "../node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/lib/index.js";
import { randomUUID } from "node:crypto";
import { CATEGORY_REGISTRY, registryId } from "../packages/core/src/category-registry.ts";
import { canonicalizeUrl } from "../packages/core/src/index.ts";
import { buildIndexFields, slugify } from "../packages/store/src/repository/dialect.ts";

const db = new Database("data/navhub.db");

function normalizeUrl(raw) {
  try {
    const c = canonicalizeUrl(raw.trim());
    const u = new URL(c);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    let path = u.pathname.replace(/\/+$/, "");
    if (!path) path = "";
    return `${host}${path}${u.search}`;
  } catch {
    return raw.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
  }
}

function normalizePart(part) {
  if (!part) return [];
  if (Array.isArray(part)) return part;
  const out = [];
  for (const [categoryId, list] of Object.entries(part)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      out.push({
        categoryId,
        title: item.title || item.name,
        url: item.url,
        description: item.description || item.desc || "",
        tags: item.tags || [],
      });
    }
  }
  return out;
}

async function run() {
  const { CURATED_PART1 = [] } = await import("./curated-leaves-part1.mjs").catch(() => ({}));
  const { CURATED_PART2 = [] } = await import("./curated-leaves-part2.mjs").catch(() => ({}));
  const { CURATED_PART3 = [] } = await import("./curated-leaves-part3.mjs").catch(() => ({}));
  const { CURATED_PART4 = [] } = await import("./curated-leaves-part4.mjs").catch(() => ({}));
  const { CURATED_PART5 = [], EXTRA_PART5 = [] } = await import("./curated-leaves-part5.mjs").catch(() => ({}));

  const allCandidates = [
    ...normalizePart(CURATED_PART1),
    ...normalizePart(CURATED_PART2),
    ...normalizePart(CURATED_PART3),
    ...normalizePart(CURATED_PART4),
    ...normalizePart(CURATED_PART5),
    ...normalizePart(EXTRA_PART5),
  ];
  console.log(`Loaded ${allCandidates.length} curated candidate sites from parts 1-4.`);

  const existingRows = db.prepare("SELECT id, url, category_id, deleted_at, enabled, status FROM sites").all();
  const existingUrls = new Set();
  const leafCounts = new Map();

  const leaves = CATEGORY_REGISTRY.filter((c) => Boolean(c.parentSlug));
  for (const leaf of leaves) {
    leafCounts.set(registryId(leaf.slug), 0);
  }

  for (const r of existingRows) {
    existingUrls.add(normalizeUrl(r.url));
    existingUrls.add(r.url.trim().toLowerCase());
    try {
      const c = canonicalizeUrl(r.url);
      existingUrls.add(c.toLowerCase());
      existingUrls.add((c.endsWith("/") ? c.slice(0, -1) : c + "/").toLowerCase());
    } catch {}
    if (!r.deleted_at && r.enabled === 1 && r.status === "active") {
      if (leafCounts.has(r.category_id)) {
        leafCounts.set(r.category_id, leafCounts.get(r.category_id) + 1);
      }
    }
  }

  const insertSiteStmt = db.prepare(`
    INSERT INTO sites (
      id, url, title, description, category_id, sub_category_id, icon_key, status, enabled, sort,
      weight, featured, source, fts_tokens, pinyin_full, pinyin_initials, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'active', 1, 0, 75, 0, 'curated-2026', ?, ?, ?, NULL, ?, ?)
  `);

  const findTagStmt = db.prepare("SELECT id FROM tags WHERE slug = ? OR name = ? LIMIT 1");
  const insertTagStmt = db.prepare("INSERT OR IGNORE INTO tags (id, name, slug) VALUES (?, ?, ?)");
  const insertSiteTagStmt = db.prepare("INSERT OR IGNORE INTO site_tags (site_id, tag_id) VALUES (?, ?)");

  const now = Date.now();
  const tx = db.transaction((items) => {
    let added = 0;
    let skippedDup = 0;
    for (const item of items) {
      if (!item || !item.url || !item.title || !item.categoryId) continue;
      const cid = item.categoryId.trim();
      if (!leafCounts.has(cid)) continue;

      const norm = normalizeUrl(item.url);
      const rawLower = item.url.trim().toLowerCase();
      let canonLower = rawLower;
      try { canonLower = canonicalizeUrl(item.url).toLowerCase(); } catch {}
      const altLower = canonLower.endsWith("/") ? canonLower.slice(0, -1) : canonLower + "/";

      if (existingUrls.has(norm) || existingUrls.has(rawLower) || existingUrls.has(canonLower) || existingUrls.has(altLower)) {
        skippedDup++;
        continue;
      }

      existingUrls.add(norm);
      existingUrls.add(rawLower);
      existingUrls.add(canonLower);
      existingUrls.add(altLower);

      const id = randomUUID();
      const tags = Array.isArray(item.tags) ? item.tags.slice(0, 6) : [];
      const idx = buildIndexFields({
        title: item.title.trim(),
        description: (item.description || "").trim(),
        url: item.url.trim(),
        tags,
      });

      try {
        insertSiteStmt.run(
          id,
          item.url.trim(),
          item.title.trim(),
          (item.description || "").trim(),
          cid,
          idx.ftsTokens,
          idx.pinyinFull,
          idx.pinyinInitials,
          now,
          now
        );
        added++;
        leafCounts.set(cid, (leafCounts.get(cid) || 0) + 1);

        for (const rawTag of tags) {
          try {
            const name = String(rawTag || "").trim();
            if (!name) continue;
            const slug = slugify(name);
            let tagRow = findTagStmt.get(slug, name);
            if (!tagRow) {
              const tagId = randomUUID();
              insertTagStmt.run(tagId, name, slug);
              tagRow = findTagStmt.get(slug, name);
            }
            if (tagRow?.id) insertSiteTagStmt.run(id, tagRow.id);
          } catch {}
        }
      } catch {
        skippedDup++;
      }
    }
    db.prepare("UPDATE data_version SET version = version + 1, updated_at = ? WHERE id = 1").run(Date.now());
    return { added, skippedDup };
  });

  const { added, skippedDup } = tx(allCandidates);
  console.log(`Inserted ${added} new curated sites (skipped ${skippedDup} duplicate URLs).`);

  const stillUnder20 = [];
  for (const leaf of leaves) {
    const cid = registryId(leaf.slug);
    const cnt = leafCounts.get(cid) || 0;
    if (cnt < 20) {
      stillUnder20.push({ categoryId: cid, title: leaf.title, count: cnt, need: 20 - cnt });
    }
  }
  console.log(`Remaining leaves < 20: ${stillUnder20.length} / ${leaves.length}`);
  for (const u of stillUnder20) {
    console.log(`  ⚠️ ${u.categoryId} (${u.title}): count=${u.count}, need=${u.need}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
