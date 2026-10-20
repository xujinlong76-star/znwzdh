/**
 * 单个种子插件文件的离线校验器（开发期工具，不参与构建）。
 *
 * 为什么需要：新增的网址包分散在 `src/seed-data/site-packs/*.ts`，
 * 在接入聚合入口之前无法被 `apps/api/test/seed-plugins.test.ts` 覆盖。
 * 本脚本直接加载单个文件并跑 core 契约校验，把「写错了要等到最后才发现」
 * 提前到写完即知。
 *
 * 用法（在仓库根目录执行）：
 *   node apps/api/.validate-pack.mts src/seed-data/site-packs/news-media.ts newsMediaPack
 *
 * 放在 apps/api 目录下是为了让 `@navhub/core` 通过 apps/api/node_modules 解析到。
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { validateAndCleanPluginManifest } from "@navhub/core";

const [fileArg, exportArg] = process.argv.slice(2);
if (!fileArg || !exportArg) {
  console.error("用法: node apps/api/.validate-pack.mts <文件路径> <导出名>");
  process.exit(2);
}

const mod = (await import(pathToFileURL(resolve(process.cwd(), fileArg)).href)) as Record<string, unknown>;
const def = mod[exportArg] as { slug?: string; status?: string; manifest?: unknown } | undefined;
if (!def) {
  console.error(`✗ 未找到导出 ${exportArg}（文件：${fileArg}）`);
  process.exit(2);
}

const result = validateAndCleanPluginManifest(def.manifest);
if (!result.ok) {
  console.error(`✗ ${def.slug ?? exportArg} 契约校验失败：`);
  for (const err of result.errors) console.error("   - " + err);
  process.exit(1);
}

const m = result.manifest;
const problems: string[] = [];
let detail = "";
if (m.kind === "site-pack") {
  const cats = m.payload.categories ?? [];
  const declared = new Set(cats.map((c) => c.title));
  const counts = new Map<string, number>();
  let missingField = 0;
  for (const s of m.payload.sites) {
    const key = s.category ?? "-";
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!s.description?.trim() || !s.category || !s.subCategory || !(s.tags?.length ?? 0)) missingField++;
  }
  const orphan = [...counts.keys()].filter((c) => c !== "-" && !declared.has(c));
  const empty = cats.filter((c) => !counts.has(c.title)).map((c) => c.title);
  const thin = cats
    .filter((c) => (counts.get(c.title) ?? 0) < 6)
    .map((c) => `${c.title}(${counts.get(c.title) ?? 0})`);

  detail =
    `分类 ${cats.length} / 站点 ${m.payload.sites.length} / 字段不全 ${missingField}`;
  if (orphan.length) problems.push(`站点引用了未声明分类：${orphan.join("、")}`);
  if (empty.length) problems.push(`有声明了却没站点的空分类：${empty.join("、")}`);
  if (thin.length) problems.push(`分类站点数不足 6：${thin.join("、")}`);
  if (cats.length < 18) problems.push(`分类数 ${cats.length} < 18（本轮加深目标）`);
  if (m.payload.sites.length < 190) problems.push(`站点数 ${m.payload.sites.length} < 190（本轮加深目标）`);
} else if (m.kind === "search-pack") detail = `引擎 ${m.payload.engines.length}`;
else if (m.kind === "theme") detail = `色板 ${Object.keys(m.payload.tokens ?? {}).length} 项`;
else if (m.kind === "workspace-preset") {
  let w = 0;
  for (const b of m.payload.boards) w += b.widgets.length;
  detail = `看板 ${m.payload.boards.length} / 模块 ${w}`;
} else if (m.kind === "bundle") detail = `成员 ${m.payload.items.length}`;

console.log(`✓ 契约通过 | ${def.slug} | ${m.kind} | ${detail}`);
if (result.warnings.length) console.log("  warnings:", result.warnings.join("; "));
if (problems.length) {
  // 契约通过但内容未达标：结构性问题（悬空/空分类）视为失败，规模问题只提示
  const structural = problems.filter((p) => p.startsWith("站点引用了") || p.startsWith("有声明了却"));
  for (const p of problems) console.log(`  ${structural.includes(p) ? "✗" : "!"} ${p}`);
  if (structural.length) process.exit(1);
}
