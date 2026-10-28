/**
 * 包体预算检查器的回归测试（fixture 驱动，不依赖真实构建）。
 *
 * 守三件事：
 *   1. Turbopack（Next 16）取数口径正确：框架 chunk + 非异步路由 chunk − 异步 chunk；
 *   2. webpack（Next ≤15）旧产物仍可读（向后兼容，避免升级后检查器直接失效）；
 *   3. --report / --raise 的「可复现重定基线」：只读报告不拦人，写预算必须
 *      提交可定位 + 工作区干净 + 产物不过期，且只上调、不顺手把可下调的改掉。
 */
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

/* ------------------------------------------------------------------ *
 * --report / --raise：从真实产物可复现地重定基线
 * ------------------------------------------------------------------ */

/**
 * Turbopack 产物夹具：framework 共载 + 每条路由一个专属 chunk。
 * 返回 build-manifest 的路径，好让测试精确控制「产物时间 vs 源码时间」。
 */
function writeTurbopackDist(root: string, spec: Record<string, number>, frameworkBytes: number): string {
  const dist = "apps/web/fixture-dist";
  const keyOf = (route: string) => (route === "/" ? "/page" : `${route}/page`);
  write(
    root,
    `${dist}/build-manifest.json`,
    JSON.stringify({
      rootMainFiles: ["/_next/static/chunks/framework.js"],
      pagesChunkGroupBootstrapParams: Object.fromEntries(Object.keys(spec).map((r) => [keyOf(r), {}])),
    }),
  );
  write(root, `${dist}/static/chunks/framework.js`, bytes(frameworkBytes));
  for (const [route, extra] of Object.entries(spec)) {
    const rel = route === "/" ? "" : route.slice(1);
    const chunk = `static/chunks/r-${route.replace(/[^a-z0-9]/gi, "_")}.js`;
    write(root, `${dist}/${chunk}`, bytes(extra));
    write(
      root,
      `${dist}/server/app/${rel}/page_client-reference-manifest.js`,
      `globalThis.__RSC_MANIFEST = ${JSON.stringify({ [keyOf(route)]: { clientModules: { m: { chunks: [`/_next/${chunk}`], async: false } } } })};`,
    );
  }
  return join(root, dist, "build-manifest.json");
}

/** 临时 git 仓库夹具：可定位提交 + 可控脏文件数，--raise 的前置条件才有真东西可验 */
function makeRepoRoot(spec: Record<string, number>, budgets: Record<string, any>): { root: string; manifest: string } {
  const root = mkdtempSync(join(tmpdir(), "navhub-bundle-repo-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "budget@test.local"]);
  git(root, ["config", "user.name", "budget-test"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  write(root, "scripts/bundle-budget.json", JSON.stringify(budgets, null, 2) + "\n");
  const manifest = writeTurbopackDist(root, spec, 1_000);
  write(root, "apps/web/src/app/page.tsx", "export default function P() { return null }\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  // 产物「比源码新」：夹具里所有文件同时落盘，mtime 差在毫秒级，判定会随调度抖动
  const future = new Date(Date.now() + 60_000);
  utimesSync(manifest, future, future);
  return { root, manifest };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runBudget(root: string, args: string[]): { code: number; out: string } {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NEXT_DIST_DIR: "fixture-dist" },
  });
  return { code: res.status ?? -1, out: `${res.stdout}${res.stderr}` };
}

const RAISE_BUDGETS = {
  _comment: "夹具说明不许丢",
  default: 10_000,
  routes: { "/": 9_000, "/hot": 20_000 },
};
// framework 1000 + 各自 chunk：/ = 9500（超）、/hot = 5000（宽）、/new = 4000（没配条目）
const RAISE_SPEC = { "/": 8_500, "/hot": 4_000, "/new": 3_000 };

describe("check-bundle-budget：--report 只读建议", () => {
  it("三类差异分别列出：上调候选 / 漏配条目 / 可下调，且退出码 0（报告不是门禁）", () => {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      const before = readFileSync(join(root, "scripts/bundle-budget.json"), "utf8");
      const { code, out } = runBudget(root, ["--report"]);
      expect(code, out).toBe(0);
      expect(out).toContain("上调候选（实测超预算，需要显式 --raise）（1 条）");
      // 建议值取整到 KiB 后是确定的两个数；实测/现有预算随夹具展示，不在这里钉格式
      expect(out).toMatch(/- \/：实测 .* > 预算 .* → 建议 10 KB/);
      expect(out).toContain("漏配专属预算（正落 default，建议补一条更紧的阈值）（1 条）");
      expect(out).toMatch(/- \/new：实测 .*，无 routes 条目（default .*）→ 建议 5 KB/);
      expect(out).toContain("可下调（实测比预算低 5% 以上；棘轮只降不升，这条要人工决定）（1 条）");
      expect(out).toContain("- /hot：实测 ");
      expect(out).toContain("产物出处：提交 ");
      expect(readFileSync(join(root, "scripts/bundle-budget.json"), "utf8")).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("--json --report 给出机器可读的三类桶与出处，建议值口径是实测 ×1.05 向上取整到 KiB", () => {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      const res = spawnSync(process.execPath, [SCRIPT, "--report", "--json"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, NEXT_DIST_DIR: "fixture-dist" },
      });
      expect(res.status, res.stderr).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.mode).toBe("report");
      expect(json.headroom).toBe(1.05);
      expect(json.report.raise.map((r: { route: string }) => r.route)).toEqual(["/"]);
      // 9500 × 1.05 = 9975 → 向上取整到 KiB = 10240
      expect(json.report.raise[0].proposed).toBe(10_240);
      expect(json.report.addMissing[0]).toEqual({ route: "/new", bytes: 4_000, limit: 10_000, proposed: 5_120 });
      expect(json.report.tighten.map((r: { route: string }) => r.route)).toEqual(["/hot"]);
      expect(json.provenance.sha).toMatch(/^[0-9a-f]{7,}$/);
      expect(json.provenance.dirty).toBe(0);
      expect(json.provenance.bundleDirty).toBe(0);
      expect(json.provenance.bundleDirtyPaths).toEqual([]);
      expect(json.provenance.stale).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("产物比源码旧时报告里明说，而不是继续给一份不可复现的建议值", () => {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      const src = join(root, "apps/web/src/app/page.tsx");
      const future = new Date(Date.now() + 3_600_000);
      utimesSync(src, future, future);
      const { code, out } = runBudget(root, ["--report"]);
      expect(code, out).toBe(0);
      expect(out).toContain("⚠️ 产物比源码旧");
      expect(out).toContain("别拿它定基线");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("报告分开报「挡路的首屏源码改动」与全仓脏数，并把前者点名到文件", () => {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      // 新路由目录：默认 porcelain 会把它折成 `?? apps/web/src/app/new-route/` 一行，
      // 判据要逐文件计数才能说清「这份产物缺的是哪些改动」
      write(root, "apps/web/src/app/new-route/page.tsx", "export default function N() { return null }\n");
      write(root, "docs/notes.md", "# n\n");
      const { code, out } = runBudget(root, ["--report"]);
      expect(code, out).toBe(0);
      expect(out).toContain("首屏源码脏 1 个文件");
      expect(out).toContain("挡路的是这些：apps/web/src/app/new-route/page.tsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("首屏源码干净、只有无关文件脏时，出处行说「干净」而不是让人以为不能定基线", () => {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      write(root, "docs/notes.md", "# n\n");
      write(root, "tmp/evidence.txt", "x\n");
      const { code, out } = runBudget(root, ["--report"]);
      expect(code, out).toBe(0);
      expect(out).toContain("首屏源码干净（全仓另有 ");
      expect(out).not.toContain("挡路的是这些");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("check-bundle-budget：--raise 写预算的三条硬前置", () => {
  it("缺 --reason 就拒绝：没有书面依据的上调等于给现状背书", () => {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      const { code, out } = runBudget(root, ["--raise"]);
      expect(code, out).toBe(2);
      expect(out).toContain('必须带 --reason="..."');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("首屏源码脏就拒绝：那份产物不属于任何提交，写进预算无法复现", () => {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      write(root, "apps/web/src/app/dirty.tsx", "export const x = 1\n");
      const { code, out } = runBudget(root, ["--raise", "--reason=抽屉改懒加载后确实变大"]);
      expect(code, out).toBe(2);
      expect(out).toContain("首屏源码有 1 个未提交改动");
      // 拒绝必须点名到文件：只报个数字，人还得自己再去翻 git status
      expect(out).toContain("apps/web/src/app/dirty.tsx");
      expect(out).toContain("先提交这些改动、再重新 build");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("与首屏无关的脏文件不挡路：docs/scripts/apps/api/packages-store 脏着也能定基线", () => {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      write(root, "docs/upgrade-notes.md", "# 说明\n");
      write(root, "scripts/scratch.mjs", "console.log(1)\n");
      write(root, "apps/api/src/server.ts", "export const a = 1\n");
      write(root, "packages/store/test/foreign.test.ts", "export {}\n");
      const { code, out } = runBudget(root, ["--raise", "--reason=抽屉改懒加载后确实变大"]);
      // 这条是「判据收窄」的正证：旧口径按全仓计数会在这里拒绝，而多会话工作区里
      // 全仓计数永远非零，于是这条前置从「不方便」变成「无法达成」，最终被整体绕过。
      expect(code, out).toBe(0);
      expect(out).toContain("已写入 scripts/bundle-budget.json（上调 1 条 · 补条目 1 条）");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("覆盖层源码脏也挡路：build 前会 apply 进 apps/web，它同样决定首屏字节数", () => {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      write(root, "apps/web-overlay/src/lib/drawer.tsx", "export const x = 1\n");
      const { code, out } = runBudget(root, ["--raise", "--reason=确实变大"]);
      expect(code, out).toBe(2);
      expect(out).toContain("apps/web-overlay/src/lib/drawer.tsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("锁文件脏就拒绝：依赖版本一动，首屏字节数就动", () => {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      write(root, "pnpm-lock.yaml", "lockfileVersion: 9.0\n");
      const { code, out } = runBudget(root, ["--raise", "--reason=确实变大"]);
      expect(code, out).toBe(2);
      expect(out).toContain("pnpm-lock.yaml");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("两条判据共用同一个集合：覆盖层改过就承认产物过期，不出现「脏判据认它、过期判据说不关它事」", () => {
    const { root, manifest } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      write(root, "apps/web-overlay/src/lib/applied.ts", "export const y = 2\n");
      git(root, ["add", "-A"]);
      git(root, ["commit", "-q", "-m", "overlay change"]);
      // 提交后不脏了，只剩「它比产物新」这一条能拦——正好检验过期判据也走 overlay
      utimesSync(manifest, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
      const future = new Date(Date.now() + 3_600_000);
      utimesSync(join(root, "apps/web-overlay/src/lib/applied.ts"), future, future);
      const { code, out } = runBudget(root, ["--raise", "--reason=确实变大"]);
      expect(code, out).toBe(2);
      expect(out).toContain("构建产物比源码旧");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("预算文件自己不算源码：写完一条基线不该把产物判成过期", () => {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      const far = new Date(Date.now() + 7_200_000);
      utimesSync(join(root, "scripts/bundle-budget.json"), far, far);
      const { code, out } = runBudget(root, ["--raise", "--reason=确实变大"]);
      expect(code, out).toBe(0);
      expect(out).toContain("已写入 scripts/bundle-budget.json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("产物过期就拒绝：拿旧产物定基线，CI 下一轮必然对不上", () => {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      const future = new Date(Date.now() + 3_600_000);
      utimesSync(join(root, "apps/web/src/app/page.tsx"), future, future);
      const { code, out } = runBudget(root, ["--raise", "--reason=确实变大"]);
      expect(code, out).toBe(2);
      expect(out).toContain("构建产物比源码旧");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("三条都满足才写：只动 routes、注释键保留、可下调不写、审计行带 sha 与原因，写完门禁转绿", () => {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      const { code, out } = runBudget(root, ["--raise", "--reason=AI 抽屉改成常驻，实测 +4.7 KB"]);
      expect(code, out).toBe(0);
      expect(out).toContain("已写入 scripts/bundle-budget.json（上调 1 条 · 补条目 1 条）");
      const next = JSON.parse(readFileSync(join(root, "scripts/bundle-budget.json"), "utf8"));
      expect(next._comment).toBe("夹具说明不许丢");
      expect(next.default).toBe(10_000); // default 不许被 --raise 改动
      expect(next.routes["/"]).toBe(10_240); // 超预算的那条被上调
      expect(next.routes["/new"]).toBe(5_120); // 漏配的补上专属（更紧的）条目
      expect(next.routes["/hot"]).toBe(20_000); // 可下调的只报不写
      expect(next._raise_log[0].reason).toBe("AI 抽屉改成常驻，实测 +4.7 KB");
      expect(next._raise_log[0].sha).toMatch(/^[0-9a-f]{7,}$/);
      expect(next._raise_log[0].changes).toEqual([
        { route: "/", from: 9_000, to: 10_240, measured: 9_500 },
        { route: "/new", from: 10_000, to: 5_120, measured: 4_000 },
      ]);
      // 上调的目的就是让门禁认这份新现实：重跑默认模式必须绿
      expect(runBudget(root, []).code).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("没有需要上调的路由时不动文件，也不假装写了一条空审计", () => {
    const { root } = makeRepoRoot({ "/": 8_000 }, { default: 10_000, routes: { "/": 9_000 } });
    try {
      const before = readFileSync(join(root, "scripts/bundle-budget.json"), "utf8");
      const { code, out } = runBudget(root, ["--raise", "--reason=没有超限也想顺手改"]);
      expect(code, out).toBe(0);
      expect(out).toContain("没有需要上调或补条目的路由，预算文件未改动");
      expect(readFileSync(join(root, "scripts/bundle-budget.json"), "utf8")).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("check-bundle-budget：参数卫生", () => {
  it("拼错的旗标以退出码 2 拒绝，不静默当成门禁跑一遍", () => {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      const { code, out } = runBudget(root, ["--rai"]);
      expect(code, out).toBe(2);
      expect(out).toContain("不认识的参数：--rai");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("--report 与 --raise 互斥：后者会自己重算建议值", () => {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      const { code, out } = runBudget(root, ["--report", "--raise", "--reason=x"]);
      expect(code, out).toBe(2);
      expect(out).toContain("不能同时给");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

