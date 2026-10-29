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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildManifest,
  copiedSources,
  HOOK_FILES,
  importClosure,
  MANIFEST_NAME,
  PREPARE_DOCKERFILES,
  PREPARE_ENTRY,
  prepareClosureProblems,
  relativeImports,
} from "./lib/hooks-fresh.mjs";

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

  it("真实仓库：镜像 prepare 闭包已被两个 Dockerfile 覆盖", () => {
    const res = run(join(REPO_ROOT, ".git", "hooks"), join(REPO_ROOT, "scripts/install-git-hooks.mjs"));
    // 本机钩子可能确实过期（退出码交给上面的用例判），这里只钉闭包那句话
    expect(res.out).toContain("镜像 prepare 闭包已覆盖");
    expect(res.out).toContain("Dockerfile.api");
    expect(res.out).toContain("Dockerfile.web");
  });
});

/**
 * 镜像 prepare 的 import 闭包（2026-10-29 docker-smoke 真红）：
 * 9460971c 给 install-git-hooks.mjs 加了 `./lib/hooks-fresh.mjs` 的运行时 import，
 * 两个 Dockerfile 仍只拷单文件，`pnpm install` 的 prepare 直接
 * `ERR_MODULE_NOT_FOUND: /app/scripts/lib/hooks-fresh.mjs` —— 本机全绿，镜像起不来。
 */
describe("镜像 prepare 的 import 闭包", () => {
  const files: Record<string, string> = {
    "scripts/install-git-hooks.mjs": 'import { a } from "./lib/x.mjs";\nimport "./lib/y.mjs";\n',
    "scripts/lib/x.mjs": 'import { c } from "./z.mjs";\nexport const a = 1;\n',
    "scripts/lib/y.mjs": "export const b = 2;\n",
    "scripts/lib/z.mjs": "export const c = 3;\n",
  };
  const readFile = (path: string) => {
    if (!(path in files)) throw new Error(`ENOENT ${path}`);
    return files[path];
  };
  const exists = (path: string) => path in files;
  const closure = () =>
    prepareClosureProblems({ dockerfilePath: "docker/Dockerfile.api", entry: "scripts/install-git-hooks.mjs", readFile, exists });

  it("相对 import 抽取：静态 / 副作用 / 动态 import() 都认，裸模块名不算", () => {
    expect(relativeImports('import { a } from "./a.mjs";')).toEqual(["./a.mjs"]);
    expect(relativeImports('import "./b.mjs";')).toEqual(["./b.mjs"]);
    expect(relativeImports('const m = await import("./c.mjs");')).toEqual(["./c.mjs"]);
    expect(relativeImports('export * from "../d.mjs";')).toEqual(["../d.mjs"]);
    expect(relativeImports('import fs from "node:fs";\nimport x from "@navhub/core";')).toEqual([]);
  });

  it("闭包是传递的，且路径统一成正斜杠", () => {
    const res = importClosure({ entry: "scripts/install-git-hooks.mjs", readFile, exists });
    expect(res.files).toEqual([
      "scripts/install-git-hooks.mjs",
      "scripts/lib/x.mjs",
      "scripts/lib/y.mjs",
      "scripts/lib/z.mjs",
    ]);
    expect(res.missing).toEqual([]);
  });

  it("COPY 源解析：多源、flag、整目录都能认", () => {
    const text = [
      "COPY package.json pnpm-lock.yaml ./",
      "COPY --chown=node:node scripts/install-git-hooks.mjs ./scripts/",
      "COPY --from=deps /app /app",
      "COPY scripts/lib/hooks-fresh.mjs ./scripts/lib/",
    ].join("\n");
    expect(copiedSources(text)).toEqual(["package.json", "pnpm-lock.yaml", "scripts/install-git-hooks.mjs", "/app", "scripts/lib/hooks-fresh.mjs"]);
  });

  it("逐个 COPY 到位 ⇒ 无问题；`COPY scripts ./scripts` 整目录也算覆盖", () => {
    const covered = [
      "COPY scripts/install-git-hooks.mjs ./scripts/",
      "COPY scripts/lib/x.mjs scripts/lib/y.mjs ./scripts/lib/",
      "COPY scripts/lib/z.mjs ./scripts/lib/",
    ].join("\n");
    const ok = prepareClosureProblems({
      dockerfilePath: "docker/Dockerfile.api",
      entry: "scripts/install-git-hooks.mjs",
      readFile: (p) => (p === "docker/Dockerfile.api" ? covered : readFile(p)),
      exists,
    });
    expect(ok.problems).toEqual([]);
    expect(ok.skipped).toBe(false);

    const dirCopy = prepareClosureProblems({
      dockerfilePath: "docker/Dockerfile.api",
      entry: "scripts/install-git-hooks.mjs",
      readFile: (p) => (p === "docker/Dockerfile.api" ? "COPY scripts ./scripts" : readFile(p)),
      exists,
    });
    expect(dirCopy.problems).toEqual([]);
  });

  it("漏拷闭包里的模块 ⇒ 点名是哪个文件、该怎么补", () => {
    const text = "COPY scripts/install-git-hooks.mjs ./scripts/";
    const res = prepareClosureProblems({
      dockerfilePath: "docker/Dockerfile.api",
      entry: "scripts/install-git-hooks.mjs",
      readFile: (p) => (p === "docker/Dockerfile.api" ? text : readFile(p)),
      exists,
    });
    expect(res.problems.length).toBe(3);
    expect(res.problems[0]).toContain("scripts/lib/x.mjs");
    expect(res.problems[0]).toContain("ERR_MODULE_NOT_FOUND");
    expect(res.problems[0]).toContain("COPY scripts/lib/x.mjs");
  });

  it("import 指向不存在的文件 ⇒ 独立报「解析不到」", () => {
    const res = prepareClosureProblems({
      dockerfilePath: "docker/Dockerfile.api",
      entry: "scripts/install-git-hooks.mjs",
      readFile: (p) =>
        p === "docker/Dockerfile.api"
          ? "COPY scripts ./scripts"
          : p === "scripts/install-git-hooks.mjs"
            ? 'import "./lib/ghost.mjs";\n'
            : "",
      exists: (p) => p !== "scripts/lib/ghost.mjs",
    });
    expect(res.problems).toEqual([
      "scripts/install-git-hooks.mjs 的相对 import 解析不到：scripts/lib/ghost.mjs",
    ]);
  });

  it("Dockerfile 不存在 ⇒ skipped（不是每个仓库都有镜像）", () => {
    const res = closure();
    expect(res.skipped).toBe(true);
    expect(res.problems).toEqual([]);
  });

  it("真实仓库：两个 Dockerfile 都过；把 api 的 lib COPY 删掉就红（证明这枚钉子有效）", () => {
    const realRead = (path: string) => readFileSync(resolve(REPO_ROOT, path), "utf8");
    const realExists = (path: string) => {
      try {
        readFileSync(resolve(REPO_ROOT, path));
        return true;
      } catch {
        return false;
      }
    };
    for (const dockerfilePath of PREPARE_DOCKERFILES) {
      const res = prepareClosureProblems({ dockerfilePath, entry: PREPARE_ENTRY, readFile: realRead, exists: realExists });
      expect(res.skipped, `${dockerfilePath} 不存在`).toBe(false);
      expect(res.problems, dockerfilePath).toEqual([]);
      expect(res.files).toContain("scripts/lib/hooks-fresh.mjs");
    }
    const mutated = prepareClosureProblems({
      dockerfilePath: PREPARE_DOCKERFILES[0],
      entry: PREPARE_ENTRY,
      readFile: (p) =>
        p === PREPARE_DOCKERFILES[0] ? realRead(p).replace(/COPY scripts\/lib\/hooks-fresh\.mjs.*/g, "") : realRead(p),
      exists: realExists,
    });
    expect(mutated.problems.join("\n")).toContain("scripts/lib/hooks-fresh.mjs");
  });
});
