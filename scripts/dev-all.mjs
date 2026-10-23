#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

/**
 * 端口可覆盖：默认仍是 API :8787 + Web :3000。
 *
 * 本机常有另一个会话开着开发服务器占住 3000/8787；Playwright 又禁止复用已存在的
 * 服务器（会写回开发库）。`NAVHUB_WEB_PORT=3100 NAVHUB_API_PORT=8790 pnpm test:e2e`
 * 即可在独立端口起一套 E2E 全栈，互不干扰。
 */
const API_PORT = Number(process.env.NAVHUB_API_PORT || 8787);
const WEB_PORT = Number(process.env.NAVHUB_WEB_PORT || 3000);
const hubUrl = `http://127.0.0.1:${API_PORT}`;
const webUrl = `http://localhost:${WEB_PORT}`;

console.log(
  "\x1b[36m%s\x1b[0m",
  `🚀 启动 NavHub 全栈开发环境（中枢 API :${API_PORT} + Web 前端 :${WEB_PORT}）...`
);

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
      PORT: String(API_PORT),
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
      const res = await fetch(`${hubUrl}/api/health`);
      if (res.ok) {
        console.log("\x1b[32m%s\x1b[0m", `✓ NavHub 中枢 API (:${API_PORT}) 已就绪，启动 Web 前端...`);
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
    [nextBin, "dev", "-p", String(WEB_PORT)],
    {
      cwd: resolve(rootDir, "apps/web"),
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(WEB_PORT),
        // BFF 必须指向本次启动的中枢端口，否则换端口后会连到另一个会话的 8787。
        NAVHUB_STORAGE_BASE_URL: process.env.NAVHUB_STORAGE_BASE_URL ?? hubUrl,
        // 绝对 URL（canonical / OG）跟随本次 Web 端口
        NAVHUB_SITE_URL: process.env.NAVHUB_SITE_URL ?? webUrl,
      },
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
