import Database from "../node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/lib/index.js";
import { CATEGORY_REGISTRY, registryId } from "../packages/core/src/category-registry.ts";

const db = new Database("data/navhub.db", { readonly: true });

const rows = db.prepare(`
  SELECT category_id, COUNT(*) AS cnt
    FROM sites
   WHERE deleted_at IS NULL AND enabled = 1 AND status = 'active'
   GROUP BY category_id
`).all();

const countMap = new Map(rows.map((r) => [r.category_id, r.cnt]));
const leaves = CATEGORY_REGISTRY.filter((c) => Boolean(c.parentSlug));

const under20 = [];
let totalDeficit = 0;
for (const leaf of leaves) {
  const cid = registryId(leaf.slug);
  const current = countMap.get(cid) || 0;
  if (current < 20) {
    const need = 20 - current;
    totalDeficit += need;
    under20.push({
      categoryId: cid,
      slug: leaf.slug,
      title: leaf.title,
      parentSlug: leaf.parentSlug,
      description: leaf.description,
      current,
      need,
    });
  }
}

console.log(`Total active sites in DB:`, db.prepare("SELECT COUNT(*) AS n FROM sites WHERE deleted_at IS NULL AND enabled = 1 AND status = 'active'").get().n);
console.log(`Leaves >= 20: ${leaves.length - under20.length} / ${leaves.length}`);
console.log(`Leaves < 20: ${under20.length} / ${leaves.length}, total deficit: ${totalDeficit}`);
for (const item of under20) {
  console.log(`${item.categoryId} | ${item.title} (${item.parentSlug}) | current=${item.current} | need=${item.need} | ${item.description}`);
}
