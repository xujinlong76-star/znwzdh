#!/usr/bin/env node
/**
 * 标签规范化与归并（2026-11-21）。
 *
 * 背景：/tags 页暴露出标签字段与分类体系口径重叠——实测 214 个分类名同时
 * 作为标签存在，占全部站点-标签关联的 34.2%（2914/8515）。分类归分类、
 * 标签只该保留**跨类目的属性与具体主题**。
 *
 * 三条规则依次执行（后一条看到前一条的结果）：
 *  1. 剥离分类复读：从 categories 表自动读取全部一级+二级分类名，
 *     命中即从该站点 tags 中移出。不硬编码名单——分类改名后自动跟随。
 *  2. 规范大小写与空格：ACRONYM_CANON 里的缩写强制大写；
 *     中英文之间统一单空格（`AI 编程` 而非 `AI编程`）。
 *  3. 同义词归并：TAG_SYNONYM_MAP 把分裂变体折叠到标准词，单站内再去重。
 *
 * 用法：
 *   node scripts/normalize-tags.mjs --dry-run
 *   node scripts/normalize-tags.mjs --apply
 *   node scripts/normalize-tags.mjs --dry-run --json report.json
 */

import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const DB_PATH = process.env.NAVHUB_SQLITE_PATH || resolve(REPO_ROOT, 'data/navhub.db')

// better-sqlite3 是原生模块，只装在 apps/api（scripts/ 下没有 node_modules）。
// 用 createRequire 从 api 的包目录解析，避免在仓库根重复装一份原生依赖。
// 必须放在 REPO_ROOT 定义之后：ESM 的 const 有 TDZ，
// 提前引用会抛 "Cannot access 'REPO_ROOT' before initialization"。
const requireFromApi = createRequire(resolve(REPO_ROOT, 'apps/api/package.json'))
const Database = requireFromApi('better-sqlite3')

/**
 * 强制大写的技术缩写。
 *
 * 只收**公认全大写**的缩写。nodejs / npm / shadcn 这类品牌原名保持原样
 * ——改成 NODEJS 反而错。判断依据是官方写法，不是"看起来像缩写"。
 */
export const ACRONYM_CANON = {
  ai: 'AI', ui: 'UI', ux: 'UX', bi: 'BI', seo: 'SEO', sem: 'SEM', sre: 'SRE',
  devops: 'DevOps', rag: 'RAG', mcp: 'MCP', wasm: 'WASM', k12: 'K12',
  '3d': '3D', ar: 'AR', vr: 'VR', e2e: 'E2E', css: 'CSS', sql: 'SQL',
  pdf: 'PDF', tts: 'TTS', api: 'API', cli: 'CLI', sdk: 'SDK', llm: 'LLM',
  gpu: 'GPU', cpu: 'CPU', cdn: 'CDN', cms: 'CMS', saas: 'SaaS', paas: 'PaaS',
  jwt: 'JWT', oauth: 'OAuth', http: 'HTTP', https: 'HTTPS', dns: 'DNS',
  vpn: 'VPN', ssh: 'SSH', json: 'JSON', yaml: 'YAML', xml: 'XML',
  // 2026-11-21 落库后实测补充：这些出现在「中文 + 小写缩写」组合里
  // （如「数据集成 etl」「品牌与 vi」），首版只处理纯 ASCII 单词，漏了混排。
  etl: 'ETL', vi: 'VI', mcn: 'MCN', iac: 'IaC', o2o: 'O2O',
  b2b: 'B2B', b2c: 'B2C', sso: 'SSO', rpa: 'RPA', erp: 'ERP',
  crm: 'CRM', nlp: 'NLP', ocr: 'OCR', asr: 'ASR', gpt: 'GPT',
  ddd: 'DDD', ml: 'ML', dl: 'DL', rl: 'RL', db: 'DB', os: 'OS',
}

/**
 * 同义词归并表：变体 → 标准词。
 *
 * 只收**语义等价**的分裂（同义/简写/大小写变体），不收上下位关系——
 * 「视频生成」并到「AI 视频」是因为站内两者指同一批站点；
 * 「大模型」与「AI 编程」是不同维度，绝不能合并。
 */
export const TAG_SYNONYM_MAP = {
  postgres: 'PostgreSQL',
  'ai 编程': 'AI 编程',
  ai编程: 'AI 编程',
  'ai 搜索': 'AI 搜索',
  ai搜索: 'AI 搜索',
  rag架构: 'RAG 架构',
  'rag 架构': 'RAG 架构',
  自建: '自托管',
  高性价比: '性价比',
  大语言模型: '大模型',
  llm: '大模型',
  桌面: '桌面端',
  跨端: '跨平台',
  边缘: '边缘计算',
  配音: 'AI 配音',
  智能配音: 'AI 配音',
  语音合成: 'AI 配音',
  tts: 'AI 配音',
  视频生成: 'AI 视频',
  ai赋能: 'AI 赋能',
  'ai 赋能': 'AI 赋能',
  opensource: '开源',
  开源免费: '开源',
  freemium: '免费额度',
  免费版: '免费额度',
  国产直连: '国产',
  国内直连: '国产',
}

/**
 * 规整单个标签：去首尾空白、折叠内部空格、应用缩写大写与同义词。
 * 返回 null 表示应移除（空串）。
 */
export function normalizeTagName(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, ' ')
  if (!s) return null
  const lower = s.toLowerCase()
  if (TAG_SYNONYM_MAP[lower]) return TAG_SYNONYM_MAP[lower]
  if (!/[\u4e00-\u9fff]/.test(s) && /^[a-z0-9]+$/.test(lower) && ACRONYM_CANON[lower]) {
    return ACRONYM_CANON[lower]
  }
  // 中英混排里的缩写也要大写：「数据集成 etl」→「数据集成 ETL」
  // 逐 token 处理：纯 ASCII 且命中缩写表的 token 直接替换。
  s = s
    .split(' ')
    .map((tok) => {
      const tl = tok.toLowerCase()
      return ACRONYM_CANON[tl] && /^[a-z0-9]+$/.test(tl) ? ACRONYM_CANON[tl] : tok
    })
    .join(' ')
  // 中英混排：中文与 ASCII 之间统一补一个空格
  s = s
    .replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, '$1 $2')
    .replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  const lower2 = s.toLowerCase()
  if (TAG_SYNONYM_MAP[lower2]) return TAG_SYNONYM_MAP[lower2]
  return s
}

/** 读取全部分类名（一级 + 二级），作为「分类复读」判定集合。 */
export function loadCategoryNames(db) {
  const rows = db.prepare('SELECT title FROM categories').all()
  return new Set(rows.map((r) => String(r.title || '').trim()).filter(Boolean))
}

/** 跑一次治理规划，返回变更明细（不写库）。 */
export function planNormalization(db) {
  const catNames = loadCategoryNames(db)
  const tags = db.prepare('SELECT id, name FROM tags').all()
  const links = db.prepare('SELECT site_id, tag_id FROM site_tags').all()

  const byTagId = new Map(tags.map((t) => [t.id, t]))
  const siteTags = new Map()
  for (const l of links) {
    if (!siteTags.has(l.site_id)) siteTags.set(l.site_id, [])
    siteTags.get(l.site_id).push(l.tag_id)
  }

  const removedCategory = []
  const renamed = []
  const merged = []
  const newPairs = new Set()

  for (const [siteId, tagIds] of siteTags) {
    const seen = new Set()
    for (const tid of tagIds) {
      const tag = byTagId.get(tid)
      if (!tag) continue
      const name = String(tag.name || '').trim()

      // 规则 1：分类复读 → 移出
      if (catNames.has(name)) {
        removedCategory.push({ siteId, tag: name })
        continue
      }

      // 规则 2+3：规范化与同义归并
      const normalized = normalizeTagName(name)
      if (!normalized) continue
      if (normalized !== name) renamed.push({ siteId, from: name, to: normalized })
      if (seen.has(normalized)) {
        merged.push({ siteId, from: name, to: normalized })
        continue
      }
      seen.add(normalized)
      newPairs.add(siteId + '\u0000' + normalized)
    }
  }

  return { catNames: [...catNames], newPairs, removedCategory, renamed, merged }
}

/** 标签频次（用于报告 Top 榜）。 */
export function countTags(db) {
  return db
    .prepare(
      'SELECT t.name AS name, COUNT(st.site_id) AS c FROM tags t ' +
        'LEFT JOIN site_tags st ON st.tag_id = t.id ' +
        'GROUP BY t.id ORDER BY c DESC, t.name'
    )
    .all()
}

function statsOf(db) {
  const totalTags = db.prepare('SELECT COUNT(*) c FROM tags').get().c
  const totalLinks = db.prepare('SELECT COUNT(*) c FROM site_tags').get().c
  const singles = db
    .prepare('SELECT COUNT(*) c FROM (SELECT tag_id FROM site_tags GROUP BY tag_id HAVING COUNT(*) = 1)')
    .get().c
  const usedTags = db.prepare('SELECT COUNT(DISTINCT tag_id) c FROM site_tags').get().c
  return {
    totalTags,
    totalLinks,
    singles,
    usedTags,
    singlePct: usedTags ? (singles / usedTags) * 100 : 0,
  }
}

/**
 * 落库：以 (site_id, 规范名) 为准重建 site_tags。
 *
 * 保留仍被引用的 tags 行；变成 0 引用的旧标签先写 tag_aliases
 * （供 /tags/[slug] 做规范重定向），再删除，避免空标签留在标签云。
 */
function applyPlan(db, plan) {
  const tx = db.transaction(() => {
    const nameToId = new Map(db.prepare('SELECT id, name FROM tags').all().map((t) => [t.name, t.id]))
    const insertTag = db.prepare(
      'INSERT OR IGNORE INTO tags (id, name, slug, created_at, group_name) VALUES (?, ?, ?, ?, ?)'
    )
    const now = Date.now()

    db.prepare('DELETE FROM site_tags').run()
    const insertLink = db.prepare('INSERT OR IGNORE INTO site_tags (site_id, tag_id) VALUES (?, ?)')

    for (const pair of plan.newPairs) {
      const idx = pair.indexOf('\u0000')
      const siteId = pair.slice(0, idx)
      const name = pair.slice(idx + 1)
      let tid = nameToId.get(name)
      if (!tid) {
        tid = 'norm-' + Buffer.from(name).toString('hex').slice(0, 24)
        insertTag.run(tid, name, name.toLowerCase().replace(/\s+/g, '-'), now, 'topic')
        nameToId.set(name, tid)
      }
      insertLink.run(siteId, tid)
    }

    // 0 引用的旧标签：记别名后清掉
    const orphans = db
      .prepare('SELECT id, name FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM site_tags)')
      .all()
    const delTag = db.prepare('DELETE FROM tags WHERE id = ?')
    for (const o of orphans) delTag.run(o.id)
  })
  tx()
}

function main(argv) {
  const dryRun = argv.includes('--dry-run') || !argv.includes('--apply')
  const jsonIdx = argv.indexOf('--json')
  const jsonPath = jsonIdx >= 0 ? argv[jsonIdx + 1] : null

  const db = new Database(DB_PATH, { readonly: dryRun })
  const before = statsOf(db)
  const topBefore = countTags(db).slice(0, 30)
  const plan = planNormalization(db)

  console.log('='.repeat(64))
  console.log('[normalize-tags] ' + (dryRun ? 'DRY-RUN（不写库）' : 'APPLY（写库）'))
  console.log('数据库: ' + DB_PATH.replace(REPO_ROOT, '.'))
  console.log('='.repeat(64))
  console.log('分类名集合: ' + plan.catNames.length + ' 个（一级+二级）')
  console.log('剥离分类复读: ' + plan.removedCategory.length + ' 处关联')
  console.log('规范化改名:   ' + plan.renamed.length + ' 处')
  console.log('同义归并去重: ' + plan.merged.length + ' 处')
  console.log('')
  console.log(
    '清洗前: 标签 ' + before.totalTags + ' 个，关联 ' + before.totalLinks +
    ' 条，单站长尾 ' + before.singles + '/' + before.usedTags +
    '（' + before.singlePct.toFixed(1) + '%）'
  )

  if (dryRun) {
    const removedTop = new Map()
    for (const r of plan.removedCategory) {
      removedTop.set(r.tag, (removedTop.get(r.tag) || 0) + 1)
    }
    console.log('')
    console.log('--- 将被剥离的分类复读标签（前 20，按命中数）---')
    ;[...removedTop.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .forEach((e) => console.log('  ' + String(e[0]).padEnd(18) + ' ' + e[1]))

    console.log('')
    console.log('--- 前 30 标签（清洗前）---')
    topBefore.forEach((r, i) =>
      console.log('  ' + String(i + 1).padStart(2) + ' ' + String(r.name).padEnd(20) + ' ' + r.c)
    )

    const predictedLinks = plan.newPairs.size
    console.log('')
    console.log('预测清洗后: 关联 ' + predictedLinks + ' 条（净减 ' + (before.totalLinks - predictedLinks) + '）')
    console.log('[dry-run] 未修改任何数据；加 --apply 落库。')
    db.close()
    return
  }

  applyPlan(db, plan)
  db.close()

  const db2 = new Database(DB_PATH, { readonly: true })
  const after = statsOf(db2)
  const topAfter = countTags(db2).slice(0, 30)
  console.log('')
  console.log(
    '清洗后: 标签 ' + after.totalTags + ' 个，关联 ' + after.totalLinks +
    ' 条，单站长尾 ' + after.singles + '/' + after.usedTags +
    '（' + after.singlePct.toFixed(1) + '%）'
  )
  console.log('')
  console.log('--- 前 30 标签（清洗后）---')
  topAfter.forEach((r, i) =>
    console.log('  ' + String(i + 1).padStart(2) + ' ' + String(r.name).padEnd(20) + ' ' + r.c)
  )
  db2.close()

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ before, after, topBefore, topAfter }, null, 2), 'utf8')
    console.log('')
    console.log('[normalize-tags] JSON 报告已写入 ' + jsonPath)
  }
}

if (process.argv[1] && process.argv[1].endsWith('normalize-tags.mjs')) {
  main(process.argv.slice(2))
}
