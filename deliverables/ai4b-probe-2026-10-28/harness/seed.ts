/**
 * 隔离栈播种：独占库 + 独占探活缓存，一次把「浏览器要读的那张报告」造出来。
 *
 * 为什么不让浏览器现场跑真实探活：[AI-4b] 的判据是「档位来自实测、界面如实表达」。
 * 真实网络既慢又不稳（本机出网对 github 类域名常返回 000），一次巡检看到什么档位全看运气，
 * 红了也不知道是产品坏了还是网断了。所以这里把五种档位钉死：
 *   - 每条候选 URL 事先在探活缓存里写一条**未过期**结论；
 *   - `probeCandidateUrl` 命中新鲜缓存时一个请求都不发，直接用缓存结论；
 *   - 于是「verified / blocked / unverified / suspicious / dead」五档在浏览器里必然同屏出现。
 *
 * 关键约束：ai4b-demo.example 这个域名从头到尾不会被解析 —— 结论全部来自缓存，
 * 这条隔离栈对真实世界零请求，也就不污染任何外部站点。
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../../apps/api/src/config.ts";
import { createContext } from "../../../apps/api/src/context.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, "..", "data");
const DB_PATH = resolve(DATA, "navhub.db");
const CACHE_PATH = resolve(DATA, "probe-cache.json");

/** 档位种子：kind 用 core 的 ProbeOutcomeKind，档位换算由后端自己做（不在这里复刻一遍判据） */
const SEEDED: Array<{ path: string; kind: string; status?: number; reason: string }> = [
  // —— 模型分支会推荐的三条 ——
  { path: "/ai-verified", kind: "ok", status: 200, reason: "内容检测通过" },
  { path: "/ai-slow", kind: "unverified", reason: "2500ms 内未响应（慢 ≠ 死）" },
  { path: "/ai-gone", kind: "dead", status: 404, reason: "HTTP 404：页面已不存在" },
  // —— 同分类兜底（没有模型参与时返回的站内活跃站点）——
  { path: "/peer-ok", kind: "ok", status: 200, reason: "内容检测通过" },
  { path: "/peer-parked", kind: "parked", status: 200, reason: "页面内容为域名停放页" },
  { path: "/peer-blocked", kind: "blocked", status: 403, reason: "HTTP 403：被 WAF/反爬挡住，内容未验证" },
  // —— 待治愈的那个站点本身 ——
  { path: "/broken-tool", kind: "dead", status: 404, reason: "HTTP 404：页面已不存在" },
];

const BASE = "https://ai4b-demo.example";

async function main() {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });

  const config = loadConfig({
    mode: "lite",
    sqlitePath: DB_PATH,
    auth: { enabled: false },
    embedding: { enabled: false },
  });
  const ctx = await createContext(config);

  const cat = await ctx.repo.createCategory({ title: "AI4B 效率工具", slug: "ai4b-eff" });
  const broken = await ctx.repo.createSite({
    title: "AI4B 旧工具（已失效）",
    url: `${BASE}/broken-tool`,
    description: "本轮巡检里那条需要被平替的死链",
    categoryId: cat.id,
    tags: ["效率"],
  });
  const peers = [];
  for (const [i, p] of ["/peer-ok", "/peer-parked", "/peer-blocked"].entries()) {
    const site = await ctx.repo.createSite({
      title: `AI4B 同类候选 ${i + 1}`,
      url: `${BASE}${p}`,
      description: "同分类活跃站点，用来充当没有模型参与时的兜底候选",
      categoryId: cat.id,
      tags: ["效率"],
    });
    peers.push({ id: site.id, url: site.url });
  }
  await ctx.repo.run("UPDATE sites SET status = 'broken' WHERE id = ?", [broken.id]);
  await ctx.close();

  // 探活缓存：键按 probeCacheKey 的规范化口径（小写协议/主机、去尾斜杠），checkedAt=now 保证新鲜
  const now = Date.now();
  const entries: Record<string, unknown> = {};
  for (const s of SEEDED) {
    const url = `${BASE}${s.path}`;
    entries[url] = { url, kind: s.kind, ...(s.status ? { status: s.status } : {}), reason: s.reason, checkedAt: now };
  }
  writeFileSync(CACHE_PATH, JSON.stringify({ version: 1, entries }, null, 2), "utf8");

  console.log(JSON.stringify({ db: DB_PATH, cache: CACHE_PATH, categoryId: cat.id, brokenSiteId: broken.id, peers }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
