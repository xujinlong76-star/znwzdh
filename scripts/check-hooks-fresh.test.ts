/**
 * 钩子新鲜度门禁（scripts/check-hooks-fresh.mjs + lib/hooks-fresh.mjs）。
 *
 * 这一条管的是「改了 install-git-hooks.mjs 却没重装」：本机跑的仍是旧生成物，
 * 新闸门看起来已经上线、实际一次都没执行。断言必须双向：
 *   - 刚装完 ⇒ 绿；
 *   - 模板改一个字 ⇒ 红，且话说清楚要重装；
 *   - 手改生成物 / 删文件 / 清单缺失 ⇒ 各自红；
 *   - 没有 .git/hooks（不是仓库目录）⇒ 放行，不制造假红。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildManifest, HOOK_FILES, MANIFEST_NAME } from "./lib/hooks-fresh.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(REPO_ROOT, "scripts/check-hooks-fresh.mjs");

let dir: string;

function run(hooksDir: string, source: string) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, "--hooks-dir", hooksDir, "--source", source], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** 造一套「刚装完」的夹具：模板源 + 四个生成物 + 清单 */
function freshFixture(name: string, sourceBody = "// template v1\n") {
  const root = join(dir, name);
  const hooksDir = join(root, ".git", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const source = join(root, "install-git-hooks.mjs");
  writeFileSync(source, sourceBody, "utf8");
  for (const file of HOOK_FILES) writeFileSync(join(hooksDir, file), `#!/bin/sh\n# ${file} v1\n`, "utf8");
  writeFileSync(
    join(hooksDir, MANIFEST_NAME),
    JSON.stringify(buildManifest({ hooksDir, sourcePath: source }), null, 2),
    "utf8",
  );
  return { root, hooksDir, source };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "navhub-hooks-fresh-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("钩子新鲜度：模板 ↔ 生成物", () => {
  it("刚装完（清单与四个生成物一致）⇒ rc 0", () => {
    const { hooksDir, source } = freshFixture("ok");
    const res = run(hooksDir, source);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("钩子与模板同源");
  });

  it("模板改了没重装 ⇒ rc 1，并明确要求重装", () => {
    const { hooksDir, source } = freshFixture("stale");
    writeFileSync(source, "// template v2（多了一枚新闸门）\n", "utf8");
    const res = run(hooksDir, source);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("模板源");
    expect(res.out).toContain("node scripts/install-git-hooks.mjs");
  });

  it("生成物被手改 ⇒ rc 1，点名是哪个文件（手改无效）", () => {
    const { hooksDir, source } = freshFixture("edited");
    writeFileSync(join(hooksDir, "pre-commit"), "#!/bin/sh\n# 手改过的钩子\nexit 0\n", "utf8");
    const res = run(hooksDir, source);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("pre-commit");
    expect(res.out).toContain("手改无效");
  });

  it("生成物缺失 ⇒ rc 1，点名缺的是哪个", () => {
    const { hooksDir, source } = freshFixture("missing-file");
    unlinkSync(join(hooksDir, "pre-push"));
    const res = run(hooksDir, source);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("钩子文件缺失：pre-push");
  });

  it("安装清单缺失 ⇒ rc 1（不是当前安装脚本的产物，无法判断同源）", () => {
    const { hooksDir, source } = freshFixture("no-manifest");
    unlinkSync(join(hooksDir, MANIFEST_NAME));
    const res = run(hooksDir, source);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("安装清单");
  });

  it("没有 .git/hooks（不是仓库目录）⇒ 放行，不制造假红", () => {
    const res = run(join(dir, "does-not-exist", ".git", "hooks"), join(dir, "does-not-exist", "x.mjs"));
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("跳过");
  });
});
