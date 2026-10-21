#!/usr/bin/env node
/**
 * 标签描述回填：把 `docs/seo/tag-descriptions-draft.md` 里的描述写进 tags.description。
 *
 * 为什么有它：tags 表的 description 列自迁移起就是空的（migrate.ts:52），
 * 82 个「≥5 站点」标签页因此没有meta description 也没有页面文案。
 * 文案由内容流程产出并审校，落在 docs/seo/tag-descriptions-draft.md——
 * 本脚本是那条 markdown 到数据库的唯一通道：**markdown 是事实源，本脚本不含文案副本**
 * （改文案请改 markdown 后重跑，不会漂移）。
 *
 * 匹配口径：按 **name** 匹配（content-writer 的清单即按名字聚合）。slug 由
 * store 的 slugify 派生（dialect.ts），名字与 slug 在当前数据里一致，但名字才是
 * 人工可读的锚。
 *
 * 行为：
 *   - 默认 dry-run：只打印将要写入的差异，不碰数据库；
 *   - --apply：真正写入（逐条 updateTag，幂等——描述相同的条目跳过）；
 *   - 只更新 draft 里有的标签；DB 里有描述而 draft 没有的标签**不动**；
 *   - draft 里找不到对应标签的行报 missing（名字对不上通常是标签被改名/合并）；
 *   - 超过 200 字的描述拒绝写入（与 PATCH /api/tags/:id 的 zod 上限一致）。
 *
 * 用法：
 *   node --experimental-strip-types scripts/tag-descriptions.mjs              # dry-run
 *   node --experimental-strip-types scripts/tag-descriptions.mjs --apply      # 写入
 *   node --experimental-strip-types scripts/tag-descriptions.mjs --db <path>  # 指定 SQLite
 *   环境变量：NAVHUB_SQLITE_PATH（与 data-retention.mjs 同口径，兜底 data/navhub.db）
 *
 * 退出码：0 成功（含 dry-run）；1 失败（含存在 missing/超长行）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../packages/store/src/driver.ts";
import { Repository } from "../packages/store/src/repository.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRAFT = path.join(ROOT, "docs", "seo", "tag-descriptions-draft.md");
const MAX_LEN = 200; // 与 apps/api/src/routes/tags.ts 的 z.string().max(200) 一致

function parseArgs(argv) {
  const args = { apply: false, db: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") args.apply = true;
    else if (argv[i] === "--db") args.db = argv[++i] ?? null;
  }
  return args;
}

/** 解析 draft 的 markdown 表格 → [{ name, count, description }] */
function parseDraft(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith("| ")) continue;
    const cells = line.split("|").map((s) => s.trim());
    // split 后首尾各有一个空串，数据单元格从 index 1 开始
    const [name, count, description] = [cells[1], cells[2], cells[3]];
    if (!name || name === "标签" || /^-+$/.test(name)) continue; // 表头与分隔行
    if (!description) continue; // 分隔行
    rows.push({ name, count: Number(count) || 0, description });
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = parseDraft(DRAFT);
  if (rows.length === 0) {
    console.error(`[tag-descriptions] draft 解析出 0 行：${DRAFT}`);
    process.exit(1);
  }
  const tooLong = rows.filter((r) => r.description.length > MAX_LEN);
  if (tooLong.length > 0) {
    console.error(`[tag-descriptions] ${tooLong.length} 条超过 ${MAX_LEN} 字上限，拒绝写入：`);
    for (const r of tooLong) console.error(`  - ${r.name}（${r.description.length} 字）`);
    process.exit(1);
  }

  const dbPath = args.db ?? process.env.NAVHUB_SQLITE_PATH ?? "data/navhub.db";
  const db = await openDb({ dialect: "sqlite", sqlitePath: path.resolve(ROOT, dbPath) });
  const repo = new Repository(db);
  try {
    const tags = await repo.listTagsWithCounts(1);
    const byName = new Map(tags.map((t) => [t.name, t]));

    let same = 0;
    let willUpdate = 0;
    let missing = 0;
    for (const row of rows) {
      const tag = byName.get(row.name);
      if (!tag) {
        console.log(`  MISSING  ${row.name}——DB 里没有这个名字的标签（改名/合并？）`);
        missing++;
        continue;
      }
      const current = tag.description ? String(tag.description) : null;
      if (current === row.description) {
        same++;
        continue;
      }
      willUpdate++;
      console.log(`  ${current ? "UPDATE " : "FILL   "} ${row.name}（${tag.count} 站）${current ? "：「" + current.slice(0, 20) + "…」→" : ""}「${row.description.slice(0, 24)}…」`);
    }

    console.log(
      `[tag-descriptions] draft ${rows.length} 条 | 已一致 ${same} | 待写入 ${willUpdate} | missing ${missing} | db=${dbPath} | mode=${args.apply ? "APPLY" : "DRY-RUN"}`,
    );
    if (!args.apply) {
      console.log("[tag-descriptions] dry-run 未写库；加 --apply 执行。");
      if (missing > 0) process.exitCode = 1;
      return;
    }

    let applied = 0;
    for (const row of rows) {
      const tag = byName.get(row.name);
      if (!tag) continue;
      const current = tag.description ? String(tag.description) : null;
      if (current === row.description) continue;
      await repo.updateTag(tag.id, { description: row.description });
      applied++;
    }
    console.log(`[tag-descriptions] 已写入 ${applied} 条。`);
    if (missing > 0) process.exitCode = 1;
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error("[tag-descriptions] 失败：", err);
  process.exit(1);
});
