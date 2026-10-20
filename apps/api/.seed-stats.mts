import { validateAndCleanPluginManifest } from "@navhub/core";
import { seedPluginDefs } from "./src/seed-plugins.ts";

let totalSites = 0;
let minCats = Infinity;
let minSites = Infinity;
let minPerCat = Infinity;
let packs = 0;
const perKind: Record<string, number> = {};

for (const def of seedPluginDefs()) {
  const r = validateAndCleanPluginManifest(def.manifest);
  if (!r.ok) {
    console.log("FAIL", def.slug, r.errors.join("; "));
    continue;
  }
  const m = r.manifest;
  perKind[m.kind] = (perKind[m.kind] ?? 0) + 1;
  if (m.kind !== "site-pack") continue;
  const payload = m.payload;
  packs++;
  const counts = new Map<string, number>();
  for (const s of payload.sites) counts.set(s.category ?? "-", (counts.get(s.category ?? "-") ?? 0) + 1);
  const perCat = Math.min(...counts.values());
  totalSites += payload.sites.length;
  minCats = Math.min(minCats, counts.size);
  minSites = Math.min(minSites, payload.sites.length);
  minPerCat = Math.min(minPerCat, perCat);
  console.log(
    String(def.slug).padEnd(28),
    "cats=" + String(counts.size).padStart(2),
    "sites=" + String(payload.sites.length).padStart(3),
    "minPerCat=" + String(perCat).padStart(2),
    "缺口≈" + Math.max(0, 200 - payload.sites.length)
  );
}
console.log(
  `\n网址包 ${packs} 个 | 站点合计 ${totalSites} | 最小分类数 ${minCats} | 最小站点数 ${minSites} | 分类内最少站点 ${minPerCat}`
);
console.log("各 kind 数量:", JSON.stringify(perKind));
