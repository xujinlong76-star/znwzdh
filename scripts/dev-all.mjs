#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

console.log("\x1b[36m%s\x1b[0m", "🚀 启动 NavHub 全栈开发环境（中枢 API :8787 + Web 前端 :3000）...");

const isWin = process.platform === "win32";

// 启动 Fastify API 中枢
const apiProc = spawn(
  process.execPath,
  ["src/main.ts"],
  {
    cwd: resolve(rootDir, "apps/api"),
    stdio: "inherit",
    env: {
      ...process.env,
      // 允许调用方覆盖数据库路径：Playwright E2E 用独立库（data/e2e/navhub-e2e.db），
      // 避免测试插件写进开发库（历史上开发库被 48 条 e2e-* 残留污染过）。
      NAVHUB_SQLITE_PATH: process.env.NAVHUB_SQLITE_PATH ?? resolve(rootDir, "data/navhub.db"),
      NAVHUB_EMBEDDING_CACHE: process.env.NAVHUB_EMBEDDING_CACHE ?? resolve(rootDir, "data/models"),
    },
  }
);

let webProc = null;

async function start() {
  const startWait = Date.now();
  while (Date.now() - startWait < 30_000) {
    try {
      const res = await fetch("http://127.0.0.1:8787/api/health");
      if (res.ok) {
        console.log("\x1b[32m%s\x1b[0m", "✓ NavHub 中枢 API (:8787) 已就绪，启动 Web 前端...");
        break;
      }
    } catch {
      // 中枢 API 尚未就绪，等待下一次探测
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // 启动 Next.js Web 前端
  const nextBin = resolve(rootDir, "apps/web/node_modules/next/dist/bin/next");
  webProc = spawn(
    process.execPath,
    [nextBin, "dev", "-p", "3000"],
    {
      cwd: resolve(rootDir, "apps/web"),
      stdio: "inherit",
      env: { ...process.env, PORT: "3000" },
    }
  );

  webProc.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`\x1b[31m[web] Web 前端异常退出，退出码: ${code}\x1b[0m`);
    }
  });
}

start();

function killAll() {
  console.log("\n\x1b[33m%s\x1b[0m", "正在停止 NavHub 全栈服务...");
  try {
    if (isWin) {
      if (apiProc?.pid) spawn("taskkill", ["/pid", String(apiProc.pid), "/T", "/F"]);
      if (webProc?.pid) spawn("taskkill", ["/pid", String(webProc.pid), "/T", "/F"]);
    } else {
      if (apiProc?.pid) apiProc.kill("SIGTERM");
      if (webProc?.pid) webProc.kill("SIGTERM");
    }
  } catch {
    // 忽略清理异常
  }
}

process.on("SIGINT", () => {
  killAll();
  process.exit(0);
});

process.on("SIGTERM", () => {
  killAll();
  process.exit(0);
});

apiProc.on("exit", (code) => {
  if (code && code !== 0) {
    console.error(`\x1b[31m[api] 中枢服务异常退出，退出码: ${code}\x1b[0m`);
  }
});
