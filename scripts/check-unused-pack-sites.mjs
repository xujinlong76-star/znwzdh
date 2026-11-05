import Database from "../node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/lib/index.js";
import { allSeedPluginDefs } from "../apps/api/src/seed-data/index.ts";
import { canonicalizeUrl } from "../packages/core/src/index.ts";

const db = new Database("data/navhub.db", { readonly: true });

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

const existingUrls = new Set();
for (const r of db.prepare("SELECT url FROM sites").all()) {
  existingUrls.add(normalizeUrl(r.url));
  existingUrls.add(r.url.trim().toLowerCase());
}

const unusedByCat = new Map();
let totalUnused = 0;
for (const def of allSeedPluginDefs) {
  if (def.manifest.kind !== "site-pack") continue;
  for (const s of def.manifest.payload?.sites ?? []) {
    const norm = normalizeUrl(s.url);
    if (existingUrls.has(norm) || existingUrls.has(s.url.trim().toLowerCase())) continue;
    existingUrls.add(norm);
    totalUnused++;
    const key = `[${def.slug}] ${s.category} / ${s.subCategory || ""}`;
    unusedByCat.set(key, (unusedByCat.get(key) || 0) + 1);
  }
}
console.log("Total unused sites in site-packs:", totalUnused);
for (const [k, cnt] of [...unusedByCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)) {
  console.log(`  ${String(cnt).padStart(3)} : ${k}`);
}
