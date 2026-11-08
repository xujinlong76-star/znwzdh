import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync('data/navhub.db', { readOnly: true })
const bad = db.prepare("SELECT COUNT(*) c FROM sites WHERE created_at IS NULL OR typeof(created_at) != 'integer'").get().c
console.log('sites with NULL/non-integer created_at: ' + bad)
const badRows = db.prepare("SELECT id, title, created_at, weight, trend_score FROM sites WHERE created_at IS NULL OR typeof(created_at) != 'integer' LIMIT 5").all()
console.log('samples: ' + JSON.stringify(badRows, null, 1))
const nullWeight = db.prepare('SELECT COUNT(*) c FROM sites WHERE weight IS NULL').get().c
const nullTrend = db.prepare('SELECT COUNT(*) c FROM sites WHERE trend_score IS NULL').get().c
console.log('weight NULL=' + nullWeight + ' | trend_score NULL=' + nullTrend)
const same = db.prepare('SELECT COUNT(*) c FROM sites WHERE weight = trend_score AND trend_score != 0').get().c
const nonzero = db.prepare('SELECT COUNT(*) c FROM sites WHERE trend_score != 0').get().c
console.log('weight==trend_score (非零) = ' + same + ' / trend_score非零 = ' + nonzero)
const sample = db.prepare('SELECT id, title, weight, trend_score, sort FROM sites ORDER BY trend_score DESC LIMIT 5').all()
console.log('top trend: ' + JSON.stringify(sample, null, 1))
const w = db.prepare('SELECT weight, COUNT(*) c FROM sites GROUP BY weight ORDER BY c DESC LIMIT 6').all()
console.log('weight 分布: ' + JSON.stringify(w))