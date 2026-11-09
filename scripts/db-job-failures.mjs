import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync('data/navhub.db', { readOnly: true })
const fmt = (t) => new Date(Number(t)).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
const rows = db.prepare("SELECT id, kind, status, attempts, error, updated_at FROM jobs WHERE kind='recompute_rank' ORDER BY updated_at DESC LIMIT 10").all()
console.log('=== 最近 10 条 recompute_rank ===')
for (const r of rows) console.log(fmt(r.updated_at) + '  ' + r.status.padEnd(8) + ' attempts=' + r.attempts + (r.error ? '  ' + r.error.slice(0,60) : ''))
console.log('')
const since = Date.now() - 4*3600000
const recent = db.prepare("SELECT status, COUNT(*) c FROM jobs WHERE kind='recompute_rank' AND updated_at > ? GROUP BY status").all(since)
console.log('最近 4 小时 recompute_rank 状态:', JSON.stringify(recent))