/**
 * pre-commit 选测器自检。
 *
 * 为什么需要它：收窄是「少跑」的策略，**漏选不会报错**——它只会安静地少跑几条测试。
 * 上一轮就踩过两次：① 收窄只影响日志、实际仍跑整棵目录；
 * ② 复数归一阈值写错，`jobs.ts` 收不到 `backup-restore-job.test.ts`。
 * 两次都不报错，只能靠人肉核对「到底跑了哪些文件」才发现。
 * ③ 是这一轮补的另一头：词根命中面过宽不会报错，只会**白跑**（改一个
 *    check-*.mjs 拖进整族 12 个文件，收窄等于没做）。两个方向都要断言。
 *
 * 这里把「哪些改动 → 应该选中哪些文件」固定成断言。选测器是生成物
 * （`.git/hooks/navhub-precommit-tests.mjs`），所以先重装再跑；
 * 用 `NAVHUB_PRECOMMIT_FILES` 注入改动集、`NAVHUB_PRECOMMIT_DRYRUN=1` 只看不跑。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ROOT = process.cwd();
const PAYLOAD = join(ROOT, ".git", "hooks", "navhub-precommit-tests.mjs");

beforeAll(() => {
  // 选测器是生成物：先按当前生成源重装，保证测的是最新逻辑
  execFileSync(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd: ROOT, stdio: "ignore" });
  expect(existsSync(PAYLOAD)).toBe(true);
});

/** 返回本次会被交给 vitest 的测试文件（空数组表示 SKIP 或全部被跳过） */
function select(changed: string[], extraEnv: Record<string, string> = {}): string[] {
  /**
   * 口径开关不许从外层继承：`NAVHUB_PRECOMMIT_SCOPE=all` / `NO_GRAPH=1` 会把选测器
   * 挪到另一条分支上，而下面的断言写的是「按图」的取舍——泄漏进来要么假绿要么假红。
   * 同一族泄漏在 `commit-atomicity.test.ts`（2026-10-29，4 例假绿）和
   * `safe-commit.test.ts`（2026-10-30，放行理由漏进来改了守卫分支）各踩过一次。
   * 整族剥而不是点名：`extraEnv` 在剥除之后合并，所以真要走对照臂的用例照样能显式注入。
   */
  const inherited = { ...process.env };
  for (const key of Object.keys(inherited)) {
    if (key.startsWith("NAVHUB_PRECOMMIT_")) delete inherited[key];
  }
  const out = execFileSync(process.execPath, [PAYLOAD], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...inherited,
      NAVHUB_PRECOMMIT_FILES: changed.join(","),
      NAVHUB_PRECOMMIT_DRYRUN: "1",
      ...extraEnv,
    },
  });
  const line = out.split(/\r?\n/).find((l) => l.startsWith("DRYRUN_FILES="));
  // 没打印说明走的是 SKIP 分支（没有任何匹配目标）
  if (!line) return [];
  return JSON.parse(line.slice("DRYRUN_FILES=".length)) as string[];
}

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock 与 process.env 改写，这里统一清掉。
afterAll(() => {
  vi.resetModules();
});

describe("pre-commit 选测：改动 → 测试文件", () => {
  it("改 routes/backup.ts：backup 自己的测试在，且按图把经 server 引导的测试也带上", () => {
    const files = select(["apps/api/src/routes/backup.ts"]);
    expect(files).toContain("apps/api/test/backup-async-api.test.ts");
    // 图的口径是「谁（传递地）引用了它」：routes/backup.ts ← server.ts ← 引导整个服务的
    // api 测试。名字与 backup 无关的用例因此也会入选——它们确实在启动期加载这条路由，
    // 旧词根口径只选 3 个（把这类漏选当成了「收窄成功」）。
    expect(files).toContain("apps/api/test/plugins-api.test.ts");
    // 反向的取舍：backup-restore-job.test.ts 只 import jobs.ts，不 import 本路由，
    // 所以改路由不再顺带跑它（词根只作回退，见下一条用例）。任务执行器的改动仍由
    // 改 jobs.ts 选中它（本文件第 6 条用例钉住）。
    expect(files.length).toBeGreaterThan(50);
    // 但仍小于整棵 apps/api/test（128）：收窄还在，只是依据从名字换成了依赖
    expect(files.length).toBeLessThan(128);
  });

  it("NAVHUB_PRECOMMIT_NO_GRAPH=1 只走旧词根口径（test-impact --diff 的对照臂）", () => {
    // 回放工具拿它当「旧启发式会选什么」的真值，而不是在 CLI 里再实现一份词根逻辑。
    // 两边一旦漂移，这个开关会先红。
    const withGraph = select(["apps/api/src/routes/backup.ts"]);
    const noGraph = select(["apps/api/src/routes/backup.ts"], { NAVHUB_PRECOMMIT_NO_GRAPH: "1" });
    expect(withGraph).toContain("apps/api/test/plugins-api.test.ts");
    expect(noGraph).not.toContain("apps/api/test/plugins-api.test.ts");
    expect(noGraph).toContain("apps/api/test/backup-async-api.test.ts");
    expect(noGraph.length).toBeGreaterThan(0);
    expect(noGraph.length).toBeLessThan(withGraph.length);
  });

  it("改 check-bundle-budget.mjs：通用词根不许把同前缀族整族拖进来", () => {
    // 曾经的过度匹配：词根 check 命中 scripts 下 11/N 个测试文件名，「按名字收窄」
    // 于是选出 12 个——离整棵只差一点，收窄等于没做。判据是词根的**广度**，
    // 不是把 check 这类词手工加进黑名单（那样下一个动词会再踩一次）。
    const files = select(["scripts/check-bundle-budget.mjs"]);
    expect(files).toContain("scripts/check-bundle-budget.test.ts");
    expect(files.some((f) => /typecheck|check-syntax|check-large-files|check-committed-refs/.test(f))).toBe(false);
    expect(files.length).toBeLessThanOrEqual(3);
  });

  it("收窄是量级上的收窄，不是日志上的一句「已收窄」", () => {
    const narrowed = select(["scripts/check-bundle-budget.mjs"]);
    const whole = select(["scripts/check-bundle-budget.mjs"], { NAVHUB_PRECOMMIT_SCOPE: "all" });
    expect(whole.length).toBeGreaterThan(20);
    expect(narrowed.length * 4).toBeLessThan(whole.length);
  });

  it("专属词根没有对应测试时，退回同前缀族，而不是整棵（只准变准，不准变宽）", () => {
    // 若把层级写成「sharp 命中不了 → 整棵」，改一个 qq 无对应测试的 check-qq 脚本
    // 反而比修之前跑得更久。这条钉住「本次改动只会更准」这个不变量。
    const narrowed = select(["scripts/check-qq-no-such-script.mjs"]);
    const whole = select(["scripts/check-qq-no-such-script.mjs"], { NAVHUB_PRECOMMIT_SCOPE: "all" });
    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.length).toBeLessThan(whole.length);
  });

  it("目录名当词根时的噪声：改选测器自己不再整棵跑，但内容相关的测试要收到", () => {
    // scripts 这个词出现在 29/39 个测试文件的内容里（到处都是 scripts/ 路径），
    // 它一混进内容层就「整族都提到」，把真正相关的 install 一起淹掉 → 退回整棵。
    // 内容层用同一条判别力规则后：既收窄了，又保住只有内容层才能找到的耦合
    // （precommit-select 就是用 execFileSync 跑生成物来断言的）。
    const files = select(["scripts/install-git-hooks.mjs"]);
    expect(files).toContain("scripts/precommit-select.test.ts");
    // 2026-10-29 起也是 9：check-hooks-fresh.test.ts 用真实 install-git-hooks.mjs 验
    // 「镜像 prepare 的 import 闭包 ⊆ Dockerfile COPY」，是图上的真依赖，不是噪声。
    expect(files).toContain("scripts/check-hooks-fresh.test.ts");
    expect(files.length).toBeLessThanOrEqual(9);
  });

  it("改 src/jobs.ts：必须带上 backup-restore-job（复数归一回归）", () => {
    // 曾经的 bug：单数形式要求 ≥4 字符，jobs → job 只有 3 字符被拒，
    // 于是「改任务执行器」却不跑「任务执行器最直接的测试」。
    const files = select(["apps/api/src/jobs.ts"]);
    expect(files).toContain("apps/api/test/backup-restore-job.test.ts");
    expect(files).toContain("apps/api/test/jobs.test.ts");
  });

  it("改恢复页面：带上页面守卫与两个全仓门禁", () => {
    const files = select(["apps/web-overlay/src/app/admin/data/restore/page.tsx"]);
    expect(files).toContain("apps/web/test/restore-page-guard.test.ts");
    // 全仓扫描门禁：任何 UI 改动都要跑，否则 a11y 回归会从钩子溜过去
    expect(files).toContain("apps/web/test/field-names.test.ts");
    expect(files).toContain("apps/web/test/keyboard-activation.test.ts");
  });

  it("e2e 用例不进 vitest（只选中「引用它」的 vitest 测试）", () => {
    // e2e 由 Playwright 跑，选测器不把它交给 vitest；但图会选中测试里提到这个 spec 的
    // vitest 用例（precommit-select 自己就内嵌了这个路径）——那是真的依赖，不是误选。
    const files = select(["e2e/admin-restore-async.spec.ts"]);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.endsWith(".test.ts"))).toBe(true);
    expect(files.some((f) => f.startsWith("e2e/"))).toBe(false);
  });

  it("图能解释的改动按图收窄：未引用的文件也不会把整棵拖进来", () => {
    // zzz-unrelated 没有任何测试 import 它；图仍会命中「扫描 apps/api/src 目录」的测试。
    // 旧口径靠名字收窄 → 一个词根都命中不了 → 退回整棵 128 个。
    const files = select(["apps/api/src/routes/zzz-unrelated.ts"]);
    expect(files.length).toBeGreaterThan(0);
    expect(files.length).toBeLessThan(20);
    expect(files).toContain("apps/api/test/backend-lint-gate.test.ts");
    expect(files).not.toContain("apps/api/test/backup-async-api.test.ts");
  });

  it("图与词根都给不出线索时回退整棵（宁可多跑，不可漏跑）", () => {
    // 非源码扩展名不进图（looksLikeSource），词干 xqzv-config 也命中不了任何测试
    const files = select(["apps/api/src/xqzv-config.json"]);
    expect(files.length).toBeGreaterThan(100);
  });

  it("只改文档：一个测试都不跑（SKIP）", () => {
    expect(select(["docs/BACKUP-RUNBOOK.md"])).toEqual([]);
  });
});

describe("选测器把 git 环境与夹具测试隔离", () => {
  // 事故（2026-10-29）：safe-commit 的 GIT_INDEX_FILE 被 vitest 子进程继承，夹具仓库里的
  // `git add` 写进了本次提交的临时索引 → 钩子判「本次提交不含测试文件」，提交被自己拦下。
  // 生成物是 .git/hooks 下的脚本，只能对生成源与产物同时钉：漏掉任何一侧，重装即失守。
  it("生成源里给 vitest 子进程剥掉了 GIT_INDEX_FILE / GIT_DIR / GIT_WORK_TREE", () => {
    const src = readFileSync(join(ROOT, "scripts", "install-git-hooks.mjs"), "utf8");
    for (const name of ["GIT_INDEX_FILE", "GIT_DIR", "GIT_WORK_TREE"]) {
      expect(src, `生成源没有剥 ${name}`).toContain(`delete childEnv.${name};`);
    }
    const payload = readFileSync(PAYLOAD, "utf8");
    for (const name of ["GIT_INDEX_FILE", "GIT_DIR", "GIT_WORK_TREE"]) {
      expect(payload, `生成物没有剥 ${name}（重装没生效？）`).toContain(`delete childEnv.${name};`);
    }
  });

  it("失败归因接线：生成源与产物都把红按「依赖本次提交」归属（failure-scope）", () => {
    // 判据本体在 scripts/lib/failure-scope.mjs（有独立单测）。这里钉接线：
    // 改生成源却忘重装时，生成物里就没有这段，失败会按旧行为一律拦——不是安全问题，
    // 但「本地判定不可信」这条能力会悄悄失效。两处都断言，重装漏了当场红。
    const src = readFileSync(join(ROOT, "scripts", "install-git-hooks.mjs"), "utf8");
    expect(src).toContain("classifyFailures");
    expect(src).toContain("failure-scope.mjs");
    const payload = readFileSync(PAYLOAD, "utf8");
    expect(payload).toContain("classifyFailures");
    expect(payload).toContain("failure-scope.mjs");
    // 未知形状不许静默降级：解析不出失败文件时 fallback 必须落在 blocked
    expect(payload).toContain('blocked: [{ file: "(未能定位失败文件)"');
  });

  it("外层带着 SCOPE=all / NO_GRAPH=1 跑，夹具仍按「图口径」那一档判", () => {
    // 剥除失效的自证：这两枚开关真泄漏进子进程时，选出来的集合会换一档
    // （all → 整棵；NO_GRAPH → 旧词根，比图口径少），下面这条相等就会红。
    const baseline = select(["apps/api/src/routes/backup.ts"]);
    expect(baseline.length, "基线本身要有内容，否则相等是空的").toBeGreaterThan(50);
    const names = ["NAVHUB_PRECOMMIT_SCOPE", "NAVHUB_PRECOMMIT_NO_GRAPH"];
    const prev = names.map((n) => process.env[n]);
    process.env.NAVHUB_PRECOMMIT_SCOPE = "all";
    process.env.NAVHUB_PRECOMMIT_NO_GRAPH = "1";
    try {
      expect(select(["apps/api/src/routes/backup.ts"])).toEqual(baseline);
      // 显式注入仍然有效：剥的是继承，不是夹具自己的对照臂
      const forced = select(["apps/api/src/routes/backup.ts"], { NAVHUB_PRECOMMIT_NO_GRAPH: "1" });
      expect(forced).not.toEqual(baseline);
      expect(forced.length).toBeLessThan(baseline.length);
    } finally {
      names.forEach((n, i) => {
        if (prev[i] === undefined) delete process.env[n];
        else process.env[n] = prev[i];
      });
    }
  });
});
