#!/usr/bin/env node
/**
 * 抓取「真实渲染」的 SEO 语料，供 check-isr-routes 的契约层做变异自证。
 *
 * 为什么语料必须是真实页面：契约判定复用审计侧同一个 `auditPageDetailed`，
 * 手写一段「长得像 Next 输出」的 HTML 只能证明我预期它会红的那些形态。真实
 * 渲染的 head 里 Next 自己塞了 viewport / theme-color / multiple og:image 尺寸
 * 变体，解析假设一旦和真实结构错位，契约层就变成静默绿 —— 只有拿真页面做变异才暴露。
 *
 * 用法（对着一个跑起来的站点，dev 或 next start 都行）：
 *   node scripts/capture-isr-corpus.mjs --base=http://localhost:3000
 *   node scripts/capture-isr-corpus.mjs --base=… --only=site,category,marketplace
 *
 * 每个族从 /sitemap.xml 取第一条真实 URL（不硬编码 uuid —— 换库也能重跑）。
 * 只保留 <head> 里爬虫与分享卡要读的部分 + 第一个 <h1>：正文是数据渲染，
 * 放进仓库只会让语料随库里站点变化而漂移，而契约判定的输入不在正文里。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { sitemapEntries } from './check-isr-routes.mjs';

const valueOf = (name) => {
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const BASE = String(valueOf('base') ?? 'http://localhost:3000').trim().replace(/\/+$/, '');
const OUT_DIR = String(valueOf('out') ?? 'scripts/fixtures/isr-live-corpus');
const ONLY = String(valueOf('only') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** 与门禁白名单同族的基底；name 决定落盘文件名。 */
const FAMILIES = [
  { name: 'site-detail', re: /^\/site\// },
  { name: 'category', re: /^\/category\// },
  { name: 'tag', re: /^\/tags\// },
  { name: 'collection', re: /^\/collections\// },
  { name: 'marketplace-detail', re: /^\/marketplace\// },
  { name: 'directory', re: /^\/sites$/ },
];

const origin = new URL(BASE).origin;

function stripToContract(html, path) {
  const head = (html.match(/<head>[\s\S]*?<\/head>/) ?? [''])[0];
  if (!head) throw new Error(`${path} 的响应里没有 <head>（拿到的是 JSON 或错误页？）`);
  const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]);
  const h1 = (html.match(/<h1\b[\s\S]*?<\/h1>/) ?? [''])[0];
  let kept = head
    .replace(/<script(?![\s][^>]*application\/ld\+json)[\s\S]*?<\/script>/g, '')
    .replace(/<link rel="(stylesheet|preload|modulepreload|prefetch|dns-prompt|icon)"[^>]*>/g, '')
    .replace(/\n\s*\n/g, '\n');
  const extra = ldBlocks.filter((b) => !kept.includes(b)).join('');
  kept = kept.replace('</head>', `${extra}\n${h1}</head>`);
  return kept.replace(new RegExp(`${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), 'https://navhub.example');
}

const note = (path, base) => `<!-- 真实渲染语料（契约层变异自证用），由 scripts/capture-isr-corpus.mjs 生成。
     来源：对着 ${base} 跑起来的站点抓 ${path}，只保留 head 区块里的 title/meta/link、
     ld+json 与页面首个 H1；丢掉 dev 专属的 chunk 脚本与 preload/stylesheet 链接
     及正文。响应的 origin 字面量改写为 https://navhub.example —— 留着本机端口会先撞在
     「本机地址兜底」那条判定上，那是另一条断言的职责。
     再生成：node scripts/capture-isr-corpus.mjs --base=${base} -->`;

async function main() {
  const sm = await fetch(`${BASE}/sitemap.xml`);
  if (!sm.ok) {
    console.error(`✖ /sitemap.xml 返回 ${sm.status} —— 站点没起来，或 --base 指错`);
    return 1;
  }
  const entries = sitemapEntries(await sm.text());
  if (!entries.length) {
    console.error('✖ sitemap 为空，取不到任何族的样本');
    return 1;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  let written = 0;
  for (const fam of FAMILIES) {
    if (ONLY.length && !ONLY.includes(fam.name)) continue;
    const hit = entries.find((e) => fam.re.test(e.path));
    if (!hit) {
      console.log(`· ${fam.name.padEnd(20)} sitemap 里没有该族条目，跳过`);
      continue;
    }
    const res = await fetch(`${BASE}${hit.path}${hit.search}`);
    if (!res.ok) {
      console.log(`· ${fam.name.padEnd(20)} ${hit.path} 返回 ${res.status}，跳过`);
      continue;
    }
    const body = stripToContract(await res.text(), hit.path);
    const out = `<!DOCTYPE html>\n<html lang="zh-CN">\n${note(hit.path, BASE)}\n${body}\n</html>\n`;
    writeFileSync(`${OUT_DIR}/${fam.name}.html`, out);
    console.log(
      `✓ ${fam.name.padEnd(20)} ${hit.path} bytes=${String(out.length).padStart(6)}` +
        ` ld块=${(out.match(/application\/ld\+json/g) ?? []).length}` +
        ` h1=${(out.match(/<h1\b/g) ?? []).length} 本机origin残留=${(out.match(/localhost/g) ?? []).length}`,
    );
    written += 1;
  }
  if (!written) {
    console.error('✖ 一个族都没抓到，语料没落盘');
    return 1;
  }
  return 0;
}

process.exit(await main());
