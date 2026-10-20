#!/usr/bin/env node
/**
 * 清理开发库中的测试插件残留（E2E / 探针 / NextGen 用例产物）。
 *
 * 背景：Playwright 的 webServer 曾直接启动 scripts/dev-all.mjs（写死开发库
 * data/navhub.db），插件市场用例每跑一次就往开发库写一批 e2e-* 插件，
 * 使市场里真实种子插件被淹没。2026-10-20 起 E2E 已改用独立库
 * （data/e2e/navhub-e2e.db，见 e2e/global-setup.ts），本脚本负责清历史残留。
 *
 * 用法：
 *   node scripts/purge-test-plugins.mjs                 # 预演（dry-run，只统计不删除）
 *   node scripts/purge-test-plugins.mjs --apply         # 实际删除
 *   node scripts/purge-test-plugins.mjs --apply --db data/navhub.db
 *
 * 说明：sqlite-vec 的 plugins_vec / sites_vec 只是索引，事实源分别是
 * plugin_embeddings / embeddings；删除事实源后，向量表会在服务下一次启动时
 * 以不一致检测自动重建（SqliteVecStore.rehydrate 口径），无需手工处理。
 */
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const dbFlag = args.indexOf('--db')
const dbPath = dbFlag >= 0 ? args[dbFlag + 1] : 'data/navhub.db'

if (!existsSync(dbPath)) {
  console.error(`✗ 数据库不存在：${dbPath}`)
  process.exit(1)
}

/** 测试产物 slug 前缀（e2e/ 用例自造，或 nextgen 链路用例自造） */
const SLUG_PREFIXES = ['e2e-', 'probe-', 'nextgen-']
const slugLike = SLUG_PREFIXES.map(() => 'slug LIKE ?').join(' OR ')
const slugParams = SLUG_PREFIXES.map((p) => `${p}%`)
const siteSourceLike = SLUG_PREFIXES.map(() => 'source LIKE ?').join(' OR ')
const siteSourceParams = SLUG_PREFIXES.map((p) => `plugin:${p}%`)

const db = new DatabaseSync(dbPath)
const all = (sql, params = []) => db.prepare(sql).all(...params)
const count = (sql, params = []) => db.prepare(sql).get(...params).n

const plugins = all(`SELECT id, slug, kind, status FROM plugins WHERE ${slugLike}`, slugParams)
const pluginIds = plugins.map((p) => p.id)
const sites = all(`SELECT id, url, title, source FROM sites WHERE ${siteSourceLike}`, siteSourceParams)
const siteIds = sites.map((s) => s.id)

const inClause = (list, prefix, suffix = '') =>
  list.length === 0 ? { sql: '(NULL)', params: [] } : { sql: `(${list.map((_, i) => `${prefix}${i + 1}${suffix}`).join(', ')})`, params: list }

const pluginIn = inClause(pluginIds, '?')
const siteIn = inClause(siteIds, '?')

const testCategories = all(
  `SELECT id, title FROM categories WHERE (title LIKE 'E2E %' OR title LIKE 'PROBE %' OR title LIKE 'NextGen %')`,
)

const report = {
  plugins: plugins.length,
  sites: sites.length,
  categories: testCategories.length,
  plugin_installs: pluginIds.length ? count(`SELECT count(*) n FROM plugin_installs WHERE plugin_id IN ${pluginIn.sql}`, pluginIn.params) : 0,
  plugin_stars: pluginIds.length ? count(`SELECT count(*) n FROM plugin_stars WHERE plugin_id IN ${pluginIn.sql}`, pluginIn.params) : 0,
  plugin_reviews: pluginIds.length ? count(`SELECT count(*) n FROM plugin_reviews WHERE plugin_id IN ${pluginIn.sql}`, pluginIn.params) : 0,
  plugin_versions: pluginIds.length ? count(`SELECT count(*) n FROM plugin_versions WHERE plugin_id IN ${pluginIn.sql}`, pluginIn.params) : 0,
  plugin_embeddings: pluginIds.length ? count(`SELECT count(*) n FROM plugin_embeddings WHERE ${slugLike}`, slugParams) : 0,
  site_tags: siteIds.length ? count(`SELECT count(*) n FROM site_tags WHERE site_id IN ${siteIn.sql}`, siteIn.params) : 0,
  embeddings: siteIds.length ? count(`SELECT count(*) n FROM embeddings WHERE site_id IN ${siteIn.sql}`, siteIn.params) : 0,
}

console.log(`数据库：${dbPath}`)
console.log('待清理（按表）：', JSON.stringify(report, null, 2))
if (plugins.length > 0) {
  console.log('插件样例：', plugins.slice(0, 5).map((p) => `${p.slug}(${p.kind})`).join(', '))
}
if (sites.length > 0) {
  console.log('站点样例：', sites.slice(0, 5).map((s) => s.url).join(', '))
}

if (!apply) {
  console.log('\n（预演模式）加 --apply 才会真正删除。')
  db.close()
  process.exit(0)
}

db.exec('BEGIN')
try {
  if (pluginIds.length > 0) {
    for (const table of ['plugin_installs', 'plugin_stars', 'plugin_reviews', 'plugin_versions']) {
      db.prepare(`DELETE FROM ${table} WHERE plugin_id IN ${pluginIn.sql}`).run(...pluginIn.params)
    }
    db.prepare(`DELETE FROM plugin_embeddings WHERE ${slugLike}`).run(...slugParams)
    db.prepare(`DELETE FROM plugins WHERE ${slugLike}`).run(...slugParams)
  }
  if (siteIds.length > 0) {
    db.prepare(`DELETE FROM site_tags WHERE site_id IN ${siteIn.sql}`).run(...siteIn.params)
    db.prepare(`DELETE FROM embeddings WHERE site_id IN ${siteIn.sql}`).run(...siteIn.params)
    db.prepare(`DELETE FROM sites WHERE id IN ${siteIn.sql}`).run(...siteIn.params)
  }
  // 测试分类：删除站点后仍为空才删（避免误删仍有站点的分类）
  for (const cat of testCategories) {
    const remaining = count('SELECT count(*) n FROM sites WHERE category_id = ?', [cat.id])
    if (remaining > 0) continue
    db.prepare('DELETE FROM categories WHERE id = ?').run(cat.id)
  }
  db.exec('COMMIT')
  console.log('\n✓ 已清理完成。重启 API 服务后 plugins_vec / sites_vec 会自动重建。')
} catch (err) {
  db.exec('ROLLBACK')
  console.error('✗ 清理失败，已回滚：', err)
  db.close()
  process.exit(1)
}
db.close()
