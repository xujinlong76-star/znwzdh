#!/usr/bin/env node
/**
 * hubId 一次性回填脚本（03-livelink-mapping §2.2）。
 *
 * 实测 verdict（W1 §13.1，2026-11-20）：情况一成立——完整 runSeed 文件库
 * 实测 383/383 原样保留 nav-<hex> id，seed-data.json 兜底循环在基线
 * imported 时整段跳过（库内 source='seed' 行数 0）。因此回填成本为零：
 * 每条加 `hubId = id`，不做任何 url 匹配、不出人工复核清单。
 *
 * 写盘方式：手术式行插入——在每个站点 `"id": "nav-<hex>"` 行后插入同缩进
 * 的 `"hubId": "<id>"` 行，其余字节原样保留（navigation.json 全文件并非
 * JSON.stringify(…, 2) 的输出，直接重 stringify 会顺带改掉个别手写缩进，
 * 污染 diff）。写盘前先校验（见 planBackfill），写盘后用
 * scripts/check-hub-id.mjs 全量验证。
 *
 * 用法：
 *   node scripts/backfill-hub-id.mjs --dry-run   # 只出报告，不写盘
 *   node scripts/backfill-hub-id.mjs             # 备份 + 写盘 + 自校验
 *
 * 备份：写盘前把原文件拷到 scripts/backfill-hub-id.<YYYY-MM-DD>.bak.json
 * （与仓库同目录，不进 git，跑完即删；git HEAD 里另有原文件可恢复）。
 * 不发任何网络请求，不写仓库其他文件。
 */
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const NAV_PATH = join(ROOT, "apps", "web-overlay", "src", "navsphere", "content", "navigation.json");

/** 站点 id 形如 nav-<hex>：实测 377 条 12 位 + 6 条 16 位（见下），不写死长度。 */
export const SITE_ID_RE = /^nav-[0-9a-f]+$/;

/** 6 个 16 位 hex id 的站（W1 实测发现，写死 12 位会误杀它们）。 */
export const ID16_TITLES = ["Portainer", "OpenShift", "Nomad", "Microsoft Learn", "Iconfont", "彩云天气"];

/**
 * 从导航文档收集站点条目（14 大类 / 48 子分类结构）。
 * 返回 { categories, subCategories, items: [{ id, title, href, hubId? }] }。
 */
export function collectItems(doc) {
  const items = [];
  let subCategories = 0;
  const categories = Array.isArray(doc?.navigationItems) ? doc.navigationItems : [];
  for (const cat of categories) {
    for (const sc of cat?.subCategories ?? []) {
      subCategories++;
      for (const it of sc?.items ?? []) {
        items.push({ id: it?.id, title: it?.title, href: it?.href, hubId: it?.hubId ?? null });
      }
    }
  }
  return { categories: categories.length, subCategories, items };
}

/**
 * 回填计划（纯函数，不写盘）：情况一 hubId = id。
 * 返回 { total, wouldSet, alreadySet, conflicts[], duplicates[], badIds[], id16[] }。
 */
export function planBackfill(doc) {
  const { categories, subCategories, items } = collectItems(doc);
  const seen = new Map();
  const conflicts = [];
  const duplicates = [];
  const badIds = [];
  const id16 = [];
  let wouldSet = 0;
  let alreadySet = 0;
  for (const it of items) {
    if (typeof it.id !== "string" || !SITE_ID_RE.test(it.id)) {
      badIds.push(String(it.id));
      continue;
    }
    if (seen.has(it.id)) duplicates.push(it.id);
    else seen.set(it.id, it.title);
    if (it.id.split("-")[1].length === 16) id16.push(`${it.id} ${it.title}`);
    if (it.hubId == null) wouldSet++;
    else if (it.hubId === it.id) alreadySet++;
    else conflicts.push({ id: it.id, title: it.title, hubId: it.hubId });
  }
  return { categories, subCategories, total: items.length, wouldSet, alreadySet, conflicts, duplicates, badIds, id16 };
}

const ID_LINE_RE = /^(\s*)"id": "(nav-[0-9a-f]+)",$/;

/**
 * 手术式回填（纯函数）：在每个站点 id 行后插入同缩进的 hubId 行。
 * 只用于尚无任何 hubId 的原始文本（调用方已 guard：raw 含 "hubId" 即拒绝），
 * 所以插入行数必须等于全部站点数；否则拒绝写盘。
 */
export function backfillText(raw, plan) {
  let inserted = 0;
  const out = raw.split("\n").map((line) => {
    const m = ID_LINE_RE.exec(line);
    if (!m) return line;
    inserted++;
    return `${line}\n${m[1]}"hubId": "${m[2]}",`;
  });
  if (inserted !== plan.total) {
    throw new Error(`id 行数 ${inserted} 与站点数 ${plan.total} 不一致，拒绝写盘`);
  }
  return out.join("\n");
}

function report(plan, dryRun) {
  const lines = [
    `${dryRun ? "DRY-RUN（未写盘）" : "写盘"}报告：hubId 回填（情况一：hubId = id）`,
    `大类 ${plan.categories} / 子分类 ${plan.subCategories} / 站点 ${plan.total}`,
    `待回填 ${plan.wouldSet} / 已回填 ${plan.alreadySet} / 冲突 ${plan.conflicts.length} / 重复 id ${plan.duplicates.length} / 非法 id ${plan.badIds.length}`,
    `16 位 hex id ${plan.id16.length} 条：${plan.id16.join("；") || "无"}`,
  ];
  if (plan.conflicts.length > 0) lines.push(`冲突：${JSON.stringify(plan.conflicts)}`);
  if (plan.duplicates.length > 0) lines.push(`重复 id：${plan.duplicates.join(", ")}`);
  if (plan.badIds.length > 0) lines.push(`非法 id：${plan.badIds.join(", ")}`);
  return lines.join("\n");
}

const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  const raw = readFileSync(NAV_PATH, "utf8");
  if (raw.includes('"hubId"')) {
    console.error("navigation.json 里已有 hubId 字段：请先跑 check-hub-id.mjs 确认状态，不要重复回填");
    process.exit(1);
  }
  const doc = JSON.parse(raw);
  const plan = planBackfill(doc);
  console.log(report(plan, dryRun));
  if (plan.conflicts.length > 0 || plan.duplicates.length > 0 || plan.badIds.length > 0 || plan.total === 0) {
    console.error("校验未通过（冲突/重复/非法 id），拒绝写盘");
    process.exit(1);
  }
  if (dryRun) process.exit(0);
  // 写盘：先备份，再手术式写入，最后重读自校验。
  const stamp = new Date().toISOString().slice(0, 10);
  const backupPath = join(ROOT, "scripts", `backfill-hub-id.${stamp}.bak.json`);
  copyFileSync(NAV_PATH, backupPath);
  console.log(`已备份原文件到 ${backupPath}（不进 git，跑完即删）`);
  const next = backfillText(raw, plan);
  writeFileSync(NAV_PATH, next, "utf8");
  const after = planBackfill(JSON.parse(readFileSync(NAV_PATH, "utf8")));
  if (after.total !== plan.total || after.wouldSet !== 0 || after.alreadySet !== plan.total) {
    console.error(`写盘后自校验失败：${JSON.stringify(after)}，原文件在 ${backupPath}`);
    process.exit(1);
  }
  console.log(`写盘完成：${after.alreadySet}/${after.total} 条 hubId 已就位（备份 ${backupPath}，校验通过后删除）`);
  rmSync(backupPath, { force: true });
  console.log("备份已删除（git HEAD 可恢复原文件）");
}
