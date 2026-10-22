#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const userProfile = homedir();
const dshPnpm = join(userProfile, ".dsh", "dsh-runtimes", "dsh-primary-runtime", "dependencies", "pnpm", "bin", "pnpm.mjs");
const pnpmScript = existsSync(dshPnpm) ? dshPnpm : null;

const args = process.argv.slice(2);
const env = { ...process.env };

if (pnpmScript) {
  const pnpmBinDir = dirname(pnpmScript);
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") || "PATH";
  env[pathKey] = pnpmBinDir + (process.platform === "win32" ? ";" : ":") + (env[pathKey] || "");

  const res = spawnSync(process.execPath, [pnpmScript, ...args], {
    stdio: ["ignore", "inherit", "inherit"],
    env,
  });
  exitFor(res);
} else {
  const res = spawnSync("pnpm", args, {
    stdio: ["ignore", "inherit", "inherit"],
    shell: true,
    env,
  });
  exitFor(res);
}

/**
 * 透传子进程结果。
 * 原来两处都是 `process.exit(res.status ?? 0)`：spawn 不起来（ENOENT，比如那条
 * dsh 路径被清理过）或被信号杀死时 status 是 null，包装脚本反而退出 0，
 * 于是 `pnpm dev:web` 这类入口在"根本没跑起来"时也是绿灯。
 */
function exitFor(res) {
  if (res.error) {
    console.error("[run] 无法启动 pnpm：" + res.error.message);
    process.exit(res.error.code === "ENOENT" ? 127 : 1);
  }
  if (res.signal) {
    console.error("[run] pnpm 被信号终止：" + res.signal);
    process.exit(1);
  }
  process.exit(res.status ?? 1);
}
