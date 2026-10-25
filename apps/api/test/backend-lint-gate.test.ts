/**
 * 后端 lint 的阻塞通道（2026-10-25 run47）。
 *
 * 口径冲突的实证：`scripts/verify.mjs:48` 把「后端 lint」当阻断步骤（注释写着
 * 「已是硬门禁」），`apps/api/eslint.config.mjs` 文件头也声明三条规则已升为 error、
 * 「再出现任何一条都直接让 CI 变红」；而 `.github/workflows/ci.yml` 的这一步带
 * `continue-on-error: true`，注释还停在「首轮只开三条 warning」—— 前提早就过期，
 * 后果是 1f34cc1 引入的 2 个 error 在 CI 里全绿、在本地必红，两边互相甩锅。
 *
 * 工作流文件是本轮禁区（不改它来改变门禁结论），所以把同一条断言放进**阻塞的作业**里：
 * CI 的 test-sqlite 作业跑根 vitest，而 ci-passed 用 needs 聚合它（该项由
 * `scripts/check-ci-gate.mjs` 校验）。此后后端 lint 一红，CI 一定红，
 * `continue-on-error` 只是把同一个结论多报一次，不再是唯一出口。
 *
 * 用编程式 ESLint 而不是 shell 出 `pnpm lint:backend`：跑的是同一份 eslint.config.mjs
 * 与同一组包，省掉一次 pnpm 递归（实测两个包合计约 7 秒），且断言的是 message 明细，
 * 红了能直接看到是哪一条规则。
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
      expect(problems, `后端 lint 报出的问题（CI 的 lint 步骤带 continue-on-error，这里是唯一会红的地方）：\n${problems.join("\n")}`).toEqual([]);
    }, 120_000);
  }
});
