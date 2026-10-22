#!/usr/bin/env node
/**
 * 首页 HTML 预算哨兵。
 *
 * 背景：首页把全量站点数据与卡片一次性 SSR 进 HTML，历史上 1013 站时
 * dev HTML 达到 7.5MB。体积不会突然爆炸，但会随每次「顺手加个字段」
 * 缓慢爬升——等到 CWV 报警已经晚了两周。这里在部署后量一次，超预算即失败。
 *
 * 用法：
 *   node scripts/html-budget.mjs --url=https://your.site/ --max-kb=1500
 *   node scripts/html-budget.mjs --url=http://localhost:3000 --json
 *
 * 注意：量的是**解压后**的 HTML 字节数（fetch 自动解压）。CDN 压缩率另计，
 * 这里盯的是解析与传输前的原始载荷，与 RSC 序列化膨胀直接相关。
 */

const args = process.argv.slice(2);
const valueOf = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const url = valueOf("url") ?? process.env.NAVHUB_SITE_URL ?? "";
const maxKb = Number(valueOf("max-kb") ?? process.env.HTML_BUDGET_KB ?? 4096);
const json = args.includes("--json");
const timeoutMs = Number(process.env.HTML_BUDGET_TIMEOUT_MS ?? 30_000);

if (!/^https?:\/\/[^/?#\s]+\/?/i.test(url)) {
  console.error("✖ 缺少 URL：用 --url=https://your.site 或设置 NAVHUB_SITE_URL");
  process.exit(1);
}
if (!Number.isFinite(maxKb) || maxKb <= 0) {
  console.error("✖ --max-kb 必须是正数");
  process.exit(1);
}

try {
  const res = await fetch(url, {
    headers: { "user-agent": "NavHub-HTML-Budget/1.0", "accept-encoding": "gzip, br" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const body = await res.text();
  const bytes = Buffer.byteLength(body, "utf8");
  const kb = Number((bytes / 1024).toFixed(1));
  const budgetBytes = Math.round(maxKb * 1024);
  const ok = bytes <= budgetBytes;

  if (json) {
    console.log(JSON.stringify({ url, bytes, kb, budgetKb: maxKb, ok }));
  } else {
    console.log(`${ok ? "✔" : "✖"} ${url} → ${kb} KB（预算 ${maxKb} KB）`);
  }
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(`✖ 检查失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
