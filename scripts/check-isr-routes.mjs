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
 *
 * 2026-10-23 起 `--live` 还管两层：
 *  - **每页技术面契约**（title/description/canonical/og 全套/robots/JSON-LD）：
 *    复用 `scripts/lib/seo-audit.mjs` 的 `auditPageDetailed`，规则只有一份。
 *    CI 自建预览上实测 7 个族全绿，所以默认就判；`--no-contract` 留给本地快跑。
 *    内链最低要求（kind=`links`）故意不在默认里 —— 那是全量审计的职责。
 *  - **sitemap 自身的收录面**：族条目下限、lastmod 覆盖率，以及「不可收录形态
 *    不该进清单」（`/…/p/{n}` 与带 query 的 `<loc>` —— 那些页自己声明 noindex，
 *    递进 sitemap 等于请爬虫收录重复内容）。抽查只看「sitemap 里已有的页」，
 *    sitemap 少一整族或多一整族时抽查照样全绿，所以这两条都要单独判整份清单。
 *    下限只在实际传了 `--sitemap-min-*` 时才判，不传就只报观察值 —— 生产库和 CI
 *    小库的量级差两个数量级，把下限写死进代码会变成第二条假红灯。
 *
 * 契约层自己会不会「静默绿」由 `scripts/fixtures/isr-live-corpus/` 的真实页面
 * 变异自证（用例在 check-isr-routes.test.ts，语料用 `scripts/capture-isr-corpus.mjs` 刷新）。
 *
 * 红灯分两类，各自的重探手段不同（2026-10-23；起因是 5.9/5.10 那条「限流 → 降级壳」
 * —— 同一条 `✖ … 技术面契约不达标` 既可能是渲染代码退化，也可能是上游一时拿不到数据
 * 后被 ISR 缓存成壳，两者的修复方向完全相反，让人照着红灯去翻渲染链是浪费时间）：
 *  - **契约退化**（title/description/canonical/og/jsonld 缺失或错、本机地址残留、
 *    canonical 带 query、sitemap 收录面结构）：确定性，重探不会变，直接红、不重试。
 *  - **可用性/降级壳**（非预期状态码、5xx、缺 s-maxage、sitemap 取不到；
 *    以及「200 但本页自己声明 noindex」= 降级壳签名）：值得重探。
 *    降级壳和普通抖动必须等 differently：壳是**缓存里的那份 HTML**，
 *    立刻重问只会拿回同一个壳（实测 s-maxage=60 + stale-while-revalidate 一年），
 *    所以这一类先按响应自带的 `s-maxage` 等到期、再打一发「唤醒」请求触发后台重验证、
 *    然后重新取证 —— 转绿说明上游只是抖过，仍是壳才是真退化。
 *    等待上限 `--retry-max-wait-ms`（默认 120s）：超过就**不判自愈**，红着并写明
 *    「未重探（s-maxage 超上限）」，绝不把没验证过的东西报成恢复。
 *    `x-nextjs-cache` 在这里是判据：`STALE` 意味着这发只负责唤醒、正文还是旧快照。
 *  自愈项只打 `⚠`（且 CI 里发 `::warning::`）不判红 —— 但它是「这一页在缓存窗口内
 *  会以壳示人」的事实记录，不是被吞掉的错误。
 *  参数：`--retry=N`（默认 2）、`--retry-delay-ms`（默认 3000）、`--retry-max-wait-ms`。
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeHtml,
  auditPageDetailed,
  isBogusLocalOriginAsset,
  linkHref,
} from './lib/seo-audit.mjs';

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
      cacheState: res.headers.get('x-nextjs-cache') ?? '',
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

async function fetchSitemapXml(base) {
  const res = await fetch(`${base}/sitemap.xml`, { headers: { 'user-agent': 'NavHub-ISR-Check/1.0' } });
  if (!res.ok) throw new Error(`sitemap.xml HTTP ${res.status}`);
  return res.text();
}

/** sitemap 里的一条 URL：路径（同源比较用）+ 有没有 lastmod。 */
export function sitemapEntries(xml) {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => {
    const block = m[1];
    const loc = /<loc>([^<]+)<\/loc>/.exec(block)?.[1] ?? '';
    let pathname = loc;
    let search = '';
    try {
      const parsed = new URL(loc);
      pathname = parsed.pathname;
      search = parsed.search;
    } catch {
      const [before, after = ''] = String(loc).split('?');
      pathname = before;
      search = after ? `?${after}` : '';
    }
    return {
      path: pathname.startsWith('/') ? pathname : `/${pathname}`,
      search,
      lastmod: /<lastmod>[^<]+<\/lastmod>/.test(block),
    };
  });
}

function pathsFromSitemapXml(xml) {
  return sitemapEntries(xml).map((e) => e.path);
}

/**
 * 一页快照的「技术面契约」：title / description / canonical / og 全套 / robots /
 * JSON-LD 结构。判定直接复用审计侧同一个 `auditPageDetailed`，不在门禁里重写规则
 * ——两处各写一遍必然漂移（本机地址那条以前就是这样）。
 *
 * `links`（内链最低要求）**不在默认 kinds 里**：内链面是全量审计的职责，
 * 抽查 11 页看不出站内结构退化，却会把「本页恰好没链到同类」这种数据形态
 * 变成门禁红灯。
 */
export const CONTRACT_KINDS_DEFAULT = ['meta', 'canonical', 'og', 'robots', 'jsonld'];

export function contractFindings(html, url, kinds, { expectIndexable = true } = {}) {
  const page = analyzeHtml(html, url);
  const issues = auditPageDetailed(page, { expectIndexable }).filter((i) => kinds.has(i.kind));
  // auditPageDetailed 只校验已有 JSON-LD 的结构；「整族没有结构化数据」要单独判。
  // 只对期望进索引的页判：分页形态（`/p/{n}`）按设计是 noindex + 不配结构化数据，
  // 要求它带 JSON-LD 会变成一条永远该红的假红灯。
  if (expectIndexable && kinds.has('jsonld') && (page.jsonLd ?? []).length === 0) {
    issues.push({ kind: 'jsonld', message: '没有任何 application/ld+json 区块（结构化数据整族丢失）' });
  }
  return issues;
}

/** sitemap 侧的族下限与 lastmod 覆盖率：只在显式给了下限时才判，否则只报观察值。 */
const SITEMAP_FAMILIES = [
  { key: '站点详情', re: /^\/site\//, flag: 'sitemap-min-site' },
  { key: '分类页', re: /^\/category\//, flag: 'sitemap-min-category' },
  { key: '标签页', re: /^\/tags\//, flag: 'sitemap-min-tag' },
  { key: '合集页', re: /^\/collections\//, flag: 'sitemap-min-collection' },
  { key: '插件详情', re: /^\/marketplace\//, flag: 'sitemap-min-plugin' },
  { key: '站点目录', re: /^\/sites$/, flag: 'sitemap-min-directory' },
];

/**
 * 定长散列（FNV-1a 32 位）：只用来把「轮换 key」变成稳定的起始下标。
 * 不用 Math.random，也不用心跳时间——同一轮 CI 重跑、同一 commit 重跑必须
 * 抽到同一批页，否则一次偶发网络抖动会被读成「门禁时好时坏」。
 */
export function rotateHash(text) {
  let h = 0x811c9dc5;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 轮换取样：不带 key 时保持旧行为（族内前 count 个，固定样本）；
 * 带 key 时在「排序后的全集」上按 (hash(key) + hash(salt)) 取起点环形取 count 个。
 *
 * 排序是为了让取样与 sitemap 的产出顺序解耦：sitemap 条目顺序一变
 * （加了一族、换了排序字段），固定 `slice(0, n)` 就会静默换掉整批页，
 * 轮换也跟着漂移，「这一轮扫的是哪些页」就不再只由 key 决定。
 * salt 传族前缀，避免每个族都在同一相对位置起跳。
 */
export function pickSample(items, count, rotateKey, salt = '') {
  const n = Math.max(1, Number(count) || 1);
  const unique = [...new Set(items)];
  // 不带 key 必须逐字保持旧行为（sitemap 顺序的前 n 个）：
  // 门禁的「固定样本」语义是既有测试和 CI 绿基线的前提，不能顺手改掉。
  if (!rotateKey) return unique.slice(0, n);
  const pool = unique.slice().sort();
  if (pool.length <= n) return pool;
  const start = (rotateHash(rotateKey) + rotateHash(salt)) % pool.length;
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(pool[(start + i) % pool.length]);
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** 从 `cache-control` 里读 s-maxage 秒数；没有或读不出返回 null。 */
function sMaxageMs(cacheControl) {
  const raw = /s-maxage=(\d+)/.exec(String(cacheControl ?? ''))?.[1];
  if (!raw) return null;
  const ms = Number(raw) * 1000;
  return Number.isFinite(ms) ? ms : null;
}

/** 降级壳的签名：可收录页自己声明了 noindex（5.9 那条链的下游证据）。 */
const isShellFinding = (i) => i.kind === 'robots' && /noindex/i.test(String(i.message));

/**
 * 对一页取证并分类。
 *
 * 判定规则本身一条没改（仍复用 `contractFindings` / `localOriginAssetFindings`），
 * 只是多分一层类。分层的理由来自实测：同一条 `✖ … 技术面契约不达标` 既可能是渲染代码
 * 退化，也可能是上游一时取不到数据后被 ISR 缓存成降级壳（docs/seo/ISR-ROUTES.md 5.9/5.10
 * 里那批壳，414 页同时缺描述、缺 JSON-LD、还自带 noindex）—— 两者的修复方向完全相反，
 * 让人照着「jsonld 整族丢失」去翻渲染链是浪费时间。所以**带 noindex 的那一页，
 * 其余契约缺失一律算壳的后果**，合并成一条 `degraded`，不再逐条报成退化。
 */
async function evaluateSample(base, path, { paged, contractOn, contractKinds }) {
  const r = await probe(base, path, { body: true });
  const allow = paged ? [200, 404] : [200];
  // 分页族还有第三种合法裁决：页码归一后不是本页时，页面自己 permanentRedirect
  // 回归一后的 URL。seed 数据不足一页时（实测：新库 57 个站点、每页 60 个 ⇒
  // totalPages=1 ⇒ `/sites/p/2` 308 → `/sites`）造的样本必然走这一支。
  // 它同样是「这条路由活着、且带着 ISR 缓存语义」的证据，不能判失败。
  const familyBase = path.replace(/\/p\/[^/]+$/, '');
  const target = paged ? redirectTarget(r.location, base) : null;
  const normalizedBack =
    (r.status === 301 || r.status === 308) && target !== null && pathOf(target) === familyBase;
  const okStatus = allow.includes(r.status) || normalizedBack;
  const cached = /s-maxage=\d+/.test(r.cacheControl);
  // 只有拿到正文才有资格谈元信息：404（薄分页的正常裁决）与重定向没有快照可言
  const badAssets = r.status === 200 && r.body ? localOriginAssetFindings(r.body, `${base}${path}`) : [];
  // 分页族（`/p/{n}`）按设计是 noindex：契约照查（标题/canonical/描述），
  // 但「可索引页才有的东西」（og 全套、JSON-LD、不得 noindex）不能要求它。
  const expectIndexable = !paged;
  const contract =
    contractOn && r.status === 200 && r.body
      ? contractFindings(r.body, `${base}${path}`, contractKinds, { expectIndexable })
      : [];
  const shell = expectIndexable && contract.some(isShellFinding);
  const ok = okStatus && cached && !badAssets.length && !contract.length;
  const line = `${ok ? '✓' : '✖'} ${(paged ? 'ISR 分页' : 'ISR 页面').padEnd(9)} ${path.padEnd(44)} ${r.status}${
    normalizedBack ? ` → ${pathOf(target)}` : ''
  } cc=${r.cacheControl || '—'}${
    r.status === 200 && contractOn
      ? ` 契约=${contract.length ? `${contract.length} 项` : '通过'}${expectIndexable ? '' : '·非索引'}`
      : ''
  }`;

  const findings = [];
  if (r.status >= 500)
    findings.push({
      klass: 'availability',
      message: `${path}：HTTP ${r.status}（5xx 通常是 DYNAMIC_SERVER_USAGE）`,
    });
  else if (!okStatus)
    findings.push({ klass: 'availability', message: `${path}：HTTP ${r.status}，期望 ${allow.join('/')}` });
  else if (!cached)
    findings.push({
      klass: 'availability',
      message: `${path}：没有 s-maxage，说明这一页没走 ISR 缓存`,
    });
  else if (badAssets.length)
    findings.push({
      klass: 'contract',
      message: `${path}：线上响应里带着构建期兜底的本机地址（${badAssets.slice(0, 3).join(' | ')}）——缺 NAVHUB_SITE_URL 时 metadataBase 用 http://localhost:3000 解析，分享图在别人的机器上打不开，canonical/og:url 还会多出一个错域名；配好变量后按需生成一次即可洗掉，永久快照那一族则要靠下一次构建`,
    });
  if (contract.length) {
    if (shell) {
      const collateral = contract.filter((i) => !isShellFinding(i));
      findings.push({
        klass: 'degraded',
        message: `${path}：降级壳（本页自己声明 noindex${
          collateral.length ? `，连带 ${collateral.length} 项契约缺失：${collateral.map((i) => i.kind).join('/')}` : ''
        }）—— 这不是渲染代码的形状问题，是上游取数失败被缓存成了壳（5.9 那条限流链就是这么来的）；等到 s-maxage 过期重验证后再取证，转绿即自愈`,
        retryAfterMs: sMaxageMs(r.cacheControl),
        cacheState: r.cacheState,
      });
    } else {
      findings.push({
        klass: 'contract',
        message: `${path}：技术面契约不达标 —— ${contract.map((i) => `${i.kind}:${i.message}`).join(' | ')}`,
      });
    }
  }
  return { line, findings, ok, state: r.cacheState };
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
  /** @type {{klass:'contract'|'availability'|'degraded', path:string, message:string, retryAfterMs?:number|null}[]} */
  const failures = [];
  let checked = 0;
  const contractOn = !flags.has('--no-contract');
  const contractKinds = new Set(
    (valueOf('contract-kinds', CONTRACT_KINDS_DEFAULT.join(',')) || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  // `--rotate[=KEY]`：族内样本从「永远前 N 个」换成按 key 环形取。
  // 不给值就用当天 UTC 日期；CI 里给 $GITHUB_SHA ⇒ 同一 commit 可复现、跨 commit 覆盖不同页。
  // 注意 `flags` 只收「不带 = 的裸 flag」，所以 `--rotate=KEY` 必须同时走 valueOf：
  // 只看 flags.has 会让带值的写法静默退回固定样本（实测：三个不同 key 抽到同一批页）。
  const rotateValue = valueOf('rotate');
  const rotateKey =
    flags.has('--rotate') || rotateValue !== null
      ? (rotateValue ?? '').trim() || new Date().toISOString().slice(0, 10)
      : null;
  if (rotateKey) {
    console.log(`· 轮换取样 key=${rotateKey}（同 key 同结果；去掉 --rotate 则永远取族内前 ${perFamily} 个）`);
  }

  // 重探参数（只作用于「可用性/降级壳」两类，契约退化不重试 —— 见文件头分类说明）。
  // `--retry-max-wait-ms` 是**整个重探阶段共用的墙钟预算**，不是每项的预算：
  // 一批 10 项各自等 120s 会把 CI 拖成十分钟的红灯。
  const retryAttempts = Math.max(0, Number(valueOf('retry', '2')) || 0);
  const retryDelayMs = Math.max(0, Number(valueOf('retry-delay-ms', '3000')) || 0);
  const retryMaxWaitMs = Math.max(0, Number(valueOf('retry-max-wait-ms', '120000')) || 0);

  let xml = '';
  for (let attempt = 1; ; attempt += 1) {
    try {
      xml = await fetchSitemapXml(base);
      break;
    } catch (err) {
      // 清单取不到时整套抽查都没有样本可抽（CI 里常见于 web 刚起来、首屏还在生成）。
      // 这属于可用性，不重试就等于是把启动竞态报成「收录面坏了」。
      if (attempt > retryAttempts) {
        console.error(`✖ 取不到 ${base}/sitemap.xml：${err.message}`);
        return 1;
      }
      console.log(`– 取 ${base}/sitemap.xml 失败（${err.message}），${retryDelayMs}ms 后第 ${attempt + 1} 次尝试`);
      await sleep(retryDelayMs);
    }
  }
  const paths = pathsFromSitemapXml(xml);

  for (const entry of WHITELIST) {
    const { route, urlPrefix, paged, exact } = entry;
    const all = [...new Set(paths.filter((p) => (exact ? p === urlPrefix : p.startsWith(urlPrefix))))];
    const matching = all.filter((p) => (paged ? /\/p\/[^/]+$/.test(p) : !/\/p\/[^/]+$/.test(p)));
    // 分页页不会进 sitemap（第 2 页起 noindex），但恰恰是它最容易在按需生成时 500。
    // 没有现成样本时造一个 /p/2：超出末页的 404 是正确行为，
    // 因此这一族只把「5xx」和「没有 s-maxage」判失败。
    // 造样本时挂在哪个母页上也跟着轮换：永远取第一个分类页的话，
    // 「按需生成 /p/2」这条支路只在那一个 slug 上被验证过。
    const sample = matching.length
      ? pickSample(matching, perFamily, rotateKey, `${route}|${urlPrefix}`)
      : paged && all.length
        ? [
            `${(rotateKey
              ? pickSample(all.filter((p) => !/\/p\/[^/]+$/.test(p)), 1, rotateKey, route)
              : [all.find((p) => !/\/p\/[^/]+$/.test(p))])[0] ?? all[0]}/p/2`,
          ]
        : [];
    if (!sample.length) {
      console.log(`– ${route.padEnd(28)} sitemap 里没有 ${urlPrefix}* 样本，跳过`);
      continue;
    }
    for (const path of sample) {
      checked += 1;
      const { line, findings } = await evaluateSample(base, path, {
        paged,
        contractOn,
        contractKinds,
      });
      console.log(line);
      for (const f of findings) failures.push({ ...f, path, paged });
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
      failures.push({
        klass: 'contract',
        path: url,
        message: `${url} 没有 30x 到 ${target || '（裸路径）'}（旧收录 URL 会白扔权重）`,
      });
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
      failures.push({
        klass: 'contract',
        path: final.url,
        message: `${final.url}：跳转落地页的 canonical ${canonical ? `仍带 query（${canonical}）` : '缺失'}——带参 URL 会变成一条可收录的重复页，旧形态归一的权重交接不再自洽`,
      });
    }
  }

  // sitemap 自身的收录面：族下限 + lastmod 覆盖率。
  // 为什么单独判：抽查只看「sitemap 里有的页」形态对不对，而 sitemap 自己漏了一整族
  // （中枢失联只剩 9 条静态条目、或某族取数分页坏掉）时，抽到的页照样全绿 ——
  // 门禁没跑到和门禁通过是两回事，这里补的就是这一层。
  const entries = sitemapEntries(xml);
  const observed = SITEMAP_FAMILIES.map((f) => ({
    ...f,
    count: entries.filter((e) => f.re.test(e.path)).length,
  }));
  const withLastmod = entries.filter((e) => e.lastmod).length;
  const ratio = entries.length ? withLastmod / entries.length : 0;
  // 不可收录形态不得进 sitemap —— 整份语料判，不靠抽样：
  //  - `/…/p/{n}` 分页页按设计是 noindex（见 docs/seo/ISR-ROUTES.md 裁决 5.2），递到
  //    sitemap 里就是让爬虫把「同一内容的第 N 页」当独立页收；
  //  - 带 query 的 <loc>（旧形态 `?page=N`）与「落地页 canonical 必须干净」这条前提直接
  //    冲突，等于自己造一条可收录的重复页。
  // 两处实测都是 0 条（CI seed 138 条、大库代理 1126 条），所以这条不会假红；
  // 一旦非零，说明是 sitemap 生成侧漏了过滤，不是抽查噪声。
  const nonIndexable = entries.filter((e) => /\/p\/[^/]+$/.test(e.path) || e.search);
  console.log(
    `· ${'sitemap 收录面'.padEnd(9)} 共 ${entries.length} 条：${observed
      .map((o) => `${o.key} ${o.count}`)
      .join(' / ')}；lastmod 覆盖 ${withLastmod}/${entries.length}（${(ratio * 100).toFixed(0)}%）；不可收录形态 ${nonIndexable.length} 条`,
  );
  if (nonIndexable.length) {
    failures.push({
      klass: 'contract',
      path: '/sitemap.xml',
      message: `sitemap 里有 ${nonIndexable.length} 条不可收录形态条目（分页 /p/{n} 或带 query）：${nonIndexable
        .slice(0, 3)
        .map((e) => `${e.path}${e.search}`)
        .join(' | ')} —— 这些页面自己声明 noindex，进 sitemap 就是把重复页递给爬虫收录`,
    });
  }
  for (const o of observed) {
    const raw = valueOf(o.flag, '0');
    const min = Number(raw);
    if (!Number.isFinite(min) || min <= 0) continue;
    if (o.count < min) {
      // 整族归零是上游信号（中枢失联 → 只剩静态条目），不是本页形状问题：分成
      // degraded，让人先看上游而不是翻渲染代码。但 sitemap 自己的快照周期远长于
      // 抽查预算（实测 revalidate 3600s 级），拿不到 s-maxage 就**不谎报自愈**：
      // retryAfterMs=null 会让重探阶段明确写「未重探」，红灯照旧。
      const upstream = o.count === 0;
      failures.push({
        klass: upstream ? 'degraded' : 'contract',
        path: '/sitemap.xml',
        retryAfterMs: null,
        message: `sitemap 里 ${o.key}只有 ${o.count} 条，低于下限 ${min}${o.key === '站点详情' && o.count === 0 ? '（只剩静态条目 = 中枢失联的降级形态，sitemap 没拿到任何站点，抽查抽到的绿不代表收录面完好）' : ''}`,
      });
    }
  }
  const minRatio = Number(valueOf('sitemap-min-lastmod-ratio', '0'));
  if (Number.isFinite(minRatio) && minRatio > 0 && ratio < minRatio) {
    failures.push({
      klass: 'contract',
      path: '/sitemap.xml',
      message: `sitemap 的 lastmod 覆盖率 ${(ratio * 100).toFixed(0)}%（${withLastmod}/${entries.length}）低于下限 ${(minRatio * 100).toFixed(0)}%：丢 lastmod 会让搜索引擎重新评估抓取优先级，改动也看不出新鲜度`,
    });
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

  // ---- 重探：只碰「可用性 / 降级壳」，契约退化不重试 ----
  // 契约退化是确定性的（同一份渲染代码、同一份数据），重试只会把 CI 时间花在
  // 同一个形状问题上，还顺手教会大家「再跑一次说不定就绿了」。
  // 可用性抖动重问一次就够；降级壳必须**先等到快照到期**再取证 —— 立刻重问拿回的
  // 还是同一个缓存里的壳（实测 s-maxage=60 + stale-while-revalidate 一年）。
  const retriable = failures.filter((f) => f.klass !== 'contract');
  const hardFailures = failures.filter((f) => f.klass === 'contract');
  const healed = [];
  let waitedMs = 0;
  for (const f of retriable) {
    f.tries = 0;
    f.latest = [f];
    f.note = retryAttempts > 0 ? '未重探' : '未重探（--retry=0，对照旧行为）';
    if (f.klass === 'degraded' && f.retryAfterMs === null) {
      f.note = '未重探（这一项拿不到 s-maxage：sitemap 自己的快照周期远超抽查预算）';
      continue;
    }
    for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
      const wait = f.klass === 'degraded' ? (f.retryAfterMs ?? 0) + retryDelayMs : retryDelayMs;
      if (waitedMs + wait > retryMaxWaitMs) {
        f.note = `未继续重探（重探总预算 ${retryMaxWaitMs}ms 已用完，已等 ${waitedMs}ms）`;
        break;
      }
      waitedMs += wait;
      if (f.klass === 'degraded') {
        // 等到期 → 唤醒（这一发返回的仍是旧快照，正文不能当证据）→ 留时间给后台重验证 → 取证
        await sleep(f.retryAfterMs ?? 0);
        await probe(base, f.path);
        await sleep(retryDelayMs);
      } else {
        await sleep(retryDelayMs);
      }
      const again = await evaluateSample(base, f.path, {
        paged: f.paged,
        contractOn,
        contractKinds,
      });
      f.tries = attempt;
      if (!again.findings.length) {
        f.state = again.state;
        healed.push(f);
        break;
      }
      f.latest = again.findings;
      f.state = again.state;
      // 仍然是壳，但这一发只拿到 STALE（后台还没重验证完）—— 不算「确认还是坏」，
      // 下一轮继续等；预算用尽才落红灯，并在消息里写清楚它没被确认过。
      if (f.klass === 'degraded' && /STALE/i.test(again.state ?? '')) {
        f.note = '最后一次重探仍拿到 STALE（旧快照），未确认新渲染的形状';
      } else {
        f.note = '';
      }
    }
  }
  const still = retriable.filter((f) => !healed.includes(f));

  if (hardFailures.length || still.length) {
    console.error(
      `\n✖ 线上 ISR 抽查未通过（共 ${checked} 页）：契约退化 ${hardFailures.length} 项 / 上游可用性·降级 ${still.length} 项${
        healed.length ? ` / 重探后自愈 ${healed.length} 项` : ''
      }：`,
    );
    for (const f of hardFailures) console.error(`  - [契约退化] ${f.message}`);
    for (const f of still) {
      const label = f.klass === 'degraded' ? '降级壳（不是渲染形状问题，先查上游取数）' : '可用性';
      const detail = f.latest.map((m) => m.message).join('；');
      console.error(
        `  - [${label}] ${detail}${f.tries ? ` —— 已重探 ${f.tries} 次仍红${f.state ? `（末次 x-nextjs-cache=${f.state}）` : ''}` : ` —— ${f.note}`}`,
      );
    }
    return 1;
  }

  if (healed.length) {
    // 自愈不判红，但必须留痕：这一页在缓存窗口内**确实以降级壳/非 200 示过爬虫**，
    // 那是上游健康问题（限流、中枢失联），不是可以忽略的噪声。
    console.warn(`\n⚠ 重探后自愈 ${healed.length} 项（判绿，但上游值得查）：`);
    for (const f of healed) {
      const line = `⚠ ${f.path}：首轮 ${f.klass === 'degraded' ? '降级壳' : '可用性异常'}，第 ${f.tries} 次重探转绿${f.state ? `（x-nextjs-cache=${f.state}）` : ''}`;
      console.warn(`  - ${line}`);
      if (process.env.GITHUB_ACTIONS === '1') {
        console.log(`::warning::${line.replace(/::/g, '--').replace(/%/g, '%25')}`);
      }
    }
  }
  console.log(
    `\n✓ 线上 ISR 抽查通过：${checked} 页形态正确、都带 s-maxage，200 页的响应体里没有兜底的本机地址${contractOn ? `，技术面契约（${[...contractKinds].join('/')}）齐备` : ''}`,
  );
  return 0;
}

/**
 * 只有「被直接执行」才跑门禁，被 import 时只导出函数（变异自证用例要复用
 * `contractFindings` / `sitemapEntries`，不能顺带触发构建产物检查，更不能把
 * 测试进程 `process.exit` 掉）。
 *
 * 判定必须走 realpath：本机仓库路径经过 junction，Node 加载模块时已把符号链接
 * 解析成真实路径，而 `process.argv[1]` 保持 junction 地址 —— 只比字符串的话
 * 「直接跑」会被误判成「被 import」，门禁变成静默不执行（比红灯更坏的失败形态）。
 * 真出现这种错位，本文件测试里那批 spawn 用例会立刻全红，不会溜过去。
 */
const canonicalPath = (p) => {
  let out;
  try {
    out = realpathSync(p);
  } catch {
    out = p;
  }
  return out.replace(/\\/g, '/').toLowerCase();
};
const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
const invokedDirectly = Boolean(entryPath) && canonicalPath(entryPath) === canonicalPath(fileURLToPath(import.meta.url));

if (invokedDirectly) process.exit(flags.has('--live') ? await checkLive() : checkBuild());
