import Database from "../node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/lib/index.js";
import { allSeedPluginDefs } from "../apps/api/src/seed-data/index.ts";
import { CATEGORY_REGISTRY, resolveRegistryLeaf, registryId } from "../packages/core/src/category-registry.ts";

const pairs = new Map();
for (const def of allSeedPluginDefs) {
  if (def.manifest.kind !== "site-pack") continue;
  for (const s of def.manifest.payload?.sites ?? []) {
    const leaf = resolveRegistryLeaf(s.subCategory) ?? resolveRegistryLeaf(s.category);
    const key = `${leaf?.slug} <= [cat: ${s.category} | sub: ${s.subCategory || ""}]`;
    pairs.set(key, (pairs.get(key) || 0) + 1);
  }
}

for (const [k, count] of [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 120)) {
  console.log(`${String(count).padStart(3)} : ${k}`);
}
