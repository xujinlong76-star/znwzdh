#!/usr/bin/env node
/**
 * 逐表行数快照（含「0 行空表」识别）。
 *
 * 用途：深度扫描时判定「功能空壳」——表结构存在但生产路径从未写入一行。
 * 注意：0 行既可能是「端点从未被调用」，也可能是「调用后写入失败」，
 * 两者处置相反（前者留观察、后者是 P0 Bug），不可一刀切删表。
 *
 * 用法：node scripts/db-table-counts.mjs [db路径]   默认 data/navhub.db
 */
import { DatabaseSync } from 'node:sqlite'

const dbPath = process.argv[2] || 'data/navhub.db'
const db = new DatabaseSync(dbPath, { readOnly: true })

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name)

const counts = new Map()
for (const t of tables) {
  try {
    counts.set(t, db.prepare('SELECT COUNT(*) c FROM "' + t + '"').get().c)
  } catch {
    counts.set(t, -1)
  }
}

const rows = [...counts.entries()].sort((a, b) => b[1] - a[1])
const empty = rows.filter(([, c]) => c === 0)

console.log('db=' + dbPath)
console.log('tables=' + tables.length + ' empty=' + empty.length)
console.log('')
console.log('--- 逐表行数（降序） ---')
for (const [t, c] of rows) console.log(String(c).padStart(8) + '  ' + t)
console.log('')
console.log('--- 0 行表（需逐张判定：从未调用 / 写入失败 / 设计预留） ---')
console.log(empty.length ? empty.map(([t]) => t).join(', ') : '(none)')
