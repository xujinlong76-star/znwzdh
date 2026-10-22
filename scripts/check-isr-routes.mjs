#!/usr/bin/env node
/**
 * ISR 路由门禁（零依赖，Node >= 20）
 *
 * 为什么需要它：Next 16 的分类/插件详情这类路由同时带 `revalidate` 与
 * `generateStaticParams`，只要页面签名（default export 或 generateMetadata）
 * 读了 `searchParams`，未预渲染的参数走按需生成时就会抛
 * `DYNAMIC_SERVER_USAGE` —— 生产构建实测是 **500**，不是「少一层缓存」。
 * 而本地开发跑的是 `next dev`（没有静态生成这一步），这类回归在 dev 与
 * tsc/eslint 上都是隐形，PR 阶段唯一能拦住它的地方是构建产物本身。
 *
 * 两种模式：
 *   node scripts/check-isr-routes.mjs                 # 构建产物门禁（CI test-web 用）
 *   node scripts/check-isr-routes.mjs --live --base=https://…   # 线上形态抽查
 *
 * --live 校验的是「产物跑起来之后」的表现：ISR 族页面必须带
 * `cache-control: s-maxage`（没有就说明退化成了每次请求现渲），且不得 5xx；
 * `/category/{slug}?page=N` 必须被配置层 308 到 `/p/{N}`（旧形态是已收录 URL）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--') && !a.includes('=')));
const valueOf = (name, dflt = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
/** 源码门禁的根：测试用 fixture 树指这里，避免为了验证「会红灯」而改真实源码 */
const SRC_ROOT = resolve(valueOf('src-root', ROOT));

/**
 * 必须是 ISR（●）而不是每次请求现渲（ƒ）的收录型路由。
 * `src` 用于源码门禁：这些文件一旦读 searchParams 或删掉 revalidate，
 * 构建产物会在下一次 CI 里红灯，而不是等线上 500。
 *
 * 故意不含 /marketplace/[slug]/preview 与 /sites：前者是内部预览通道，
 * 后者仍按 ?page=N 现渲（已知缺口，见 docs/seo 的收尾清单）。
 */
const WHITELIST = [
  {
    route: '/category/[slug]',
    urlPrefix: '/category/',
    src: 'apps/web-overlay/src/app/category/[slug]/page.tsx',
    // 分页族单独一条：两类页在 Next 里是两个路由模板，可能一类是 ● 另一类已经退化成 ƒ
    excludePaged: true,
  },
  {
    route: '/category/[slug]/p/[n]',
    urlPrefix: '/category/',
    src: 'apps/web-overlay/src/app/category/[slug]/p/[n]/page.tsx',
    paged: true,
  },
  {
    route: '/marketplace/[slug]',
    urlPrefix: '/marketplace/',
    src: 'apps/web-overlay/src/app/marketplace/[slug]/page.tsx',
  },
  { route: '/site/[id]', urlPrefix: '/site/', src: 'apps/web-overlay/src/app/site/[id]/page.tsx' },
  { route: '/tags/[slug]', urlPrefix: '/tags/', src: 'apps/web-overlay/src/app/tags/[slug]/page.tsx' },
  {
    route: '/collections/[slug]',
    urlPrefix: '/collections/',
    src: 'apps/web-overlay/src/app/collections/[slug]/page.tsx',
  },
];

/** 注释里出现 searchParams 是正常说法（解释为什么不能用），门禁只看真实代码 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function checkSource(srcRoot = SRC_ROOT) {
  const failures = [];
  for (const { route, src } of WHITELIST) {
    const file = resolve(srcRoot, src);
    if (!existsSync(file)) {
      failures.push(`${route}：源码 ${src} 不存在`);
      continue;
    }
    const body = stripComments(readFileSync(file, 'utf8'));
    if (!/export\s+const\s+revalidate\s*=\s*\d+/.test(body)) {
      failures.push(`${route}：缺少 \`export const revalidate = N\`（没有它就不是 ISR）`);
    }
    if (/export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(body)) {
      failures.push(`${route}：声明了 force-dynamic，与 ISR 冲突`);
    }
    if (/\bsearchParams\b/.test(body)) {
      failures.push(
        `${route}：签名里读了 searchParams —— 按需生成会抛 DYNAMIC_SERVER_USAGE（生产 500）。把查询语义迁到路径段或独立路由。`,
      );
    }
  }
  return failures;
}

function checkBuild() {
  const distDir = process.env.NEXT_DIST_DIR || '.next';
  const dist = resolve(ROOT, 'apps/web', distDir);
  const prerender = readJson(resolve(dist, 'prerender-manifest.json'));
  if (!prerender) {
    console.error(`✖ 读不到 ${dist}/prerender-manifest.json —— 先跑 next build（或设对 NEXT_DIST_DIR）`);
    return 1;
  }
  const dynamic = prerender.dynamicRoutes || {};
  const staticRoutes = prerender.routes || {};

  const rows = [];
  const failures = [];
  for (const { route } of WHITELIST) {
    const entry = dynamic[route];
    const prerendered = Object.keys(staticRoutes).some((p) => p === route || p.startsWith(`${route}/`));
    if (entry) {
      rows.push(['●', route, `compute=${entry.compute ?? 'blocking'}`]);
      if (entry.compute && entry.compute !== 'initial isr blocking' && entry.compute !== 'blocking') {
        failures.push(`${route}：prerender-manifest 里 compute=${entry.compute}，不是按需 ISR`);
      }
    } else if (prerendered) {
      rows.push(['●', route, 'build 期全量预渲染']);
    } else {
      rows.push(['ƒ', route, '不在 prerender-manifest（每次请求现渲）']);
      failures.push(`${route}：退化为动态渲染（ƒ）——ISR 丢失`);
    }
  }

  const srcFailures = checkSource();
  failures.push(...srcFailures);

  for (const [mark, route, note] of rows) {
    console.log(`${mark} ${route.padEnd(28)} ${note}`);
  }
  if (failures.length) {
    console.error('\n✖ ISR 门禁未通过：');
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(`\n✓ ${WHITELIST.length} 条收录型路由都是 ISR（●）`);
  return 0;
}

const TIMEOUT_MS = Number(valueOf('timeout', '15000')) || 15000;

async function probe(base, path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': 'NavHub-ISR-Check/1.0', accept: 'text/html' },
    });
    return {
      status: res.status,
      cacheControl: res.headers.get('cache-control') ?? '',
      location: res.headers.get('location') ?? '',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function sitemapPaths(base) {
  const res = await fetch(`${base}/sitemap.xml`, { headers: { 'user-agent': 'NavHub-ISR-Check/1.0' } });
  if (!res.ok) throw new Error(`sitemap.xml HTTP ${res.status}`);
  const xml = await res.text();
  // sitemap 里是绝对 URL（origin 来自 NAVHUB_SITE_URL，可能与 --base 不同源），
  // 统一只取 path 部分再按前缀分族。
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => {
      try {
        return new URL(m[1]).pathname;
      } catch {
        return m[1].split('?')[0];
      }
    })
    .filter((p) => p.startsWith('/'));
}

async function checkLive() {
  const base = (valueOf('base') ?? process.env.NAVHUB_SITE_URL ?? 'http://localhost:3000')
    .trim()
    .replace(/\/+$/, '');
  try {
    new URL(base);
  } catch {
    console.error(`✖ --base 不是合法 URL：${base}`);
    return 1;
  }
  const perFamily = Math.max(1, Number(valueOf('sample', '2')) || 1);
  const failures = [];
  let checked = 0;

  let paths = [];
  try {
    paths = await sitemapPaths(base);
  } catch (err) {
    console.error(`✖ 取不到 ${base}/sitemap.xml：${err.message}`);
    return 1;
  }

  for (const entry of WHITELIST) {
    const { route, urlPrefix, paged } = entry;
    const all = [...new Set(paths.filter((p) => p.startsWith(urlPrefix)))];
    const matching = all.filter((p) => (paged ? /\/p\/[^/]+$/.test(p) : !/\/p\/[^/]+$/.test(p)));
    // 分页页不会进 sitemap（第 2 页起 noindex），但恰恰是它最容易在按需生成时 500。
    // 没有现成样本时用第一个分类页造一个 /p/2：超出末页的 404 是正确行为，
    // 因此这一族只把「5xx」和「没有 s-maxage」判失败。
    const sample = matching.length
      ? matching.slice(0, perFamily)
      : paged && all.length
        ? [`${all.find((p) => !/\/p\/[^/]+$/.test(p)) ?? all[0]}/p/2`]
        : [];
    if (!sample.length) {
      console.log(`– ${route.padEnd(28)} sitemap 里没有 ${urlPrefix}* 样本，跳过`);
      continue;
    }
    for (const path of sample) {
      checked += 1;
      const r = await probe(base, path);
      const allow = paged ? [200, 404] : [200];
      const okStatus = allow.includes(r.status);
      const cached = /s-maxage=\d+/.test(r.cacheControl);
      console.log(
        `${okStatus && cached ? '✓' : '✖'} ${(paged ? 'ISR 分页' : 'ISR 页面').padEnd(9)} ${path.padEnd(44)} ${r.status} cc=${r.cacheControl || '—'}`,
      );
      if (r.status >= 500) failures.push(`${path}：HTTP ${r.status}（5xx 通常是 DYNAMIC_SERVER_USAGE）`);
      else if (!okStatus) failures.push(`${path}：HTTP ${r.status}，期望 ${allow.join('/')}`);
      else if (!cached) failures.push(`${path}：没有 s-maxage，说明这一页没走 ISR 缓存`);
    }
  }

  // 旧形态 ?page=N 的归一：分类第 2 页起必须被配置层 308 到 /p/{N}
  const category = paths.find((p) => p.startsWith('/category/') && !/\/p\//.test(p));
  if (category) {
    const r = await probe(base, `${category}?page=2`);
    const target = `${category}/p/2`;
    const ok = (r.status === 301 || r.status === 308) && r.location.startsWith(target);
    console.log(`${ok ? '✓' : '✖'} ${'旧形态归一'.padEnd(9)} ${(category + '?page=2').padEnd(44)} ${r.status} loc=${r.location || '—'}`);
    if (!ok) failures.push(`${category}?page=2 没有 30x 到 ${target}（旧收录 URL 会白扔权重）`);
  }

  if (failures.length) {
    console.error(`\n✖ 线上 ISR 抽查未通过（${failures.length} 项 / 共 ${checked} 页）：`);
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(`\n✓ 线上 ISR 抽查通过：${checked} 页全部 200 且带 s-maxage`);
  return 0;
}

const code = flags.has('--live') ? await checkLive() : checkBuild();
process.exit(code);
