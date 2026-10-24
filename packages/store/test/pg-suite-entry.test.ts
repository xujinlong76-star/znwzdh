/**
 * 跨方言套件入口的守卫。
 *
 * 这两个 PG 套件在没有连接串时会整体 skip——本地默认正确，但会制造
 * 「我跑过 PG 了」的错觉。2026-10-24 实测：套件当时在 CI 上其实是红的
 * （作用域错误 + 非幂等夹具），本地却一直静默跳过。
 *
 * 入口脚本把「跳过」变成「报错」；这里锁住这条语义与 CI 的接线。
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("PG 套件入口：不允许静默跳过", () => {
  it("未设置 NAVHUB_TEST_DATABASE_URL 时退出码为 1 并说明原因", () => {
    const env = { ...process.env };
    delete env.NAVHUB_TEST_DATABASE_URL;
    const res = spawnSync(process.execPath, ["scripts/run-pg-suite.mjs"], {
      cwd: ROOT,
      env,
      encoding: "utf8",
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("NAVHUB_TEST_DATABASE_URL");
  });

  it("package.json 注册了 test:pg:suite，CI 使用该入口", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["test:pg:suite"]).toContain("run-pg-suite.mjs");
    const ci = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain("pnpm test:pg:suite");
  });
});
