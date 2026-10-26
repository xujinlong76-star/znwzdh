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
 * `--check`（只读，不写文件）：把「仓库里的语料」和「现在抓一遍的同一族页面」放在
 * 同一个结构签名 + 同一套契约裁决下比对。语料是会过期的：渲染 head 的代码改了
 * （多一块 JSON-LD、og 换成逐页图、title 模板变了），旧语料照样让变异自证全绿，
 * 但那已经不是爬虫今天拿到的页面形状 —— 契约层于是重新变成「自证通过、实际失明」。
 * 这一条让「过期」可判定，红灯信息直接指出哪个族哪一项漂移。
 *   node scripts/capture-isr-corpus.mjs --base=… --check
 *
 * 每个族从 /sitemap.xml 取第一条真实 URL（不硬编码 uuid —— 换库也能重跑）。
 * 只保留 <head> 里爬虫与分享卡要读的部分 + 第一个 <h1>：正文是数据渲染，
 * 放进仓库只会让语料随库里站点变化而漂移，而契约判定的输入不在正文里。
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTRACT_KINDS_DEFAULT, contractFindings, sitemapEntries } from './check-isr-routes.mjs';

const valueOf = (name) => {
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const BASE = String(valueOf('base') ?? 'http://localhost:3000').trim().replace(/\/+$/, '');
const OUT_DIR = String(valueOf('out') ?? 'scripts/fixtures/isr-live-corpus');
const CHECK = process.argv.includes('--check');
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

/**
 * head 的「结构签名」：只取会随渲染代码变化的形状量，刻意不看正文文字与字节数。
 * 字节级 diff 没法用 —— 库里换了个站点、标题多一个字都会红，而那种红不是过期。
 */
export function shape(html) {
  const all = (re) => [...html.matchAll(re)].map((m) => m[0]);
  const ldTypes = all(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g)
    .map((block) => {
      const json = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
      try {
        const parsed = JSON.parse(json);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        return list.map((n) => n?.['@type'] ?? '?').sort().join('+');
      } catch {
        // 解析不了本身就是要暴露的漂移（真实页面的 ld 一定解析得了）
        return 'PARSE_FAIL';
      }
    })
    .sort()
    .join(',');
  return {
    title: all(/<title>/g).length,
    desc: all(/<meta name="description"/g).length,
    canonical: all(/<link rel="canonical"/g).length,
    lang: (/<html lang="([^"]*)"/.exec(html) ?? [])[1] ?? '-',
    og: all(/<meta (?:property|name)="(og:[^"]+)"/g)
      .map((s) => s.replace(/^<meta (?:property|name)="/, '').replace(/"$/, ''))
      .sort()
      .join(','),
    ldBlocks: all(/<script type="application\/ld\+json"/g).length,
    ldTypes,
    h1: all(/<h1\b/g).length,
    robots: all(/<meta name="robots"[^>]*>/g).join('|'),
  };
}

/** 两个签名的差异项（`--check` 的红灯内容）。 */
export function shapeDiff(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const k of keys) {
    const left = String(a[k] ?? '-');
    const right = String(b[k] ?? '-');
    if (left !== right) out.push(`${k}: 仓库语料=${left || '∅'} → 现抓=${right || '∅'}`);
  }
  return out;
}

const KINDS = () => new Set(CONTRACT_KINDS_DEFAULT);

/**
 * 语料里自己记录的抓取路径（生成器注释里的「来源：对着 … 跑起来的站点抓 /site/&lt;uuid&gt;，」）。
 *
 * `--check` 必须拿语料自己的路径去判它。sitemap 每轮抽到的条目会变（同一族里换了个
 * 站点就是另一个 uuid），而 canonical/og:url 是写死在语料里的：用「今天的条目」判
 * 「仓库里那份」，contractFindings 必然报「canonical 与 URL 不一致」——那是取样轮转，
 * 不是语料过期。run79 实测 6 个族里 2 个就是这样假红的。
 *
 * 轮转不会掩盖真过期：形状签名（shape）与 URL 无关，路由长相由 FAMILIES 的正则
 * 和 --live 抽查各自钉住，都不依赖这一条。
 */
export function corpusSourcePath(html) {
  const m = /跑起来的站点抓 (\/[^\s，]*)，/.exec(html);
  return m ? m[1] : null;
}

/** 契约裁决：把语料喂给门禁同一个 `contractFindings`，返回「发现项」的稳定描述。 */
export function verdict(html, url) {
  return contractFindings(html, url, KINDS(), { expectIndexable: true })
    .map((i) => `${i.kind}:${i.message}`)
    .sort()
    .join(' | ');
}

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
  const drifted = [];
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
    const file = `${OUT_DIR}/${fam.name}.html`;

    if (CHECK) {
      if (!existsSync(file)) {
        drifted.push(`${fam.name}：仓库里没有 ${fam.name}.html，语料缺这一族`);
        console.log(`✖ ${fam.name.padEnd(20)} 语料文件缺失（${file}）`);
        continue;
      }
      const stored = readFileSync(file, 'utf8');
      // 现抓的 `body` 只有 head 区块，语料文件却带生成器那层 `<html lang="zh-CN">` 外壳。
      // 两边必须按同一种包装比，否则 `<html lang>` 这项会常年红在无关处。
      // （代价：外壳语言是生成器写死的，真实页面换 lang 不会被这一条抓到 —— 那是
      //  契约层「meta:缺 lang」在 --live 抽查里管的事，不在语料层。）
      const freshFull = `<!DOCTYPE html>\n<html lang="zh-CN">\n${body}\n</html>\n`;
      // 两边都按 navhub.example 判：`stripToContract` 会把真实 origin 改写成它，
      // 现抓的那份同样是改写后的形状 —— 拿 BASE 去判 canonical 会永远红在
      // 「域名不同」这个跟过期无关的地方。
      const CORPUS_ORIGIN = 'https://navhub.example';
      const storedPath = corpusSourcePath(stored) ?? hit.path;
      const rotated = storedPath !== hit.path;
      const storedVerdict = verdict(stored, `${CORPUS_ORIGIN}${storedPath}`);
      const liveVerdict = verdict(freshFull, `${CORPUS_ORIGIN}${hit.path}`);
      const diffs = shapeDiff(shape(stored), shape(freshFull));
      const verdictChanged = storedVerdict !== liveVerdict;
      const where = `现抓=${hit.path} 语料=${storedPath}${rotated ? '（取样轮转，不影响判定）' : ''}`;
      if (!diffs.length && !verdictChanged) {
        console.log(`✓ ${fam.name.padEnd(20)} 形状与契约裁决一致（${where}）`);
        continue;
      }
      drifted.push(
        `${fam.name}：${diffs.length ? diffs.join('；') : ''}${diffs.length && verdictChanged ? '；' : ''}` +
          `${verdictChanged ? `契约裁决变了 仓库=${storedVerdict || '通过'} → 现抓=${liveVerdict || '通过'}` : ''}`,
      );
      console.log(
        `✖ ${fam.name.padEnd(20)} 语料已过期（${where}）` +
          (diffs.length ? `\n    ${diffs.join('\n    ')}` : '') +
          (verdictChanged ? `\n    契约裁决：仓库=${storedVerdict || '通过'} → 现抓=${liveVerdict || '通过'}` : ''),
      );
      continue;
    }

    const out = `<!DOCTYPE html>\n<html lang="zh-CN">\n${note(hit.path, BASE)}\n${body}\n</html>\n`;
    writeFileSync(`${OUT_DIR}/${fam.name}.html`, out);
    console.log(
      `✓ ${fam.name.padEnd(20)} ${hit.path} bytes=${String(out.length).padStart(6)}` +
        ` ld块=${(out.match(/application\/ld\+json/g) ?? []).length}` +
        ` h1=${(out.match(/<h1\b/g) ?? []).length} 本机origin残留=${(out.match(/localhost/g) ?? []).length}`,
    );
    written += 1;
  }
  if (CHECK) {
    if (drifted.length) {
      console.error(
        `✖ 语料基线过期：${drifted.length} 个族的现抓形状/契约裁决与仓库语料不一致 —— ` +
          `变异自证正在拿旧形状当基准。重跑：node scripts/capture-isr-corpus.mjs --base=${BASE}`,
      );
      return 1;
    }
    console.log('✓ 语料基线未过期：各族的 head 形状与契约裁决都和现抓一致');
    return 0;
  }
  if (!written) {
    console.error('✖ 一个族都没抓到，语料没落盘');
    return 1;
  }
  return 0;
}

// 被 import 时不能自己退进程：测试要拿 shape/shapeDiff 做纯函数断言，
// 而 process.exit 会连带整个 vitest worker 消失（表现是「0 tests」的假绿）。
// 仓库路径经过 Windows junction，两边都要 realpath 后再比。
const canonicalPath = (input) => {
  let out;
  try {
    out = realpathSync(input);
  } catch {
    out = input;
  }
  return out.replace(/\\/g, '/').toLowerCase();
};
const invokedDirectly =
  Boolean(process.argv[1]) && canonicalPath(process.argv[1]) === canonicalPath(fileURLToPath(import.meta.url));

if (invokedDirectly) process.exit(await main());
