import fs from 'node:fs'

const BASE = process.env.NAVHUB_AUDIT_BASE || 'http://127.0.0.1:3210'
const d = JSON.parse(fs.readFileSync('deliverables/web-audit/crawl-results.json', 'utf8'))
const urls = [...new Set(d.results.map((p) => p.url))]
console.log('urls:', urls.length)

const EMOJI_RE = /href="\/marketplace\/%[0-9A-F]{2}[^"]*"/gi
const TAG_RE = /href="\/tags\/[^"]*"/gi
const KNOWN_BAD_TAGS = ['codepen', 'xai', '实时信息']

const hits = []
let i = 0
async function worker() {
  while (i < urls.length) {
    const idx = i++
    const u = urls[idx]
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(60000) })
      const html = await res.text()
      const emoji = [...new Set((html.match(EMOJI_RE) || []))]
      const allTags = [...new Set((html.match(TAG_RE) || []))]
      const badTags = allTags.filter((t) => {
        const seg = decodeURIComponent(t.replace(/^href="\/tags\//, '').replace(/"$/, ''))
        return KNOWN_BAD_TAGS.includes(seg)
      })
      if (emoji.length || badTags.length) {
        hits.push({ page: new URL(u).pathname, emoji: emoji.slice(0, 25), badTags: badTags.slice(0, 10) })
      }
    } catch (e) {
      /* 忽略单页失败 */
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()])

console.log('\n=== 含可疑链接的页面 (' + hits.length + ') ===')
for (const h of hits) {
  console.log('\n## ' + h.page)
  if (h.emoji.length) console.log('   emoji 市场链 ' + h.emoji.length + ': ' + h.emoji.slice(0, 8).join(' '))
  if (h.badTags.length) console.log('   失效标签链: ' + h.badTags.join(' '))
}
fs.writeFileSync('deliverables/web-audit/suspicious-link-pages.json', JSON.stringify(hits, null, 2))
console.log('\n=== LINK SCAN DONE ===')
