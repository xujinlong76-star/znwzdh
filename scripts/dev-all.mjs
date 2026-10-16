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
  ["--experimental-strip-types", "apps/api/src/main.ts"],
  {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...process.env },
  }
);

// 启动 Next.js Web 前端
const webProc = spawn(
  process.execPath,
  ["scripts/run.mjs", "--filter", "navsphere", "dev"],
  {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...process.env },
  }
);

function killAll() {
  console.log("\n\x1b[33m%s\x1b[0m", "正在停止 NavHub 全栈服务...");
  try {
    if (isWin) {
      if (apiProc.pid) spawn("taskkill", ["/pid", String(apiProc.pid), "/T", "/F"]);
      if (webProc.pid) spawn("taskkill", ["/pid", String(webProc.pid), "/T", "/F"]);
    } else {
      if (apiProc.pid) apiProc.kill("SIGTERM");
      if (webProc.pid) webProc.kill("SIGTERM");
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

webProc.on("exit", (code) => {
  if (code && code !== 0) {
    console.error(`\x1b[31m[web] Web 前端异常退出，退出码: ${code}\x1b[0m`);
  }
});
