/**
 * ISR 路由门禁脚本的回归测试（fixture 驱动，不依赖真实 next build）。
 *
 * 门禁本身是「防止线上 500」的最后一道闸，所以必须验证它**会红灯**：
 * 历史故障是 `/category/{slug}` 的页面签名读了 searchParams，
 * 按需生成抛 DYNAMIC_SERVER_USAGE，而 next dev / tsc / eslint 全绿。
 * 一个永远不会失败的守卫比没有守卫更危险——它会让人以为这条约束有人看着。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const SCRIPT = resolve("scripts/check-isr-routes.mjs");
// 脚本按 apps/web/<NEXT_DIST_DIR> 找产物（与 check-bundle-budget 同一套环境变量）
const FIXTURE_DIST = resolve("apps/web/.next-isr-gate-fixture");

/** 门禁白名单里的全部路由模板 —— 少一条就应该红灯 */
const ALL_ROUTES = [
  "/",
  "/category/[slug]",
  "/category/[slug]/p/[n]",
  "/sites",
  "/sites/p/[n]",
  "/marketplace/[slug]",
  "/site/[id]",
  "/tags/[slug]",
  "/collections/[slug]",
];

/** 没有动态段的静态路径：Next 把它们写进 prerender.routes 而不是 dynamicRoutes */
const STATIC_PATHS = new Set(["/", "/sites"]);

function writeManifest(routes: string[]) {
  rmSync(FIXTURE_DIST, { recursive: true, force: true });
  const file = resolve(FIXTURE_DIST, "prerender-manifest.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      version: 3,
      routes: Object.fromEntries(
        routes
          .filter((route) => STATIC_PATHS.has(route))
          .map((route) => [route, { routeType: "page", initialRevalidateSeconds: 60 }]),
      ),
      dynamicRoutes: Object.fromEntries(
        routes
          .filter((route) => !STATIC_PATHS.has(route))
          .map((route) => [route, { routeType: "page", compute: "initial isr blocking", fallback: null }]),
      ),
      notFoundRoutes: [],
    }),
  );
}

function run(extraArgs: string[] = [], envExtra: Record<string, string> = {}) {
  const res = spawnSync(process.execPath, [SCRIPT, ...extraArgs], {
    encoding: "utf8",
    env: { ...process.env, NEXT_DIST_DIR: ".next-isr-gate-fixture", ...envExtra },
  });
  return { code: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

/** 白名单里每条路由对应的 overlay 源文件（与脚本内 SRC 列表同构） */
const SRCS = [
  "apps/web-overlay/src/app/page.tsx",
  "apps/web-overlay/src/app/category/[slug]/page.tsx",
  "apps/web-overlay/src/app/category/[slug]/p/[n]/page.tsx",
  "apps/web-overlay/src/app/sites/page.tsx",
  "apps/web-overlay/src/app/sites/p/[n]/page.tsx",
  "apps/web-overlay/src/app/marketplace/[slug]/page.tsx",
  "apps/web-overlay/src/app/site/[id]/page.tsx",
  "apps/web-overlay/src/app/tags/[slug]/page.tsx",
  "apps/web-overlay/src/app/collections/[slug]/page.tsx",
];

/** 收录型 ISR 渲染链（与脚本内 ISR_RENDER_CHAIN 同构，缺文件会红灯，两边不会静默漂移） */
const STATIC_SRCS = [
  "apps/web-overlay/src/app/layout.tsx",
  "apps/web-overlay/src/app/page.tsx",
  "apps/web-overlay/src/components/breadcrumbs.tsx",
  "apps/web-overlay/src/app/sites/page.tsx",
  "apps/web-overlay/src/app/sites/sites-directory.tsx",
  "apps/web-overlay/src/app/sites/p/[n]/page.tsx",
  "apps/web-overlay/src/app/category/[slug]/category-board.tsx",
  "apps/web-overlay/src/app/category/[slug]/page.tsx",
  "apps/web-overlay/src/app/category/[slug]/p/[n]/page.tsx",
  "apps/web-overlay/src/app/site/[id]/page.tsx",
  "apps/web-overlay/src/app/tags/[slug]/page.tsx",
  "apps/web-overlay/src/app/collections/[slug]/page.tsx",
  "apps/web-overlay/src/app/marketplace/[slug]/layout.tsx",
  "apps/web-overlay/src/app/marketplace/[slug]/page.tsx",
  "apps/web-overlay/src/app/marketplace/author/[key]/page.tsx",
];

/**
 * 造一棵「全部干净」的源码 fixture：
 * 每个页面都声明 revalidate 且不读 searchParams，静态渲染链不调用 siteOrigin()。
 */
function writeSources(badRel?: string, staticBadRel?: string): string {
  const root = resolve("apps/web/.next-isr-gate-src-fixture");
  rmSync(root, { recursive: true, force: true });
  for (const rel of new Set([...SRCS, ...STATIC_SRCS])) {
    let body =
      "export const revalidate = 60\n// 说明：签名里只要出现 searchParams 就会抛 DYNAMIC_SERVER_USAGE\nexport default async function P({ params }: any) {\n  return params\n}\n";
    if (rel === badRel) {
      body = "export const revalidate = 60\nexport default async function P({ params, searchParams }: any) {\n  return searchParams\n}\n";
    } else if (rel === staticBadRel) {
      // 只把 origin 换成会读 headers() 的那一个变体，其余约束照常满足，
      // 这样红灯原因只会来自静态渲染链门禁。
      body =
        "export const revalidate = 60\nimport { siteOrigin } from '@/lib/seo/origin'\nexport default async function P({ params }: any) {\n  return [params, await siteOrigin()]\n}\n";
    }
    const file = resolve(root, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return root;
}

afterEach(() => {
  rmSync(FIXTURE_DIST, { recursive: true, force: true });
  rmSync(resolve("apps/web/.next-isr-gate-src-fixture"), { recursive: true, force: true });
});

describe("check-isr-routes.mjs", () => {
  it("产物里每条白名单路由都在 prerender-manifest 时才绿灯（顺带钉住源码门禁的当前基线）", () => {
    writeManifest(ALL_ROUTES);
    const { code, out } = run();
    expect(out, out).toContain("9 条收录型路由的产物与源码门禁都通过");
    expect(code).toBe(0);
  });

  it("首页不在 prerender.routes 里就红灯（它带 revalidate=60，落成 ƒ 是静默作废）", () => {
    // 与 /sites 同一条约束的最后一处：page.tsx 曾经 await siteOrigin()，CI/Docker
    // 的 build 阶段没有 NAVHUB_SITE_URL → 产物 ƒ → 全站被爬最多的一条每次现渲。
    writeManifest(ALL_ROUTES.filter((r) => r !== "/"));
    const { code, out } = run();
    expect(code, out).toBe(1);
    expect(out).toContain("/：退化为动态渲染");
  });

  it("fixture 源码：首页把 siteOrigin() 放回来就红灯（渲染链钉子覆盖静态路径）", () => {
    writeManifest(ALL_ROUTES);
    const srcRoot = writeSources(undefined, "apps/web-overlay/src/app/page.tsx");
    const { code, out } = run([`--src-root=${srcRoot}`]);
    expect(code, out).toBe(1);
    expect(out).toContain("apps/web-overlay/src/app/page.tsx");
  });

  it("/sites 页 1 退化成 ƒ 同样红灯（soft 豁免已随构建期 origin 依赖一起废除）", () => {
    // 历史：页 1 的渲染链经 siteOrigin() 兜底读 headers()，CI/Docker 的 build 阶段
    // 没有 NAVHUB_SITE_URL，产物只能是 ƒ，于是给它开过「只提示不判失败」的豁免。
    // 现在 metadataBase 与站点目录改用 configuredSiteOrigin()，静态路径的预渲染
    // 不再依赖构建期 origin —— 缺了就是真回归（根布局或目录页把 headers() 放回来了）。
    writeManifest(ALL_ROUTES.filter((r) => r !== "/sites"));
    const { code, out } = run();
    expect(code, out).toBe(1);
    expect(out).toContain("/sites：退化为动态渲染");
  });

  it("任一收录型路由退化成动态渲染（不在 prerender-manifest）就红灯", () => {
    writeManifest(ALL_ROUTES.filter((r) => r !== "/category/[slug]/p/[n]"));
    const { code, out } = run();
    expect(code, out).toBe(1);
    expect(out).toContain("/category/[slug]/p/[n]");
    expect(out).toContain("退化为动态渲染");
  });

  it("缺 prerender-manifest 时不静默通过（门禁没跑到 ≠ 门禁通过）", () => {
    rmSync(FIXTURE_DIST, { recursive: true, force: true });
    const { code, out } = run();
    expect(code, out).toBe(1);
    expect(out).toContain("prerender-manifest.json");
  });

  it("注释里提到 searchParams 不算违规（真实源码正是靠注释解释为什么不能用）", () => {
    // 这条钉子防的是误报：白名单文件都有解释 DYNAMIC_SERVER_USAGE 的注释
    // （「签名里只要出现 searchParams 就会抛…」），门禁一旦改成朴素
    // includes(src, 'searchParams')，CI 会红在无关处，于是人人学会忽略它。
    writeManifest(ALL_ROUTES);
    const { code, out } = run();
    expect(out, out).not.toContain("签名里读了 searchParams");
    expect(code).toBe(0);
  });

  it("fixture 源码：页面签名读了 searchParams 就红灯（这就是线上 500 的成因）", () => {
    writeManifest(ALL_ROUTES);
    const badRel = "apps/web-overlay/src/app/category/[slug]/p/[n]/page.tsx";
    const srcRoot = writeSources(badRel);
    const { code, out } = run([`--src-root=${srcRoot}`]);
    expect(code, out).toBe(1);
    expect(out).toContain("/category/[slug]/p/[n]");
    expect(out).toContain("DYNAMIC_SERVER_USAGE");
  });

  it("fixture 源码：只有注释提到 searchParams 时不误报", () => {
    writeManifest(ALL_ROUTES);
    const srcRoot = writeSources();
    const { code, out } = run([`--src-root=${srcRoot}`]);
    expect(out, out).not.toContain("签名里读了 searchParams");
    expect(code).toBe(0);
  });

  it("fixture 源码：漏了 export const revalidate 就不是 ISR，必须红灯", () => {
    writeManifest(ALL_ROUTES);
    const srcRoot = writeSources();
    const rel = "apps/web-overlay/src/app/tags/[slug]/page.tsx";
    writeFileSync(resolve(srcRoot, rel), "export default async function P({ params }: any) {\n  return params\n}\n");
    const { code, out } = run([`--src-root=${srcRoot}`]);
    expect(code, out).toBe(1);
    expect(out).toContain("/tags/[slug]");
    expect(out).toContain("revalidate");
  });

  it("fixture 源码：收录型渲染链里调用 siteOrigin() 就红灯（静态路径退化 ƒ / 按需生成 500）", () => {
    writeManifest(ALL_ROUTES);
    const srcRoot = writeSources(undefined, "apps/web-overlay/src/app/layout.tsx");
    const { code, out } = run([`--src-root=${srcRoot}`]);
    expect(code, out).toBe(1);
    expect(out).toContain("apps/web-overlay/src/app/layout.tsx");
    expect(out).toContain("configuredSiteOrigin");
  });

  it("fixture 源码：Breadcrumbs 与带动态段的详情页同样受渲染链钉子保护", () => {
    // 两类后果不同的路由共用一条规则：`breadcrumbs.tsx` 挂在所有收录页上，
    // `site/[id]` 一旦读 headers() 不是丢缓存而是 500。
    for (const rel of [
      "apps/web-overlay/src/components/breadcrumbs.tsx",
      "apps/web-overlay/src/app/site/[id]/page.tsx",
    ]) {
      writeManifest(ALL_ROUTES);
      const srcRoot = writeSources(undefined, rel);
      const { code, out } = run([`--src-root=${srcRoot}`]);
      expect(code, `${rel}\n${out}`).toBe(1);
      expect(out).toContain(rel);
    }
  });

  it("fixture 源码：configuredSiteOrigin()（只读环境变量）不算违规", () => {
    // 防误报：真实源码用的就是 configuredSiteOrigin()，朴素 includes(src, 'siteOrigin')
    // 会把正确写法一并判红，门禁一旦常年红在无关处就没人再看它。
    writeManifest(ALL_ROUTES);
    const srcRoot = writeSources();
    const rel = "apps/web-overlay/src/app/sites/sites-directory.tsx";
    writeFileSync(
      resolve(srcRoot, rel),
      "export const revalidate = 60\nimport { configuredSiteOrigin } from '@/lib/seo/origin'\nexport default async function P({ params }: any) {\n  return [params, configuredSiteOrigin()]\n}\n",
    );
    const { code, out } = run([`--src-root=${srcRoot}`]);
    expect(out, out).not.toContain("调用了 siteOrigin()");
    expect(code).toBe(0);
  });
});

/**
 * 「永久快照」检查：revalidate=false 的预渲染页没有自愈周期。
 *
 * 起因是 `/algorithms`：它是 sitemap 里唯一一条 `initialRevalidateSeconds: false`
 * 的收录页，而无 NAVHUB_SITE_URL 的构建把它 og:image 的 metadataBase 兜底地址
 * `http://localhost:3000/og-default.png` 烤进了 `server/app/algorithms.html`
 * （实测 2 处，`x-nextjs-cache: HIT` 反复命中）。同款地址在带 revalidate 的页上
 * 一个周期就恢复，所以只有这一族值得钉死。
 */
describe("check-isr-routes.mjs 永久快照（revalidate=false）", () => {
  function addBakedPage(path: string, revalidate: number | false, html: string) {
    const manifestFile = resolve(FIXTURE_DIST, "prerender-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    manifest.routes[path] = { routeType: "page", initialRevalidateSeconds: revalidate };
    writeFileSync(manifestFile, JSON.stringify(manifest));
    const rel = path.replace(/^\/+/, "");
    const baked = resolve(FIXTURE_DIST, "server/app", `${rel}.html`);
    mkdirSync(dirname(baked), { recursive: true });
    writeFileSync(baked, html);
  }

  const BAKED_WITH_LOCALHOST =
    '<!doctype html><html lang="zh-CN"><head><title>算法</title>' +
    '<meta property="og:image" content="http://localhost:3000/og-default.png">' +
    "</head><body>ok</body></html>";

  it("revalidate=false 的产物里烤进本机地址就红灯", () => {
    writeManifest(ALL_ROUTES);
    const srcRoot = writeSources();
    addBakedPage("/algorithms", false, BAKED_WITH_LOCALHOST);
    // 参照 origin 显式钉成「没配」：开发机导出过 NAVHUB_SITE_URL 时，
    // 不设这一条的话红绿会随本机环境变，用例就在骗自己了
    const { code, out } = run([`--src-root=${srcRoot}`], { NAVHUB_SITE_URL: "" });
    expect(code, out).toBe(1);
    expect(out).toContain("/algorithms");
    expect(out).toContain("本机地址");
  });

  it("同款地址在带 revalidate 的页上不报（一个周期自愈，不是坏快照）", () => {
    writeManifest(ALL_ROUTES);
    const srcRoot = writeSources();
    addBakedPage("/sites-p0", 60, BAKED_WITH_LOCALHOST);
    const { code, out } = run([`--src-root=${srcRoot}`], { NAVHUB_SITE_URL: "" });
    expect(out, out).not.toContain("本机地址");
    expect(code).toBe(0);
  });

  it("revalidate=false 但产物里没有本机地址时绿灯（缺 origin 就不输出图的正确形态）", () => {
    writeManifest(ALL_ROUTES);
    const srcRoot = writeSources();
    addBakedPage("/algorithms", false, BAKED_WITH_LOCALHOST.replace(/content="[^"]*"/, 'content="/og-default.png"'));
    const { code, out } = run([`--src-root=${srcRoot}`], { NAVHUB_SITE_URL: "" });
    expect(out, out).not.toContain("本机地址");
    expect(code).toBe(0);
  });

  /**
   * 「本机地址」不等于「兜底地址」：构建期配了 origin，产物里那个端口就是正确形态。
   * 2026-10-23 在同机复现 CI 时实测到这一族把 `http://localhost:3079/...` 全判成红
   * （那台预览站就是这么构建的），判定因此改成与 --live / seo-audit 同一把尺：
   * 端口和配置不一致才算兜底残留。
   */
  it("构建期配过 origin 时，同端口的本机地址不算兜底残留（绿灯）", () => {
    writeManifest(ALL_ROUTES);
    const srcRoot = writeSources();
    addBakedPage("/algorithms", false, BAKED_WITH_LOCALHOST.replace("localhost:3000", "localhost:3079"));
    const { code, out } = run([`--src-root=${srcRoot}`], { NAVHUB_SITE_URL: "http://localhost:3079" });
    expect(out, out).not.toContain("本机地址");
    expect(code).toBe(0);
  });

  it("配置指向别的端口时，兜底残留照旧红灯（端口比对不是放行本机地址）", () => {
    writeManifest(ALL_ROUTES);
    const srcRoot = writeSources();
    addBakedPage("/algorithms", false, BAKED_WITH_LOCALHOST);
    const { code, out } = run([`--src-root=${srcRoot}`], { NAVHUB_SITE_URL: "http://localhost:3079" });
    expect(code, out).toBe(1);
    expect(out).toContain("本机地址");
  });
});

/**
 * --live 抽查：覆盖率下限 + 响应体取证。
 *
 * 起因：--live 过去只活在 workflow_dispatch 的 seo-audit-prod 里，每个 PR 都没跑过。
 * 把它接进 PR 门禁的前提是它**不会静默通过**——空 sitemap（中枢没起 / 没 seed /
 * base 指错）时每个族只会打一行「跳过」，`checked` 停在 0，旧实现在这里打
 * 「✓ 线上 ISR 抽查通过：0 页」并 exit 0。一条永远不会响的守卫比没有守卫更危险。
 */
describe("check-isr-routes.mjs --live 抽查", () => {
  /**
   * 假预览站：sitemap.xml 只列指定路径，页面 200 + s-maxage=60 + 自指 canonical。
   *
   * 两个形态刻意照抄生产实测，否则这一族测不到真东西：
   * - 配置层 redirects 会把原始 query 带进 308 的 Location
   *   （`/sites?page=2` → `/sites/p/2?page=2`），所以落地 URL 是带参的；
   * - 落地页 canonical 不带 query，权重交接才自洽。
   */
  function serve(
    paths: string[],
    opts: {
      canonicalKeepsQuery?: boolean;
      bakeLocalAsset?: boolean;
      collapsePagesToBase?: boolean;
      notFoundPages?: boolean;
      duplicateLocation?: boolean;
    } = {},
  ): Promise<{ base: string; close: () => Promise<void> }> {
    return new Promise((resolvePromise) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname === "/sitemap.xml") {
          const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
          res.writeHead(200, { "content-type": "application/xml" });
          res.end(
            `<?xml version="1.0"?><urlset>${paths
              .map((p) => `<url><loc>${origin}${p}</loc></url>`)
              .join("")}</urlset>`,
          );
          return;
        }
        // 旧形态归一也是 --live 的检查项（且 `/sites/p/1` 无条件检查），
        // 假站不配合的话所有样本都会被这条判失败，测不到覆盖率下限本身。
        const page = url.searchParams.get("page");
        if (page && (url.pathname === "/sites" || url.pathname.startsWith("/category/"))) {
          res.writeHead(308, { location: `${url.pathname}/p/${page}?page=${page}` });
          res.end();
          return;
        }
        if (url.pathname === "/sites/p/1") {
          // 实测：冷生成那一次 Next 发了两条一模一样的 location。
          // Headers.get() 会把同名头合并成 "/sites, /sites"，直接 new URL() 得到
          // 一个不存在的地址 —— 门禁必须只取第一段。
          res.setHeader("location", "/sites");
          if (opts.duplicateLocation) res.appendHeader("location", "/sites");
          res.writeHead(308);
          res.end();
          return;
        }
        // 种子数据不足一页（新库 57 站点 / 每页 60 ⇒ totalPages=1）时，
        // `/sites/p/{n≥2}` 被页面自己的 permanentRedirect 送回基底 URL。
        const paged = /^\/sites\/p\/([2-9][0-9]*)$/.exec(url.pathname);
        if (paged && opts.collapsePagesToBase) {
          res.writeHead(308, { location: "/sites", "cache-control": "s-maxage=60" });
          res.end();
          return;
        }
        if (paged && opts.notFoundPages) {
          // 分类第 2 页没内容是硬 404，不是软 200：Next 在这条裁决上同样带 s-maxage
          res.writeHead(404, { "content-type": "text/html", "cache-control": "s-maxage=60" });
          res.end("<html><body>not found</body></html>");
          return;
        }
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const canonical = opts.canonicalKeepsQuery ? `${origin}${url.pathname}${url.search}` : `${origin}${url.pathname}`;
        // 缺 NAVHUB_SITE_URL 时 Next 用 http://localhost:3000 兜底解析 og:image；
        // 假站用随机端口，所以这个地址必然与当前 base 不同端口。
        const og = opts.bakeLocalAsset
          ? '<meta property="og:image" content="http://localhost:3000/og-default.png"/>'
          : "";
        res.writeHead(200, { "content-type": "text/html", "cache-control": "s-maxage=60, stale-while-revalidate=31535940" });
        res.end(`<html><head><link rel="canonical" href="${canonical}"/>${og}</head><body>ok</body></html>`);
      });
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resolvePromise({
          base: `http://127.0.0.1:${port}`,
          close: () => new Promise<void>((done) => server.close(() => done())),
        });
      });
    });
  }

  async function runLive(
    paths: string[],
    extra: string[] = [],
    opts: {
      canonicalKeepsQuery?: boolean;
      bakeLocalAsset?: boolean;
      collapsePagesToBase?: boolean;
      notFoundPages?: boolean;
      duplicateLocation?: boolean;
    } = {},
  ) {
    const { base, close } = await serve(paths, opts);
    try {
      // 不能用 spawnSync：它会占满当前线程，假预览站（在同进程里）无法响应，
      // 子进程只能等到 15s 超时——测试会在完全无关的地方失败。
      const child = spawn(process.execPath, [SCRIPT, "--live", `--base=${base}`, ...extra], {
        env: { ...process.env, NEXT_DIST_DIR: ".next-isr-gate-fixture" },
      });
      let out = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (out += chunk));
      child.stderr.on("data", (chunk: string) => (out += chunk));
      const code = await new Promise<number>((done) => {
        child.once("close", (exitCode) => done(exitCode ?? -1));
        child.once("error", () => done(-1));
      });
      return { code, out };
    } finally {
      await close();
    }
  }

  it("sitemap 里没有白名单样本时红灯（0 页通过不是绿灯）", async () => {
    const { code, out } = await runLive(["/about"]);
    expect(code, out).toBe(1);
    expect(out).toContain("门禁没跑到 ≠ 门禁通过");
    expect(out).toContain("低于下限");
  });

  it("显式 --min-checked=0 时允许 0 覆盖（下限可调，不是无条件红灯）", async () => {
    const { code, out } = await runLive(["/about"], ["--min-checked=0"]);
    expect(out, out).toContain("跳过");
    expect(code).toBe(0);
  });

  it("覆盖数低于 --min-checked 时红灯", async () => {
    // sitemap 里只有 /sites 一条：非分页族打 /sites，分页族用造出来的 /sites/p/2，
    // 共 2 页；下限设 3 就该红（下限是按「实际抽查到的页数」算，不是按族数）。
    const { code, out } = await runLive(["/sites"], ["--min-checked=3"]);
    expect(code, out).toBe(1);
    expect(out).toContain("只覆盖到 2 页");
  });

  it("抽到的页 200 且带 s-maxage、覆盖数达标时绿灯", async () => {
    const { code, out } = await runLive(["/sites"]);
    expect(out, out).toContain("✓ 线上 ISR 抽查通过：2 页");
    expect(code).toBe(0);
  });

  /**
   * 线上侧的「本机地址」取证。产物门禁（checkPermanentSnapshots）读的是构建目录里
   * 的 HTML，这里读的是爬虫真正拿到的响应：同一件事两处都断言，才不会漏掉
   * 「产物是干净的、线上那份快照还是修复前生成的」这种错位。
   */
  it("线上响应里带构建期兜底的 localhost 资源地址就红灯", async () => {
    const { code, out } = await runLive(["/sites"], [], { bakeLocalAsset: true });
    expect(code, out).toBe(1);
    expect(out).toContain("本机地址");
    expect(out).toContain("http://localhost:3000/og-default.png");
  });

  /**
   * 旧形态 308 的 Location 带 query 这件事本身判为不改（配置层行为，见
   * docs/seo/ISR-ROUTES.md）。它成立的前提是落地页 canonical 干净，
   * 所以这条断言盯的是前提：canonical 一旦把 query 吃回去，带参 URL 就成了
   * 一条可收录的重复页，归一的权重交接不再自洽。
   */
  it("跳转落地页的 canonical 带 query 就红灯（旧形态归一的前提）", async () => {
    const { code, out } = await runLive(["/sites"], [], { canonicalKeepsQuery: true });
    expect(code, out).toBe(1);
    expect(out).toContain("canonical");
    expect(out).toMatch(/仍带 query|缺失/);
  });

  /**
   * 下面两条是 CI 首个 run（2026-10-23）红出来的两个门禁缺陷。
   * 假站的形态照抄那一次的实测：新 seed 库 57 个站点、每页 60 个 ⇒ totalPages=1，
   * 于是 `/sites/p/2` 不是 200 也不是 404，而是页面自己 permanentRedirect 回 `/sites`；
   * 分类第 2 页没内容时是硬 404。两种都是正确裁决，判失败就是把门禁修歪。
   */
  it("分页样本 308 回归一后的族基底时判为正确（种子数据不足一页）", async () => {
    const { code, out } = await runLive(["/sites"], [], { collapsePagesToBase: true });
    expect(out, out).toContain("✓ ISR 分页");
    expect(out, out).toContain("308 → /sites");
    expect(out, out).toContain("✓ 线上 ISR 抽查通过：2 页");
    expect(code).toBe(0);
  });

  it("跳转落地页是 404 时不断言 canonical（硬 404 已是不可收录裁决）", async () => {
    const { code, out } = await runLive(["/sites"], [], { notFoundPages: true });
    expect(out, out).toContain("落地页不是 200（404）");
    expect(out, out).not.toContain("canonical 缺失");
    expect(code).toBe(0);
  });

  it("Location 被合并成重复值时只取第一段（否则门禁自己跳去一个不存在的 URL）", async () => {
    const { code, out } = await runLive(["/sites"], [], { duplicateLocation: true });
    expect(out, out).not.toContain("sites,%20/sites");
    expect(out, out).toContain("✓ 跳转页 canonical");
    expect(code).toBe(0);
  });
});
