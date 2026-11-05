import Database from "../node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/lib/index.js";
import { randomUUID } from "node:crypto";
import { allSeedPluginDefs } from "../apps/api/src/seed-data/index.ts";
import { CATEGORY_REGISTRY, resolveRegistryLeaf, registryId } from "../packages/core/src/category-registry.ts";
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

function resolveBestLeafSlug(s) {
  const cat = (s.category || "").trim();
  const sub = (s.subCategory || "").trim();
  const titleDesc = `${s.title || ""} ${s.description || ""} ${(s.tags || []).join(" ")}`;

  if (cat === "AI 图像与视频" && (sub.includes("视频") || sub.includes("数字人") || /runway|pika|sora|kling|可灵|即梦|vidu|luma|heygen|d-id|synthesia/i.test(titleDesc))) {
    return "ai-video-generation";
  }
  if ((cat === "科研工具与文献管理" || cat === "学术与科研") && (sub.includes("写作") || sub.includes("LaTeX") || sub.includes("润色") || /overleaf|latex|grammarly|writefull|paperpal|deepl|quillbot/i.test(titleDesc))) {
    return "paper-writing";
  }
  if (cat === "地球与环境") return "weather-and-environment";
  if (cat === "劳动人事合规") return "labor-rights";
  if (cat === "商标与专利检索" || cat === "知识产权与版权服务" || cat === "知识产权") return "copyright-and-compliance";
  if (cat === "音频工具与音效素材") return "podcast-production";
  if (cat === "企业工商与信用") return "credit-and-reports";
  if (cat === "纪录片与自然影像") return "documentaries";
  if (cat === "公开课与学术资源" && sub.includes("文献")) return "open-access";
  if (cat === "经济与社会") return "research-and-reports";
  if (cat === "心理学") return "mental-health";

  const leaf = resolveRegistryLeaf(sub) ?? resolveRegistryLeaf(cat);
  return leaf ? leaf.slug : null;
}

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

const TARGET_CAP_FROM_PACKS = 26;
const toInsert = [];

for (const def of allSeedPluginDefs) {
  if (def.manifest.kind !== "site-pack") continue;
  for (const s of def.manifest.payload?.sites ?? []) {
    const slug = resolveBestLeafSlug(s);
    if (!slug) continue;
    const cid = registryId(slug);
    if (!leafCounts.has(cid)) continue;

    const currentCount = leafCounts.get(cid);
    if (currentCount >= TARGET_CAP_FROM_PACKS) continue;

    const norm = normalizeUrl(s.url);
    const rawLower = s.url.trim().toLowerCase();
    let canonLower = rawLower;
    try { canonLower = canonicalizeUrl(s.url).toLowerCase(); } catch {}
    const altLower = canonLower.endsWith("/") ? canonLower.slice(0, -1) : canonLower + "/";

    if (existingUrls.has(norm) || existingUrls.has(rawLower) || existingUrls.has(canonLower) || existingUrls.has(altLower)) {
      continue;
    }

    existingUrls.add(norm);
    existingUrls.add(rawLower);
    existingUrls.add(canonLower);
    existingUrls.add(altLower);
    leafCounts.set(cid, currentCount + 1);

    toInsert.push({
      url: s.url.trim(),
      title: s.title.trim(),
      description: (s.description || "").trim(),
      categoryId: cid,
      tags: Array.isArray(s.tags) ? s.tags.slice(0, 6) : [],
      source: `plugin:${def.slug}`,
    });
  }
}

console.log(`Prepared ${toInsert.length} sites from official site-packs to insert...`);

const insertSiteStmt = db.prepare(`
  INSERT INTO sites (
    id, url, title, description, category_id, sub_category_id, icon_key, status, enabled, sort,
    weight, featured, source, fts_tokens, pinyin_full, pinyin_initials, metadata, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'active', 1, 0, 75, 0, ?, ?, ?, ?, NULL, ?, ?)
`);

const findTagStmt = db.prepare("SELECT id FROM tags WHERE slug = ? LIMIT 1");
const insertTagStmt = db.prepare("INSERT INTO tags (id, name, slug) VALUES (?, ?, ?)");
const insertSiteTagStmt = db.prepare("INSERT OR IGNORE INTO site_tags (site_id, tag_id) VALUES (?, ?)");

const now = Date.now();
const tx = db.transaction((items) => {
  let added = 0;
  for (const item of items) {
    const id = randomUUID();
    const idx = buildIndexFields({
      title: item.title,
      description: item.description,
      url: item.url,
      tags: item.tags,
    });
    try {
      insertSiteStmt.run(
        id,
        item.url,
        item.title,
        item.description,
        item.categoryId,
        item.source,
        idx.ftsTokens,
        idx.pinyinFull,
        idx.pinyinInitials,
        now,
        now
      );
      added++;
      for (const rawTag of item.tags) {
        const name = String(rawTag || "").trim();
        if (!name) continue;
        const slug = slugify(name);
        let tagRow = findTagStmt.get(slug);
        if (!tagRow) {
          const tagId = randomUUID();
          insertTagStmt.run(tagId, name, slug);
          tagRow = { id: tagId };
        }
        insertSiteTagStmt.run(id, tagRow.id);
      }
    } catch (err) {
      // Skip if unique constraint hit
    }
  }
  db.prepare("UPDATE data_version SET version = version + 1, updated_at = ? WHERE id = 1").run(Date.now());
  return added;
});

const insertedCount = tx(toInsert);
console.log(`Successfully inserted ${insertedCount} sites from official site-packs.`);
