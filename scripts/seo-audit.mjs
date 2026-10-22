#!/usr/bin/env node
/**
 * 运行时 SEO 审计：对部署后的真实响应做收录底线检查。
 *
 * 用法：
 *   node scripts/seo-audit.mjs                       # 默认 http://localhost:3000，抽样 20 条
 *   node scripts/seo-audit.mjs --base=https://nav.example --limit=40
 *   node scripts/seo-audit.mjs --base=https://nav.example --all   # 全量（生产发布后）
 *   node scripts/seo-audit.mjs --json                # 机器可读输出（CI 用）
 *   node scripts/seo-audit.mjs --retries=2           # 超时/网络错误重试（默认 2）
 *
 * 检查项：
 *   - robots.txt 可访问且声明 Sitemap（且不再输出 Yandex Host）；
 *   - sitemap.xml 可解析，抽样页面均 200、无跳转；
 *   - 每页 title / description / canonical / lang / 唯一 h1 齐全；
 *   - sitemap 页面不得声明 noindex；canonical 与 og:url 同源同路径；
 *   - sitemap 页面必须带完整 OG（image/type/site_name/locale/url）；
 *   - JSON-LD 可解析、声明 schema.org、@type 齐全、列表 position 连续、无 aggregateRating；
 *   - 站内链接闭环：首页 → /category/，站点详情 → 其他 /site/，分类页 → /site/；
 *   - /feed.xml 返回 RSS 且 Content-Type 正确；
 *   - 伪造的站点详情 URL 必须真 404（软 404 回归检查）。
 *
 * `--all` 对 dev 只用于冒烟：dev 的 20 条超时已证明它不适合当全量门禁。
 *
 * 退出码：0 = 全部通过；1 = 有问题（--no-fail 可只报告不失败）。
 */

import {
  analyzeHtml,
  auditPageDetailed,
  normalizeUrl,
  parseSitemapLocs,
  pickSample,
} from "./lib/seo-audit.mjs";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--") && !a.includes("=")));
const valueOf = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const base = (valueOf("base") ?? process.env.NAVHUB_SITE_URL ?? "http://localhost:3000")
  .trim()
  .replace(/\/+$/, "");
const all = flags.has("--all");
const limit = all ? Infinity : Math.max(1, Number(valueOf("limit") ?? 20) || 20);
const json = flags.has("--json");
const noFail = flags.has("--no-fail");
const skip404 = flags.has("--skip-404-check");
const timeout = Number(process.env.SEO_AUDIT_TIMEOUT_MS ?? 15000);
const concurrency = Math.max(1, Number(valueOf("concurrency") ?? 4) || 4);
const retries = Math.min(5, Math.max(0, Number(valueOf("retries") ?? 2) || 0));
const ua = `NavHub-SEO-Audit/1.2 (+${base})`;

try {
  new URL(base);
} catch {
  console.error(`✖ --base 不是合法 URL：${base}`);
  process.exit(1);
}

const report = {
  base,
  checkedAt: new Date().toISOString(),
  results: [],
  issues: [],
  summary: {
    sitemapUrls: 0,
    pages: 0,
    failed: 0,
    ogMissing: 0,
    jsonLdInvalid: 0,
    internalLinkMissing: 0,
    fetchRetries: 0,
    durationMs: 0,
  },
};
const log = (...parts) => {
  if (!json) console.log(...parts);
};
const issue = (scope, message) => {
  report.issues.push({ scope, message });
  log(`✖ ${scope}: ${message}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOnce(url) {
  const res = await fetch(url, {
    headers: { "user-agent": ua, accept: "text/html,application/xml,text/plain,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  return {
    status: res.status,
    finalUrl: res.url,
    contentType: res.headers.get("content-type") ?? "",
    body: await res.text(),
  };
}

/** fetch 抛出的只有超时/网络错误；HTTP 4xx/5xx 不重试，交给上层报状态码 */
async function fetchText(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchOnce(url);
    } catch (error) {
      if (attempt >= retries) throw error;
      report.summary.fetchRetries++;
      await sleep(200 + Math.floor(Math.random() * 301));
    }
  }
}

const started = Date.now();
log(`SEO audit · ${base}${all ? "（全量）" : `（抽样 ${limit} 条）`}`);
if (all && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(base)) {
  log("提示：dev 全量只作冒烟，不作发布门禁");
}

/* ------------------------------ 固定检查 ------------------------------ */

try {
  const robots = await fetchText(`${base}/robots.txt`);
  if (robots.status !== 200) {
    issue("/robots.txt", `HTTP ${robots.status}`);
  } else {
    if (!/^sitemap:\s*\S+/im.test(robots.body)) issue("/robots.txt", "未声明 Sitemap");
    if (/^host:\s*\S+/im.test(robots.body)) issue("/robots.txt", "仍输出 Yandex 私有的 Host 指令");
    report.results.push({ url: `${base}/robots.txt`, status: robots.status, kind: "robots" });
    log(`✓ robots.txt（HTTP ${robots.status}）`);
  }
} catch (error) {
  issue("/robots.txt", `请求失败：${error.message}`);
}

try {
  const feed = await fetchText(`${base}/feed.xml`);
  if (feed.status !== 200) {
    issue("/feed.xml", `HTTP ${feed.status}`);
  } else {
    if (!/application\/rss\+xml/i.test(feed.contentType)) {
      issue("/feed.xml", `Content-Type 为 ${feed.contentType || "(空)"}，应为 application/rss+xml`);
    }
    if (!/<rss\b/i.test(feed.body) || !/<channel>/i.test(feed.body)) issue("/feed.xml", "响应不是 RSS 2.0");
    report.results.push({ url: `${base}/feed.xml`, status: feed.status, kind: "feed" });
    log(`✓ feed.xml（HTTP ${feed.status}, ${feed.contentType}）`);
  }
} catch (error) {
  issue("/feed.xml", `请求失败：${error.message}`);
}

if (!skip404) {
  const probe = `${base}/site/seo-audit-missing-${Date.now()}`;
  try {
    const res = await fetchText(probe);
    if (res.status !== 404) issue("软 404", `${probe} 返回 ${res.status}（期望 404）`);
    else log("✓ 伪造站点详情返回真 404");
    report.results.push({ url: probe, status: res.status, kind: "404-probe" });
  } catch (error) {
    issue("软 404", `探测请求失败：${error.message}`);
  }
}

/* ------------------------------ sitemap 抽样 ------------------------------ */

let sample = [];
try {
  const sitemap = await fetchText(`${base}/sitemap.xml`);
  if (sitemap.status !== 200) {
    issue("/sitemap.xml", `HTTP ${sitemap.status}`);
  } else {
    const locs = parseSitemapLocs(sitemap.body);
    if (locs.length === 0) issue("/sitemap.xml", "未解析到任何 URL");
    sample = pickSample(locs, limit);
    log(`✓ sitemap.xml（${locs.length} 条 URL，${all ? "全量" : "抽样"} ${sample.length} 条）`);
    report.summary.sitemapUrls = locs.length;
  }
} catch (error) {
  issue("/sitemap.xml", `请求失败：${error.message}`);
}

async function mapPool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

const titles = [];
await mapPool(sample, concurrency, async (url) => {
  try {
    const res = await fetchText(url);
    const redirected = normalizeUrl(res.finalUrl, url) !== normalizeUrl(url, url);
    if (res.status !== 200) {
      issue(url, `HTTP ${res.status}`);
      report.results.push({ url, status: res.status, kind: "page" });
      return;
    }
    if (redirected) issue(url, `发生跳转 → ${res.finalUrl}（sitemap 应直接列出最终地址）`);
    if (!/text\/html/i.test(res.contentType)) {
      issue(url, `Content-Type 为 ${res.contentType || "(空)"}，不是 HTML`);
      return;
    }
    const page = analyzeHtml(res.body, url);
    const problems = auditPageDetailed(page);
    for (const problem of problems) issue(url, problem.message);
    const kinds = new Set(problems.map((problem) => problem.kind));
    if (kinds.has("og")) report.summary.ogMissing++;
    if (kinds.has("jsonld")) report.summary.jsonLdInvalid++;
    if (kinds.has("links")) report.summary.internalLinkMissing++;
    if (page.title) titles.push({ url, title: page.title });
    report.results.push({
      url,
      status: res.status,
      kind: "page",
      title: page.title,
      canonical: page.canonical,
      h1Count: page.h1Count,
      jsonLdCount: page.jsonLd.length,
      issues: problems.length,
      issueKinds: [...kinds],
    });
    log(`${problems.length ? "✖" : "✓"} ${url}${page.title ? ` · ${page.title}` : ""}`);
  } catch (error) {
    issue(url, `请求失败：${error.message}`);
    report.results.push({ url, status: null, kind: "page", error: error.message });
  }
});

// 抽样页共享同一 title = 重复标题问题（方案验收表的硬指标）
const byTitle = new Map();
for (const item of titles) {
  const list = byTitle.get(item.title) ?? [];
  list.push(item.url);
  byTitle.set(item.title, list);
}
for (const [title, urls] of byTitle) {
  if (urls.length > 1) issue("重复 title", `「${title}」被 ${urls.length} 个页面共享：${urls.slice(0, 5).join(" | ")}`);
}

report.summary.pages = sample.length;
report.summary.failed = report.issues.length;
report.summary.durationMs = Date.now() - started;

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    `\n${report.issues.length === 0 ? "✓" : "✖"} 完成：${sample.length} 个页面，${report.issues.length} 个问题，${report.summary.durationMs}ms`,
  );
  console.log(
    `OG 缺失 ${report.summary.ogMissing} · JSON-LD 异常 ${report.summary.jsonLdInvalid} · 内链缺失 ${report.summary.internalLinkMissing} · 重试 ${report.summary.fetchRetries}`,
  );
}

process.exit(report.issues.length > 0 && !noFail ? 1 : 0);
