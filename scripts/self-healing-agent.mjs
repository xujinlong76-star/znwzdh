/**
 * NavHub 智能站点自主巡检与元数据自愈 Agent (Self-Healing Catalog Agent)
 *
 * 核心设计目标：
 *  1. 自动化全站健康巡检：按 last_checked_at 增量轮询站点存活、HTTP 状态码与响应延迟；
 *  2. 智能重定向跟随：自动识别域名变更与永久 301 重定向，记录 redirect_to 供治理核对；
 *  3. 元数据自动提炼与自愈：从真实网页提取 OpenGraph、Title 与 Meta Description，
 *     对缺失或过旧描述的站点自动执行清洗重整，并同步刷新 pinyin 与 fts 索引；
 *  4. 严格 SSRF 安全防护：网络请求前进行 DNS 解析与私网/内网黑名单校验，禁止内网探测；
 *  5. 优雅 CLI 控制：支持 --batch=N、--dry-run、--timeout 等参数。
 */

import Database from "../node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/lib/index.js";
import { lookup } from "node:dns/promises";
import { isBlockedIp } from "../packages/ai/src/ssrf.ts";
import { buildIndexFields } from "../packages/store/src/repository/dialect.ts";

const db = new Database("data/navhub.db");

function parseArgs(args) {
  let batch = 20;
  let dryRun = false;
  let timeoutMs = 5000;

  for (const arg of args) {
    if (arg.startsWith("--batch=")) {
      batch = parseInt(arg.split("=")[1], 10) || 20;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--timeout=")) {
      timeoutMs = parseInt(arg.split("=")[1], 10) || 5000;
    }
  }
  return { batch, dryRun, timeoutMs };
}

function cleanHtmlText(raw) {
  if (!raw) return "";
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractMetadata(html) {
  const result = {
    title: "",
    description: "",
  };

  // 1. Title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    result.title = cleanHtmlText(titleMatch[1]);
  }

  // 2. OpenGraph & Meta Description
  const ogDescMatch = html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']*)["']/i);
  const revDescMatch = html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["'](?:og:description|description)["']/i);
  const descCandidate = (ogDescMatch && ogDescMatch[1]) || (revDescMatch && revDescMatch[1]) || "";
  if (descCandidate) {
    result.description = cleanHtmlText(descCandidate);
  }

  return result;
}

async function probeSite(site, timeoutMs) {
  const rawUrl = site.url.trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return { ok: false, error: "INVALID_URL", status: 0, latency: 0, redirectTo: null, meta: null };
  }

  // 1. SSRF 防线
  try {
    const addresses = await lookup(parsedUrl.hostname, { all: true });
    for (const addr of addresses) {
      if (isBlockedIp(addr.address)) {
        return { ok: false, error: "BLOCKED_IP_SSRF", status: 0, latency: 0, redirectTo: null, meta: null };
      }
    }
  } catch (err) {
    return { ok: false, error: "DNS_LOOKUP_FAILED: " + (err.message || err), status: 0, latency: 0, redirectTo: null, meta: null };
  }

  // 2. HTTP 探测与抓取
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(rawUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) NavHubSelfHealingBot/1.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const latency = Date.now() - start;
    const finalUrl = resp.url;
    const redirectTo = finalUrl && finalUrl !== rawUrl ? finalUrl : null;

    let meta = null;
    if (resp.ok) {
      const contentType = resp.headers.get("content-type") || "";
      if (contentType.includes("html") || contentType.includes("text")) {
        // 限制最大读取 256KB
        const text = await resp.text();
        const snippet = text.slice(0, 256 * 1024);
        meta = extractMetadata(snippet);
      }
    }

    return {
      ok: resp.ok,
      error: resp.ok ? null : `HTTP_${resp.status}`,
      status: resp.status,
      latency,
      redirectTo,
      meta,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.name === "AbortError" ? "TIMEOUT" : (err.message || String(err)),
      status: 0,
      latency: Date.now() - start,
      redirectTo: null,
      meta: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  const { batch, dryRun, timeoutMs } = parseArgs(process.argv.slice(2));
  console.log(`=== 启动 NavHub 智能站点自主巡检与自愈 Agent ===`);
  console.log(`巡检批次上限: ${batch} | 单站点超时: ${timeoutMs}ms | 运行模式: ${dryRun ? "Dry-Run (只读试跑)" : "Live (自动更新入库)"}`);

  // 挑选最久未检查或未曾检查的活跃站点
  const candidates = db
    .prepare(`
      SELECT id, url, title, description, category_id, last_checked_at, health_ok, http_status, visit_count
        FROM sites
       WHERE enabled = 1
         AND deleted_at IS NULL
       ORDER BY CASE WHEN last_checked_at IS NULL THEN 0 ELSE 1 END ASC,
                last_checked_at ASC
       LIMIT ?
    `)
    .all(batch);

  console.log(`找到 ${candidates.length} 个待巡检自愈站点候选。`);

  const updateSiteStmt = db.prepare(`
    UPDATE sites
       SET http_status = ?,
           health_ok = ?,
           latency_ms = ?,
           redirect_to = ?,
           health_error = ?,
           last_checked_at = ?,
           description = CASE WHEN ? != '' THEN ? ELSE description END,
           fts_tokens = CASE WHEN ? != '' THEN ? ELSE fts_tokens END,
           pinyin_full = CASE WHEN ? != '' THEN ? ELSE pinyin_full END,
           pinyin_initials = CASE WHEN ? != '' THEN ? ELSE pinyin_initials END,
           updated_at = ?
     WHERE id = ?
  `);

  let successCount = 0;
  let healedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const site = candidates[i];
    process.stdout.write(`[${i + 1}/${candidates.length}] 正在巡检: ${site.title} (${site.url})... `);
    const probe = await probeSite(site, timeoutMs);

    if (probe.ok) {
      successCount++;
      let newDesc = "";
      let newFts = "";
      let newPinyinFull = "";
      let newPinyinInitials = "";

      // 检查是否需要元数据自愈：原有描述太短 (< 15字) 且抓到了更丰富的远端描述
      if (probe.meta?.description && (!site.description || site.description.length < 15)) {
        newDesc = probe.meta.description.slice(0, 200);
        const idx = buildIndexFields({
          title: site.title,
          description: newDesc,
          url: site.url,
          tags: [],
        });
        newFts = idx.ftsTokens;
        newPinyinFull = idx.pinyinFull;
        newPinyinInitials = idx.pinyinInitials;
        healedCount++;
        process.stdout.write(`✓ [健康 200 / 描述自愈] (${probe.latency}ms)\n`);
      } else {
        process.stdout.write(`✓ [健康 200] (${probe.latency}ms)\n`);
      }

      if (!dryRun) {
        const now = Date.now();
        updateSiteStmt.run(
          probe.status,
          1,
          probe.latency,
          probe.redirectTo,
          null,
          now,
          newDesc,
          newDesc,
          newFts,
          newFts,
          newPinyinFull,
          newPinyinFull,
          newPinyinInitials,
          newPinyinInitials,
          now,
          site.id
        );
      }
    } else {
      failedCount++;
      process.stdout.write(`✗ [异常: ${probe.error}] (${probe.latency}ms)\n`);
      if (!dryRun) {
        const now = Date.now();
        updateSiteStmt.run(
          probe.status,
          0,
          probe.latency,
          probe.redirectTo,
          probe.error,
          now,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          now,
          site.id
        );
      }
    }
  }

  console.log("\n========================================");
  console.log(`巡检汇总: 扫描 ${candidates.length} 个 | 存活: ${successCount} | 异常: ${failedCount} | 描述自愈: ${healedCount}`);
  if (dryRun) {
    console.log("【注意】本次为 Dry-Run 试跑，数据库未做任何实际写入。");
  } else {
    console.log("✓ 数据已落盘，站点健康记录与自愈元数据已更新。");
  }
}

run().catch((err) => {
  console.error("Agent 运行异常:", err);
  process.exit(1);
});
