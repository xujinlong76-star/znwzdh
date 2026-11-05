/**
 * 后端 lint 的阻塞通道（2026-10-25 run47；2026-11-01 与工作流对齐为「两处都硬」）。
 *
 * 口径冲突的实证：`scripts/verify.mjs:48` 把「后端 lint」当阻断步骤（注释写着
 * 「已是硬门禁」），`apps/api/eslint.config.mjs` 文件头也声明三条规则已升为 error、
 * 「再出现任何一条都直接让 CI 变红」；而 `.github/workflows/ci.yml` 的这一步当时带
 * `continue-on-error: true`，注释还停在「首轮只开三条 warning」—— 前提早就过期，
 * 后果是 1f34cc1 引入的 2 个 error 在 CI 里全绿、在本地必红，两边互相甩锅。
 *
 * 当天的修法是先在自己管得着的地上补一份断言：把同一条判定放进**阻塞的作业**里
 * （CI 的 test-sqlite 跑根 vitest，ci-passed 用 needs 聚合它，配对由
 * `scripts/check-ci-gate.mjs` 第 5 项守住）。此后后端 lint 一红，CI 一定红。
 *
 * 2026-11-01 工作流那一步的 `continue-on-error` 已撤掉 ⇒ 现在两步都会判红也会挡路。
 * 这份测试没有因此失去价值，它补的是另一半：**逐条 message 明细**。CI 那一步只给
 * `pnpm run lint:backend` 的退出码，而 pnpm 递归把两个包的输出混在一处；这里断言的是
 * message 数组，红了能直接看到是哪条规则、哪个文件哪一列。两处松绑任一处都会红，
 * 所以第 5 项那条配对判据继续留着（方向已从「逼第二通道」变成「别让两处口径分叉」）。
 *
 * 用编程式 ESLint 而不是 shell 出 `pnpm lint:backend`：跑的是同一份 eslint.config.mjs
 * 与同一组包，省掉一次 pnpm 递归（实测两个包合计约 7 秒），且断言的是 message 明细。
 */
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** 与根 `pnpm lint:backend` 的 --filter 列表逐字一致，少一个包就等于口径又分叉了 */
const TARGETS = [
  { name: "@navhub/api", cwd: resolve(REPO_ROOT, "apps/api") },
  { name: "@navhub/store", cwd: resolve(REPO_ROOT, "packages/store") },
];

describe("后端 lint 在阻塞作业里同样把关", () => {
  it("覆盖的包集合与 lint:backend 的 --filter 一致", async () => {
    const { readFile } = await import("node:fs/promises");
    const pkg = JSON.parse(await readFile(resolve(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const command = pkg.scripts["lint:backend"] ?? "";
    for (const target of TARGETS) {
      expect(command, `lint:backend 里没有 ${target.name}，本测试却在跑它`).toContain(target.name);
    }
  });

  for (const target of TARGETS) {
    it(`${target.name} 零 error 零 warning（等价 eslint . --max-warnings 0）`, async () => {
      const eslint = new ESLint({ cwd: target.cwd });
      const results = await eslint.lintFiles(["."]);
      const problems = results.flatMap((r) =>
        r.messages.map(
          (m) =>
            `${relative(REPO_ROOT, r.filePath)}:${m.line}:${m.column} ${m.ruleId ?? "fatal"} ${m.message}`,
        ),
      );
      expect(
        problems,
        `后端 lint 报出的问题（CI 的 lint:backend 步骤与本测试都会判红；这里给逐条明细）：\n${problems.join("\n")}`,
      ).toEqual([]);
    }, 120_000);
  }
});
