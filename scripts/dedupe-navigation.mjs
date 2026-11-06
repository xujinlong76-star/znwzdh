#!/usr/bin/env node
/**
 * 导航数据清洗：同分类重复项去重 + 错挂类目归位（方案「三·底层数据治理」，2026-11-07 首跑）。
 *
 * 处理的两类真实缺陷：
 *   - 同一个站点被不同来源（seed / import / plugin:xxx / curated-2026）各写一份，
 *     同一叶子类目里出现 2–3 张同名卡（LangGraph 3 份、Microsoft Teams 3 份、新华网 3 份）；
 *   - 站点挂在语义错的叶子上（稿定设计在「编码小工具」、中国知网在「AI 搜索知识」、
 *     Canva 可画在「公开课与方法」、提示词教程在「模型训练与微调」）。
 *
 * 用法：
 *   node scripts/dedupe-navigation.mjs                 # dry-run：只读审计 + 打印变更清单
 *   node scripts/dedupe-navigation.mjs --apply         # 经 hub /api/sites/bulk 落库
 *   node scripts/dedupe-navigation.mjs --hub <url>     # 默认 http://127.0.0.1:8787
 *
 * 三条硬约定：
 *   1. 默认 dry-run，必须显式 --apply 才写；
 *   2. 删除一律走 hub 的批量口（op=delete = 软删进回收站，30 天后才被 purge_trash 清掉），
 *      脚本自己不碰 DB 写面——hub 正在跑时直接写 WAL 会和并行会话抢锁；
 *   3. 落库前先 `node scripts/backup.mjs`。整库还原见 docs/BACKUP-RUNBOOK.md，
 *      单行找回走回收站（sites.deleted_at）。
 *
 * 判据分两层：机器判（同归一化 URL / 同归一化标题落在同一叶子，按字段完整度选保留行）
 * 与人判（SWAP / CROSS_CAT / REMAP 三张表，是 2026-11-07 逐组复核后的结论，按 id 前缀钉住）。
 * 前缀命中多行＝判据失效，直接报错退出；命中 0 行＝上一轮已落库，计入「已过时」并在末尾列明，
 * 不静默吞掉——清单和现实对不上时必须让人看见。
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const JSON_OUT = argv.includes("--json");
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const HUB = opt("--hub", "http://127.0.0.1:8787");
const DB_PATH = opt("--db", "data/navhub.db");

// —— 归一化：URL 去协议/www/查询串/尾斜杠，标题去空白与分隔符 ——
const normUrl = (u) =>
  String(u ?? "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[?#]/)[0].replace(/\/+$/, "");
const normTitle = (t) =>
  String(t ?? "").trim().toLowerCase().replace(/[\s\u3000]+/g, "").replace(/[·・・.\-—_()（）\[\]【】]/g, "");

/** 保留行打分：信息更全的那份活下来，其余进回收站。 */
function completeness(r) {
  const d = String(r.description ?? "").trim();
  return (
    (d.length >= 10 ? 3 : 0) +
    (d.length >= 40 ? 2 : 0) +
    (r.icon_key ? 2 : 0) +
    (r.sub_category_id ? 1 : 0) +
    (r.featured ? 2 : 0) +
    (r.weight > 0 ? 1 : 0) +
    (r.health_ok === 1 ? 2 : 0) +
    Math.min(4, Math.floor(Math.log10(1 + (r.visit_count ?? 0))))
  );
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const sites = db.prepare(`
  SELECT s.id, s.url, s.title, s.description, s.icon_key, s.sub_category_id, s.category_id,
         s.featured, s.weight, s.visit_count, s.health_ok, s.source, s.created_at
  FROM sites s WHERE s.deleted_at IS NULL`).all();
const catLabel = new Map(db.prepare(`
  SELECT c.id, coalesce(p.title || ' / ', '') || c.title AS label FROM categories c
  LEFT JOIN categories p ON p.id = c.parent_id`).all().map((r) => [r.id, r.label]));
const knownCat = new Set(catLabel.keys());
db.close();

// —— 人判三张表（2026-11-07 复核结论，按 id 前缀钉住）——
// 机器按完整度选错了幸存 URL：换保留行。键 = 机器选中的 id 前缀，值 = 应保留的 id 前缀。
const SWAP = {
  "126742fb": "ce0d50e8", // 中国信托登记：www.chinatrust.com.cn 是台湾「中国信托商业银行」，不是同一主体
  "281294b9": "4b8f72b1", // Microsoft Teams：en-us 营销页健康检查已失败
  "58b21093": "2e113187", // 天猫国际：pages.tmall.com 活动页不稳定，tmall.hk 是长期域名
  "8849883f": "ed65929f", // 中国天气网：保留行的 URL 自身就 301 到 www 形态，去掉一跳
  "386358fd": "946cdce7", // 凯叔讲故事：官方域名 kaishustory.com
  "67d59e3b": "c20596d5", // 刺猬实习：官方域名 ciweishixi.com
  "dfad8323": "3b1668f0", // DeepL：分类是「词典与翻译」，/translator 直达少一次点击
  "3dce0f49": "bd8a1b2e", // Kit 已改名，kit.com 对应当前品牌
  "ce4ae0df": "29e8cc5f", // Collabora Online 同理
  "4166d713": "607488ea", // FilmAffinity /en/main.html 强制英文，留根路径
  "bb58c734": "adcc93f0", // Testcontainers 文档已迁到 .com
};
// 同品牌第二份散在别的叶子/别根上：机器按「同分类」口径看不见，人工判后删。
const CROSS_CAT = {
  "19e0ebe9": "Cloudflare 跨根重复，留 网关与流量",
  "5cdd93e0": "Zotero 跨叶子重复，留 科研管理",
  "4be32ec8": "Vite 同产品双份，vitejs.dev 已 301 到 vite.dev",
  "acac2e52": "Microsoft Teams 第三份（视频会议），归一到 即时沟通 一条",
  "638dcf8e": "Todoist 挂错到 笔记与知识库，且与 日历与待办 重复",
  "8e5c7c8a": "Microsoft To Do 营销页挂错到 笔记与知识库，留 to-do.office.com",
  "573d1562": "新华网 news.cn 与 xinhuanet.com 同主体三份，归一",
  "6a6c9f2a": "Spotify 营销页挂错到 播客与有声书，留 open.spotify.com",
  "73884147": "闲鱼 2.taobao.com 旧域名，让位给 goofish.com",
  "6594702b": "巨量星图 star.toutiao.com 旧域名，让位给 xingtu.cn",
  "8f689fba": "中科院文献情报中心 las.ac.cn 与 las.cas.cn 同主体双份",
  "26e3b0f2": "腾讯广告 ad.qq.com 与 e.qq.com 同主体双份，留 变现与 MCN",
  "7ed43c25": "微博广告 ad.weibo.com 与 tui.weibo.com 同主体双份，留 变现与 MCN",
  "b3b2ba93": "Trilium 旧仓库名 Notes，且挂错到 协作文档",
  "e9e95948": "LLaMA-Factory wiki 与主仓库同产品双份",
  "2e73eb42": "Prompt Engineering Guide 的 GitHub 副本（与 promptingguide.ai 同一项目）",
  "cc9c1d12": "Remove.bg 英文页让位给 /zh 中文版（已移入 UI 资源素材）",
  "f015fa6b": "Canva 国际版与 canva.cn 同主体双份，留中文域名",
};
// 归位：站点没错，类目错了。
const REMAP = {
  d37abd76: ["reg-content-assets", "稿定设计＝模板化在线设计，对齐 图怪兽"],
  d123af06: ["reg-content-assets", "创客贴＝模板化在线设计，对齐 图怪兽"],
  "66c5503d": ["reg-literature-search", "Google 学术不是 AI 工具，与 百度学术/arXiv 同类"],
  "30b8be64": ["reg-literature-search", "中国知网不是 AI 工具，与 万方/维普 同类"],
  "9b17db73": ["reg-ai-eval-and-learning", "提示词文档不属 模型训练与微调"],
  f788f297: ["reg-ai-eval-and-learning", "提示词教程不属 模型训练与微调"],
  ea1f42d5: ["reg-ai-eval-and-learning", "提示词教程不属 模型训练与微调"],
  "6f659768": ["reg-ai-eval-and-learning", "提示词官方指南不属 模型训练与微调"],
  fa39a898: ["reg-ai-writing-office", "PromptBase 是提示词市场，非训练框架"],
  e95b443f: ["reg-ai-writing-office", "PromptHero 是提示词市场，非训练框架"],
  b34a8ff6: ["reg-ai-writing-office", "FlowGPT 是提示词社区，非训练框架"],
  "4725cc50": ["reg-secondhand-market", "闲鱼是二手闲置，不是综合电商"],
  c0b4facc: ["reg-monetization-and-mcn", "巨量星图归 变现与 MCN"],
  "44bfcd38": ["reg-prototyping-and-collab", "Canva 可画挂在 公开课与方法 属错类"],
  "4d5a98be": ["reg-ui-assets", "remove.bg 是抠图素材工具，不该在 编码小工具"],
};

const stale = [];
const byPrefix = (p, where) => {
  const hits = sites.filter((s) => s.id.startsWith(p));
  if (hits.length > 1) throw new Error(`${where}：id 前缀 ${p} 命中 ${hits.length} 行，需要人工复核`);
  if (!hits.length) { stale.push(`${where} ${p}`); return null; }
  return hits[0];
};

// —— 第一层：机器判同分类重复 ——
// 同一叶子内「同归一化 URL」或「同归一化标题」连通成一个簇；
// 两个键命中同一批行时并簇，否则同品牌会被拆成两次「各自保留自己」。
const bucket = new Map();
for (const s of sites) {
  for (const key of [`u|${normUrl(s.url)}`, `t|${normTitle(s.title)}`]) {
    if (key.endsWith("|")) continue;
    const gk = `${key}@${s.category_id ?? ""}`;
    if (!bucket.has(gk)) bucket.set(gk, []);
    bucket.get(gk).push(s);
  }
}
const parentOf = new Map(sites.map((s) => [s.id, s.id]));
const find = (x) => { while (parentOf.get(x) !== x) x = parentOf.get(x); return x; };
for (const list of bucket.values()) {
  for (let i = 1; i < list.length; i++) {
    const a = find(list[0].id), b = find(list[i].id);
    if (a !== b) parentOf.set(b, a);
  }
}
const dup = new Map();
for (const list of bucket.values()) for (const s of list) {
  const root = find(s.id);
  const acc = dup.get(root) ?? new Map();
  acc.set(s.id, s);
  dup.set(root, acc);
}

const deletes = [];
for (const list of dup.values()) {
  const rows = [...list.values()];
  if (rows.length < 2) continue;
  const sorted = [...rows].sort((a, b) => completeness(b) - completeness(a) || (b.visit_count ?? 0) - (a.visit_count ?? 0) || String(a.created_at).localeCompare(String(b.created_at)));
  const want = SWAP[sorted[0].id.slice(0, 8)];
  const target = want ? sorted.find((s) => s.id.startsWith(want)) : null;
  if (want && !target) stale.push(`SWAP ${want}（组内已无此行，视为已落库）`);
  const keep = target ?? sorted[0];
  for (const s of sorted) if (s.id !== keep.id) deletes.push({ id: s.id, why: `同分类重复（保留 ${keep.id.slice(0, 8)} ${keep.title}）` });
}
for (const [p, why] of Object.entries(CROSS_CAT)) {
  const s = byPrefix(p, "CROSS_CAT");
  if (s) deletes.push({ id: s.id, why: `跨类目重复：${why}` });
}
const moves = Object.entries(REMAP).flatMap(([p, [to, why]]) => {
  const s = byPrefix(p, "REMAP");
  if (!s) return [];
  if (s.category_id === to) { stale.push(`REMAP ${p} 已在 ${to}，无需再移`); return []; }
  return [{ id: s.id, to, why }];
});

const delIds = new Set(deletes.map((d) => d.id));
if (delIds.size !== deletes.length) throw new Error("删除清单有重复 id");
for (const m of moves) {
  if (delIds.has(m.id)) throw new Error(`同一行既删又移 ${m.id}`);
  if (!knownCat.has(m.to)) throw new Error(`目标类目不存在 ${m.to}`);
}

const label = (id) => { const s = sites.find((x) => x.id === id); return s ? `${s.title} [${catLabel.get(s.category_id) ?? "无类目"}] ${s.url}` : id; };
console.log(JSON_OUT ? JSON.stringify({ moves, deletes, stale }, null, 2)
  : `变更清单：移动 ${moves.length} 行、软删 ${deletes.length} 行（当前存活 ${sites.length} 行）\n\n— 归位 —\n${moves.map((m) => `  → ${catLabel.get(m.to)}：${label(m.id)}\n      理由：${m.why}`).join("\n")}\n— 去重 —\n${deletes.map((d) => `  ✂ ${label(d.id)}\n      理由：${d.why}`).join("\n")}`);
if (stale.length) console.log(`\n已过时 ${stale.length} 条（对应行已不在存活集，视为上一轮已落库）：\n${stale.map((s) => `  · ${s}`).join("\n")}`);

if (!APPLY) {
  console.log(`\n[dry-run] 未写库。落库前请先 node scripts/backup.mjs，再加 --apply 重跑。`);
  process.exit(0);
}

const bulk = async (payload) => {
  const res = await fetch(`${HUB}/api/sites/bulk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
};
let applied = 0;
for (const m of moves) {
  const r = await bulk({ op: "setCategory", ids: [m.id], categoryId: m.to, dryRun: false });
  if (r.applied !== 1) throw new Error(`移动失败 ${m.id}：${JSON.stringify(r)}`);
  applied += r.applied;
}
const byReason = new Map();
for (const d of deletes) byReason.set(d.why, [...(byReason.get(d.why) ?? []), d.id]);
for (const [why, ids] of byReason) {
  const r = await bulk({ op: "delete", ids, dryRun: false });
  applied += r.applied;
  if (r.skipped) console.log(`  跳过 ${r.skipped} 行（不存在或已在回收站）：${why}`);
}
console.log(`\n[applied] ${applied} 项已落库：移动走 updateSite、删除走软删（回收站，30 天后才 purge）。`);
console.log(`类目/站点写入会自增 data_version，navigation.json 由触发器重建，无需手工刷新。`);
