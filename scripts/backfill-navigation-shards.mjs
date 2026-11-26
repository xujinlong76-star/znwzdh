#!/usr/bin/env node
/**
 * 导航分片一次性回填脚本（U-386）。
 *
 * 为什么需要这个脚本：分片派生（deriveNavigationShards）以前只有三条间接触发
 * ——写导航后、启动预热、读分片时惰性自愈。存量库一旦出现分片缺失/过期
 * （旧版本升级上来、中途删片、派生失败后无人重跑），没有任何入口能一次性修复。
 * 本脚本是该修复的运维入口（与 backfill-facets.mjs 同款定位：一次性运维/
 * 校验工具；运行时回填仍由写路径与惰性自愈负责）。
 *
 * 做法：只做编排与报告，不自己算分片——派生口径住在服务端
 * （apps/api/src/storage.ts 的 backfillNavigationShards，复用同一个
 * deriveNavigationShards），脚本调管理端点，免得出现「脚本说齐了、
 * 服务端说缺了」这种口径分裂。
 *
 * 用法（默认 dry-run，不写库）：
 *   node scripts/backfill-navigation-shards.mjs                 # 现状 + 回填计划，不写
 *   node scripts/backfill-navigation-shards.mjs --apply         # 真正落库 + 前后对照
 *   node scripts/backfill-navigation-shards.mjs --apply --api-base http://127.0.0.1:8787
 *
 * 环境：
 *   NAVHUB_API_URL（默认 http://127.0.0.1:8787）
 *   NAVHUB_ADMIN_TOKEN / NAVHUB_BOOTSTRAP_TOKEN / NAVHUB_STORAGE_TOKEN（开启
 *   NAVHUB_AUTH_REQUIRED 的部署必须配其一；开发模式默认开放鉴权，不配也能跑。
 *   token 只进 Authorization 请求头，绝不打印。）
 *
 * 前置：中枢 API 必须在跑。退出码：0 = 完成（dry-run 发现待写项也算完成，
 * 只报告不判错）；1 = 调不通 / 鉴权失败 / 服务端回填失败。
 */
import { fileURLToPath } from "node:url";
import process from "node:process";

export function parseArgs(argv) {
  const args = argv.slice(2);
  const apply = args.includes("--apply");
  const apiBaseFlag = (() => {
    const i = args.indexOf("--api-base");
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1].replace(/\/+$/, "") : null;
  })();
  return { apply, apiBase: apiBaseFlag ?? (process.env.NAVHUB_API_URL || "http://127.0.0.1:8787").replace(/\/+$/, "") };
}

function adminHeaders() {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  const token =
    process.env.NAVHUB_ADMIN_TOKEN || process.env.NAVHUB_BOOTSTRAP_TOKEN || process.env.NAVHUB_STORAGE_TOKEN || "";
  if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  return headers;
}

async function callApi(apiBase, method, path, body) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: adminHeaders(),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `管理端点拒绝访问（HTTP ${res.status}）：请确认 NAVHUB_ADMIN_TOKEN（或 NAVHUB_BOOTSTRAP_TOKEN）与中枢配置一致；开发模式（NAVHUB_AUTH_REQUIRED 未开启）下不应出现此错误`,
    );
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${method} ${path}：${(data?.error ?? text).toString().slice(0, 200)}`);
  }
  return data;
}

/** 回填报告的纯文本摘要（纯函数，供 --dry-run 输出与测试复用）。 */
export function summarizeReport(report) {
  const lines = [];
  lines.push(
    `数据版本 data_version=${report.dataVersion}，派生源版本 sourceVersion=${report.sourceVersion}，` +
      `分类 ${report.categories} 个，共 ${report.totalItems} 站`,
  );
  if (report.empty) {
    lines.push("public 快照为空库：不派生空索引（与 ensureNavigationShardsFresh 的空库保护一致），无写入。");
    return lines.join("\n");
  }
  const byChange = {};
  for (const w of report.writes) byChange[w.change] = (byChange[w.change] ?? 0) + 1;
  lines.push(
    `分片文档 ${report.writes.length} 份：` +
      `缺失 ${byChange.missing ?? 0} / 过期 ${byChange.stale ?? 0} / 内容有变 ${byChange.changed ?? 0} / 无变化 ${byChange.unchanged ?? 0}`,
  );
  for (const w of report.writes) {
    if (w.change === "unchanged") continue;
    lines.push(`  [${w.change}] ${w.path}`);
  }
  if (report.dryRun) {
    lines.push(`DRY-RUN：将写入 ${report.wouldWrite} 份，未写入。确认无误后加 --apply 真正落库。`);
  } else {
    lines.push(`已写入 ${report.wrote} 份，跳过无变化 ${report.skippedUnchanged} 份。`);
  }
  return lines.join("\n");
}

export function summarizeStatus(status) {
  const lines = [];
  lines.push(
    `现状：data_version=${status.dataVersion ?? "取不到"}，索引版本=${status.indexPresent ? status.indexSourceVersion : "缺失"}，` +
      `fresh=${status.fresh}，缺失分片 ${status.missingShards.length} 份，过期分片 ${status.staleShards.length} 份`,
  );
  if (status.lastFallback) {
    lines.push(
      `最近一次读回落：${new Date(status.lastFallback.at).toISOString()}（${status.lastFallback.reason}，累计 ${status.lastFallback.count} 次）`,
    );
  }
  return lines.join("\n");
}

async function main() {
  const { apply, apiBase } = parseArgs(process.argv);
  console.log(`[shard-backfill] 中枢：${apiBase}${apply ? "（--apply：真正落库）" : "（DRY-RUN：不写库；加 --apply 才落盘）"}`);
  let before;
  try {
    before = await callApi(apiBase, "GET", "/api/admin/navigation-shards/status");
  } catch (err) {
    console.error("[shard-backfill] 读现状失败：", err.message);
    console.error("[shard-backfill] 请确认中枢 API 在跑（默认 http://127.0.0.1:8787，可用 NAVHUB_API_URL 或 --api-base 覆盖）。");
    process.exit(1);
  }
  console.log(summarizeStatus(before));

  const plan = await callApi(apiBase, "POST", "/api/admin/navigation-shards/backfill", { dryRun: true }).catch((err) => {
    console.error("[shard-backfill] dry-run 失败：", err.message);
    process.exit(1);
  });
  console.log(summarizeReport(plan));
  if (!apply) return;

  const applied = await callApi(apiBase, "POST", "/api/admin/navigation-shards/backfill", { dryRun: false }).catch(
    (err) => {
      console.error("[shard-backfill] 回填落库失败：", err.message);
      process.exit(1);
    },
  );
  console.log(summarizeReport(applied));
  const after = await callApi(apiBase, "GET", "/api/admin/navigation-shards/status").catch(() => null);
  if (after) {
    console.log("[shard-backfill] 回填后对照：");
    console.log(summarizeStatus(after));
    if (!after.fresh) {
      console.error("[shard-backfill] 注意：回填后现状仍不是 fresh，请核对服务端日志（[navigation] 分片派生失败）。");
      process.exit(1);
    }
  }
}

// import.meta.url 直跑时才执行；被测试 import 时只导出纯函数（backfill-hub-id.mjs 同款守卫）。
const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
