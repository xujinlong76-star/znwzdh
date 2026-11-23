/**
 * 插件版本升级工具（正式工具，可重复运行）。
 *
 * 用法（在 apps/api 目录下）：
 *   NAVHUB_SQLITE_PATH=../../data/navhub.db node upgrade-plugin-versions.mts patch
 *   NAVHUB_SQLITE_PATH=../../data/navhub.db node upgrade-plugin-versions.mts minor
 *
 * 步骤：
 *   1. bump 种子文件 version 字段（patch/minor/major）
 *   2. 独立进程导入最新种子，updatePlugin + reviewPlugin 恢复 published
 *   3. 处理不在种子里的 legacy site-pack（直接改 manifest.version）
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./src/config.ts";
import { createContext } from "./src/context.ts";
import { seedPluginDefs } from "./src/seed-plugins.ts";
import { comparePluginVersions, canonicalJsonStringify, validateAndCleanPluginManifest } from "@navhub/core";

const MODE = (process.argv[2] || "patch") as "patch" | "minor" | "major";
function bump(v: string): string {
  const [a=0,b=0,c=0] = v.split(".").map(Number);
  if (MODE === "major") return `${a+1}.0.0`;
  if (MODE === "minor") return `${a}.${b+1}.0`;
  return `${a}.${b}.${c+1}`;
}
const SEED_DIR = join(import.meta.dirname, "src/seed-data");
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}
// 1. bump 种子版本
let filesBumped = 0;
for (const f of walk(SEED_DIR)) {
  let s = readFileSync(f, "utf8");
  const original = s;
  s = s.replace(/(\bversion:\s*")(\d+\.\d+\.\d+)(")/g, (_m, pre, v, post) => `${pre}${bump(v)}${post}`);
  s = s.replace(/("version":\s*")(\d+\.\d+\.\d+)(")/g, (_m, pre, v, post) => `${pre}${bump(v)}${post}`);
  if (s !== original) { writeFileSync(f, s, "utf8"); filesBumped++; }
}
console.log(JSON.stringify({ stage: "seed-bump", mode: MODE, filesBumped }));

// 2. 数据库升级（种子插件）
const ctx = await createContext(loadConfig());
const defs = seedPluginDefs();
const ordered = [
  ...defs.filter(d => (d.manifest as {kind?:string})?.kind !== "bundle"),
  ...defs.filter(d => (d.manifest as {kind?:string})?.kind === "bundle"),
];
let updated = 0, upToDate = 0, failed = 0;
for (const def of ordered) {
  const validated = validateAndCleanPluginManifest(def.manifest);
  if (!validated.ok) { failed++; continue; }
  const existing = await ctx.repo.getPluginBySlug(def.slug);
  if (!existing) continue;
  const higher = comparePluginVersions(validated.manifest.version, existing.version) > 0;
  if (higher) {
    await ctx.repo.updatePlugin(def.slug, validated.manifest, { actor: "version-upgrade", actorKind: "system" });
    if (def.status === "published") {
      try { await ctx.repo.reviewPlugin(def.slug, "approve", "版本升级自动上架", { actor: "version-upgrade", actorKind: "system" }); } catch {}
    }
    updated++;
  } else upToDate++;
}
console.log(JSON.stringify({ stage: "db-seed-upgrade", updated, upToDate, failed }));

// 3. legacy site-pack（不在种子）
const all = (await ctx.repo.listPlugins({ limit: 100 })).items ?? [];
const sitePacks = all.filter(it => it.kind === "site-pack");
let spUpdated = 0, spApproved = 0;
for (const it of sitePacks) {
  const manifest = { ...(it.manifest as object), version: bump(String(it.version || "1.0.0")) };
  await ctx.repo.updatePlugin(it.slug, manifest as never, { actor: "version-upgrade", actorKind: "system" });
  spUpdated++;
  try { await ctx.repo.reviewPlugin(it.slug, "approve", "版本升级自动上架", { actor: "version-upgrade", actorKind: "system" }); spApproved++; } catch {}
}
console.log(JSON.stringify({ stage: "db-sitepack-upgrade", updated: spUpdated, approved: spApproved }));
await ctx.close?.();
