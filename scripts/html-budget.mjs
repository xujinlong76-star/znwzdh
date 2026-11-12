#!/usr/bin/env node
/**
 * 首页 HTML 预算哨兵。
 *
 * 背景：首页把全量站点数据与卡片一次性 SSR 进 HTML，历史上 1013 站时
 * dev HTML 达到 7.5MB。体积不会突然爆炸，但会随每次「顺手加个字段」
 * 缓慢爬升——等到 CWV 报警已经晚了两周。这里在部署后量一次，超预算即失败。
 *
 * 用法（线上 URL 模式）：
 *   node scripts/html-budget.mjs --url=https://your.site/ --max-kb=1500
 *   node scripts/html-budget.mjs --url=http://localhost:3000 --json
 *
 * 用法（产物模式，CI test-web 用）：量 next build 落盘的预渲染 HTML，
 * 取其中最大一份与预算比对。`/` 是动态渲染，不在预渲染产物里，仍由
 * seo-audit-prod 对线上量。
 *   node scripts/html-budget.mjs --dist --max-kb=4096
 *   node scripts/html-budget.mjs --dist=apps/web/.next/server/app --json
 * 默认目录：apps/web/.next/server/app（仓库根运行），退到 .next/server/app；
 * 两个都不存在时明确报错退出 1，绝不静默放行。
 *
 * 注意：量的是**解压后**的 HTML 字节数（fetch 自动解压）。CDN 压缩率另计，
 * 这里盯的是解析与传输前的原始载荷，与 RSC 序列化膨胀直接相关。
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const valueOf = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const maxKb = Number(valueOf("max-kb") ?? process.env.HTML_BUDGET_KB ?? 4096);
const json = args.includes("--json");
const timeoutMs = Number(process.env.HTML_BUDGET_TIMEOUT_MS ?? 30_000);

if (!Number.isFinite(maxKb) || maxKb <= 0) {
  console.error("✖ --max-kb 必须是正数");
  process.exit(1);
}

// --dist 可能是裸 flag（--dist）或带值（--dist=<dir>）。
const distFlag = valueOf("dist") ?? (args.includes("--dist") ? "" : null);

if (distFlag !== null) {
  const candidates = distFlag
    ? [resolve(distFlag)]
    : [resolve("apps", "web", ".next", "server", "app"), resolve(".next", "server", "app")];
  const distDir = candidates.find((d) => existsSync(d));
  if (!distDir) {
    console.error(
      `✖ --dist 找不到预渲染产物目录：${candidates.join(" / ")}（先跑 web build）`,
    );
    process.exit(1);
  }

  // 递归收全部 *.html（预渲染页）；只量文件字节，不读内容。
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".html")) {
        files.push({ rel: relative(distDir, full), bytes: statSync(full).size });
      }
    }
  };
  walk(distDir);

  if (files.length === 0) {
    console.error(`✖ --dist 在 ${distDir} 下未找到任何 .html（先跑 web build）`);
    process.exit(1);
  }

  files.sort((a, b) => b.bytes - a.bytes);
  const top = files.slice(0, 3);
  const max = top[0];
  const maxKbActual = Number((max.bytes / 1024).toFixed(1));
  const budgetBytes = Math.round(maxKb * 1024);
  const ok = max.bytes <= budgetBytes;

  if (json) {
    console.log(
      JSON.stringify({
        mode: "dist",
        dist: distDir,
        files: files.length,
        maxFile: max.rel,
        maxBytes: max.bytes,
        maxKb: maxKbActual,
        budgetKb: maxKb,
        ok,
      }),
    );
  } else {
    console.log(
      `${ok ? "✔" : "✖"} --dist ${distDir}：${files.length} 份预渲染 HTML，最大 ${max.rel} → ${maxKbActual} KB（预算 ${maxKb} KB）`,
    );
    for (const f of top) {
      console.log(`    ${f.rel} → ${(f.bytes / 1024).toFixed(1)} KB`);
    }
  }
  process.exit(ok ? 0 : 1);
}

const url = valueOf("url") ?? process.env.NAVHUB_SITE_URL ?? "";

if (!/^https?:\/\/[^/?#\s]+\/?/i.test(url)) {
  console.error("✖ 缺少 URL：用 --url=https://your.site 或设置 NAVHUB_SITE_URL");
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
