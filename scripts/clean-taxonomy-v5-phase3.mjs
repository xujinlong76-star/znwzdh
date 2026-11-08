import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import crypto from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const dbPath = process.env.NAVHUB_SQLITE_PATH || resolve(rootDir, "data/navhub.db");

if (!existsSync(dbPath)) {
  console.error(`[clean] 数据库文件未找到: ${dbPath}`);
  process.exit(1);
}

const storeRequire = createRequire(resolve(rootDir, "packages/store/package.json"));
const Database = storeRequire("better-sqlite3");

console.log(`[clean-phase3] 正在打开数据库: ${dbPath}`);
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF");

const now = Date.now();

// 1. reg-anime-and-fandom:
// Move Future of Life Institute to reg-ai-safety-and-alignment
// Move SFWA out of top 4 (sort: 99)
// Promote 萌娘百科 to sort: 3
// Promote Bangumi 番组计划 to sort: 4
db.prepare("UPDATE sites SET category_id = 'reg-ai-safety-and-alignment', updated_at = ? WHERE id = 'e376761d-bdef-496c-8555-83bf3f9152d0'").run(now);
db.prepare("UPDATE sites SET sort = 99, updated_at = ? WHERE id = '117eb4c0-06df-4a32-9c11-3e00db03f493'").run(now);
db.prepare("UPDATE sites SET sort = 3, updated_at = ? WHERE id = '1180df54-6e3e-4309-bfb9-613e79d35911'").run(now);

const bangumi = db.prepare("SELECT id FROM sites WHERE url LIKE '%bgm.tv%' OR title LIKE '%Bangumi%'").get();
if (bangumi) {
  db.prepare("UPDATE sites SET category_id = 'reg-anime-and-fandom', sort = 4, updated_at = ? WHERE id = ?").run(now, bangumi.id);
  console.log(`[clean-phase3] Bangumi 番组计划已移入 reg-anime-and-fandom (sort: 4)`);
}

// 2. reg-coding-utilities:
// Move Jellyfin to reg-long-video
db.prepare("UPDATE sites SET category_id = 'reg-long-video', updated_at = ? WHERE id = 'b83eb093-f52d-4c9f-b8fa-33817486b143'").run(now);

// Bump existing sites in reg-coding-utilities so top 4 slots are vacant
db.prepare("UPDATE sites SET sort = sort + 10 WHERE category_id = 'reg-coding-utilities' AND sort <= 10").run();

// Ensure RegExr is sort 1
const regexr = db.prepare("SELECT id FROM sites WHERE url LIKE '%regexr%'").get();
if (!regexr) {
  const newId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO sites (id, url, title, description, category_id, status, enabled, sort, weight, featured, fts_tokens, pinyin_full, pinyin_initials, created_at, updated_at, visit_count, trend_score)
    VALUES (?, 'https://regexr.com/', 'RegExr', '好用强大的在线正则表达式测试、学习与调试工具，支持实时匹配高亮与语法速查。', 'reg-coding-utilities', 'active', 1, 1, 100, 0, '', '', '', ?, ?, 0, 0)
  `).run(newId, now, now);
  console.log(`[clean-phase3] 插入 RegExr 到 reg-coding-utilities (sort: 1)`);
} else {
  db.prepare("UPDATE sites SET category_id = 'reg-coding-utilities', sort = 1, updated_at = ? WHERE id = ?").run(now, regexr.id);
}

// JSON Formatter sort: 2
db.prepare("UPDATE sites SET category_id = 'reg-coding-utilities', sort = 2, updated_at = ? WHERE id = '9db05323-5201-4d6f-83fb-6141c6cb8883'").run(now);
// crontab.guru sort: 3
db.prepare("UPDATE sites SET category_id = 'reg-coding-utilities', sort = 3, updated_at = ? WHERE id = 'f15af9a6-ce98-4efa-b182-69639f655e92'").run(now);
// CyberChef sort: 4
db.prepare("UPDATE sites SET category_id = 'reg-coding-utilities', sort = 4, updated_at = ? WHERE id = 'fa871691-c352-43c3-96a3-977fdf7bf857'").run(now);
console.log(`[clean-phase3] 编码小工具 Top 4 已设定为: RegExr(1), JSON Formatter(2), crontab.guru(3), CyberChef(4)`);

// 3. reg-tax-and-invoicing:
// Move 黑猫投诉, 中国消费者协会, 全国12315平台 to reg-consumer-life
db.prepare("UPDATE sites SET category_id = 'reg-consumer-life', updated_at = ? WHERE id = '6e79a0e1-47ba-4d2f-86ee-84bc0b3030c2'").run(now);
db.prepare("UPDATE sites SET category_id = 'reg-consumer-life', updated_at = ? WHERE id = '304e4b98-b0bc-4b4d-af2d-7af9205d6fed'").run(now);
db.prepare("UPDATE sites SET category_id = 'reg-consumer-life', updated_at = ? WHERE id = '1f77f4db-0ac0-442e-a42f-343eeaf451b8'").run(now);

// Ensure Top 4 in reg-tax-and-invoicing are: 国家税务总局(1), 电子发票服务平台(2), 发票查验平台(3), 12366(4)
db.prepare("UPDATE sites SET sort = 5, updated_at = ? WHERE id = 'aaf69439-ed59-4892-a46c-728b91747561'").run(now); // 税务总局法规库
db.prepare("UPDATE sites SET sort = 6, updated_at = ? WHERE id = 'ae9f86ef-05d9-4b44-9bf6-ff9262f3fa5f'").run(now); // IRS
db.prepare("UPDATE sites SET sort = 3, updated_at = ? WHERE id = '93a3e67b-befd-4d64-a35c-2442346a3aaa'").run(now); // 发票查验平台
db.prepare("UPDATE sites SET sort = 4, updated_at = ? WHERE id = '9e862e7a-641b-49af-9a83-3fe711be119a'").run(now); // 12366
console.log(`[clean-phase3] 财税发票 Top 4 已设定为: 国家税务总局(1), 电子发票(2), 发票查验(3), 12366(4)`);

// 4. reg-literature-search:
// Move CDC and FDA to reg-public-services
db.prepare("UPDATE sites SET category_id = 'reg-public-services', updated_at = ? WHERE id = '70fa8a49-febc-417f-b2df-87378c01ce7d'").run(now);
db.prepare("UPDATE sites SET category_id = 'reg-public-services', updated_at = ? WHERE id = 'bf8542cb-e7fe-49df-bdda-821852c8954b'").run(now);
console.log(`[clean-phase3] CDC 与 FDA 已移入 reg-public-services`);

// 5. reg-cinema-ticketing:
// Move 万达电影 to sort: 1
db.prepare("UPDATE sites SET sort = 1, updated_at = ? WHERE id = 'e88b3154-6fc3-4dd0-adc3-d788cdaa9708'").run(now);
db.prepare("UPDATE sites SET sort = 2, updated_at = ? WHERE id = '1fd5c196-81d1-4a4b-9b79-41fdaa928681'").run(now); // 猫眼专业版
db.prepare("UPDATE sites SET sort = 3, updated_at = ? WHERE id = 'a466877e-4eaf-45fe-8d77-6a3d2a46d6f5'").run(now); // 猫眼电影
db.prepare("UPDATE sites SET sort = 4, updated_at = ? WHERE id = '14686807-ce92-423d-8779-cea5af00b965'").run(now); // 淘票票
console.log(`[clean-phase3] 影院票务 Top 4 已设定为: 万达电影(1), 猫眼专业版(2), 猫眼电影(3), 淘票票(4)`);

db.pragma("foreign_keys = ON");
db.close();

console.log("[clean-phase3] Phase 3 清洗完成！");
