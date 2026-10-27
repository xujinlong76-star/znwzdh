/**
 * `scripts/check-import-boundaries.mjs` 的夹具测试。
 *
 * 四条规则各自都要有「正例 + 反例」，否则规则表会慢慢退化成装饰：
 *   1. overlay/src 禁止 @navhub/*（生产镜像只含 overlay）
 *   2. packages 禁止反向依赖 apps
 *   3. apps/api 禁止依赖前端源码
 *   4. scripts 禁止直接抓 overlay/src 内部模块（例外需登记）
 * 另外验证「测试目录放行」与「注释里的 import 不算」。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/check-import-boundaries.mjs");
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function makeRepo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "navhub-boundaries-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content, "utf8");
  }
  execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=t", "add", "-A"], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: dir });
  return dir;
}

function run(cwd: string) {
  const res = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

describe("依赖边界门禁", () => {
  it("overlay/src 引用 @navhub/core：必须红（生产镜像里没有 packages）", () => {
    const dir = makeRepo({
      "apps/web-overlay/src/lib/a.ts": 'export { x } from "@navhub/core";\n',
      "packages/core/src/index.ts": "export const x = 1;\n",
    });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.out).toContain("vendored-no-workspace-pkg");
  });

  it("同样的引用放在 overlay/test 下：放行（测试不在镜像里跑）", () => {
    const dir = makeRepo({
      "apps/web-overlay/test/a.test.ts": 'import { x } from "@navhub/core";\nexport const y = x;\n',
      "packages/core/src/index.ts": "export const x = 1;\n",
    });
    const res = run(dir);
    expect(res.status, res.out).toBe(0);
  });

  it("packages 反向依赖 apps：必须红", () => {
    const dir = makeRepo({
      "packages/core/src/a.ts": 'import { y } from "../../../apps/api/src/y";\nexport const z = y;\n',
      "apps/api/src/y.ts": "export const y = 1;\n",
    });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.out).toContain("no-reverse-dependency");
  });

  it("apps/api 依赖前端源码：必须红", () => {
    const dir = makeRepo({
      "apps/api/src/a.ts": 'import { t } from "../../web-overlay/src/lib/t";\nexport const u = t;\n',
      "apps/web-overlay/src/lib/t.ts": "export const t = 1;\n",
    });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.out).toContain("api-no-frontend");
  });

  it("scripts 直接抓 overlay 内部模块：必须红", () => {
    const dir = makeRepo({
      "scripts/bench.mts": 'import { k } from "../apps/web-overlay/src/lib/k";\nexport const m = k;\n',
      "apps/web-overlay/src/lib/k.ts": "export const k = 1;\n",
    });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.out).toContain("scripts-no-app-src");
  });

  it("注释里的 import 不算越界（避免示例代码制造假红）", () => {
    const dir = makeRepo({
      "apps/web-overlay/src/lib/a.ts": '// import { x } from "@navhub/core"\nexport const ok = 1;\n',
      "packages/core/src/index.ts": "export const x = 1;\n",
    });
    const res = run(dir);
    expect(res.status, res.out).toBe(0);
  });
});
