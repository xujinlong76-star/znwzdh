/**
 * 包体预算检查器的回归测试（fixture 驱动，不依赖真实构建）。
 *
 * 守两件事：
 *   1. Turbopack（Next 16）取数口径正确：框架 chunk + 非异步路由 chunk − 异步 chunk；
 *   2. webpack（Next ≤15）旧产物仍可读（向后兼容，避免升级后检查器直接失效）。
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = resolve("scripts/check-bundle-budget.mjs");

function write(root: string, rel: string, content: string | Buffer) {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
}

function bytes(n: number): Buffer {
  return Buffer.alloc(n, 1);
}

function runChecker(root: string): { code: number; json: any } {
  const res = spawnSync(process.execPath, [SCRIPT, "--json"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NEXT_DIST_DIR: "fixture-dist" },
  });
  let json: any = null;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    json = null;
  }
  return { code: res.status ?? -1, json };
}

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "navhub-bundle-"));
  write(root, "scripts/bundle-budget.json", JSON.stringify({ default: 10_000, routes: {} }));
  return root;
}

describe("check-bundle-budget：Turbopack 口径", () => {
  it("框架 + 非异步 chunk − 异步 chunk，并识别 /page 根路由", () => {
    const root = makeRoot();
    try {
      const dist = "apps/web/fixture-dist";
      write(
        root,
        `${dist}/build-manifest.json`,
        JSON.stringify({
          rootMainFiles: ["/_next/static/chunks/framework.js"],
          pagesChunkGroupBootstrapParams: { "/page": {}, "/hot/page": {} },
        }),
      );
      write(root, `${dist}/static/chunks/framework.js`, bytes(1000));
      write(root, `${dist}/static/chunks/root.js`, bytes(2000));
      write(root, `${dist}/static/chunks/async-root.js`, bytes(4000));
      write(root, `${dist}/static/chunks/hot.js`, bytes(1500));
      write(root, `${dist}/static/chunks/shared.js`, bytes(500));
      write(root, `${dist}/static/chunks/hot-async.js`, bytes(3000));

      // 根路由：非异步 root.js 计入；async-root.js 被 react-loadable 排除
      write(
        root,
        `${dist}/server/app/page_client-reference-manifest.js`,
        `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/page"] = { clientModules: {
  "a": { chunks: ["/_next/static/chunks/root.js"], async: false },
  "b": { chunks: ["/_next/static/chunks/async-root.js"], async: true }
} };`,
      );
      write(
        root,
        `${dist}/server/app/react-loadable-manifest.json`,
        JSON.stringify({ "async-root": { files: ["/_next/static/chunks/async-root.js"] } }),
      );

      // /hot：hot.js + shared.js 计入；hot-async.js 排除
      write(
        root,
        `${dist}/server/app/hot/page_client-reference-manifest.js`,
        `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/hot/page"] = { clientModules: {
  "h": { chunks: ["/_next/static/chunks/hot.js", "/_next/static/chunks/shared.js"], async: false },
  "ha": { chunks: ["/_next/static/chunks/hot-async.js"], async: true }
} };`,
      );
      write(
        root,
        `${dist}/server/app/hot/react-loadable-manifest.json`,
        JSON.stringify({ "hot-async": { files: ["/_next/static/chunks/hot-async.js"] } }),
      );

      const { code, json } = runChecker(root);
      expect(json).not.toBeNull();
      expect(json.bundler).toBe("turbopack");
      const byRoute = Object.fromEntries(json.routes.map((r: { route: string; bytes: number }) => [r.route, r.bytes]));
      expect(byRoute["/"]).toBe(3000); // framework 1000 + root 2000
      expect(byRoute["/hot"]).toBe(3000); // framework 1000 + hot 1500 + shared 500
      expect(json.violations).toEqual([]);
      expect(code).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("超预算时以非零退出码报出违规路由", () => {
    const root = makeRoot();
    try {
      write(root, "scripts/bundle-budget.json", JSON.stringify({ default: 1000, routes: {} }));
      const dist = "apps/web/fixture-dist";
      write(
        root,
        `${dist}/build-manifest.json`,
        JSON.stringify({ rootMainFiles: ["/_next/static/chunks/framework.js"], pagesChunkGroupBootstrapParams: { "/page": {} } }),
      );
      write(root, `${dist}/static/chunks/framework.js`, bytes(1200));
      write(
        root,
        `${dist}/server/app/page_client-reference-manifest.js`,
        `globalThis.__RSC_MANIFEST = {"/page": { clientModules: {} }};`,
      );

      const { code, json } = runChecker(root);
      expect(json.bundler).toBe("turbopack");
      expect(json.violations).toHaveLength(1);
      expect(json.violations[0].route).toBe("/");
      expect(code).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("check-bundle-budget：webpack 兼容", () => {
  it("无 build-manifest 时回退 app-build-manifest 并排除异步 chunk", () => {
    const root = makeRoot();
    try {
      const dist = "apps/web/fixture-dist";
      write(
        root,
        `${dist}/app-build-manifest.json`,
        JSON.stringify({
          pages: {
            "/app/page": ["/_next/static/chunks/main.js", "/_next/static/chunks/lazy.js"],
            "/app/hot/page": ["/_next/static/chunks/main.js", "/_next/static/chunks/hot.js"],
          },
        }),
      );
      write(
        root,
        `${dist}/react-loadable-manifest.json`,
        JSON.stringify({ "lazy": { files: ["/_next/static/chunks/lazy.js"] } }),
      );
      write(root, `${dist}/static/chunks/main.js`, bytes(700));
      write(root, `${dist}/static/chunks/lazy.js`, bytes(900));
      write(root, `${dist}/static/chunks/hot.js`, bytes(300));

      const { code, json } = runChecker(root);
      expect(json.bundler).toBe("webpack");
      const byRoute = Object.fromEntries(json.routes.map((r: { route: string; bytes: number }) => [r.route, r.bytes]));
      expect(byRoute["/"]).toBe(700); // lazy 被全局 loadable 排除
      expect(byRoute["/hot"]).toBe(1000);
      expect(code).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("两种产物都不存在时退出码 2 并给出提示", () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, "apps/web/fixture-dist"), { recursive: true });
      const res = spawnSync(process.execPath, [SCRIPT], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, NEXT_DIST_DIR: "fixture-dist" },
      });
      expect(res.status).toBe(2);
      expect(res.stderr).toContain("找不到构建产物");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
