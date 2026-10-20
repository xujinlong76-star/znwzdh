#!/usr/bin/env node
/**
 * 全市场可达率体检：遍历所有网址包，逐包抽样探活并汇总报告。
 *
 * 设计取舍（为什么是「调接口」而不是「脚本里自己发 HTTP」）：
 *   探活的 UA、超时、SSRF 守卫、以及「403/412/429 归为存活但拒绝爬虫并计入可达」
 *   这套判定口径全部住在服务端（apps/api/src/routes/plugin-audit.ts + plugin-audit.ts）。
 *   脚本只做编排与报告，复用同一套口径 —— 免得出现「脚本说 63%、页面说 73%」这种口径分裂。
 *
 * 覆盖范围的诚实说明：体检对象取自**种子清单**（seed-data），而接口读的是**数据库**。
 *   清单里有、库里没有的包（还没跑 `pnpm seed`）会被标记为「未落库」并跳过，
 *   不会被算进可达率分母，也不会被静默忽略。
 *
 * 用法：
 *   node scripts/audit-plugin-urls.mjs                    # 抽样 20 条 / 单轮
 *   node scripts/audit-plugin-urls.mjs --sample 30 --retry # 抽样 30 条 + 对不可达项复测一轮消抖
 *   node scripts/audit-plugin-urls.mjs --packs front-end-arsenal,gov-public-service
 *   node scripts/audit-plugin-urls.mjs --json-out          # 另外把结构化报告写到 apps/api/data/
 * 前置：中枢 API 必须在跑（默认 http://127.0.0.1:8787，可用 NAVHUB_API_URL 覆盖）。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { seedPluginDefs } from "../apps/api/src/seed-plugins.ts";

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const API = (process.env.NAVHUB_API_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const SAMPLE = Number(readFlag("--sample", "20"));
const TIMEOUT_MS = Number(readFlag("--timeout-ms", "5000"));
const RETRY = args.includes("--retry");
const JSON_OUT = args.includes("--json-out");
const onlyPacks = readFlag("--packs", null);

/** 从种子清单取出网址包（含 URL 列表） */
function loadPacks() {
  const out = [];
  for (const def of seedPluginDefs()) {
    const manifest = def.manifest;
    if (!manifest || manifest.kind !== "site-pack") continue;
    if (onlyPacks && !onlyPacks.split(",").map((s) => s.trim()).includes(def.slug)) continue;
    out.push({ slug: def.slug, name: manifest.name, urls: (manifest.payload.sites ?? []).map((s) => s.url) });
  }
  return out;
}

async function auditOnce(slug) {
  const res = await fetch(`${API}/api/plugins/${encodeURIComponent(slug)}/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ limit: SAMPLE, timeoutMs: TIMEOUT_MS }),
    signal: AbortSignal.timeout(TIMEOUT_MS * Math.ceil(SAMPLE / 6) + 30_000),
  });
  if (res.status === 404) return { notSeeded: true };
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  return await res.json();
}

/** 稳定失败 = 两轮都不可达；抖动 = 只在一轮里不可达（网络/风控抖动，不能当死链） */
function mergeRuns(a, b) {
  if (!b) return { broken: a.brokenItems, flaky: [], blocked: a.blockedItems };
  const key = (i) => i.url;
  const bBroken = new Set((b.brokenItems ?? []).map(key));
  const aBroken = new Set((a.brokenItems ?? []).map(key));
  const stable = (a.brokenItems ?? []).filter((i) => bBroken.has(key(i)));
  const flaky = [
    ...(a.brokenItems ?? []).filter((i) => !bBroken.has(key(i))),
    ...(b.brokenItems ?? []).filter((i) => !aBroken.has(key(i))),
  ];
  const blockedMap = new Map();
  for (const i of [...(a.blockedItems ?? []), ...(b.blockedItems ?? [])]) blockedMap.set(key(i), i);
  return { broken: stable, flaky, blocked: [...blockedMap.values()] };
}

const pct = (x) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

async function main() {
  const packs = loadPacks();
  console.log(`全市场可达率体检：${packs.length} 个网址包 | 抽样 ${SAMPLE} 条 | 接口 ${API}${RETRY ? " | 不可达项复测一轮" : ""}\n`);

  const rows = [];
  const detail = [];
  // 口径声明从接口取（事实源在服务端），不在脚本里另抄一份 —— 否则改了服务端口径，脚本还在印旧说法
  let caveat = null;
  for (const pack of packs) {
    process.stdout.write(`· ${pack.slug.padEnd(28)} `);
    let first;
    try {
      first = await auditOnce(pack.slug);
    } catch (err) {
      console.log(`✗ 调用失败：${err instanceof Error ? err.message : err}`);
      rows.push({ slug: pack.slug, name: pack.name, declared: pack.urls.length, error: String(err) });
      continue;
    }
    if (first.notSeeded) {
      console.log(`跳过：清单里有、库里没有（跑 pnpm seed 后再体检）`);
      rows.push({ slug: pack.slug, name: pack.name, declared: pack.urls.length, notSeeded: true });
      continue;
    }
    if (!caveat && typeof first.caveat === "string") caveat = first.caveat;

    let second = null;
    if (RETRY && first.brokenCount > 0) second = await auditOnce(pack.slug);
    const merged = mergeRuns(first, second);

    // 两轮都跑过时，可达率按「非稳定失败」重算（把抖动项当可达，不冤枉站点）
    const sampled = first.sampled;
    const stableBroken = merged.broken.length;
    const reachability = sampled === 0 ? null : Math.round(((sampled - stableBroken) / sampled) * 1000) / 1000;

    console.log(
      `${pct(reachability).padStart(4)} 可达 | 声明 ${String(first.declared).padStart(3)} / 抽样 ${String(sampled).padStart(2)}` +
        ` | 正常 ${first.okCount} · 拒绝爬虫 ${merged.blocked.length} · 稳定不可达 ${stableBroken}` +
        (merged.flaky.length ? ` · 抖动 ${merged.flaky.length}` : ""),
    );

    rows.push({
      slug: pack.slug,
      name: pack.name,
      declared: first.declared,
      sampled,
      ok: first.okCount,
      blocked: merged.blocked.length,
      broken: stableBroken,
      flaky: merged.flaky.length,
      redirected: first.redirected,
      reachability,
    });
    detail.push({ slug: pack.slug, broken: merged.broken, flaky: merged.flaky, blocked: merged.blocked });
  }

  const scored = rows.filter((r) => typeof r.reachability === "number");
  const avg = scored.length ? Math.round((scored.reduce((s, r) => s + r.reachability, 0) / scored.length) * 1000) / 1000 : null;
  const totalSampled = scored.reduce((s, r) => s + r.sampled, 0);
  const totalBroken = scored.reduce((s, r) => s + r.broken, 0);

  console.log(`\n汇总：${scored.length} 个包参与统计 | 抽样合计 ${totalSampled} 条 | 稳定不可达 ${totalBroken} 条`);
  console.log(`全市场平均可达率：${pct(avg)}`);
  console.log("\n口径声明：" + (caveat ?? "（未能从接口取得，请检查 API 是否在跑）"));
  console.log("          " + (RETRY ? "（本次已用两轮复测区分稳定失败与抖动）" : "（加 --retry 可复测消抖）"));

  const worst = scored.filter((r) => r.reachability !== null && r.reachability < 0.9).sort((a, b) => a.reachability - b.reachability);
  if (worst.length) {
    console.log("\n需要人工复核的包（本机可达率 < 90%，不代表站点失效）：");
    for (const r of worst) {
      const d = detail.find((x) => x.slug === r.slug);
      console.log(`  - ${r.slug}（${pct(r.reachability)}）不可达 ${r.broken} 条，示例：`);
      for (const i of (d?.broken ?? []).slice(0, 3)) {
        console.log(`      ${i.url} ${i.status ? "HTTP " + i.status : i.error ?? "不可达"}`);
      }
    }
  }

  if (JSON_OUT) {
    const dir = resolve("apps/api/data");
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `plugin-url-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), api: API, sample: SAMPLE, retry: RETRY, rows, detail, summary: { packs: scored.length, sampled: totalSampled, broken: totalBroken, avgReachability: avg } }, null, 2), "utf8");
    console.log(`\n结构化报告已写入：${file}`);
  }
}

await main();
