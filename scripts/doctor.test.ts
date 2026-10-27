/**
 * `scripts/doctor.mjs` 的纯函数测试。
 *
 * 只测两件确定性的事：版本比较与端口探测。整脚本会读机器状态（Node 版本、
 * 端口占用、git worktree），把它当断言对象会让测试随环境飘。
 */
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error 纯 JS 脚本，无类型声明
import { compareVersions, probePort } from "./doctor.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("compareVersions", () => {
  it("按 major.minor.patch 比较，忽略前导 v", () => {
    expect(compareVersions("24.0.0", "22.22.2")).toBe(1);
    expect(compareVersions("v22.22.2", "22.22.2")).toBe(0);
    expect(compareVersions("22.9.0", "22.10.0")).toBe(-1);
    expect(compareVersions("24", "24.0.0")).toBe(0);
  });
});

describe("probePort", () => {
  it("端口被占用时返回 false，释放后返回 true", async () => {
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    expect(port).toBeGreaterThan(0);
    expect(await probePort(port)).toBe(false);
    await new Promise<void>((done) => server.close(() => done()));
    expect(await probePort(port)).toBe(true);
  });
});

describe("CLI", () => {
  it("--json 输出结构固定，含 results 数组", () => {
    const res = spawnSync(process.execPath, ["scripts/doctor.mjs", "--json"], { cwd: ROOT, encoding: "utf8" });
    const parsed = JSON.parse(res.stdout) as { ok: boolean; results: Array<{ level: string; name: string }> };
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results.length).toBeGreaterThan(3);
    for (const r of parsed.results) expect(["OK", "WARN", "FAIL"]).toContain(r.level);
  });
});
