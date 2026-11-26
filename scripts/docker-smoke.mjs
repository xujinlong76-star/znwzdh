#!/usr/bin/env node
/**
 * Docker smoke runner shared by CI and local verification.
 *
 * The repository workflow keeps its existing docker-smoke job; this script owns the
 * repeatable startup/health/migration assertions so local and CI use identical commands.
 */
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const apiImageIndex = args.indexOf("--api-image");
const webImageIndex = args.indexOf("--web-image");
const apiImage = apiImageIndex >= 0 ? args[apiImageIndex + 1] : "navhub/api:ci";
const webImage = webImageIndex >= 0 ? args[webImageIndex + 1] : "navhub/web:ci";
const runId = `${process.pid}-${Date.now()}`;
const apiName = `navhub-smoke-api-${runId}`;
const webName = `navhub-smoke-web-${runId}`;
const networkName = `navhub-smoke-net-${runId}`;
const volumeName = `navhub-smoke-data-${runId}`;
// 两个一次性容器共享 /data 卷；放在 /tmp 会让第二个容器看不到迁移结果。
const migrationPath = "/data/navhub-smoke-migration.db";

function run(command, commandArgs, { allowFailure = false, input } = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  if (result.error && !allowFailure) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed (${result.status ?? "signal"})`);
  }
  return { ...result, text: stdout + stderr };
}

function docker(...commandArgs) {
  return run("docker", commandArgs);
}

function cleanup() {
  for (const name of [webName, apiName]) {
    run("docker", ["rm", "-f", name], { allowFailure: true });
  }
  run("docker", ["network", "rm", networkName], { allowFailure: true });
  run("docker", ["volume", "rm", volumeName], { allowFailure: true });
}

function waitForHealth(name, url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const inspected = run("docker", ["inspect", "--format", "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}", name], { allowFailure: true });
    const state = inspected.text.trim();
    if (state.startsWith("exited") || state.startsWith("dead")) {
      throw new Error(`${name} stopped before becoming healthy: ${state}`);
    }
    const probe = run("docker", ["exec", name, "curl", "-fsS", "--max-time", "5", url], { allowFailure: true });
    if (probe.status === 0 && state.endsWith("healthy")) {
      console.log(`[docker-smoke] ${name} healthy: ${url}`);
      return;
    }
    last = `${state}; HTTP probe status=${probe.status ?? "signal"}`;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error(`${name} did not become healthy within ${timeoutMs}ms (${last})`);
}

function assertHealthPayload(text, label) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return JSON: ${text.slice(0, 300)}`);
  }
  const ok = payload?.ok ?? payload?.status;
  if (ok !== true && ok !== "ok") {
    throw new Error(`${label} reported not-ready: ${JSON.stringify(payload)}`);
  }
}

try {
  docker("network", "create", networkName);
  docker("volume", "create", volumeName);
  docker(
    "run", "-d", "--name", apiName,
    "--network", networkName,
    "--network-alias", "api",
    "--mount", `source=${volumeName},target=/data`,
    "-e", "NAVHUB_SESSION_SECRET=ci-docker-smoke-session-secret",
    "-e", "NAVHUB_SEED_ON_START=0",
    apiImage,
  );
  waitForHealth(apiName, "http://127.0.0.1:8787/api/ready");

  const ready = docker("exec", apiName, "curl", "-fsS", "http://127.0.0.1:8787/api/ready").text.trim();
  assertHealthPayload(ready, "API /api/ready");

  docker(
    "run", "-d", "--name", webName,
    "--network", networkName,
    "-e", "NAVHUB_STORAGE_BASE_URL=http://api:8787",
    "-e", "NAVHUB_SESSION_SECRET=ci-docker-smoke-session-secret",
    "-e", "AUTH_SECRET=ci-docker-smoke-auth-secret",
    webImage,
  );
  waitForHealth(webName, "http://127.0.0.1:3000/");
  const home = docker("exec", webName, "curl", "-fsS", "--max-time", "10", "http://127.0.0.1:3000/").text;
  if (!home.includes("<html")) throw new Error("Web homepage did not return HTML");

  // A second, isolated SQLite database proves the image can apply migrations from an
  // empty file. The entrypoint deliberately skips seeding for an explicit command.
  const migrated = docker(
    "run", "--rm",
    "--network", networkName,
    "--mount", `source=${volumeName},target=/data`,
    "-e", "NAVHUB_SESSION_SECRET=ci-docker-smoke-session-secret",
    "-e", `NAVHUB_SQLITE_PATH=${migrationPath}`,
    apiImage,
    "node", "apps/api/src/migrate.ts",
  );
  if (!/migrat|迁移|schema|表/i.test(migrated.text)) {
    console.log("[docker-smoke] migrate command exited 0 without a matching log line; verifying schema next");
  }
  const schema = docker(
    "run", "--rm",
    "--mount", `source=${volumeName},target=/data`,
    "-e", `NAVHUB_SQLITE_PATH=${migrationPath}`,
    apiImage,
    "node", "-e",
    "const {createRequire}=require('node:module');" +
      "const Database=createRequire('/app/packages/store/package.json')('better-sqlite3');" +
      "const db=new Database(process.env.NAVHUB_SQLITE_PATH,{readonly:true});" +
      "const n=db.prepare(\"select count(*) n from sqlite_master where type='table' and name not like 'sqlite_%'\").get().n;" +
      "if(!n)throw new Error('migration produced no tables');console.log('tables='+n);db.close();",
  );
  if (!/tables=[1-9]\d*/.test(schema.text)) throw new Error("migration schema verification failed");
  console.log("[docker-smoke] API ready + Web home + empty-database migration passed");
} catch (error) {
  console.error(`[docker-smoke] ${error instanceof Error ? error.message : String(error)}`);
  for (const name of [apiName, webName]) {
    const logs = run("docker", ["logs", "--tail", "120", name], { allowFailure: true });
    if (logs.text) console.error(`[docker-smoke] logs for ${name}:\n${logs.text}`);
  }
  process.exitCode = 1;
} finally {
  cleanup();
}
