// run88 §3 只读挖掘：绝不写库（readonly + fileMustExist + timeout）
const path = require('path')
const Database = require(path.join(process.cwd(), 'apps/api/node_modules/better-sqlite3'))

const dbPath = path.join(process.cwd(), 'data/navhub.db')
let db
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 2000 })
} catch (e) {
  console.log('OPEN_FAILED:', e.message)
  process.exit(0)
}

const q = (sql, params = []) => {
  try { return db.prepare(sql).all(...params) } catch (e) { return [{ error: e.message }] }
}
const one = (sql, params = []) => {
  try { return db.prepare(sql).get(...params) } catch (e) { return { error: e.message } }
}
const DAY = 86400000
const now = Date.now()
const d7 = now - 7 * DAY

console.log('### db', dbPath, 'size', require('fs').statSync(dbPath).size)
console.log('\n### row counts')
for (const t of ['events', 'llm_usage', 'search_history', 'audit_logs', 'plugin_installs', 'plugins', 'favorites', 'user_settings', 'sites', 'categories']) {
  console.log(' ', t, one(`select count(*) c from ${t}`))
}

console.log('\n### llm_usage last 7d by scenario/source')
console.log(q(`select scenario, source, count(*) n,
  sum(case when ok=0 or (error_code is not null and error_code<>'') then 1 else 0 end) fail,
  round(avg(latency_ms)) avg_ms,
  max(latency_ms) max_ms
  from llm_usage where created_at >= ?
  group by scenario, source order by n desc limit 20`, [d7]))

console.log('\n### llm_usage error_code last 7d')
console.log(q(`select coalesce(nullif(error_code,''),'(none)') code, count(*) n
  from llm_usage where created_at >= ? and (ok=0 or (error_code is not null and error_code<>''))
  group by code order by n desc limit 15`, [d7]))

console.log('\n### llm_usage by day (ms bucket)')
console.log(q(`select created_at - created_at % ${DAY} day, count(*) n,
  sum(case when ok=0 or (error_code is not null and error_code<>'') then 1 else 0 end) fail
  from llm_usage where created_at >= ? group by day order by day desc limit 8`, [now - 8 * DAY]))

console.log('\n### events by kind (7d)')
console.log(q(`select kind, count(*) n from events where created_at >= ? group by kind order by n desc limit 30`, [d7]))

console.log('\n### events by day (7d)')
console.log(q(`select created_at - created_at % ${DAY} day, count(*) n from events where created_at >= ? group by day order by day desc limit 8`, [now - 8 * DAY]))

console.log('\n### search_history zero-result (7d)')
console.log(q(`select count(*) total, sum(case when result_count=0 then 1 else 0 end) zero from search_history where created_at >= ?`, [d7]))
console.log(q(`select query, count(*) n, max(result_count) maxr from search_history
  where created_at >= ? and result_count = 0 group by lower(query) order by n desc limit 15`, [d7]))

console.log('\n### search_history recent (10)')
console.log(q(`select query, result_count, created_at from search_history order by created_at desc limit 10`))

console.log('\n### audit_logs top actions (7d)')
console.log(q(`select action, count(*) n from audit_logs where created_at >= ? group by action order by n desc limit 15`, [d7]))

console.log('\n### plugin funnel (7d)')
console.log(q(`select kind, count(*) n from events
  where created_at >= ? and (kind like 'plugin%' or kind like 'marketplace%')
  group by kind order by n desc limit 20`, [d7]))

console.log('\n### plugin_installs (7d)')
console.log(one(`select count(*) n, count(distinct plugin_slug) plugins from plugin_installs where created_at >= ?`, [d7]))

console.log('\n### favorites / user_settings usage')
console.log(one(`select count(*) favs, count(distinct identity) ids from favorites`))
console.log(one(`select count(*) rows, count(distinct identity) ids from user_settings`))

db.close()
