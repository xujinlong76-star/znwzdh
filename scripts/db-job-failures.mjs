import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync('data/navhub.db', { readOnly: true })
const cols = db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name)
console.log('jobs columns: ' + cols.join(', '))
const failed = db.prepare("SELECT * FROM jobs WHERE kind='recompute_rank' AND status='failed' ORDER BY updated_at DESC LIMIT 3").all()
for (const f of failed) { console.log('---'); for (const [k,v] of Object.entries(f)) { const s = String(v); if (s && s !== 'null') console.log('  ' + k + ' = ' + s.slice(0, 300)) } }