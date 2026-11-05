/**
 * 跨方言套件入口的守卫。
 *
 * 这些 PG 套件在没有连接串时会整体 skip——本地默认正确，但会制造
 * 「我跑过 PG 了」的错觉。2026-10-24 实测：套件当时在 CI 上其实是红的
 * （作用域错误 + 非幂等夹具），本地却一直静默跳过。
 *
 * 入口脚本把「跳过」变成「报错」；这里锁住这条语义与 CI 的接线，
 * 并扫目录确认**每个 e2e 文件都登记在入口清单里**——漏登记比漏跑更糟：
 * 那种文件在 CI 上连「skipped」的信号都不会留下（新增 PG 套件时的第一反应
 * 往往是「本地会跳过所以先不管」，于是验收标准静静变成一条没跑过的断言）。
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const STORE_TEST_DIR = resolve(ROOT, "packages/store/test");

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

  it("每个 e2e 套件都登记在入口清单里，且清单里没有已删除的文件", () => {
    const entry = readFileSync(resolve(ROOT, "scripts/run-pg-suite.mjs"), "utf8");
    const onDisk = readdirSync(STORE_TEST_DIR)
      .filter((f) => f.endsWith(".e2e.test.ts"))
      .sort();
    // 入口用字面量列出文件路径；注释里提到某个套件不构成登记
    const listed = [...entry.matchAll(/"([^"]*\.e2e\.test\.ts)"/g)].map((m) => m[1]!.split("/").pop()!).sort();
    expect(onDisk.length).toBeGreaterThan(0);
    expect(listed).toEqual(onDisk);
  });
});
