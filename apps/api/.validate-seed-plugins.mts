import { validateAndCleanPluginManifest } from "@navhub/core";
import { seedPluginDefs } from "./src/seed-plugins.ts";

const defs = seedPluginDefs();
console.log(`共 ${defs.length} 个种子插件\n`);

let fail = 0;
const byKind = {};
for (const def of defs) {
  byKind[def.kind = def.manifest?.kind ?? "?"] = (byKind[def.kind] ?? 0) + 1;
  const r = validateAndCleanPluginManifest(def.manifest);
  const m = r.ok ? r.manifest : null;
  let extra = "";
  if (m) {
    if (m.kind === "site-pack") {
      const p = m.payload;
      const cats = new Set(p.sites.map((s) => s.category).filter(Boolean));
      extra = `分类 ${cats.size} / 站点 ${p.sites.length}`;
    } else if (m.kind === "search-pack") extra = `引擎 ${m.payload.engines.length}`;
    else if (m.kind === "theme") extra = `色板 ${Object.keys(m.payload.tokens ?? {}).length} 项`;
    else if (m.kind === "workspace-preset") {
      let w = 0;
      for (const b of m.payload.boards) w += b.widgets.length;
      extra = `看板 ${m.payload.boards.length} / 模块 ${w}`;
    } else if (m.kind === "bundle") extra = `成员 ${m.payload.items.length}`;
  }
  const status = r.ok ? "PASS" : "FAIL";
  if (!r.ok) fail++;
  console.log(`${status} | ${def.slug.padEnd(28)} | ${(m?.kind ?? "?").padEnd(17)} | ${extra}`);
  if (!r.ok) console.log("      errors:", r.errors.join("; "));
  else if (r.warnings.length) console.log("      warnings:", r.warnings.join("; "));
}
console.log("\n按 kind 统计:", JSON.stringify(byKind));
console.log(fail === 0 ? "全部通过" : `${fail} 个失败`);
process.exit(fail === 0 ? 0 : 1);
