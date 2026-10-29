import fs from 'node:fs'
const p = 'apps/web/src/navsphere/content/videos.json'
const s = fs.readFileSync(p, 'utf8')
const lines = s.split('\n')
console.log('total lines', lines.length)
console.log('line 69341 tail:', JSON.stringify(lines[69340].slice(40, 160)))
const short = /\\u[0-9a-fA-F]{0,3}(?![0-9a-fA-F])/
let count = 0
const examples = []
for (let i = 0; i < lines.length; i++) {
  if (short.test(lines[i])) {
    count++
    if (examples.length < 3) examples.push([i + 1, lines[i].slice(70, 150)])
  }
}
console.log('lines with truncated \\u escape:', count)
console.log(JSON.stringify(examples, null, 1))
const parsed = JSON.parse(s)
const text = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g
console.log('lone surrogate count after parse:', (text.match(lone) || []).length)
console.log('top-level keys:', Array.isArray(parsed) ? 'array ' + parsed.length : Object.keys(parsed).slice(0, 8).join(','))
