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
 * `--min-checked=N`（默认 1）是 --live 的覆盖率下限：抽查页数不足 N 直接红灯。
 * 空 sitemap / 中枢未起 / base 指错时，每个族只会打一行「跳过」，
 * 于是「0 页通过」看起来像绿灯——那是比红灯更坏的失败（守卫永远不响）。
 *
 * `NAVHUB_SITE_URL` 不是 --live 跑通的前提（prod 配置清单仍然要求配好它）。
 * 实测（2026-10-22，同一份无 origin 构建产物 + 运行时也不给这个变量）：收录型
 * 渲染链全绿，缺配置的形态是「canonical / og:url 走相对地址、面包屑与 ItemList
 * 的结构化数据缺席」而不是 500 —— 补上环境变量后一个 revalidate 周期自愈。
 * 历史上这里 `/site/{id}`、`/tags/{slug}`、`/collections/{slug}`、
 * `/marketplace/{slug}` 会整批 500：它们在按需生成（静态上下文）里
 * `await siteOrigin()`，拿不到配置就走到 `headers()`，于是抛
 * DYNAMIC_SERVER_USAGE。ISR_RENDER_CHAIN 的源码钉子就是防止这条路走回头。
 *
 * 产物门禁还有一条「永久快照」检查：`prerender.routes` 里
 * `initialRevalidateSeconds: false` 的页一旦把 `http://localhost:3000/…` 烤进
 * `server/app/*.html`（metadataBase 缺席时的兜底），就没有 revalidate 周期能把它
 * 洗掉，只能等下次构建。带 revalidate 的路由同款问题会自愈，所以不报。
 *
 * `--live` 侧对同一件事做**独立**取证（2026-10-23）：产物检查读的是构建目录里的
 * HTML，而真正被爬虫拿到的是线上响应。两处都断言才不会被「构建产物干净、线上
 * 那份快照是旧的」这类错位蒙过去。响应体里凡是绝对地址指向本机、且端口和当前
 * base 不一致的（`isBogusLocalOriginAsset`），就是 metadataBase 兜底值被烤死的
 * 残留 —— 分享图在别人机器上打不开，收录页还自带一个错域名绝对地址。
 *
 * 旧形态归一还顺手盯住「跳转目标的 canonical 不得带 query」：配置层 `redirects()`
 * 会把原始 query 带进 308 的 Location（实测 `/category/x?page=2` →
 * `/category/x/p/2?page=2`）。这一点**判为不改**（要抹掉得新增一个会命中所有
 * 收录路由的 Edge middleware，代价和爆炸半径都远超收益；裁决见
 * docs/seo/ISR-ROUTES.md），它成立的前提是落地页 canonical 干净 —— 那个前提才是
 * 必须守的东西，所以把它变成断言而不是留一句注释。
 *
 * 两种「不是 200 但正确」的形态在 CI 自建预览里必然出现（2026-10-23 用新 seed 库
 * 实测），门禁按裁决放行，别当 bug 修：
 *  - 分页样本 308 回归一后的族基底 —— seed 只有 57 个站点、每页 60 个，
 *    totalPages=1，`/sites/p/2` 就是该被 `permanentRedirect` 送回 `/sites`；
 *  - 旧形态跳转的落地页 404 —— 该分类第 2 页确实没内容，硬 404 本身就是
 *    「不可收录」的裁决，没有重复页可谈，所以 canonical 断言只跟着跳转链
 *    走到 200 那一页，走不到就不断言（在 404/308 的响应体里找 canonical 只会
 *    造出假红灯，第一条 CI run 就是这么红的）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBogusLocalOriginAsset, linkHref } from './lib/seo-audit.mjs';

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
    // 首页：全站被爬最多的一条，也是 `/sites` 同族的最后一处「构建期读到 headers()
    // 就落成 ƒ、revalidate=60 静默作废」。`exact` 是因为 urlPrefix 为 '/' 时
    // startsWith 会匹配所有路径，live 抽查必须只取 sitemap 里的根条目。
    route: '/',
    urlPrefix: '/',
    src: 'apps/web-overlay/src/app/page.tsx',
    exact: true,
  },
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
 * 故意不在这个名单里：`sitemap.ts` / `robots.ts` / `feed.xml` —— 它们本来就是
 * ƒ（每次请求现渲），headers() 兜底在那儿是合法且有用的（sitemap 的 `<loc>` 必须绝对）。
 * 首页已在名单内：它带 `revalidate = 60`，兜底 read headers() 会把这条最要紧的
 * 收录页钉成 ƒ（2026-10-22 实测），和 /sites 是同一个缺陷。
 */
const ISR_RENDER_CHAIN = [
  'apps/web-overlay/src/app/layout.tsx',
  'apps/web-overlay/src/app/page.tsx',
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

/**
 * 「永久快照」检查。
 *
 * `initialRevalidateSeconds: false` 的预渲染页没有 revalidate 周期：Next 缺
 * `metadataBase`（即没注入 `NAVHUB_SITE_URL`）时用 `http://localhost:3000` 兜底
 * 解析 og:image，这个地址一旦被烤进产物就一直在线，直到下次重新构建才会变。
 * 带 revalidate 的同款缺陷一个周期就自愈（实测 `/sites`、`/category` 都是这样），
 * 所以只钉这一族——2026-10-22 在 `.next-home` 的 `algorithms.html` 里实测到
 * 2 处 `localhost:3000/og-default.png`，而 `/algorithms` 是 sitemap 里唯一一条
 * `revalidate=false` 的收录页。
 */
const LOCAL_ORIGIN_ASSET = /http:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1])(?::\d+)?\/[^\s"'<>]*/i;

function checkPermanentSnapshots(dist, staticRoutes) {
  const failures = [];
  // 参照地址：产物里烤进去的本机地址是不是「兜底值」，取决于构建期到底有没有配
  // NAVHUB_SITE_URL。CI / Docker 的 next build 没有它 ⇒ 任何本机绝对地址都是兜底；
  // 本地拿 http://localhost:3079 构建的产物里出现同端口的地址则是正确形态
  // （2026-10-23 在同机复现时实测：这一族一度把 :3079 的正常地址全判成红）。
  // 判定与 --live、与 seo-audit 用同一把尺（端口感知），三处规则不漂移。
  const configured = String(process.env.NAVHUB_SITE_URL ?? '').trim();
  for (const [path, entry] of Object.entries(staticRoutes)) {
    if (entry?.initialRevalidateSeconds !== false) continue;
    const rel = path.replace(/^\/+/, '').replace(/\/+$/, '') || 'index';
    const file = resolve(dist, 'server/app', `${rel}.html`);
    // 非 HTML 产物（manifest.webmanifest 等）不在这一条覆盖范围内
    if (!existsSync(file)) continue;
    const html = readFileSync(file, 'utf8');
    let hit = '';
    for (const m of html.matchAll(new RegExp(LOCAL_ORIGIN_ASSET.source, 'gi'))) {
      if (!configured || isBogusLocalOriginAsset(m[0], configured)) {
        hit = m[0];
        break;
      }
    }
    if (!hit) continue;
    failures.push(
      `${path}：revalidate=false 的永久快照里烤进了本机地址（${hit}）——缺 NAVHUB_SITE_URL 时 metadataBase 用 http://localhost:3000 兜底，这一族没有自愈周期；要么给它 revalidate，要么别输出绝对兜底地址`,
    );
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
  failures.push(...checkPermanentSnapshots(dist, staticRoutes));

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

async function probe(base, path, { body = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': 'NavHub-ISR-Check/1.0', accept: 'text/html' },
    });
    const out = {
      status: res.status,
      cacheControl: res.headers.get('cache-control') ?? '',
      location: res.headers.get('location') ?? '',
      contentType: res.headers.get('content-type') ?? '',
      body: '',
    };
    // 只在真要取证时读体：2xx/3xx 的 HTML 才有元信息可读，其余状态码没有正文可言
    if (body && res.status >= 200 && res.status < 400 && /text\/html/i.test(out.contentType)) {
      out.body = await res.text();
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把一个 30x 的 Location 归一成同源 URL，取不到就返回 null。
 *
 * 两件事在这里兜住：
 * - `res.headers.get()` 会把重复的同名头合并成 `a, b`。实测冷生成 `/sites/p/1`
 *   时见过 `location: /sites, /sites` 的双写（同一份产物、下一次请求就只剩一条），
 *   合并值直接喂给 `new URL()` 会变成 `/sites,%20/sites` → 404，把门禁自己带跑。
 *   取第一个片段即可；双写本身只在冷生成那一次出现过，删掉 route-cache 重新生成
 *   就是单条（实测），没能在产物里复现第二次，所以不在这里判失败。
 * - 跨域跳转不在门禁的取证范围（落地页不是本产物），返回 null 让调用方跳过。
 */
function redirectTarget(location, base) {
  const first = String(location ?? "")
    .split(",")[0]
    .trim();
  if (!first) return null;
  try {
    const url = new URL(first, base);
    return url.origin === new URL(base).origin ? url : null;
  } catch {
    return null;
  }
}

/** 去掉末尾斜杠后的路径，用于比较「是不是同一条路由」。 */
function pathOf(url) {
  const trimmed = url.pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * 响应体里「指向本机、且端口和当前 base 不一致」的绝对地址。
 * 判定复用审计侧的同一把尺（isBogusLocalOriginAsset），免得两处规则漂移。
 */
function localOriginAssetFindings(html, pageUrl) {
  const found = new Set();
  for (const m of html.matchAll(new RegExp(LOCAL_ORIGIN_ASSET.source, 'gi'))) {
    if (isBogusLocalOriginAsset(m[0], pageUrl)) found.add(m[0]);
  }
  return [...found];
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
    const { route, urlPrefix, paged, exact } = entry;
    const all = [...new Set(paths.filter((p) => (exact ? p === urlPrefix : p.startsWith(urlPrefix))))];
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
      const r = await probe(base, path, { body: true });
      const allow = paged ? [200, 404] : [200];
      // 分页族还有第三种合法裁决：页码归一后不是本页时，页面自己 permanentRedirect
      // 回归一后的 URL。seed 数据不足一页时（实测：新库 57 个站点、每页 60 个 ⇒
      // totalPages=1 ⇒ `/sites/p/2` 308 → `/sites`）造的样本必然走这一支。
      // 它同样是「这条路由活着、且带着 ISR 缓存语义」的证据，不能判失败。
      const familyBase = path.replace(/\/p\/[^/]+$/, "");
      const target = paged ? redirectTarget(r.location, base) : null;
      const normalizedBack =
        (r.status === 301 || r.status === 308) && target !== null && pathOf(target) === familyBase;
      const okStatus = allow.includes(r.status) || normalizedBack;
      const cached = /s-maxage=\d+/.test(r.cacheControl);
      // 只有拿到正文才有资格谈元信息：404（薄分页的正常裁决）与重定向没有快照可言
      const badAssets = r.status === 200 && r.body ? localOriginAssetFindings(r.body, `${base}${path}`) : [];
      console.log(
        `${okStatus && cached && !badAssets.length ? '✓' : '✖'} ${(paged ? 'ISR 分页' : 'ISR 页面').padEnd(9)} ${path.padEnd(44)} ${r.status}${normalizedBack ? ` → ${pathOf(target)}` : ''} cc=${r.cacheControl || '—'}`,
      );
      if (r.status >= 500) failures.push(`${path}：HTTP ${r.status}（5xx 通常是 DYNAMIC_SERVER_USAGE）`);
      else if (!okStatus) failures.push(`${path}：HTTP ${r.status}，期望 ${allow.join('/')}`);
      else if (!cached) failures.push(`${path}：没有 s-maxage，说明这一页没走 ISR 缓存`);
      else if (badAssets.length) {
        failures.push(
          `${path}：线上响应里带着构建期兜底的本机地址（${badAssets.slice(0, 3).join(' | ')}）——缺 NAVHUB_SITE_URL 时 metadataBase 用 http://localhost:3000 解析，分享图在别人的机器上打不开，canonical/og:url 还会多出一个错域名；配好变量后按需生成一次即可洗掉，永久快照那一族则要靠下一次构建`,
        );
      }
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
    if (!ok) {
      failures.push(`${url} 没有 30x 到 ${target || '（裸路径）'}（旧收录 URL 会白扔权重）`);
      continue;
    }
    // 308 的 Location 会把原始 query 一起带过去（配置层 redirects 的行为，实测
    // `/category/x?page=2` → `/category/x/p/2?page=2`）。这个形态**判为不改**，
    // 理由与裁决记录在 docs/seo/ISR-ROUTES.md；它成立的前提只有一个：
    // 最终留下的那一页 canonical 必须干净。所以真正该守的是这个前提，把它变成断言。
    //
    // 因此这里跟着跳转链走到底（最多 3 跳），只在 200 上读 canonical：
    // 落地页如果是 404（实测：`/category/ai-tools/p/2` 这一页没内容 → notFound），
    // 那本来就是「不可收录」的裁决，不存在重复页，拿 404 的响应体找 canonical
    // 只会造出一条假红灯。
    let final = null;
    let hop = redirectTarget(r.location, base);
    for (let i = 0; i < 3 && hop; i += 1) {
      const page = await probe(base, `${hop.pathname}${hop.search}`, { body: true });
      if (page.status >= 300 && page.status < 400) {
        hop = redirectTarget(page.location, base);
        continue;
      }
      final = { page, url: `${hop.pathname}${hop.search}` };
      break;
    }
    if (!final || final.page.status !== 200) {
      console.log(
        `– ${'跳转页 canonical'.padEnd(9)} 落地页不是 200（${final ? final.page.status : '链上没有 200'}），不可收录形态不断言 canonical`,
      );
      continue;
    }
    const canonical = linkHref(final.page.body, 'canonical');
    const clean = Boolean(canonical) && new URL(canonical, base).search === '';
    console.log(
      `${clean ? '✓' : '✖'} ${'跳转页 canonical'.padEnd(9)} ${final.url.padEnd(40)} ${final.page.status} canonical=${canonical || '—'}`,
    );
    if (!clean) {
      failures.push(
        `${final.url}：跳转落地页的 canonical ${canonical ? `仍带 query（${canonical}）` : '缺失'}——带参 URL 会变成一条可收录的重复页，旧形态归一的权重交接不再自洽`,
      );
    }
  }

  // 「一条都没抽查到」不是通过。空 sitemap / 全 5xx / base 指错都会让上面
  // 每个族打一行「跳过」然后走到这里——若不设底，--live 就变成一条永远不会红的守卫，
  // 而 CI 一旦习惯了它的绿灯，这条约束实际上就没人看着了。
  const minChecked = Math.max(0, Number(valueOf('min-checked', '1')) || 0);
  if (checked < minChecked) {
    console.error(
      `\n✖ 线上 ISR 抽查只覆盖到 ${checked} 页，低于下限 ${minChecked}：sitemap 里没有可抽查样本（中枢空库/取数失败/base 指错），门禁没跑到 ≠ 门禁通过`,
    );
    return 1;
  }

  if (failures.length) {
    console.error(`\n✖ 线上 ISR 抽查未通过（${failures.length} 项 / 共 ${checked} 页）：`);
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(
    `\n✓ 线上 ISR 抽查通过：${checked} 页形态正确且都带 s-maxage，200 页的响应体里没有兜底的本机地址`,
  );
  return 0;
}

const code = flags.has('--live') ? await checkLive() : checkBuild();
process.exit(code);
