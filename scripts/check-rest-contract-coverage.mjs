#!/usr/bin/env node
/**
 * REST 契约覆盖率门禁（CI 可执行版）。
 *
 * 为什么需要：`generate-rest-contract-types.mjs --check` 只保证「已绑定的没漂」，
 * 不保证「新写的路由会绑定」——新增一条写路由不登记契约，门禁照样全绿，
 * 前端只能再手抄一份接口。这里把路由表（Fastify onRoute 的真实清单）与
 * RESPONSE_SCHEMA_BINDINGS 对账：
 *
 *   - 写路由（POST/PUT/PATCH/DELETE）：100% 绑定，或在 allowlist 里写明理由；
 *   - 公开高频读 Top 20：必须全部绑定；
 *   - allowlist 只许缩小：补了绑定/改了名/删了路由的行必须删掉；
 *   - 管理读路由：由 `apps/api/test/response-contracts.test.ts` 的读路由棘轮兜底，
 *     这里只打印覆盖率，不重复判红。
 *
 * 用法：
 *   node --experimental-strip-types scripts/check-rest-contract-coverage.mjs
 *   node --experimental-strip-types scripts/check-rest-contract-coverage.mjs --json
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzeCoverage, parseAllowlist } from "./lib/rest-contract-coverage.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ALLOWLIST_RELATIVE_PATH = "apps/api/test/fixtures/unbound-write-routes.txt";

async function loadBindings() {
  const { RESPONSE_SCHEMA_BINDINGS } = await import(
    pathToFileURL(resolve(ROOT, "packages/core/src/rest-responses.ts")).href
  );
  return RESPONSE_SCHEMA_BINDINGS;
}

/**
 * 无头启动一次中枢：与测试同配方（lite + 临时库 + 关闭 embedding），
 * 只为拿 onRoute 收集到的真实路由清单，不监听端口。
 */
export async function collectRouteInventory() {
  const dir = mkdtempSync(join(tmpdir(), "navhub-rest-coverage-"));
  const apiSrc = resolve(ROOT, "apps/api/src");
  const [{ loadConfig }, { createContext }, { buildServer }] = await Promise.all([
    import(pathToFileURL(resolve(apiSrc, "config.ts")).href),
    import(pathToFileURL(resolve(apiSrc, "context.ts")).href),
    import(pathToFileURL(resolve(apiSrc, "server.ts")).href),
  ]);
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "coverage.db"),
    adminToken: "rest-coverage-token",
    embedding: {
      model: "Xenova/bge-small-zh-v1.5",
      endpoint: "https://hf-mirror.com",
      dtype: "q8",
      cacheDir: join(dir, "models"),
      dim: 512,
      enabled: false,
      useWorker: false,
    },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubCoverage/0.1" },
    corsOrigins: ["*"],
  });
  const ctx = await createContext(config);
  const app = await buildServer(ctx);
  try {
    await app.ready();
    return app.routeInventory.map((route) => ({ method: route.method, url: route.url, scope: route.scope }));
  } finally {
    await app.close();
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function check() {
  const bindings = await loadBindings();
  const allowlistText = readFileSync(resolve(ROOT, ALLOWLIST_RELATIVE_PATH), "utf8");
  const allowlist = parseAllowlist(allowlistText);
  const routes = await collectRouteInventory();
  return analyzeCoverage({ routes, bindings, allowlist });
}

function formatStats(result) {
  const { stats } = result;
  const pct = (part, total) => (total === 0 ? "100%" : Math.round((part / total) * 100) + "%");
  return [
    `[rest-contracts] 写路由绑定：${stats.write.bound}/${stats.write.total}（${pct(stats.write.bound, stats.write.total)}，allowlist ${stats.write.allowlisted}）`,
    `[rest-contracts] 公开读绑定：${stats.publicRead.bound}/${stats.publicRead.total}（Top 20：${stats.priorityPublicRead.bound}/${stats.priorityPublicRead.total}）`,
    `[rest-contracts] 管理读绑定：${stats.adminRead.bound}/${stats.adminRead.total}（读路由棘轮兜底）`,
  ].join("\n");
}

async function main() {
  const json = process.argv.includes("--json");
  const result = await check();
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatStats(result));
    if (result.unboundWrites.length > 0) {
      console.log("[rest-contracts] 未绑定的写路由（allowlist 已登记）：");
      for (const key of result.unboundWrites) console.log("  - " + key);
    }
    for (const problem of result.problems) console.error("[rest-contracts] " + problem);
  }
  if (result.problems.length > 0) {
    console.error(
      "[rest-contracts] FAIL：契约覆盖率不达标。修复方式见 " +
        ALLOWLIST_RELATIVE_PATH + " 头部说明。",
    );
    process.exit(1);
  }
  if (!json) console.log("[rest-contracts] OK 契约覆盖率达标");
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
