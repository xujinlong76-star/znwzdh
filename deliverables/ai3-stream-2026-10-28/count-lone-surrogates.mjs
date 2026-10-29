import fs from 'node:fs'
const p = process.argv[2] ?? 'apps/web/src/navsphere/content/videos.json'
const txt = fs.readFileSync(p, 'utf8')
const re = /\\u([0-9a-fA-F]{4})(?=(\\u([0-9a-fA-F]{4}))?)/g
let m
let loneHigh = 0
let loneLow = 0
const spots = []
while ((m = re.exec(txt)) !== null) {
  const code = parseInt(m[1], 16)
  const next = txt.slice(m.index + m[0].length, m.index + m[0].length + 6)
  const nextCode = next.startsWith('\\u') ? parseInt(next.slice(2), 16) : null
  if (code >= 0xd800 && code <= 0xdbff && !(nextCode !== null && nextCode >= 0xdc00 && nextCode <= 0xdfff)) {
    loneHigh++
    if (spots.length < 5) spots.push({ index: m.index, line: txt.slice(0, m.index).split('\n').length, ctx: txt.slice(m.index - 30, m.index + 8) })
  }
  if (code >= 0xdc00 && code <= 0xdfff) {
    const before = txt.slice(Math.max(0, m.index - 6), m.index)
    const beforeCode = before.startsWith('\\u') ? parseInt(before.slice(2), 16) : null
    if (!(beforeCode !== null && beforeCode >= 0xd800 && beforeCode <= 0xdbff)) loneLow++
  }
  if (next.startsWith('\\u')) re.lastIndex = m.index + m[0].length + 6
}
console.log(JSON.stringify({ p, loneHigh, loneLow, spots }, null, 1))
