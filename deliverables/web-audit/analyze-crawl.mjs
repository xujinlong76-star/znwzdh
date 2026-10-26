import fs from 'node:fs'
const d = JSON.parse(fs.readFileSync('deliverables/web-audit/crawl-results.json', 'utf8'))
const strip = (u) => {
  try { const x = new URL(u); return x.pathname } catch { return u }
}

console.log('=== failedRequests (' + (d.failedRequests || []).length + ') ===')
const f = new Map()
for (const x of d.failedRequests || []) {
  const k = (x.error || '?') + ' | ' + (x.type || '?')
  f.set(k, (f.get(k) || 0) + 1)
}
for (const [k, v] of [...f.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log('  ' + v + 'x  ' + k)

console.log('--- 样本 ---')
const seen = new Set()
for (const x of d.failedRequests || []) {
  const u = strip(x.url)
  if (seen.has(u)) continue
  seen.add(u)
  if (seen.size <= 12) console.log('  [' + (x.type || '?') + '] ' + x.error + ' :: ' + u)
}

console.log('=== badResponses (' + (d.badResponses || []).length + ') ===')
const b = new Map()
for (const x of d.badResponses || []) {
  const k = x.status + ' ' + strip(x.url)
  b.set(k, (b.get(k) || 0) + 1)
}
for (const [k, v] of [...b.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log('  ' + v + 'x  ' + k)

console.log('=== consoleErr pages ===')
for (const p of d.results) {
  if (p.consoleErr && p.consoleErr.length) {
    console.log('  ' + p.url)
    console.log('    ' + JSON.stringify(p.consoleErr).slice(0, 500))
  }
}
