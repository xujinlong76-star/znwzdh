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

let totalPackSites = 0;
let unresolved = 0;
let duplicateCount = 0;
let uniqueNewCandidates = 0;
const seenCandidateNorm = new Set();

for (const def of allSeedPluginDefs) {
  if (def.manifest.kind !== "site-pack") continue;
  const sites = def.manifest.payload?.sites ?? [];
  for (const s of sites) {
    totalPackSites++;
    const leaf = resolveRegistryLeaf(s.subCategory) ?? resolveRegistryLeaf(s.category);
    if (!leaf) {
      unresolved++;
      continue;
    }
    const norm = normalizeUrl(s.url);
    const rawLower = s.url.trim().toLowerCase();
    if (existingUrls.has(norm) || existingUrls.has(rawLower) || seenCandidateNorm.has(norm)) {
      duplicateCount++;
      continue;
    }
    seenCandidateNorm.add(norm);
    uniqueNewCandidates++;
    const cid = registryId(leaf.slug);
    candidatesByLeaf.get(cid).push(s);
  }
}

console.log({
  totalLeaves: leaves.length,
  totalPackSites,
  unresolved,
  duplicateCount,
  uniqueNewCandidates,
});

const under20AfterPack = [];
let totalNeededToReach20 = 0;
for (const leaf of leaves) {
  const cid = registryId(leaf.slug);
  const current = leafCounts.get(cid) || 0;
  const packAvail = candidatesByLeaf.get(cid)?.length || 0;
  const projected = current + packAvail;
  if (projected < 20) {
    const deficit = 20 - projected;
    totalNeededToReach20 += deficit;
    under20AfterPack.push({
      id: cid,
      slug: leaf.slug,
      title: leaf.title,
      parentSlug: leaf.parentSlug,
      current,
      packAvail,
      projected,
      deficit,
    });
  }
}

console.log(`Leaves still < 20 after site-packs: ${under20AfterPack.length} / ${leaves.length}, total deficit sites needed: ${totalNeededToReach20}`);
for (const item of under20AfterPack) {
  console.log(`  [${item.parentSlug}] ${item.id} (${item.title}): current=${item.current}, pack=${item.packAvail}, projected=${item.projected}, need=${item.deficit}`);
}
