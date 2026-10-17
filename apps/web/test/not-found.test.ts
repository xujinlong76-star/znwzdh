/**
 * 404 页的「恢复路径」不许是死链，也不许说了做不到。
 *
 * 改动前的事实：
 *  - 404 页文案写着「您可以尝试搜索」，但页面上**根本没有搜索框**（说了做不到）；
 *  - 出口只有「返回主页」和「技术生态图谱」两个。
 *
 * 对导航站来说 404 是最高频的失败面（外链失效 / 收藏存了旧 id / 手输路径打错），
 * 所以这里把恢复路径收敛成数据（lib/recovery-links.ts）并加两道锁：
 *  1. 每条 href 必须能对着 overlay 的真实路由表（src/app/**\/page.tsx）校验通过
 *     ——「恢复路径本身是死链」是最讽刺的回归；
 *  2. 页面源码必须真的渲染搜索面板（把文案里的承诺兑现），
 *     且不得再出现写死的站内 href（一律走数据，便于上面的校验覆盖）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { RECOVERY_LINKS } from "../src/lib/recovery-links";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 定位 overlay 根目录。
 * 测试文件有两份（overlay 源 + apps/web 里的镜像），相对路径不同，
 * 按「路径里必须含 web-overlay」消歧，否则镜像副本会指向 vendored 的 apps/web
 * —— 那里在干净检出时只有少数几个 tracked 页面，断言会假失败。
 */
function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const hit = candidates.find(
    (p) => p.replace(/\\/g, "/").endsWith("/web-overlay") && existsSync(join(p, "src", "app")),
  );
  if (!hit) throw new Error("无法定位 overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

function overlayFile(rel: string): string {
  return readFileSync(join(overlayRoot(), rel), "utf8");
}

/** overlay 里的静态路由（跳过动态段、API、私有目录与路由组） */
function overlayStaticRoutes(): Set<string> {
  const routes = new Set<string>();
  const walk = (dir: string, urlPath: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) {
        if (entry.name === "page.tsx") routes.add(urlPath === "" ? "/" : urlPath);
        continue;
      }
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name === "api" || name.startsWith("_") || name.startsWith("(") || name.includes("[")) continue;
      walk(join(dir, name), urlPath + "/" + name);
    }
  };
  walk(join(overlayRoot(), "src", "app"), "");
  return routes;
}

const routes = overlayStaticRoutes();

describe("recovery-links：数据本身要干净", () => {
  it("至少给出若干出口，且 href 唯一、无尾斜杠", () => {
    expect(RECOVERY_LINKS.length).toBeGreaterThanOrEqual(4);
    const hrefs = RECOVERY_LINKS.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) {
      expect(href.startsWith("/")).toBe(true);
      // 根路径本身就是 "/"，其余不许有尾斜杠 / query / hash
      if (href !== "/") expect(href).not.toMatch(/\/$|\?|#/);
      expect(href).not.toMatch(/\?|#/);
    }
  });

  it("每条都有标签与一句话说明，且图标键非空", () => {
    for (const link of RECOVERY_LINKS) {
      expect(link.label.trim().length).toBeGreaterThan(0);
      expect(link.description.trim().length).toBeGreaterThan(0);
      expect(link.icon.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("recovery-links：每条出口都必须真的存在", () => {
  it("overlay 路由表里能查到全部 href（恢复路径不许是死链）", () => {
    const missing = RECOVERY_LINKS.map((l) => l.href).filter((href) => !routes.has(href));
    expect(missing).toEqual([]);
  });

  it("路由表本身不该是空的（否则上面的断言会假通过）", () => {
    expect(routes.has("/")).toBe(true);
    expect(routes.size).toBeGreaterThan(5);
  });
});

describe("not-found.tsx：把「可以搜索」兑现，并给出成组出口", () => {
  const src = overlayFile("src/app/not-found.tsx");

  it("嵌入真实的搜索面板（回归：文案说可以搜索，页面上却没有搜索框）", () => {
    expect(src).toContain("import { SearchPalette } from '@/components/search-palette'");
    expect(src).toContain("<SearchPalette");
  });

  it("明确告诉用户是哪个路径没找到", () => {
    expect(src).toContain("usePathname()");
    expect(src).toContain("{pathname}");
  });

  it("出口来自 recovery-links 数据，而不是写死的 href", () => {
    expect(src).toContain("RECOVERY_LINKS");
    const literals = [...src.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(literals.filter((h) => h.startsWith("/") && !routes.has(h))).toEqual([]);
  });

  it("图标映射覆盖数据里出现的每个图标键（类型 + 运行时双保险）", () => {
    for (const icon of new Set(RECOVERY_LINKS.map((l) => l.icon))) {
      expect(src).toMatch(new RegExp("\\b" + icon + ":"));
    }
  });
});
