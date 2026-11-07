#!/usr/bin/env node
/**
 * 离线/启动前数据清洗与类目重构执行脚本。
 *
 * 用法：
 *   node scripts/clean-taxonomy-and-duplicates.mjs
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const dbPath = process.env.NAVHUB_SQLITE_PATH || resolve(rootDir, "data/navhub.db");

if (!existsSync(dbPath)) {
  console.error(`[clean] 数据库文件未找到: ${dbPath}`);
  process.exit(1);
}

const storeRequire = createRequire(resolve(rootDir, "packages/store/package.json"));
const Database = storeRequire("better-sqlite3");

console.log(`[clean] 正在打开数据库: ${dbPath}`);
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF"); // 清洗期间临时关闭外键，避免级联锁

const now = Date.now();
let categoriesCreated = 0;
let sitesReclassified = 0;
let sitesDeduplicated = 0;

// 1. 确保新类目在 categories 表中落地
const newCats = [
  {
    id: "reg-prompt-engineering",
    anchor: "ai-tools/prompt-engineering",
    parentId: "reg-ai-tools",
    title: "提示词工程",
    slug: "prompt-engineering",
    description: "提示词模板库、Prompt 优化技巧、系统提示与上下文工程指南",
    sort: 9,
  },
  {
    id: "reg-inference-and-deployment",
    anchor: "backend-and-cloud/inference-and-deployment",
    parentId: "reg-backend-and-cloud",
    title: "推理与端侧",
    slug: "inference-and-deployment",
    description: "高并发推理服务引擎、端侧模型量化、模型编译与本地执行运行时",
    sort: 13,
  },
  {
    id: "reg-embodied-ai-and-robotics",
    anchor: "ai-tools/embodied-ai-and-robotics",
    parentId: "reg-ai-tools",
    title: "具身智能与硬件",
    slug: "embodied-ai-and-robotics",
    description: "机器人具身算法、机器人仿真环境、空间智能与物理世界交互系统",
    sort: 13,
  },
];

for (const cat of newCats) {
  const existing = db.prepare("SELECT id FROM categories WHERE id = ? OR slug = ?").all(cat.id, cat.slug);
  if (existing.length === 0) {
    db.prepare(
      "INSERT INTO categories (id, anchor, parent_id, title, slug, description, sort, enabled, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'registry', ?, ?)"
    ).run(cat.id, cat.anchor, cat.parentId, cat.title, cat.slug, cat.description, cat.sort, now, now);
    categoriesCreated++;
    console.log(`[clean] 创建新类目: ${cat.title} (${cat.id})`);
  }
}

// 2. 错位纠偏：稿定设计与创客贴迁至 设计与创意 (reg-inspiration-and-showcase)
const designTarget = db.prepare("SELECT id FROM categories WHERE id = 'reg-inspiration-and-showcase' OR slug = 'inspiration-and-showcase'").all();
if (designTarget.length > 0) {
  const targetCatId = designTarget[0].id;
  const misclassifiedDesign = db.prepare(
    "SELECT id, title FROM sites WHERE (url LIKE '%gaoding.com%' OR title LIKE '%稿定设计%' OR url LIKE '%chuangkit.com%' OR title LIKE '%创客贴%') AND category_id <> ?"
  ).all(targetCatId);
  for (const row of misclassifiedDesign) {
    db.prepare("UPDATE sites SET category_id = ?, updated_at = ? WHERE id = ?").run(targetCatId, now, row.id);
    sitesReclassified++;
    console.log(`[clean] 重定位错位设计工具: ${row.title} -> ${targetCatId}`);
  }
}

// 3. 错位纠偏：端侧推理引擎迁至 推理部署与端侧框架 (reg-inference-and-deployment)
const inferenceTarget = db.prepare("SELECT id FROM categories WHERE id = 'reg-inference-and-deployment' OR slug = 'inference-and-deployment'").all();
if (inferenceTarget.length > 0) {
  const targetCatId = inferenceTarget[0].id;
  const inferenceSites = db.prepare(
    "SELECT id, title FROM sites WHERE (url LIKE '%llama.cpp%' OR url LIKE '%vllm%' OR url LIKE '%text-generation-inference%' OR url LIKE '%openvino%' OR url LIKE '%tvm.apache.org%' OR url LIKE '%triton%' OR url LIKE '%mlc-ai%' OR url LIKE '%whisper.cpp%' OR title LIKE '%llama.cpp%' OR title LIKE '%OpenVINO%' OR title LIKE '%Apache TVM%') AND category_id <> ?"
  ).all(targetCatId);
  for (const row of inferenceSites) {
    db.prepare("UPDATE sites SET category_id = ?, updated_at = ? WHERE id = ?").run(targetCatId, now, row.id);
    sitesReclassified++;
    console.log(`[clean] 重定位推理框架: ${row.title} -> ${targetCatId}`);
  }
}

// 4. 错位纠偏：提示词工程迁至 提示词工程 (reg-prompt-engineering)
const promptTarget = db.prepare("SELECT id FROM categories WHERE id = 'reg-prompt-engineering' OR slug = 'prompt-engineering'").all();
if (promptTarget.length > 0) {
  const targetCatId = promptTarget[0].id;
  const promptSites = db.prepare(
    "SELECT id, title FROM sites WHERE (url LIKE '%promptingguide.ai%' OR url LIKE '%docs.anthropic.com%prompt%' OR url LIKE '%cookbook.openai.com%' OR url LIKE '%flowgpt.com%' OR url LIKE '%prompthero.com%' OR title LIKE '%提示词%' OR title LIKE '%提示工程%') AND category_id <> ?"
  ).all(targetCatId);
  for (const row of promptSites) {
    db.prepare("UPDATE sites SET category_id = ?, updated_at = ? WHERE id = ?").run(targetCatId, now, row.id);
    sitesReclassified++;
    console.log(`[clean] 重定位提示词工程资源: ${row.title} -> ${targetCatId}`);
  }
}

// 5. 辅助合并删除重复站点函数
const mergeAndDeleteDuplicate = (keepId, dupId) => {
  if (keepId === dupId) return;
  const keep = db.prepare("SELECT id, title, url FROM sites WHERE id = ?").all(keepId);
  const dup = db.prepare("SELECT id, title, url FROM sites WHERE id = ?").all(dupId);
  if (keep.length === 0 || dup.length === 0) return;

  // 转移 favorites
  const dupFavs = db.prepare("SELECT user_id, folder_id, note, tags, created_at, updated_at FROM favorites WHERE site_id = ?").all(dupId);
  for (const fav of dupFavs) {
    const hasKeepFav = db.prepare("SELECT id FROM favorites WHERE user_id = ? AND site_id = ?").all(fav.user_id, keepId);
    if (hasKeepFav.length === 0) {
      db.prepare("UPDATE favorites SET site_id = ? WHERE site_id = ? AND user_id = ?").run(keepId, dupId, fav.user_id);
    } else {
      db.prepare("DELETE FROM favorites WHERE site_id = ? AND user_id = ?").run(dupId, fav.user_id);
    }
  }

  // 转移 events
  db.prepare("UPDATE events SET site_id = ? WHERE site_id = ?").run(keepId, dupId);

  // 转移 collection_items
  const dupCollections = db.prepare("SELECT collection_id FROM collection_items WHERE site_id = ?").all(dupId);
  for (const col of dupCollections) {
    const hasKeepCol = db.prepare("SELECT collection_id FROM collection_items WHERE collection_id = ? AND site_id = ?").all(col.collection_id, keepId);
    if (hasKeepCol.length === 0) {
      db.prepare("UPDATE collection_items SET site_id = ? WHERE site_id = ? AND collection_id = ?").run(keepId, dupId, col.collection_id);
    } else {
      db.prepare("DELETE FROM collection_items WHERE site_id = ? AND collection_id = ?").run(dupId, col.collection_id);
    }
  }

  // 清理关系与关联
  db.prepare("DELETE FROM site_tags WHERE site_id = ?").run(dupId);
  db.prepare("DELETE FROM site_facets WHERE site_id = ?").run(dupId);
  db.prepare("DELETE FROM site_relations WHERE source_site_id = ? OR target_site_id = ?").run(dupId, dupId);
  db.prepare("DELETE FROM sites WHERE id = ?").run(dupId);
  sitesDeduplicated++;
  console.log(`[clean] 合并重复站点: 删除副本 ${dup[0].title} (${dupId})，保留主记录 (${keepId})`);
};

// 精确消除重复项
mergeAndDeleteDuplicate("385c18b1-aa13-4a5c-a18c-be3fb3f9b51d", "ef75c24d-dcf0-45b9-9068-c15ef9d2ab29"); // Cursor
mergeAndDeleteDuplicate("bf2b2dc4-957a-43df-96e3-67b101fb419a", "d0c72c62-c39d-47e7-a0ae-59b04586e710"); // 多邻国
mergeAndDeleteDuplicate("34701294-dc83-4201-8c39-ca26937614a2", "d68c3fe6-859d-48dd-853c-f46313b4695b"); // 新华网
mergeAndDeleteDuplicate("5311d2e0-8369-4235-8ca1-ebdf494159d1", "94d43da1-33eb-4703-be77-aad597071bf8"); // 达芬奇

// LeetCode 差异化处理：4b93a8b4-aee4-4707-a742-e7b80d254d84 转为 AcWing 算法交流
const leetCodeDup = db.prepare("SELECT id, title, url FROM sites WHERE id = '4b93a8b4-aee4-4707-a742-e7b80d254d84'").all();
if (leetCodeDup.length > 0 && leetCodeDup[0].title.includes("LeetCode")) {
  db.prepare(
    "UPDATE sites SET title = 'AcWing 算法交流', url = 'https://www.acwing.com/', description = '知名的中文算法与数据结构学习社区，包含 LeetCode 题解、算法基础课与周赛精讲。', updated_at = ? WHERE id = '4b93a8b4-aee4-4707-a742-e7b80d254d84'"
  ).run(now);
  sitesReclassified++;
  console.log("[clean] 更新重复 LeetCode 记录为 AcWing 算法交流");
}

// 6. 通用 Canonical URL 深度查重与合并
const allSites = db.prepare("SELECT id, url, title, created_at FROM sites WHERE deleted_at IS NULL ORDER BY created_at ASC").all();
const seenByCanonical = new Map();

const getCanonicalUrlKey = (u) => {
  try {
    const parsed = new URL(u.startsWith("http") ? u : `https://${u}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    let path = parsed.pathname.replace(/\/+$/, "");
    if (!path) path = "";
    return `${host}${path}`;
  } catch {
    return u.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
  }
};

for (const s of allSites) {
  const key = getCanonicalUrlKey(s.url);
  if (!key) continue;
  const existingId = seenByCanonical.get(key);
  if (!existingId) {
    seenByCanonical.set(key, s.id);
  } else if (existingId !== s.id) {
    mergeAndDeleteDuplicate(existingId, s.id);
  }
}

// 7. 写入版本迁移表，避免重复执行
try {
  db.prepare(
    "INSERT INTO _schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?) ON CONFLICT(version) DO NOTHING"
  ).run("20261107_clean_taxonomy_and_duplicates", "类目重构、错位纠偏与存量重复站点数据清洗", now, "v1_clean_taxonomy_and_duplicates");
} catch {}

db.pragma("foreign_keys = ON");
db.close();

console.log("\n==========================================");
console.log(`[clean] 清洗完成！`);
console.log(`- 落地新增类目: ${categoriesCreated} 个`);
console.log(`- 重分类/纠偏站点: ${sitesReclassified} 个`);
console.log(`- 消除重复站点: ${sitesDeduplicated} 个`);
console.log("==========================================\n");
