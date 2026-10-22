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
 *
 * `NAVHUB_SITE_URL` 不是 --live 跑通的前提（prod 配置清单仍然要求配好它）。
 * 实测（2026-10-22，同一份无 origin 构建产物 + 运行时也不给这个变量）：收录型
 * 渲染链全绿，缺配置的形态是「canonical / og:url 走相对地址、面包屑与 ItemList
 * 的结构化数据缺席」而不是 500 —— 补上环境变量后一个 revalidate 周期自愈。
 * 历史上这里 `/site/{id}`、`/tags/{slug}`、`/collections/{slug}`、
 * `/marketplace/{slug}` 会整批 500：它们在按需生成（静态上下文）里
 * `await siteOrigin()`，拿不到配置就走到 `headers()`，于是抛
 * DYNAMIC_SERVER_USAGE。ISR_RENDER_CHAIN 的源码钉子就是防止这条路走回头。
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
 * 收录型路由一律硬门禁，不设「只看提示」的豁免档。`/sites` 页 1 曾经豁免过，
 * 理由当时成立、后来不成立：它的渲染链会经 `siteOrigin()` 兜底读 `headers()`，
 * 而 CI / Docker 的 `next build` 阶段都没有 `NAVHUB_SITE_URL`（运行时才注入），
 * 于是构建期判成 ƒ、`revalidate` 全废。2026-10-22 起根布局 metadataBase 与
 * 站点目录改用 `configuredSiteOrigin()`（只读环境变量，绝不碰 headers()），
 * 静态路径的预渲染不再依赖构建期 origin —— 门禁因此重新封死，任何一处
 * 把 `headers()` 放回 `/sites` 渲染链的改动都会在这里红灯。
 *
 * 故意不含 /marketplace/[slug]/preview：内部预览通道，不进索引也不该有缓存语义。
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
    // 站点目录第 1 页：没有动态段的静态路径，构建期就要落进 prerender.routes
    // （渲染链不读 headers()，见上面 WHITELIST 注释）
    route: '/sites',
    urlPrefix: '/sites',
    src: 'apps/web-overlay/src/app/sites/page.tsx',
    excludePaged: true,
  },
  {
    // 站点目录第 2 页起：2026-10-22 从 `?page=N` 迁到路径段，就是为了这条族能进 ISR
    route: '/sites/p/[n]',
    urlPrefix: '/sites',
    src: 'apps/web-overlay/src/app/sites/p/[n]/page.tsx',
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

/**
 * 收录型 ISR 路由的渲染链文件——一律禁止出现 `siteOrigin()`。
 *
 * 它在 `NAVHUB_SITE_URL` 缺失时回退到 `headers()`，而后果按路由形态分两种，
 * 两种都是实测（2026-10-22，无 origin 的构建产物）而不是推断：
 *  - 没有动态段的静态路径（`/sites`）在**构建期**解析，读到 headers() 就落成 ƒ，
 *    `revalidate` 静默作废、爬虫面每次请求现渲；
 *  - 带动态段的按需生成（`/site/{id}`、`/tags/{slug}`、`/collections/{slug}`、
 *    `/marketplace/{slug}`）走的是静态生成上下文，读到 headers() 直接抛
 *    DYNAMIC_SERVER_USAGE —— **500**，整条内容页全废。
 * 正确写法是 `configuredSiteOrigin()`（只读环境变量）：缺配置时的降级是
 * 「JSON-LD 不输出、地址保持相对」，既不掉缓存也不炸页。
 *
 * 故意不在这个名单里：`sitemap.ts` / `robots.ts` / `feed.xml` / 首页 —— 它们本来就是
 * ƒ（每次请求现渲），headers() 兜底在那儿是合法且有用的（sitemap 的 `<loc>` 必须绝对）。
 */
const ISR_RENDER_CHAIN = [
  'apps/web-overlay/src/app/layout.tsx',
  'apps/web-overlay/src/components/breadcrumbs.tsx',
  'apps/web-overlay/src/app/sites/page.tsx',
  'apps/web-overlay/src/app/sites/sites-directory.tsx',
  'apps/web-overlay/src/app/sites/p/[n]/page.tsx',
  'apps/web-overlay/src/app/category/[slug]/category-board.tsx',
  'apps/web-overlay/src/app/category/[slug]/page.tsx',
  'apps/web-overlay/src/app/category/[slug]/p/[n]/page.tsx',
  'apps/web-overlay/src/app/site/[id]/page.tsx',
  'apps/web-overlay/src/app/tags/[slug]/page.tsx',
  'apps/web-overlay/src/app/collections/[slug]/page.tsx',
  'apps/web-overlay/src/app/marketplace/[slug]/layout.tsx',
  'apps/web-overlay/src/app/marketplace/[slug]/page.tsx',
  'apps/web-overlay/src/app/marketplace/author/[key]/page.tsx',
];

function checkRenderChain(srcRoot = SRC_ROOT) {
  const failures = [];
  for (const rel of ISR_RENDER_CHAIN) {
    const file = resolve(srcRoot, rel);
    if (!existsSync(file)) {
      failures.push(`${rel}：收录型渲染链文件不存在`);
      continue;
    }
    const body = stripComments(readFileSync(file, 'utf8'));
    if (/\bsiteOrigin\s*\(/.test(body)) {
      failures.push(
        `${rel}：调用了 siteOrigin()（缺 NAVHUB_SITE_URL 时会读 headers()）——静态路径退化成 ƒ、按需生成直接 500；改用 configuredSiteOrigin()`,
      );
    }
  }
  return failures;
}

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

  const srcFailures = [...checkSource(), ...checkRenderChain()];
  failures.push(...srcFailures);

  for (const [mark, route, note] of rows) {
    console.log(`${mark} ${route.padEnd(28)} ${note}`);
  }
  if (failures.length) {
    console.error('\n✖ ISR 门禁未通过：');
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(`\n✓ ${WHITELIST.length} 条收录型路由的产物与源码门禁都通过`);
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

  // 旧形态 ?page=N 与第 1 页变体的归一：必须被配置层/路由 30x 到路径段形态，
  // 否则已收录的旧 URL 权重白扔，还会多出 `/sites/p/1` 这类重复页。
  const legacyChecks = [
    {
      // 分类：从 sitemap 里取一个真实分类页做样本
      base: paths.find((p) => p.startsWith('/category/') && !/\/p\//.test(p)),
      from: '?page=2',
      to: '/p/2',
    },
    {
      // 站点目录：`/sites` 只有一条 sitemap 入口，第 1 页形态是裸路径
      base: paths.find((p) => p === '/sites') ? '/sites' : undefined,
      from: '?page=2',
      to: '/p/2',
    },
    { base: '/sites', from: '/p/1', to: '' },
  ];
  for (const { base: pageBase, from, to } of legacyChecks) {
    if (!pageBase) continue;
    const url = `${pageBase}${from}`;
    const r = await probe(base, url);
    const target = `${pageBase}${to}`;
    const ok = (r.status === 301 || r.status === 308) && r.location.startsWith(target);
    console.log(
      `${ok ? '✓' : '✖'} ${'旧形态归一'.padEnd(9)} ${url.padEnd(44)} ${r.status} loc=${r.location || '—'}`,
    );
    if (!ok) failures.push(`${url} 没有 30x 到 ${target || '（裸路径）'}（旧收录 URL 会白扔权重）`);
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
