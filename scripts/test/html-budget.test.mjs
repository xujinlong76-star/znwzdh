/**
 * 验证 scripts/html-budget.mjs 的 --dist 产物模式与 --url 模式。
 *
 * 背景：CI test-web 调 `html-budget.mjs --dist --max-kb=4096`，但脚本此前根本
 * 没有 --dist 模式——无 URL 时直接以「缺少 URL」退出 1，test-web 因此自
 * 10-29 起常驻红（不是页面超标，是调用了一个不存在的模式）。本测试锁死
 * --dist 的语义：扫描预渲染 HTML、取最大者与预算比对；--url 模式保持原样。
 *
 * 隔离：全部用临时目录夹具 + 子进程跑脚本，不碰真实 .next、不起外部服务；
 * --url 成功路径用本机 127.0.0.1 临时 HTTP 服务覆盖。
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve("scripts", "html-budget.mjs");

const tmpDirs = [];
function makeTmp() {
  const d = mkdtempSync(join(tmpdir(), "navhub-html-budget-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

function run(args, cwd = resolve(".")) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", cwd });
}

/**
 * 异步版 run：--url 实测需要测试进程内的 HTTP 服务同时响应，spawnSync 会
 * 阻塞事件循环、服务永远接不到请求（子进程 fetch 30 秒超时）。只在该用例用。
 */
function runAsync(args, cwd = resolve(".")) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
  });
}

/** 在 dir 下造 name → size 字节的 .html（内容全 'x'，字节数精确）。 */
function seedHtml(dir, files) {
  for (const [name, size] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "x".repeat(size));
  }
}

describe("html-budget --dist 产物模式", () => {
  it("最大者未超预算时退出 0，--json 报文件数与最大文件", () => {
    const dir = makeTmp();
    seedHtml(dir, { "index.html": 1024, "videos.html": 2048, "tags.html": 512 });
    const r = run(["--dist", `--dist=${dir}`, "--max-kb=4096", "--json"]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.mode).toBe("dist");
    expect(out.files).toBe(3);
    expect(out.maxFile).toBe("videos.html");
    expect(out.maxBytes).toBe(2048);
    expect(out.maxKb).toBe(2);
    expect(out.ok).toBe(true);
  });

  it("最大者超预算时退出 1，最大文件仍报出", () => {
    const dir = makeTmp();
    seedHtml(dir, { "big.html": 3 * 1024, "small.html": 100 });
    const r = run(["--dist", `--dist=${dir}`, "--max-kb=2", "--json"]);
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.ok).toBe(false);
    expect(out.maxFile).toBe("big.html");
    expect(out.maxKb).toBe(3);
  });

  it("只量 .html：非 html 文件不计入", () => {
    const dir = makeTmp();
    seedHtml(dir, { "a.html": 100 });
    writeFileSync(join(dir, "huge.rsc"), "x".repeat(10 * 1024 * 1024));
    const r = run(["--dist", `--dist=${dir}`, "--max-kb=1", "--json"]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).files).toBe(1);
  });

  it("子目录递归扫描", () => {
    const dir = makeTmp();
    seedHtml(dir, { "sub/deep.html": 3000, "top.html": 100 });
    const r = run(["--dist", `--dist=${dir}`, "--max-kb=4096", "--json"]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.files).toBe(2);
    expect(out.maxFile).toBe(join("sub", "deep.html"));
  });

  it("目录不存在时退出 1 且明确报错，不静默放行", () => {
    const r = run(["--dist", "--dist=/definitely/not/here", "--max-kb=4096"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("找不到预渲染产物目录");
  });

  it("目录下无 .html 时退出 1 且明确报错", () => {
    const dir = makeTmp();
    writeFileSync(join(dir, "note.txt"), "nothing here");
    const r = run(["--dist", `--dist=${dir}`, "--max-kb=4096"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("未找到任何 .html");
  });

  it("裸 --dist 在仓库根默认解析 apps/web/.next/server/app", () => {
    // 用临时目录伪装成仓库根：只建默认候选路径，cwd 指过去。
    const root = makeTmp();
    const appDir = join(root, "apps", "web", ".next", "server", "app");
    seedHtml(appDir, { "videos.html": 1024 });
    const r = run(["--dist", "--max-kb=4096", "--json"], root);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.files).toBe(1);
    expect(out.maxFile).toBe("videos.html");
  });

  it("--max-kb 非正数时退出 1", () => {
    const dir = makeTmp();
    seedHtml(dir, { "a.html": 10 });
    const r = run(["--dist", `--dist=${dir}`, "--max-kb=0"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--max-kb 必须是正数");
  });
});

describe("html-budget --url 模式（回归：未被 --dist 改动）", () => {
  it("既无 --dist 又无 URL 时仍报缺少 URL、退出 1", () => {
    const r = run(["--max-kb=4096"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("缺少 URL");
  });

  it("本机 HTTP 服务：体量在预算内退出 0，超预算退出 1", async () => {
    const body = "y".repeat(1500);
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(body);
    });
    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const url = `http://127.0.0.1:${server.address().port}/`;
      const okRun = await runAsync([`--url=${url}`, "--max-kb=4096", "--json"]);
      expect(okRun.status).toBe(0);
      expect(JSON.parse(okRun.stdout).kb).toBeCloseTo(1.5, 1);
      const overRun = await runAsync([`--url=${url}`, "--max-kb=1", "--json"]);
      expect(overRun.status).toBe(1);
      expect(JSON.parse(overRun.stdout).ok).toBe(false);
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  });
});
