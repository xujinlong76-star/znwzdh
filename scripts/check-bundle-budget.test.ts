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

describe("check-bundle-budget：CI 注解（超限结论要能被只读 annotations 的归因工具看见）", () => {
  /** 门禁模式（非 --json）跑一遍，返回退出码与合并后的输出 */
  function runGate(root: string, env: Record<string, string>): { code: number; out: string } {
    const res = spawnSync(process.execPath, [SCRIPT], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NEXT_DIST_DIR: "fixture-dist", ...env },
    });
    return { code: res.status ?? -1, out: (res.stdout ?? "") + (res.stderr ?? "") };
  }

  /** 一份「/ 超预算」的最小产物；预算写成多行 JSON，注解才锚得到具体阈值行 */
  function makeOverBudgetRoot(): string {
    const root = makeRoot();
    write(root, "scripts/bundle-budget.json", JSON.stringify({ default: 10_000, routes: { "/": 1000 } }, null, 2));
    const dist = "apps/web/fixture-dist";
    write(
      root,
      `${dist}/build-manifest.json`,
      JSON.stringify({ rootMainFiles: ["/_next/static/chunks/framework.js"], pagesChunkGroupBootstrapParams: { "/page": {} } }),
    );
    // 1.2 MB 对 1000 B 的阈值：差得足够远，kb() 取整后两条数字仍然分得开（否则注解文案自相矛盾）
    write(root, `${dist}/static/chunks/framework.js`, bytes(1_200_000));
    write(
      root,
      `${dist}/server/app/page_client-reference-manifest.js`,
      `globalThis.__RSC_MANIFEST = {"/page": { clientModules: {} }};`,
    );
    return root;
  }

  it("GITHUB_ACTIONS=true：每条超限写一条失败级注解，锚在阈值行上", () => {
    const root = makeOverBudgetRoot();
    try {
      const { code, out } = runGate(root, { GITHUB_ACTIONS: "true" });
      expect(code).toBe(1);
      // 行号 4 是 routes["/"] 在那份多行 JSON 里的真实位置：注解点得进去才知道改哪一条
      expect(out).toContain("::error file=scripts/bundle-budget.json,line=4,title=首屏预算超限 /::");
      expect(out).toContain("实测 1172 KB > 预算 1 KB");
      expect(out).toContain("node scripts/check-bundle-budget.mjs --report");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("本地不打印注解：否则每次跑门禁都多出 ::error 噪音（测试自己也可能跑在 CI 里，所以显式关掉）", () => {
    const root = makeOverBudgetRoot();
    try {
      const { code, out } = runGate(root, { GITHUB_ACTIONS: "false" });
      expect(code).toBe(1);
      expect(out).not.toContain("::error");
      // 结论仍然完整地在人读的清单里：注解是给工具的第二通道，不是替代
      expect(out).toContain("  - /: 1172 KB > 1 KB");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("--json 的 stdout 永远是纯 JSON：CI 里也不能把注解混进机器可读通道", () => {
    // 采集方（bundle-budget-summary.mjs 与测试自己）直接 JSON.parse(stdout)，
    // 注解行一旦走进来就是「账读不出来」级别的红。
    const root = makeOverBudgetRoot();
    try {
      const res = spawnSync(process.execPath, [SCRIPT, "--json"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, NEXT_DIST_DIR: "fixture-dist", GITHUB_ACTIONS: "true" },
      });
      const parsed = JSON.parse(res.stdout);
      expect(parsed.violations).toHaveLength(1);
      expect(res.stdout).not.toContain("::error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("超限条数超过注解上限：逐条标注截断，但总数注解把完整列表指到**读得到**的通道", () => {
    // 本仓库的 token 缺 Actions:read ⇒ 作业日志接口 404。所以「完整列表见作业日志」
    // 是一句无法兑现的话；总数注解必须指同作业的「首屏预算账」Step Summary。
    const root = makeRoot();
    try {
      write(root, "scripts/bundle-budget.json", JSON.stringify({ default: 10_000, routes: {} }));
      const dist = "apps/web/fixture-dist";
      // 21 条路由只靠共享的 framework chunk 就全部超限：逐路由 manifest 缺文件时
      // 该路由只算框架体积，夹具因此不需要 21 份产物文件。
      const routeKeys = Array.from({ length: 21 }, (_, i) => [`/r${i}/page`, {}]);
      write(
        root,
        `${dist}/build-manifest.json`,
        JSON.stringify({ rootMainFiles: ["/_next/static/chunks/framework.js"], pagesChunkGroupBootstrapParams: Object.fromEntries(routeKeys) }),
      );
      write(root, `${dist}/static/chunks/framework.js`, bytes(1_200_000));

      const { code, out } = runGate(root, { GITHUB_ACTIONS: "true" });
      expect(code).toBe(1);
      // 20 条逐路由 + 1 条总数：注解条数被夹在 MAX_ANNOTATIONS 之内
      expect(out.split("\n").filter((l) => l.startsWith("::error"))).toHaveLength(21);
      expect(out).toContain("共 21 条，这里只标注前 20 条");
      expect(out).toContain("首屏预算账");
      expect(out).not.toContain("完整列表见作业日志");
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


/**
 * 「首屏源码干净」这条前置对 apps/web 派生镜像的处理。
 *
 * 为什么单独一组：CI 的 test-web 第 6 步就是 vendor-web，它必然重写 apps/web/src 的镜像。
 * HEAD 里跟踪的镜像只要落后于已提交的事实源，脏判据就永远为真——2026-10-28 实测
 * tip 1a21763 的账 bundleDirty=3，三条全是这一类，等于 --raise 在 CI 里结构性不可能。
 */
describe("check-bundle-budget：apps/web 生成镜像不挡定基线", () => {
  /** 夹具：overlay 事实源 + apps/web 镜像一起提交，之后按场景制造「镜像脏」 */
  function makeMirrorRoot(): { root: string; bump: (body: string) => void; sync: () => void } {
    const root = mkdtempSync(join(tmpdir(), "navhub-bundle-mirror-"));
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "mirror@test.local"]);
    git(root, ["config", "user.name", "mirror-test"]);
    git(root, ["config", "commit.gpgsign", "false"]);
    write(root, "scripts/bundle-budget.json", JSON.stringify(RAISE_BUDGETS, null, 2) + "\n");
    const manifest = writeTurbopackDist(root, RAISE_SPEC, 1_000);
    write(root, "apps/web-overlay/src/app/page.tsx", "export default function V1() { return null }\n");
    write(root, "apps/web/src/app/page.tsx", "export default function V1() { return null }\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "fixture"]);
    const future = new Date(Date.now() + 60_000);
    utimesSync(manifest, future, future);
    return {
      root,
      // 只提交事实源，不动镜像：这就是「HEAD 里镜像落后」的成因
      bump: (body) => {
        write(root, "apps/web-overlay/src/app/page.tsx", body);
        git(root, ["add", "apps/web-overlay/src/app/page.tsx"]);
        git(root, ["commit", "-q", "-m", "overlay only"]);
      },
      // 等价于 vendor-web 的覆写：镜像内容 = 已提交的事实源
      sync: () => {
        const src = readFileSync(join(root, "apps/web-overlay/src/app/page.tsx"), "utf8");
        write(root, "apps/web/src/app/page.tsx", src);
        const m2 = new Date(Date.now() + 120_000);
        utimesSync(join(root, "apps/web/fixture-dist/build-manifest.json"), m2, m2);
      },
    };
  }

  it("镜像内容等于 HEAD 的事实源：中性化，--raise 放行", () => {
    const fx = makeMirrorRoot();
    try {
      fx.bump("export default function V2() { return null }\n");
      fx.sync();
      const res = spawnSync(process.execPath, [SCRIPT, "--report", "--json"], {
        cwd: fx.root,
        encoding: "utf8",
        env: { ...process.env, NEXT_DIST_DIR: "fixture-dist" },
      });
      expect(res.status, res.stderr).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.provenance.bundleDirty).toBe(0);
      expect(json.provenance.bundleDirtyPaths).toEqual([]);
      expect(json.provenance.mirrorNeutral).toBe(1);
      expect(json.provenance.mirrorNeutralPaths).toEqual(["apps/web/src/app/page.tsx"]);
      // 中性化不等于看不见：报数那一行要点名
      const out = runBudget(fx.root, ["--report"]);
      expect(out.code, out.out).toBe(0);
      expect(out.out).toContain("vendor-web 从已提交事实源重写的 apps/web 镜像");
      const raised = runBudget(fx.root, ["--raise", "--reason=镜像来自已提交事实源"]);
      expect(raised.code, raised.out).toBe(0);
      expect(raised.out).toContain("已写入");
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it("镜像被手改（内容不等于 HEAD 的事实源）：继续挡， refusal 点名到文件", () => {
    const fx = makeMirrorRoot();
    try {
      fx.bump("export default function V2() { return null }\n");
      write(fx.root, "apps/web/src/app/page.tsx", "export default function HandEdited() { return null }\n");
      const { code, out } = runBudget(fx.root, ["--raise", "--reason=确实变大"]);
      expect(code, out).toBe(2);
      expect(out).toContain("首屏源码有 1 个未提交改动");
      expect(out).toContain("apps/web/src/app/page.tsx");
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it("新文件直接落在 apps/web/src（HEAD 里没有事实源）：不算镜像，继续挡", () => {
    const fx = makeMirrorRoot();
    try {
      write(fx.root, "apps/web/src/app/brand-new/page.tsx", "export default function N() { return null }\n");
      const { code, out } = runBudget(fx.root, ["--raise", "--reason=确实变大"]);
      expect(code, out).toBe(2);
      expect(out).toContain("apps/web/src/app/brand-new/page.tsx");
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it("packages/core 与 overlay 的脏永远挡路：中性化只认 apps/web/src 这一类", () => {
    const fx = makeMirrorRoot();
    try {
      write(fx.root, "packages/core/src/cjk.ts", "export const x = 1;\n");
      const { code, out } = runBudget(fx.root, ["--raise", "--reason=确实变大"]);
      expect(code, out).toBe(2);
      expect(out).toContain("packages/core/src/cjk.ts");
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});

/**
 * --raise --from：吃一份「别处算好的账」（CI artifact）。
 *
 * 为什么需要：干净的树只存在于 CI——本地常年有别人的未提交改动，拿本地 .next 定基线
 * 等于把「我这一棵树恰好多大」写进契约。换来的代价是要多回答一个本地不需要回答的问题：
 * 这份账还属于当前 HEAD 吗。下面每条拒绝对应一个真实会发生的坏姿势。
 */
describe("check-bundle-budget：--raise --from 吃 CI 的账", () => {
  function reportAt(root: string): any {
    const res = spawnSync(process.execPath, [SCRIPT, "--report", "--json"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NEXT_DIST_DIR: "fixture-dist" },
    });
    if (res.status !== 0) throw new Error(`--report 失败：${res.stderr}`);
    return JSON.parse(res.stdout);
  }

  /** 报告落在仓库内也不会把「首屏源码」判脏：它不在 BUNDLE_SOURCE_PATHS 里 */
  function save(root: string, report: any, name = "ci-report.json"): void {
    write(root, name, JSON.stringify(report, null, 2) + "\n");
  }

  function repoWithReport(): { root: string; report: any } {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    const report = reportAt(root);
    save(root, report);
    return { root, report };
  }

  it("账干净且有出处：写预算、审计行记 source=report 与报告里的 sha，写完门禁转绿", () => {
    const { root, report } = repoWithReport();
    try {
      // HEAD 往前走一步，但首屏源码一行未动：账仍然属于当前树
      write(root, "docs/note.md", "unrelated\n");
      git(root, ["add", "-A"]);
      git(root, ["commit", "-q", "-m", "docs only"]);

      const { code, out } = runBudget(root, [
        "--raise",
        "--from",
        "ci-report.json",
        "--reason=CI 干净树实测，本地无干净树",
      ]);
      expect(code, out).toBe(0);
      expect(out).toContain("数字来自 --from 的报告");
      expect(out).toContain("已写入");

      const budget = JSON.parse(readFileSync(join(root, "scripts/bundle-budget.json"), "utf8"));
      expect(budget._comment).toBe("夹具说明不许丢");
      expect(budget.routes["/"]).toBe(report.report.raise[0].proposed);
      expect(budget.routes["/new"]).toBe(report.report.addMissing[0].proposed);
      expect(budget.routes["/hot"]).toBe(20_000);
      const log = budget._raise_log[0];
      expect(log.source).toBe("report");
      expect(log.sha).toBe(report.provenance.sha);
      expect(log.bundler).toBe("turbopack");
      expect(typeof log.builtAt).toBe("string");

      // 写进去的阈值必须让当前产物不再违规：否则等于写了一版没用的数
      const gate = runChecker(root);
      expect(gate.code, JSON.stringify(gate.json)).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("报告自称过期（stale≠false）就拒：无法确认这份数属于报告里的提交", () => {
    const { root, report } = repoWithReport();
    try {
      report.provenance.stale = true;
      save(root, report);
      const { code, out } = runBudget(root, ["--raise", "--from", "ci-report.json", "--reason=x"]);
      expect(code, out).toBe(2);
      expect(out).toContain("无法确认产物新鲜");
      expect(readFileSync(join(root, "scripts/bundle-budget.json"), "utf8")).not.toContain("_raise_log");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("报告自称首屏源码脏（bundleDirty≠0）就拒：账本身就不可复现", () => {
    const { root, report } = repoWithReport();
    try {
      report.provenance.bundleDirty = 3;
      save(root, report);
      const { code, out } = runBudget(root, ["--raise", "--from", "ci-report.json", "--reason=x"]);
      expect(code, out).toBe(2);
      expect(out).toContain("首屏源码脏 3 个");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("报告的提交本仓库不认识 / 不是 HEAD 的祖先：两种都拒，且说清是哪一种", () => {
    const { root, report } = repoWithReport();
    try {
      const unknown = "0".repeat(40);
      report.provenance.sha = unknown;
      save(root, report);
      const notHere = runBudget(root, ["--raise", "--from", "ci-report.json", "--reason=x"]);
      expect(notHere.code, notHere.out).toBe(2);
      expect(notHere.out).toContain("不在本仓库里");

      const base = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
      git(root, ["checkout", "-q", "-b", "elsewhere"]);
      write(root, "docs/other.md", "x\n");
      git(root, ["add", "-A"]);
      git(root, ["commit", "-q", "-m", "elsewhere"]);
      const otherSha = git(root, ["rev-parse", "HEAD"]).trim();
      git(root, ["checkout", "-q", base]);
      report.provenance.sha = otherSha;
      save(root, report);
      const notAncestor = runBudget(root, ["--raise", "--from", "ci-report.json", "--reason=x"]);
      expect(notAncestor.code, notAncestor.out).toBe(2);
      expect(notAncestor.out).toContain("不是 HEAD 的祖先");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("报告之后首屏源码改了（packages/core）：账属于旧树，拒绝并点名文件", () => {
    const { root } = repoWithReport();
    try {
      write(root, "packages/core/src/cjk.ts", "export const x = 1;\n");
      git(root, ["add", "-A"]);
      git(root, ["commit", "-q", "-m", "core change"]);
      const { code, out } = runBudget(root, ["--raise", "--from", "ci-report.json", "--reason=x"]);
      expect(code, out).toBe(2);
      expect(out).toContain("首屏源码变了 1 个");
      expect(out).toContain("packages/core/src/cjk.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("镜像在报告之后追平事实源：不算漂移（overlay 没变，产物照样可复现）", () => {
    const { root } = makeRepoRoot(RAISE_SPEC, RAISE_BUDGETS);
    try {
      write(root, "apps/web-overlay/src/app/page.tsx", "export default function V1() { return null }\n");
      write(root, "apps/web/src/app/page.tsx", "export default function V1() { return null }\n");
      git(root, ["add", "-A"]);
      git(root, ["commit", "-q", "-m", "A"]);
      // B：只提交事实源，镜像落后——仓库里真实存在的那种欠账
      write(root, "apps/web-overlay/src/app/page.tsx", "export default function V2() { return null }\n");
      git(root, ["add", "-A"]);
      git(root, ["commit", "-q", "-m", "B"]);
      // CI：vendor-web 把工作区镜像覆写成事实源 → 中性化 → 账里 bundleDirty=0
      write(root, "apps/web/src/app/page.tsx", "export default function V2() { return null }\n");
      const future = new Date(Date.now() + 120_000);
      utimesSync(join(root, "apps/web/fixture-dist/build-manifest.json"), future, future);
      const report = reportAt(root);
      expect(report.provenance.bundleDirty).toBe(0);
      expect(report.provenance.mirrorNeutral).toBe(1);
      save(root, report);
      // C：镜像落盘提交 → HEAD 里镜像 == HEAD 的事实源
      git(root, ["add", "apps/web/src/app/page.tsx"]);
      git(root, ["commit", "-q", "-m", "C"]);

      const { code, out } = runBudget(root, ["--raise", "--from", "ci-report.json", "--reason=镜像同步不算漂移"]);
      expect(code, out).toBe(0);
      expect(out).toContain("已写入");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("本地没有构建产物也能写：数字本来就不是本地产的", () => {
    const { root } = repoWithReport();
    try {
      const res = spawnSync(
        process.execPath,
        [SCRIPT, "--raise", "--from", "ci-report.json", "--reason=无本地 build"],
        { cwd: root, encoding: "utf8", env: { ...process.env, NEXT_DIST_DIR: "no-such-dist" } },
      );
      expect(res.status, res.stderr).toBe(0);
      expect(`${res.stdout}${res.stderr}`).toContain("已写入");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("参数与输入卫生：读不到 / 坏 JSON / 不是报告 / 给 --report / 空值 / 缺 reason，全部退出码 2", () => {
    const { root } = repoWithReport();
    try {
      const before = readFileSync(join(root, "scripts/bundle-budget.json"), "utf8");
      const missing = runBudget(root, ["--raise", "--from", "nope.json", "--reason=x"]);
      expect(missing.code, missing.out).toBe(2);
      expect(missing.out).toContain("读不到 --from 指定的报告");

      write(root, "bad.json", "{");
      const corrupt = runBudget(root, ["--raise", "--from", "bad.json", "--reason=x"]);
      expect(corrupt.code, corrupt.out).toBe(2);
      expect(corrupt.out).toContain("不是合法 JSON");

      write(root, "not-a-report.json", JSON.stringify({ provenance: { sha: "abc1234" } }));
      const notReport = runBudget(root, ["--raise", "--from", "not-a-report.json", "--reason=x"]);
      expect(notReport.code, notReport.out).toBe(2);
      expect(notReport.out).toContain("没有 report.raise/addMissing");

      const wrongMode = runBudget(root, ["--report", "--from", "ci-report.json"]);
      expect(wrongMode.code, wrongMode.out).toBe(2);
      expect(wrongMode.out).toContain("只和 --raise 搭配");

      const empty = runBudget(root, ["--raise", "--from", "--reason=x"]);
      expect(empty.code, empty.out).toBe(2);
      expect(empty.out).toContain("--from 后面要跟报告路径");

      const noReason = runBudget(root, ["--raise", "--from", "ci-report.json"]);
      expect(noReason.code, noReason.out).toBe(2);
      expect(noReason.out).toContain("必须带 --reason");

      expect(readFileSync(join(root, "scripts/bundle-budget.json"), "utf8")).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

