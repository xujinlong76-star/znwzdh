import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync('data/navhub.db', { readOnly: true })
const rows = db.prepare('SELECT kind, status, COUNT(*) c FROM jobs GROUP BY kind, status ORDER BY c DESC').all()
console.log('jobs by kind/status:')
for (const r of rows) console.log('  ' + r.kind + ' / ' + r.status + ' = ' + r.c)
const recent = db.prepare("SELECT kind, status, substr(payload,1,60) p FROM jobs ORDER BY created_at DESC LIMIT 8").all()
console.log('recent jobs:')
for (const r of recent) console.log('  ' + r.kind + ' ' + r.status + ' ' + (r.p || ''))
const emb = db.prepare('SELECT COUNT(*) c FROM embeddings').get().c
const sites = db.prepare("SELECT COUNT(*) c FROM sites WHERE status='active'").get().c
console.log('embeddings=' + emb + ' activeSites=' + sites + ' coverage=' + (emb / sites * 100).toFixed(1) + '%')
const models = db.prepare('SELECT model, COUNT(*) c FROM embeddings GROUP BY model').all()
console.log('models: ' + JSON.stringify(models))