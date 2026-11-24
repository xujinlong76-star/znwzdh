#!/usr/bin/env node
/**
 * 标签数据治理：剥离一级大类复读标签、标准大小写/空格、同义词归并、薄页治理统计。
 *
 * 事实源：data/navhub.db（/tags 页面与 sitemap 均从这里取数）。
 * 规范词典：apps/web-overlay/src/lib/seo/tag-taxonomy.json（与 web 路由共用同一份）。
 *
 * 用法：
 *   node scripts/normalize-tags.mjs                 # 等同 --dry-run
 *   node scripts/normalize-tags.mjs --dry-run       # 只输出报告，绝不改数据
 *   node scripts/normalize-tags.mjs --apply         # 备份后落库（合并标签、注册别名、重算索引）
 *   node scripts/normalize-tags.mjs --check         # 数据门禁：仍有复读/分裂/大小写问题则 exit 1
 *   node scripts/normalize-tags.mjs --json-report tmp/tag-normalize-report.json
 *   node scripts/normalize-tags.mjs --db /path/to/navhub.db --top 30
 *
 * 可复用入口（数据校验门禁 / 单测直接 import）：
 *   analyzeTagData(input) —— 纯函数，返回完整治理计划与前后统计，不碰 IO。
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const TAXONOMY_PATH = resolve(REPO_ROOT, 'apps/web-overlay/src/lib/seo/tag-taxonomy.json')
const DEFAULT_DB_PATH = resolve(REPO_ROOT, 'data/navhub.db')
const require = createRequire(resolve(REPO_ROOT, 'apps/api/package.json'))

const taxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf8'))
export const FORCED_ACRONYMS = taxonomy.forcedAcronyms
export const SPECIAL_ALIASES = taxonomy.specialAliases
export const TAG_SYNONYM_MAP = taxonomy.tagSynonymMap

/** 与 store/src/repository/dialect.ts slugify 同构（保留中文，空值兜底 tag）。 */
export function slugifyTag(input) {
  const s = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
  return s || 'tag'
}

export function normalizeTagKey(value) {
  return String(value ?? '')
    .trim()
    .replace(/^#+/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_/·、，,]+/g, '')
}

/** 标准大小写 + 空格：缩写强制大写（词边界），ASCII 与中日韩之间一个空格。 */
export function applyTagStyle(raw) {
  let out = String(raw ?? '').trim().replace(/^#+/, '').trim().replace(/\s+/g, ' ')
  if (!out) return ''
  for (const acronym of FORCED_ACRONYMS) {
    out = out.replace(new RegExp(`(?<![A-Za-z0-9])${acronym}(?![A-Za-z0-9])`, 'gi'), acronym)
  }
  out = out.replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, '$1 $2')
  out = out.replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, '$1 $2')
  return out.trim()
}

/** 原始标签名 → 规范展示名（幂等）。 */
export function canonicalizeTagName(raw) {
  const clean = String(raw ?? '').trim().replace(/^#+/, '').trim()
  if (!clean) return ''
  const key = normalizeTagKey(clean)
  if (SPECIAL_ALIASES[key]) return SPECIAL_ALIASES[key]
  return applyTagStyle(TAG_SYNONYM_MAP[key] ?? clean)
}

// —— 兼容导出：并行会话 normalize-tags.test.ts 依赖下面三个名字 ——
// 它们是 canonicalizeTagName 的别名/视图，不引入第二套规则，避免双份词典漂移。
/** 缩写词典的对象视图：{ 小写形式: 规范大写 }（测试仅校验 key 全小写）。 */
export const ACRONYM_CANON = Object.fromEntries(FORCED_ACRONYMS.map((a) => [a.toLowerCase(), a]))
/** 与 canonicalizeTagName 同义；空值返回 null（对齐旧测试契约）。 */
export function normalizeTagName(raw) {
  if (raw === null || raw === undefined) return null
  const out = canonicalizeTagName(raw)
  return out || null
}

const countBy = (rows, pickKey) => {
  const out = new Map()
  for (const row of rows) {
    const key = pickKey(row)
    out.set(key, (out.get(key) ?? 0) + 1)
  }
  return out
}

/**
 * 纯函数治理分析（不碰 IO，可在数据门禁中复用）。
 *
 * input:
 *   tags: [{ id, name, slug }]
 *   siteTags: [{ siteId, tagId, categoryTitle }]
 *   activeSiteIds: Iterable<string>
 *   rootCategoryTitles: string[]
 */
export function analyzeTagData(input) {
  const tags = Array.isArray(input?.tags) ? input.tags : []
  const siteTags = Array.isArray(input?.siteTags) ? input.siteTags : []
  const activeSiteIds = new Set(input?.activeSiteIds ?? [])
  const rootKeys = new Set((input?.rootCategoryTitles ?? []).map(normalizeTagKey).filter(Boolean))

  const tagById = new Map(tags.map((t) => [String(t.id), t]))
  const activeSiteTags = siteTags.filter((a) => activeSiteIds.has(String(a.siteId)) && tagById.has(String(a.tagId)))
  const beforeCounts = countBy(activeSiteTags, (a) => String(a.tagId))

  // 1. 按规范名分组（同义词 + 大小写/空格变体都落到同一组）
  const groups = new Map()
  for (const tag of tags) {
    const canonicalName = canonicalizeTagName(tag.name)
    const key = normalizeTagKey(canonicalName)
    if (!key) continue
    let group = groups.get(key)
    if (!group) {
      group = { key, canonicalName, members: [] }
      groups.set(key, group)
    }
    group.members.push(tag)
  }

  // 2. 每组选目标行：优先展示名已经是规范名的标签，否则取存活站点最多者（再按 id 稳定排序）
  for (const group of groups.values()) {
    group.members.sort((a, b) => {
      const aExact = a.name === group.canonicalName ? 1 : 0
      const bExact = b.name === group.canonicalName ? 1 : 0
      if (aExact !== bExact) return bExact - aExact
      const delta = (beforeCounts.get(String(b.id)) ?? 0) - (beforeCounts.get(String(a.id)) ?? 0)
      if (delta !== 0) return delta
      return String(a.id).localeCompare(String(b.id))
    })
    group.target = group.members[0]
    group.sources = group.members.slice(1)
  }

  // 3. 关联重写：先剥离一级大类复读，再映射到目标标签，最后单站去重
  const categoryDuplicates = []
  const duplicateAssociations = []
  const afterCounts = new Map()
  const seen = new Set()
  for (const assoc of activeSiteTags) {
    const tag = tagById.get(String(assoc.tagId))
    const canonicalName = canonicalizeTagName(tag.name)
    const key = normalizeTagKey(canonicalName)
    if (rootKeys.has(key)) {
      categoryDuplicates.push({
        siteId: String(assoc.siteId),
        tagId: String(assoc.tagId),
        tag: tag.name,
        category: assoc.categoryTitle ?? '',
      })
      continue
    }
    const group = groups.get(key)
    if (!group) continue
    const targetId = String(group.target.id)
    const dedupeKey = `${assoc.siteId}|${targetId}`
    if (seen.has(dedupeKey)) {
      duplicateAssociations.push({ siteId: String(assoc.siteId), fromTagId: String(assoc.tagId), toTagId: targetId })
      continue
    }
    seen.add(dedupeKey)
    afterCounts.set(targetId, (afterCounts.get(targetId) ?? 0) + 1)
  }

  // 4. 报告数据
  const sortedTop = (countMap, nameOf) =>
    [...countMap.entries()]
      .map(([id, count]) => ({ id, name: nameOf(id), count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  const top = (input.top ?? 30)
  const topBefore = sortedTop(beforeCounts, (id) => String(tagById.get(id)?.name ?? id)).slice(0, top)
  const topAfter = sortedTop(afterCounts, (id) => {
    const group = [...groups.values()].find((g) => String(g.target.id) === id)
    return group?.canonicalName ?? String(tagById.get(id)?.name ?? id)
  }).slice(0, top)

  const renames = []
  const merges = []
  const aliasOps = []
  for (const group of groups.values()) {
    const targetId = String(group.target.id)
    if (group.target.name !== group.canonicalName) {
      renames.push({ id: targetId, from: group.target.name, to: group.canonicalName })
      for (const alias of [group.target.name, group.target.slug, normalizeTagKey(group.target.name)]) {
        if (alias) aliasOps.push({ alias, tagId: targetId })
      }
    }
    for (const source of group.sources) {
      const sourceId = String(source.id)
      merges.push({
        from: source.name,
        fromId: sourceId,
        to: group.canonicalName,
        toId: targetId,
        fromCount: beforeCounts.get(sourceId) ?? 0,
        toCount: beforeCounts.get(targetId) ?? 0,
      })
      for (const alias of [source.name, source.slug, normalizeTagKey(source.name), slugifyTag(source.name)]) {
        if (alias) aliasOps.push({ alias, tagId: targetId })
      }
    }
  }

  const normalizations = []
  for (const tag of tags) {
    const canonical = canonicalizeTagName(tag.name)
    if (canonical !== tag.name) {
      normalizations.push({ id: String(tag.id), from: tag.name, to: canonical })
    }
  }

  const singleBefore = [...beforeCounts.values()].filter((n) => n === 1).length
  const singleAfter = [...afterCounts.values()].filter((n) => n === 1).length
  const tagsBefore = tags.length
  const tagsAfter = groups.size

  const summary = {
    activeSites: activeSiteIds.size,
    rootCategories: rootKeys.size,
    associationBefore: activeSiteTags.length,
    associationAfter: seen.size,
    tagsBefore,
    tagsAfter,
    uniqueTagReduction: tagsBefore - tagsAfter,
    singleSiteBefore: singleBefore,
    singleSiteAfter: singleAfter,
    singleSiteRatioBefore: tagsBefore ? Number((singleBefore / tagsBefore).toFixed(4)) : 0,
    singleSiteRatioAfter: tagsAfter ? Number((singleAfter / tagsAfter).toFixed(4)) : 0,
    gte3Before: [...beforeCounts.values()].filter((n) => n >= 3).length,
    gte3After: [...afterCounts.values()].filter((n) => n >= 3).length,
    categoryDuplicateAssociations: categoryDuplicates.length,
    categoryDuplicateTags: new Set(categoryDuplicates.map((d) => d.tagId)).size,
    duplicateAssociations: duplicateAssociations.length,
    mergeGroups: merges.length,
    renameGroups: renames.length,
    normalizationCount: normalizations.length,
  }

  return {
    summary,
    topBefore,
    topAfter,
    merges: merges.sort((a, b) => b.fromCount - a.fromCount || a.from.localeCompare(b.from)),
    renames,
    normalizations,
    categoryDuplicates,
    duplicateAssociations,
    aliasOps,
    groups,
    tagById,
    afterCounts,
  }
}

/** 读取 DB 快照（只读）。 */
export function loadSnapshot(dbPath = DEFAULT_DB_PATH) {
  const Database = require('better-sqlite3')
  const db = new Database(dbPath, { readonly: true })
  try {
    const tags = db.prepare('SELECT id, name, slug FROM tags').all().map((r) => ({
      id: String(r.id),
      name: String(r.name),
      slug: String(r.slug),
    }))
    const activeSiteIds = db
      .prepare("SELECT id FROM sites WHERE deleted_at IS NULL AND enabled = 1 AND status = 'active'")
      .all()
      .map((r) => String(r.id))
    const siteTags = db
      .prepare(
        `SELECT st.site_id AS siteId, st.tag_id AS tagId,
                COALESCE(root.title, cat.title, '') AS categoryTitle
         FROM site_tags st
         JOIN sites s ON s.id = st.site_id
         LEFT JOIN categories cat ON cat.id = s.category_id
         LEFT JOIN categories root ON root.id = COALESCE(cat.parent_id, cat.id)`,
      )
      .all()
      .map((r) => ({ siteId: String(r.siteId), tagId: String(r.tagId), categoryTitle: String(r.categoryTitle ?? '') }))
    const rootCategoryTitles = db
      .prepare('SELECT title FROM categories WHERE parent_id IS NULL ORDER BY sort')
      .all()
      .map((r) => String(r.title))
    return { tags, siteTags, activeSiteIds, rootCategoryTitles }
  } finally {
    db.close()
  }
}

/** 门禁：仍有一级大类复读、同义词分裂或大小写失范时返回违规清单。 */
/**
 * 引用完整性检查：tag_aliases / site_tags 是否指向已删除的标签行。
 * 并行治理脚本若只删 tags 不留清理，会留下孤儿关联——旧 URL 重定向会指向不存在的标签。
 */
export function checkReferentialIntegrity(dbPath = DEFAULT_DB_PATH) {
  const Database = require('better-sqlite3')
  const db = new Database(dbPath, { readonly: true })
  try {
    return {
      orphanAliases: db
        .prepare('SELECT COUNT(*) n FROM tag_aliases a LEFT JOIN tags t ON t.id = a.tag_id WHERE t.id IS NULL')
        .get().n,
      orphanSiteTags: db
        .prepare('SELECT COUNT(*) n FROM site_tags st LEFT JOIN tags t ON t.id = st.tag_id WHERE t.id IS NULL')
        .get().n,
    }
  } finally {
    db.close()
  }
}

export function checkGovernance(analysis) {
  return {
    categoryDuplicates: analysis.categoryDuplicates,
    merges: analysis.merges,
    normalizations: analysis.normalizations.filter((n) => {
      const tag = analysis.tagById.get(n.id)
      return tag && tag.name !== n.to
    }),
  }
}

function formatTop(before, after) {
  const rows = []
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    const b = before[i]
    const a = after[i]
    rows.push(
      `  ${String(i + 1).padStart(2)}. ` +
        `${((b?.name ?? '—') + ` (${b?.count ?? 0})`).padEnd(30)} | ` +
        `${(a?.name ?? '—') + ` (${a?.count ?? 0})`}`,
    )
  }
  return rows.join('\n')
}

function printReport(dbPath, analysis, mode, top) {
  const s = analysis.summary
  console.log(`\n============ 标签治理报告（${mode}） ============`)
  console.log(`目标库: ${dbPath}`)
  console.log(
    `一级大类: ${s.rootCategories} | 活跃站点: ${s.activeSites} | 站点-标签关联: ${s.associationBefore} -> ${s.associationAfter}`,
  )
  console.log(`唯一标签数: ${s.tagsBefore} -> ${s.tagsAfter} (减少 ${s.uniqueTagReduction})`)
  console.log(
    `单站长尾标签: ${s.singleSiteBefore}/${s.tagsBefore} = ${(s.singleSiteRatioBefore * 100).toFixed(1)}%` +
      `  ->  ${s.singleSiteAfter}/${s.tagsAfter} = ${(s.singleSiteRatioAfter * 100).toFixed(1)}%`,
  )
  console.log(`≥3 站可索引标签: ${s.gte3Before} -> ${s.gte3After}`)
  console.log(`一级大类复读关联剔除: ${s.categoryDuplicateAssociations}（涉及 ${s.categoryDuplicateTags} 个标签）`)
  console.log(`同义词合并组: ${s.mergeGroups} | 规范名重写: ${s.renameGroups} | 大小写/空格归一: ${s.normalizationCount}`)
  console.log(`单站重复关联去重: ${s.duplicateAssociations}`)
  console.log(`\n--- Top ${top} 标签榜单（左=清洗前 / 右=清洗后）---`)
  console.log(formatTop(analysis.topBefore, analysis.topAfter))
  if (analysis.merges.length) {
    console.log(`\n--- 同义词/大小写归并明细（${analysis.merges.length} 对）---`)
    for (const m of analysis.merges.slice(0, 80)) {
      console.log(`  ${m.from} (${m.fromCount} 站) -> ${m.to} (${m.toCount} 站)`)
    }
    if (analysis.merges.length > 80) console.log(`  ...其余 ${analysis.merges.length - 80} 对见 JSON 报告`)
  }
  if (analysis.categoryDuplicates.length) {
    const byTag = new Map()
    for (const d of analysis.categoryDuplicates) {
      byTag.set(d.tag, (byTag.get(d.tag) ?? 0) + 1)
    }
    console.log(`\n--- 一级大类复读标签（${byTag.size} 种）---`)
    for (const [tag, count] of [...byTag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
      console.log(`  ${tag} × ${count}`)
    }
  }
  console.log('==================================================\n')
}

/** 落库：备份 → 事务归并 → 索引重算。仅在 --apply 下调用。 */
export async function applyGovernance(dbPath, analysis) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = resolve(dirname(dbPath), `backups/navhub.db.pre-normalize-${stamp}`)
  copyFileSync(dbPath, backupPath)
  console.log(`[normalize-tags] 已备份原库: ${backupPath}`)

  const Database = require('better-sqlite3')
  const db = new Database(dbPath)
  try {
    const { buildFtsTokens } = await import(new URL('../packages/core/src/cjk.ts', import.meta.url).href)
    const { pinyinTraits } = await import(new URL('../packages/core/src/pinyin.ts', import.meta.url).href)
    const touchedSites = new Set()

    db.transaction(() => {
      const now = Date.now()

      // 1. 先删一级大类复读关联（用原始 tagId，早于归并）
      const deleteDuplicate = db.prepare('DELETE FROM site_tags WHERE site_id = ? AND tag_id = ?')
      for (const d of analysis.categoryDuplicates) {
        deleteDuplicate.run(d.siteId, d.tagId)
        touchedSites.add(d.siteId)
      }

      // 2. 规范名重写（目标标签自身名称不标准，但无需合并时）
      const rename = db.prepare('UPDATE tags SET name = ?, slug = ? WHERE id = ?')
      for (const r of analysis.renames) {
        rename.run(r.to, slugifyTag(r.to), r.id)
      }

      // 3. 注册别名：旧名 / 旧 slug / 归一化键，保证旧 URL 能被 /api/tags/resolve 命中
      const insertAlias = db.prepare(
        'INSERT OR IGNORE INTO tag_aliases (alias, tag_id, created_at) VALUES (?, ?, ?)',
      )
      for (const op of analysis.aliasOps) {
        insertAlias.run(op.alias, op.tagId, now)
      }

      // 4. 归并：只搬目标标签尚未绑定的站点，再删源标签
      const moveSites = db.prepare(
        `INSERT INTO site_tags (site_id, tag_id)
         SELECT site_id, ? FROM site_tags
         WHERE tag_id = ? AND NOT EXISTS (
           SELECT 1 FROM site_tags st2
           WHERE st2.site_id = site_tags.site_id AND st2.tag_id = ?
         )`,
      )
      const deleteSourceLinks = db.prepare('DELETE FROM site_tags WHERE tag_id = ?')
      const deleteSourceTag = db.prepare('DELETE FROM tags WHERE id = ?')
      for (const group of analysis.groups.values()) {
        const targetId = String(group.target.id)
        for (const source of group.sources) {
          const sourceId = String(source.id)
          const sites = db
            .prepare('SELECT DISTINCT site_id FROM site_tags WHERE tag_id = ?')
            .all(sourceId)
            .map((r) => String(r.site_id))
          for (const siteId of sites) touchedSites.add(siteId)
          moveSites.run(targetId, sourceId, targetId)
          deleteSourceLinks.run(sourceId)
          deleteSourceTag.run(sourceId)
        }
      }

      // 5. 单站-标签去重（site_tags 无唯一约束，历史数据可能有多余行）
      const dupRows = db
        .prepare(
          `SELECT rowid, site_id, tag_id FROM site_tags WHERE rowid NOT IN (
             SELECT MIN(rowid) FROM site_tags GROUP BY site_id, tag_id
           )`,
        )
        .all()
      const deleteDup = db.prepare('DELETE FROM site_tags WHERE rowid = ?')
      for (const row of dupRows) {
        deleteDup.run(row.rowid)
        touchedSites.add(String(row.site_id))
      }

      // 6. 重算受影响站点的检索索引（fts_tokens / pinyin_*），与 store mergeTags 同口径
      const reindex = db.prepare(
        'UPDATE sites SET fts_tokens = ?, pinyin_full = ?, pinyin_initials = ?, updated_at = ? WHERE id = ?',
      )
      for (const siteId of touchedSites) {
        const site = db.prepare('SELECT id, title, description, url FROM sites WHERE id = ?').get(siteId)
        if (!site) continue
        const tagRows = db
          .prepare(
            'SELECT t.slug FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = ?',
          )
          .all(siteId)
          .map((r) => String(r.slug))
        const corpus = [String(site.title), site.description ?? '', ...tagRows].join(' ')
        reindex.run(
          buildFtsTokens([String(site.title), site.description, String(site.url), ...tagRows]),
          pinyinTraits(corpus).full,
          pinyinTraits(String(site.title)).initials,
          now,
          siteId,
        )
      }
    })()

    console.log(`[normalize-tags] 已落库，重算索引站点数: ${touchedSites.size}`)
  } finally {
    db.close()
  }
}

function parseArgs(argv) {
  const args = {
    apply: false,
    dryRun: true,
    check: false,
    db: DEFAULT_DB_PATH,
    jsonReport: null,
    top: 30,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') {
      args.apply = true
      args.dryRun = false
    } else if (a === '--dry-run') {
      args.dryRun = true
      args.apply = false
    } else if (a === '--check') {
      args.check = true
    } else if (a === '--db' && argv[i + 1]) {
      args.db = resolve(process.cwd(), argv[++i])
    } else if (a === '--json-report' && argv[i + 1]) {
      args.jsonReport = resolve(process.cwd(), argv[++i])
    } else if (a === '--top' && argv[i + 1]) {
      args.top = Math.max(1, Math.trunc(Number(argv[++i])) || 30)
    } else if (a === '--help' || a === '-h') {
      console.log('用法: node scripts/normalize-tags.mjs [--dry-run|--apply|--check] [--db path] [--json-report path] [--top N]')
      process.exit(0)
    }
  }
  return args
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  if (!existsSync(args.db)) {
    console.error(`[normalize-tags] 数据库不存在: ${args.db}`)
    process.exit(1)
  }
  const snapshot = loadSnapshot(args.db)
  const analysis = analyzeTagData({ ...snapshot, top: args.top })
  printReport(args.db, analysis, args.apply ? 'APPLY' : args.check ? 'CHECK' : 'DRY-RUN', args.top)

  if (args.jsonReport) {
    const serialized = {
      generatedAt: new Date().toISOString(),
      dbPath: args.db,
      summary: analysis.summary,
      topBefore: analysis.topBefore,
      topAfter: analysis.topAfter,
      merges: analysis.merges,
      renames: analysis.renames,
      normalizations: analysis.normalizations,
      categoryDuplicates: analysis.categoryDuplicates,
      duplicateAssociations: analysis.duplicateAssociations,
      aliasOps: analysis.aliasOps,
    }
    writeFileSync(args.jsonReport, JSON.stringify(serialized, null, 2) + '\n', 'utf8')
    console.log(`[normalize-tags] JSON 报告: ${args.jsonReport}`)
  }

  if (args.check) {
    const violations = checkGovernance(analysis)
    const integrity = checkReferentialIntegrity(args.db)
    const count = violations.categoryDuplicates.length + violations.merges.length + violations.normalizations.length
      + integrity.orphanAliases + integrity.orphanSiteTags
    if (count > 0) {
      console.error(`[normalize-tags] 门禁失败：仍有 ${count} 处待治理（复读 ${violations.categoryDuplicates.length} / 合并 ${violations.merges.length} / 归一 ${violations.normalizations.length} / 孤儿别名 ${integrity.orphanAliases} / 悬空关联 ${integrity.orphanSiteTags}）`)
      process.exit(1)
    }
    console.log('[normalize-tags] 门禁通过：无复读/分裂/大小写问题，无孤儿关联')
  } else if (args.apply) {
    await applyGovernance(args.db, analysis)
  } else {
    console.log('[normalize-tags] DRY-RUN 模式：未修改数据库。确认报告后加 --apply 落库。')
  }
}
