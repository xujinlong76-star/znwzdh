#!/usr/bin/env node
/**
 * 从枢纽源码生成「路由 → scope」清单，供 web 网关做能力判决与覆盖率守卫。
 *
 * 为什么生成而不是手写：枢纽有 200+ 条路由，手写清单必然漏。枢纽在注册时已经
 * 用 `config.scope` 声明了 public/read/write/admin（缺省 public），这里把那份
 * 声明原样搬过来；`--check` 在 CI 里校验生成物是否过期，新增路由若没重新生成，
 * 网关的策略测试会先失败，而不是让一条管理路由静默变成匿名可达。
 *
 * 用法：
 *   node scripts/gen-hub-route-policy.mjs           # 写入 apps/web-overlay/src/lib/hub-route-policy.generated.ts
 *   node scripts/gen-hub-route-policy.mjs --check   # 只校验，过期则退出 1
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(".");
const ROUTES_DIR = join(ROOT, "apps", "api", "src", "routes");
const OUT = join(ROOT, "apps", "web-overlay", "src", "lib", "hub-route-policy.generated.ts");
const CHECK = process.argv.includes("--check");

const METHODS = "get|post|put|patch|delete";

/** 返回 [{method, path, scope, file}]；解析不到的注册直接抛错，避免静默漏项。 */
export function extractRoutes() {
  const out = [];
  // routes/ 之外还有少量路由注册在 server.ts（openapi / docs），漏掉会让网关默认拒绝它们
  const sources = [
    ...readdirSync(ROUTES_DIR)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => join(ROUTES_DIR, f)),
    ...readdirSync(join(ROOT, "apps", "api", "src"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => join(ROOT, "apps", "api", "src", f)),
  ];
  for (const file of sources) {
    const src = readFileSync(file, "utf8");
    const re = new RegExp(`app\\.(${METHODS})\\(`, "g");
    const hits = [...src.matchAll(re)];
    hits.forEach((m, i) => {
      const start = m.index + m[0].length;
      const end = i + 1 < hits.length ? hits[i + 1].index : src.length;
      const chunk = src.slice(start, end);
      const pathMatch = chunk.match(/^\s*"([^"]+)"/);
      if (!pathMatch || !pathMatch[1].startsWith("/api/")) return;
      // scope 一定写在路由配置里、且早于 handler 主体；取第一个声明即可
      const scopeMatch = chunk.match(/scope:\s*"([a-z]+)"/);
      out.push({
        method: m[1].toUpperCase(),
        path: pathMatch[1],
        scope: scopeMatch ? scopeMatch[1] : "public",
        file: file.replace(join(ROOT, "apps", "api", "src") + "\\", "").replace(join(ROOT, "apps", "api", "src") + "/", ""),
      });
    });
  }
  return out;
}

const KNOWN = new Set(["public", "read", "write", "admin"]);

function render(routes) {
  const sorted = [...routes].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  const lines = sorted.map(
    (r) => `  { method: ${JSON.stringify(r.method)}, path: ${JSON.stringify(r.path)}, scope: ${JSON.stringify(r.scope)} },`,
  );
  return `/**
 * 自动生成，请勿手改。来源：apps/api/src/routes/*.ts 的 config.scope 声明。
 * 重新生成：node scripts/gen-hub-route-policy.mjs
 */
export type HubRouteScope = "public" | "read" | "write" | "admin";

export interface HubRouteEntry {
  method: string;
  path: string;
  scope: HubRouteScope;
}

export const HUB_ROUTES: readonly HubRouteEntry[] = [
${lines.join("\n")}
];
`;
}

const routes = extractRoutes();
const unknown = routes.filter((r) => !KNOWN.has(r.scope));
if (unknown.length) {
  console.error("[gen-hub-route-policy] 发现未知 scope：");
  for (const r of unknown) console.error(`  ${r.method} ${r.path} -> ${r.scope} (${r.file})`);
  process.exit(1);
}
if (routes.length < 150) {
  console.error(`[gen-hub-route-policy] 只解析到 ${routes.length} 条路由，低于预期（>150），解析规则可能失效`);
  process.exit(1);
}

const next = render(routes);
if (CHECK) {
  const prev = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (prev !== next) {
    console.error("[gen-hub-route-policy] 生成物已过期：请运行 node scripts/gen-hub-route-policy.mjs");
    process.exit(1);
  }
  console.log(`[gen-hub-route-policy] OK（${routes.length} 条路由）`);
} else {
  writeFileSync(OUT, next, "utf8");
  console.log(`[gen-hub-route-policy] 写入 ${routes.length} 条路由 -> ${OUT}`);
}
