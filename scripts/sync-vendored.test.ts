/**
 * `scripts/sync-vendored.mjs` 的夹具测试。
 *
 * 三处同构副本（体检状态机 / 短链校验 / 未分类常量）形态不同，门禁必须按模式
 * 分别校验，且两个方向都要有断言：
 *   · 副本被手改 → 红；--write 之后 → 绿（可自愈）
 *   · 常量漂移 → 红（哪怕只差一个字符）
 *   · behavior 模式只校验符号存在 + parity 用例存在（不假装能做静态求值）
 *   · 自述「同构复制」却没登记的文件 → 红（防止第四份副本悄悄出现）
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/sync-vendored.mjs");
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(entries: unknown[], files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "navhub-vendored-"));
  dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "vendored.manifest.json"), JSON.stringify({ entries }, null, 2), "utf8");
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content, "utf8");
  }
  return dir;
}

function run(dir: string, args: string[] = []) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NAVHUB_VENDORED_ROOT: dir },
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

const SRC = "/** 源说明 */\nexport const v = 1;\n";

describe("同构副本一致性门禁", () => {
  it("verbatim：正文一致时通过（副本可多一段自己的说明头）", () => {
    const dir = fixture(
      [{ id: "a", mode: "verbatim", source: "packages/core/src/a.ts", copy: "apps/web-overlay/src/lib/a.ts" }],
      {
        "packages/core/src/a.ts": SRC,
        "apps/web-overlay/src/lib/a.ts": "/** 副本说明 */\n" + SRC,
      },
    );
    const res = run(dir);
    expect(res.status, res.out).toBe(0);
  });

  it("verbatim：副本被手改 → 红；--write 后 → 绿（自愈）", () => {
    const dir = fixture(
      [{ id: "a", mode: "verbatim", source: "packages/core/src/a.ts", copy: "apps/web-overlay/src/lib/a.ts" }],
      {
        "packages/core/src/a.ts": SRC,
        "apps/web-overlay/src/lib/a.ts": "/** 副本说明 */\nexport const v = 2;\n",
      },
    );
    expect(run(dir).status).toBe(1);
    expect(run(dir, ["--write"]).status).toBe(0);
    expect(readFileSync(join(dir, "apps/web-overlay/src/lib/a.ts"), "utf8")).toContain("export const v = 1;");
    expect(run(dir).status).toBe(0);
  });

  it("constant：值不一致 → 红（只差一个字符也算）", () => {
    const dir = fixture(
      [
        {
          id: "c",
          mode: "constant",
          source: "packages/core/src/c.ts",
          copy: "apps/web-overlay/src/lib/c.ts",
          symbol: "SOME_ID",
        },
      ],
      {
        "packages/core/src/c.ts": 'export const SOME_ID = "cat-1";\n',
        "apps/web-overlay/src/lib/c.ts": 'export const SOME_ID = "cat-2";\n',
      },
    );
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.out).toContain("SOME_ID 不一致");
  });

  it("behavior：副本缺同名符号 → 红", () => {
    const dir = fixture(
      [
        {
          id: "b",
          mode: "behavior",
          source: "packages/core/src/b.ts",
          copy: "apps/web-overlay/src/lib/b.ts",
          symbol: "isSafe",
        },
      ],
      {
        "packages/core/src/b.ts": "export function isSafe() { return true; }\n",
        "apps/web-overlay/src/lib/b.ts": "export const other = 1;\n",
      },
    );
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.out).toContain("副本里没有 isSafe");
  });

  it("清单登记的 parity 用例不存在 → 红", () => {
    const dir = fixture(
      [
        {
          id: "a",
          mode: "verbatim",
          source: "packages/core/src/a.ts",
          copy: "apps/web-overlay/src/lib/a.ts",
          parityTest: "apps/web-overlay/test/a.test.ts",
        },
      ],
      { "packages/core/src/a.ts": SRC, "apps/web-overlay/src/lib/a.ts": SRC },
    );
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.out).toContain("parity 用例不存在");
  });

  it("自述「同构复制」却未登记的文件 → 红（第四份副本无处藏身）", () => {
    const dir = fixture([], {
      "apps/web-overlay/src/lib/rogue.ts": "/** 同构复制：与 core 保持一致 */\nexport const x = 1;\n",
    });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.out).toContain("未登记的同构副本");
  });
});
