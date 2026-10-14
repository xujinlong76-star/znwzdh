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
  process.exit(res.status ?? 0);
} else {
  const res = spawnSync("pnpm", args, {
    stdio: ["ignore", "inherit", "inherit"],
    shell: true,
    env,
  });
  process.exit(res.status ?? 0);
}
