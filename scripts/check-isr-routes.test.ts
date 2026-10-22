/**
 * ISR 路由门禁脚本的回归测试（fixture 驱动，不依赖真实 next build）。
 *
 * 门禁本身是「防止线上 500」的最后一道闸，所以必须验证它**会红灯**：
 * 历史故障是 `/category/{slug}` 的页面签名读了 searchParams，
 * 按需生成抛 DYNAMIC_SERVER_USAGE，而 next dev / tsc / eslint 全绿。
 * 一个永远不会失败的守卫比没有守卫更危险——它会让人以为这条约束有人看着。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = resolve("scripts/check-isr-routes.mjs");
// 脚本按 apps/web/<NEXT_DIST_DIR> 找产物（与 check-bundle-budget 同一套环境变量）
const FIXTURE_DIST = resolve("apps/web/.next-isr-gate-fixture");

/** 门禁白名单里的全部路由模板 —— 少一条就应该红灯 */
const ALL_ROUTES = [
  "/category/[slug]",
  "/category/[slug]/p/[n]",
  "/sites",
  "/sites/p/[n]",
  "/marketplace/[slug]",
  "/site/[id]",
  "/tags/[slug]",
  "/collections/[slug]",
];

function writeManifest(routes: string[]) {
  rmSync(FIXTURE_DIST, { recursive: true, force: true });
  const file = resolve(FIXTURE_DIST, "prerender-manifest.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      version: 3,
      routes: {},
      dynamicRoutes: Object.fromEntries(
        routes.map((route) => [route, { routeType: "page", compute: "initial isr blocking", fallback: null }]),
      ),
      notFoundRoutes: [],
    }),
  );
}

function run(extraArgs: string[] = []) {
  const res = spawnSync(process.execPath, [SCRIPT, ...extraArgs], {
    encoding: "utf8",
    env: { ...process.env, NEXT_DIST_DIR: ".next-isr-gate-fixture" },
  });
  return { code: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

/** 白名单里每条路由对应的 overlay 源文件（与脚本内 SRC 列表同构） */
const SRCS = [
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
    expect(out, out).toContain("8 条收录型路由的产物与源码门禁都通过");
    expect(code).toBe(0);
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
