#!/usr/bin/env node
/**
 * 环境体检：把「本地为什么跑不起来」从口头排查变成一条命令。
 *
 * 这一轮里真实踩过的坑，每一个都花掉过一次以上排查时间：
 *   · 端口 3200/8900 被并行会话的 E2E 占用 → webServer 启动失败
 *   · `data/e2e/navhub-e2e.db` 被另一个进程持有 → 删库 EBUSY
 *   · 本机 Node 22 而 engines 要求 ≥24 → 只有警告，行为差异要靠猜
 *   · 没有 pgvector → `pnpm test:pg` 跑不了，但报错在很深的 SQL 层
 *   · 多个 git worktree 并存 → 改的是另一棵树
 *   · 已跟踪文件引用了未入库文件 → 本地绿、CI 红
 *
 * 输出约定沿用 flutter/brew doctor：每项一行 `OK|WARN|FAIL`，修复命令直接可复制。
 * `--fix` 只做**无副作用**的清理（删构建缓存、停自己启动的 E2E 服务），
 * 不动数据、不动 git、不切 Node 版本。
 *
 * 用法：node scripts/doctor.mjs [--json] [--fix]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AS_JSON = process.argv.includes("--json");
const FIX = process.argv.includes("--fix");

const results = [];

function report(level, name, detail, fix) {
  results.push({ level, name, detail, fix: fix ?? null });
}

/** 语义化版本比较：只比 major.minor.patch，够用且不引依赖 */
export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
}

/** 端口是否可绑定（能绑上 = 空闲） */
export function probePort(port, host = "127.0.0.1") {
  return new Promise((done) => {
    const server = createServer();
    server.unref();
    server.on("error", () => done(false));
    server.listen(port, host, () => server.close(() => done(true)));
  });
}

function readPkg() {
  try {
    return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

async function checkRuntime(pkg) {
  const want = pkg.engines?.node ?? "";
  const wantMin = (want.match(/>=\s*([\d.]+)/) ?? [])[1];
  const current = process.versions.node;
  if (!wantMin) {
    report("WARN", "Node 版本约束", "package.json 未声明 engines.node");
  } else if (compareVersions(current, wantMin) >= 0) {
    report("OK", "Node 版本", `${current}（要求 ≥${wantMin}）`);
  } else {
    report("FAIL", "Node 版本", `当前 ${current}，要求 ≥${wantMin}`, `nvm install ${wantMin} && nvm use ${wantMin}`);
  }

  try {
    // Windows 上 pnpm 是 .cmd，execFileSync 不走 shell 会 ENOENT（首版误报过「未找到 pnpm」）
    const v = execFileSync("pnpm", ["--version"], { encoding: "utf8", shell: true }).trim();
    report("OK", "pnpm", v);
  } catch {
    report("FAIL", "pnpm", "未找到 pnpm", "corepack enable && corepack prepare pnpm@latest --activate");
  }
}

async function checkPorts() {
  const ports = [
    { port: 3000, what: "开发 Web（dev:all）" },
    { port: 8787, what: "开发 API（dev:all）" },
    { port: 3200, what: "E2E Web 默认端口" },
    { port: 8900, what: "E2E API 默认端口" },
  ];
  const busy = [];
  for (const p of ports) {
    const free = await probePort(p.port);
    if (!free) busy.push(p);
  }
  if (busy.length === 0) {
    report("OK", "端口", "3000 / 8787 / 3200 / 8900 全部空闲");
    return;
  }
  // 3000/8787 常驻开发栈占用是正常状态；3200/8900 被占才会让 E2E 起不来
  const blocking = busy.filter((p) => p.port === 3200 || p.port === 8900);
  const detail = busy.map((p) => `${p.port}（${p.what}）`).join("、");
  if (blocking.length === 0) {
    report("OK", "端口", `${detail} 被常驻开发栈占用（预期）`);
  } else {
    report(
      "WARN",
      "端口",
      `${detail} 被占用；E2E 会用 3200/8900，冲突时改用 node scripts/e2e-local.mjs 自动挑端口`,
      "node scripts/e2e-local.mjs",
    );
  }
}

function checkE2EDb() {
  const db = join(ROOT, "data/e2e/navhub-e2e.db");
  if (!existsSync(db)) {
    report("OK", "E2E 数据库", "尚未创建（首轮 E2E 会建）");
    return;
  }
  const stale = ["-wal", "-shm"].filter((s) => existsSync(db + s));
  try {
    const fd = readFileSync(db, { flag: "r" });
    void fd;
    report("OK", "E2E 数据库", stale.length ? `可读；存在 ${stale.join("/")}（上次未正常关闭，SQLite 会自行恢复）` : "可读");
  } catch (error) {
    report(
      "FAIL",
      "E2E 数据库",
      `无法读取：${error instanceof Error ? error.message : String(error)}`,
      "taskkill 掉残留的 e2e-web-server 进程后重试（不要直接删库）",
    );
  }
}

function checkPgvector() {
  const url = process.env.NAVHUB_TEST_DATABASE_URL;
  if (!url) {
    report("OK", "PostgreSQL", "未配置 NAVHUB_TEST_DATABASE_URL（跨方言套件会跳过）");
    return;
  }
  report("OK", "PostgreSQL", "已配置 NAVHUB_TEST_DATABASE_URL（连通性由 pnpm test:pg:suite 校验）");
}

function checkGit() {
  try {
    const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((l) => l.startsWith("worktree ")).length;
    if (worktrees > 1) {
      report("WARN", "git worktree", `存在 ${worktrees} 棵工作树；确认你改的是当前这棵`, "git worktree list");
    } else {
      report("OK", "git worktree", "单一工作树");
    }
  } catch {
    report("WARN", "git worktree", "无法读取（不在 git 仓库？）");
  }

  try {
    const res = execFileSync(process.execPath, [join(ROOT, "scripts/check-committed-refs.mjs")], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    void res;
    report("OK", "提交完整性", "无「引用未入库文件」");
  } catch (error) {
    const out = `${(error && error.stdout) || ""}${(error && error.stderr) || ""}`.trim().split("\n")[0];
    report("FAIL", "提交完整性", out || "存在引用未入库文件", "node scripts/check-committed-refs.mjs");
  }
}

/**
 * 依赖树健康（2026-10-29 实测事故）：一次被打断的自动 install 会先把
 * `node_modules/.bin` 与 `.modules.yaml` 移走再重链接它自己的目录；重链接
 * 因活进程占着 native binding 失败（EPERM）时，这两样就回不来了。
 * 症状极具误导性：`pnpm test` 报 command-not-found、任何 pnpm 子命令都想
 * 再做一次 install，而单个包的内容其实完好。
 */
function checkDependencyTree() {
  const binDir = join(ROOT, "node_modules/.bin");
  const modulesYaml = join(ROOT, "node_modules/.modules.yaml");
  const missing = [];
  if (!existsSync(binDir)) missing.push("node_modules/.bin");
  if (!existsSync(modulesYaml)) missing.push("node_modules/.modules.yaml");
  if (missing.length === 0) {
    report("OK", "依赖树", "node_modules/.bin 与 .modules.yaml 都在");
  } else if (!existsSync(join(ROOT, "node_modules"))) {
    report("OK", "依赖树", "尚未安装依赖");
  } else {
    report(
      "WARN",
      "依赖树",
      `缺少 ${missing.join("、")}；裸 \`vitest\` 等命令会找不到，且任何 pnpm 子命令都会想做一次 install`,
      "先停掉持有 native binding 的进程（如 8787 中枢），再 pnpm install --frozen-lockfile --offline",
    );
  }

  // 原生模块能否真的加载：包目录存在不等于可用（EHOST 遇到过「目录在、binding 没了」）
  try {
    const requireFromStore = createRequire(join(ROOT, "packages/store/package.json"));
    requireFromStore("better-sqlite3");
    report("OK", "SQLite 驱动", "better-sqlite3 可加载");
  } catch (error) {
    report(
      "WARN",
      "SQLite 驱动",
      `better-sqlite3 加载失败：${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      "依赖 SQLite 的测试会整片失败；确认 packages/store/node_modules/better-sqlite3 存在且有 prebuilds/ 或 build/",
    );
  }
}

function checkStaleArtifacts() {  const dirs = [".next-e2e", "test-results", "playwright-report"];
  const existing = dirs.filter((d) => existsSync(join(ROOT, d)));
  if (existing.length === 0) {
    report("OK", "构建残留", "无 .next-e2e / test-results / playwright-report");
    return;
  }
  if (FIX) {
    for (const d of existing) rmSync(join(ROOT, d), { recursive: true, force: true });
    report("OK", "构建残留", `已清理 ${existing.join("、")}`);
    return;
  }
  report("WARN", "构建残留", `存在 ${existing.join("、")}`, "node scripts/doctor.mjs --fix");
}

function checkWorkspaceFiles() {
  const needed = ["apps/web-overlay", "packages/core", "scripts"];
  const missing = needed.filter((p) => !existsSync(join(ROOT, p)));
  if (missing.length > 0) {
    report("FAIL", "工作区结构", `缺少 ${missing.join("、")}`, "确认当前目录是仓库根");
    return;
  }
  const vendored = existsSync(join(ROOT, "apps/web/src"));
  report("OK", "工作区结构", vendored ? "apps/web 已 vendor" : "apps/web 未 vendor（首次 E2E / 前端门禁前需 node scripts/vendor-web.mjs）");
}

async function main() {
  const pkg = readPkg();
  await checkRuntime(pkg);
  await checkPorts();
  checkE2EDb();
  checkPgvector();
  checkGit();
  checkDependencyTree();
  checkStaleArtifacts();
  checkWorkspaceFiles();

  const order = { FAIL: 0, WARN: 1, OK: 2 };
  results.sort((a, b) => order[a.level] - order[b.level]);

  if (AS_JSON) {
    console.log(JSON.stringify({ ok: results.every((r) => r.level !== "FAIL"), results }, null, 2));
  } else {
    console.log("NavHub 环境体检\n");
    for (const r of results) {
      const tag = r.level === "OK" ? "✔" : r.level === "WARN" ? "▲" : "✘";
      console.log(`${tag} ${r.name.padEnd(12)} ${r.detail}`);
      if (r.fix && r.level !== "OK") console.log(`    修：${r.fix}`);
    }
    const fails = results.filter((r) => r.level === "FAIL").length;
    const warns = results.filter((r) => r.level === "WARN").length;
    console.log(`\n${fails} 项阻塞、${warns} 项提醒。`);
  }

  // 用 exitCode 而不是 exit()：管道输出是异步的，直接 exit 会截断 --json 的 stdout
  process.exitCode = results.some((r) => r.level === "FAIL") ? 1 : 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (invokedDirectly) await main();
