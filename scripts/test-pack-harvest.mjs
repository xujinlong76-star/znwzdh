import Database from "../node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/lib/index.js";
import { allSeedPluginDefs } from "../apps/api/src/seed-data/index.ts";
import { CATEGORY_REGISTRY, resolveRegistryLeaf, registryId } from "../packages/core/src/category-registry.ts";

const db = new Database("data/navhub.db", { readonly: true });

function normalizeUrl(raw) {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    let path = u.pathname.replace(/\/+$/, "");
    if (!path) path = "";
    return `${host}${path}${u.search}`;
  } catch {
    return raw.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
  }
}

// Fine-grained routing for site-pack (category, subCategory) pairs that collapsed into overloaded leaves
function resolveBestLeafSlug(s) {
  const cat = (s.category || "").trim();
  const sub = (s.subCategory || "").trim();
  const titleDesc = `${s.title || ""} ${s.description || ""} ${(s.tags || []).join(" ")}`;

  // 1. AI Video Generation vs AI Image Generation
  if (cat === "AI 图像与视频" && (sub.includes("视频") || sub.includes("数字人") || /runway|pika|sora|kling|可灵|即梦|vidu|luma|heygen|d-id|synthesia/i.test(titleDesc))) {
    return "ai-video-generation";
  }
  // 2. Paper writing vs research management
  if ((cat === "科研工具与文献管理" || cat === "学术与科研") && (sub.includes("写作") || sub.includes("LaTeX") || sub.includes("润色") || /overleaf|latex|grammarly|writefull|paperpal|deepl|quillbot/i.test(titleDesc))) {
    return "paper-writing";
  }
  // 3. Weather & environment from science-humanities "地球与环境"
  if (cat === "地球与环境") {
    return "weather-and-environment";
  }
  // 4. Labor rights from legal-compliance "劳动人事合规"
  if (cat === "劳动人事合规") {
    return "labor-rights";
  }
  // 5. Copyright & compliance from legal-compliance IP categories
  if (cat === "商标与专利检索" || cat === "知识产权与版权服务" || cat === "知识产权") {
    return "copyright-and-compliance";
  }
  // 6. Podcast production from creator-ops "音频工具与音效素材"
  if (cat === "音频工具与音效素材") {
    return "podcast-production";
  }
  // 7. Credit & reports from legal-compliance "企业工商与信用"
  if (cat === "企业工商与信用") {
    return "credit-and-reports";
  }
  // 8. Podcast & audiobooks vs science video
  if (cat === "纪录片与自然影像") {
    return "documentaries";
  }
  // 9. Public courses & open access
  if (cat === "公开课与学术资源" && sub.includes("文献")) {
    return "open-access";
  }
  // 10. Economy & society -> research-and-reports
  if (cat === "经济与社会") {
    return "research-and-reports";
  }
  // 11. Psychology -> mental-health
  if (cat === "心理学") {
    return "mental-health";
  }

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
  if (!r.deleted_at && r.enabled === 1 && r.status === "active") {
    if (leafCounts.has(r.category_id)) {
      leafCounts.set(r.category_id, leafCounts.get(r.category_id) + 1);
    }
  }
}

const candidatesByLeaf = new Map();
for (const leaf of leaves) {
  candidatesByLeaf.set(registryId(leaf.slug), []);
}

const seenCandidateNorm = new Set();
for (const def of allSeedPluginDefs) {
  if (def.manifest.kind !== "site-pack") continue;
  for (const s of def.manifest.payload?.sites ?? []) {
    const slug = resolveBestLeafSlug(s);
    if (!slug) continue;
    const norm = normalizeUrl(s.url);
    const rawLower = s.url.trim().toLowerCase();
    if (existingUrls.has(norm) || existingUrls.has(rawLower) || seenCandidateNorm.has(norm)) continue;
    seenCandidateNorm.add(norm);
    const cid = registryId(slug);
    if (candidatesByLeaf.has(cid)) {
      candidatesByLeaf.get(cid).push(s);
    }
  }
}

const under20 = [];
let totalDeficit = 0;
for (const leaf of leaves) {
  const cid = registryId(leaf.slug);
  const current = leafCounts.get(cid) || 0;
  const packAvail = candidatesByLeaf.get(cid)?.length || 0;
  const projected = current + packAvail;
  if (projected < 20) {
    const deficit = 20 - projected;
    totalDeficit += deficit;
    under20.push({ slug: leaf.slug, id: cid, title: leaf.title, parentSlug: leaf.parentSlug, current, packAvail, projected, deficit });
  }
}

console.log(`Remaining leaves < 20: ${under20.length} / ${leaves.length}, total deficit: ${totalDeficit}`);
const byRoot = new Map();
for (const item of under20) {
  if (!byRoot.has(item.parentSlug)) byRoot.set(item.parentSlug, []);
  byRoot.get(item.parentSlug).push(item);
}
for (const [root, list] of byRoot.entries()) {
  const sum = list.reduce((a, b) => a + b.deficit, 0);
  console.log(`  Root ${root}: ${list.length} leaves need ${sum} sites: ${list.map(x => `${x.slug}(-${x.deficit})`).join(", ")}`);
}
