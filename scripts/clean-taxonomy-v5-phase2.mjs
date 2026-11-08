import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(resolve(process.cwd(), 'packages/store/package.json'));
const Database = require('better-sqlite3');
const db = new Database('./data/navhub.db');

console.log('[Phase 2 Clean] Starting database cleanup and taxonomy fixes...');

// 1. Reclassifications
const reclassifications = [
  { id: '76175533-bd11-4b14-ad48-142244fb0eeb', cat: 'reg-ai-video-generation', desc: 'Runway -> AI 视频生成' },
  { id: '98a4beb8-b7b0-4071-9211-d012af572e85', cat: 'reg-video-editing', desc: 'CapCut -> 视频剪辑后期' },
  { id: 'd860991c-af9c-4590-bbbe-1b73c7352b5f', cat: 'reg-encyclopedias-and-lexicons', desc: '百度百科 -> 百科辞书' },
  { id: 'cb96834d-cb06-4d86-bded-e259e707c13d', cat: 'reg-encyclopedias-and-lexicons', desc: '百度知道 -> 百科辞书' },
  { id: '0b508e08-d586-4450-bf39-e1ac2be50a07', cat: 'reg-social-security-and-housing-fund', desc: '北京公积金 -> 社保公积金' },
  { id: 'e3bc02ec-6fec-4c09-888b-38b3f1267d6b', cat: 'reg-social-security-and-housing-fund', desc: '上海公积金 -> 社保公积金' },
  { id: '1ef1af08-f1cf-4711-a466-3f607e762121', cat: 'reg-social-security-and-housing-fund', desc: '全国住房公积金公共服务平台 -> 社保公积金' },
];

const updateCat = db.prepare('UPDATE sites SET category_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
for (const item of reclassifications) {
  const res = updateCat.run(item.cat, item.id);
  console.log(`  [Reclassify] ${item.desc} (changes: ${res.changes})`);
}

// 2. Set weight and featured for authoritative sites
db.prepare("UPDATE sites SET weight = 100, featured = 1 WHERE id = '1ef1af08-f1cf-4711-a466-3f607e762121'").run();

// 3. Fix Cline icon_key
db.prepare("UPDATE sites SET icon_key = 'https://github.com/cline.png?size=64' WHERE id = '490f3f78-564e-4891-a15c-3597cf5fe437'").run();
console.log('  [Icon Fix] Cline icon updated to organization avatar');

// 4. Merge Duplicates
const duplicatesToDelete = [
  { id: 'e2a0b8ac-e9eb-474a-8936-3598d639f704', reason: 'Google 表单重复项，保留 docs.google.com/forms' },
  { id: '297bca74-57bf-49e8-8069-a18fdeaee2d6', reason: '腾讯较真重复项，保留腾讯新闻较真查证平台' },
  { id: '915addd3-6a60-4e12-b606-f4a4ec0828fe', reason: '国家政务服务平台重复项，保留主域名' },
];

const deleteSite = db.prepare('DELETE FROM sites WHERE id = ?');
for (const dup of duplicatesToDelete) {
  const res = deleteSite.run(dup.id);
  console.log(`  [Deduplicate] Deleted ${dup.id} (${dup.reason}, changes: ${res.changes})`);
}

// 5. Populate reg-embodied-ai-and-robotics
const embodiedSites = [
  {
    title: 'Figure AI',
    url: 'https://www.figure.ai/',
    description: '致力于开发商业化自主通用人形机器人的全球顶尖 AI 机器人企业。',
    icon_key: 'https://www.figure.ai/favicon.ico',
  },
  {
    title: 'Unitree 宇树科技',
    url: 'https://www.unitree.com/',
    description: '中国领先的消费级与行业级四足机器人及高机动通用人形机器人研发制造平台。',
    icon_key: 'https://www.unitree.com/favicon.ico',
  },
  {
    title: 'Boston Dynamics',
    url: 'https://bostondynamics.com/',
    description: '全球顶尖高机动性机器人与动态人形控制研发机构，Atlas 与 Spot 缔造者。',
    icon_key: 'https://bostondynamics.com/favicon.ico',
  },
  {
    title: 'Physical Intelligence (Pi)',
    url: 'https://www.physicalintelligence.company/',
    description: '专注于为各类机器人硬件开发通用物理智能基础大模型 (π0) 的先锋团队。',
    icon_key: null,
  },
  {
    title: 'LeRobot (HuggingFace)',
    url: 'https://github.com/huggingface/lerobot',
    description: 'Hugging Face 开源的机器人具身智能模仿学习与端到端控制开发框架。',
    icon_key: 'https://github.com/huggingface.png?size=64',
  },
  {
    title: '1X Technologies',
    url: 'https://www.1x.tech/',
    description: 'OpenAI 领投的通用双足拟人人性化机器人研发公司，代表作 NEO 与 EVE。',
    icon_key: 'https://www.1x.tech/favicon.ico',
  },
];

const insertSite = db.prepare(`
  INSERT INTO sites (
    id, url, title, description, icon_key, category_id, enabled, sort, weight, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 'reg-embodied-ai-and-robotics', 1, 0, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`);

const checkSite = db.prepare('SELECT id FROM sites WHERE url = ?');
for (const s of embodiedSites) {
  const existing = checkSite.get(s.url);
  if (!existing) {
    const id = crypto.randomUUID();
    insertSite.run(id, s.url, s.title, s.description, s.icon_key);
    console.log(`  [Embodied AI] Added: ${s.title} (${s.url})`);
  } else {
    db.prepare("UPDATE sites SET category_id = 'reg-embodied-ai-and-robotics' WHERE id = ?").run(existing.id);
    console.log(`  [Embodied AI] Reclassified existing to robotics: ${s.title}`);
  }
}

const countEmbodied = db.prepare("SELECT COUNT(*) as cnt FROM sites WHERE category_id = 'reg-embodied-ai-and-robotics'").get().cnt;
console.log(`[Phase 2 Clean] 'reg-embodied-ai-and-robotics' now has ${countEmbodied} sites.`);

db.close();
console.log('[Phase 2 Clean] Database migration complete!');
