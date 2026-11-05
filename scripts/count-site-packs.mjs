import fs from "fs";
import path from "path";

const dir = "apps/api/src/seed-data/site-packs";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".ts"));
console.log("Site pack files count:", files.length);

let totalSitesInPacks = 0;
const packStats = [];

for (const f of files) {
  const content = fs.readFileSync(path.join(dir, f), "utf8");
  const urlMatches = content.match(/url:\s*"[^"]+"/g) || [];
  totalSitesInPacks += urlMatches.length;
  packStats.push({ file: f, sites: urlMatches.length });
}

console.log("Total sites across all site packs:", totalSitesInPacks);
packStats.sort((a, b) => b.sites - a.sites);
console.log("Pack stats sample:", packStats.slice(0, 10));
