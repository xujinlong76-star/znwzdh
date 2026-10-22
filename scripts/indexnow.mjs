#!/usr/bin/env node
/**
 * 部署后把站点 URL 批量推送给 IndexNow（Bing / Yandex / Naver / Seznam 共用端点）。
 *
 * 用法：
 *   INDEXNOW_KEY=<8-128位字母数字> NAVHUB_SITE_URL=https://your.site node scripts/indexnow.mjs
 *   node scripts/indexnow.mjs --base=https://your.site --dry-run
 *   node scripts/indexnow.mjs --sitemap=https://your.site/sitemap.xml --skip-key-check
 *
 * 前置条件：`{base}/{key}.txt` 必须可公开访问且内容等于 key（协议要求）。
 * 脚本默认先做这项校验，失败会打印放置说明并退出——宁可不推，也不能推一批
 * 因 key 校验失败而全部 403 的 URL。
 *
 * 退出码：0 = 成功（或 dry-run）；1 = 配置/校验/提交失败。
 */

const MAX_BATCH = 10_000; // IndexNow 单请求上限
const DEFAULT_ENDPOINT = "https://api.indexnow.org/indexnow";
// 无超时的 fetch 会永久挂住：key 文件/ sitemap 所在站点半死（accept 但不应答）时，
// 部署后作业既不成功也不失败，只是不再返回。CI 上就是 6 小时白等。
const TIMEOUT_MS = (() => {
  const raw = Number(process.env.INDEXNOW_TIMEOUT_MS ?? 20_000);
  return Number.isFinite(raw) && raw >= 1_000 ? Math.min(raw, 120_000) : 20_000;
})();

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--") && !a.includes("=")));
const valueOf = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const base = (valueOf("base") ?? process.env.NAVHUB_SITE_URL ?? "").trim().replace(/\/+$/, "");
const key = (process.env.INDEXNOW_KEY ?? "").trim();
const dryRun = flags.has("--dry-run");
const skipKeyCheck = flags.has("--skip-key-check");

if (!base) fail("缺少站点地址：用 --base=https://your.site 或设置 NAVHUB_SITE_URL");
if (!/^https?:\/\/[^/?#\s]+$/i.test(base)) fail(`站点地址必须是纯 origin（当前：${base}）`);
if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) {
  fail("INDEXNOW_KEY 必须是 8-128 位字母/数字/连字符（IndexNow 协议要求）");
}

const baseUrl = new URL(base);
const host = baseUrl.host;
const keyLocation = `${base}/${key}.txt`;
const sitemapUrl = valueOf("sitemap") ?? `${base}/sitemap.xml`;
const endpoint = process.env.INDEXNOW_ENDPOINT ?? DEFAULT_ENDPOINT;

function decodeXml(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * key 就写在 keyLocation 的路径里（协议要求 `{base}/{key}.txt`），所以任何带上这条
 * URL 的报错都会把凭据原文打进 CI 日志。而「报错」恰恰发生在该 URL 还没公开可达时
 * ——日志成了唯一的泄露口。统一打码：需要看路径的人拿到 <key> 占位即可。
 */
function redact(text) {
  return key ? String(text).split(key).join("<key>") : String(text);
}

async function fetchText(url, init) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    // 超时/连接失败原本只报 "This operation was aborted"，读不出是慢还是断
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(`${redact(url)} 在 ${TIMEOUT_MS}ms 内无响应（可用 INDEXNOW_TIMEOUT_MS 调整）`);
    }
    throw error;
  }
  if (!res.ok) throw new Error(`${redact(url)} → HTTP ${res.status}`);
  return res.text();
}

console.log(`IndexNow · host=${host} · endpoint=${endpoint}${dryRun ? " · DRY RUN" : ""}`);

if (!dryRun && !skipKeyCheck) {
  try {
    const body = (await fetchText(keyLocation, { headers: { "cache-control": "no-cache" } })).trim();
    if (body !== key) {
      fail(
        `key 校验失败：${redact(keyLocation)} 返回的内容与 INDEXNOW_KEY 不一致。\n` +
          `  把 key 写入 <key>.txt 并部署到站点根目录后再运行；\n` +
          `  如果 key 由网关注入、脚本无法读取，可加 --skip-key-check。`,
      );
    }
    console.log(`✓ key 校验通过：${redact(keyLocation)}`);
  } catch (error) {
    fail(`key 文件不可访问：${error.message}\n  先把 <key>.txt 放到站点根目录（内容就是 key 本身）。`);
  }
}

let urls;
try {
  const sitemap = await fetchText(sitemapUrl);
  urls = [...sitemap.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)]
    .map((m) => decodeXml(m[1]).trim())
    .filter((raw) => {
      try {
        const url = new URL(raw);
        // IndexNow 只接受提交 host 下的 URL；跨域条目直接丢弃
        return url.origin === baseUrl.origin && (url.protocol === "https:" || url.protocol === "http:");
      } catch {
        return false;
      }
    });
} catch (error) {
  fail(`读取 sitemap 失败：${error.message}`);
}

// 同一 URL 在 sitemap 里重复出现时只提交一次
urls = [...new Set(urls)];
if (urls.length === 0) fail(`sitemap 中没有 ${host} 下的 URL：${sitemapUrl}`);

console.log(`· sitemap 解析到 ${urls.length} 条同源 URL`);
if (dryRun) {
  console.log("· 前 5 条：" + urls.slice(0, 5).join("\n           "));
  console.log("✓ dry-run 完成，未提交");
  process.exit(0);
}

let submitted = 0;
for (let offset = 0; offset < urls.length; offset += MAX_BATCH) {
  const batch = urls.slice(offset, offset + MAX_BATCH);
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key, keyLocation, urlList: batch }),
    });
  } catch (error) {
    const why = error?.name === "TimeoutError" || error?.name === "AbortError"
      ? `${endpoint} 在 ${TIMEOUT_MS}ms 内无响应`
      : `${endpoint} 请求失败：${error.message}`;
    fail(`提交中断（已提交 ${submitted}/${urls.length}）：${why}`);
  }
  // 200 = 已接收；202 = 已接收、key 待校验（IndexNow 规范）
  if (res.status !== 200 && res.status !== 202) {
    const detail = (await res.text().catch(() => "")).slice(0, 500);
    fail(`提交失败：HTTP ${res.status}${detail ? ` · ${detail}` : ""}`);
  }
  submitted += batch.length;
  console.log(`✓ 已提交 ${submitted}/${urls.length}（HTTP ${res.status}）`);
}

console.log("完成。搜索引擎抓取计划由其自身决定，通常数小时到数天内生效。");
