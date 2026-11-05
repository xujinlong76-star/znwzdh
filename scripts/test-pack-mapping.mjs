import fs from "fs";
import path from "path";
import { resolveRegistryLeaf, registryId } from "../packages/core/src/category-registry.ts";

async function analyzePacks() {
  const cats = await fetch("http://127.0.0.1:8787/api/categories").then(r => r.json());
  const countsResp = await fetch("http://127.0.0.1:8787/api/categories/counts").then(r => r.json());
  const countsMap = new Map((countsResp.counts || countsResp).map(c => [c.categoryId, c.sites]));
  const catMap = new Map(cats.map(c => [c.id, c]));

  // 1. 获取现有数据库中所有已有站点
  const allSites = [];
  let offset = 0;
  while (true) {
    const batch = await fetch("http://127.0.0.1:8787/api/sites?limit=500&offset=" + offset).then(r => r.json());
    allSites.push(...batch);
    if (batch.length < 500) break;
    offset += 500;
  }
  const normalize = (u) => u.toLowerCase().trim().replace(/\/+$/, "");
  const existingUrls = new Set(allSites.map(s => normalize(s.url)));

  console.log("库内已有有效站点:", allSites.length);

  // 2. 统计当前各一级分类的站点数
  const rootMap = new Map();
  for (const c of cats) {
    if (!c.parentId) {
      rootMap.set(c.id, { title: c.title, current: 0, subcats: [] });
    }
  }
  for (const c of cats) {
    if (c.parentId && rootMap.has(c.parentId)) {
      const sites = countsMap.get(c.id) || 0;
      rootMap.get(c.parentId).subcats.push({ id: c.id, title: c.title, sites });
      rootMap.get(c.parentId).current += sites;
    }
  }

  console.log("\n当前一级分类站点分布:");
  for (const [rId, r] of rootMap.entries()) {
    console.log(`  ${r.title} (${rId}): ${r.current} 站 (子分类数: ${r.subcats.length})`);
  }
}

analyzePacks().catch(console.error);
