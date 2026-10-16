/**
 * 管理后台导航的「可达性」结构不变量。
 *
 * 背景是真实缺陷：overlay 里补了三个管理页（分类树 / 标签 / 精选专题），
 * 但侧边栏 menuItems 没跟上 —— 三个页面在界面上完全点不到；
 * 同时「分类管理」子项还指向上游的 /admin/navigation（那是导航菜单编辑，不是分类）。
 * 这类问题不报错、不被 lint 抓、普通单测也覆盖不到：只能靠结构断言锁住。
 *
 * 注意：线上应用 = 上游 NavSphere 底座 + overlay 覆盖层。
 * overlay 里看不到上游页面的源码（本仓不持有），
 * 所以 UPSTREAM_ADMIN_ROUTES 列出上游自带的管理页 —— 它们是既定契约，链接有效，
 * 只是无法在本仓的文件树里校验（真正的兜底是 vendor 同步 + 手工冒烟）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 上游底座自带、overlay 不持有源码的管理页 */
const UPSTREAM_ADMIN_ROUTES = new Set([
  "/admin/data",
  "/admin/resources/download",
  "/admin/site",
  "/admin/submissions",
  "/admin/videos",
]);

/**
 * 定位 overlay 的 src/app。
 * 测试文件有两份（overlay 源 + apps/web 里的镜像），相对路径不同，
 * 因此按「路径里必须含 web-overlay」来消歧 —— 否则镜像副本会误指向 vendored 的 apps/web/src/app，
 * 那里还混着上游页面，会让「孤儿页」断言出现假失败。
 */
function overlayAppDir(): string {
  const candidates = ["../src/app", "../../web-overlay/src/app"].map((rel) =>
    fileURLToPath(new URL(rel, import.meta.url)),
  );
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 的 src/app（候选：" + candidates.join(" | ") + "）");
  return hit;
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

/** page.tsx 路径 → URL 路由（路由组 (x) 不进 URL，动态段原样保留） */
function toRoute(rel: string): string {
  const clean = rel
    .replace(/\\/g, "/")
    .replace(/(^|\/)page\.tsx?$/, "")
    .replace(/(^|\/)\([^)]+\)/g, "$1")
    .replace(/^\/+|\/+$/g, "");
  return clean === "" ? "/" : "/" + clean;
}

const HREF_RE = /href\s*[:=]\s*["'`](\/admin[^"'`]*)["'`]/g;

const appDir = overlayAppDir();
const routes = new Set<string>();
for (const file of walkFiles(appDir)) {
  if (/page\.tsx?$/.test(file)) routes.add(toRoute(relative(appDir, file)));
}

/** href → 首次出现的「文件:行」，便于失败时直接定位 */
const adminLinks = new Map<string, string>();
const adminDir = join(appDir, "admin");
for (const file of walkFiles(adminDir)) {
  if (!/\.tsx?$/.test(file)) continue;
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      for (const match of line.matchAll(HREF_RE)) {
        const href = match[1].split(/[?#]/)[0].replace(/\/+$/, "") || "/";
        if (!adminLinks.has(href)) {
          adminLinks.set(href, relative(adminDir, file).replace(/\\/g, "/") + ":" + (index + 1));
        }
      }
    });
}

/** 静态链接是否能落到一个真实页面（精确、上游白名单、或动态段通配） */
function resolves(href: string): boolean {
  if (routes.has(href) || UPSTREAM_ADMIN_ROUTES.has(href)) return true;
  const segments = href.split("/").filter(Boolean);
  for (const route of routes) {
    const parts = route.split("/").filter(Boolean);
    if (parts.length !== segments.length) continue;
    if (parts.every((part, i) => part.startsWith("[") || part === segments[i])) return true;
  }
  return false;
}

describe("管理后台导航：链接与页面对得上", () => {
  it("每个静态 /admin 链接都有落地页（无死链）", () => {
    const dead = [...adminLinks.entries()]
      .filter(([href]) => !href.includes("[") && !href.includes("$"))
      .filter(([href]) => !resolves(href))
      .map(([href, at]) => href + "  (来自 " + at + ")");
    expect(dead).toEqual([]);
  });

  it("overlay 自带的每个管理页都能从管理界面点到（无孤儿页）", () => {
    const orphans = [...routes]
      .filter((route) => route === "/admin" || route.startsWith("/admin/"))
      .filter((route) => !route.includes("[")) // 动态子页经列表页进入，不参与
      .filter((route) => !adminLinks.has(route));
    expect(orphans).toEqual([]);
  });
});
