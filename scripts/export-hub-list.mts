/**
 * 导出中枢站点全量清单（03 §2.4 中枢交叉校验的数据源）。
 *
 * 数据源 verdict（W1 §13-3，2026-11-20）：`ctx.repo.listAllSites(undefined, {})`
 * 经 `createContext` 直连库，无 LIMIT、无分页、无采样；`GET /api/sites`
 * 分页（默认 100、上限 1000）不采用。
 *
 * 做法（复用 W1 实测方法与 gen-nav-baseline.mjs 的写法）：全新空文件库跑
 * 完整 `runSeed({ withEmbeddings: false })`（基线通道导入 navigation.json
 * 的 383 站），再 `listAllSites(undefined, {})` 全量导出 `[{ id, url }]`。
 * 只碰 tmpdir 下的一次性库，绝不读 `data/navhub.db`、不碰线上库。
 *
 * 用法：
 *   node scripts/export-hub-list.mts --out /tmp/hub-list.json
 *   node scripts/export-hub-list.mts --out /tmp/hub-list.json --keep-db  # 保留临时库排查
 * 产物供 `node scripts/check-hub-id.mjs --hub-list <path>` 消费。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSeed } from "../apps/api/src/seed.ts";
import { createContext } from "../apps/api/src/context.ts";
import { loadConfig } from "../apps/api/src/config.ts";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
if (outIdx === -1 || !args[outIdx + 1]) {
  console.error("用法：node scripts/export-hub-list.mts --out <path> [--keep-db]");
  process.exit(2);
}
const outPath = args[outIdx + 1];
const keepDb = args.includes("--keep-db");

const dir = mkdtempSync(join(tmpdir(), "navhub-hub-list-"));
const dbPath = join(dir, "hub-list.db");
process.env.NAVHUB_MODE = "lite";
process.env.NAVHUB_SQLITE_PATH = dbPath;
// 只关心 id/url 清单，向量不必启动（W1 同款绕过）
process.env.NAVHUB_EMBEDDING_ENABLED = "false";

let ctx = null;
try {
  const seed = await runSeed({ withEmbeddings: false });
  console.log(`[seed] 类目 ${seed.categories} / 站点 ${seed.sites}`);
  ctx = await createContext(loadConfig());
  // W1 §13-3 verdict：全量清单源，无 LIMIT、无分页、无采样
  const sites = await ctx.repo.listAllSites(undefined, {});
  const list = sites.map((s) => ({ id: s.id, url: s.url }));
  writeFileSync(outPath, JSON.stringify(list, null, 2) + "\n", "utf8");
  const nonNav = list.filter((s) => !s.id.startsWith("nav-")).length;
  console.log(`[export] 全量 ${list.length} 条 → ${outPath}（非 nav- id ${nonNav} 条）`);
} finally {
  await ctx?.close();
  if (!keepDb) rmSync(dir, { recursive: true, force: true });
  else console.log(`[export] 临时库保留在 ${dir}`);
}
