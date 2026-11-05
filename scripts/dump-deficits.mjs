import Database from "../node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/lib/index.js";
import fs from "node:fs";
import { CATEGORY_REGISTRY, registryId } from "../packages/core/src/category-registry.ts";

const db = new Database("data/navhub.db", { readonly: true });

const sites = db.prepare(`
  SELECT category_id, url, title
    FROM sites
   WHERE deleted_at IS NULL AND enabled = 1 AND status = 'active'
`).all();

const byCat = new Map();
for (const s of sites) {
  if (!byCat.has(s.category_id)) byCat.set(s.category_id, []);
  byCat.get(s.category_id).push(s);
}

const leaves = CATEGORY_REGISTRY.filter((c) => Boolean(c.parentSlug));
const under20 = [];
for (const leaf of leaves) {
  const cid = registryId(leaf.slug);
  const list = byCat.get(cid) || [];
  if (list.length < 20) {
    under20.push({
      categoryId: cid,
      slug: leaf.slug,
      title: leaf.title,
      parentSlug: leaf.parentSlug,
      description: leaf.description,
      current: list.length,
      need: 20 - list.length,
      existingTitlesAndUrls: list.map((x) => `${x.title} (${x.url})`),
    });
  }
}

fs.writeFileSync("scripts/deficits-with-existing.json", JSON.stringify(under20, null, 2), "utf8");
const size = Math.ceil(under20.length / 4);
for (let i = 0; i < 4; i++) {
  const part = under20.slice(i * size, (i + 1) * size);
  fs.writeFileSync(`scripts/deficits-part${i + 1}.json`, JSON.stringify(part, null, 2), "utf8");
  console.log(`Part ${i + 1}: ${part.length} categories, total need=${part.reduce((a, b) => a + b.need, 0)}`);
}
console.log(`Wrote ${under20.length} deficit leaves to scripts/deficits-with-existing.json`);
