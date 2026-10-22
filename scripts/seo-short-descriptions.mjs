#!/usr/bin/env node
/**
 * 描述待补清单：列出活跃站点里 description 少于 20 字的条目。
 *
 * 用法：
 *   node scripts/seo-short-descriptions.mjs                 # 按访问量排序
 *   node scripts/seo-short-descriptions.mjs --json          # 机器可读
 *   node scripts/seo-short-descriptions.mjs --limit=100     # 只看前 100 条
 *
 * 环境：NAVHUB_API_URL（默认 http://127.0.0.1:8787）
 * 只读审计，不修改任何数据；优先补有访问量和外链需求的站点。
 */

const MIN_DESCRIPTION = 20;
const API = (process.env.NAVHUB_API_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const args = process.argv.slice(2);
const json = args.includes("--json");
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.slice("--limit=".length)) || 0) : Infinity;

async function getJson(path) {
  const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

async function loadActiveSites() {
  const PAGE = 1000;
  const rows = [];
  for (let page = 0; page < 5; page += 1) {
    const chunk = await getJson(`/api/sites?status=active&limit=${PAGE}&offset=${page * PAGE}`);
    if (!Array.isArray(chunk)) throw new Error("/api/sites 返回的不是数组");
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return rows;
}

try {
  const [sites, categories] = await Promise.all([
    loadActiveSites(),
    getJson("/api/categories").catch(() => []),
  ]);
  const categoryNames = new Map(
    (Array.isArray(categories) ? categories : []).map((category) => [category.id, category.title]),
  );

  const pending = sites
    .map((site) => {
      const description = (site.description ?? "").trim();
      return {
        id: site.id,
        title: site.title,
        url: site.url,
        categoryId: site.categoryId ?? "",
        category: categoryNames.get(site.categoryId) ?? site.categoryId ?? "未分类",
        visitCount: Number(site.visitCount) || 0,
        length: description.length,
        description,
      };
    })
    .filter((site) => site.length < MIN_DESCRIPTION)
    .sort(
      (a, b) =>
        b.visitCount - a.visitCount ||
        a.category.localeCompare(b.category, "zh-CN") ||
        a.title.localeCompare(b.title, "zh-CN"),
    )
    .slice(0, limit);

  const byCategory = {};
  for (const site of pending) byCategory[site.category] = (byCategory[site.category] ?? 0) + 1;

  if (json) {
    console.log(
      JSON.stringify(
        { api: API, activeSites: sites.length, pending: pending.length, minLength: MIN_DESCRIPTION, byCategory, items: pending },
        null,
        2,
      ),
    );
  } else {
    console.log(`描述待补清单 · 活跃站点 ${sites.length} 个，少于 ${MIN_DESCRIPTION} 字 ${pending.length} 个`);
    console.log(
      `分类分布：${Object.entries(byCategory)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `${name} ${count}`)
        .join(" · ") || "无"}`,
    );
    console.log("");
    for (const site of pending) {
      const summary = site.description || "(空)";
      console.log(`${String(site.visitCount).padStart(6)}  ${site.category}  ${site.title}  [${site.length} 字]  ${summary}`);
    }
  }
} catch (error) {
  console.error(`✖ ${error.message}`);
  process.exit(1);
}
