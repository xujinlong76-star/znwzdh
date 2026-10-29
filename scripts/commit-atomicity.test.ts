/**
 * `scripts/check-commit-atomicity.mjs` 的夹具测试。
 *
 * 这个门禁来自一次真实事故（89a20b42）：测试先提交、源码还在暂存区，本地全绿、
 * CI 26 例红。测试必须同时覆盖「该报」与「不该报」两侧，否则门禁会退化成噪音源：
 *   · 提交的测试 → 脏源码（改过未提交）        ⇒ 必须红
 *   · 提交的测试 → 未入库新文件                ⇒ 必须红
 *   · 依赖随本次提交一起进                     ⇒ 必须绿
 *   · 非测试文件的提交                         ⇒ 必须绿（并行开发允许源码脏）
 *   · 被 gitignore 覆盖的生成物（apps/web/src） ⇒ 必须绿
 *   · 注释里的路径字面量                       ⇒ 必须绿
 *   · 镜像测试（apps/web/test）的 `@/x` 归一到 overlay 事实源 ⇒ 必须红
 *
 * 源码 → 源码的伴随改动（2026-10-29 第二起，7de79c31）另有一组：
 *   · 提交的路由 → `@navhub/store` barrel → 第二跳定义文件改签名未提交 ⇒ 必须红
 *   · 改的是没被用到的导出 / 只删注释 / 只新增导出 ⇒ 必须绿（符号级判据）
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  aliasRootsFor,
  changedExportNames,
  extractPathLiterals,
  isReadArgument,
  mentionsSymbol,
  reexportClosure,
} from "./lib/commit-atomicity.mjs";
import { resolveSpecifier, WORKSPACE_ALIAS_ROOTS } from "./lib/source-refs.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/check-commit-atomicity.mjs");
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/**
 * 夹具的 git 必须拿干净的 git 环境。
 *
 * 事故（2026-10-29，就在本门禁自己的首轮提交里）：pre-commit 由 safe-commit 驱动时
 * 带着 GIT_INDEX_FILE（独立索引）跑测试；夹具照原样继承了它，于是 fixture 仓库里的
 * `git add` 写进了**本次提交的临时索引**，钩子随后以为「本次提交不含测试文件」。
 * 任何 spawn git 的夹具测试都有这个雷，所以入口只留这一处、统一剥掉。
 */
function gitEnv(extra: Record<string, string> = {}) {
  const env = { ...process.env };
  delete env.GIT_INDEX_FILE;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  // 门禁自己的豁免开关同样不能泄漏进夹具：本机为了提交别的东西设了它，
  // 「必须红」的用例就会静默变绿（2026-10-29 实际踩到，4 例同时假绿）。
  delete env.NAVHUB_ALLOW_DIRTY_TEST_DEPS;
  delete env.NAVHUB_ALLOW_DIRTY_SOURCE_DEPS;
  return { ...env, ...extra };
}

function git(cwd: string, args: string[]) {
  return execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "init.defaultBranch=main", ...args], {
    cwd,
    encoding: "utf8",
    env: gitEnv(),
  });
}

function makeRepo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "navhub-atomicity-"));
  dirs.push(dir);
  git(dir, ["init", "-q"]);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content, "utf8");
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "init"]);
  return dir;
}

function write(cwd: string, name: string, content: string) {
  mkdirSync(dirname(join(cwd, name)), { recursive: true });
  writeFileSync(join(cwd, name), content, "utf8");
}

function run(cwd: string, env: Record<string, string> = {}) {
  const res = spawnSync(process.execPath, [SCRIPT, "--staged"], {
    cwd,
    encoding: "utf8",
    env: gitEnv(env),
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

describe("提交原子性门禁", () => {
  it("事故形状：测试提交了、它读的源码只是工作区改动 → 必须红", () => {
    const dir = makeRepo({
      "apps/web-overlay/src/app/admin/x.ts": "export const a = 1\n",
    });
    // 源码改过但没 add（并行会话的半成品）
    write(dir, "apps/web-overlay/src/app/admin/x.ts", "export const a = 2\n");
    write(
      dir,
      "apps/web-overlay/test/x-guard.test.ts",
      'import { readFileSync } from "node:fs"\nconst src = readFileSync("src/app/admin/x.ts", "utf8")\n',
    );
    git(dir, ["add", "apps/web-overlay/test/x-guard.test.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("apps/web-overlay/test/x-guard.test.ts");
    expect(res.out).toContain("apps/web-overlay/src/app/admin/x.ts");
    expect(res.out).toContain("NAVHUB_ALLOW_DIRTY_TEST_DEPS");
  });

  it("源码一起进本次提交 → 必须绿（证明拦的是「不在提交集」而不是「改过」）", () => {
    const dir = makeRepo({
      "apps/web-overlay/src/app/admin/x.ts": "export const a = 1\n",
    });
    write(dir, "apps/web-overlay/src/app/admin/x.ts", "export const a = 2\n");
    write(
      dir,
      "apps/web-overlay/test/x-guard.test.ts",
      'import { readFileSync } from "node:fs"\nreadFileSync("src/app/admin/x.ts", "utf8")\n',
    );
    git(dir, ["add", "apps/web-overlay/test/x-guard.test.ts", "apps/web-overlay/src/app/admin/x.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("提交原子性");
  });

  it("模块说明符形态：@/ 别名指向的源码脏了、未随提交 → 必须红", () => {
    const dir = makeRepo({
      "apps/web-overlay/src/lib/fmt.ts": "export const fmt = (x: number) => String(x)\n",
    });
    write(dir, "apps/web-overlay/src/lib/fmt.ts", "export const fmt = (x: number) => `#${x}`\n");
    write(
      dir,
      "apps/web-overlay/test/fmt.test.ts",
      'import { fmt } from "@/lib/fmt"\nimport { expect, it } from "vitest"\nit("x", () => expect(fmt(1)).toBe("#1"))\n',
    );
    git(dir, ["add", "apps/web-overlay/test/fmt.test.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("apps/web-overlay/src/lib/fmt.ts");
  });

  it("从未入库的新源码（untracked）→ 必须红", () => {
    const dir = makeRepo({ "README.md": "# fixture\n" });
    write(dir, "apps/web-overlay/src/lib/brand-new.ts", "export const n = 1\n");
    write(
      dir,
      "apps/web-overlay/test/brand-new.test.ts",
      'import { n } from "@/lib/brand-new"\nvoid n\n',
    );
    git(dir, ["add", "apps/web-overlay/test/brand-new.test.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("apps/web-overlay/src/lib/brand-new.ts");
  });

  it("依赖与 HEAD 一致（源码没脏）→ 必须绿", () => {
    const dir = makeRepo({
      "apps/web-overlay/src/lib/stable.ts": "export const s = 1\n",
    });
    write(
      dir,
      "apps/web-overlay/test/stable.test.ts",
      'import { s } from "@/lib/stable"\nvoid s\n',
    );
    git(dir, ["add", "apps/web-overlay/test/stable.test.ts"]);

    expect(run(dir).status).toBe(0);
  });

  it("提交里没有测试文件 → 必须绿（并行开发允许源码脏）", () => {
    const dir = makeRepo({ "apps/web-overlay/src/lib/fmt.ts": "export const fmt = 1\n" });
    write(dir, "apps/web-overlay/src/lib/fmt.ts", "export const fmt = 2\n");
    write(dir, "apps/web-overlay/src/lib/other.ts", "export const other = 1\n");
    git(dir, ["add", "apps/web-overlay/src/lib/other.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("不含测试文件");
  });

  it("被 gitignore 覆盖的生成物不算「未提交」（apps/web/src 是构建产物）", () => {
    // 只存在于生成树、没有 overlay 对应物：判据必须落在「被忽略 = 不算未提交」
    const dir = makeRepo({ ".gitignore": "apps/web/src/\n" });
    write(dir, "apps/web/src/lib/generated-only.ts", "export const g = 100\n");
    write(
      dir,
      "apps/web/test/generated-only.test.ts",
      'import { g } from "@/lib/generated-only"\nvoid g\n',
    );
    git(dir, ["add", "apps/web/test/generated-only.test.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(0);
  });

  it("镜像测试的 @/x 归一到 overlay 事实源：overlay 脏了 → 必须红", () => {
    const dir = makeRepo({
      ".gitignore": "apps/web/src/\n",
      "apps/web-overlay/src/lib/x.ts": "export const x = 1\n",
    });
    write(dir, "apps/web/src/lib/x.ts", "export const x = 2\n");
    write(dir, "apps/web-overlay/src/lib/x.ts", "export const x = 2\n");
    write(dir, "apps/web/test/x.test.ts", 'import { x } from "@/lib/x"\nvoid x\n');
    git(dir, ["add", "apps/web/test/x.test.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("apps/web-overlay/src/lib/x.ts");
  });

  it("注释里的路径字面量不算依赖", () => {
    const dir = makeRepo({ "apps/web-overlay/src/lib/x.ts": "export const x = 1\n" });
    write(dir, "apps/web-overlay/src/lib/x.ts", "export const x = 2\n");
    write(
      dir,
      "apps/web-overlay/test/comment-only.test.ts",
      '// readFileSync("src/lib/x.ts")\n/* import { x } from "@/lib/x" */\nexport const ok = 1\n',
    );
    git(dir, ["add", "apps/web-overlay/test/comment-only.test.ts"]);

    expect(run(dir).status).toBe(0);
  });

  it("钩子接线：install-git-hooks.mjs 生成在 check-committed-refs 之后（源码级钉子）", () => {
    const installer = readFileSync(join(ROOT, "scripts/install-git-hooks.mjs"), "utf8");
    const refs = installer.indexOf("node scripts/check-committed-refs.mjs --staged || exit 1");
    const atomic = installer.indexOf("node scripts/check-commit-atomicity.mjs --staged || exit 1");
    expect(refs, "安装器里找不到 check-committed-refs").toBeGreaterThan(-1);
    expect(atomic, "安装器里找不到提交原子性门禁").toBeGreaterThan(refs);
  });

  it("NAVHUB_ALLOW_DIRTY_TEST_DEPS=1 时放行并逐条列出（逃生口要看得见）", () => {
    const dir = makeRepo({ "apps/web-overlay/src/lib/x.ts": "export const x = 1\n" });
    write(dir, "apps/web-overlay/src/lib/x.ts", "export const x = 2\n");
    write(dir, "apps/web-overlay/test/x.test.ts", 'import { x } from "@/lib/x"\nvoid x\n');
    git(dir, ["add", "apps/web-overlay/test/x.test.ts"]);

    const res = run(dir, { NAVHUB_ALLOW_DIRTY_TEST_DEPS: "1" });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("NAVHUB_ALLOW_DIRTY_TEST_DEPS");
    expect(res.out).toContain("apps/web-overlay/src/lib/x.ts");
  });
});

/**
 * 测试 → **非代码文件**的原子性（2026-10-29 补的盲区）。
 *
 * 门禁测试大量直接读接线/样式/镜像文件（`.github/workflows/ci.yml`、`src/styles/*.css`、
 * `docker/Dockerfile.api`）。只认代码后缀时，「提交测试、把 ci.yml 留在工作区」这条
 * 与事故同形的不原子完全看不见——本地绿、CI 检出提交树红。
 *
 * 反向的一半同样必须钉住：非代码路径名会被当成**例子**写进夹具，所以对非代码要求
 * 「被当作输入读取」（isReadArgument）。没有这半边，热区文件会让每个举了例的测试都变敏感，
 * 噪音门禁的终点是被人 `--no-verify` 绕过。
 */
describe("提交原子性：测试 → 非代码文件", () => {
  // 读取形态的夹具刻意用探针名（probe-*）：本文件真被提交时，这些字面量会在**真实仓库**里
  // 解析，撞 `.github/workflows/ci.yml` 这种热区文件就等于让本测试对别人的脏改动敏感。
  // 反向用例（下面那条「举例不敏感」）反过来必须用真实名——它要证的正是「撞了也不敏感」。
  const READER = 'import { readFileSync } from "node:fs"\nreadFileSync(".github/workflows/probe-ci.yml", "utf8")\n';

  function ciRepo() {
    return makeRepo({ ".github/workflows/probe-ci.yml": "jobs:\n  test:\n    steps: []\n" });
  }

  it("接线文件脏了没提交、只提交读它的测试 → 必须红并点名接线文件", () => {
    const dir = ciRepo();
    write(dir, ".github/workflows/probe-ci.yml", "jobs:\n  test:\n    steps:\n      - run: pnpm test\n");
    write(dir, "scripts/check-ci-gate.test.ts", READER);
    git(dir, ["add", "scripts/check-ci-gate.test.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("scripts/check-ci-gate.test.ts");
    expect(res.out).toContain(".github/workflows/probe-ci.yml");
  });

  it("测试与接线文件同批提交 → 必须绿（当天 P0 的真实形状）", () => {
    const dir = ciRepo();
    write(dir, ".github/workflows/probe-ci.yml", "jobs:\n  test:\n    steps:\n      - run: pnpm test\n");
    write(dir, "scripts/check-ci-gate.test.ts", READER);
    git(dir, ["add", "scripts/check-ci-gate.test.ts", ".github/workflows/probe-ci.yml"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(0);
  });

  it("无后缀的 Dockerfile 走配置对象键（dockerfilePath:）也算读取 → 必须红", () => {
    const dir = makeRepo({ "docker/Dockerfile.probe": "FROM node\n" });
    write(dir, "docker/Dockerfile.probe", "FROM node:24\n");
    write(
      dir,
      "scripts/check-hooks-fresh.test.ts",
      'const problems = prepareClosureProblems({\n  dockerfilePath: "docker/Dockerfile.probe",\n  entry: "scripts/x.mjs",\n});\n',
    );
    git(dir, ["add", "scripts/check-hooks-fresh.test.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("docker/Dockerfile.probe");
  });

  it("样式：overlay 相对写法 src/styles/*.css 归一到事实源后脏了 → 必须红", () => {
    const dir = makeRepo({ "apps/web-overlay/src/styles/probe-globals.css": ":root { --x: 1 }\n" });
    write(dir, "apps/web-overlay/src/styles/probe-globals.css", ":root { --x: 2 }\n");
    write(dir, "apps/web-overlay/test/design-system.test.ts", 'const s = overlayFile("src/styles/probe-globals.css")\n');
    git(dir, ["add", "apps/web-overlay/test/design-system.test.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("apps/web-overlay/src/styles/probe-globals.css");
  });

  it("夹具里的「举例」不敏感：对象键 / 数组元素 / 赋值 / 写字类 / 集合断言第二元素 → 必须绿", () => {
    const dir = makeRepo({
      ".github/workflows/ci.yml": "jobs:\n  test:\n",
      "docker/Dockerfile.api": "FROM node\n",
      "docs/GATES-OPERATIONS.md": "# gates\n",
    });
    // 三个热区文件全部改脏，但都不进本次提交
    write(dir, ".github/workflows/ci.yml", "jobs:\n  test:\n    steps: []\n");
    write(dir, "docker/Dockerfile.api", "FROM node:24\n");
    write(dir, "docs/GATES-OPERATIONS.md", "# gates v2\n");
    write(
      dir,
      "scripts/test-impact.test.ts",
      [
        'const root = makeRepo({ ".github/workflows/ci.yml": "jobs:\\n", "docs/GATES-OPERATIONS.md": "# x\\n" })',
        'expect(graphVisibleFiles([".github/workflows/ci.yml", "docker/Dockerfile.api", "docs/GATES-OPERATIONS.md"]))',
        'const p = "docker/Dockerfile.api";',
        'write(root, "docs/GATES-OPERATIONS.md", "x")',
        'expect(x).toEqual(["docs/GATES-OPERATIONS.md", ".github/workflows/ci.yml"])',
      ].join("\n") + "\n",
    );
    git(dir, ["add", "scripts/test-impact.test.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(0);
  });

  it("isReadArgument：逐条钉住「读取形态」与「举例形态」的分界", () => {
    // 每一项都是「字面量之前的文本」，直接给字符串，避免靠下标反推
    const reads = [
      'readFileSync(',
      'const ci = readFileSync(resolve(ROOT, ',
      'const REAL_CI = join(REPO_ROOT, ',
      'const s = overlayFile(',
      'const problems = prepareClosureProblems({\n  dockerfilePath: ',
      'const css = overlaySource(',
    ];
    for (const before of reads) expect(isReadArgument(before), before).toBe(true);

    const examples = [
      'const root = makeRepo({ ', // 对象键：夹具在造文件
      'expect(graphVisibleFiles(["a.yml", ', // 数组第二个元素：不是第二个实参
      'const p = ', // 赋值：路径只是数据
      'write(root, ', // 写字类：目标在夹具临时树里
      'expect(x).toEqual(["docs/a.md", ', // 集合断言里的元素
      '(p === ', // 比较：mock 的路由谓词
      'expect(workspace.files[', // 下标访问
    ];
    for (const before of examples) expect(isReadArgument(before), before).toBe(false);

    // 整行级：括号内出现方括号就不认，集合断言里的路径一个字都不进依赖
    expect(extractPathLiterals('expect(x).toEqual(["docs/a.md", ".github/workflows/ci.yml"])')).toEqual([]);
    expect(extractPathLiterals('readFileSync(resolve(ROOT, ".github/workflows/probe-ci.yml"), "utf8")')).toEqual([
      ".github/workflows/probe-ci.yml",
    ]);
  });
});

const STORE_BARREL = 'export * from "./repository/videos.ts"\n';

const STORE_VIDEOS_OLD = [
  "export async function countVideoItems(repo: Repository, categoryId?: string): Promise<number> {",
  "  return categoryId ? 1 : 2",
  "}",
  "",
  "export async function listVideoItems(repo: Repository, opts: { limit?: number } = {}): Promise<unknown[]> {",
  "  return [opts]",
  "}",
  "",
].join("\n");

const STORE_VIDEOS_NEW = [
  "export interface VideoItemCountFilter {",
  "  categoryId?: string",
  "  platform?: string",
  "}",
  "",
  "export async function countVideoItems(",
  "  repo: Repository,",
  "  filter: string | VideoItemCountFilter = {},",
  "): Promise<number> {",
  "  return typeof filter === \"string\" ? 1 : 2",
  "}",
  "",
  "export async function listVideoItems(repo: Repository, opts: { limit?: number; platform?: string } = {}): Promise<unknown[]> {",
  "  return [opts]",
  "}",
  "",
].join("\n");

const ROUTE_OLD = [
  'import { countVideoItems } from "../../../../packages/fx-store/src/index.ts"',
  "export async function total(repo: Repository) {",
  '  return countVideoItems(repo, "cat")',
  "}",
  "",
].join("\n");

const ROUTE_NEW = [
  'import { countVideoItems } from "../../../../packages/fx-store/src/index.ts"',
  "export async function total(repo: Repository) {",
  '  return countVideoItems(repo, { categoryId: "cat", platform: "bili" })',
  "}",
  "",
].join("\n");

/**
 * 源码 → 源码的伴随改动（2026-10-29 事故形状，`7de79c31`）：
 * 路由提交了、它调的 `@navhub/store` 里真正改签名的那一跳没提交。
 * 本机 typecheck 读工作区全绿，CI 检出提交树旧签名，三个分片一起红。
 */
describe("提交原子性：源码 → 源码伴随改动", () => {
  function incidentRepo() {
    const dir = makeRepo({
      "packages/fx-store/src/index.ts": STORE_BARREL,
      "packages/fx-store/src/repository/videos.ts": STORE_VIDEOS_OLD,
      "apps/api/src/routes/videos.ts": ROUTE_OLD,
    });
    write(dir, "packages/fx-store/src/repository/videos.ts", STORE_VIDEOS_NEW);
    write(dir, "apps/api/src/routes/videos.ts", ROUTE_NEW);
    return dir;
  }

  it("事故形状：路由提交了、barrel 深处改签名的 store 文件没提交 → 必须红并点名两处", () => {
    const dir = incidentRepo();
    git(dir, ["add", "apps/api/src/routes/videos.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("apps/api/src/routes/videos.ts");
    // 依赖直接从 barrel 解析，但要点名的是第二跳的定义文件
    expect(res.out).toContain("packages/fx-store/src/repository/videos.ts");
    expect(res.out).toContain("countVideoItems");
    expect(res.out).toContain("NAVHUB_ALLOW_DIRTY_SOURCE_DEPS");
  });

  it("伴随改动随本次提交一起进 → 必须绿", () => {
    const dir = incidentRepo();
    git(dir, ["add", "apps/api/src/routes/videos.ts", "packages/fx-store/src/repository/videos.ts"]);

    expect(run(dir).status).toBe(0);
  });

  it("脏文件改的是本次源码没用到的导出 → 必须绿（符号级判据，不看「文件脏」）", () => {
    const dir = incidentRepo();
    // 只把 listVideoItems 的参数行改掉；路由只提 countVideoItems
    write(
      dir,
      "packages/fx-store/src/repository/videos.ts",
      STORE_VIDEOS_OLD.replace("opts: { limit?: number } = {}", "opts: { limit?: number; platform?: string } = {}"),
    );
    git(dir, ["add", "apps/api/src/routes/videos.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(0);
  });

  it("只新增导出、没有删改 → 必须绿（HEAD 旧文件仍满足调用方）", () => {
    const dir = makeRepo({
      "packages/fx-store/src/index.ts": STORE_BARREL,
      "packages/fx-store/src/repository/videos.ts": STORE_VIDEOS_OLD,
      "apps/api/src/routes/videos.ts": ROUTE_OLD,
    });
    write(
      dir,
      "packages/fx-store/src/repository/videos.ts",
      STORE_VIDEOS_OLD + "\nexport interface Extra {\n  a?: string\n}\n",
    );
    write(dir, "apps/api/src/routes/videos.ts", ROUTE_NEW);
    git(dir, ["add", "apps/api/src/routes/videos.ts"]);

    expect(run(dir).status).toBe(0);
  });

  it("导出函数体内只删了一行注释 → 必须绿（不给噪声开门）", () => {
    const withComment = STORE_VIDEOS_OLD.replace(
      "export async function countVideoItems(",
      "// 兼容旧的字符串参数\nexport async function countVideoItems(",
    );
    const dir = makeRepo({
      "packages/fx-store/src/index.ts": STORE_BARREL,
      "packages/fx-store/src/repository/videos.ts": withComment,
      "apps/api/src/routes/videos.ts": ROUTE_OLD,
    });
    write(dir, "packages/fx-store/src/repository/videos.ts", STORE_VIDEOS_OLD);
    write(dir, "apps/api/src/routes/videos.ts", ROUTE_NEW);
    git(dir, ["add", "apps/api/src/routes/videos.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(0);
  });

  it("相对路径的直接依赖改签名未提交 → 必须红", () => {
    const dir = makeRepo({
      "apps/api/src/lib/helper.ts": "export function buildFilter(x: string): string {\n  return x\n}\n",
      "apps/api/src/routes/r.ts": 'import { buildFilter } from "../lib/helper"\nvoid buildFilter\n',
    });
    write(dir, "apps/api/src/lib/helper.ts", "export function buildFilter(x: string, y?: number): string {\n  return x\n}\n");
    write(
      dir,
      "apps/api/src/routes/r.ts",
      'import { buildFilter } from "../lib/helper"\nvoid buildFilter("a", 1)\n',
    );
    git(dir, ["add", "apps/api/src/routes/r.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("apps/api/src/lib/helper.ts");
    expect(res.out).toContain("buildFilter");
  });

  it("NAVHUB_ALLOW_DIRTY_SOURCE_DEPS=1 时放行并逐条列出", () => {
    const dir = incidentRepo();
    git(dir, ["add", "apps/api/src/routes/videos.ts"]);

    const res = run(dir, { NAVHUB_ALLOW_DIRTY_SOURCE_DEPS: "1" });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("NAVHUB_ALLOW_DIRTY_SOURCE_DEPS");
    expect(res.out).toContain("packages/fx-store/src/repository/videos.ts");
  });
});

describe("伴随改动的符号抽取", () => {
  it("changedExportNames：声明行被改写（含 - 行）→ 收到符号", () => {
    const diff = [
      "@@ -1 +1 @@",
      "-export async function countVideoItems(repo: Repository, categoryId?: string): Promise<number> {",
      "+export async function countVideoItems(repo: Repository, filter: Filter = {}): Promise<number> {",
    ].join("\n");
    expect([...changedExportNames(diff)]).toEqual(["countVideoItems"]);
  });

  it("changedExportNames：参数/实现体内的删行归属到最近的导出声明", () => {
    const diff = [
      "@@ -10,4 +10,4 @@",
      " export async function listVideoItems(",
      "   repo: Repository,",
      "-  opts: { limit?: number } = {},",
      "+  opts: { limit?: number; platform?: string } = {},",
      " ): Promise<Row[]> {",
    ].join("\n");
    expect([...changedExportNames(diff)]).toEqual(["listVideoItems"]);
  });

  it("changedExportNames：删注释、纯新增导出都不算", () => {
    const diff = [
      "@@ -1,3 +1,4 @@",
      " export function f() {",
      "-  // stale",
      "   return 1",
      "+}",
      "+export interface NewThing { a: string }",
    ].join("\n");
    expect(changedExportNames(diff).size).toBe(0);
  });

  it("changedExportNames：`export { a, b as c }` 的删行逐个收", () => {
    const diff = '@@ -1 +1 @@\n-export { alpha, beta as gamma } from "./x.ts"\n';
    expect([...changedExportNames(diff)].sort()).toEqual(["alpha", "beta"]);
  });

  it("mentionsSymbol：词边界，不命中前缀相同的别的标识符", () => {
    expect(mentionsSymbol('import { countVideoItems } from "@navhub/store"', "countVideoItems")).toBe(true);
    expect(mentionsSymbol("countVideoItems(repo, f)", "countVideoItems")).toBe(true);
    expect(mentionsSymbol("repo.countVideoItems()", "countVideoItems")).toBe(true);
    expect(mentionsSymbol("countVideoItemsLegacy()", "countVideoItems")).toBe(false);
    expect(mentionsSymbol("$countVideoItems", "countVideoItems")).toBe(false);
  });

  it("工作区包别名：@navhub/* 与模块图共用一份映射（少了它跨包依赖整条边看不见）", () => {
    const expected = `${WORKSPACE_ALIAS_ROOTS["@navhub/store"]}/index.ts`;
    const exists = (p: string) => p === expected;
    const resolved = resolveSpecifier("apps/api/src/routes/videos.ts", "@navhub/store", {
      aliasRoots: aliasRootsFor("apps/api/src/routes/videos.ts"),
      exists,
    });
    expect(resolved).toBe(expected);
  });

  it("reexportClosure：沿 barrel 找到第二跳的定义文件", () => {
    const files: Record<string, string> = {
      "packages/fx-store/src/index.ts": 'export * from "./repository/videos.ts"\nexport { a } from "./a.ts"\n',
      "packages/fx-store/src/a.ts": "export const a = 1\n",
      "packages/fx-store/src/repository/videos.ts": "export const countVideoItems = 1\n",
    };
    const exists = (p: string) => Object.hasOwn(files, p);
    const readCommitted = (p: string) => files[p] ?? null;
    const out = reexportClosure("packages/fx-store/src/index.ts", { readCommitted, exists });
    expect(out).toContain("packages/fx-store/src/repository/videos.ts");
    expect(out).toContain("packages/fx-store/src/a.ts");
  });
});
