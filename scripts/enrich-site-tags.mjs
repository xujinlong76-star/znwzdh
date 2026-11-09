/**
 * enrich-site-tags.mjs
 *
 * 为全站缺失标签（Tags）的活跃站点自动补齐 2~3 个结构化分类/领域标签，
 * 消除双列网格卡片因缺少标签槽位导致的垂直重心失衡。
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(HERE, '..', 'data', 'navhub.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout = 15000;');

// 1. 读取分类全表
const categories = db.prepare('SELECT id, parent_id, title, slug FROM categories').all();
const catMap = new Map();
categories.forEach((c) => catMap.set(c.id, c));

// 常用分类与标签映射表
const CATEGORY_TAG_RULES = {
  'reg-ai-video-generation': ['ai视频', '视频生成', '大模型'],
  'reg-ai-image-generation': ['ai绘图', '图像生成', '设计灵感'],
  'reg-ai-coding-assistant': ['ai编程', '代码补全', '效率工具'],
  'reg-ai-writing-office': ['ai写作', '智能办公', '办公协同'],
  'reg-chat-assistants': ['对话ai', '大语言模型', '聊天助手'],
  'reg-ai-audio-voice': ['ai音频', '语音合成', '智能配音'],
  'reg-ai-search-knowledge': ['ai搜索', '智能问答', '知识库'],
  'reg-agents-and-automation': ['ai智能体', '工作流', '自动化'],
  'reg-vector-db-and-rag': ['向量检索', 'rag架构', '知识库'],
  'reg-models-and-datasets': ['开源模型', '数据集', '深度学习'],
  'reg-front-end-frameworks': ['前端开发', '核心框架', 'javascript'],
  'reg-ui-component-libraries': ['ui组件库', '前端资源', '设计规范'],
  'reg-backend-and-serverless': ['后端架构', '服务端', '云原生'],
  'reg-devops-and-cloud': ['devops', '云服务', '容器部署'],
  'reg-database-and-storage': ['数据库', '持久化', '存储引擎'],
  'reg-design-inspiration': ['设计灵感', '创意探索', '视觉传达'],
  'reg-design-tools': ['设计工具', '在线编辑', '原型设计'],
  'reg-icons-and-vectors': ['图标素材', '矢量设计', '设计资源'],
  'reg-illustrations-and-3d': ['3d设计', '插画素材', '三维渲染'],
  'reg-fonts-and-typography': ['字体排印', '字库资源', '排版设计'],
  'reg-color-and-palettes': ['色彩搭配', '配色方案', '调色板'],
  'reg-open-source-projects': ['开源项目', '代码仓库', '开发者社区'],
  'reg-learning-and-tutorials': ['学习教程', '技术文档', '开发者手册'],
  'reg-productivity-tools': ['效率工具', '日常提效', '实用软件'],
  'reg-online-utilities': ['在线工具', '免安装', '常用工具'],
  'reg-media-and-entertainment': ['影音娱乐', '多媒体', '数字生活'],
  'reg-news-and-information': ['新闻资讯', '行业动态', '信息流'],
};

// 精确命名的重点站点专属标签覆盖
const SPECIAL_SITE_TAGS = {
  '堆友 AI (阿里设计)': ['ai绘图', '阿里设计', '3d素材'],
  '混元视频大模型 (Tencent HunyuanVideo)': ['ai视频', '腾讯大模型', '视频生成'],
  '通义万相视频 (Wan2.1)': ['ai视频', '阿里通义', '大模型'],
  'Roo Code': ['ai编程', 'mcp体系', '开源插件'],
  'Roo Code MCP 体系': ['ai编程', 'mcp体系', '开源插件'],
  '讯飞智文': ['ai写作', '智能ppt', '科大讯飞'],
};

// 读取已存在的标签
const existingTags = db.prepare('SELECT id, name, slug FROM tags').all();
const tagBySlug = new Map();
const tagByName = new Map();
existingTags.forEach((t) => {
  tagBySlug.set(t.slug.toLowerCase(), t);
  tagByName.set(t.name.toLowerCase(), t);
});

// 2. 查找所有没有 tags 的 active 站点
const untaggedSites = db.prepare(`
  SELECT s.id, s.title, s.url, s.category_id, s.description
  FROM sites s
  WHERE s.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM site_tags st WHERE st.site_id = s.id)
`).all();

console.log(`[enrich-site-tags] 发现未打标活跃站点: ${untaggedSites.length} 个`);

// 预先搜集所有需要新创建的 tags 和 关联记录
const newTagsToInsert = [];
const siteTagPairs = [];

function resolveTag(tagName) {
  const normName = tagName.trim();
  const slug = normName.toLowerCase().replace(/\s+/g, '-');
  if (tagBySlug.has(slug)) return tagBySlug.get(slug).id;
  if (tagByName.has(normName.toLowerCase())) return tagByName.get(normName.toLowerCase()).id;

  const newId = randomUUID();
  const tagObj = { id: newId, name: normName, slug };
  tagBySlug.set(slug, tagObj);
  tagByName.set(normName.toLowerCase(), tagObj);
  newTagsToInsert.push(tagObj);
  return newId;
}

for (const site of untaggedSites) {
  let tagsToApply = [];

  // 1) 优先检查重点站点覆盖
  if (SPECIAL_SITE_TAGS[site.title]) {
    tagsToApply = SPECIAL_SITE_TAGS[site.title];
  } else {
    // 2) 检查分类规则
    if (CATEGORY_TAG_RULES[site.category_id]) {
      tagsToApply = [...CATEGORY_TAG_RULES[site.category_id]];
    } else {
      // 3) 根据分类 title 与父分类 title 析取
      const cat = catMap.get(site.category_id);
      if (cat) {
        tagsToApply.push(cat.title.toLowerCase());
        if (cat.parent_id && catMap.get(cat.parent_id)) {
          const parentCat = catMap.get(cat.parent_id);
          tagsToApply.push(parentCat.title.toLowerCase());
        }
      }
    }

    // 4) 提取特征关键词补充
    const textToScan = `${site.title} ${site.description || ''}`.toLowerCase();
    if (textToScan.includes('github') || textToScan.includes('开源')) {
      if (!tagsToApply.includes('开源')) tagsToApply.push('开源');
    }
    if (textToScan.includes('阿里') || textToScan.includes('alibaba')) {
      if (!tagsToApply.includes('阿里生态')) tagsToApply.push('阿里生态');
    }
    if (textToScan.includes('腾讯') || textToScan.includes('tencent')) {
      if (!tagsToApply.includes('腾讯生态')) tagsToApply.push('腾讯生态');
    }
    if (textToScan.includes('ai') || textToScan.includes('智能') || textToScan.includes('大模型')) {
      if (!tagsToApply.includes('ai赋能')) tagsToApply.push('ai赋能');
    }
  }

  // 保证取 2~3 个结构化标签
  const finalTags = Array.from(new Set(tagsToApply.filter(Boolean))).slice(0, 3);
  if (finalTags.length === 1) {
    finalTags.push('精选推荐');
  } else if (finalTags.length === 0) {
    finalTags.push('常用导航', '精选资源');
  }

  for (const tagName of finalTags) {
    const tagId = resolveTag(tagName);
    siteTagPairs.push([site.id, tagId]);
  }
}

console.log(`[enrich-site-tags] 待插入新标签: ${newTagsToInsert.length} 个, 待建立关联: ${siteTagPairs.length} 条`);

// 在单一事务中快速写入
db.exec('BEGIN IMMEDIATE;');

const insertTagStmt = db.prepare(`
  INSERT INTO tags (id, name, slug, created_at, group_name)
  VALUES (?, ?, ?, ?, 'topic')
`);

for (const t of newTagsToInsert) {
  insertTagStmt.run(t.id, t.name, t.slug, Date.now());
}

const insertSiteTagStmt = db.prepare(`
  INSERT OR IGNORE INTO site_tags (site_id, tag_id)
  VALUES (?, ?)
`);

for (const [siteId, tagId] of siteTagPairs) {
  insertSiteTagStmt.run(siteId, tagId);
}

// 3. 更新数据版本号
db.prepare('UPDATE data_version SET version = version + 1, updated_at = ? WHERE id = 1').run(Date.now());

db.exec('COMMIT;');

console.log(`[enrich-site-tags] 治理完成：成功为 ${untaggedSites.length} 个站点补齐标签，新增 ${siteTagPairs.length} 条关联，数据版本号已递增`);

// 4. 验证抽样站点
const testTitles = [
  '堆友 AI (阿里设计)',
  '混元视频大模型 (Tencent HunyuanVideo)',
  '通义万相视频 (Wan2.1)',
  'Roo Code',
  '讯飞智文',
];

for (const title of testTitles) {
  const row = db.prepare('SELECT id, title FROM sites WHERE title = ?').get(title);
  if (row) {
    const tags = db.prepare(`
      SELECT t.name, t.slug
      FROM site_tags st
      JOIN tags t ON t.id = st.tag_id
      WHERE st.site_id = ?
    `).all(row.id);
    console.log(`  - ${title}:`, tags.map((t) => `#${t.name}`));
  }
}
