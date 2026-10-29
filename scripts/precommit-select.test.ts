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
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PAYLOAD = join(ROOT, ".git", "hooks", "navhub-precommit-tests.mjs");

beforeAll(() => {
  // 选测器是生成物：先按当前生成源重装，保证测的是最新逻辑
  execFileSync(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd: ROOT, stdio: "ignore" });
  expect(existsSync(PAYLOAD)).toBe(true);
});

/** 返回本次会被交给 vitest 的测试文件（空数组表示 SKIP 或全部被跳过） */
function select(changed: string[], extraEnv: Record<string, string> = {}): string[] {
  const out = execFileSync(process.execPath, [PAYLOAD], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
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

describe("pre-commit 选测：改动 → 测试文件", () => {
  it("改 routes/backup.ts：选中 backup 相关，不带无关的插件测试", () => {
    const files = select(["apps/api/src/routes/backup.ts"]);
    expect(files).toContain("apps/api/test/backup-async-api.test.ts");
    expect(files).toContain("apps/api/test/backup-restore-job.test.ts");
    expect(files.some((f) => f.includes("plugin"))).toBe(false);
    // 收窄的意义：不能是整棵目录
    expect(files.length).toBeLessThan(30);
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
    expect(files.length).toBeLessThanOrEqual(8);
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

  it("e2e 用例不进 vitest（那是 Playwright 的地盘）", () => {
    // 只改 e2e：没有任何 vitest 目标 → SKIP
    expect(select(["e2e/admin-restore-async.spec.ts"])).toEqual([]);
  });

  it("收窄不了时回退整棵（宁可多跑，不可漏跑）", () => {
    // page.tsx 的父目录是 restore，能命中；换一个既无词干也无同名测试的路径：
    const files = select(["apps/api/src/routes/zzz-unrelated.ts"]);
    // 词干 zzz-unrelated 命中不了任何测试 → 回退 apps/api/test 整棵
    expect(files.length).toBeGreaterThan(30);
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
});
