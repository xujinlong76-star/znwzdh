/**
 * pre-commit 选测器自检。
 *
 * 为什么需要它：收窄是「少跑」的策略，**漏选不会报错**——它只会安静地少跑几条测试。
 * 上一轮就踩过两次：① 收窄只影响日志、实际仍跑整棵目录；
 * ② 复数归一阈值写错，`jobs.ts` 收不到 `backup-restore-job.test.ts`。
 * 两次都不报错，只能靠人肉核对「到底跑了哪些文件」才发现。
 *
 * 这里把「哪些改动 → 应该选中哪些文件」固定成断言。选测器是生成物
 * （`.git/hooks/navhub-precommit-tests.mjs`），所以先重装再跑；
 * 用 `NAVHUB_PRECOMMIT_FILES` 注入改动集、`NAVHUB_PRECOMMIT_DRYRUN=1` 只看不跑。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
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
    // 收窄的意义：不能是整棵 93 个文件
    expect(files.length).toBeLessThan(30);
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
